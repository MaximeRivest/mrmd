/**
 * Terminal Features Module
 *
 * Additional features for the terminal:
 * - Search in terminal history
 * - Copy with formatting (ANSI codes, HTML, or plain text)
 * - Hyperlink support (OSC 8)
 * - Selection utilities
 */

/**
 * Terminal Search Manager
 *
 * Provides search functionality for xterm.js terminals.
 * Uses the xterm-addon-search when available, falls back to buffer search.
 */
export class TerminalSearch {
    /**
     * @param {Terminal} terminal - xterm.js Terminal instance
     */
    constructor(terminal) {
        this.terminal = terminal;
        this.searchAddon = null;
        this.currentQuery = '';
        this.matches = [];
        this.currentMatchIndex = -1;
        this.decorations = [];

        // Try to load search addon
        this._initSearchAddon();
    }

    /**
     * Initialize xterm search addon if available.
     */
    _initSearchAddon() {
        if (window.SearchAddon?.SearchAddon) {
            this.searchAddon = new window.SearchAddon.SearchAddon();
            this.terminal.loadAddon(this.searchAddon);
        }
    }

    /**
     * Search for text in the terminal.
     * @param {string} query - Search query
     * @param {Object} options - Search options
     * @param {boolean} options.caseSensitive - Case sensitive search
     * @param {boolean} options.wholeWord - Match whole words only
     * @param {boolean} options.regex - Treat query as regex
     * @returns {number} Number of matches found
     */
    search(query, options = {}) {
        this.currentQuery = query;
        this.clearHighlights();

        if (!query) {
            return 0;
        }

        // Use search addon if available
        if (this.searchAddon) {
            const found = this.searchAddon.findNext(query, {
                caseSensitive: options.caseSensitive,
                wholeWord: options.wholeWord,
                regex: options.regex,
                decorations: {
                    matchBackground: '#ffff0066',
                    activeMatchBackground: '#ff990066',
                    matchOverviewRuler: '#ffff00',
                    activeMatchColorOverviewRuler: '#ff9900',
                },
            });
            return found ? 1 : 0; // Addon doesn't return count
        }

        // Fallback: manual buffer search
        return this._searchBuffer(query, options);
    }

    /**
     * Find next match.
     * @returns {boolean} True if found
     */
    findNext() {
        if (this.searchAddon) {
            return this.searchAddon.findNext(this.currentQuery);
        }

        if (this.matches.length === 0) return false;

        this.currentMatchIndex = (this.currentMatchIndex + 1) % this.matches.length;
        this._scrollToMatch(this.currentMatchIndex);
        return true;
    }

    /**
     * Find previous match.
     * @returns {boolean} True if found
     */
    findPrevious() {
        if (this.searchAddon) {
            return this.searchAddon.findPrevious(this.currentQuery);
        }

        if (this.matches.length === 0) return false;

        this.currentMatchIndex = this.currentMatchIndex <= 0
            ? this.matches.length - 1
            : this.currentMatchIndex - 1;
        this._scrollToMatch(this.currentMatchIndex);
        return true;
    }

    /**
     * Clear search highlights.
     */
    clearHighlights() {
        if (this.searchAddon) {
            this.searchAddon.clearDecorations();
        }

        // Clear manual decorations
        for (const decoration of this.decorations) {
            decoration.dispose?.();
        }
        this.decorations = [];
        this.matches = [];
        this.currentMatchIndex = -1;
    }

    /**
     * Search buffer manually (fallback).
     */
    _searchBuffer(query, options = {}) {
        const buffer = this.terminal.buffer.active;
        const regex = options.regex
            ? new RegExp(query, options.caseSensitive ? 'g' : 'gi')
            : new RegExp(this._escapeRegex(query), options.caseSensitive ? 'g' : 'gi');

        this.matches = [];

        for (let y = 0; y < buffer.length; y++) {
            const line = buffer.getLine(y);
            if (!line) continue;

            const text = line.translateToString();
            let match;

            while ((match = regex.exec(text)) !== null) {
                this.matches.push({
                    row: y,
                    col: match.index,
                    length: match[0].length,
                });
            }
        }

        if (this.matches.length > 0) {
            this.currentMatchIndex = 0;
            this._scrollToMatch(0);
        }

        return this.matches.length;
    }

