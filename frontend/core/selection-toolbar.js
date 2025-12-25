/**
 * Selection Toolbar - Floating formatting toolbar that appears on text selection
 *
 * Jony Ive's vision: "The text offers itself to become bold. You accept. Done."
 *
 * This replaces the sidebar formatting panel with a contextual, selection-triggered
 * toolbar that appears near the selected text. The document stays the hero.
 */

// Platform detection for keyboard shortcut display
const isMac = typeof navigator !== 'undefined' && /Mac|iPod|iPhone|iPad/.test(navigator.platform);
const modKey = isMac ? '⌘' : 'Ctrl';

// Formatting actions - minimal set for inline formatting
const INLINE_ACTIONS = [
    { id: 'bold', icon: 'B', title: 'Bold', shortcut: 'B', markdown: ['**', '**'], className: 'bold' },
    { id: 'italic', icon: 'I', title: 'Italic', shortcut: 'I', markdown: ['*', '*'], className: 'italic' },
    { id: 'code', icon: '`', title: 'Code', shortcut: 'E', markdown: ['`', '`'], className: 'code' },
    { id: 'strike', icon: 'S', title: 'Strikethrough', shortcut: 'Shift+S', markdown: ['~~', '~~'], className: 'strike' },
    { id: 'link', icon: '🔗', title: 'Link', shortcut: 'K', action: 'link', className: 'link' },
];

// State
let toolbarEl = null;
let linkInputEl = null;
let editor = null;
let isVisible = false;
let hideTimeout = null;
let currentSelection = null;
let linkMode = false;

/**
 * Initialize the selection toolbar
 * @param {HTMLElement} container - Container element to append toolbar to
 * @param {Object} editorInstance - Rich editor instance
 */
export function initSelectionToolbar(container, editorInstance) {
    editor = editorInstance;

    // Setup keyboard shortcuts (work even when toolbar not visible)
    setupKeyboardShortcuts();

    // Create toolbar element
    toolbarEl = document.createElement('div');
    toolbarEl.className = 'selection-toolbar';
    toolbarEl.setAttribute('role', 'toolbar');
    toolbarEl.setAttribute('aria-label', 'Text formatting');

    // Create button container
    const buttonsEl = document.createElement('div');
    buttonsEl.className = 'selection-toolbar-buttons';

    // Add formatting buttons
    INLINE_ACTIONS.forEach(action => {
        const btn = document.createElement('button');
        btn.className = `selection-toolbar-btn ${action.className || ''}`;
        btn.dataset.action = action.id;
        btn.title = `${action.title} (${modKey}+${action.shortcut})`;
        btn.setAttribute('aria-label', action.title);
        btn.innerHTML = `<span class="selection-toolbar-icon">${action.icon}</span>`;

        btn.addEventListener('mousedown', (e) => {
            e.preventDefault(); // Prevent stealing focus from selection
            e.stopPropagation();
        });

        btn.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            handleAction(action);
        });

        buttonsEl.appendChild(btn);
    });

    toolbarEl.appendChild(buttonsEl);

    // Create link input (hidden by default)
    linkInputEl = document.createElement('div');
    linkInputEl.className = 'selection-toolbar-link-input';
    linkInputEl.innerHTML = `
        <input type="url" placeholder="Paste or type URL..." aria-label="Link URL">
        <button class="selection-toolbar-link-confirm" title="Apply link">↵</button>
        <button class="selection-toolbar-link-cancel" title="Cancel">×</button>
    `;
    linkInputEl.style.display = 'none';

    // Link input events
    const linkInput = linkInputEl.querySelector('input');
    const confirmBtn = linkInputEl.querySelector('.selection-toolbar-link-confirm');
    const cancelBtn = linkInputEl.querySelector('.selection-toolbar-link-cancel');

    linkInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
            e.preventDefault();
            applyLink(linkInput.value);
        } else if (e.key === 'Escape') {
            e.preventDefault();
            exitLinkMode();
        }
    });

    confirmBtn.addEventListener('click', (e) => {
        e.preventDefault();
        applyLink(linkInput.value);
    });

    cancelBtn.addEventListener('click', (e) => {
        e.preventDefault();
        exitLinkMode();
    });

    // Prevent clicks inside toolbar from hiding it
    linkInputEl.addEventListener('mousedown', (e) => {
        e.preventDefault();
        e.stopPropagation();
    });

    toolbarEl.appendChild(linkInputEl);

    // Prevent toolbar clicks from hiding toolbar
    toolbarEl.addEventListener('mousedown', (e) => {
        e.stopPropagation();
    });

    container.appendChild(toolbarEl);

    // Setup selection monitoring
    setupSelectionMonitoring(container);

    return toolbarEl;
}

/**
 * Setup selection change monitoring
 */
