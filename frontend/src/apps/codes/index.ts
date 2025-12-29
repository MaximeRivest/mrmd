/**
 * Atelier - Unified Application Entry Point
 *
 * Single app with two interface modes:
 * - Compact (Study): Minimal chrome, writer-focused, tool rail for power features
 * - Developer (Codes): Full IDE with sidebar, file tabs, terminal
 *
 * Architecture:
 * - @mrmd/editor provides the editing surface with built-in execution
 * - Services handle API calls (DocumentService, CollaborationService)
 * - AppState manages centralized application state
 * - UI modules (from /core/*.js) provide the chrome
 * - InterfaceManager handles compact/developer mode switching
 */

import type { Services, ExternalChangeInfo } from '../shared/types';
import { appState } from '../shared/AppState';
import { createImageUrlResolver } from '../shared/imageUrl';

// @mrmd/editor - direct import, no bridge
// @ts-ignore - Browser module
import {
    createEditor,
    IPythonExecutor,
    type MrmdEditor,
    type CursorInfo,
    type CompletionResult,
    type InspectionResult,
    type HoverResult,
} from '/editor-dist/index.browser.js';

// UI Module imports (legacy JS modules)
// @ts-ignore
import { IPythonClient } from '/core/ipython-client.js';
// @ts-ignore
import { detectLanguage } from '/core/utils.js';
// @ts-ignore
import * as SessionState from '/core/session-state.js';
// @ts-ignore
import { createFileTabs } from '/core/file-tabs.js';
// @ts-ignore
import { createRecentProjectsPanel } from '/core/recent-projects.js';
// @ts-ignore
import { createFileBrowser } from '/core/file-browser.js';
// @ts-ignore
import { AiClient } from '/core/ai-client.js';
// @ts-ignore
import { createAiPalette } from '/core/ai-palette.js';
// @ts-ignore
import { HistoryPanel } from '/core/history-panel.js';
// @ts-ignore
import { createTerminalTabs } from '/core/terminal-tabs.js';
// @ts-ignore
import { createNotificationManager } from '/core/notifications.js';
// @ts-ignore
import { createProcessSidebar } from '/core/process-sidebar.js';
// @ts-ignore
import { toggleMode, HomeScreen } from '/core/compact-mode.js';
// @ts-ignore
import { initSelectionToolbar } from '/core/selection-toolbar.js';
// @ts-ignore
import * as VariablesPanel from '/core/variables-panel.js';

// Interface mode management
import { InterfaceManager, createInterfaceManager } from './InterfaceManager';
// @ts-ignore
import { initEditorKeybindings } from '/core/editor-keybindings.js';

// AI Action Handler - bridges AI Palette → Editor Streaming Layer
import {
    createAIActionHandler,
    type AIActionHandler,
    type AIActionContext,
} from '../../services/ai-action-handler';

// ============================================================================
// Types
// ============================================================================

interface FileTabs {
    addTab(path: string, filename: string, modified?: boolean): void;
    removeTab(path: string): void;
    setActiveTab(path: string): void;
    updateTabModified(path: string, modified: boolean): void;
    renameTab(oldPath: string, newPath: string, newFilename: string): void;
}

interface FileBrowserAPI {
    refresh(): void;
    setRoot?(path: string): void;
    focus(): void;
}

interface TerminalTabsAPI {
    closeTerminalsForFile(path: string): void;
}

interface NotificationManager {
    addLocalNotification(title: string, message: string, type?: string): void;
}

interface AiPaletteAPI {
    attachToEditor(config: unknown): void;
    setCurrentFile(path: string | null): void;
}

// ============================================================================
// Module State
// ============================================================================

let services: Services;
let editor: MrmdEditor;
let ipython: IPythonClient;
let ipythonExecutor: IPythonExecutor;  // Executor for code blocks - needs session sync
let aiClient: AiClient;
let fileTabs: FileTabs;
let fileBrowser: FileBrowserAPI;
let terminalTabs: TerminalTabsAPI;
let notificationManager: NotificationManager | null = null;
let aiPalette: AiPaletteAPI;
let historyPanel: HistoryPanel | null = null;
let interfaceManager: InterfaceManager | null = null;
let aiActionHandler: AIActionHandler | null = null;

// DOM Elements
let container: HTMLElement;
let rawTextarea: HTMLTextAreaElement;
let cursorPosEl: HTMLElement;
let execStatusEl: HTMLElement;

// Application state
let browserRoot = '/home';
let documentBasePath = '';
let silentUpdate = false;

// Autosave
const AUTOSAVE_DELAY = 2000;
const AUTOSAVE_MAX_INTERVAL = 30000;
let autosaveTimer: ReturnType<typeof setTimeout> | null = null;
let lastSaveTime = Date.now();
let autosavePaused = false; // Pause during bulk operations like Run All

// File watching
let fileCheckInterval: ReturnType<typeof setInterval> | null = null;
let noCollab = false;

// Race condition protection for file loading
let currentFileLoadId = 0;

// External change handler manager instance
let externalChangeManager: ExternalChangeHandlerManager | null = null;

// ============================================================================
// External Change Handler Manager
// ============================================================================

/**
 * Conflict information for the conflict resolution UI (Step 6)
 */
interface ConflictInfo {
    filePath: string;
    localContent: string;
    externalContent: string;
    source: ExternalChangeInfo['source'];
    linesChanged: number;
    diffRegions: DiffRegion[];
}

/**
 * A region that differs between local and external content
 */
interface DiffRegion {
    startLine: number;
    endLine: number;
    localLines: string[];
    externalLines: string[];
}

/**
 * Per-file handler state
 */
interface FileHandlerState {
    filePath: string;
    /** Content at last save - for conflict detection */
    lastKnownContent: string;
    /** Timestamp of last known state */
    lastKnownMtime: number;
    /** Debounce timer for rapid changes */
    pendingCheck: ReturnType<typeof setTimeout> | null;
    /** Resume autosave callback (from paused state during debounce) */
    pendingResumeAutosave: (() => void) | null;
    /** Whether this handler is destroyed */
    destroyed: boolean;
    /** Content captured immediately when WebSocket event arrived (before debounce) */
    capturedExternalContent: string | null;
    /** Source captured when WebSocket event arrived */
    capturedSource: ExternalChangeInfo['source'] | null;
}

/**
 * Configuration for conflict handling
 */
type ConflictStrategy = 'external-wins' | 'local-wins' | 'prompt';

/**
 * ExternalChangeHandlerManager
 *
 * Manages external file change handlers per file. Provides:
 * - Per-file state tracking (lastKnownContent, debouncing)
 * - Conflict detection and strategy handling
 * - onConflict callback interface for Step 6's conflict resolution UI
 * - Lifecycle management (create on open, destroy on close)
 *
 * This is a lightweight implementation that works without Yjs,
 * using editor.applyExternalChange() for minimal diff-based updates.
 * When Yjs is connected, changes propagate to all collaborators.
 */
class ExternalChangeHandlerManager {
    private handlers = new Map<string, FileHandlerState>();
    private conflictStrategy: ConflictStrategy = 'external-wins';
    private debounceMs = 100;

    /**
     * Callback for conflict resolution (Step 6 will implement the UI)
     * Returns: 'accept' (use external), 'reject' (keep local), 'merge' (attempt merge)
     */
    onConflict: ((info: ConflictInfo) => Promise<'accept' | 'reject' | 'merge'>) | null = null;

    /**
     * Callback when external change is applied
     */
    onExternalChange: ((info: {
        filePath: string;
        source: ExternalChangeInfo['source'];
        linesChanged: number;
        hadConflict: boolean;
    }) => void) | null = null;

    /**
     * Callback to pause autosave during external change processing
     * Returns a function to resume autosave
     */
    onPauseAutosave: (() => (() => void)) | null = null;

    /**
     * Set the conflict resolution strategy
     */
    setConflictStrategy(strategy: ConflictStrategy): void {
        this.conflictStrategy = strategy;
    }

    /**
     * Register a file for external change handling
     * Called when a file is opened
     */
    registerFile(filePath: string, initialContent: string): void {
        // Clean up existing handler if any
        this.unregisterFile(filePath);

        const handler: FileHandlerState = {
            filePath,
            lastKnownContent: initialContent,
            lastKnownMtime: Date.now(),
            pendingCheck: null,
            pendingResumeAutosave: null,
            destroyed: false,
            capturedExternalContent: null,
            capturedSource: null,
        };

        this.handlers.set(filePath, handler);
        console.log('[ExternalChangeManager] Registered file:', filePath);
    }

    /**
     * Unregister a file (called when file is closed)
     */
    unregisterFile(filePath: string): void {
        const handler = this.handlers.get(filePath);
        if (handler) {
            handler.destroyed = true;
            if (handler.pendingCheck) {
                clearTimeout(handler.pendingCheck);
            }
            // Resume autosave if it was paused for this file
            if (handler.pendingResumeAutosave) {
                handler.pendingResumeAutosave();
                handler.pendingResumeAutosave = null;
            }
            this.handlers.delete(filePath);
            console.log('[ExternalChangeManager] Unregistered file:', filePath);
        }
    }

    /**
     * Mark a file as saved (updates lastKnownContent)
     * Called after save operations
     */
    markAsSaved(filePath: string, content: string): void {
        const handler = this.handlers.get(filePath);
        if (handler) {
            handler.lastKnownContent = content;
            handler.lastKnownMtime = Date.now();
        }
    }

    /**
     * Check if a file has local changes relative to last known state
     */
    hasLocalChanges(filePath: string, currentContent: string): boolean {
        const handler = this.handlers.get(filePath);
        if (!handler) return false;
        return currentContent !== handler.lastKnownContent;
    }

    /**
     * Handle an external file change event (debounced)
     *
     * IMPORTANT: We capture the file content IMMEDIATELY when the event arrives,
     * not after the debounce delay. This prevents a race condition where autosave
     * could overwrite external changes before we can detect them.
     */
    async handleFileChanged(
        filePath: string,
        source: ExternalChangeInfo['source'],
        loadFile: () => Promise<string>,
        applyChange: (content: string) => boolean,
        getCurrentContent: () => string
    ): Promise<void> {
        const handler = this.handlers.get(filePath);
        if (!handler || handler.destroyed) {
            console.log('[ExternalChangeManager] No handler for file:', filePath);
            return;
        }

        // IMMEDIATELY pause autosave when external change detected (only if not already paused)
        // This prevents autosave from overwriting external changes during debounce window
        if (!handler.pendingResumeAutosave) {
            handler.pendingResumeAutosave = this.onPauseAutosave?.() ?? null;
        }

        // IMMEDIATELY capture file content before autosave can overwrite it
        // This is the key to preventing the race condition!
        try {
            const capturedContent = await loadFile();
            handler.capturedExternalContent = capturedContent;
            handler.capturedSource = source;
            console.log('[ExternalChangeManager] Captured external content immediately, length:', capturedContent.length);
        } catch (err) {
            console.error('[ExternalChangeManager] Failed to capture content:', err);
            handler.pendingResumeAutosave?.();
            handler.pendingResumeAutosave = null;
            return;
        }

        // Debounce rapid changes - clear previous timeout if any
        if (handler.pendingCheck) {
            clearTimeout(handler.pendingCheck);
            // Note: we DON'T resume autosave here - keep it paused across debounce resets
            // The captured content will be updated with the latest version
        }

        handler.pendingCheck = setTimeout(async () => {
            handler.pendingCheck = null;
            const resumeAutosave = handler.pendingResumeAutosave;
            handler.pendingResumeAutosave = null;
            const capturedContent = handler.capturedExternalContent;
            const capturedSource = handler.capturedSource || source;
            handler.capturedExternalContent = null;
            handler.capturedSource = null;

            if (!capturedContent) {
                console.log('[ExternalChangeManager] No captured content, skipping');
                resumeAutosave?.();
                return;
            }

            try {
                await this.checkAndApplyChanges(
                    handler,
                    capturedSource,
                    capturedContent,  // Pass the captured content directly
                    applyChange,
                    getCurrentContent
                );
            } finally {
                // Resume autosave after processing (whether success or failure)
                resumeAutosave?.();
            }
        }, this.debounceMs);
    }

