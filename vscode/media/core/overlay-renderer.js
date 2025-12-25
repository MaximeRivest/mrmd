/**
 * mrmd Overlay Renderer
 *
 * Pure functions for rendering markdown in overlay mode.
 * These functions take text and return HTML without touching the DOM.
 */

import { escapeHtml, highlightCode } from './utils.js';

/**
 * Overlay-specific highlighting - shows rendered content with edit-on-click.
 * Returns { preview: string, interactive: string }
 */
export function highlightMarkdownOverlay(text, cursorPos) {
    const lines = text.split('\n');
    let previewHtml = '';
    let interactiveHtml = '';
    let charIndex = 0;
    let inCodeBlock = false;
    let codeBlockLang = '';
    let codeBlockLines = [];
    let codeBlockIsOutput = false;
    let inLatexBlock = false;
    let latexBlockLines = [];
    let latexBlockStart = 0;
    let inTable = false;
    let tableLines = [];
    let tableStartLine = 0;

    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        const lineStart = charIndex;
        const lineEnd = charIndex + line.length;
        const cursorInLine = cursorPos >= lineStart && cursorPos <= lineEnd;

        // Table lines - just style them simply, don't collapse
        // (Table collapsing breaks alignment with blocks layer)
        const isTableLine = line.match(/^\|.+\|$/);
        if (isTableLine && !inCodeBlock && !inLatexBlock) {
            // Style table lines with subtle coloring
            previewHtml += `<span style="color:#888;">${escapeHtml(line)}</span>\n`;
            charIndex += line.length + 1;
            continue;
        }

        // LaTeX block start $$
        if (line.match(/^\$\$/) && !inLatexBlock && !inCodeBlock) {
            // Check if it's a single-line block $$...$$
            if (line.match(/^\$\$.+\$\$$/)) {
                // Single line - handle inline
                previewHtml += highlightMarkdownLineOverlay(line, cursorInLine, cursorPos - lineStart) + '\n';
                interactiveHtml += '\n';
                charIndex += line.length + 1;
                continue;
            }
            // Multi-line block starts
            inLatexBlock = true;
            latexBlockLines = [line];
            latexBlockStart = lineStart;
            charIndex += line.length + 1;
            continue;
        }

        // Inside LaTeX block
        if (inLatexBlock) {
            latexBlockLines.push(line);
            // Check for closing $$
            if (line.match(/\$\$\s*$/)) {
                // End of LaTeX block
                const latexBlockEnd = charIndex + line.length;
                const cursorInLatex = cursorPos >= latexBlockStart && cursorPos <= latexBlockEnd;
                const fullLatex = latexBlockLines.join('\n');
                const content = fullLatex.replace(/^\$\$/, '').replace(/\$\$$/, '').trim();

                if (cursorInLatex) {
                    previewHtml += `<span style="color:var(--accent);">${escapeHtml(fullLatex)}</span>\n`;
                } else {
                    let rendered = '';
                    try {
                        if (typeof katex !== 'undefined') {
                            rendered = katex.renderToString(content, { displayMode: true, throwOnError: false });
                        }
                    } catch(e) {}
                    previewHtml += `<span class="overlay-latex-wrapper">`;
                    previewHtml += `<span class="latex-raw" style="color:transparent;">${escapeHtml(fullLatex)}</span>`;
                    if (rendered) {
                        previewHtml += `<span class="latex-rendered">${rendered}</span>`;
                    }
                    previewHtml += `</span>\n`;
                }
                interactiveHtml += '\n'.repeat(latexBlockLines.length);
                inLatexBlock = false;
                latexBlockLines = [];
            }
            charIndex += line.length + 1;
            continue;
        }

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

        // Code fence end - output the whole block wrapped
        if (line.match(/^```\s*$/) && inCodeBlock) {
            const fenceClass = codeBlockIsOutput ? 'fence-line output-fence' : 'fence-line';
            codeBlockLines.push(`<span class="${fenceClass}">${escapeHtml(line)}</span>`);
            previewHtml += `<span class="code-block-wrapper">${codeBlockLines.join('\n')}</span>`;
            interactiveHtml += '\n'.repeat(codeBlockLines.length);
            inCodeBlock = false;
            codeBlockLang = '';
            codeBlockLines = [];
            charIndex += line.length + 1;
            continue;
        }

        // Inside code block - collect lines
        if (inCodeBlock) {
            const highlighted = highlightCode(line, codeBlockLang);
            const lineClass = codeBlockIsOutput ? 'output-line' : 'code-line';
            codeBlockLines.push(`<span class="${lineClass}">${highlighted}</span>`);
            charIndex += line.length + 1;
            continue;
        }

        // Regular markdown line
        previewHtml += highlightMarkdownLineOverlay(line, cursorInLine, cursorPos - lineStart) + '\n';
        interactiveHtml += '\n';
        charIndex += line.length + 1;
    }

    // Handle unclosed code block
    if (inCodeBlock && codeBlockLines.length > 0) {
        previewHtml += `<span class="code-block-wrapper">${codeBlockLines.join('\n')}</span>`;
    }

    // Handle unclosed LaTeX block
    if (inLatexBlock && latexBlockLines.length > 0) {
        previewHtml += `<span style="color:var(--accent);">${escapeHtml(latexBlockLines.join('\n'))}</span>\n`;
    }

    return { preview: previewHtml, interactive: interactiveHtml };
}

/**
 * Highlight a single markdown line for overlay mode.
 */
export function highlightMarkdownLineOverlay(line, cursorInLine, cursorCol) {
    let html = '';
    let i = 0;

    while (i < line.length) {
        const remaining = line.slice(i);
        const cursorHere = cursorInLine && cursorCol >= i;

        // Headings - render with overlay-special
        if (i === 0) {
            const h1 = remaining.match(/^# (.+)$/);
            const h2 = remaining.match(/^## (.+)$/);
            const h3 = remaining.match(/^### (.+)$/);
            const h4 = remaining.match(/^#{4,6} (.+)$/);

            if (h1 || h2 || h3 || h4) {
                const match = h4 || h3 || h2 || h1;
                const level = h1 ? 1 : h2 ? 2 : h3 ? 3 : 4;
                const content = match[1];
                const styles = {
                    1: 'font-size:1.8em;font-weight:bold;color:var(--accent);',
                    2: 'font-size:1.4em;font-weight:bold;color:var(--accent);',
                    3: 'font-size:1.2em;font-weight:bold;color:var(--text);',
                    4: 'font-size:1em;font-weight:bold;color:var(--muted);'
                };

                if (cursorInLine) {
                    html += `<span class="hl-heading">${escapeHtml(line)}</span>`;
                } else {
                    html += `<span class="overlay-special">`;
                    html += `<span class="overlay-raw">${escapeHtml(line)}</span>`;
                    html += `<span class="overlay-rendered" style="${styles[level]}">${escapeHtml(content)}</span>`;
                    html += `</span>`;
                }
                return html;
            }

            // List items - render with bullet
            const listMatch = remaining.match(/^(\s*)([-*+]|\d+\.)\s(.+)$/);
            if (listMatch) {
                const indent = listMatch[1];
                const marker = listMatch[2];
                const content = listMatch[3];
                const isOrdered = /\d+\./.test(marker);

                if (cursorInLine) {
                    html += escapeHtml(indent);
                    html += `<span class="hl-list-marker">${escapeHtml(marker)}</span> `;
                    i = indent.length + marker.length + 1;
                    continue;
                } else {
                    const bullet = isOrdered ? marker : '•';
                    html += `<span class="overlay-special">`;
                    html += `<span class="overlay-raw">${escapeHtml(line)}</span>`;
                    html += `<span class="overlay-rendered">${indent}${bullet} ${highlightInlineContent(content)}</span>`;
                    html += `</span>`;
                    return html;
                }
            }

            // Blockquotes
            const quoteMatch = remaining.match(/^>\s?(.*)$/);
            if (quoteMatch) {
                const content = quoteMatch[1];

                if (cursorInLine) {
                    html += `<span class="hl-quote-marker">&gt;</span>`;
                    i = 1;
                    continue;
                } else {
                    html += `<span class="overlay-special">`;
                    html += `<span class="overlay-raw">${escapeHtml(line)}</span>`;
                    html += `<span class="overlay-rendered" style="border-left:3px solid var(--accent);padding-left:8px;color:var(--muted);font-style:italic;">${highlightInlineContent(content)}</span>`;
                    html += `</span>`;
                    return html;
                }
            }

            // Horizontal rule
            const hrMatch = remaining.match(/^(---+|\*\*\*+|___+)$/);
            if (hrMatch) {
                html += `<span style="color:var(--border);">${escapeHtml(line)}</span>`;
                return html;
            }
        }

        // Block LaTeX $$...$$ - use wrapper with placeholder space
        const blockLatex = remaining.match(/^\$\$(.+?)\$\$/);
        if (blockLatex) {
            const full = blockLatex[0];
            const content = blockLatex[1];
            let rendered = '';
            try {
                if (typeof katex !== 'undefined') {
                    rendered = katex.renderToString(content, { displayMode: true, throwOnError: false });
                }
            } catch(e) {}

            html += `<span class="overlay-latex-wrapper${cursorInLine ? ' hl-cursor-in' : ''}">`;
            html += `<span class="latex-raw">${escapeHtml(full)}</span>`;
            if (rendered) {
                html += `<span class="latex-rendered">${rendered}</span>`;
            }
            html += `</span>`;
            i += full.length;
            continue;
        }

        // Inline LaTeX $...$ - render inline, show raw when cursor on line
        const inlineLatex = remaining.match(/^\$([^$\n]+?)\$/);
        if (inlineLatex) {
            const full = inlineLatex[0];
            const content = inlineLatex[1];
            if (cursorInLine) {
                // Show raw in same font, accent color
                html += `<span style="color:var(--accent);">${escapeHtml(full)}</span>`;
            } else {
                // Render inline - small enough to fit in line
                try {
                    if (typeof katex !== 'undefined') {
                        html += katex.renderToString(content, { displayMode: false, throwOnError: false });
                    } else {
                        html += `<span style="color:var(--accent);">${escapeHtml(full)}</span>`;
                    }
                } catch(e) {
                    html += `<span style="color:var(--accent);">${escapeHtml(full)}</span>`;
                }
            }
            i += full.length;
            continue;
        }

        // Images ![alt](url) - show image over placeholder lines, raw when cursor on line
        const img = remaining.match(/^!\[([^\]]*)\]\(([^)]+)\)/);
        if (img) {
            const full = img[0];
            const alt = img[1];
            const url = img[2];
            html += `<span class="overlay-image-wrapper${cursorInLine ? ' hl-cursor-in' : ''}">`;
            html += `<span class="img-raw">${escapeHtml(full)}</span>`;
            html += `<img src="${escapeHtml(url)}" alt="${escapeHtml(alt)}">`;
            html += `</span>`;
            i += full.length;
            continue;
        }

        // Links [text](url) - show rendered unless cursor on line
        const link = remaining.match(/^\[([^\]]+)\]\(([^)]+)\)/);
        if (link) {
            const full = link[0];
            const text = link[1];
            const url = link[2];
            if (cursorInLine) {
                html += `<span class="hl-muted">[</span>${escapeHtml(text)}<span class="hl-muted">](${escapeHtml(url)})</span>`;
            } else {
                html += `<a href="${escapeHtml(url)}" style="color:var(--accent);text-decoration:underline;">${escapeHtml(text)}</a>`;
            }
            i += full.length;
            continue;
        }

        // Bold **text** - show rendered unless cursor on line
        const bold = remaining.match(/^\*\*([^*]+)\*\*/);
        if (bold) {
            const full = bold[0];
            const content = bold[1];
            if (cursorInLine) {
                html += `<span class="hl-muted">**</span><strong>${escapeHtml(content)}</strong><span class="hl-muted">**</span>`;
            } else {
                html += `<strong>${escapeHtml(content)}</strong>`;
            }
            i += full.length;
            continue;
        }

        // Italic *text*
        const italic = remaining.match(/^\*([^*]+)\*/);
        if (italic) {
            const full = italic[0];
            const content = italic[1];
            if (cursorInLine) {
                html += `<span class="hl-muted">*</span><em>${escapeHtml(content)}</em><span class="hl-muted">*</span>`;
            } else {
                html += `<em>${escapeHtml(content)}</em>`;
            }
            i += full.length;
            continue;
        }

        // Strikethrough ~~text~~
        const strike = remaining.match(/^~~([^~]+)~~/);
        if (strike) {
            const full = strike[0];
            const content = strike[1];
            if (cursorInLine) {
                html += `<span class="hl-muted">~~</span><del>${escapeHtml(content)}</del><span class="hl-muted">~~</span>`;
            } else {
                html += `<del>${escapeHtml(content)}</del>`;
            }
            i += full.length;
            continue;
        }

        // Inline code `code` - same font always to preserve alignment
        const code = remaining.match(/^`([^`]+)`/);
        if (code) {
            const full = code[0];
            const content = code[1];
            if (cursorInLine) {
                // Show raw with just color, no background change
                html += `<span style="color:var(--muted);">\`</span><span style="color:var(--accent);">${escapeHtml(content)}</span><span style="color:var(--muted);">\`</span>`;
            } else {
                html += `<code class="hl-code-inline">${escapeHtml(content)}</code>`;
            }
            i += full.length;
            continue;
        }

        // Blockquote marker
        if (i === 0 && remaining.startsWith('>')) {
            html += `<span class="hl-quote-marker">&gt;</span>`;
            i++;
            continue;
        }

        // Regular character
        const ch = line[i];
        html += ch === '<' ? '&lt;' : ch === '>' ? '&gt;' : ch === '&' ? '&amp;' : ch;
        i++;
    }

    return html;
}

/**
 * Helper to render inline content (for lists, blockquotes) without cursor tracking.
 */
export function highlightInlineContent(text) {
    // Use placeholders to handle LaTeX before escaping
    const latexPlaceholders = [];

    // Extract and render LaTeX first (before HTML escaping)
    text = text.replace(/\$([^$\n]+?)\$/g, (m, content) => {
        let rendered = m; // fallback to raw
        try {
            if (typeof katex !== 'undefined') {
                rendered = katex.renderToString(content, { displayMode: false, throwOnError: false });
            }
        } catch(e) {}
        const id = `\x00LATEX${latexPlaceholders.length}\x00`;
        latexPlaceholders.push(rendered);
        return id;
    });

    let html = escapeHtml(text);
    // Bold
    html = html.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
    // Italic
    html = html.replace(/\*([^*]+)\*/g, '<em>$1</em>');
    // Strikethrough
    html = html.replace(/~~([^~]+)~~/g, '<del>$1</del>');
    // Inline code
    html = html.replace(/`([^`]+)`/g, '<code style="background:var(--code-bg);padding:1px 4px;border-radius:3px;">$1</code>');
    // Links
    html = html.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" style="color:var(--accent);">$1</a>');

    // Restore LaTeX
    for (let i = 0; i < latexPlaceholders.length; i++) {
        html = html.replace(`\x00LATEX${i}\x00`, latexPlaceholders[i]);
    }
    return html;
}

/**
 * Render special overlay elements with raw text hidden and rendered content on top.
 */
export function renderOverlaySpecial(rawText, type, data, cursorIn) {
    let rendered = '';

    if (type === 'latex' || type === 'latex-block') {
        try {
            if (typeof katex !== 'undefined') {
                rendered = katex.renderToString(data, {
                    displayMode: type === 'latex-block',
                    throwOnError: false
                });
            }
        } catch(e) {}
    } else if (type === 'image') {
        rendered = `<img src="${escapeHtml(data.url)}" alt="${escapeHtml(data.alt)}" style="max-height:80px;border-radius:3px;">`;
    } else if (type === 'link') {
        rendered = `<a href="${escapeHtml(data.url)}" style="color:var(--accent);text-decoration:underline;">${escapeHtml(data.text)}</a>`;
    } else if (type === 'bold') {
        rendered = `<strong>${escapeHtml(data)}</strong>`;
    } else if (type === 'italic') {
        rendered = `<em>${escapeHtml(data)}</em>`;
    } else if (type === 'strike') {
        rendered = `<del>${escapeHtml(data)}</del>`;
    } else if (type === 'code') {
        rendered = `<code style="background:var(--code-bg);padding:1px 4px;border-radius:3px;">${escapeHtml(data)}</code>`;
    }

    if (rendered) {
        return `<span class="overlay-special${cursorIn ? ' hl-cursor-in' : ''}">` +
               `<span class="overlay-raw">${escapeHtml(rawText)}</span>` +
               `<span class="overlay-rendered">${rendered}</span>` +
               `</span>`;
    } else {
        // Fallback to simple colored text
        return `<span class="hl-${type}">${escapeHtml(rawText)}</span>`;
    }
}

/**
 * Render table as styled text (maintains alignment with raw markdown).
 */
export function renderStyledTable(lines) {
    // Render each table line as styled spans
    let html = '';
    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        const isSeparator = line.match(/^\|[\s|:-]+\|$/);
        const isHeader = i === 0;

        if (isSeparator) {
            // Separator line - dim color
            html += `<span class="table-separator">${escapeHtml(line)}</span>`;
        } else if (isHeader) {
            // Header line - bold/colored
            html += `<span class="table-header">${escapeHtml(line)}</span>`;
        } else {
            // Data row
            html += `<span class="table-row">${escapeHtml(line)}</span>`;
        }
        if (i < lines.length - 1) html += '\n';
    }
    return html;
}

/**
 * Parse a markdown table from lines.
 */
export function parseMarkdownTable(lines) {
    if (lines.length < 2) return null;
    const headers = lines[0].split('|').filter((c, i, arr) => i > 0 && i < arr.length - 1);
    if (!lines[1].match(/^\|[\s|:-]+\|$/) || !lines[1].includes('-')) return null;
    const rows = lines.slice(2).map(l => l.split('|').filter((c, i, arr) => i > 0 && i < arr.length - 1));
    return { headers, rows };
}