function setupSelectionMonitoring(container) {
    // Listen for selection changes
    document.addEventListener('selectionchange', () => {
        if (linkMode) return; // Don't hide while entering link

        // Debounce slightly to avoid flicker
        clearTimeout(hideTimeout);
        hideTimeout = setTimeout(() => {
            checkSelection(container);
        }, 10);
    });

    // Hide on scroll (will reposition if selection still valid)
    container.addEventListener('scroll', () => {
        if (isVisible && !linkMode) {
            hide();
        }
    }, { passive: true });

    // Hide on click outside
    document.addEventListener('mousedown', (e) => {
        if (isVisible && toolbarEl && !toolbarEl.contains(e.target)) {
            if (linkMode) {
                exitLinkMode();
            }
            hide();
        }
    });

    // Hide on Escape
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && isVisible) {
            if (linkMode) {
                exitLinkMode();
            } else {
                hide();
            }
        }
    });
}

/**
 * Check current selection and show/hide toolbar accordingly
 */
function checkSelection(container) {
    const sel = window.getSelection();

    // Must have a non-collapsed selection
    if (!sel || sel.isCollapsed || sel.rangeCount === 0) {
        hide();
        return;
    }

    const range = sel.getRangeAt(0);
    const selectedText = range.toString().trim();

    // Must have actual text selected
    if (!selectedText) {
        hide();
        return;
    }

    // Selection must be within the editor
    const editorEl = editor?.editorEl;
    if (!editorEl) {
        hide();
        return;
    }

    const startInEditor = editorEl.contains(range.startContainer);
    const endInEditor = editorEl.contains(range.endContainer);

    if (!startInEditor && !endInEditor) {
        hide();
        return;
    }

    // Don't show for selections inside code blocks (they use different formatting)
    const selectionInfo = editor?.getSelectionInfo?.();
    if (selectionInfo?.inCodeBlock) {
        hide();
        return;
    }

    // Store selection for later use
    currentSelection = {
        range: range.cloneRange(),
        text: selectedText
    };

    // Show and position toolbar
    show(container, range);
}

/**
 * Show the toolbar positioned above the selection
 */
function show(container, range) {
    if (!toolbarEl) return;

    const rect = range.getBoundingClientRect();
    const containerRect = container.getBoundingClientRect();

    // Get toolbar dimensions (need to show first to measure)
    toolbarEl.classList.add('visible');
    toolbarEl.classList.remove('below'); // Reset position class
    const toolbarRect = toolbarEl.getBoundingClientRect();

    // Calculate position (center above selection)
    let left = rect.left + (rect.width / 2) - (toolbarRect.width / 2) - containerRect.left;
    let top = rect.top - toolbarRect.height - 8 - containerRect.top + container.scrollTop;

    // Keep within container bounds (horizontal)
    const padding = 8;
    const maxLeft = containerRect.width - toolbarRect.width - padding;
    left = Math.max(padding, Math.min(left, maxLeft));

    // If toolbar would go above viewport, show below selection instead
    const viewportTop = containerRect.top;
    const toolbarTop = rect.top - toolbarRect.height - 8;

    if (toolbarTop < viewportTop + padding) {
        // Position below selection
        top = rect.bottom + 8 - containerRect.top + container.scrollTop;
        toolbarEl.classList.add('below');
    }

    // Apply position
    toolbarEl.style.left = `${left}px`;
    toolbarEl.style.top = `${top}px`;

    isVisible = true;
}

/**
 * Hide the toolbar
 */
function hide() {
    if (!toolbarEl || !isVisible) return;

    toolbarEl.classList.remove('visible');
    toolbarEl.classList.remove('below');
    isVisible = false;
    currentSelection = null;

    if (linkMode) {
        exitLinkMode();
    }
}

/**
 * Handle a formatting action
 */
function handleAction(action) {
    if (!editor || !currentSelection) return;

    if (action.action === 'link') {
        enterLinkMode();
        return;
    }

    // Apply markdown wrapping
    if (action.markdown) {
        const [before, after] = action.markdown;

        // Use editor's wrapSelection if available
        if (editor.wrapSelection) {
            editor.wrapSelection(before, after);
        } else {
            // Fallback: restore selection and use execCommand
            const sel = window.getSelection();
            sel.removeAllRanges();
            sel.addRange(currentSelection.range);
            document.execCommand('insertText', false, before + currentSelection.text + after);
        }

        // Hide toolbar after action
        hide();
    }
}

/**
 * Enter link input mode
 */