    /**
     * Actually check and apply changes (after debounce)
     *
     * @param capturedContent - Content captured immediately when WebSocket event arrived
     *                          This is NOT re-read from disk to avoid race conditions
     */
    private async checkAndApplyChanges(
        handler: FileHandlerState,
        source: ExternalChangeInfo['source'],
        capturedContent: string,  // Content captured immediately, not re-read from disk
        applyChange: (content: string) => boolean,
        getCurrentContent: () => string
    ): Promise<void> {
        if (handler.destroyed) return;

        // Note: Autosave is already paused by handleFileChanged() before debounce
        try {
            // Use the captured content (not re-read from disk - that would lose external changes!)
            const newContent = capturedContent;
            const currentContent = getCurrentContent();

            // Check if EXTERNAL content actually changed (disk differs from our last known state)
            // This is the key check - we compare disk content to lastKnownContent, not to editor content
            // This prevents autosave race conditions from hiding external changes
            if (newContent === handler.lastKnownContent) {
                console.log('[ExternalChangeManager] No external change (disk matches last known state)');
                return;
            }

            // Check if editor already has this content (maybe user typed the same thing, or we already applied it)
            if (newContent === currentContent) {
                console.log('[ExternalChangeManager] Editor already has this content, updating lastKnown');
                handler.lastKnownContent = newContent;
                handler.lastKnownMtime = Date.now();
                return;
            }

            // At this point: disk has new content that differs from both lastKnown AND current editor
            // This is a genuine external change

            // Check for conflict (user has local changes that differ from what was on disk)
            const hasLocalChanges = currentContent !== handler.lastKnownContent;
            const linesChanged = this.countLinesChanged(handler.lastKnownContent, newContent);

            console.log('[ExternalChangeManager] External change detected:', {
                filePath: handler.filePath,
                source,
                hasLocalChanges,
                linesChanged,
            });

            let shouldApply = true;
            let canAutoMerge = false;
            let mergedContent: string | null = null;

            if (hasLocalChanges) {
                // Check if we can auto-merge (changes in different parts of the file)
                const baseContent = handler.lastKnownContent;
                const localChangedLines = this.getChangedLineRanges(baseContent, currentContent);
                const externalChangedLines = this.getChangedLineRanges(baseContent, newContent);

                // Check if changes overlap
                const hasOverlap = this.rangesOverlap(localChangedLines, externalChangedLines);

                console.log('[ExternalChangeManager] Checking merge possibility:', {
                    localRanges: localChangedLines,
                    externalRanges: externalChangedLines,
                    hasOverlap,
                });

                if (!hasOverlap && localChangedLines.length > 0 && externalChangedLines.length > 0) {
                    // Changes don't overlap - try 3-way merge
                    mergedContent = this.attemptThreeWayMerge(baseContent, currentContent, newContent);
                    if (mergedContent !== null) {
                        canAutoMerge = true;
                        console.log('[ExternalChangeManager] Auto-merging non-overlapping changes');
                    }
                }

                if (!canAutoMerge) {
                    // CONFLICT: Changes overlap or merge failed
                    const conflictInfo: ConflictInfo = {
                        filePath: handler.filePath,
                        localContent: currentContent,
                        externalContent: newContent,
                        source,
                        linesChanged,
                        diffRegions: this.computeDiff(currentContent, newContent),
                    };

                    if (this.conflictStrategy === 'prompt' && this.onConflict) {
                        // Ask user how to handle conflict (Step 6)
                        const decision = await this.onConflict(conflictInfo);
                        shouldApply = decision === 'accept' || decision === 'merge';

                        if (decision === 'reject') {
                            console.log('[ExternalChangeManager] User rejected external changes');
                        }
                    } else if (this.conflictStrategy === 'local-wins') {
                        shouldApply = false;
                        console.log('[ExternalChangeManager] Local wins, ignoring external change');
                    }
                    // 'external-wins' falls through with shouldApply = true
                }
            }

            if (shouldApply || canAutoMerge) {
                // Apply the change - use merged content if available
                const contentToApply = canAutoMerge && mergedContent !== null ? mergedContent : newContent;
                const changed = applyChange(contentToApply);

                if (changed) {
                    // Update last known state to the external content (what's on disk)
                    // If we merged, the editor has merged content but disk has external content
                    handler.lastKnownContent = newContent;
                    handler.lastKnownMtime = Date.now();

                    // Notify listeners
                    this.onExternalChange?.({
                        filePath: handler.filePath,
                        source,
                        linesChanged,
                        hadConflict: hasLocalChanges && !canAutoMerge,
                    });

                    if (canAutoMerge) {
                        console.log('[ExternalChangeManager] Successfully auto-merged changes');
                    }
                }
            }
        } catch (error) {
            console.error('[ExternalChangeManager] Failed to handle file change:', error);
        }
        // Note: Autosave is resumed by handleFileChanged() after this returns
    }

    /**
     * Compute diff regions between two content strings
     */
    private computeDiff(local: string, external: string): DiffRegion[] {
        const localLines = local.split('\n');
        const externalLines = external.split('\n');
        const regions: DiffRegion[] = [];

        let i = 0;
        let j = 0;

        while (i < localLines.length || j < externalLines.length) {
            // Find next difference
            while (
                i < localLines.length &&
                j < externalLines.length &&
                localLines[i] === externalLines[j]
            ) {
                i++;
                j++;
            }

            if (i >= localLines.length && j >= externalLines.length) {
                break;
            }

            // Found a difference - collect differing lines
            const startLine = i;
            const diffLocalLines: string[] = [];
            const diffExternalLines: string[] = [];

            while (
                i < localLines.length &&
                j < externalLines.length &&
                localLines[i] !== externalLines[j]
            ) {
                diffLocalLines.push(localLines[i]);
                diffExternalLines.push(externalLines[j]);
                i++;
                j++;
            }

            // Handle unequal lengths
            while (i < localLines.length && (j >= externalLines.length || localLines[i] !== externalLines[j])) {
                diffLocalLines.push(localLines[i]);
                i++;
            }
            while (j < externalLines.length && (i >= localLines.length || localLines[i] !== externalLines[j])) {
                diffExternalLines.push(externalLines[j]);
                j++;
            }

            if (diffLocalLines.length > 0 || diffExternalLines.length > 0) {
                regions.push({
                    startLine,
                    endLine: Math.max(startLine + diffLocalLines.length, startLine + diffExternalLines.length),
                    localLines: diffLocalLines,
                    externalLines: diffExternalLines,
                });
            }
        }

        return regions;
    }

    /**
     * Count approximate number of lines changed
     */
    private countLinesChanged(oldContent: string, newContent: string): number {
        const oldLines = oldContent.split('\n');
        const newLines = newContent.split('\n');

        let changed = 0;
        const maxLen = Math.max(oldLines.length, newLines.length);

        for (let i = 0; i < maxLen; i++) {
            if (oldLines[i] !== newLines[i]) {
                changed++;
            }
        }

        return changed;
    }

    /**
     * Get line ranges that changed between base and modified content.
     * Returns array of [start, end] tuples (0-indexed, inclusive).
     */
    private getChangedLineRanges(base: string, modified: string): Array<[number, number]> {
        const baseLines = base.split('\n');
        const modLines = modified.split('\n');
        const ranges: Array<[number, number]> = [];

        let i = 0;
        while (i < baseLines.length || i < modLines.length) {
            // Skip identical lines
            while (i < baseLines.length && i < modLines.length && baseLines[i] === modLines[i]) {
                i++;
            }

            if (i >= baseLines.length && i >= modLines.length) break;

            // Found a difference - find the extent
            const start = i;
            while (i < baseLines.length || i < modLines.length) {
                if (i < baseLines.length && i < modLines.length && baseLines[i] === modLines[i]) {
                    break;
                }
                i++;
            }
            ranges.push([start, i - 1]);
        }

        return ranges;
    }

    /**
     * Check if any two ranges overlap.
     */
    private rangesOverlap(ranges1: Array<[number, number]>, ranges2: Array<[number, number]>): boolean {
        for (const [s1, e1] of ranges1) {
            for (const [s2, e2] of ranges2) {
                // Ranges overlap if one starts before the other ends
                if (s1 <= e2 && s2 <= e1) {
                    return true;
                }
            }
        }
        return false;
    }

    /**
     * Attempt a simple 3-way merge.
     * Works when local and external changes don't overlap.
     *
     * Strategy: Start with external content, then apply local changes
     * that aren't overwritten by external changes.
     */
    private attemptThreeWayMerge(base: string, local: string, external: string): string | null {
        try {
            const baseLines = base.split('\n');
            const localLines = local.split('\n');
            const externalLines = external.split('\n');

            // Get what changed locally vs base
            const localChanges = this.getLineChanges(baseLines, localLines);
            // Get what changed externally vs base
            const externalChanges = this.getLineChanges(baseLines, externalLines);

            // Start with external content
            const result = [...externalLines];

            // Apply local changes that don't conflict with external changes
            for (const [lineNum, localLine] of localChanges) {
                // Check if external also changed this line
                const externalChangedThis = externalChanges.some(([ln]) => ln === lineNum);
                if (!externalChangedThis) {
                    // Safe to apply local change
                    // But we need to adjust for any line count differences
                    // For simplicity, only merge if line counts are similar
                    if (result.length > lineNum) {
                        result[lineNum] = localLine;
                    }
                }
            }

            // Handle appended lines (local additions at end)
            if (localLines.length > baseLines.length) {
                const appendStart = baseLines.length;
                const localAppended = localLines.slice(appendStart);
                // Check if external also appended
                if (externalLines.length <= baseLines.length) {
                    // External didn't append, safe to add local appendix
                    result.push(...localAppended);
                } else if (externalLines.length === baseLines.length + (externalLines.length - baseLines.length)) {
                    // Both appended - append local after external
                    result.push(...localAppended);
                }
            }

            return result.join('\n');
        } catch {
            return null;
        }
    }

    /**
     * Get map of line number -> new content for changed lines
     */
    private getLineChanges(base: string[], modified: string[]): Array<[number, string]> {
        const changes: Array<[number, string]> = [];
        const minLen = Math.min(base.length, modified.length);

        for (let i = 0; i < minLen; i++) {
            if (base[i] !== modified[i]) {
                changes.push([i, modified[i]]);
            }
        }

        return changes;
    }

    /**
     * Get handler for a file (for debugging/testing)
     */
    getHandler(filePath: string): FileHandlerState | undefined {
        return this.handlers.get(filePath);
    }

    /**
     * Get all registered file paths
     */
    getRegisteredFiles(): string[] {
        return Array.from(this.handlers.keys());
    }

    /**
     * Destroy all handlers
     */
    destroy(): void {
        for (const handler of this.handlers.values()) {
            handler.destroyed = true;
            if (handler.pendingCheck) {
                clearTimeout(handler.pendingCheck);
            }
        }
        this.handlers.clear();
    }
}

// ============================================================================
// Claude Presence Indicator
// ============================================================================

/**
 * Tracks and displays when Claude Code (or other AI) is actively editing files.
 *
 * This creates a visual indicator when:
 * 1. External file changes are detected with source 'claude-code'
 * 2. An AI user joins the collaboration session
 *
 * The indicator auto-dismisses after a timeout when Claude stops editing.
 */
interface ClaudePresenceState {
    /** Files currently being edited by Claude */
    activeFiles: Map<string, {
        startedAt: number;
        lastActivity: number;
        linesChanged: number;
    }>;
    /** DOM element for the indicator */
    indicatorEl: HTMLElement | null;
    /** Timeout for auto-dismissal */
    dismissTimeout: ReturnType<typeof setTimeout> | null;
    /** Whether the indicator is currently visible */
    isVisible: boolean;
}

class ClaudePresenceIndicator {
    private state: ClaudePresenceState = {
        activeFiles: new Map(),
        indicatorEl: null,
        dismissTimeout: null,
        isVisible: false,
    };

    /** How long to show the indicator after last activity (ms) */
    private readonly DISMISS_DELAY = 5000;

    /** Color for Claude's presence (purple/violet to distinguish from humans) */
    private readonly CLAUDE_COLOR = '#8b5cf6';

    constructor() {
        this.createIndicatorElement();
    }

    /**
     * Create the indicator DOM element
     */
    private createIndicatorElement(): void {
        // Check if it already exists
        if (document.getElementById('claude-presence-indicator')) {
            this.state.indicatorEl = document.getElementById('claude-presence-indicator');
            return;
        }

        const indicator = document.createElement('div');
        indicator.id = 'claude-presence-indicator';
        indicator.className = 'claude-presence-indicator';
        indicator.style.cssText = `
            position: fixed;
            bottom: 24px;
            right: 24px;
            background: ${this.CLAUDE_COLOR};
            color: white;
            padding: 8px 16px;
            border-radius: 8px;
            font-size: 13px;
            font-weight: 500;
            display: flex;
            align-items: center;
            gap: 8px;
            box-shadow: 0 4px 12px rgba(139, 92, 246, 0.3);
            z-index: 1000;
            opacity: 0;
            transform: translateY(10px);
            transition: opacity 0.2s ease, transform 0.2s ease;
            pointer-events: none;
        `;

        // Robot icon
        const icon = document.createElement('span');
        icon.textContent = '🤖';
        icon.style.fontSize = '16px';
        indicator.appendChild(icon);

        // Text content
        const text = document.createElement('span');
        text.className = 'claude-presence-text';
        text.textContent = 'Claude is editing...';
        indicator.appendChild(text);

        // Pulsing dot
        const dot = document.createElement('span');
        dot.className = 'claude-presence-dot';
        dot.style.cssText = `
            width: 8px;
            height: 8px;
            background: white;
            border-radius: 50%;
            animation: claude-presence-pulse 1.5s ease-in-out infinite;
        `;
        indicator.appendChild(dot);

        // Add animation keyframes
        if (!document.getElementById('claude-presence-styles')) {
            const style = document.createElement('style');
            style.id = 'claude-presence-styles';
            style.textContent = `
                @keyframes claude-presence-pulse {
                    0%, 100% { opacity: 1; transform: scale(1); }
                    50% { opacity: 0.5; transform: scale(0.8); }
                }
                .claude-presence-indicator.visible {
                    opacity: 1 !important;
                    transform: translateY(0) !important;
                }
            `;
            document.head.appendChild(style);
        }

        document.body.appendChild(indicator);
        this.state.indicatorEl = indicator;
    }