    /**
     * Scroll to a match.
     */
    _scrollToMatch(index) {
        const match = this.matches[index];
        if (!match) return;

        const buffer = this.terminal.buffer.active;
        const viewportY = match.row - Math.floor(this.terminal.rows / 2);
        this.terminal.scrollToLine(Math.max(0, viewportY));
    }

    /**
     * Escape regex special characters.
     */
    _escapeRegex(string) {
        return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    }

    /**
     * Dispose of the search manager.
     */
    dispose() {
        this.clearHighlights();
        this.searchAddon?.dispose?.();
    }
}

/**
 * Terminal Copy Manager
 *
 * Provides copy functionality with different formats.
 */
export class TerminalCopy {
    /**
     * @param {Terminal} terminal - xterm.js Terminal instance
     */
    constructor(terminal) {
        this.terminal = terminal;
    }

    /**
     * Get selected text as plain text.
     * @returns {string}
     */
    getSelectionText() {
        return this.terminal.getSelection();
    }

    /**
     * Get selected text with ANSI escape codes.
     * @returns {string}
     */
    getSelectionWithAnsi() {
        const selection = this.terminal.getSelectionPosition();
        if (!selection) return '';

        const buffer = this.terminal.buffer.active;
        let result = '';

        for (let y = selection.start.y; y <= selection.end.y; y++) {
            const line = buffer.getLine(y);
            if (!line) continue;

            const startCol = y === selection.start.y ? selection.start.x : 0;
            const endCol = y === selection.end.y ? selection.end.x : line.length;

            for (let x = startCol; x < endCol; x++) {
                const cell = line.getCell(x);
                if (!cell) continue;

                // Build ANSI escape sequence for cell styling
                const ansi = this._cellToAnsi(cell);
                if (ansi) {
                    result += ansi;
                }
                result += cell.getChars() || ' ';
            }

            if (y < selection.end.y) {
                result += '\n';
            }
        }

        // Reset at end
        result += '\x1b[0m';

        return result;
    }

    /**
     * Get selected text as HTML.
     * @returns {string}
     */
    getSelectionAsHtml() {
        const selection = this.terminal.getSelectionPosition();
        if (!selection) return '';

        const buffer = this.terminal.buffer.active;
        let html = '<pre style="font-family: monospace;">';

        for (let y = selection.start.y; y <= selection.end.y; y++) {
            const line = buffer.getLine(y);
            if (!line) continue;

            const startCol = y === selection.start.y ? selection.start.x : 0;
            const endCol = y === selection.end.y ? selection.end.x : line.length;

            for (let x = startCol; x < endCol; x++) {
                const cell = line.getCell(x);
                if (!cell) continue;

                const char = cell.getChars() || ' ';
                const style = this._cellToStyle(cell);

                if (style) {
                    html += `<span style="${style}">${this._escapeHtml(char)}</span>`;
                } else {
                    html += this._escapeHtml(char);
                }
            }

            if (y < selection.end.y) {
                html += '\n';
            }
        }

        html += '</pre>';
        return html;
    }

