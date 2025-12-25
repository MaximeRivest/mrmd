/**
 * AI Action Handler Service
 *
 * Bridges the AI Palette → Editor Streaming Layer.
 * Handles committing AI results to the document as single undo steps.
 *
 * Architecture:
 * - AI Palette triggers spells and receives results
 * - This service extracts the insertable text from various response formats
 * - Uses the editor's streaming overlay for visibility and single-undo commit
 * - Integrates with locks when collaboration is enabled
 *
 * Streaming Lifecycle:
 * 1. handleActionStart() - Creates streaming overlay when request starts
 * 2. handleChunk() - Updates overlay with content chunks (when backend supports it)
 * 3. handleAction() - Completes stream and commits to document
 */

import type { EditorView } from '@codemirror/view';
import { showSynonymPicker, extractSynonyms } from './synonym-picker';
import { showExplainPanel, extractExplanation } from './explain-panel';

// Result extraction types
export interface AIActionContext {
    selectionStart?: number;
    selectionEnd?: number;
    cursor?: number;
    isReplace?: boolean;
    hasSelection?: boolean;
    selection?: string;
    scopeMode?: 'line' | 'section';
    requestId?: number;
    palettePosition?: { x: number; y: number } | null;
}

export interface AIActionHandlerConfig {
    /**
     * Get the EditorView instance
     */
    getView: () => EditorView | null;

    /**
     * Get the lock manager (for collaborative editing)
     * AI-human interaction is inherently collaborative - locks ensure clean edits
     */
    getLockManager?: () => unknown | null;

    /**
     * Get the current user info for lock ownership
     */
    getUser?: () => { userId: string; userName: string; userColor: string };

    /**
     * Called when an action completes successfully
     */
    onSuccess?: (actionId: string, content: string) => void;

    /**
     * Called when an action fails
     */
    onError?: (actionId: string, error: Error) => void;

    /**
     * Whether to show notifications (default: true)
     */
    showNotifications?: boolean;
}

// Streaming functions type (imported dynamically)
interface StreamingFunctions {
    startStream: (view: EditorView, options: {
        id: string;
        type: 'ai' | 'execution' | 'external';
        anchorPos: number;
        anchorType?: 'after' | 'replace';
        replaceFrom?: number;
        replaceTo?: number;
        owner: { userId: string; userName: string; userColor: string };
        operation?: string;
    }) => void;
    streamChunk: (view: EditorView, id: string, chunk: string, replace?: boolean) => void;
    completeStream: (view: EditorView, id: string, finalContent?: string) => void;
    commitStream: (options: {
        streamId: string;
        view: EditorView;
        onCommit?: (content: string) => void;
        onError?: (error: Error) => void;
    }) => { success: boolean; content?: string; error?: string };
    cancelStream: (view: EditorView, id: string) => void;
}

/**
 * Extract the insertable text from an AI response based on action type.
 *
 * Different AI endpoints return different field names:
 * - FinishSentence/Paragraph/CodeLine/Section → completion
 * - FixGrammar/Transcription → fixed_text
 * - FixCode → fixed_code
 * - DocumentCode → documented_code
 * - SimplifyCode → simplified_code
 * - FormatCode → formatted_code
 * - ReformatMarkdown → reformatted_text
 * - Synonyms → synonyms (array - handled separately)
 * - CorrectAndFinish → corrected_text + completion
 * - ExplainCode → explanation (for display, not insertion)
 * - AskClaude → response (special handling)
 */