    /**
     * Show the Claude presence indicator
     */
    show(filePath: string, linesChanged: number = 0): void {
        const now = Date.now();

        // Update active files
        const existing = this.state.activeFiles.get(filePath);
        if (existing) {
            existing.lastActivity = now;
            existing.linesChanged += linesChanged;
        } else {
            this.state.activeFiles.set(filePath, {
                startedAt: now,
                lastActivity: now,
                linesChanged,
            });
        }

        // Update indicator text
        this.updateIndicatorText();

        // Show the indicator
        if (!this.state.isVisible && this.state.indicatorEl) {
            this.state.indicatorEl.classList.add('visible');
            this.state.isVisible = true;
        }

        // Reset dismiss timeout
        this.scheduleDismiss();
    }

    /**
     * Update the indicator text based on active files
     */
    private updateIndicatorText(): void {
        if (!this.state.indicatorEl) return;

        const textEl = this.state.indicatorEl.querySelector('.claude-presence-text');
        if (!textEl) return;

        const fileCount = this.state.activeFiles.size;
        if (fileCount === 0) {
            textEl.textContent = 'Claude is editing...';
        } else if (fileCount === 1) {
            const [filePath] = this.state.activeFiles.keys();
            const fileName = filePath.split('/').pop() || filePath;
            textEl.textContent = `Claude is editing ${fileName}`;
        } else {
            textEl.textContent = `Claude is editing ${fileCount} files`;
        }
    }

    /**
     * Schedule auto-dismissal of the indicator
     */
    private scheduleDismiss(): void {
        // Clear existing timeout
        if (this.state.dismissTimeout) {
            clearTimeout(this.state.dismissTimeout);
        }

        // Set new timeout
        this.state.dismissTimeout = setTimeout(() => {
            this.hide();
        }, this.DISMISS_DELAY);
    }

    /**
     * Hide the Claude presence indicator
     */
    hide(): void {
        if (this.state.indicatorEl) {
            this.state.indicatorEl.classList.remove('visible');
        }
        this.state.isVisible = false;
        this.state.activeFiles.clear();

        if (this.state.dismissTimeout) {
            clearTimeout(this.state.dismissTimeout);
            this.state.dismissTimeout = null;
        }
    }

    /**
     * Check if Claude is currently active on any file
     */
    isActive(): boolean {
        return this.state.activeFiles.size > 0;
    }

    /**
     * Check if Claude is active on a specific file
     */
    isActiveOnFile(filePath: string): boolean {
        return this.state.activeFiles.has(filePath);
    }

    /**
     * Destroy the indicator
     */
    destroy(): void {
        this.hide();
        if (this.state.indicatorEl) {
            this.state.indicatorEl.remove();
            this.state.indicatorEl = null;
        }
    }
}

// Module-level Claude presence indicator instance
let claudePresenceIndicator: ClaudePresenceIndicator | null = null;

// ============================================================================
// Conflict Resolution UI
// ============================================================================

/**
 * ConflictResolutionUI
 *
 * Displays a modal when external changes conflict with local edits.
 * Users can:
 * - Accept external changes (lose local edits)
 * - Keep local changes (ignore external)
 * - View a diff to understand what changed
 *
 * This is the UI component for Step 6 of the collaboration feature.
 */
class ConflictResolutionUI {
    private modalEl: HTMLElement | null = null;
    private resolvePromise: ((value: 'accept' | 'reject' | 'merge') => void) | null = null;
    private currentConflict: ConflictInfo | null = null;

    /** Colors matching the design system */
    private readonly COLORS = {
        primary: '#3b82f6',      // Blue for primary actions
        danger: '#ef4444',       // Red for destructive/reject
        success: '#22c55e',      // Green for additions
        warning: '#f59e0b',      // Amber for warnings
        muted: '#6b7280',        // Gray for secondary text
        background: '#1f2937',   // Dark background
        surface: '#374151',      // Slightly lighter surface
        border: '#4b5563',       // Border color
        text: '#f9fafb',         // Light text
        textMuted: '#9ca3af',    // Muted text
        diffAdd: 'rgba(34, 197, 94, 0.2)',    // Green background for additions
        diffRemove: 'rgba(239, 68, 68, 0.2)', // Red background for removals
        claude: '#8b5cf6',       // Claude's purple
    };

    constructor() {
        this.injectStyles();
    }

    /**
     * Inject CSS styles for the conflict resolution modal
     */
    private injectStyles(): void {
        if (document.getElementById('conflict-resolution-styles')) return;

        const style = document.createElement('style');
        style.id = 'conflict-resolution-styles';
        style.textContent = `
            .conflict-modal-overlay {
                position: fixed;
                inset: 0;
                background: rgba(0, 0, 0, 0.6);
                backdrop-filter: blur(4px);
                z-index: 10000;
                display: flex;
                align-items: center;
                justify-content: center;
                opacity: 0;
                transition: opacity 0.2s ease;
            }
            .conflict-modal-overlay.visible {
                opacity: 1;
            }
            .conflict-modal {
                background: ${this.COLORS.background};
                border: 1px solid ${this.COLORS.border};
                border-radius: 12px;
                width: 90%;
                max-width: 600px;
                max-height: 80vh;
                display: flex;
                flex-direction: column;
                box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.5);
                transform: scale(0.95) translateY(10px);
                transition: transform 0.2s ease;
            }
            .conflict-modal-overlay.visible .conflict-modal {
                transform: scale(1) translateY(0);
            }
            .conflict-modal-header {
                display: flex;
                align-items: center;
                gap: 12px;
                padding: 16px 20px;
                border-bottom: 1px solid ${this.COLORS.border};
            }
            .conflict-modal-icon {
                font-size: 24px;
            }
            .conflict-modal-title {
                flex: 1;
            }
            .conflict-modal-title h2 {
                margin: 0;
                font-size: 16px;
                font-weight: 600;
                color: ${this.COLORS.text};
            }
            .conflict-modal-title p {
                margin: 4px 0 0;
                font-size: 13px;
                color: ${this.COLORS.textMuted};
            }
            .conflict-modal-body {
                padding: 16px 20px;
                overflow-y: auto;
                flex: 1;
            }
            .conflict-summary {
                display: flex;
                gap: 16px;
                margin-bottom: 16px;
            }
            .conflict-stat {
                display: flex;
                align-items: center;
                gap: 6px;
                font-size: 13px;
                color: ${this.COLORS.textMuted};
            }
            .conflict-stat-value {
                color: ${this.COLORS.text};
                font-weight: 500;
            }
            .conflict-diff-toggle {
                display: flex;
                align-items: center;
                gap: 8px;
                padding: 8px 12px;
                background: ${this.COLORS.surface};
                border: 1px solid ${this.COLORS.border};
                border-radius: 6px;
                color: ${this.COLORS.text};
                font-size: 13px;
                cursor: pointer;
                margin-bottom: 12px;
                transition: background 0.15s ease;
            }
            .conflict-diff-toggle:hover {
                background: ${this.COLORS.border};
            }
            .conflict-diff-toggle .arrow {
                transition: transform 0.2s ease;
            }
            .conflict-diff-toggle.expanded .arrow {
                transform: rotate(90deg);
            }
            .conflict-diff-container {
                display: none;
                border: 1px solid ${this.COLORS.border};
                border-radius: 6px;
                overflow: hidden;
                margin-bottom: 16px;
            }
            .conflict-diff-container.visible {
                display: block;
            }
            .conflict-diff-header {
                display: flex;
                background: ${this.COLORS.surface};
                border-bottom: 1px solid ${this.COLORS.border};
                font-size: 12px;
                font-weight: 500;
            }
            .conflict-diff-header > div {
                flex: 1;
                padding: 8px 12px;
                color: ${this.COLORS.textMuted};
            }
            .conflict-diff-header > div:first-child {
                border-right: 1px solid ${this.COLORS.border};
            }
            .conflict-diff-content {
                display: flex;
                font-family: 'SF Mono', 'Menlo', 'Monaco', monospace;
                font-size: 12px;
                line-height: 1.5;
                max-height: 300px;
                overflow-y: auto;
            }
            .conflict-diff-side {
                flex: 1;
                padding: 8px 0;
                overflow-x: auto;
            }
            .conflict-diff-side:first-child {
                border-right: 1px solid ${this.COLORS.border};
            }
            .conflict-diff-line {
                display: flex;
                padding: 0 12px;
                min-height: 20px;
            }
            .conflict-diff-line.removed {
                background: ${this.COLORS.diffRemove};
            }
            .conflict-diff-line.added {
                background: ${this.COLORS.diffAdd};
            }
            .conflict-diff-line-number {
                width: 32px;
                color: ${this.COLORS.muted};
                text-align: right;
                padding-right: 12px;
                user-select: none;
                flex-shrink: 0;
            }
            .conflict-diff-line-content {
                flex: 1;
                white-space: pre;
                color: ${this.COLORS.text};
            }
            .conflict-modal-footer {
                display: flex;
                gap: 12px;
                padding: 16px 20px;
                border-top: 1px solid ${this.COLORS.border};
                justify-content: flex-end;
            }
            .conflict-btn {
                padding: 8px 16px;
                border-radius: 6px;
                font-size: 13px;
                font-weight: 500;
                cursor: pointer;
                transition: all 0.15s ease;
                border: 1px solid transparent;
            }
            .conflict-btn-secondary {
                background: ${this.COLORS.surface};
                border-color: ${this.COLORS.border};
                color: ${this.COLORS.text};
            }
            .conflict-btn-secondary:hover {
                background: ${this.COLORS.border};
            }
            .conflict-btn-danger {
                background: transparent;
                border-color: ${this.COLORS.danger};
                color: ${this.COLORS.danger};
            }
            .conflict-btn-danger:hover {
                background: ${this.COLORS.danger};
                color: white;
            }
            .conflict-btn-primary {
                background: ${this.COLORS.primary};
                color: white;
            }
            .conflict-btn-primary:hover {
                background: #2563eb;
            }
            .conflict-btn-claude {
                background: ${this.COLORS.claude};
                color: white;
            }
            .conflict-btn-claude:hover {
                background: #7c3aed;
            }
        `;
        document.head.appendChild(style);
    }

    /**
     * Show the conflict resolution modal
     * Returns a promise that resolves with the user's decision
     */
    show(conflictInfo: ConflictInfo): Promise<'accept' | 'reject' | 'merge'> {
        return new Promise((resolve) => {
            this.resolvePromise = resolve;
            this.currentConflict = conflictInfo;
            this.createModal(conflictInfo);
        });
    }