    /**
     * Copy selection to clipboard with format.
     * @param {'text'|'ansi'|'html'} format
     * @returns {Promise<boolean>}
     */
    async copyToClipboard(format = 'text') {
        let content;

        switch (format) {
            case 'ansi':
                content = this.getSelectionWithAnsi();
                break;
            case 'html':
                content = this.getSelectionAsHtml();
                break;
            default:
                content = this.getSelectionText();
        }

        if (!content) return false;

        try {
            if (format === 'html' && navigator.clipboard.write) {
                // Write HTML to clipboard with fallback text
                const blob = new Blob([content], { type: 'text/html' });
                const textBlob = new Blob([this.getSelectionText()], { type: 'text/plain' });
                await navigator.clipboard.write([
                    new ClipboardItem({
                        'text/html': blob,
                        'text/plain': textBlob,
                    }),
                ]);
            } else {
                await navigator.clipboard.writeText(content);
            }
            return true;
        } catch (err) {
            console.error('Failed to copy:', err);

            // Fallback for insecure contexts
            return this._fallbackCopy(content);
        }
    }

    /**
     * Fallback copy for insecure contexts.
     */
    _fallbackCopy(text) {
        const textarea = document.createElement('textarea');
        textarea.value = text;
        textarea.style.position = 'fixed';
        textarea.style.opacity = '0';
        document.body.appendChild(textarea);
        textarea.select();

        try {
            const success = document.execCommand('copy');
            document.body.removeChild(textarea);
            return success;
        } catch (err) {
            document.body.removeChild(textarea);
            return false;
        }
    }

    /**
     * Convert cell attributes to ANSI escape sequence.
     */
    _cellToAnsi(cell) {
        const codes = [];

        // Foreground color
        const fg = cell.getFgColor();
        if (fg !== undefined && fg !== -1) {
            if (fg < 16) {
                codes.push(fg < 8 ? 30 + fg : 90 + (fg - 8));
            } else {
                codes.push(38, 5, fg);
            }
        }

        // Background color
        const bg = cell.getBgColor();
        if (bg !== undefined && bg !== -1) {
            if (bg < 16) {
                codes.push(bg < 8 ? 40 + bg : 100 + (bg - 8));
            } else {
                codes.push(48, 5, bg);
            }
        }

        // Attributes
        if (cell.isBold?.()) codes.push(1);
        if (cell.isItalic?.()) codes.push(3);
        if (cell.isUnderline?.()) codes.push(4);
        if (cell.isBlink?.()) codes.push(5);
        if (cell.isInverse?.()) codes.push(7);
        if (cell.isStrikethrough?.()) codes.push(9);

        if (codes.length === 0) return '';

        return `\x1b[${codes.join(';')}m`;
    }

    /**
     * Convert cell attributes to CSS style.
     */
    _cellToStyle(cell) {
        const styles = [];

        // Foreground color
        const fg = cell.getFgColor?.();
        if (fg !== undefined && fg !== -1) {
            styles.push(`color: ${this._colorToHex(fg)}`);
        }

        // Background color
        const bg = cell.getBgColor?.();
        if (bg !== undefined && bg !== -1) {
            styles.push(`background-color: ${this._colorToHex(bg)}`);
        }

        // Attributes
        if (cell.isBold?.()) styles.push('font-weight: bold');
        if (cell.isItalic?.()) styles.push('font-style: italic');
        if (cell.isUnderline?.()) styles.push('text-decoration: underline');
        if (cell.isStrikethrough?.()) styles.push('text-decoration: line-through');

        return styles.join('; ');
    }

    /**
     * Convert color index to hex.
     */
    _colorToHex(color) {
        // Standard 16 colors
        const palette = [
            '#000000', '#cd3131', '#0dbc79', '#e5e510',
            '#2472c8', '#bc3fbc', '#11a8cd', '#e5e5e5',
            '#666666', '#f14c4c', '#23d18b', '#f5f543',
            '#3b8eea', '#d670d6', '#29b8db', '#ffffff',
        ];

        if (color < 16) {
            return palette[color];
        }

        // 256-color: 16-231 = 6x6x6 cube
        if (color < 232) {
            const c = color - 16;
            const r = Math.floor(c / 36);
            const g = Math.floor((c % 36) / 6);
            const b = c % 6;
            const toHex = v => [0, 95, 135, 175, 215, 255][v];
            return `rgb(${toHex(r)}, ${toHex(g)}, ${toHex(b)})`;
        }

        // Grayscale: 232-255
        const gray = 8 + (color - 232) * 10;
        return `rgb(${gray}, ${gray}, ${gray})`;
    }