export function extractResultText(actionId: string, result: unknown): string | null {
    if (!result || typeof result !== 'object') {
        return null;
    }

    const r = result as Record<string, unknown>;

    // Completion-based actions (insert after cursor)
    if (actionId === 'finishLine' || actionId === 'finishSection') {
        return typeof r.completion === 'string' ? r.completion : null;
    }

    // Fix/replace actions
    if (actionId === 'fixGrammar' || actionId === 'fixTranscription') {
        return typeof r.fixed_text === 'string' ? r.fixed_text : null;
    }

    // Code fix/transform actions
    if (actionId === 'fixCode') {
        return typeof r.fixed_code === 'string' ? r.fixed_code : null;
    }

    if (actionId === 'documentCode') {
        return typeof r.documented_code === 'string' ? r.documented_code : null;
    }

    if (actionId === 'simplifyCode') {
        return typeof r.simplified_code === 'string' ? r.simplified_code : null;
    }

    if (actionId === 'formatCode') {
        return typeof r.formatted_code === 'string' ? r.formatted_code : null;
    }

    if (actionId === 'reformatMarkdown') {
        return typeof r.reformatted_text === 'string' ? r.reformatted_text : null;
    }

    // Correct and finish - combines correction with completion
    if (actionId === 'correctAndFinish') {
        // API may return corrected_completion (combined) or separate fields
        if (typeof r.corrected_completion === 'string') {
            return r.corrected_completion;
        }
        const corrected = typeof r.corrected_text === 'string' ? r.corrected_text : '';
        const completion = typeof r.completion === 'string' ? r.completion : '';
        return corrected + completion || null;
    }

    // Synonyms - returns array, needs special handling (picker UI)
    if (actionId === 'synonyms') {
        // Return null - synonyms need a picker UI, not direct insertion
        return null;
    }

    // Explain code - for display, not insertion
    if (actionId === 'explainCode') {
        // Return null - explanation should be shown in a panel, not inserted
        return null;
    }

    // Ask Claude - special handling, Claude modifies files directly
    if (actionId === 'askClaude') {
        // Return null - Claude handles its own edits
        return null;
    }

    // Fallback: try common field names
    if (typeof r.completion === 'string') return r.completion;
    if (typeof r.text === 'string') return r.text;
    if (typeof r.result === 'string') return r.result;
    if (typeof r.content === 'string') return r.content;

    return null;
}

/**
 * Determine if an action should replace the selection or insert after cursor.
 */
export function isReplaceAction(actionId: string): boolean {
    const replaceActions = new Set([
        'fixGrammar',
        'fixTranscription',
        'fixCode',
        'documentCode',
        'simplifyCode',
        'formatCode',
        'reformatMarkdown',
        'correctAndFinish',
    ]);
    return replaceActions.has(actionId);
}

/**
 * Determine if an action requires special handling (not direct text insertion).
 */
export function isSpecialAction(actionId: string): boolean {
    const specialActions = new Set([
        'synonyms',      // Needs picker UI
        'explainCode',   // Display in panel
        'askClaude',     // Claude handles edits
    ]);
    return specialActions.has(actionId);
}

/**
 * Get a human-readable operation label for the streaming overlay.
 */
function getOperationLabel(actionId: string): string {
    const labels: Record<string, string> = {
        finishLine: 'Completing line',
        finishSection: 'Completing section',
        fixGrammar: 'Fixing grammar',
        fixTranscription: 'Fixing transcription',
        fixCode: 'Fixing code',
        documentCode: 'Documenting code',
        simplifyCode: 'Simplifying code',
        formatCode: 'Formatting code',
        reformatMarkdown: 'Reformatting markdown',
        correctAndFinish: 'Correcting & completing',
    };
    return labels[actionId] ?? 'AI processing';
}

/**
 * Create an AI action handler for an editor.
 */