    /**
     * Create and display the modal
     */
    private createModal(info: ConflictInfo): void {
        // Remove any existing modal
        this.destroy();

        const filename = info.filePath.split('/').pop() || info.filePath;
        const sourceLabel = this.getSourceLabel(info.source);
        const sourceIcon = this.getSourceIcon(info.source);

        // Create overlay
        const overlay = document.createElement('div');
        overlay.className = 'conflict-modal-overlay';
        overlay.onclick = (e) => {
            if (e.target === overlay) {
                // Click outside modal - default to reject (keep local)
                this.handleDecision('reject');
            }
        };

        // Create modal
        const modal = document.createElement('div');
        modal.className = 'conflict-modal';

        // Header
        modal.innerHTML = `
            <div class="conflict-modal-header">
                <span class="conflict-modal-icon">${sourceIcon}</span>
                <div class="conflict-modal-title">
                    <h2>Changes from ${sourceLabel}</h2>
                    <p>${filename} was modified while you had unsaved changes</p>
                </div>
            </div>
            <div class="conflict-modal-body">
                <div class="conflict-summary">
                    <div class="conflict-stat">
                        <span>Lines changed:</span>
                        <span class="conflict-stat-value">${info.linesChanged}</span>
                    </div>
                    <div class="conflict-stat">
                        <span>Regions:</span>
                        <span class="conflict-stat-value">${info.diffRegions.length}</span>
                    </div>
                </div>
                <button class="conflict-diff-toggle" id="conflict-diff-toggle">
                    <span class="arrow">▶</span>
                    <span>View differences</span>
                </button>
                <div class="conflict-diff-container" id="conflict-diff-container">
                    ${this.renderDiff(info)}
                </div>
                <p style="font-size: 13px; color: ${this.COLORS.textMuted}; margin: 0;">
                    Choose how to handle this conflict:
                </p>
            </div>
            <div class="conflict-modal-footer">
                <span style="font-size: 11px; color: ${this.COLORS.muted}; margin-right: auto;">
                    <kbd style="padding: 2px 6px; background: ${this.COLORS.surface}; border-radius: 3px; font-family: inherit;">Esc</kbd> Keep ·
                    <kbd style="padding: 2px 6px; background: ${this.COLORS.surface}; border-radius: 3px; font-family: inherit;">Enter</kbd> Accept
                </span>
                <button class="conflict-btn conflict-btn-secondary" id="conflict-btn-reject">
                    Keep my changes
                </button>
                <button class="conflict-btn ${info.source === 'claude-code' ? 'conflict-btn-claude' : 'conflict-btn-primary'}" id="conflict-btn-accept">
                    ${info.source === 'claude-code' ? "Accept Claude's changes" : 'Accept external changes'}
                </button>
            </div>
        `;

        overlay.appendChild(modal);
        document.body.appendChild(overlay);
        this.modalEl = overlay;

        // Wire up event handlers
        const diffToggle = modal.querySelector('#conflict-diff-toggle') as HTMLElement;
        const diffContainer = modal.querySelector('#conflict-diff-container') as HTMLElement;
        diffToggle?.addEventListener('click', () => {
            diffToggle.classList.toggle('expanded');
            diffContainer.classList.toggle('visible');
        });

        const acceptBtn = modal.querySelector('#conflict-btn-accept') as HTMLElement;
        const rejectBtn = modal.querySelector('#conflict-btn-reject') as HTMLElement;

        acceptBtn?.addEventListener('click', () => this.handleDecision('accept'));
        rejectBtn?.addEventListener('click', () => this.handleDecision('reject'));

        // Handle keyboard shortcuts
        const handleKeydown = (e: KeyboardEvent) => {
            if (e.key === 'Escape') {
                this.handleDecision('reject');
            } else if (e.key === 'Enter' && !e.shiftKey) {
                this.handleDecision('accept');
            }
        };
        document.addEventListener('keydown', handleKeydown);
        (overlay as any)._keydownHandler = handleKeydown;

        // Show with animation
        requestAnimationFrame(() => {
            overlay.classList.add('visible');
        });
    }

    /**
     * Render the diff view
     */
    private renderDiff(info: ConflictInfo): string {
        if (info.diffRegions.length === 0) {
            return `
                <div class="conflict-diff-content" style="padding: 16px; color: ${this.COLORS.textMuted};">
                    No visible differences (possibly whitespace only)
                </div>
            `;
        }

        // Build side-by-side diff
        let localHtml = '';
        let externalHtml = '';

        for (const region of info.diffRegions) {
            const maxLines = Math.max(region.localLines.length, region.externalLines.length);

            for (let i = 0; i < maxLines; i++) {
                const lineNum = region.startLine + i + 1;
                const localLine = region.localLines[i];
                const externalLine = region.externalLines[i];

                if (localLine !== undefined) {
                    localHtml += `
                        <div class="conflict-diff-line removed">
                            <span class="conflict-diff-line-number">${lineNum}</span>
                            <span class="conflict-diff-line-content">${this.escapeHtml(localLine)}</span>
                        </div>
                    `;
                } else {
                    localHtml += `
                        <div class="conflict-diff-line">
                            <span class="conflict-diff-line-number"></span>
                            <span class="conflict-diff-line-content"></span>
                        </div>
                    `;
                }

                if (externalLine !== undefined) {
                    externalHtml += `
                        <div class="conflict-diff-line added">
                            <span class="conflict-diff-line-number">${lineNum}</span>
                            <span class="conflict-diff-line-content">${this.escapeHtml(externalLine)}</span>
                        </div>
                    `;
                } else {
                    externalHtml += `
                        <div class="conflict-diff-line">
                            <span class="conflict-diff-line-number"></span>
                            <span class="conflict-diff-line-content"></span>
                        </div>
                    `;
                }
            }
        }

        return `
            <div class="conflict-diff-header">
                <div>Your changes (will be lost)</div>
                <div>Incoming changes</div>
            </div>
            <div class="conflict-diff-content">
                <div class="conflict-diff-side">${localHtml}</div>
                <div class="conflict-diff-side">${externalHtml}</div>
            </div>
        `;
    }

    /**
     * Handle user decision
     */
    private handleDecision(decision: 'accept' | 'reject' | 'merge'): void {
        if (this.resolvePromise) {
            this.resolvePromise(decision);
            this.resolvePromise = null;
        }
        this.destroy();
    }

    /**
     * Get a human-readable label for the source
     */
    private getSourceLabel(source: ExternalChangeInfo['source']): string {
        switch (source) {
            case 'claude-code': return 'Claude';
            case 'git': return 'Git';
            case 'external': return 'External Editor';
            default: return 'Unknown Source';
        }
    }

    /**
     * Get an icon for the source
     */
    private getSourceIcon(source: ExternalChangeInfo['source']): string {
        switch (source) {
            case 'claude-code': return '🤖';
            case 'git': return '📦';
            case 'external': return '📝';
            default: return '❓';
        }
    }

    /**
     * Escape HTML special characters
     */
    private escapeHtml(text: string): string {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }

    /**
     * Destroy the modal
     */
    destroy(): void {
        if (this.modalEl) {
            const handler = (this.modalEl as any)._keydownHandler;
            if (handler) {
                document.removeEventListener('keydown', handler);
            }
            this.modalEl.remove();
            this.modalEl = null;
        }
        this.currentConflict = null;
    }
}

// Module-level conflict resolution UI instance
let conflictResolutionUI: ConflictResolutionUI | null = null;

// ============================================================================
// Types - Mount Options
// ============================================================================

export interface MountOptions {
    /** Default interface mode: 'compact' for Study, 'developer' for Codes */
    defaultMode?: 'compact' | 'developer';
}

// ============================================================================
// Mount Function - Entry Point
// ============================================================================

export async function mount(svc: Services, options: MountOptions = {}): Promise<void> {
    const defaultMode = options.defaultMode ?? 'developer';
    const modeName = defaultMode === 'compact' ? 'Study' : 'Codes';
    console.log(`[Atelier] Mounting in ${modeName} mode (${defaultMode})...`);
    services = svc;

    // Set the default interface mode before initializing UI
    SessionState.setInterfaceMode(defaultMode);

    // Inject AppState into SessionState for unified state management
    // This makes AppState the single source of truth for file state
    SessionState.setAppState(appState);

    // Check for noCollab mode
    noCollab = new URLSearchParams(window.location.search).has('noCollab');

    // Initialize DOM references
    initDOMReferences();

    // Initialize clients
    initClients();

    // Initialize editor (direct @mrmd/editor usage)
    initEditor();

    // Initialize UI modules (sidebar, tabs, file browser, etc.)
    await initUIModules();

    // Initialize interface mode manager
    // This handles compact/developer mode switching and creates the compact UI
    await initInterfaceMode();

    // Initialize collaboration
    await initCollaboration();

    // Set up event handlers
    setupEventHandlers();

    // Set up keyboard shortcuts
    setupKeyboardShortcuts();

    // Initialize variables panel
    initVariablesPanel();

    // Start file watching
    initFileWatching();

    // Load initial state
    await loadInitialState();

    console.log(`[Atelier] ${modeName} mode ready`);
}

// ============================================================================
// Initialization Functions
// ============================================================================

function initDOMReferences(): void {
    container = document.getElementById('editor-container')!;
    rawTextarea = document.getElementById('raw-markdown') as HTMLTextAreaElement;
    cursorPosEl = document.getElementById('cursor-pos')!;
    execStatusEl = document.getElementById('exec-status')!;

    if (!container) {
        throw new Error('[Codes] Missing #editor-container element');
    }
}

function initClients(): void {
    // IPython client for code completion/inspection
    ipython = new IPythonClient({ apiBase: '' });

    // AI client
    aiClient = new AiClient();

    // Check AI availability
    aiClient.isAvailable().then((available: boolean) => {
        if (available) {
            console.log('[AI] Server available');
        } else {
            console.log('[AI] Server not available - AI features disabled');
        }
    });
}

function initEditor(): void {
    // Create IPython executor using the SAME client as completion/variables
    // This ensures session state is always in sync
    ipythonExecutor = new IPythonExecutor({ client: ipython });

    // Image URL resolver
    const resolveImageUrl = createImageUrlResolver(() => documentBasePath);

    // Create editor directly from @mrmd/editor
    editor = createEditor({
        parent: container,
        doc: '',
        executor: ipythonExecutor,
        theme: 'zen',
        resolveImageUrl,

        onChange: (doc: string) => {
            if (!silentUpdate) {
                rawTextarea.value = doc;
                const currentPath = appState.currentFilePath;
                if (currentPath) {
                    appState.updateFileContent(currentPath, doc, true);
                    scheduleAutosave();
                    updateFileIndicator();
                }
            }
        },

        onCursorChange: (info: CursorInfo) => {
            cursorPosEl.textContent = String(info.pos);
        },

        onComplete: async (code: string, cursorPos: number, lang: string): Promise<CompletionResult | null> => {
            if (lang !== 'python') return null;
            return await ipython.complete(code, cursorPos);
        },

        onInspect: async (code: string, cursorPos: number, lang: string): Promise<InspectionResult | null> => {
            if (lang !== 'python') return null;
            return await ipython.inspect(code, cursorPos);
        },

        onHover: async (word: string, lang: string): Promise<HoverResult | null> => {
            if (lang !== 'python') return null;
            return await ipython.hoverInspect(word);
        },
    });

    // Initialize with empty content
    setContent('', true);
    rawTextarea.value = '';

    // Set up file callbacks for background execution support
    // This allows code execution to update files even when user switches tabs
    if (editor.tracker) {
        editor.tracker.setFileCallbacks({
            getCurrentFilePath: () => appState.currentFilePath,
            getFileContent: (path: string) => appState.openFiles.get(path)?.content ?? null,
            updateFileContent: (path: string, content: string) => {
                appState.updateFileContent(path, content, true);
            },
        });

        // Set up CRDT callbacks for collaborative execution output
        // This makes streaming output visible to other collaborators via the editor's
        // applyExternalChange method, which computes minimal diffs for CRDT compatibility.
        // When Yjs is connected, changes propagate to all users viewing the same file.
        // In standalone mode, this falls back to direct editor updates (still works).
        editor.tracker.setDocumentCallbacks({
            applyChange: (newContent: string, origin: string) => {
                // Route through editor's applyExternalChange for CRDT compatibility
                // This computes minimal diff and adds origin annotation
                editor.applyExternalChange(newContent, origin);
            },
            getContent: () => editor.getDoc(),
        });
    }

    // Initialize selection toolbar
    initSelectionToolbar(container, {
        getContent: () => editor.getDoc(),
        getSelectionInfo: () => getSelectionInfo(),
        replaceTextRange: (text: string, start: number, end: number) => {
            editor.view.dispatch({
                changes: { from: start, to: end, insert: text }
            });
            return true;
        },
        insertTextAtCursor: (text: string) => {
            const pos = editor.getCursor();
            editor.view.dispatch({
                changes: { from: pos, insert: text }
            });
            return true;
        },
    });

    // Sync raw textarea to editor
    rawTextarea.addEventListener('input', () => {
        setContent(rawTextarea.value, true);
        const currentPath = appState.currentFilePath;
        if (currentPath) {
            appState.markFileModified(currentPath);
            scheduleAutosave();
            updateFileIndicator();
        }
    });

    // Focus editor
    editor.focus();

    // Initialize AI Action Handler - bridges AI palette to editor streaming layer
    // AI-human interaction is inherently collaborative - locks ensure clean edits
    aiActionHandler = createAIActionHandler({
        getView: () => editor?.view ?? null,
        getLockManager: () => editor?.lockManager ?? null,
        getUser: () => ({
            userId: 'local-user',
            userName: 'You',
            userColor: '#3b82f6',
        }),
        onSuccess: (actionId, content) => {
            console.log(`[AI] Successfully applied '${actionId}': ${content.length} chars`);
        },
        onError: (actionId, error) => {
            console.error(`[AI] Failed to apply '${actionId}':`, error);
            notificationManager?.addLocalNotification(
                'AI Action Failed',
                error.message,
                'error'
            );
        },
    });
}

// ============================================================================
// Editor Helpers
// ============================================================================

function setContent(markdown: string, silent = false): void {
    if (silent) {
        silentUpdate = true;
        try {
            editor.setDoc(markdown);
        } finally {
            silentUpdate = false;
        }
    } else {
        editor.setDoc(markdown);
    }
}

function getContent(): string {
    return editor.getDoc();
}

function setDocumentBasePath(path: string): void {
    documentBasePath = path;
}