    /**
     * Escape HTML.
     */
    _escapeHtml(str) {
        return str
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;');
    }
}

/**
 * Hyperlink Manager for OSC 8 support.
 *
 * Handles hyperlinks embedded in terminal output using OSC 8 sequences.
 * Format: ESC ] 8 ; params ; uri ST ... link text ... ESC ] 8 ; ; ST
 */
export class TerminalHyperlinks {
    /**
     * @param {Terminal} terminal - xterm.js Terminal instance
     * @param {HTMLElement} container - Terminal container element
     */
    constructor(terminal, container) {
        this.terminal = terminal;
        this.container = container;
        this.activeLink = null;
        this.linkHandler = null;

        this._init();
    }

    /**
     * Initialize hyperlink handling.
     */
    _init() {
        // Register OSC handler for hyperlinks
        this.terminal.parser?.registerOscHandler?.(8, (data) => {
            return this._handleOsc8(data);
        });

        // Set up click handler
        this._setupClickHandler();

        // Set up hover handler
        this._setupHoverHandler();
    }

    /**
     * Handle OSC 8 (hyperlink) sequence.
     */
    _handleOsc8(data) {
        // Format: params;uri
        // Empty params and uri means end of link
        const parts = data.split(';');
        const params = parts[0] || '';
        const uri = parts.slice(1).join(';');

        if (uri) {
            this.activeLink = { params, uri };
        } else {
            this.activeLink = null;
        }

        return true; // Handled
    }

    /**
     * Set up click handling for links.
     */
    _setupClickHandler() {
        this.container.addEventListener('click', (e) => {
            if (e.target.tagName === 'A' && e.target.dataset.terminalLink) {
                e.preventDefault();
                const uri = e.target.dataset.terminalLink;
                this._openLink(uri, e);
            }
        });
    }

    /**
     * Set up hover handling.
     */
    _setupHoverHandler() {
        this.container.addEventListener('mouseover', (e) => {
            if (e.target.tagName === 'A' && e.target.dataset.terminalLink) {
                this.container.style.cursor = 'pointer';
            }
        });

        this.container.addEventListener('mouseout', (e) => {
            if (e.target.tagName === 'A' && e.target.dataset.terminalLink) {
                this.container.style.cursor = '';
            }
        });
    }

    /**
     * Open a hyperlink.
     */
    _openLink(uri, event) {
        // Security check
        if (!this._isAllowedProtocol(uri)) {
            console.warn('Blocked hyperlink with disallowed protocol:', uri);
            return;
        }

        // Custom handler
        if (this.linkHandler) {
            const handled = this.linkHandler(uri, event);
            if (handled) return;
        }

        // Default: open in new tab
        if (event.ctrlKey || event.metaKey) {
            window.open(uri, '_blank', 'noopener,noreferrer');
        } else {
            // Show confirmation for security
            if (confirm(`Open link?\n\n${uri}`)) {
                window.open(uri, '_blank', 'noopener,noreferrer');
            }
        }
    }

    /**
     * Check if protocol is allowed.
     */
    _isAllowedProtocol(uri) {
        try {
            const url = new URL(uri);
            const allowed = ['http:', 'https:', 'mailto:', 'file:'];
            return allowed.includes(url.protocol);
        } catch {
            // Relative URL or invalid - don't allow
            return false;
        }
    }

    /**
     * Set custom link handler.
     * @param {Function} handler - Handler function(uri, event) => boolean
     */
    setLinkHandler(handler) {
        this.linkHandler = handler;
    }

    /**
     * Dispose of the hyperlink manager.
     */
    dispose() {
        // Nothing to clean up currently
    }
}

