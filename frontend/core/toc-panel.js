/**
 * Table of Contents (TOC) Panel for MRMD Compact Mode
 *
 * ReMarkable/Kindle-inspired TOC that extracts headings from
 * the current document and provides quick navigation.
 *
 * This module provides a content generator for the ToolPanel system.
 */

let editorRef = null;
let onNavigate = null;

// Cache extracted headings to avoid re-parsing on every open
let cachedMarkdown = '';
let cachedHeadings = [];

/**
 * Heading entry structure
 * @typedef {Object} HeadingEntry
 * @property {number} level - Heading level (1-6)
 * @property {string} text - Heading text content
 * @property {number} lineNumber - Line number in the document (0-based)
 * @property {string} id - Generated anchor ID
 */

/**
 * Extract headings from markdown content
 * @param {string} markdown - The markdown content
 * @returns {HeadingEntry[]}
 */
export function extractHeadings(markdown) {
    if (!markdown) return [];

    const headings = [];
    const lines = markdown.split('\n');

    // Track whether we're inside a code block
    let inCodeBlock = false;

    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];

        // Check for code fence (``` or ~~~)
        if (/^(`{3,}|~{3,})/.test(line)) {
            inCodeBlock = !inCodeBlock;
            continue;
        }

        // Skip lines inside code blocks
        if (inCodeBlock) continue;

        // ATX headings: # Heading
        const atxMatch = line.match(/^(#{1,6})\s+(.+?)(?:\s+#+)?$/);
        if (atxMatch) {
            const level = atxMatch[1].length;
            const text = atxMatch[2].trim();
            const id = generateHeadingId(text);
            headings.push({ level, text, lineNumber: i, id });
            continue;
        }

        // Setext headings: Heading followed by === or ---
        if (i > 0 && /^={3,}\s*$/.test(line)) {
            const prevLine = lines[i - 1].trim();
            if (prevLine && !prevLine.startsWith('#')) {
                const id = generateHeadingId(prevLine);
                headings.push({ level: 1, text: prevLine, lineNumber: i - 1, id });
            }
        } else if (i > 0 && /^-{3,}\s*$/.test(line)) {
            const prevLine = lines[i - 1].trim();
            // Make sure it's not a horizontal rule (needs text above)
            if (prevLine && !prevLine.startsWith('#') && !/^[-*_]{3,}$/.test(prevLine)) {
                const id = generateHeadingId(prevLine);
                headings.push({ level: 2, text: prevLine, lineNumber: i - 1, id });
            }
        }
    }

    return headings;
}

/**
 * Generate a URL-friendly ID from heading text
 * @param {string} text
 * @returns {string}
 */
function generateHeadingId(text) {
    return text
        .toLowerCase()
        .replace(/[^\w\s-]/g, '')
        .replace(/\s+/g, '-')
        .replace(/-+/g, '-')
        .replace(/^-|-$/g, '');
}

/**
 * Simple HTML escape
 */
function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

/**
 * Create the TOC panel content element
 * @param {Object} options
 * @param {Object} options.editor - Rich editor instance
 * @param {Function} options.onNavigate - Called when user navigates (to close panel)
 * @returns {HTMLElement}
 */
export function createTOCPanel(options = {}) {
    editorRef = options.editor || null;
    onNavigate = options.onNavigate || (() => {});

    const wrapper = document.createElement('div');
    wrapper.className = 'toc-panel-content';

    // Get current markdown from editor
    let markdown = '';
    if (editorRef && typeof editorRef.getContent === 'function') {
        markdown = editorRef.getContent();
    }

    // Use cached headings if markdown hasn't changed
    let headings;
    if (markdown === cachedMarkdown && cachedHeadings.length > 0) {
        headings = cachedHeadings;
    } else {
        headings = extractHeadings(markdown);
        cachedMarkdown = markdown;
        cachedHeadings = headings;
    }

    if (headings.length === 0) {
        wrapper.innerHTML = '<div class="toc-empty">No headings found</div>';
        return wrapper;
    }

    // Find min level for proper indentation
    const minLevel = Math.min(...headings.map(h => h.level));

    const list = document.createElement('div');
    list.className = 'toc-list';

    headings.forEach((heading, index) => {
        const indent = heading.level - minLevel;

        const item = document.createElement('button');
        item.className = `toc-item toc-level-${heading.level}`;
        item.dataset.line = heading.lineNumber;
        item.dataset.index = index;
        item.style.setProperty('--indent', indent);
        item.tabIndex = 0;

        const text = document.createElement('span');
        text.className = 'toc-text';
        if (heading.level === 1) {
            text.classList.add('toc-text-primary');
        }
        text.textContent = heading.text;
        item.appendChild(text);

        item.addEventListener('click', () => {
            navigateToLine(heading.lineNumber);
        });

        list.appendChild(item);
    });

    wrapper.appendChild(list);

    // Add keyboard navigation
    wrapper.addEventListener('keydown', (e) => {
        const items = wrapper.querySelectorAll('.toc-item');
        if (items.length === 0) return;

        const focused = wrapper.querySelector('.toc-item:focus');
        let currentIndex = focused ? Array.from(items).indexOf(focused) : -1;

        if (e.key === 'ArrowDown') {
            e.preventDefault();
            const nextIndex = Math.min(currentIndex + 1, items.length - 1);
            items[nextIndex].focus();
        } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            const prevIndex = Math.max(currentIndex - 1, 0);
            items[prevIndex].focus();
        } else if (e.key === 'Enter' && focused) {
            e.preventDefault();
            focused.click();
        }
    });

    // Focus first item after a short delay
    requestAnimationFrame(() => {
        const firstItem = wrapper.querySelector('.toc-item');
        if (firstItem) {
            firstItem.focus();
        }
    });

    return wrapper;
}

/**
 * Navigate to a specific line in the editor
 * @param {number} lineNumber - 0-based line number
 */
function navigateToLine(lineNumber) {
    if (!editorRef) {
        console.warn('[TOCPanel] No editor reference');
        if (onNavigate) onNavigate();
        return;
    }

    // Try different navigation methods
    if (typeof editorRef.scrollToLine === 'function') {
        editorRef.scrollToLine(lineNumber);
    } else if (typeof editorRef.goToLine === 'function') {
        editorRef.goToLine(lineNumber);
    } else {
        // Fallback: try to scroll to the line element
        const lineEl = editorRef.container?.querySelector(`[data-line="${lineNumber}"]`);
        if (lineEl) {
            lineEl.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }
    }

    // Notify that we navigated (so panel can close)
    if (onNavigate) {
        onNavigate();
    }

    // Focus the editor
    if (typeof editorRef.focus === 'function') {
        editorRef.focus();
    }
}

/**
 * Set the editor reference (for updating after init)
 * @param {Object} editor
 */
export function setEditor(editor) {
    editorRef = editor;
    invalidateCache();
}

/**
 * Invalidate the heading cache (call when document changes)
 */
export function invalidateCache() {
    cachedMarkdown = '';
    cachedHeadings = [];
}

export default {
    createTOCPanel,
    extractHeadings,
    setEditor,
    invalidateCache
};