function getSelectionInfo(): { cursor: number; hasSelection: boolean; selectedText: string } {
    const state = editor.view.state;
    const selection = state.selection.main;
    return {
        cursor: selection.head,
        hasSelection: !selection.empty,
        selectedText: state.sliceDoc(selection.from, selection.to),
    };
}

// ============================================================================
// UI Module Initialization
// ============================================================================

async function initUIModules(): Promise<void> {
    // File Tabs
    const fileTabsContainer = document.getElementById('file-tabs-container');
    if (fileTabsContainer) {
        fileTabs = createFileTabs({
            onTabSelect: handleTabSelect,
            onBeforeClose: handleBeforeTabClose,
            onTabClose: handleTabClose,
        });
        fileTabsContainer.appendChild(fileTabs.element);
    }

    // Notification Manager
    const notificationBadge = document.getElementById('notification-badge');
    if (notificationBadge) {
        notificationManager = createNotificationManager({
            badgeEl: notificationBadge,
        });
    }

    // File Browser
    const fileBrowserContainer = document.getElementById('fileBrowserContainer');
    if (fileBrowserContainer) {
        fileBrowser = createFileBrowser(fileBrowserContainer, {
            initialPath: browserRoot,
            mode: 'browse',
            showFilter: true,
            showProjectButton: true,
            onSelect: (path: string) => openFile(path),
            onNavigate: (path: string) => {
                browserRoot = path;
                localStorage.setItem('mrmd_browser_root', browserRoot);
            },
            onOpenProject: (path: string) => {
                SessionState.openProject(path);
            },
        });
    }

    // Terminal Tabs
    const terminalContainer = document.getElementById('sidebar-terminal');
    if (terminalContainer) {
        terminalTabs = createTerminalTabs({
            container: terminalContainer,
        });
    }

    // AI Palette
    aiPalette = createAiPalette({
        aiClient: aiClient,
        onRunningChange: (count: number) => {
            updateRunningBadge(count);
        },
        onActionStart: handleAiActionStart,
        onChunk: handleAiChunk,
        onAction: handleAiAction,
        onError: (err: Error, actionId: string) => {
            console.error('[AI] Error:', actionId, err);
        },
        getContext: getAiContext,
    });

    aiPalette.attachToEditor({
        container: container,
        getCursorScreenPosition: () => {
            const sel = window.getSelection();
            if (sel && sel.rangeCount > 0) {
                const range = sel.getRangeAt(0);
                const rect = range.getBoundingClientRect();
                return { x: rect.left, y: rect.top };
            }
            return null;
        },
    });

    // History Panel
    const historyContainer = document.getElementById('history-panel');
    if (historyContainer) {
        historyPanel = new HistoryPanel(historyContainer, {
            onRestore: async (versionId: string) => {
                console.log('[History] Restoring version:', versionId);
            },
        });
    }

    // Process Sidebar
    const processContainer = document.getElementById('processes-panel');
    if (processContainer) {
        createProcessSidebar({
            container: processContainer,
        });
    }

    // Recent Projects Panel
    const projectsPanelContainer = document.getElementById('projects-panel');
    if (projectsPanelContainer) {
        const projectsPanelEl = createRecentProjectsPanel({
            onProjectOpen: (path: string) => openProject(path),
        });
        projectsPanelContainer.appendChild(projectsPanelEl);
    }

    // Sidebar tabs
    initSidebarTabs();

    // Sidebar resizer
    initSidebarResizer();

    // Theme picker
    initThemePicker();

    // Mode toggle (compact mode) - button handler only
    // Actual mode management is handled by InterfaceManager
    initModeToggle();
}

// ============================================================================
// Interface Mode Management
// ============================================================================

/**
 * Initialize the interface mode manager.
 *
 * The Codes app supports two interface modes:
 * - Compact: Document-first with floating toolbar (like Study mode)
 * - Developer: Full IDE with sidebar, tabs, terminal
 *
 * The InterfaceManager owns this lifecycle and coordinates all mode-related UI.
 */
async function initInterfaceMode(): Promise<void> {
    const mainContainer = document.querySelector('.container') as HTMLElement;
    const editorPane = document.querySelector('.editor-pane') as HTMLElement;

    if (!mainContainer || !editorPane) {
        console.error('[Codes] Cannot initialize interface mode: missing container elements');
        return;
    }

    interfaceManager = await createInterfaceManager({
        container: mainContainer,
        editorPane: editorPane,
        editor: editor,
        getEditor: () => editor,
        fileBrowser: fileBrowser,
    });

    // Log initial mode for debugging
    console.log(`[Codes] Interface mode: ${interfaceManager.getMode()}`);
}

// ============================================================================
// Collaboration
// ============================================================================

async function initCollaboration(): Promise<void> {
    if (noCollab) {
        console.log('[Collab] Disabled via ?noCollab');
        return;
    }

    const collab = services.collaboration;

    collab.onConnected((info) => {
        console.log('[Collab] Connected:', info.session_id);
        stopPollingFallback();

        // Watch all currently open files
        const openPaths = Array.from(appState.openFiles.keys());
        console.log('[Collab] Watching', openPaths.length, 'open files:', openPaths);
        for (const path of openPaths) {
            console.log('[Collab] Sending watch request for:', path);
            collab.watchFile(path);
        }

        // Catch-up: Check for any changes that occurred while disconnected
        // This handles the case where the connection was briefly lost
        catchUpMissedChanges();
    });

    collab.onDisconnected(() => {
        console.log('[Collab] Disconnected');
        startPollingFallback();
    });

    // Real-time file change events from WebSocket (primary mechanism)
    // These events come from the file watcher on the backend via watchdog
    collab.onFileChanged(async (payload) => {
        const { file_path, event_type, mtime, content } = payload;

        // Detect source based on heuristics
        const source = detectExternalChangeSource(file_path);

        console.log('[Collab] File changed via WebSocket:', file_path, {
            event_type,
            mtime,
            source,
            hasContent: content !== null && content !== undefined,
        });

        // Handle the external change with source info
        // IMPORTANT: Pass the content from the WebSocket event if available.
        // The backend captures content immediately when the change is detected,
        // before any autosave can overwrite it.
        await handleExternalFileChange(file_path, source, content);
    });

    collab.onFileSaved((payload) => {
        console.log('[Collab] File saved by:', payload.user_name);
    });

    // Log watch acknowledgments from backend
    collab.onWatchFileAck((payload) => {
        console.log('[Collab] Watch file acknowledged:', payload.file_path, {
            mtime: payload.mtime,
            error: payload.error,
        });
    });

    // Track presence for AI user detection
    // When an AI user joins, we can better attribute file changes to Claude
    collab.onPresence((payload) => {
        // Check all users in the presence list for AI users
        for (const user of payload.users) {
            if (user.user_type === 'ai') {
                trackAIUserJoin(user.session_id, user.user_name, payload.file_path);
            }
        }
    });

    collab.onUserJoined((payload) => {
        // Check if the joining user is an AI
        const user = payload.user;
        if (user.user_type === 'ai') {
            trackAIUserJoin(user.session_id, user.user_name, payload.file_path);

            // Show Claude presence indicator
            if (claudePresenceIndicator) {
                claudePresenceIndicator.show(payload.file_path || '', 0);
            }

            console.log(`[Collab] AI user ${user.user_name} joined file ${payload.file_path}`);
        }
    });

    collab.onUserLeft((payload) => {
        // Track AI user leaving
        trackAIUserLeave(payload.session_id);
    });

    const project = appState.project;
    if (project) {
        try {
            await collab.connect({
                projectRoot: project.path,
                userName: 'user',
                userType: 'human',
            });
        } catch (err) {
            console.warn('[Collab] Connection failed:', err);
            startPollingFallback();
        }
    }
}

// ============================================================================
// Event Handlers
// ============================================================================

function setupEventHandlers(): void {
    SessionState.on('file-modified', (path: string) => {
        fileTabs?.updateTabModified(path, true);
    });

    SessionState.on('file-saved', (path: string) => {
        fileTabs?.updateTabModified(path, false);
    });

    // Autosave pause/resume for bulk operations (e.g., Run All Cells)
    let resumeAutosave: (() => void) | null = null;
    SessionState.on('autosave-pause', () => {
        resumeAutosave = pauseAutosave();
    });
    SessionState.on('autosave-resume', () => {
        if (resumeAutosave) {
            resumeAutosave();
            resumeAutosave = null;
        }
    });

    // Save immediately (used after each block during Run All)
    SessionState.on('save-now', async () => {
        await saveCurrentFileNow();
    });

    SessionState.on('project-opened', handleProjectOpened);
    SessionState.on('project-created', handleProjectCreated);

    // Kernel status indicators
    SessionState.on('kernel-initializing', ({ message }: { message?: string }) => {
        execStatusEl.textContent = message || 'initializing...';
        execStatusEl.classList.add('kernel-switching');
    });

    SessionState.on('kernel-ready', () => {
        execStatusEl.textContent = 'ready';
        execStatusEl.classList.remove('kernel-switching');
    });

    SessionState.on('kernel-error', ({ error }: { error: string }) => {
        execStatusEl.textContent = 'kernel error';
        execStatusEl.classList.remove('kernel-switching');
        showNotification('Kernel Error', error, 'error');
    });

    // Home screen event handlers (with error recovery)
    // Track pending file switch to prevent duplicate handling
    let pendingFileSwitch: string | null = null;

    SessionState.on('file-switch-requested', async ({ path }: { path: string }) => {
        console.log('[Codes] File switch requested:', path);

        // Prevent duplicate requests for same file
        if (pendingFileSwitch === path) {
            console.log('[Codes] Ignoring duplicate file switch request:', path);
            return;
        }
        pendingFileSwitch = path;

        HomeScreen.hide();
        try {
            await openFile(path);
            editor?.focus();
        } catch (err) {
            console.error('[Codes] Failed to open file:', err);
            showNotification('Error', `Failed to open file: ${err}`, 'error');
            HomeScreen.show(); // Re-show home on failure
        } finally {
            // Clear pending after a short delay to allow rapid different-file clicks
            setTimeout(() => {
                if (pendingFileSwitch === path) {
                    pendingFileSwitch = null;
                }
            }, 100);
        }
    });

    SessionState.on('new-notebook-requested', async ({ projectPath, initialContent }: { projectPath?: string; initialContent?: string }) => {
        console.log('[Codes] New notebook requested:', projectPath);
        HomeScreen.hide();
        try {
            await createNewNotebook(projectPath, initialContent);
        } catch (err) {
            console.error('[Codes] Failed to create notebook:', err);
            showNotification('Error', `Failed to create notebook: ${err}`, 'error');
            HomeScreen.show();
        }
    });

    SessionState.on('project-open-requested', async ({ path }: { path: string }) => {
        console.log('[Codes] Project open requested:', path);
        HomeScreen.hide();
        try {
            await openProject(path);
        } catch (err) {
            console.error('[Codes] Failed to open project:', err);
            showNotification('Error', `Failed to open project: ${err}`, 'error');
            HomeScreen.show();
        }
    });

    SessionState.on('quick-capture-requested', async () => {
        console.log('[Codes] Quick capture requested');
        HomeScreen.hide();
        try {
            await createNewNotebook();
        } catch (err) {
            console.error('[Codes] Failed to create notebook:', err);
            showNotification('Error', `Failed to create notebook: ${err}`, 'error');
            HomeScreen.show();
        }
    });

    window.addEventListener('focus', () => {
        if (!services.collaboration.isConnected) {
            setTimeout(checkFileChanges, 100);
        }
    });

    window.addEventListener('beforeunload', () => {
        const currentPath = appState.currentFilePath;
        if (currentPath) {
            appState.updateFileScrollTop(currentPath, container.scrollTop);
        }
    });
}

function setupKeyboardShortcuts(): void {
    // Initialize editor keybindings (code execution: Ctrl+Enter, Shift+Enter, etc.)
    // Use a getter function so keybindings always have the current editor reference
    initEditorKeybindings({ getEditor: () => editor, statusEl: execStatusEl });
}

function initVariablesPanel(): void {
    const variablesPanelContainer = document.getElementById('variables-panel');
    if (!variablesPanelContainer) {
        console.warn('[Codes] Variables panel container not found');
        return;
    }

    // Clear existing content and mount the new panel
    variablesPanelContainer.innerHTML = '';
    const panelEl = VariablesPanel.createVariablesPanel({
        ipython,
    });
    variablesPanelContainer.appendChild(panelEl);

    // Also refresh when kernel becomes ready
    SessionState.on('kernel-ready', () => {
        console.log('[Codes] Kernel ready - refreshing variables panel');
        VariablesPanel.refresh();
    });

    // Backup: Also listen for execution complete directly
    // This ensures variables refresh even if the panel's listener isn't working
    document.addEventListener('mrmd:execution-complete', (event: Event) => {
        console.log('[Codes] Execution complete event - refreshing variables panel');
        VariablesPanel.refresh();
        // Update file tabs running indicators
        updateTabRunningStates();
    });

    // Listen for execution start to update tab indicators
    document.addEventListener('mrmd:execution-start', () => {
        updateTabRunningStates();
    });
}