/**
 * Create a search UI for a terminal.
 * @param {Terminal} terminal
 * @param {HTMLElement} container
 * @returns {Object} Search UI API
 */
export function createSearchUI(terminal, container) {
    const search = new TerminalSearch(terminal);

    // Create search bar
    const searchBar = document.createElement('div');
    searchBar.className = 'terminal-search-bar';
    searchBar.innerHTML = `
        <input type="text" class="terminal-search-input" placeholder="Search...">
        <span class="terminal-search-count"></span>
        <button class="terminal-search-prev" title="Previous (Shift+Enter)">↑</button>
        <button class="terminal-search-next" title="Next (Enter)">↓</button>
        <button class="terminal-search-close" title="Close (Escape)">×</button>
    `;
    searchBar.style.display = 'none';

    container.insertBefore(searchBar, container.firstChild);

    const input = searchBar.querySelector('.terminal-search-input');
    const countSpan = searchBar.querySelector('.terminal-search-count');
    const prevBtn = searchBar.querySelector('.terminal-search-prev');
    const nextBtn = searchBar.querySelector('.terminal-search-next');
    const closeBtn = searchBar.querySelector('.terminal-search-close');

    let matchCount = 0;

    const updateCount = (count) => {
        matchCount = count;
        countSpan.textContent = count > 0 ? `${count} match${count > 1 ? 'es' : ''}` : '';
    };

    const doSearch = () => {
        const count = search.search(input.value);
        updateCount(count);
    };

    input.addEventListener('input', doSearch);

    input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
            if (e.shiftKey) {
                search.findPrevious();
            } else {
                search.findNext();
            }
        } else if (e.key === 'Escape') {
            hide();
        }
    });

    prevBtn.addEventListener('click', () => search.findPrevious());
    nextBtn.addEventListener('click', () => search.findNext());
    closeBtn.addEventListener('click', () => hide());

    const show = () => {
        searchBar.style.display = 'flex';
        input.focus();
        input.select();
    };

    const hide = () => {
        searchBar.style.display = 'none';
        search.clearHighlights();
        updateCount(0);
        terminal.focus();
    };

    const toggle = () => {
        if (searchBar.style.display === 'none') {
            show();
        } else {
            hide();
        }
    };

    return {
        show,
        hide,
        toggle,
        search,
        dispose: () => {
            search.dispose();
            searchBar.remove();
        },
    };
}

/**
 * Add search CSS styles to document.
 */
export function injectSearchStyles() {
    if (document.getElementById('terminal-search-styles')) return;

    const style = document.createElement('style');
    style.id = 'terminal-search-styles';
    style.textContent = `
        .terminal-search-bar {
            display: flex;
            align-items: center;
            gap: 8px;
            padding: 8px 12px;
            background: #252526;
            border-bottom: 1px solid #3c3c3c;
        }

        .terminal-search-input {
            flex: 1;
            padding: 4px 8px;
            background: #3c3c3c;
            border: 1px solid #5c5c5c;
            border-radius: 4px;
            color: #d4d4d4;
            font-size: 13px;
            outline: none;
        }

        .terminal-search-input:focus {
            border-color: #007acc;
        }

        .terminal-search-count {
            color: #888;
            font-size: 12px;
            min-width: 60px;
        }

        .terminal-search-bar button {
            padding: 4px 8px;
            background: #3c3c3c;
            border: 1px solid #5c5c5c;
            border-radius: 4px;
            color: #d4d4d4;
            cursor: pointer;
            font-size: 12px;
        }

        .terminal-search-bar button:hover {
            background: #505050;
        }

        .terminal-search-close {
            font-size: 16px;
            line-height: 1;
        }
    `;
    document.head.appendChild(style);
}

export default {
    TerminalSearch,
    TerminalCopy,
    TerminalHyperlinks,
    createSearchUI,
    injectSearchStyles,
};
