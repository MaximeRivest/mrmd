/**
 * Synonym Picker UI
 *
 * Displays a list of synonyms for the user to choose from.
 * Replaces the selected text with the chosen synonym.
 */

import type { EditorView } from '@codemirror/view';

export interface SynonymPickerOptions {
    /**
     * The EditorView to insert the synonym into
     */
    view: EditorView;

    /**
     * Array of synonyms to choose from
     */
    synonyms: string[];

    /**
     * The original word/phrase being replaced
     */
    original: string;

    /**
     * Position in the document to replace (start)
     */
    replaceFrom: number;

    /**
     * Position in the document to replace (end)
     */
    replaceTo: number;

    /**
     * Screen position for the picker (optional)
     */
    position?: { x: number; y: number } | null;

    /**
     * Called when a synonym is selected
     */
    onSelect?: (synonym: string) => void;

    /**
     * Called when the picker is dismissed
     */
    onDismiss?: () => void;
}

/**
 * Show a synonym picker UI.
 */
export function showSynonymPicker(options: SynonymPickerOptions): () => void {
    const { view, synonyms, original, replaceFrom, replaceTo, position, onSelect, onDismiss } = options;

    // Don't show if no synonyms
    if (!synonyms || synonyms.length === 0) {
        onDismiss?.();
        return () => {};
    }

    // Create picker element
    const picker = document.createElement('div');
    picker.className = 'synonym-picker';
    picker.setAttribute('role', 'listbox');
    picker.setAttribute('aria-label', `Synonyms for "${original}"`);

    // Style the picker
    Object.assign(picker.style, {
        position: 'fixed',
        zIndex: '10000',
        backgroundColor: 'var(--surface, #1e1e1e)',
        border: '1px solid var(--border, #333)',
        borderRadius: '8px',
        boxShadow: '0 4px 12px rgba(0, 0, 0, 0.3)',
        padding: '4px',
        maxHeight: '300px',
        overflowY: 'auto',
        minWidth: '150px',
        maxWidth: '300px',
    });

    // Header
    const header = document.createElement('div');
    header.className = 'synonym-picker-header';
    header.textContent = `Synonyms for "${original}"`;
    Object.assign(header.style, {
        padding: '8px 12px',
        fontSize: '0.8em',
        color: 'var(--text-muted, #888)',
        borderBottom: '1px solid var(--border, #333)',
        marginBottom: '4px',
    });
    picker.appendChild(header);

    // Track selected index for keyboard navigation
    let selectedIndex = 0;

    // Create synonym options
    const items: HTMLElement[] = [];
    synonyms.forEach((synonym, index) => {
        const item = document.createElement('div');
        item.className = 'synonym-picker-item';
        item.setAttribute('role', 'option');
        item.setAttribute('aria-selected', index === 0 ? 'true' : 'false');
        item.textContent = synonym;

        Object.assign(item.style, {
            padding: '8px 12px',
            cursor: 'pointer',
            borderRadius: '4px',
            transition: 'background-color 0.1s',
        });

        if (index === 0) {
            item.style.backgroundColor = 'var(--hover, #2a2a2a)';
        }

        // Mouse events
        item.addEventListener('mouseenter', () => {
            updateSelection(index);
        });

        item.addEventListener('click', () => {
            selectSynonym(synonym);
        });

        picker.appendChild(item);
        items.push(item);
    });

    // Update visual selection
    function updateSelection(index: number) {
        items.forEach((item, i) => {
            if (i === index) {
                item.style.backgroundColor = 'var(--hover, #2a2a2a)';
                item.setAttribute('aria-selected', 'true');
            } else {
                item.style.backgroundColor = '';
                item.setAttribute('aria-selected', 'false');
            }
        });
        selectedIndex = index;
    }

    // Select and apply a synonym
    function selectSynonym(synonym: string) {
        // Replace the text in the editor
        view.dispatch({
            changes: { from: replaceFrom, to: replaceTo, insert: synonym },
            selection: { anchor: replaceFrom + synonym.length },
        });

        onSelect?.(synonym);
        dismiss();
    }

    // Dismiss the picker
    function dismiss() {
        picker.remove();
        document.removeEventListener('keydown', handleKeydown);
        document.removeEventListener('mousedown', handleClickOutside);
        onDismiss?.();
    }

    // Keyboard navigation
    function handleKeydown(e: KeyboardEvent) {
        switch (e.key) {
            case 'ArrowDown':
                e.preventDefault();
                updateSelection((selectedIndex + 1) % items.length);
                break;
            case 'ArrowUp':
                e.preventDefault();
                updateSelection((selectedIndex - 1 + items.length) % items.length);
                break;
            case 'Enter':
                e.preventDefault();
                selectSynonym(synonyms[selectedIndex]);
                break;
            case 'Escape':
                e.preventDefault();
                dismiss();
                break;
            case 'Tab':
                e.preventDefault();
                if (e.shiftKey) {
                    updateSelection((selectedIndex - 1 + items.length) % items.length);
                } else {
                    updateSelection((selectedIndex + 1) % items.length);
                }
                break;
        }
    }

    // Click outside to dismiss
    function handleClickOutside(e: MouseEvent) {
        if (!picker.contains(e.target as Node)) {
            dismiss();
        }
    }

    // Position the picker
    let x = position?.x ?? 100;
    let y = position?.y ?? 100;

    // If no position provided, try to get it from the selection
    if (!position) {
        const coords = view.coordsAtPos(replaceFrom);
        if (coords) {
            x = coords.left;
            y = coords.bottom + 4;
        }
    }

    // Ensure picker stays in viewport
    const viewportWidth = window.innerWidth;
    const viewportHeight = window.innerHeight;

    picker.style.left = `${Math.min(x, viewportWidth - 320)}px`;
    picker.style.top = `${Math.min(y, viewportHeight - 320)}px`;

    // Add to document
    document.body.appendChild(picker);

    // Adjust position if it overflows
    const rect = picker.getBoundingClientRect();
    if (rect.right > viewportWidth) {
        picker.style.left = `${viewportWidth - rect.width - 10}px`;
    }
    if (rect.bottom > viewportHeight) {
        picker.style.top = `${y - rect.height - 8}px`;
    }

    // Add event listeners
    document.addEventListener('keydown', handleKeydown);
    // Delay click outside listener to avoid immediate dismiss
    setTimeout(() => {
        document.addEventListener('mousedown', handleClickOutside);
    }, 100);

    // Return dismiss function
    return dismiss;
}

/**
 * Extract synonyms array from AI result.
 */
export function extractSynonyms(result: unknown): string[] {
    if (!result || typeof result !== 'object') {
        return [];
    }

    const r = result as Record<string, unknown>;

    // Try different field names
    if (Array.isArray(r.synonyms)) {
        return r.synonyms.filter((s): s is string => typeof s === 'string');
    }

    if (Array.isArray(r.alternatives)) {
        return r.alternatives.filter((s): s is string => typeof s === 'string');
    }

    return [];
}