/**
 * Update file tabs to show running execution indicators
 */
function updateTabRunningStates(): void {
    if (!fileTabs || !editor.tracker) return;

    const runningFiles = editor.tracker.getRunningFiles();
    fileTabs.updateAllRunningStates(runningFiles);
}

// ============================================================================
// File Operations
// ============================================================================

async function openFile(path: string, options: { background?: boolean; cachedContent?: string; cachedMtime?: number } = {}): Promise<void> {
    // Increment load ID to track this specific load request
    const loadId = ++currentFileLoadId;
    console.log('[Codes] Opening file:', path, options.cachedContent ? '(from cache)' : '', `(loadId: ${loadId})`);

    try {
        // Use cached content if available (from project pool), otherwise fetch
        let file: { content: string; mtime?: number };
        if (options.cachedContent !== undefined) {
            file = { content: options.cachedContent, mtime: options.cachedMtime };
            console.log('[Codes] Using cached content for:', path);
        } else {
            file = await services.documents.openFile(path);
        }

        // Check if a newer load was started while we were fetching
        if (loadId !== currentFileLoadId && !options.background) {
            console.log('[Codes] Skipping stale file load:', path, `(loadId: ${loadId}, current: ${currentFileLoadId})`);
            return;
        }

        appState.openFile(path, file.content, {
            mtime: file.mtime ?? null,
            modified: false,
        });

        // Register with external change handler manager
        // This tracks lastKnownContent for conflict detection
        externalChangeManager?.registerFile(path, file.content);

        // Watch for external changes to this file
        if (services.collaboration.isConnected) {
            services.collaboration.watchFile(path);
        }

        const filename = path.split('/').pop() || path;
        fileTabs?.addTab(path, filename, false);

        if (!options.background) {
            // Double-check we're still the current load before updating editor
            if (loadId !== currentFileLoadId) {
                console.log('[Codes] Skipping stale editor update:', path);
                return;
            }

            appState.setCurrentFile(path);
            SessionState.setActiveFile(path);  // Sync to SessionState for Open Files panel
            fileTabs?.setActiveTab(path);
            editor.setFilePath(path);  // Set file path for execution queue

            setContent(file.content, true);
            rawTextarea.value = file.content;

            document.title = `${filename} - MRMD`;
            updateFileIndicator();

            if (path.endsWith('.md')) {
                const session = await SessionState.getNotebookSession(path);
                // Final check before updating session
                if (loadId === currentFileLoadId) {
                    ipython.setSession(session);
                    SessionState.setCurrentSessionName(session);
                }
            }
        }
    } catch (err) {
        // Only show error if this is still the current load
        if (loadId === currentFileLoadId) {
            console.error('[Codes] Failed to open file:', err);
            showNotification('Error', `Failed to open file: ${err}`, 'error');
        }
    }
}

async function saveFile(): Promise<void> {
    const currentPath = appState.currentFilePath;
    if (!currentPath) return;

    // Use stored content from AppState for consistency
    // (onChange keeps AppState in sync with editor)
    const file = appState.openFiles.get(currentPath);
    const content = file?.content ?? getContent();
    execStatusEl.textContent = 'saving...';

    try {
        await services.documents.saveFile(currentPath, content);
        appState.markFileSaved(currentPath);

        // Update external change manager's lastKnownContent
        externalChangeManager?.markAsSaved(currentPath, content);

        updateFileIndicator();
        execStatusEl.textContent = 'saved';

        if (services.collaboration.isConnected) {
            services.collaboration.notifyFileSaved(currentPath);
        }

        setTimeout(() => {
            if (execStatusEl.textContent === 'saved') {
                execStatusEl.textContent = 'ready';
            }
        }, 1000);
    } catch (err) {
        console.error('[Codes] Save failed:', err);
        execStatusEl.textContent = 'save failed';
        showNotification('Error', `Save failed: ${err}`, 'error');
    }
}

function scheduleAutosave(): void {
    // Don't schedule if paused (e.g., during Run All)
    if (autosavePaused) return;

    // Capture the file path NOW - this is the file we intend to save
    // This prevents race conditions if user switches tabs before timer fires
    const fileToSave = appState.currentFilePath;
    if (!fileToSave || !appState.isModified) return;

    if (autosaveTimer) {
        clearTimeout(autosaveTimer);
    }

    if (Date.now() - lastSaveTime > AUTOSAVE_MAX_INTERVAL) {
        doAutosaveForFile(fileToSave);
        return;
    }

    // Pass the captured path to the timer callback
    autosaveTimer = setTimeout(() => doAutosaveForFile(fileToSave), AUTOSAVE_DELAY);
}

/**
 * Pause autosave during bulk operations (e.g., Run All Cells)
 * Returns a function to resume autosave
 */
function pauseAutosave(): () => void {
    autosavePaused = true;
    if (autosaveTimer) {
        clearTimeout(autosaveTimer);
        autosaveTimer = null;
    }
    console.log('[Autosave] Paused');

    return () => {
        autosavePaused = false;
        console.log('[Autosave] Resumed');
        // Schedule autosave for any pending changes
        scheduleAutosave();
    };
}

/**
 * Save the current file immediately (used during bulk operations)
 * This bypasses the autosave pause flag
 */
async function saveCurrentFileNow(): Promise<void> {
    const filePath = appState.currentFilePath;
    if (!filePath) return;

    const file = appState.openFiles.get(filePath);
    if (!file) return;

    try {
        await services.documents.saveFile(filePath, file.content, { message: 'execution' });
        appState.markFileSaved(filePath);

        // Update external change manager's lastKnownContent
        externalChangeManager?.markAsSaved(filePath, file.content);

        lastSaveTime = Date.now();
        updateFileIndicator();
    } catch (err) {
        console.error('[Save] Failed:', err);
    }
}

async function doAutosaveForFile(filePath: string): Promise<void> {
    // Read from AppState - the source of truth for this file's content
    // NOT from getContent() which only shows what's currently in the editor
    const file = appState.openFiles.get(filePath);
    if (!file?.modified) return;

    console.log('[Autosave] Saving', filePath);

    // Only show status if this file is currently displayed
    const isCurrentFile = appState.currentFilePath === filePath;
    if (isCurrentFile) {
        execStatusEl.textContent = 'autosaving...';
    }

    try {
        // Use the stored content from AppState, not the editor
        await services.documents.saveFile(filePath, file.content, { message: 'autosave' });
        appState.markFileSaved(filePath);

        // Update external change manager's lastKnownContent
        externalChangeManager?.markAsSaved(filePath, file.content);

        lastSaveTime = Date.now();

        // Only update UI if this file is still displayed
        if (appState.currentFilePath === filePath) {
            updateFileIndicator();
            execStatusEl.textContent = 'autosaved';

            setTimeout(() => {
                if (execStatusEl.textContent === 'autosaved') {
                    execStatusEl.textContent = 'ready';
                }
            }, 1000);
        }
    } catch (err) {
        console.error('[Autosave] Failed for', filePath, ':', err);
        if (appState.currentFilePath === filePath) {
            execStatusEl.textContent = 'autosave failed';
        }
    }
}

async function createNewNotebook(projectPath?: string, initialContent?: string): Promise<void> {
    const currentProject = appState.project;
    const scratchPath = SessionState.getScratchPath();
    const basePath = projectPath || currentProject?.path || scratchPath || browserRoot;

    // Generate unique filename
    const timestamp = Date.now();
    const filename = `Untitled-${timestamp}.md`;
    const filePath = `${basePath}/${filename}`;

    // Create initial content
    const content = initialContent || '# Untitled\n\n';

    console.log('[Codes] Creating new notebook:', filePath);

    try {
        // Create the file
        await services.documents.saveFile(filePath, content);

        // Open it
        await openFile(filePath);

        // Add to recent notebooks
        SessionState.addRecentNotebook(filePath, 'Untitled');

        // Focus editor at end of content
        editor?.focus();
    } catch (err) {
        console.error('[Codes] Failed to create notebook:', err);
        showNotification('Error', `Failed to create notebook: ${err}`, 'error');
    }
}

// ============================================================================
// Tab Handlers
// ============================================================================

async function handleTabSelect(path: string): Promise<void> {
    const currentPath = appState.currentFilePath;

    // CRITICAL: Before switching, save the FULL editor state (including undo history)
    if (currentPath && currentPath !== path) {
        // Cancel any pending autosave for the old file
        if (autosaveTimer) {
            clearTimeout(autosaveTimer);
            autosaveTimer = null;
        }

        // Save the full EditorState (preserves undo/redo history, cursor, selection)
        appState.saveEditorState(currentPath, editor.view.state);

        // Save scroll position
        appState.updateFileScrollTop(currentPath, container.scrollTop);
    }

    const file = appState.openFiles.get(path);
    if (file) {
        // Try to restore the full EditorState (with undo history)
        const savedState = appState.getEditorState(path);
        if (savedState) {
            // Restore full state including undo history
            editor.view.setState(savedState as import('@codemirror/state').EditorState);
            rawTextarea.value = file.content;
        } else {
            // First time opening - create fresh state
            setContent(file.content, true);
            rawTextarea.value = file.content;
        }

        appState.setCurrentFile(path);
        SessionState.setActiveFile(path);  // Sync to SessionState for Open Files panel
        editor.setFilePath(path);  // Set file path for execution queue
        updateFileIndicator();

        const filename = path.split('/').pop() || path;
        document.title = `${filename} - MRMD`;

        requestAnimationFrame(() => {
            container.scrollTop = file.scrollTop;
        });

        if (path.endsWith('.md')) {
            const session = await SessionState.getNotebookSession(path);
            ipython.setSession(session);
            SessionState.setCurrentSessionName(session);
        }
    }
}

async function handleBeforeTabClose(path: string): Promise<void> {
    const file = appState.openFiles.get(path);
    if (file?.modified) {
        try {
            await services.documents.saveFile(path, file.content);

            // Update external change manager's lastKnownContent
            externalChangeManager?.markAsSaved(path, file.content);
        } catch (err) {
            console.error('[Tabs] Error saving before close:', err);
        }
    }
}

async function handleTabClose(path: string): Promise<void> {
    terminalTabs?.closeTerminalsForFile(path);

    // Unregister from external change handler manager
    externalChangeManager?.unregisterFile(path);

    // Stop watching for external changes
    if (services.collaboration.isConnected) {
        services.collaboration.unwatchFile(path);
    }

    const newActivePath = appState.closeFile(path);

    if (newActivePath) {
        await handleTabSelect(newActivePath);
    } else {
        setContent('', true);
        rawTextarea.value = '';
        document.title = 'MRMD';
        updateFileIndicator();
    }
}

// ============================================================================
// Project Handlers
// ============================================================================

async function openProject(path: string): Promise<void> {
    console.log('[Codes] Opening project:', path);
    SessionState.openProject(path);
}

interface ProjectOpenedEvent {
    path: string;
    name: string;
    savedTabs?: {
        tabs: string[];
        active: string | null;
        scrollPositions?: Record<string, { scrollTop: number }>;
    } | null;
    openFileAfter?: string | null;
    skipFileOpen?: boolean;
    cachedFiles?: Record<string, { content: string; mtime: number }> | null;
}

async function handleProjectOpened(project: ProjectOpenedEvent): Promise<void> {
    console.log('[Codes] Project opened:', project.name);

    appState.setProject({
        path: project.path,
        name: project.name,
        type: null,
        environments: [],
    });

    browserRoot = project.path;
    localStorage.setItem('mrmd_browser_root', browserRoot);
    fileBrowser?.setRoot(project.path);

    // Configure IPython client for this project
    // Since executor uses the same client, everything stays in sync
    ipython.setSession('main');
    ipython.setProjectPath(project.path);
    ipython.setFigureDir(project.path + '/.mrmd/assets');

    // Set base path to project root for image resolution
    // This means image paths like .mrmd/assets/figure.png work from any file
    setDocumentBasePath(project.path);

    // Connect collaboration
    if (!noCollab && !services.collaboration.isConnected) {
        try {
            await services.collaboration.connect({
                projectRoot: project.path,
                userName: 'user',
                userType: 'human',
            });
        } catch (err) {
            console.warn('[Collab] Connection failed:', err);
        }
    }

    // Skip file opening if requested (file was already opened before project switch)
    if (project.skipFileOpen) {
        console.log('[Codes] Skipping file open (already opened)');
        return;
    }

    // Get cached files from project pool (if warm switch)
    const cachedFiles = project.cachedFiles || {};
    const hasCachedFiles = Object.keys(cachedFiles).length > 0;
    if (hasCachedFiles) {
        console.log('[Codes] Using cached files from project pool:', Object.keys(cachedFiles).length);
    }

    // Determine which file to open (priority: openFileAfter > savedTabs.active)
    const savedTabs = project.savedTabs;
    const fileToOpen = project.openFileAfter || savedTabs?.active;

    // FIRST: Open the requested file immediately for fast UX
    if (fileToOpen) {
        console.log('[Codes] Opening file after project switch:', fileToOpen, hasCachedFiles ? '(from cache)' : '');
        try {
            const cached = cachedFiles[fileToOpen];
            await openFile(fileToOpen, {
                cachedContent: cached?.content,
                cachedMtime: cached?.mtime,
            });
        } catch (err) {
            console.warn('[Codes] Failed to open file:', fileToOpen, err);
        }
    }

    // THEN: Restore other saved tabs in background (skip the one we already opened)
    if (savedTabs?.tabs && savedTabs.tabs.length > 0) {
        const otherTabs = savedTabs.tabs.filter(t => t !== fileToOpen);
        if (otherTabs.length > 0) {
            console.log('[Codes] Restoring other tabs in background:', otherTabs.length, hasCachedFiles ? '(from cache)' : '');

            // Mark that we're restoring to prevent auto-save during restore
            SessionState.setRestoringTabs(true);

            try {
                for (const tabPath of otherTabs) {
                    try {
                        const cached = cachedFiles[tabPath];
                        await openFile(tabPath, {
                            background: true,
                            cachedContent: cached?.content,
                            cachedMtime: cached?.mtime,
                        });
                    } catch (err) {
                        // File may no longer exist - skip it
                        console.warn('[Codes] Failed to restore tab:', tabPath, err);
                    }
                }
            } finally {
                SessionState.setRestoringTabs(false);
            }
        }
    }
}

