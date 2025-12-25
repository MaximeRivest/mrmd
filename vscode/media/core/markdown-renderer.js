/**
 * mrmd Markdown Renderer
 *
 * Parses and renders markdown to HTML.
 */

import { escapeHtml, highlightCode, ansiToHtml } from './utils.js';

/**
 * Parse markdown into blocks.
 */
export function parseMarkdown(text) {
    const blocks = [];
    const lines = text.split('\n');
    let i = 0;

    while (i < lines.length) {
        const fenceMatch = lines[i].match(/^```(\w+)?(?::(\S+))?/);
        if (fenceMatch) {
            const lang = fenceMatch[1] || '';
            const session = fenceMatch[2] || lang || 'default';
            const startLine = i++;
            let content = [];
            while (i < lines.length && !lines[i].match(/^```\s*$/)) {
                content.push(lines[i++]);
            }
            i++;
            blocks.push({
                type: lang === 'repl' ? 'repl' : (lang === 'output' ? 'output' : (lang ? 'code' : 'text')),
                lang,
                session,
                content: content.join('\n'),
                startLine,
                endLine: i - 1
            });
        } else {
            let content = [lines[i++]];
            while (i < lines.length && !lines[i].match(/^```/)) {
                content.push(lines[i++]);
            }
            const text = content.join('\n').trim();
            if (text) blocks.push({ type: 'text', content: text });
        }
    }
    return blocks;
}

/**
 * Convert markdown to HTML (for notebook view).
 */
export function mdToHtml(text) {
    // Use placeholders to avoid regex conflicts
    const placeholders = [];
    function hold(replacement) {
        const id = `\x00MD${placeholders.length}\x00`;
        placeholders.push(replacement);
        return id;
    }

    // First, handle tables (multi-line)
    text = text.replace(/(\|.+\|\n)+/g, (tableBlock) => {
        const rows = tableBlock.trim().split('\n');
        let html = '<table style="border-collapse:collapse;margin:8px 0;width:100%;">';
        rows.forEach((row, i) => {
            if (row.match(/^\|[\s|:-]+\|$/) && row.includes('-')) return;
            const cells = row.split('|').filter((c, idx, arr) => idx > 0 && idx < arr.length - 1);
            const tag = i === 0 ? 'th' : 'td';
            html += '<tr>';
            cells.forEach(cell => {
                html += `<${tag} style="border:1px solid var(--border);padding:6px 10px;">${cell.trim()}</${tag}>`;
            });
            html += '</tr>';
        });
        html += '</table>';
        return hold(html);
    });

    // Inline code - protect first
    text = text.replace(/`([^`]+)`/g, (m, code) =>
        hold(`<code style="background:var(--code-bg);padding:2px 4px;border-radius:3px;">${code}</code>`));

    // Block LaTeX $$...$$ - render with KaTeX if available
    text = text.replace(/\$\$(.+?)\$\$/g, (m, content) => {
        try {
            if (typeof katex !== 'undefined') {
                return hold('<div style="margin:8px 0;text-align:center;">' +
                    katex.renderToString(content, { displayMode: true, throwOnError: false }) + '</div>');
            }
        } catch(e) {}
        return hold('<div style="background:var(--code-bg);padding:8px 12px;border-radius:4px;text-align:center;font-family:serif;margin:8px 0;">' + content + '</div>');
    });

    // Inline LaTeX $...$ - render with KaTeX if available
    text = text.replace(/\$([^$\n]+?)\$/g, (m, content) => {
        try {
            if (typeof katex !== 'undefined') {
                return hold(katex.renderToString(content, { displayMode: false, throwOnError: false }));
            }
        } catch(e) {}
        return hold('<span style="background:var(--code-bg);padding:1px 4px;border-radius:2px;font-family:serif;">' + content + '</span>');
    });

    // Images - BEFORE links
    text = text.replace(/!\[([^\]]*)\]\(([^)]+)\)/g, (m, alt, url) =>
        hold(`<img src="${url}" alt="${alt}" style="max-width:100%;border-radius:4px;">`));

    // Links
    text = text.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (m, txt, url) =>
        hold(`<a href="${url}" style="color:var(--accent);" target="_blank">${txt}</a>`));

    let html = text
        // Headings
        .replace(/^###### (.+)$/gm, '<h6>$1</h6>')
        .replace(/^##### (.+)$/gm, '<h5>$1</h5>')
        .replace(/^#### (.+)$/gm, '<h4>$1</h4>')
        .replace(/^### (.+)$/gm, '<h3>$1</h3>')
        .replace(/^## (.+)$/gm, '<h2>$1</h2>')
        .replace(/^# (.+)$/gm, '<h1>$1</h1>')
        // Horizontal rules
        .replace(/^(---+|\*\*\*+|___+)$/gm, '<hr>')
        // Blockquotes
        .replace(/^> (.+)$/gm, '<blockquote style="border-left:3px solid var(--border);padding-left:10px;color:var(--muted);margin:4px 0;font-style:italic;">$1</blockquote>')
        // Lists
        .replace(/^[-*] (.+)$/gm, '<li>$1</li>')
        .replace(/^\d+\. (.+)$/gm, '<li>$1</li>')
        .replace(/(<li>.*<\/li>\n?)+/g, '<ul style="margin:8px 0;padding-left:20px;">$&</ul>')
        // Bold & italic
        .replace(/\*\*\*([^*]+)\*\*\*/g, '<strong><em>$1</em></strong>')
        .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
        .replace(/\*([^*]+)\*/g, '<em>$1</em>')
        // Strikethrough
        .replace(/~~([^~]+)~~/g, '<del>$1</del>')
        // Paragraphs
        .replace(/\n\n/g, '<br><br>');

    // Restore placeholders
    for (let i = 0; i < placeholders.length; i++) {
        html = html.replace(`\x00MD${i}\x00`, placeholders[i]);
    }

    return html;
}

/**
 * Render block backgrounds with transparent text for overlay alignment.
 */
export function renderBlockBackgrounds(text) {
    const lines = text.split('\n');
    let html = '';
    let inCodeBlock = false;
    let blockClass = '';
    let blockLines = [];

    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        const openFence = line.match(/^```(\w+)/);
        const closeFence = line.match(/^```\s*$/);

        if (openFence && !inCodeBlock) {
            inCodeBlock = true;
            const isOutput = openFence[1] === 'output';
            blockClass = isOutput ? 'bg-output-block' : 'bg-code-block';
            blockLines = [line];
            continue;
        }

        if (inCodeBlock) {
            blockLines.push(line);
            if (closeFence) {
                html += `<span class="${blockClass}">${escapeHtml(blockLines.join('\n'))}</span>`;
                inCodeBlock = false;
                blockClass = '';
                blockLines = [];
            }
            continue;
        }

        html += `<span class="bg-text">${escapeHtml(line)}</span>\n`;
    }

    if (inCodeBlock && blockLines.length > 0) {
        html += `<span class="${blockClass}">${escapeHtml(blockLines.join('\n'))}</span>`;
    }

    return html;
}

export { highlightCode, ansiToHtml };
