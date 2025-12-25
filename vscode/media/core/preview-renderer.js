/**
 * mrmd Preview Renderer
 *
 * Pure functions for rendering markdown in preview mode.
 * These functions take text and return HTML without touching the DOM.
 */

import { escapeHtml, highlightCode, ansiToHtml } from './utils.js';

/**
 * Highlight markdown text for preview display.
 * @param {string} text - The markdown text to highlight
 * @param {Object} sidecar - The sidecar object containing outputs
 * @returns {string} HTML string
 */
export function highlightMarkdown(text, sidecar = { outputs: {} }) {
    const lines = text.split('\n');
    let html = '';
    let inCodeBlock = false;
    let codeBlockLang = '';
    let codeBlockId = '';
    let codeContent = [];

    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];

        // Code fence start
        const fenceMatch = line.match(/^```(\w+)?(?::(\S+))?/);
        if (fenceMatch && !inCodeBlock) {
            inCodeBlock = true;
            codeBlockLang = fenceMatch[1] || '';
            codeBlockId = `block-${i}`;
            codeContent = [];
            const isOutput = codeBlockLang === 'output';
            const isRepl = codeBlockLang === 'repl';
            html += `<span class="${isOutput ? 'output-block-bg' : 'code-block-bg'}">`;
            html += `<span class="hl-fence">${escapeHtml(line)}</span>\n`;
            continue;
        }

        // Code fence end
        if (line.match(/^```\s*$/) && inCodeBlock) {
            // Render code content
            const content = codeContent.join('\n');
            if (codeBlockLang === 'output') {
                // Check sidecar for styled version
                const styledOutput = sidecar.outputs[codeBlockId]?.styled;
                html += styledOutput ? ansiToHtml(styledOutput) : escapeHtml(content);
            } else if (codeBlockLang === 'repl') {
                html += ansiToHtml(content);
            } else {
                html += highlightCode(content, codeBlockLang);
            }
            html += `\n<span class="hl-fence">${escapeHtml(line)}</span></span>\n`;
            inCodeBlock = false;
            codeBlockLang = '';
            continue;
        }

        // Inside code block
        if (inCodeBlock) {
            codeContent.push(line);
            continue;
        }

        // Markdown line
        html += highlightMarkdownLine(line) + '\n';
    }

    return html;
}

/**
 * Highlight a single markdown line.
 */
export function highlightMarkdownLine(line, context = {}) {
    // Headings
    if (line.match(/^#{1,6}\s/)) {
        return `<span class="hl-heading">${escapeHtml(line)}</span>`;
    }

    // Horizontal rule
    if (line.match(/^(---+|\*\*\*+|___+)$/)) {
        return `<span class="hl-fence">${escapeHtml(line)}</span>`;
    }

    // Table row (starts with |)
    if (line.match(/^\|.+\|$/)) {
        // Check if it's a separator row (contains only |, -, :, and spaces)
        if (line.match(/^\|[\s|:-]+\|$/) && line.includes('-')) {
            return `<span class="hl-table-sep">${escapeHtml(line)}</span>`;
        }
        // Highlight table cells
        const escaped = escapeHtml(line);
        return escaped.replace(/\|/g, '<span class="hl-table-sep">|</span>');
    }

    // Blockquote - highlight the > marker
    const quoteMatch = line.match(/^(>\s*)(.*)/);
    if (quoteMatch) {
        const marker = quoteMatch[1];
        const rest = quoteMatch[2];
        return `<span class="hl-quote-marker">${escapeHtml(marker)}</span><span class="hl-quote-text">${highlightInline(escapeHtml(rest))}</span>`;
    }

    let html = escapeHtml(line);
    return highlightInline(html);
}

/**
 * Highlight inline markdown elements.
 */
export function highlightInline(html) {
    // Use placeholders to avoid regex conflicts
    const placeholders = [];
    function hold(replacement) {
        const id = `\x00${placeholders.length}\x00`;
        placeholders.push(replacement);
        return id;
    }

    // Inline code `code` - extract first to protect contents
    html = html.replace(/`([^`]+)`/g, (m, code) =>
        hold(`<span class="hl-code">\`${code}\`</span>`));

    // Block LaTeX $$...$$ - render with KaTeX
    html = html.replace(/\$\$(.+?)\$\$/g, (m, content) => {
        try {
            if (typeof katex !== 'undefined') {
                return hold('<div class="hl-latex-rendered">' + katex.renderToString(content, { displayMode: true, throwOnError: false }) + '</div>');
            }
        } catch(e) {}
        return hold('<div class="hl-latex">$$' + content + '$$</div>');
    });

    // Inline LaTeX $...$ - render with KaTeX
    html = html.replace(/\$([^$\n]+?)\$/g, (m, content) => {
        try {
            if (typeof katex !== 'undefined') {
                return hold('<span class="hl-latex-rendered">' + katex.renderToString(content, { displayMode: false, throwOnError: false }) + '</span>');
            }
        } catch(e) {}
        return hold('<span class="hl-latex">$' + content + '$</span>');
    });

    // Images ![alt](url) - render actual image
    html = html.replace(/!\[([^\]]*)\]\(([^)]+)\)/g, (m, alt, url) =>
        hold(`<img src="${url}" alt="${alt}" class="hl-inline-img" onerror="this.style.display='none';this.insertAdjacentHTML('afterend','<span class=\\'hl-image\\'>[img not found]</span>')">`));

    // Links [text](url) - render actual link
    html = html.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (m, text, url) =>
        hold(`<a href="${url}" class="hl-link" target="_blank">${text}</a>`));

    // Bold **text**
    html = html.replace(/\*\*([^*]+)\*\*/g, (m, content) =>
        hold(`<strong>${content}</strong>`));

    // Italic *text* (single asterisks, not **)
    html = html.replace(/(?<!\*)\*([^*]+)\*(?!\*)/g, (m, content) =>
        hold(`<em>${content}</em>`));

    // Strikethrough ~~text~~
    html = html.replace(/~~([^~]+)~~/g, (m, content) =>
        hold(`<del>${content}</del>`));

    // List markers - *, -, +, or numbers
    html = html.replace(/^(\s*)([-*+]|\d+\.)\s/, '$1<span class="hl-list-marker">$2</span> ');

    // Restore placeholders
    for (let i = 0; i < placeholders.length; i++) {
        html = html.replace(`\x00${i}\x00`, placeholders[i]);
    }

    return html;
}
