/**
 * Explain Panel UI
 *
 * Displays code explanations in a floating panel.
 * Shows markdown-formatted explanations with syntax highlighting.
 */

import type { EditorView } from '@codemirror/view';

export interface ExplainPanelOptions {
    /**
     * The EditorView (for positioning)
     */
    view: EditorView;

    /**
     * The explanation text (markdown)
     */
    explanation: string;

    /**
     * The code being explained
     */
    code?: string;

    /**
     * Screen position for the panel (optional)
     */
    position?: { x: number; y: number } | null;

    /**
     * Called when the panel is dismissed
     */
    onDismiss?: () => void;
}

/**
 * Show an explanation panel.
 */
export function showExplainPanel(options: ExplainPanelOptions): () => void {
    const { view, explanation, code, position, onDismiss } = options;

    // Create panel element
    const panel = document.createElement('div');
    panel.className = 'explain-panel';
    panel.setAttribute('role', 'dialog');
    panel.setAttribute('aria-label', 'Code Explanation');

    // Style the panel
    Object.assign(panel.style, {
        position: 'fixed',
        zIndex: '10000',
        backgroundColor: 'var(--surface, #1e1e1e)',
        border: '1px solid var(--border, #333)',
        borderRadius: '12px',
        boxShadow: '0 8px 24px rgba(0, 0, 0, 0.4)',
        padding: '0',
        maxHeight: '70vh',
        maxWidth: '600px',
        minWidth: '300px',
        width: '500px',
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
    });

    // Header
    const header = document.createElement('div');
    header.className = 'explain-panel-header';
    Object.assign(header.style, {
        padding: '12px 16px',
        borderBottom: '1px solid var(--border, #333)',
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        backgroundColor: 'var(--surface-elevated, #252525)',
    });

    const title = document.createElement('span');
    title.textContent = 'Code Explanation';
    Object.assign(title.style, {
        fontWeight: '600',
        fontSize: '0.95em',
        color: 'var(--text, #fff)',
    });
    header.appendChild(title);

    const closeBtn = document.createElement('button');
    closeBtn.textContent = '×';
    closeBtn.setAttribute('aria-label', 'Close');
    Object.assign(closeBtn.style, {
        background: 'none',
        border: 'none',
        fontSize: '1.4em',
        cursor: 'pointer',
        color: 'var(--text-muted, #888)',
        padding: '0 4px',
        lineHeight: '1',
    });
    closeBtn.addEventListener('click', dismiss);
    closeBtn.addEventListener('mouseenter', () => {
        closeBtn.style.color = 'var(--text, #fff)';
    });
    closeBtn.addEventListener('mouseleave', () => {
        closeBtn.style.color = 'var(--text-muted, #888)';
    });
    header.appendChild(closeBtn);

    panel.appendChild(header);

    // Content container
    const content = document.createElement('div');
    content.className = 'explain-panel-content';
    Object.assign(content.style, {
        padding: '16px',
        overflowY: 'auto',
        flex: '1',
        fontSize: '0.9em',
        lineHeight: '1.6',
        color: 'var(--text, #fff)',
    });

    // If we have the code, show it first
    if (code) {
        const codeSection = document.createElement('div');
        codeSection.className = 'explain-panel-code';
        Object.assign(codeSection.style, {
            marginBottom: '16px',
            padding: '12px',
            backgroundColor: 'var(--code-bg, #0d0d0d)',
            borderRadius: '8px',
            fontFamily: 'var(--font-mono, monospace)',
            fontSize: '0.85em',
            overflow: 'auto',
            maxHeight: '150px',
            whiteSpace: 'pre-wrap',
            color: 'var(--text-muted, #aaa)',
        });
        codeSection.textContent = code;
        content.appendChild(codeSection);
    }

    // Explanation text
    const explanationEl = document.createElement('div');
    explanationEl.className = 'explain-panel-explanation';

    // Simple markdown rendering (paragraphs, code, bold, italic)
    const rendered = renderSimpleMarkdown(explanation);
    explanationEl.innerHTML = rendered;

    content.appendChild(explanationEl);
    panel.appendChild(content);

    // Dismiss function
    function dismiss() {
        panel.remove();
        document.removeEventListener('keydown', handleKeydown);
        onDismiss?.();
    }

    // Keyboard handling
    function handleKeydown(e: KeyboardEvent) {
        if (e.key === 'Escape') {
            e.preventDefault();
            dismiss();
        }
    }

    // Position the panel
    let x = position?.x ?? 100;
    let y = position?.y ?? 100;

    // If no position provided, center on screen
    if (!position) {
        x = (window.innerWidth - 500) / 2;
        y = Math.max(100, (window.innerHeight - 400) / 2);
    }

    // Ensure panel stays in viewport
    const viewportWidth = window.innerWidth;
    const viewportHeight = window.innerHeight;

    panel.style.left = `${Math.max(20, Math.min(x, viewportWidth - 520))}px`;
    panel.style.top = `${Math.max(20, Math.min(y, viewportHeight - 400))}px`;

    // Add to document
    document.body.appendChild(panel);

    // Add event listeners
    document.addEventListener('keydown', handleKeydown);

    // Focus the close button for accessibility
    closeBtn.focus();

    // Return dismiss function
    return dismiss;
}

