/**
 * mrmd Overlay Editor
 *
 * The 3-layer transparent editing system for literate markdown.
 *
 * Layers:
 * 1. Block backgrounds - transparent text, colored backgrounds for code/output blocks
 * 2. Preview - syntax highlighted text
 * 3. Editor - transparent textarea for actual editing, caret visible
 */

import { escapeHtml, highlightCode } from './utils.js';
import { renderBlockBackgrounds } from './markdown-renderer.js';

export class OverlayEditor {
    constructor(container, options = {}) {
        this.container = container;
        this.options = {
            onChange: () => {},
            onExecute: () => {},
            ...options
        };

        this.init();
    }

    init() {
        // Create the three layers
        this.container.innerHTML = `
            <div class="overlay-layer" id="overlay-blocks"></div>
            <div class="overlay-layer editor-base" id="overlay-preview"></div>
            <textarea class="overlay-layer editor-base" id="overlay-editor"></textarea>
        `;

        this.blocksLayer = this.container.querySelector('#overlay-blocks');
        this.previewLayer = this.container.querySelector('#overlay-preview');
        this.editorLayer = this.container.querySelector('#overlay-editor');

        // Sync scroll between layers
        this.editorLayer.addEventListener('scroll', () => this.syncScroll());

        // Render on input
        this.editorLayer.addEventListener('input', () => {
            this.render();
            this.options.onChange(this.getValue());
        });

        // Handle keyboard shortcuts
        this.editorLayer.addEventListener('keydown', (e) => this.handleKeydown(e));
    }

    getValue() {
        return this.editorLayer.value;
    }

    setValue(text) {
        this.editorLayer.value = text;
        this.render();
    }

    focus() {
        this.editorLayer.focus();
    }

    render() {
        const text = this.editorLayer.value;
        const cursorPos = this.editorLayer.selectionStart;

        // Render block backgrounds
        this.blocksLayer.innerHTML = renderBlockBackgrounds(text);

        // Render preview with syntax highlighting
        this.previewLayer.innerHTML = this.highlightMarkdown(text, cursorPos);
    }

    syncScroll() {
        this.blocksLayer.scrollTop = this.editorLayer.scrollTop;
        this.previewLayer.scrollTop = this.editorLayer.scrollTop;
    }

    handleKeydown(e) {
        // Ctrl+Enter to execute block at cursor
        if (e.ctrlKey && e.key === 'Enter') {
            e.preventDefault();
            this.options.onExecute(this.getBlockAtCursor());
        }
    }

    getBlockAtCursor() {
        const text = this.editorLayer.value;
        const cursor = this.editorLayer.selectionStart;
        const lines = text.split('\n');

        let charIndex = 0;
        let currentLine = 0;
        for (let i = 0; i < lines.length; i++) {
            if (charIndex + lines[i].length >= cursor) {
                currentLine = i;
                break;
            }
            charIndex += lines[i].length + 1;
        }

        // Find the code block containing this line
        let blockStart = -1;
        let blockEnd = -1;
        let lang = '';

        for (let i = currentLine; i >= 0; i--) {
            const match = lines[i].match(/^```(\w+)?/);
            if (match && !lines[i].match(/^```\s*$/)) {
                blockStart = i;
                lang = match[1] || '';
                break;
            }
            if (lines[i].match(/^```\s*$/)) {
                break; // We're not in a code block
            }
        }

        if (blockStart >= 0) {
            for (let i = blockStart + 1; i < lines.length; i++) {
                if (lines[i].match(/^```\s*$/)) {
                    blockEnd = i;
                    break;
                }
            }
        }

        if (blockStart >= 0 && blockEnd > blockStart) {
            return {
                lang,
                content: lines.slice(blockStart + 1, blockEnd).join('\n'),
                startLine: blockStart,
                endLine: blockEnd
            };
        }

        return null;
    }

    highlightMarkdown(text, cursorPos) {
        const lines = text.split('\n');
        let html = '';
        let charIndex = 0;
        let inCodeBlock = false;
        let codeBlockLang = '';
        let codeBlockLines = [];
        let codeBlockIsOutput = false;

        for (let i = 0; i < lines.length; i++) {
            const line = lines[i];
            const lineStart = charIndex;
            const cursorInLine = cursorPos >= lineStart && cursorPos <= lineStart + line.length;

            // Code fence start
            const fenceMatch = line.match(/^```(\w+)?(?::(\S+))?/);
            if (fenceMatch && !inCodeBlock) {
                inCodeBlock = true;
                codeBlockLang = fenceMatch[1] || '';
                codeBlockIsOutput = codeBlockLang === 'output';
                const fenceClass = codeBlockIsOutput ? 'fence-line output-fence' : 'fence-line';
                codeBlockLines = [`<span class="${fenceClass}">${escapeHtml(line)}</span>`];
                charIndex += line.length + 1;
                continue;
            }

            // Code fence end
            if (line.match(/^```\s*$/) && inCodeBlock) {
                const fenceClass = codeBlockIsOutput ? 'fence-line output-fence' : 'fence-line';
                codeBlockLines.push(`<span class="${fenceClass}">${escapeHtml(line)}</span>`);
                html += `<span class="code-block-wrapper">${codeBlockLines.join('\n')}</span>\n`;
                inCodeBlock = false;
                codeBlockLang = '';
                codeBlockLines = [];
                charIndex += line.length + 1;
                continue;
            }

            // Inside code block
            if (inCodeBlock) {
                const highlighted = highlightCode(line, codeBlockLang);
                const lineClass = codeBlockIsOutput ? 'output-line' : 'code-line';
                codeBlockLines.push(`<span class="${lineClass}">${highlighted}</span>`);
                charIndex += line.length + 1;
                continue;
            }

            // Regular markdown line
            html += this.highlightMarkdownLine(line, cursorInLine, cursorPos - lineStart) + '\n';
            charIndex += line.length + 1;
        }

        // Handle unclosed code block
        if (inCodeBlock && codeBlockLines.length > 0) {
            html += `<span class="code-block-wrapper">${codeBlockLines.join('\n')}</span>`;
        }

        return html;
    }

    highlightMarkdownLine(line, cursorInLine, cursorOffset) {
        // Heading
        const headingMatch = line.match(/^(#{1,6})\s/);
        if (headingMatch) {
            return `<span class="hl-heading">${escapeHtml(line)}</span>`;
        }

        // List markers
        const listMatch = line.match(/^(\s*[-*+]|\s*\d+\.)\s/);
        if (listMatch) {
            const marker = listMatch[0];
            const rest = line.slice(marker.length);
            return `<span class="hl-list-marker">${escapeHtml(marker)}</span>${this.highlightInline(rest)}`;
        }

        // Blockquote
        if (line.match(/^>/)) {
            return `<span class="hl-muted">${escapeHtml(line)}</span>`;
        }

        return this.highlightInline(line);
    }

    highlightInline(text) {
        let html = escapeHtml(text);

        // Bold
        html = html.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');

        // Italic
        html = html.replace(/\*([^*]+)\*/g, '<em>$1</em>');

        // Inline code
        html = html.replace(/`([^`]+)`/g, '<span class="hl-code-inline">$1</span>');

        // Strikethrough
        html = html.replace(/~~([^~]+)~~/g, '<del>$1</del>');

        return html;
    }
}

export default OverlayEditor;
