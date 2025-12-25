/**
 * InterfaceManager - Owns the interface mode lifecycle for Codes app
 *
 * This is the single source of truth for interface mode (compact vs developer)
 * within the Codes application. It coordinates:
 *
 * 1. Mode State: Reads/writes interface mode preference
 * 2. Compact UI: Creates floating toolbar, panels, status bar
 * 3. CSS Classes: Applies mode classes to container/body
 * 4. Transitions: Handles mode switching with proper lifecycle
 *
 * Architecture:
 * - Study app: Always minimal, no mode switching needed
 * - Codes app: Supports both compact and developer modes via this manager
 *
 * Usage:
 *   const interfaceManager = new InterfaceManager(options);
 *   await interfaceManager.initialize();
 *   // Later: interfaceManager.setMode('developer');
 */

// @ts-ignore - Legacy JS module
import * as SessionState from '/core/session-state.js';
// @ts-ignore - Legacy JS module
import { initCompactMode, destroyCompactMode } from '/core/compact-mode.js';

// ============================================================================
// Types
// ============================================================================

export type InterfaceMode = 'compact' | 'developer';

export interface InterfaceModeState {
    mode: InterfaceMode;
    toolRailSide: 'left' | 'right';
    toolRailOpen: boolean;
    statusBarExpanded: boolean;
}

export interface InterfaceManagerOptions {
    /** The main .container element */
    container: HTMLElement;
    /** The .editor-pane element */
    editorPane: HTMLElement;
    /** The rich editor instance (deprecated, use getEditor) */
    editor: unknown;
    /** Function that returns the current editor instance */
    getEditor?: () => unknown;
    /** Optional file browser instance for quick files panel */
    fileBrowser?: unknown;
    /** Optional terminal factory for terminal overlay */
    createTerminal?: () => unknown;
}

export interface ModeChangeEvent {
    previousMode: InterfaceMode;
    newMode: InterfaceMode;
}

type ModeChangeListener = (event: ModeChangeEvent) => void;

// ============================================================================
// InterfaceManager Class
// ============================================================================

export class InterfaceManager {
    private options: InterfaceManagerOptions;
    private initialized = false;
    private currentMode: InterfaceMode;
    private listeners: Set<ModeChangeListener> = new Set();
    private cleanupFns: Array<() => void> = [];

    constructor(options: InterfaceManagerOptions) {
        this.options = options;
        // Read initial mode from persisted state
        this.currentMode = SessionState.getInterfaceMode() as InterfaceMode;
    }

    // ========================================================================
    // Public API
    // ========================================================================

    /**
     * Initialize the interface manager.
     * Creates all UI elements for both modes and applies the current mode.
     *
     * Note: CSS class application is handled by mode-controller.js (called by
     * compact-mode.js). InterfaceManager focuses on lifecycle coordination.
     */
    async initialize(): Promise<void> {
        if (this.initialized) {
            console.warn('[InterfaceManager] Already initialized');
            return;
        }

        console.log(`[InterfaceManager] Initializing with mode: ${this.currentMode}`);

        // 1. Create compact mode UI (floating toolbar, panels, etc.)
        //    This also initializes mode-controller which handles CSS classes.
        //    The UI elements are hidden in developer mode via CSS.
        this.initCompactUI();

        // 2. Listen for mode changes from SessionState
        //    (mode-controller handles CSS classes, we handle lifecycle)
        const unsubscribe = SessionState.on('interface-mode-changed', (event: { mode: string }) => {
            this.handleModeChange(event.mode as InterfaceMode);
        });
        this.cleanupFns.push(unsubscribe);

        this.initialized = true;
        console.log('[InterfaceManager] Initialized');
    }

    /**
     * Get the current interface mode.
     */
    getMode(): InterfaceMode {
        return this.currentMode;
    }

    /**
     * Check if currently in compact mode.
     */
    isCompact(): boolean {
        return this.currentMode === 'compact';
    }

    /**
     * Check if currently in developer mode.
     */
    isDeveloper(): boolean {
        return this.currentMode === 'developer';
    }

    /**
     * Set the interface mode.
     * This triggers a mode transition with proper lifecycle.
     */
    setMode(mode: InterfaceMode): void {
        if (mode === this.currentMode) {
            return;
        }

        // Update SessionState (which persists to localStorage)
        // This will trigger the 'interface-mode-changed' event
        SessionState.setInterfaceMode(mode);
    }

    /**
     * Toggle between compact and developer modes.
     */
    toggle(): void {
        this.setMode(this.currentMode === 'compact' ? 'developer' : 'compact');
    }

    /**
     * Get the full interface mode state.
     */
    getState(): InterfaceModeState {
        return {
            mode: this.currentMode,
            toolRailSide: SessionState.getToolRailSide(),
            toolRailOpen: SessionState.getToolRailOpen(),
            statusBarExpanded: SessionState.getStatusBarExpanded(),
        };
    }

    /**
     * Subscribe to mode changes.
     * @returns Unsubscribe function
     */
    onModeChange(listener: ModeChangeListener): () => void {
        this.listeners.add(listener);
        return () => this.listeners.delete(listener);
    }

    /**
     * Destroy the interface manager and clean up resources.
     */
    destroy(): void {
        // Run all cleanup functions
        this.cleanupFns.forEach(fn => fn());
        this.cleanupFns = [];

        // Destroy compact mode UI
        destroyCompactMode();

        // Clear listeners
        this.listeners.clear();

        this.initialized = false;
        console.log('[InterfaceManager] Destroyed');
    }

    // ========================================================================
    // Private Methods
    // ========================================================================

    /**
     * Initialize the compact mode UI elements.
     */
    private initCompactUI(): void {
        const { container, editorPane, editor, getEditor, fileBrowser, createTerminal } = this.options;

        initCompactMode({
            container,
            editorPane,
            editor,
            getEditor: getEditor || (() => editor),
            fileBrowser,
            createTerminal,
        });
    }

    /**
     * Handle a mode change event.
     * Note: CSS classes are applied by mode-controller.js, not here.
     */
    private handleModeChange(newMode: InterfaceMode): void {
        if (newMode === this.currentMode) {
            return;
        }

        const previousMode = this.currentMode;

        console.log(`[InterfaceManager] Mode change: ${previousMode} → ${newMode}`);

        // 1. Run exit lifecycle for previous mode
        this.onModeExit(previousMode);

        // 2. Update current mode
        this.currentMode = newMode;

        // 3. Run enter lifecycle for new mode
        this.onModeEnter(newMode);

        // 4. Notify listeners
        const event: ModeChangeEvent = { previousMode, newMode };
        this.listeners.forEach(listener => listener(event));
    }

    /**
     * Lifecycle hook: called when exiting a mode.
     */
    private onModeExit(mode: InterfaceMode): void {
        if (mode === 'compact') {
            // Clean up compact mode state if needed
            // e.g., close open panels, terminal overlay
        } else {
            // Clean up developer mode state if needed
        }
    }

    /**
     * Lifecycle hook: called when entering a mode.
     */
    private onModeEnter(mode: InterfaceMode): void {
        if (mode === 'compact') {
            // Initialize compact mode state if needed
        } else {
            // Initialize developer mode state if needed
            // e.g., ensure sidebar is visible
        }
    }
}

// ============================================================================
// Factory Function (for convenience)
// ============================================================================

/**
 * Create and initialize an InterfaceManager.
 */
export async function createInterfaceManager(
    options: InterfaceManagerOptions
): Promise<InterfaceManager> {
    const manager = new InterfaceManager(options);
    await manager.initialize();
    return manager;
}

export default InterfaceManager;