function enterLinkMode() {
    if (!linkInputEl) return;

    linkMode = true;

    // Hide buttons, show input
    const buttonsEl = toolbarEl.querySelector('.selection-toolbar-buttons');
    if (buttonsEl) buttonsEl.style.display = 'none';
    linkInputEl.style.display = 'flex';

    // Focus input
    const input = linkInputEl.querySelector('input');
    if (input) {
        input.value = '';
        setTimeout(() => input.focus(), 0);
    }

    // Add link mode class for styling
    toolbarEl.classList.add('link-mode');
}

/**
 * Exit link input mode
 */
function exitLinkMode() {
    if (!linkInputEl) return;

    linkMode = false;

    // Show buttons, hide input
    const buttonsEl = toolbarEl.querySelector('.selection-toolbar-buttons');
    if (buttonsEl) buttonsEl.style.display = 'flex';
    linkInputEl.style.display = 'none';

    // Clear input
    const input = linkInputEl.querySelector('input');
    if (input) input.value = '';

    // Remove link mode class
    toolbarEl.classList.remove('link-mode');
}

/**
 * Apply link to selection
 */
function applyLink(url) {
    if (!editor || !currentSelection || !url.trim()) {
        exitLinkMode();
        return;
    }

    // Clean up URL
    let cleanUrl = url.trim();
    if (cleanUrl && !cleanUrl.match(/^https?:\/\//i) && !cleanUrl.startsWith('#') && !cleanUrl.startsWith('/')) {
        cleanUrl = 'https://' + cleanUrl;
    }

    const linkMarkdown = `[${currentSelection.text}](${cleanUrl})`;

    // Restore selection
    const sel = window.getSelection();
    sel.removeAllRanges();
    sel.addRange(currentSelection.range);

    // Insert link markdown
    if (editor.insertText) {
        // Delete selection first, then insert
        document.execCommand('insertText', false, linkMarkdown);
    } else {
        document.execCommand('insertText', false, linkMarkdown);
    }

    exitLinkMode();
    hide();
}

/**
 * Check if toolbar is currently visible
 */
export function isToolbarVisible() {
    return isVisible;
}

/**
 * Destroy the toolbar
 */
export function destroySelectionToolbar() {
    if (toolbarEl && toolbarEl.parentNode) {
        toolbarEl.parentNode.removeChild(toolbarEl);
    }
    toolbarEl = null;
    linkInputEl = null;
    editor = null;
    isVisible = false;
    currentSelection = null;
    linkMode = false;
}

/**
 * Set the editor instance (for use after initialization)
 */
export function setEditor(editorInstance) {
    editor = editorInstance;
}

/**
 * Setup keyboard shortcuts for inline formatting
 * These work even when the toolbar isn't visible
 */
function setupKeyboardShortcuts() {
    document.addEventListener('keydown', (e) => {
        if (!editor) return;

        const isMod = isMac ? e.metaKey : e.ctrlKey;
        if (!isMod) return;

        // Check if we're in the editor
        const editorEl = editor.editorEl;
        if (!editorEl) return;

        // Only apply shortcuts when focus is in editor or selection spans editor
        const activeInEditor = document.activeElement === editorEl ||
            (editorEl.contains(document.activeElement));
        const selectionInEditor = (() => {
            const sel = window.getSelection();
            if (!sel.rangeCount) return false;
            const range = sel.getRangeAt(0);
            return editorEl.contains(range.startContainer) || editorEl.contains(range.endContainer);
        })();

        if (!activeInEditor && !selectionInEditor) return;

        // Match shortcuts
        for (const action of INLINE_ACTIONS) {
            if (action.shortcut && matchShortcut(e, action.shortcut)) {
                e.preventDefault();

                // For inline formatting that needs selection
                if (action.markdown) {
                    const [before, after] = action.markdown;
                    if (editor.wrapSelection) {
                        editor.wrapSelection(before, after);
                    }
                }
                // For link action
                else if (action.action === 'link') {
                    // Show toolbar with link mode if there's a selection
                    const sel = window.getSelection();
                    if (!sel.isCollapsed && sel.rangeCount > 0) {
                        const range = sel.getRangeAt(0);
                        currentSelection = {
                            range: range.cloneRange(),
                            text: range.toString().trim()
                        };
                        if (currentSelection.text) {
                            // Show toolbar and enter link mode
                            const container = editorEl.closest('.editor-container') || editorEl.parentElement;
                            show(container, range);
                            enterLinkMode();
                        }
                    }
                }
                return;
            }
        }
    });
}

/**
 * Check if keyboard event matches shortcut string
 */
function matchShortcut(e, shortcut) {
    const parts = shortcut.split('+');
    const key = parts[parts.length - 1].toUpperCase();
    const needsShift = parts.includes('Shift');

    if (needsShift !== e.shiftKey) return false;

    return e.key.toUpperCase() === key;
}

export default {
    initSelectionToolbar,
    isToolbarVisible,
    destroySelectionToolbar,
    setEditor
};