function handleProjectCreated({ mainNotebook }: { mainNotebook?: string }): void {
    if (mainNotebook) {
        openFile(mainNotebook);
    }
}

// ============================================================================
// UI Updates
// ============================================================================

function updateFileIndicator(): void {
    const indicator = document.querySelector('.current-file-indicator');
    if (!indicator) return;

    const currentPath = appState.currentFilePath;
    if (currentPath) {
        indicator.classList.add('visible');
        const fileName = currentPath.split('/').pop() || currentPath;
        const modified = appState.isModified;
        const nameEl = indicator.querySelector('.file-name');
        const saveBtn = indicator.querySelector('.save-btn');

        if (nameEl) nameEl.textContent = fileName + (modified ? ' *' : '');
        if (saveBtn) saveBtn.classList.toggle('modified', modified);
    } else {
        indicator.classList.remove('visible');
    }

    aiPalette?.setCurrentFile(currentPath);
}

function updateRunningBadge(aiCount: number): void {
    const badge = document.getElementById('running-badge');
    if (!badge) return;

    const countEl = badge.querySelector('.badge-count');
    if (countEl) countEl.textContent = String(aiCount);
    badge.classList.toggle('has-running', aiCount > 0);
}

function showNotification(title: string, message: string, type = 'info'): void {
    if (notificationManager) {
        notificationManager.addLocalNotification(title, message, type);
    } else {
        console.log(`[Notification] ${type}: ${title} - ${message}`);
    }
}

// ============================================================================
// File Watching
// ============================================================================

/**
 * Initialize file watching.
 *
 * The system uses two mechanisms for detecting external file changes:
 *
 * 1. **WebSocket (primary)**: Real-time events from the backend file watcher (watchdog).
 *    - Lower latency (~100ms)
 *    - Source of truth when connected
 *    - Triggers via collab.onFileChanged()
 *
 * 2. **Polling (fallback)**: HTTP-based mtime checks every 2 seconds.
 *    - Used when WebSocket is disconnected
 *    - Higher latency but more reliable
 *    - Automatically stops when WebSocket reconnects
 *
 * When WebSocket reconnects, catchUpMissedChanges() runs to detect any
 * changes that occurred during the disconnection.
 */
function initFileWatching(): void {
    // Initialize the external change handler manager
    externalChangeManager = new ExternalChangeHandlerManager();

    // Initialize Claude presence indicator
    claudePresenceIndicator = new ClaudePresenceIndicator();

    // Initialize conflict resolution UI
    conflictResolutionUI = new ConflictResolutionUI();

    // Set conflict strategy to 'prompt' - shows UI when conflicts occur
    // This enables the full conflict resolution experience
    externalChangeManager.setConflictStrategy('prompt');

    // Wire up autosave pause during external change processing
    // This prevents race conditions where autosave overwrites Claude's changes
    externalChangeManager.onPauseAutosave = () => pauseAutosave();

    // Wire up the onExternalChange callback for notifications and Claude presence
    externalChangeManager.onExternalChange = (info) => {
        const filename = info.filePath.split('/').pop() || info.filePath;
        const sourceLabel = info.source === 'claude-code' ? 'Claude' :
                           info.source === 'git' ? 'Git' : 'External edit';
        const conflictLabel = info.hadConflict ? ' (resolved)' : '';

        // Show Claude presence indicator when Claude is editing
        if (info.source === 'claude-code' && claudePresenceIndicator) {
            claudePresenceIndicator.show(info.filePath, info.linesChanged);
        }

        // Show notification for external changes (after conflict resolution if applicable)
        showNotification(
            `${sourceLabel} updated ${filename}`,
            `${info.linesChanged} line${info.linesChanged !== 1 ? 's' : ''} changed${conflictLabel}`,
            info.hadConflict ? 'ai' : 'info'
        );
    };

    // Wire up the onConflict callback to show the conflict resolution UI
    // For now, auto-accept external changes to avoid blocking streaming
    // TODO: Implement non-blocking banner UI for conflicts
    externalChangeManager.onConflict = async (conflictInfo) => {
        console.log('[ExternalChangeManager] Conflict detected:', {
            filePath: conflictInfo.filePath,
            source: conflictInfo.source,
            linesChanged: conflictInfo.linesChanged,
            diffRegions: conflictInfo.diffRegions.length,
        });

        // Store conflict info for reference
        appState.setPendingExternalChange(conflictInfo.filePath, {
            source: conflictInfo.source,
            detectedAt: Date.now(),
            newContent: conflictInfo.externalContent,
            hasConflict: true,
            linesChanged: conflictInfo.linesChanged,
        });

        // For now: auto-accept to avoid blocking streaming
        // Show notification instead of modal
        const filename = conflictInfo.filePath.split('/').pop() || conflictInfo.filePath;
        const sourceLabel = conflictInfo.source === 'claude-code' ? 'Claude' : 'External';
        showNotification(
            `${sourceLabel} updated ${filename}`,
            `${conflictInfo.linesChanged} lines changed (your local changes will be kept in undo history)`,
            'ai'
        );

        // Auto-accept external changes - user can undo if needed
        return 'accept';

    };

    console.log('[FileWatch] ExternalChangeHandlerManager initialized');

    if (noCollab) {
        // Collaboration disabled - use polling only
        startPollingFallback();
    } else {
        // Give WebSocket time to connect before falling back to polling
        // WebSocket is preferred because it's lower latency and reduces server load
        setTimeout(() => {
            if (!services.collaboration.isConnected) {
                console.log('[FileWatch] WebSocket not connected after 3s, starting polling fallback');
                startPollingFallback();
            }
        }, 3000);
    }
}

function startPollingFallback(): void {
    if (fileCheckInterval) return;
    console.log('[FileWatch] Starting polling fallback');
    fileCheckInterval = setInterval(checkFileChanges, 2000);
}

function stopPollingFallback(): void {
    if (fileCheckInterval) {
        console.log('[FileWatch] Stopping polling fallback');
        clearInterval(fileCheckInterval);
        fileCheckInterval = null;
    }
}

// Tracks AI users that have joined the collaboration session
// Used to detect when file changes are likely from Claude Code
const activeAIUsers: Map<string, { userName: string; joinedAt: number; currentFile?: string }> = new Map();

/**
 * Detect the source of an external file change based on heuristics.
 *
 * This helps provide better UX by showing "Claude edited" vs "External edit".
 * Detection is best-effort - defaults to 'external' when uncertain.
 *
 * Detection methods:
 * 1. Check if an AI user is present in the collaboration session
 * 2. Check for .git paths (git operations)
 * 3. Check for Claude Code markers (CLAUDE.md, .claude directory)
 * 4. Default to 'external'
 */
function detectExternalChangeSource(filePath: string): ExternalChangeInfo['source'] {
    // 1. Check if an AI user is present and editing this file or any file
    // If an AI user is in the collaboration session, changes are likely from Claude
    if (activeAIUsers.size > 0) {
        // Check if any AI user is editing this specific file
        for (const [, user] of activeAIUsers) {
            if (user.currentFile === filePath) {
                return 'claude-code';
            }
        }
        // If AI is present but not on this file, still likely Claude if recent activity
        const now = Date.now();
        for (const [, user] of activeAIUsers) {
            // If an AI user joined in the last 30 seconds, likely Claude
            if (now - user.joinedAt < 30000) {
                return 'claude-code';
            }
        }
    }

    // 2. If the path contains .git, likely git operation
    if (filePath.includes('.git/') || filePath.includes('.git\\')) {
        return 'git';
    }

    // 3. Check for Claude Code directory presence (heuristic)
    // Claude Code creates a CLAUDE.md or .claude directory
    // This is a weak heuristic - can be improved with backend support
    const projectRoot = appState.project?.path;
    if (projectRoot) {
        // We could check for CLAUDE.md existence, but that requires an async call
        // For now, if the user has a project with CLAUDE.md, assume claude-code
        // This is set by the backend in the future
    }

    // 4. Default to 'external' (generic external editor/tool)
    return 'external';
}

/**
 * Track an AI user joining the collaboration session.
 * Called from initCollaboration when we detect an AI user.
 */
function trackAIUserJoin(sessionId: string, userName: string, currentFile?: string): void {
    activeAIUsers.set(sessionId, {
        userName,
        joinedAt: Date.now(),
        currentFile,
    });

    console.log(`[ClaudePresence] AI user joined: ${userName} (${sessionId})`);

    // Show the Claude presence indicator
    if (claudePresenceIndicator && currentFile) {
        claudePresenceIndicator.show(currentFile, 0);
    }
}

/**
 * Track an AI user leaving the collaboration session.
 */
function trackAIUserLeave(sessionId: string): void {
    const user = activeAIUsers.get(sessionId);
    if (user) {
        console.log(`[ClaudePresence] AI user left: ${user.userName} (${sessionId})`);
        activeAIUsers.delete(sessionId);
    }
}

/**
 * Update which file an AI user is currently editing.
 */
function trackAIUserFile(sessionId: string, filePath: string): void {
    const user = activeAIUsers.get(sessionId);
    if (user) {
        user.currentFile = filePath;
    }
}

/**
 * Check for any file changes that may have been missed while WebSocket was disconnected.
 *
 * Called immediately after WebSocket reconnection to catch up on any changes
 * that occurred during the brief disconnection period.
 */
async function catchUpMissedChanges(): Promise<void> {
    const openFiles = appState.openFiles;
    if (openFiles.size === 0) return;

    console.log('[FileWatch] Catching up on missed changes...');

    const paths = Array.from(openFiles.keys());

    try {
        const result = await services.documents.getMtimes(paths);

        let changesFound = 0;
        for (const [path, newMtime] of Object.entries(result.mtimes)) {
            if (newMtime === null) continue;

            const file = openFiles.get(path);
            if (!file?.mtime) continue;

            // Check if file changed while we were disconnected
            if (Math.abs(newMtime - file.mtime) > 0.01) {
                console.log('[FileWatch] Catch-up: File changed while disconnected:', path);
                const source = detectExternalChangeSource(path);
                await handleExternalFileChange(path, source);
                changesFound++;
            }
        }

        if (changesFound > 0) {
            console.log(`[FileWatch] Catch-up complete: ${changesFound} file(s) updated`);
        } else {
            console.log('[FileWatch] Catch-up complete: No missed changes');
        }
    } catch (err) {
        console.warn('[FileWatch] Catch-up check failed:', err);
    }
}

/**
 * Polling fallback for file change detection.
 *
 * This runs when WebSocket is disconnected. It checks mtimes of all open files
 * and triggers handleExternalFileChange() for any that have changed.
 *
 * Polling interval: 2000ms (see startPollingFallback)
 */
async function checkFileChanges(): Promise<void> {
    const openFiles = appState.openFiles;
    if (openFiles.size === 0) return;

    const paths = Array.from(openFiles.keys());

    try {
        const result = await services.documents.getMtimes(paths);

        for (const [path, newMtime] of Object.entries(result.mtimes)) {
            if (newMtime === null) continue;

            const file = openFiles.get(path);
            if (!file?.mtime) continue;

            if (Math.abs(newMtime - file.mtime) > 0.01) {
                // Detect source using same heuristics as WebSocket handler
                const source = detectExternalChangeSource(path);
                console.log('[FileWatch] Polling detected change:', path, { source });
                await handleExternalFileChange(path, source);
            }
        }
    } catch (err) {
        // Silent - polling errors are expected when server is unavailable
    }
}