export function createAIActionHandler(config: AIActionHandlerConfig) {
    const { getView, getLockManager, getUser, onSuccess, onError } = config;

    // Default user for non-collaborative mode
    const defaultUser = {
        userId: 'local-user',
        userName: 'You',
        userColor: '#3b82f6',
    };

    // Track active streams by requestId
    const activeStreams = new Map<number, {
        streamId: string;
        actionId: string;
        ctx: AIActionContext;
        hasContent: boolean;
    }>();

    // Cache streaming functions (lazy loaded)
    let streamingFns: StreamingFunctions | null = null;

    async function getStreamingFunctions(): Promise<StreamingFunctions> {
        if (streamingFns) return streamingFns;

        // @ts-ignore - Browser module path, resolved at runtime
        const streaming = await import('/editor-dist/index.browser.js');
        streamingFns = streaming as StreamingFunctions;
        return streamingFns;
    }

    /**
     * Calculate anchor position and type from context.
     */
    function getAnchorInfo(ctx: AIActionContext, actionId: string, view: EditorView) {
        const shouldReplace = ctx.isReplace ?? isReplaceAction(actionId);

        let anchorPos: number;
        let anchorType: 'after' | 'replace';
        let replaceFrom: number | undefined;
        let replaceTo: number | undefined;

        if (shouldReplace && ctx.selectionStart !== undefined && ctx.selectionEnd !== undefined) {
            anchorPos = ctx.selectionStart;
            anchorType = 'replace';
            replaceFrom = ctx.selectionStart;
            replaceTo = ctx.selectionEnd;
        } else if (ctx.cursor !== undefined) {
            anchorPos = ctx.cursor;
            anchorType = 'after';
        } else if (ctx.selectionEnd !== undefined) {
            anchorPos = ctx.selectionEnd;
            anchorType = 'after';
        } else {
            anchorPos = view.state.selection.main.head;
            anchorType = 'after';
        }

        return { anchorPos, anchorType, replaceFrom, replaceTo };
    }

    /**
     * Called when an AI action starts - creates the streaming overlay.
     */
    async function handleActionStart(
        actionId: string,
        ctx: AIActionContext
    ): Promise<void> {
        // Skip special actions
        if (isSpecialAction(actionId)) {
            return;
        }

        const view = getView();
        if (!view) {
            console.warn('[AI] No editor view available for action start');
            return;
        }

        const requestId = ctx.requestId ?? 0;
        const user = getUser?.() ?? defaultUser;

        try {
            const { startStream } = await getStreamingFunctions();
            const streamId = `ai-${actionId}-${requestId}`;
            const anchor = getAnchorInfo(ctx, actionId, view);

            // Start the streaming overlay
            startStream(view, {
                id: streamId,
                type: 'ai',
                anchorPos: anchor.anchorPos,
                anchorType: anchor.anchorType,
                replaceFrom: anchor.replaceFrom,
                replaceTo: anchor.replaceTo,
                owner: {
                    userId: user.userId,
                    userName: user.userName,
                    userColor: user.userColor,
                },
                operation: getOperationLabel(actionId),
            });

            // Track this stream
            activeStreams.set(requestId, {
                streamId,
                actionId,
                ctx,
                hasContent: false,
            });

            console.log(`[AI] Started stream '${streamId}' for '${actionId}'`);
        } catch (err) {
            console.error(`[AI] Failed to start stream for '${actionId}':`, err);
        }
    }

    /**
     * Called with content chunks during streaming - updates the overlay.
     */
    async function handleChunk(
        actionId: string,
        chunk: string,
        ctx: AIActionContext
    ): Promise<void> {
        const requestId = ctx.requestId ?? 0;
        const stream = activeStreams.get(requestId);

        if (!stream) {
            console.warn(`[AI] No active stream for requestId ${requestId}`);
            return;
        }

        const view = getView();
        if (!view) return;

        try {
            const { streamChunk } = await getStreamingFunctions();
            streamChunk(view, stream.streamId, chunk);
            stream.hasContent = true;

            console.log(`[AI] Streamed ${chunk.length} chars to '${stream.streamId}'`);
        } catch (err) {
            console.error(`[AI] Failed to stream chunk:`, err);
        }
    }

    /**
     * Called when an AI action completes - commits the result to the document.
     */
    async function handleAction(
        actionId: string,
        result: unknown,
        ctx: AIActionContext
    ): Promise<boolean> {
        const view = getView();
        if (!view) {
            console.warn('[AI] No editor view available');
            onError?.(actionId, new Error('No editor available'));
            return false;
        }

        const requestId = ctx.requestId ?? 0;

        // Handle synonyms specially - show picker UI
        if (actionId === 'synonyms') {
            // Cancel any active stream for synonyms (they don't use streaming overlay)
            const stream = activeStreams.get(requestId);
            if (stream) {
                try {
                    const { cancelStream } = await getStreamingFunctions();
                    cancelStream(view, stream.streamId);
                    activeStreams.delete(requestId);
                } catch (e) { /* ignore */ }
            }
            const synonyms = extractSynonyms(result);
            if (synonyms.length === 0) {
                console.warn('[AI] No synonyms in result', result);
                onError?.(actionId, new Error('No synonyms found'));
                return false;
            }

            // Determine replacement range
            const replaceFrom = ctx.selectionStart ?? ctx.cursor ?? view.state.selection.main.from;
            const replaceTo = ctx.selectionEnd ?? ctx.cursor ?? view.state.selection.main.to;

            // Show synonym picker
            showSynonymPicker({
                view,
                synonyms,
                original: ctx.selection ?? '',
                replaceFrom,
                replaceTo,
                position: ctx.palettePosition,
                onSelect: (synonym) => {
                    console.log(`[AI] Selected synonym: "${synonym}"`);
                    onSuccess?.(actionId, synonym);
                },
                onDismiss: () => {
                    console.log('[AI] Synonym picker dismissed');
                },
            });

            return true;
        }

        // Handle explainCode specially - show explanation panel
        if (actionId === 'explainCode') {
            // Cancel any active stream for explain (it doesn't use streaming overlay)
            const stream = activeStreams.get(requestId);
            if (stream) {
                try {
                    const { cancelStream } = await getStreamingFunctions();
                    cancelStream(view, stream.streamId);
                    activeStreams.delete(requestId);
                } catch (e) { /* ignore */ }
            }

            const explanation = extractExplanation(result);
            if (!explanation) {
                console.warn('[AI] No explanation in result', result);
                onError?.(actionId, new Error('No explanation found'));
                return false;
            }

            // Show explanation panel
            showExplainPanel({
                view,
                explanation,
                code: ctx.selection,
                position: ctx.palettePosition,
                onDismiss: () => {
                    console.log('[AI] Explanation panel dismissed');
                },
            });

            onSuccess?.(actionId, explanation);
            return true;
        }

        // Other special actions don't get text insertion
        if (isSpecialAction(actionId)) {
            console.log(`[AI] Special action '${actionId}' - no text insertion`);
            return true;
        }

        // Extract the text to insert/replace
        const text = extractResultText(actionId, result);
        if (!text) {
            console.warn(`[AI] No insertable text for action '${actionId}'`, result);

            // Cancel any active stream
            const streamToCancel = activeStreams.get(requestId);
            if (streamToCancel) {
                try {
                    const { cancelStream } = await getStreamingFunctions();
                    cancelStream(view, streamToCancel.streamId);
                    activeStreams.delete(requestId);
                } catch (e) { /* ignore */ }
            }

            onError?.(actionId, new Error('No text in AI response'));
            return false;
        }

        const stream = activeStreams.get(requestId);
        const user = getUser?.() ?? defaultUser;

        try {
            const { startStream, streamChunk, completeStream, commitStream } = await getStreamingFunctions();

            let streamId: string;

            if (stream) {
                // Use existing stream
                streamId = stream.streamId;

                // If we haven't received chunks, stream the full content now
                if (!stream.hasContent) {
                    streamChunk(view, streamId, text);
                }

                // Complete the stream
                completeStream(view, streamId);
            } else {
                // No active stream - create one now (fallback for non-streaming flow)
                streamId = `ai-${actionId}-${Date.now()}`;
                const anchor = getAnchorInfo(ctx, actionId, view);

                startStream(view, {
                    id: streamId,
                    type: 'ai',
                    anchorPos: anchor.anchorPos,
                    anchorType: anchor.anchorType,
                    replaceFrom: anchor.replaceFrom,
                    replaceTo: anchor.replaceTo,
                    owner: {
                        userId: user.userId,
                        userName: user.userName,
                        userColor: user.userColor,
                    },
                    operation: getOperationLabel(actionId),
                });

                streamChunk(view, streamId, text);
                completeStream(view, streamId);
            }

            // Commit to document as single undo step
            const commitResult = commitStream({
                streamId,
                view,
                onCommit: (content: string) => {
                    console.log(`[AI] Committed ${content.length} chars for '${actionId}'`);
                    onSuccess?.(actionId, content);
                },
                onError: (err: Error) => {
                    console.error(`[AI] Commit failed for '${actionId}':`, err);
                    onError?.(actionId, err);
                },
            });

            // Clean up
            activeStreams.delete(requestId);

            return commitResult.success;
        } catch (err) {
            console.error(`[AI] Failed to apply action '${actionId}':`, err);
            activeStreams.delete(requestId);
            onError?.(actionId, err instanceof Error ? err : new Error(String(err)));
            return false;
        }
    }

    /**
     * Cancel an active stream (e.g., on error or user cancellation).
     */
    async function cancelAction(requestId: number): Promise<void> {
        const stream = activeStreams.get(requestId);
        if (!stream) return;

        const view = getView();
        if (!view) return;

        try {
            const { cancelStream } = await getStreamingFunctions();
            cancelStream(view, stream.streamId);
            activeStreams.delete(requestId);
            console.log(`[AI] Cancelled stream '${stream.streamId}'`);
        } catch (err) {
            console.error(`[AI] Failed to cancel stream:`, err);
        }
    }

    return {
        handleActionStart,
        handleChunk,
        handleAction,
        cancelAction,
        extractResultText,
        isReplaceAction,
        isSpecialAction,
    };
}

export type AIActionHandler = ReturnType<typeof createAIActionHandler>;