/**
 * Simple markdown renderer.
 * Handles paragraphs, code blocks, inline code, bold, italic.
 */
function renderSimpleMarkdown(text: string): string {
    if (!text) return '';

    // Escape HTML
    let html = text
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');

    // Code blocks (```...```)
    html = html.replace(/```(\w*)\n?([\s\S]*?)```/g, (_, lang, code) => {
        return `<pre style="background: var(--code-bg, #0d0d0d); padding: 12px; border-radius: 6px; overflow: auto; margin: 12px 0;"><code>${code.trim()}</code></pre>`;
    });

    // Inline code (`...`)
    html = html.replace(/`([^`]+)`/g, '<code style="background: var(--code-bg, #0d0d0d); padding: 2px 6px; border-radius: 4px;">$1</code>');

    // Bold (**...** or __...__)
    html = html.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
    html = html.replace(/__([^_]+)__/g, '<strong>$1</strong>');

    // Italic (*...* or _..._)
    html = html.replace(/\*([^*]+)\*/g, '<em>$1</em>');
    html = html.replace(/_([^_]+)_/g, '<em>$1</em>');

    // Headers (# ... to ######)
    html = html.replace(/^###### (.+)$/gm, '<h6 style="margin: 16px 0 8px 0; font-size: 0.9em;">$1</h6>');
    html = html.replace(/^##### (.+)$/gm, '<h5 style="margin: 16px 0 8px 0; font-size: 0.95em;">$1</h5>');
    html = html.replace(/^#### (.+)$/gm, '<h4 style="margin: 16px 0 8px 0; font-size: 1em;">$1</h4>');
    html = html.replace(/^### (.+)$/gm, '<h3 style="margin: 16px 0 8px 0; font-size: 1.1em;">$1</h3>');
    html = html.replace(/^## (.+)$/gm, '<h2 style="margin: 16px 0 8px 0; font-size: 1.2em;">$1</h2>');
    html = html.replace(/^# (.+)$/gm, '<h1 style="margin: 16px 0 8px 0; font-size: 1.3em;">$1</h1>');

    // Lists (- or *)
    html = html.replace(/^[\-\*] (.+)$/gm, '<li style="margin-left: 20px;">$1</li>');

    // Numbered lists (1. 2. etc)
    html = html.replace(/^\d+\. (.+)$/gm, '<li style="margin-left: 20px;">$1</li>');

    // Paragraphs (double newlines)
    html = html.replace(/\n\n+/g, '</p><p style="margin: 12px 0;">');

    // Single newlines to <br> (except in code blocks)
    html = html.replace(/\n/g, '<br>');

    // Wrap in paragraph
    html = `<p style="margin: 12px 0;">${html}</p>`;

    return html;
}

/**
 * Extract explanation from AI result.
 */
export function extractExplanation(result: unknown): string | null {
    if (!result || typeof result !== 'object') {
        return null;
    }

    const r = result as Record<string, unknown>;

    if (typeof r.explanation === 'string') {
        return r.explanation;
    }

    if (typeof r.text === 'string') {
        return r.text;
    }

    if (typeof r.content === 'string') {
        return r.content;
    }

    return null;
}