/**
 * Handle external file changes (from Claude Code, git, other editors, etc.)
 *
 * This function is called when:
 * 1. File watcher (WebSocket) detects a change
 * 2. Polling fallback detects mtime change
 *
 * Delegates to ExternalChangeHandlerManager for:
 * - Debouncing rapid changes
 * - Conflict detection via lastKnownContent tracking
 * - Conflict strategy handling (external-wins, local-wins, prompt)
 * - onConflict callback for Step 6's conflict resolution UI
 *
 * @param path - Path to the file that changed
 * @param source - Optional source hint ('claude-code', 'git', etc.)
 */
async function handleExternalFileChange(
    path: string,
    source: ExternalChangeInfo['source'] = 'unknown',
    capturedContent?: string | null
): Promise<void> {
    const file = appState.openFiles.get(path);
    if (!file) {
        console.log('[FileWatch] Ignoring change for unopened file:', path);
        return;
    }

    // If we have the manager, use it for debouncing and conflict handling
    if (externalChangeManager) {
        // Note: handleFileChanged is now async and captures content immediately
        // We await it to ensure the content is captured before this function returns
        await externalChangeManager.handleFileChanged(
            path,
            source,
            // loadFile callback - if capturedContent is provided from WebSocket, use it
            // This prevents race conditions where autosave could overwrite external changes
            async () => {
                if (capturedContent !== undefined && capturedContent !== null) {
                    console.log('[FileWatch] Using captured content from WebSocket, length:', capturedContent.length);
                    return capturedContent;
                }
                // Fall back to reading from disk (for polling fallback)
                console.log('[FileWatch] Reading content from disk (no captured content)');
                const fileData = await services.documents.readFile(path);
                return fileData.content;
            },
            // applyChange callback - returns true if change was applied
            (newContent: string) => {
                return applyExternalChangeToFile(path, newContent, source);
            },
            // getCurrentContent callback
            () => {
                return path === appState.currentFilePath ? getContent() : file.content;
            }
        );
    } else {
        // Fallback: direct application (manager not initialized)
        console.log('[FileWatch] Manager not initialized, applying directly');
        try {
            const content = capturedContent ?? (await services.documents.readFile(path)).content;
            applyExternalChangeToFile(path, content, source);
        } catch (err) {
            console.error('[FileWatch] Error handling file change:', err);
            showNotification('File sync error', `Failed to sync ${path}: ${err}`, 'error');
        }
    }
}

/**
 * Apply an external change to a file.
 *
 * This is the actual application logic, separated from the conflict handling.
 * Called by ExternalChangeHandlerManager after debouncing and conflict resolution.
 *
 * @returns true if the change was applied, false otherwise
 */
function applyExternalChangeToFile(
    path: string,
    newContent: string,
    source: ExternalChangeInfo['source']
): boolean {
    const file = appState.openFiles.get(path);
    if (!file) return false;

    const isCurrentFile = path === appState.currentFilePath;
    const currentContent = isCurrentFile ? getContent() : file.content;

    // Check if content actually changed
    if (newContent === currentContent) {
        console.log('[FileWatch] Content unchanged:', path);
        return false;
    }

    // Apply the external change to the editor
    if (isCurrentFile) {
        const scrollTop = container.scrollTop;

        // Use applyExternalChange for minimal diff-based update
        // This preserves cursor position and works with CRDT
        const changed = editor.applyExternalChange(newContent, source);

        if (changed) {
            rawTextarea.value = newContent;

            requestAnimationFrame(() => {
                container.scrollTop = scrollTop;
            });
        }
    }

    // Update AppState with the new content
    // Note: mtime will be updated on next poll or can be passed if available
    appState.applyExternalChange(path, newContent, null);

    return true;
}

/**
 * Count approximate number of lines changed between two content strings
 */
function countLinesChanged(oldContent: string, newContent: string): number {
    const oldLines = oldContent.split('\n');
    const newLines = newContent.split('\n');

    // Simple diff: count lines that differ
    let changed = 0;
    const maxLen = Math.max(oldLines.length, newLines.length);

    for (let i = 0; i < maxLen; i++) {
        if (oldLines[i] !== newLines[i]) {
            changed++;
        }
    }

    return changed;
}

function adjustCursorPosition(oldContent: string, newContent: string, oldCursor: number): number {
    if (oldCursor >= oldContent.length) return newContent.length;
    if (oldCursor === 0) return 0;

    let commonPrefix = 0;
    const minLen = Math.min(oldContent.length, newContent.length);
    while (commonPrefix < minLen && oldContent[commonPrefix] === newContent[commonPrefix]) {
        commonPrefix++;
    }

    if (oldCursor <= commonPrefix) return oldCursor;

    let commonSuffix = 0;
    while (commonSuffix < minLen - commonPrefix &&
           oldContent[oldContent.length - 1 - commonSuffix] === newContent[newContent.length - 1 - commonSuffix]) {
        commonSuffix++;
    }

    const oldChangeEnd = oldContent.length - commonSuffix;
    if (oldCursor > oldChangeEnd) {
        return oldCursor + (newContent.length - oldContent.length);
    }

    return Math.min(newContent.length - commonSuffix, newContent.length);
}

// ============================================================================
// AI Palette
// ============================================================================

function getAiContext(): unknown {
    const selInfo = getSelectionInfo();
    const markdown = getContent();

    // Extract local context: ~500 chars around cursor for better AI understanding
    const contextRadius = 500;
    const start = Math.max(0, selInfo.cursor - contextRadius);
    const end = Math.min(markdown.length, selInfo.cursor + contextRadius);
    const localContext = markdown.slice(start, end);

    return {
        text: markdown,
        cursor: selInfo.cursor,
        documentContext: markdown,
        localContext: localContext,
        // Also provide selection info
        selection: selInfo.selectedText,
        hasSelection: selInfo.hasSelection,
        selectionStart: selInfo.hasSelection ? editor.view.state.selection.main.from : undefined,
        selectionEnd: selInfo.hasSelection ? editor.view.state.selection.main.to : undefined,
    };
}

function handleAiActionStart(actionId: string, ctx: unknown): void {
    console.log('[AI] Action start:', actionId);

    if (!aiActionHandler) {
        console.error('[AI] Action handler not initialized');
        return;
    }

    // Cast context to the expected type
    const context = ctx as AIActionContext;

    // Start the streaming overlay immediately
    aiActionHandler.handleActionStart(actionId, context).catch((err) => {
        console.error('[AI] Failed to start action:', err);
    });
}

function handleAiChunk(actionId: string, chunk: string, ctx: unknown): void {
    if (!aiActionHandler) return;

    // Cast context to the expected type
    const context = ctx as AIActionContext;

    // Stream the chunk to the overlay
    aiActionHandler.handleChunk(actionId, chunk, context).catch((err) => {
        console.error('[AI] Failed to stream chunk:', err);
    });
}

function handleAiAction(actionId: string, result: unknown, ctx: unknown): void {
    console.log('[AI] Action complete:', actionId, result);

    if (!aiActionHandler) {
        console.error('[AI] Action handler not initialized');
        return;
    }

    // Cast context to the expected type
    const context = ctx as AIActionContext;

    // Handle the action - this uses the streaming overlay and commits as single undo step
    aiActionHandler.handleAction(actionId, result, context).then((success) => {
        if (success) {
            // Trigger autosave after successful AI edit
            const currentPath = appState.currentFilePath;
            if (currentPath) {
                appState.markFileModified(currentPath);
                scheduleAutosave();
                updateFileIndicator();
            }
        }
    }).catch((err) => {
        console.error('[AI] Unexpected error in action handler:', err);
    });
}

// ============================================================================
// UI Initialization
// ============================================================================

function initSidebarTabs(): void {
    const tabs = document.querySelectorAll('.sidebar-tab');
    const panels = document.querySelectorAll('.sidebar-panel');

    tabs.forEach(tab => {
        tab.addEventListener('click', () => {
            const panelId = (tab as HTMLElement).dataset.panel;
            if (!panelId) return;

            tabs.forEach(t => t.classList.remove('active'));
            panels.forEach(p => p.classList.remove('active'));

            tab.classList.add('active');
            const panel = document.getElementById(`${panelId}-panel`);
            panel?.classList.add('active');

            appState.setActivePanel(panelId as any);
        });
    });
}

function initSidebarResizer(): void {
    const resizer = document.getElementById('sidebar-resizer');
    const sidebar = document.querySelector('.sidebar') as HTMLElement;
    if (!resizer || !sidebar) return;

    let isResizing = false;

    resizer.addEventListener('mousedown', (e) => {
        isResizing = true;
        document.body.style.cursor = 'col-resize';
        e.preventDefault();
    });

    document.addEventListener('mousemove', (e) => {
        if (!isResizing) return;
        const newWidth = window.innerWidth - e.clientX;
        sidebar.style.width = `${Math.max(200, Math.min(600, newWidth))}px`;
    });

    document.addEventListener('mouseup', () => {
        isResizing = false;
        document.body.style.cursor = '';
    });
}

function initThemePicker(): void {
    const btn = document.getElementById('theme-picker-btn');
    const dropdown = document.getElementById('theme-picker-dropdown');
    if (!btn || !dropdown) return;

    btn.addEventListener('click', () => {
        dropdown.classList.toggle('visible');
    });

    dropdown.querySelectorAll('.theme-option').forEach(option => {
        option.addEventListener('click', () => {
            const theme = (option as HTMLElement).dataset.theme;
            if (theme) {
                appState.setTheme(theme as any);
                dropdown.classList.remove('visible');
            }
        });
    });

    document.addEventListener('click', (e) => {
        if (!btn.contains(e.target as Node) && !dropdown.contains(e.target as Node)) {
            dropdown.classList.remove('visible');
        }
    });
}

function initModeToggle(): void {
    const modeBtn = document.getElementById('mode-toggle-btn');
    modeBtn?.addEventListener('click', () => {
        toggleMode();
    });
}

function focusFileBrowser(): void {
    document.querySelectorAll('.sidebar-tab').forEach(t => t.classList.remove('active'));
    document.querySelectorAll('.sidebar-panel').forEach(p => p.classList.remove('active'));

    const filesTab = document.querySelector('.sidebar-tab[data-panel="files"]');
    const filesPanel = document.getElementById('files-panel');

    filesTab?.classList.add('active');
    filesPanel?.classList.add('active');

    fileBrowser?.focus();
}

// ============================================================================
// Initial State
// ============================================================================

async function loadInitialState(): Promise<void> {
    browserRoot = localStorage.getItem('mrmd_browser_root') || '/home';

    const params = new URLSearchParams(window.location.search);
    const urlFile = params.get('file');

    // PRIORITY 1: URL parameter always wins
    if (urlFile) {
        await openFile(urlFile);
        SessionState.initialize(); // Background, don't block
        return;
    }

    // PRIORITY 2: Try instant restore from localStorage (sync read - no await)
    const lastProject = localStorage.getItem('mrmd_last_project');
    if (lastProject) {
        const savedTabsJson = localStorage.getItem(`mrmd_tabs_${lastProject}`);
        if (savedTabsJson) {
            try {
                const savedTabs = JSON.parse(savedTabsJson);
                const activeFile = savedTabs.active;

                if (activeFile) {
                    console.log('[Restore] Instant restore:', activeFile);

                    // Open the file immediately (fetches from server - authoritative)
                    await openFile(activeFile);

                    // Restore scroll position after file is loaded
                    const scrollTop = savedTabs.scrollPositions?.[activeFile]?.scrollTop || 0;
                    if (scrollTop > 0) {
                        requestAnimationFrame(() => {
                            const editorEl = document.getElementById('editor-container');
                            if (editorEl) editorEl.scrollTop = scrollTop;
                        });
                    }

                    // Set up project context (IPython session, collaboration, etc.)
                    // Pass skipFileOpen since we already opened the file
                    await SessionState.openProject(lastProject, true, {
                        skipFileOpen: true,
                        cachedActiveFile: activeFile,
                    });

                    // Restore other tabs in background
                    const otherTabs = (savedTabs.tabs || []).filter((t: string) => t !== activeFile);
                    if (otherTabs.length > 0) {
                        console.log('[Restore] Restoring other tabs in background:', otherTabs.length);
                        SessionState.setRestoringTabs(true);
                        Promise.all(
                            otherTabs.map((tabPath: string) =>
                                openFile(tabPath, { background: true }).catch(() => {})
                            )
                        ).finally(() => {
                            SessionState.setRestoringTabs(false);
                        });
                    }

                    // Initialize SessionState in background (for HomeScreen if needed later)
                    SessionState.initialize();
                    return;
                }
            } catch (err) {
                console.warn('[Restore] Failed to parse saved tabs:', err);
            }
        }
    }

    // PRIORITY 3: No saved session - show HomeScreen
    // Initialize SessionState first so HomeScreen has data to show
    await SessionState.initialize();
    HomeScreen.show();
}
