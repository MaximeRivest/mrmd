/**
 * AI Palette - Hover-triggered AI action menu
 *
 * A subtle floating palette that appears when mouse is near the text cursor,
 * providing quick access to AI completion, fix, and correction programs.
 *
 * Keybindings are defined centrally in keybindings.js
 */

import { AiClient, aiClient } from './ai-client.js';
import { KeybindingManager } from './keybinding-manager.js';
import { KEYBINDINGS, getAiSpellBindings, getBindingDisplayString } from './keybindings.js';

/**
 * Juice Levels - Progressive quality/cost tradeoff
 * Press and hold a spell key to charge juice level
 * Longer press = higher quality model
 */
const JUICE_LEVELS = [
    { level: 0, name: 'Quick', abbr: 'Q', model: 'Kimi K2' },
    { level: 1, name: 'Balanced', abbr: 'B', model: 'Sonnet 4.5' },
    { level: 2, name: 'Deep', abbr: 'D', model: 'Gemini 3' },
    { level: 3, name: 'Maximum', abbr: 'M', model: 'Opus 4.5' },
    { level: 4, name: 'Ultimate', abbr: 'U', model: 'Multi-model' },
];

/**
 * Charge thresholds in milliseconds
 * Quick tap = level 0, hold longer for higher levels
 */
const CHARGE_THRESHOLDS = [0, 200, 500, 1000, 1800]; // ms for each level
const MAX_CHARGE_TIME = 2200; // ms to reach full charge

/**
 * AI spells - compact, quick-access actions
 * jj opens menu, then single letter to cast
 *
 * context: 'both', 'code', or 'text' - determines when spell is shown based on cursor location
 * scope: 'line', 'section', or 'both' - determines when spell is shown based on scope mode
 */
const AI_SPELLS = [
    // === Universal spells (work in both text and code) ===
    {
        key: 'a',
        id: 'askClaude',
        label: 'ask claude',
        desc: 'Ask Claude Code anything about the selection/document.',
        context: 'both',
        scope: 'both',
        needsPrompt: true  // This spell requires user input
    },
    {
        key: 'j',
        id: 'finishLine',
        label: 'finish line',
        desc: 'Complete the current line based on context.',
        context: 'both',
        scope: 'line'
    },
    {
        key: 'k',
        id: 'finishSection',
        label: 'finish section',
        desc: 'Complete the entire paragraph or code block.',
        context: 'both',
        scope: 'section'
    },
    {
        key: 'f',
        id: 'correctAndFinish',
        label: 'fix + finish',
        desc: 'Correct errors, then continue writing.',
        context: 'both',
        scope: 'line'
    },

    // === Text-only spells ===
    {
        key: 'g',
        id: 'fixGrammar',
        label: 'grammar',
        desc: 'Fix spelling, grammar, and punctuation.',
        context: 'text',
        scope: 'both'
    },
    {
        key: 't',
        id: 'fixTranscription',
        label: 'transcription',
        desc: 'Clean up speech-to-text output.',
        context: 'text',
        scope: 'both'
    },
    {
        key: 's',
        id: 'synonyms',
        label: 'synonyms',
        desc: 'Show alternative words for the selected word.',
        context: 'text',
        scope: 'line'
    },
    {
        key: 'm',
        id: 'reformatMarkdown',
        label: 'reformat',
        desc: 'Clean up and reformat markdown text.',
        context: 'text',
        scope: 'section'
    },

    // === Code-only spells ===
    {
        key: 'd',
        id: 'documentCode',
        label: 'document',
        desc: 'Add docstring/documentation.',
        context: 'code',
        scope: 'both'
    },
    {
        key: 'c',
        id: 'completeCode',
        label: 'complete',
        desc: 'Finish the current function or block.',
        context: 'code',
        scope: 'line'
    },
    {
        key: 'h',
        id: 'addTypeHints',
        label: 'type hints',
        desc: 'Add type annotations.',
        context: 'code',
        scope: 'both'
    },
    {
        key: 'v',
        id: 'improveNames',
        label: 'better names',
        desc: 'Improve variable and function names.',
        context: 'code',
        scope: 'both'
    },
    {
        key: 'e',
        id: 'explainCode',
        label: 'explain',
        desc: 'Add inline comments.',
        context: 'code',
        scope: 'both'
    },
    {
        key: 'r',
        id: 'refactorCode',
        label: 'refactor',
        desc: 'Simplify and clean up code.',
        context: 'code',
        scope: 'section'
    },
    {
        key: 'p',
        id: 'formatCode',
        label: 'format',
        desc: 'Format and prettify code.',
        context: 'code',
        scope: 'section'
    },
];

// Note: Double-tap detection for 'jj' is now handled by KeybindingManager
// with timeout configured in keybindings.js (doubleTimeout: 300)

/**
 * Create an AI palette instance.
 */
export function createAiPalette(options = {}) {
    const client = options.aiClient || aiClient;
    const onAction = options.onAction || (() => {});
    const onActionStart = options.onActionStart || (() => {}); // Called when AI request starts
    const onChunk = options.onChunk || (() => {}); // Called with content chunks during streaming
    const onError = options.onError || ((err) => console.error('AI error:', err));
    const getContext = options.getContext || (() => ({}));
    const onRunningChange = options.onRunningChange || (() => {}); // Called when pending count changes

    // State
    let paletteEl = null;
    let isVisible = false;
    let currentContext = {};
    let isLoading = false;
    let attachedEditor = null;
    let palettePosition = null; // Store menu position for sub-menus (like synonym picker)
    let hideTimeout = null;

    // Cursor tracking
    let cursorScreenPos = null; // { x, y } of text cursor on screen

    // Selection state (captured when jj is pressed or when selection is made)
    let capturedSelection = null;

    // Pending AI request tracking - supports multiple concurrent requests
    // Map of requestId -> { actionId, selectionStart, selectionEnd, isReplace, markerEl, result, filePath }
    let pendingRequests = new Map();
    let nextRequestId = 0;
    let currentFilePath = null;  // Track current file for marker visibility

    // Scope mode: 'line' (selection/current line) or 'section' (entire code block)
    let scopeMode = 'line';

    // Juice level: 0-4 (quality/cost tradeoff)
    let juiceLevel = parseInt(localStorage.getItem('mrmd-juice-level') || '0', 10);

    // Arrow navigation state
    let highlightedIndex = 0;
    let filteredSpells = []; // Currently visible spells for arrow navigation

    // Charging state - press and hold to charge juice level
    let chargeState = null; // { spell, startTime, animFrame }
    let chargeOverlay = null; // DOM element for charge indicator

    // Prompt input state - for spells that need user input (like 'ask')
    let promptInput = null; // DOM element for prompt input
    let pendingSpellWithPrompt = null; // Spell waiting for prompt input

    // ===========================================================================
    // DOM Creation
    // ===========================================================================

    // Create pending request marker for a specific request
    // Each concurrent request gets its own marker at its insertion point
    function createPendingMarker(requestId) {
        const marker = document.createElement('div');
        marker.className = 'ai-pending-marker';
        marker.dataset.requestId = requestId;
        marker.innerHTML = `
            <span class="ai-pending-spinner"></span>
            <span class="ai-pending-status">Sending...</span>
            <div class="ai-pending-models"></div>
        `;
        document.body.appendChild(marker);
        return marker;
    }

    function showPendingMarker(range, requestId) {
        const marker = createPendingMarker(requestId);

        if (range) {
            // Position at the selection/cursor
            const rect = range.getBoundingClientRect();
            marker.style.left = `${rect.right + 4}px`;
            marker.style.top = `${rect.top}px`;
        } else if (cursorScreenPos) {
            marker.style.left = `${cursorScreenPos.x + 10}px`;
            marker.style.top = `${cursorScreenPos.y}px`;
        }

        marker.classList.add('visible');
        return marker;
    }

    /**
     * Update the status text on a pending marker.
     * @param {number} requestId - The request ID
     * @param {string} status - Status text to display
     * @param {object} modelsStatus - Optional model status map for ultimate mode
     */
    function updatePendingStatus(requestId, status, modelsStatus = null) {
        const marker = document.querySelector(`.ai-pending-marker[data-request-id="${requestId}"]`);
        if (!marker) return;

        const statusEl = marker.querySelector('.ai-pending-status');
        if (statusEl) {
            statusEl.textContent = status;
        }

        // Update models display for ultimate mode
        const modelsEl = marker.querySelector('.ai-pending-models');
        if (modelsEl && modelsStatus) {
            const modelsHtml = Object.entries(modelsStatus).map(([model, state]) => {
                const icon = state === 'complete' ? '✓' :
                            state === 'running' ? '⟳' :
                            state === 'error' ? '✗' : '○';
                const stateClass = `model-${state}`;
                // Shorten model name for display
                const shortName = model.replace(/-instruct.*$/, '').replace(/-preview$/, '');
                return `<span class="ai-model-status ${stateClass}" title="${model}">${icon} ${shortName}</span>`;
            }).join('');
            modelsEl.innerHTML = modelsHtml;
            modelsEl.classList.add('visible');
        }
    }

    function hidePendingMarker(requestId) {
        // Remove the specific marker for this request
        const marker = document.querySelector(`.ai-pending-marker[data-request-id="${requestId}"]`);
        if (marker) {
            marker.remove();
        }
    }

    function hideAllPendingMarkers() {
        document.querySelectorAll('.ai-pending-marker').forEach(m => m.remove());
    }

    /**
     * Hide markers for requests that don't belong to the specified file.
     * Called when switching files to avoid showing stale loading indicators.
     */
    function hideMarkersForOtherFiles(filePath) {
        for (const [requestId, request] of pendingRequests.entries()) {
            if (request.filePath !== filePath && request.marker) {
                request.marker.classList.remove('visible');
            }
        }
    }

    /**
     * Show markers for requests that belong to the specified file.
     * Called when returning to a file with pending requests.
     */
    function showMarkersForFile(filePath) {
        for (const [requestId, request] of pendingRequests.entries()) {
            if (request.filePath === filePath && request.marker) {
                request.marker.classList.add('visible');
            }
        }
    }

    /**
     * Set the current file path and update marker visibility accordingly.
     */
    function setCurrentFile(filePath) {
        if (currentFilePath !== filePath) {
            hideMarkersForOtherFiles(filePath);
            currentFilePath = filePath;
            showMarkersForFile(filePath);
        }
    }

    // Subtle cursor indicator (the spell icon)
    let cursorIndicator = null;

    function createCursorIndicator() {
        if (cursorIndicator) return cursorIndicator;

        cursorIndicator = document.createElement('div');
        cursorIndicator.className = 'ai-spell-indicator';
        cursorIndicator.innerHTML = '✦';

        // Click to open menu
        cursorIndicator.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            showMenu();
        });

        document.body.appendChild(cursorIndicator);
        return cursorIndicator;
    }

    function updateCursorIndicator() {
        if (!cursorIndicator) createCursorIndicator();
        if (!cursorScreenPos) {
            cursorIndicator.classList.remove('visible');
            return;
        }

        // Position indicator near cursor
        cursorIndicator.style.left = `${cursorScreenPos.x + 6}px`;
        cursorIndicator.style.top = `${cursorScreenPos.y - 6}px`;
        cursorIndicator.classList.add('visible');
    }

    // ===========================================================================
    // Prompt Input UI - for spells that need user input (like 'ask claude')
    // ===========================================================================

    function createPromptInput() {
        if (promptInput) return promptInput;

        promptInput = document.createElement('div');
        promptInput.className = 'ai-prompt-input';
        promptInput.innerHTML = `
            <div class="ai-prompt-header">
                <span class="ai-prompt-icon">✦</span>
                <span class="ai-prompt-title">Ask Claude</span>
            </div>
            <textarea class="ai-prompt-textarea" placeholder="What would you like Claude to do with this selection?"></textarea>
            <div class="ai-prompt-footer">
                <span class="ai-prompt-hint">Enter to send • Esc to cancel</span>
                <button class="ai-prompt-submit">Send</button>
            </div>
        `;

        const textarea = promptInput.querySelector('.ai-prompt-textarea');
        const submitBtn = promptInput.querySelector('.ai-prompt-submit');

        // Handle Enter to submit (Shift+Enter for newline)
        textarea.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                submitPrompt();
            } else if (e.key === 'Escape') {
                e.preventDefault();
                hidePromptInput();
            }
        });

        // Handle submit button click
        submitBtn.addEventListener('click', () => {
            submitPrompt();
        });

        // Prevent clicks from closing
        promptInput.addEventListener('click', (e) => {
            e.stopPropagation();
        });

        document.body.appendChild(promptInput);
        return promptInput;
    }

    function showPromptInput(spell) {
        const input = createPromptInput();
        pendingSpellWithPrompt = spell;

        // Position near the palette or cursor
        if (palettePosition) {
            input.style.left = `${palettePosition.x}px`;
            input.style.top = `${palettePosition.y}px`;
        } else if (cursorScreenPos) {
            input.style.left = `${cursorScreenPos.x}px`;
            input.style.top = `${cursorScreenPos.y + 20}px`;
        }

        // Update title based on spell
        const title = input.querySelector('.ai-prompt-title');
        if (title) {
            title.textContent = spell.label || 'Ask Claude';
        }

        // Clear and focus textarea
        const textarea = input.querySelector('.ai-prompt-textarea');
        textarea.value = '';
        input.classList.add('visible');
        textarea.focus();

        // Hide the spell menu
        if (paletteEl) {
            paletteEl.classList.remove('visible');
        }
    }

    function hidePromptInput() {
        if (promptInput) {
            promptInput.classList.remove('visible');
        }
        pendingSpellWithPrompt = null;
    }

    function submitPrompt() {
        if (!promptInput || !pendingSpellWithPrompt) return;

        const textarea = promptInput.querySelector('.ai-prompt-textarea');
        const userPrompt = textarea.value.trim();

        if (!userPrompt) {
            hidePromptInput();
            return;
        }

        const spell = pendingSpellWithPrompt;
        hidePromptInput();

        // Execute the spell with the user's prompt
        executeAction(spell.id, { userPrompt });
    }

    function createPaletteElement() {
        if (paletteEl) return paletteEl;

        paletteEl = document.createElement('div');
        paletteEl.className = 'ai-spell-menu';

        const currentJuice = JUICE_LEVELS[juiceLevel];
        // Create juice segments HTML (5 segments for 5 levels)
        const juiceSegments = JUICE_LEVELS.map((lvl, i) =>
            `<span class="juice-segment${i <= juiceLevel ? ' active' : ''}" data-level="${i}" title="${lvl.name} (${lvl.model})"></span>`
        ).join('');

        paletteEl.innerHTML = `
            <div class="ai-spell-header">
                <span class="ai-spell-mode" title="Tab to toggle scope">
                    <span class="mode-indicator"></span>
                    <span class="mode-label">line</span>
                </span>
                <span class="ai-juice-level" title="Hold spell key to charge">
                    <span class="juice-bar">${juiceSegments}</span>
                    <span class="juice-label">${currentJuice.name}</span>
                </span>
            </div>
            <div class="ai-spell-list"></div>
            <div class="ai-spell-loading"><span class="ai-spell-spinner"></span></div>
        `;

        // Click to activate spell
        paletteEl.addEventListener('click', (e) => {
            e.stopPropagation();
            const item = e.target.closest('.ai-spell-item');
            if (item && !isLoading) {
                const spell = filteredSpells.find(s => s.id === item.dataset.action);
                if (spell?.needsPrompt) {
                    showPromptInput(spell);
                } else {
                    executeAction(item.dataset.action);
                }
            }
            // Click on mode indicator to toggle
            const modeEl = e.target.closest('.ai-spell-mode');
            if (modeEl) {
                toggleScopeMode();
            }
            // Click on juice segment to set level
            const segment = e.target.closest('.juice-segment');
            if (segment && segment.dataset.level !== undefined) {
                setJuiceLevel(parseInt(segment.dataset.level, 10));
            }
        });

        document.body.appendChild(paletteEl);
        return paletteEl;
    }

    /**
     * Set juice level directly (0-4)
     */
    function setJuiceLevel(level) {
        if (level >= 0 && level < JUICE_LEVELS.length) {
            juiceLevel = level;
            localStorage.setItem('mrmd-juice-level', juiceLevel.toString());
            updateJuiceIndicator();
        }
    }

    /**
     * Update the juice level indicator display (segment bar)
     */
    function updateJuiceIndicator() {
        if (!paletteEl) return;
        const segments = paletteEl.querySelectorAll('.juice-segment');
        const juiceLabel = paletteEl.querySelector('.juice-label');
        const currentJuice = JUICE_LEVELS[juiceLevel];

        segments.forEach((seg, i) => {
            seg.classList.toggle('active', i <= juiceLevel);
            seg.classList.remove('charging');
        });

        if (juiceLabel) {
            juiceLabel.textContent = currentJuice.name;
        }
    }

    // ===========================================================================
    // Charging System - Press and hold to charge juice level
    // ===========================================================================

    /**
     * Create the charging overlay element
     */
    function createChargeOverlay() {
        if (chargeOverlay) return chargeOverlay;

        chargeOverlay = document.createElement('div');
        chargeOverlay.className = 'ai-charge-overlay';

        // Create tick marks for the 5 levels (4 dividers)
        const ticks = [1, 2, 3, 4].map(() => '<span class="charge-tick"></span>').join('');

        chargeOverlay.innerHTML = `
            <span class="charge-key"></span>
            <div class="charge-bar-container">
                <div class="charge-bar-fill"></div>
                <div class="charge-bar-ticks">${ticks}</div>
            </div>
            <span class="charge-level-label">Quick</span>
        `;

        document.body.appendChild(chargeOverlay);
        return chargeOverlay;
    }

    /**
     * Get juice level from elapsed charge time
     */
    function getJuiceLevelFromTime(elapsedMs) {
        for (let i = CHARGE_THRESHOLDS.length - 1; i >= 0; i--) {
            if (elapsedMs >= CHARGE_THRESHOLDS[i]) {
                return i;
            }
        }
        return 0;
    }

    // Note: Old startCharging, animateCharge, completeCharging functions removed.
    // Charging is now handled via KeybindingManager hold callbacks
    // (startChargingForSpell, updateChargingProgress, completeChargingWithDuration)

    /**
     * Cancel charging without executing
     */
    function cancelCharging() {
        if (!chargeState) return;

        if (chargeState.animFrame) {
            cancelAnimationFrame(chargeState.animFrame);
        }

        if (chargeOverlay) {
            chargeOverlay.classList.remove('visible');
        }

        chargeState = null;
        updateJuiceIndicator();
    }

    /**
     * Toggle between 'line' and 'section' scope mode
     */
    function toggleScopeMode() {
        scopeMode = scopeMode === 'line' ? 'section' : 'line';
        updateModeIndicator();
        // Re-filter spell list for new scope
        updateSpellList();
        updateHighlight();
    }

    /**
     * Update the mode indicator display
     */
    function updateModeIndicator() {
        if (!paletteEl) return;
        const modeLabel = paletteEl.querySelector('.mode-label');
        const modeIndicator = paletteEl.querySelector('.mode-indicator');
        if (modeLabel) {
            modeLabel.textContent = scopeMode;
        }
        if (modeIndicator) {
            modeIndicator.className = `mode-indicator ${scopeMode}`;
        }
    }

    // Track current context for re-filtering when scope changes
    let currentIsCode = false;

    /**
     * Update the spell list based on current context (code vs text) and scope mode
     */
    function updateSpellList(isCode) {
        if (!paletteEl) return;

        // Store for scope toggle re-filtering
        if (isCode !== undefined) {
            currentIsCode = isCode;
        }

        const spellList = paletteEl.querySelector('.ai-spell-list');
        if (!spellList) return;

        // Filter spells based on context AND scope
        filteredSpells = AI_SPELLS.filter(spell => {
            // Check context (code vs text)
            const ctx = spell.context || 'both';
            const contextMatch = ctx === 'both' ||
                                 (ctx === 'code' && currentIsCode) ||
                                 (ctx === 'text' && !currentIsCode);
            if (!contextMatch) return false;

            // Check scope (line vs section)
            const spellScope = spell.scope || 'both';
            const scopeMatch = spellScope === 'both' || spellScope === scopeMode;
            return scopeMatch;
        });

        // Reset highlight to first item
        highlightedIndex = 0;

        // Build spell list HTML with highlight support
        const spellsHtml = filteredSpells.map((spell, idx) =>
            `<div class="ai-spell-item${idx === highlightedIndex ? ' highlighted' : ''}" data-action="${spell.id}" data-key="${spell.key}" data-index="${idx}" title="${spell.desc}">
                <span class="ai-spell-key">${spell.key}</span>
                <span class="ai-spell-label">${spell.label}</span>
            </div>`
        ).join('');

        spellList.innerHTML = spellsHtml;
    }

    /**
     * Update the highlighted item in the spell list
     */
    function updateHighlight() {
        if (!paletteEl) return;
        const items = paletteEl.querySelectorAll('.ai-spell-item');
        items.forEach((item, idx) => {
            item.classList.toggle('highlighted', idx === highlightedIndex);
        });
        // Scroll highlighted item into view if needed
        const highlighted = paletteEl.querySelector('.ai-spell-item.highlighted');
        if (highlighted) {
            highlighted.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
        }
    }

    // Click outside to close
    function handleClickOutside(e) {
        if (isVisible && paletteEl && !paletteEl.contains(e.target)) {
            hide();
        }
    }

    function showMenu() {
        const el = createPaletteElement();

        // Detect if we're in a code context
        const ctx = getContext();
        const isCode = ctx.contentType === 'code' || (ctx.inCodeBlock) ||
                       (ctx.language && ctx.language !== 'text');

        // Update spell list based on context
        updateSpellList(isCode);

        // Update mode indicator
        updateModeIndicator();

        // Reset highlight
        highlightedIndex = 0;
        updateHighlight();

        // Calculate menu dimensions
        const spellCount = el.querySelector('.ai-spell-list')?.children.length || 5;
        const menuHeight = spellCount * 32 + 40;  // approx 32px per item + header + padding
        const menuWidth = 160; // approximate menu width

        let x, y;
        let selectionRect = null;

        // Try to get selection rect - first from current selection, then from captured range
        // (current selection is more reliable since it's still in DOM)
        const sel = window.getSelection();
        if (sel && sel.rangeCount > 0 && !sel.isCollapsed) {
            selectionRect = sel.getRangeAt(0).getBoundingClientRect();
            console.log('[AI Menu] Got rect from current selection:', selectionRect);
        } else if (capturedSelection?.hadSelection && capturedSelection.range) {
            // Fallback: try captured range
            try {
                selectionRect = capturedSelection.range.getBoundingClientRect();
                console.log('[AI Menu] Got rect from captured range:', selectionRect);
                // Check if rect is valid (has dimensions)
                if (!selectionRect || selectionRect.width === 0 || selectionRect.height === 0) {
                    selectionRect = null;
                }
            } catch (e) {
                console.log('[AI Menu] Captured range failed:', e);
                selectionRect = null;
            }
        }

        // Position based on selection or cursor
        if (selectionRect && selectionRect.width > 0) {
            // Position to the right of selection, vertically centered
            x = selectionRect.right + 8;
            y = selectionRect.top + (selectionRect.height / 2) - (menuHeight / 2);

            // If menu would go off right edge, position it just inside the viewport
            if (x + menuWidth > window.innerWidth - 10) {
                x = window.innerWidth - menuWidth - 10;
            }

            // Ensure menu doesn't cover selection - push right if needed
            if (x < selectionRect.right + 4) {
                x = selectionRect.right + 4;
            }
        } else if (cursorScreenPos) {
            // No selection - position near cursor
            x = cursorScreenPos.x + 10;
            y = cursorScreenPos.y;
        } else {
            // Fallback to center of viewport
            x = window.innerWidth / 2 - menuWidth / 2;
            y = window.innerHeight / 2 - menuHeight / 2;
        }

        // Keep in viewport vertically
        if (y + menuHeight > window.innerHeight) {
            y = window.innerHeight - menuHeight - 10;
        }
        if (y < 10) {
            y = 10;
        }

        el.style.left = `${x}px`;
        el.style.top = `${y}px`;
        el.classList.add('visible');
        isVisible = true;

        // Store position for sub-menus (synonym picker)
        palettePosition = { x, y };

        // Hide indicator while menu is open
        if (cursorIndicator) {
            cursorIndicator.classList.remove('visible');
        }

        // Listen for click outside
        setTimeout(() => {
            document.addEventListener('click', handleClickOutside);
        }, 0);
    }

    // ===========================================================================
    // Show / Hide
    // ===========================================================================

    function hide() {
        clearTimeout(hideTimeout);
        cancelCharging(); // Cancel any pending charge
        if (paletteEl) {
            paletteEl.classList.remove('visible');
        }
        isVisible = false;
        capturedSelection = null; // Clear captured selection when menu is hidden
        document.removeEventListener('click', handleClickOutside);
    }

    function scheduleHide(delay = 200) {
        clearTimeout(hideTimeout);
        hideTimeout = setTimeout(hide, delay);
    }

    function updateCursorPosition() {
        const sel = window.getSelection();
        if (!sel || sel.rangeCount === 0) {
            cursorScreenPos = null;
            updateCursorIndicator();
            return;
        }

        const range = sel.getRangeAt(0);

        // Get caret position
        const tempRange = range.cloneRange();
        tempRange.collapse(false);  // Collapse to end (cursor position)
        const rect = tempRange.getBoundingClientRect();

        if (rect.height > 0) {
            cursorScreenPos = {
                x: rect.left,
                y: rect.top  // Top of the line for top-right positioning
            };
        }

        updateCursorIndicator();
    }

    // ===========================================================================
    // Action Execution
    // ===========================================================================

    async function executeAction(actionId, options = {}) {
        // All requests now run in parallel - user can continue working
        // Each request is tracked with its own marker at the insertion point

        hide();  // Hide tooltip when executing
        hidePromptInput();  // Hide prompt input if visible
        const ctx = { ...currentContext, ...getContext() };
        const { userPrompt } = options;  // For 'askClaude' and other prompt-based spells
        let { text, code, language, contentType, selection, hasSelection, currentLine, localContext, documentContext,
              selectionStart, selectionEnd, lineStart, lineEnd, cursor } = ctx;

        // Use captured selection if available (captured on first 'j' before it was lost)
        // The captured selection includes offsets from the moment of capture - most reliable
        if (capturedSelection) {
            hasSelection = true;

            // Get the selection text first - prefer editor's captured text
            if (capturedSelection.selectedText) {
                selection = capturedSelection.selectedText;
            } else if (capturedSelection.text) {
                selection = capturedSelection.text;
            }

            // Use the offsets captured at the moment of first 'j'
            if (capturedSelection.selectionStart !== undefined) {
                selectionStart = capturedSelection.selectionStart;
            }

            // Calculate selectionEnd from selectionStart + selection.length
            // This is MORE RELIABLE than the captured selectionEnd which can be wrong
            // for multi-line selections due to DOM->markdown offset resolution issues
            if (selectionStart !== undefined && selection) {
                selectionEnd = selectionStart + selection.length;
            } else if (capturedSelection.selectionEnd !== undefined) {
                // Fallback to captured end if we don't have selection text
                selectionEnd = capturedSelection.selectionEnd;
            }
        }

        // Determine input based on action type:
        // - Completion actions: use text up to cursor (text or code)
        // - Fix/transform actions: use selection if available, otherwise current line/block
        const isFixAction = ['fixGrammar', 'fixTranscription', 'correctAndFinish', 'askClaude'].includes(actionId);
        const isCodeTransform = ['documentCode', 'addTypeHints', 'improveNames', 'explainCode', 'refactorCode'].includes(actionId);
        const isCodeComplete = ['completeCode'].includes(actionId);
        const isCode = contentType === 'code' || (language && language !== 'text');

        // Get section data from context (codeBlock contains full block content and offsets)
        const { codeBlock } = ctx;

        let input;
        let effectiveSelectionStart = selectionStart;
        let effectiveSelectionEnd = selectionEnd;
        let effectiveSelection = selection;
        let effectiveHasSelection = hasSelection;

        // Special handling for synonyms - extract word at cursor if no selection
        if (actionId === 'synonyms') {
            // Check if we had a real selection (not just captured cursor)
            const hadRealSelection = hasSelection && selection && (capturedSelection?.hadSelection !== false);
            if (hadRealSelection) {
                // Use selected text
                input = selection;
            } else {
                // Extract word at/before cursor from the CAPTURED document (without 'j')
                // Use the cursor position and document captured BEFORE the 'j' was typed
                const fullDoc = capturedSelection?.documentContext || capturedSelection?.localContext || documentContext || localContext || '';
                const cursorPos = capturedSelection?.cursor ?? cursor ?? 0;

                // Find word boundaries around cursor in the full document
                // Look backwards for word start
                let wordStart = cursorPos;
                while (wordStart > 0 && /\w/.test(fullDoc[wordStart - 1])) {
                    wordStart--;
                }
                // Look forwards for word end
                let wordEnd = cursorPos;
                while (wordEnd < fullDoc.length && /\w/.test(fullDoc[wordEnd])) {
                    wordEnd++;
                }

                // If cursor is not in a word, try to get the word before cursor
                if (wordStart === wordEnd && cursorPos > 0) {
                    wordEnd = cursorPos;
                    wordStart = cursorPos - 1;
                    while (wordStart > 0 && /\w/.test(fullDoc[wordStart - 1])) {
                        wordStart--;
                    }
                }

                const word = fullDoc.slice(wordStart, wordEnd).trim();
                if (word) {
                    input = word;
                    effectiveSelectionStart = wordStart;
                    effectiveSelectionEnd = wordEnd;
                    effectiveSelection = word;
                    effectiveHasSelection = true;
                    console.log('[AI] Synonyms: extracted word', { word, wordStart, wordEnd, cursorPos });
                } else {
                    onError(new Error('No word at cursor for synonyms'), actionId);
                    return;
                }
            }
        } else if (isFixAction || isCodeTransform) {
            // For fix/transform actions, respect scope mode
            if (scopeMode === 'section' && codeBlock) {
                // Use entire code block
                input = codeBlock.code;
                effectiveSelectionStart = codeBlock.start;
                effectiveSelectionEnd = codeBlock.end;
                effectiveSelection = codeBlock.code;
                effectiveHasSelection = true;
            } else {
                // Use selection or current line
                input = hasSelection ? selection : (currentLine || code || text || '');
            }
        } else if (isCodeComplete) {
            // For code completion, use code up to cursor
            input = code || text || '';
        } else {
            // For completion actions, use text up to cursor
            input = isCode ? (code || text) : text;
        }

        // askClaude doesn't require input text - it uses userPrompt instead
        if (actionId !== 'askClaude' && (!input || !input.trim())) {
            onError(new Error('No text to process'), actionId);
            return;
        }

        // Store the target location BEFORE the async call - user may navigate away
        const isReplaceAction = isFixAction || isCodeTransform;
        const requestId = nextRequestId++;
        const thisRequest = {
            requestId,
            actionId,
            isReplace: isReplaceAction,
            // For replace: use effective selection range (respects scope mode)
            selectionStart: effectiveHasSelection ? effectiveSelectionStart : lineStart,
            selectionEnd: effectiveHasSelection ? effectiveSelectionEnd : lineEnd,
            // For insert/complete: use cursor position
            cursor: cursor,
            hasSelection: effectiveHasSelection,
            // Store the actual selection text for boundary alignment
            selection: effectiveSelection,
            // Track which file this request belongs to
            filePath: currentFilePath
        };
        pendingRequests.set(requestId, thisRequest);
        onRunningChange(pendingRequests.size);

        // Show visual indicator at the target location for this specific request
        const sel = window.getSelection();
        const range = (sel && sel.rangeCount > 0) ? sel.getRangeAt(0) : null;
        const marker = showPendingMarker(range, requestId);
        thisRequest.marker = marker;

        // Set juice level on client before making calls
        client.setJuice(juiceLevel);

        // Track that we have pending requests (for UI indicator)
        setLoading(true);

        // Build context object for callbacks
        const startCtx = {
            ...ctx,
            selection: thisRequest?.selection ?? selection,
            hasSelection: thisRequest?.hasSelection ?? hasSelection,
            selectionStart: thisRequest?.selectionStart ?? selectionStart,
            selectionEnd: thisRequest?.selectionEnd ?? selectionEnd,
            cursor: thisRequest?.cursor ?? cursor,
            isReplace: thisRequest?.isReplace ?? isReplaceAction,
            scopeMode: scopeMode,
            requestId: requestId
        };

        // Notify that we're starting an AI action
        // This allows the handler to show the streaming overlay immediately
        onActionStart(actionId, startCtx);

        // Create streaming callbacks to update pending marker
        const streamCallbacks = {
            stream: true,
            onStatus: (data) => {
                let statusText = 'Working...';
                if (data.step === 'starting') {
                    statusText = `Starting ${data.juice_name || ''}...`;
                } else if (data.step === 'calling_model') {
                    statusText = `Calling ${data.model}...`;
                } else if (data.step === 'model_complete') {
                    statusText = `${data.model} done`;
                } else if (data.step === 'starting_multi_model') {
                    statusText = `Calling ${data.total} models...`;
                    updatePendingStatus(requestId, statusText, data.models_status);
                    return;
                } else if (data.step === 'synthesizing') {
                    statusText = 'Synthesizing...';
                }
                updatePendingStatus(requestId, statusText);
            },
            onModelStart: (data) => {
                updatePendingStatus(requestId, `${data.model} working...`, data.models_status);
            },
            onModelComplete: (data) => {
                const completed = Object.values(data.models_status).filter(s => s === 'complete').length;
                const total = Object.keys(data.models_status).length;
                updatePendingStatus(requestId, `${completed}/${total} models done`, data.models_status);
            },
            onContentChunk: (data) => {
                // Content streaming - pass chunks to handler for live updates
                // data: { chunk: "partial content", field: "completion" }
                onChunk(actionId, data.chunk, startCtx);
            },
            onError: (err) => {
                updatePendingStatus(requestId, `Error: ${err.message}`);
            }
        };

        // Helper to build params and call with streaming
        const callStream = async (endpoint, params) => {
            return client.callWithOptions(endpoint, params, streamCallbacks);
        };

        try {
            let result;

            switch (actionId) {
                case 'finishLine':
                    if (isCode) {
                        result = await callStream('FinishCodeLinePredict', {
                            code_before_cursor: input,
                            language: language || 'python',
                            local_context: localContext,
                            document_context: documentContext
                        });
                    } else {
                        result = await callStream('FinishSentencePredict', {
                            text_before_cursor: input,
                            local_context: localContext,
                            document_context: documentContext
                        });
                    }
                    break;

                case 'finishSection':
                    if (isCode) {
                        result = await callStream('FinishCodeSectionPredict', {
                            code_before_cursor: input,
                            language: language || 'python',
                            local_context: localContext,
                            document_context: documentContext
                        });
                    } else {
                        result = await callStream('FinishParagraphPredict', {
                            text_before_cursor: input,
                            local_context: localContext,
                            document_context: documentContext
                        });
                    }
                    break;

                case 'fixGrammar':
                    result = await callStream('FixGrammarPredict', {
                        text_to_fix: input,
                        local_context: localContext,
                        document_context: documentContext
                    });
                    break;

                case 'fixTranscription':
                    result = await callStream('FixTranscriptionPredict', {
                        text_to_fix: input,
                        local_context: localContext,
                        document_context: documentContext
                    });
                    break;

                case 'correctAndFinish':
                    result = await callStream('CorrectAndFinishLinePredict', {
                        text_to_fix: input,
                        content_type: isCode ? (language || 'code') : 'text',
                        local_context: localContext,
                        document_context: documentContext
                    });
                    break;

                // === Code-specific actions ===
                case 'documentCode':
                    result = await callStream('DocumentCodePredict', {
                        code: input,
                        language: language || 'python',
                        local_context: localContext,
                        document_context: documentContext
                    });
                    break;

                case 'completeCode':
                    result = await callStream('CompleteCodePredict', {
                        code: input,
                        language: language || 'python',
                        local_context: localContext,
                        document_context: documentContext
                    });
                    break;

                case 'addTypeHints':
                    result = await callStream('AddTypeHintsPredict', {
                        code: input,
                        language: language || 'python',
                        local_context: localContext,
                        document_context: documentContext
                    });
                    break;

                case 'improveNames':
                    result = await callStream('ImproveNamesPredict', {
                        code: input,
                        language: language || 'python',
                        local_context: localContext,
                        document_context: documentContext
                    });
                    break;

                case 'explainCode':
                    result = await callStream('ExplainCodePredict', {
                        code: input,
                        language: language || 'python',
                        local_context: localContext,
                        document_context: documentContext
                    });
                    break;

                case 'refactorCode':
                    result = await callStream('RefactorCodePredict', {
                        code: input,
                        language: language || 'python',
                        local_context: localContext,
                        document_context: documentContext
                    });
                    break;

                case 'formatCode':
                    result = await callStream('FormatCodePredict', {
                        code: input,
                        language: language || 'python',
                        local_context: localContext,
                        document_context: documentContext
                    });
                    break;

                // === Text-specific actions ===
                case 'synonyms':
                    // Detect if input is multi-word (phrase) or single word
                    const wordCount = input.trim().split(/\s+/).length;
                    if (wordCount > 1) {
                        // Multi-word phrase - use phrase synonyms
                        result = await callStream('GetPhraseSynonymsPredict', {
                            phrase: input,
                            local_context: localContext,
                            document_context: documentContext
                        });
                        // Normalize response format (alternatives -> synonyms)
                        if (result.alternatives && !result.synonyms) {
                            result.synonyms = result.alternatives;
                        }
                    } else {
                        // Single word - use regular synonyms
                        result = await callStream('GetSynonymsPredict', {
                            text: input,
                            local_context: localContext,
                            document_context: documentContext
                        });
                    }
                    break;

                case 'reformatMarkdown':
                    result = await callStream('ReformatMarkdownPredict', {
                        text: input,
                        local_context: localContext,
                        document_context: documentContext
                    });
                    break;

                // === Ask Claude - invoke Claude Code CLI ===
                case 'askClaude':
                    if (!userPrompt) {
                        throw new Error('No prompt provided for askClaude');
                    }
                    // Calculate line numbers from offsets
                    let cursorLine = null, cursorCol = null;
                    let selStartLine = null, selEndLine = null;
                    if (documentContext) {
                        // Helper to get line number and column from offset
                        const getLineCol = (offset) => {
                            const textBefore = documentContext.substring(0, offset);
                            const lines = textBefore.split('\n');
                            return { line: lines.length, col: lines[lines.length - 1].length + 1 };
                        };

                        if (hasSelection && effectiveSelectionStart !== undefined) {
                            const startPos = getLineCol(effectiveSelectionStart);
                            const endPos = getLineCol(effectiveSelectionEnd);
                            selStartLine = startPos.line;
                            selEndLine = endPos.line;
                        } else if (cursor !== undefined && cursor !== null) {
                            const pos = getLineCol(cursor);
                            cursorLine = pos.line;
                            cursorCol = pos.col;
                        }
                    }

                    // Call backend endpoint that invokes Claude Code CLI
                    // Claude uses its own tools to read/edit the file
                    updatePendingStatus(requestId, 'Asking Claude...');
                    result = await fetch('/api/claude/ask', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                            prompt: userPrompt,
                            selection: hasSelection ? effectiveSelection : null,
                            selection_start_line: selStartLine,
                            selection_end_line: selEndLine,
                            cursor_line: cursorLine,
                            cursor_col: cursorCol,
                            language: language || null,
                            file_path: currentFilePath || null
                        })
                    }).then(async (res) => {
                        if (!res.ok) {
                            const errText = await res.text();
                            throw new Error(`Claude request failed: ${errText}`);
                        }
                        return res.json();
                    });
                    break;

                default:
                    throw new Error(`Unknown action: ${actionId}`);
            }

            // Include stored target location info for replacement
            // Use the offsets captured BEFORE the async call, not current selection
            const finalCtx = {
                ...ctx,
                // Use the effective selection (respects scope mode)
                selection: thisRequest?.selection ?? selection,
                hasSelection: thisRequest?.hasSelection ?? hasSelection,
                // These are the stored offsets - safe even if user navigated away
                selectionStart: thisRequest?.selectionStart ?? selectionStart,
                selectionEnd: thisRequest?.selectionEnd ?? selectionEnd,
                cursor: thisRequest?.cursor ?? cursor,
                isReplace: thisRequest?.isReplace ?? isReplaceAction,
                capturedSelection: capturedSelection ? { ...capturedSelection } : null,
                scopeMode: scopeMode,
                // Include palette position for sub-menus (synonym picker)
                palettePosition: palettePosition ? { ...palettePosition } : null,
                requestId: requestId
            };
            onAction(actionId, result, finalCtx);

        } catch (err) {
            onError(err, actionId);
        } finally {
            // Clean up this specific request's marker
            hidePendingMarker(requestId);
            pendingRequests.delete(requestId);
            onRunningChange(pendingRequests.size);
            // Only clear global loading state if no more pending requests
            if (pendingRequests.size === 0) {
                setLoading(false);
            }
            capturedSelection = null; // Clear after use
        }
    }

    function setLoading(loading) {
        isLoading = loading;
        if (paletteEl) {
            paletteEl.classList.toggle('loading', loading);
        }
    }

    // ===========================================================================
    // Legacy helper functions (kept for compatibility)
    // Keyboard handling is now done via KeybindingManager
    // ===========================================================================

    function insertCharAtCursor(char) {
        // Insert a character at current cursor position
        // Used by KeybindingManager.insertPendingChar for double-tap handling
        const activeEl = document.activeElement;

        // Handle textarea/input (code cells)
        if (activeEl && (activeEl.tagName === 'TEXTAREA' || activeEl.tagName === 'INPUT')) {
            const start = activeEl.selectionStart;
            const end = activeEl.selectionEnd;
            const value = activeEl.value;
            activeEl.value = value.slice(0, start) + char + value.slice(end);
            activeEl.selectionStart = activeEl.selectionEnd = start + 1;
            activeEl.dispatchEvent(new Event('input', { bubbles: true }));
            return;
        }

        // Handle contenteditable (normal text)
        const sel = window.getSelection();
        if (sel && sel.rangeCount > 0) {
            const range = sel.getRangeAt(0);
            range.deleteContents();
            const textNode = document.createTextNode(char);
            range.insertNode(textNode);
            // Move cursor after inserted char
            range.setStartAfter(textNode);
            range.collapse(true);
            sel.removeAllRanges();
            sel.addRange(range);
            // Trigger input event
            const editableEl = range.startContainer.parentElement?.closest('[contenteditable="true"]');
            if (editableEl) {
                editableEl.dispatchEvent(new Event('input', { bubbles: true }));
            }
        }
    }

    // ===========================================================================
    // Editor Integration
    // ===========================================================================

    function attachToEditor(editor) {
        attachedEditor = editor;

        // Update cursor position on various events
        const handleCursorChange = () => {
            updateCursorPosition();
        };

        // Track if shift is held for shift+arrow selection detection
        let shiftHeld = false;

        // Auto-show menu when selection is made
        const handleSelectionComplete = (e) => {
            // Don't auto-show if menu is already visible or loading
            if (isVisible || isLoading) return;

            // Small delay to let selection settle
            setTimeout(() => {
                const sel = window.getSelection();
                if (sel && !sel.isCollapsed && sel.toString().trim().length > 0) {
                    // There's a selection - capture it and show menu
                    const editorCtx = getContext();
                    capturedSelection = {
                        text: sel.toString(),
                        range: sel.getRangeAt(0).cloneRange(),
                        selectionStart: editorCtx.selectionStart,
                        selectionEnd: editorCtx.selectionEnd,
                        selectedText: editorCtx.selectedText || editorCtx.selection,
                        cursor: editorCtx.cursor,
                        hadSelection: true,
                        documentContext: editorCtx.documentContext,
                        localContext: editorCtx.localContext
                    };
                    updateCursorPosition();
                    showMenu();
                }
            }, 10);
        };

        // Handle mouseup - update cursor position
        const handleMouseUp = (e) => {
            handleCursorChange();
        };

        // Handle keyup - update cursor position
        const handleKeyUp = (e) => {
            handleCursorChange();
            if (e.key === 'Shift') {
                shiftHeld = false;
            }
        };

        // Track shift key state
        const handleKeyDownForShift = (e) => {
            if (e.key === 'Shift') {
                shiftHeld = true;
            }
        };

        // Attach to editor container
        if (editor.container) {
            editor.container.addEventListener('mouseup', handleMouseUp);
            editor.container.addEventListener('keyup', handleKeyUp);
            editor.container.addEventListener('keydown', handleKeyDownForShift);
            editor.container.addEventListener('click', handleCursorChange);

            // Also track selection changes
            document.addEventListener('selectionchange', handleCursorChange);
        }

        // Register keybindings with centralized manager
        registerAiPaletteKeybindings();

        // Initial cursor position
        updateCursorPosition();

        return () => {
            if (editor.container) {
                editor.container.removeEventListener('mouseup', handleMouseUp);
                editor.container.removeEventListener('keyup', handleKeyUp);
                editor.container.removeEventListener('keydown', handleKeyDownForShift);
                editor.container.removeEventListener('click', handleCursorChange);
                document.removeEventListener('selectionchange', handleCursorChange);
            }
            unregisterAiPaletteKeybindings();
            cancelCharging(); // Clean up any pending charge
        };
    }

    // ===========================================================================
    // Keybinding Registration
    // ===========================================================================

    /**
     * Register keybinding handlers with centralized KeybindingManager
     */
    function registerAiPaletteKeybindings() {
        // Register context provider for ai-menu
        KeybindingManager.registerContext('ai-menu', () => isVisible);

        // Set up hold callbacks for charging UI
        KeybindingManager.setHoldCallbacks({
            onHoldStart: (id, binding) => {
                if (!id.startsWith('ai:spell:')) return;
                // Find the spell by its id/key
                const spell = filteredSpells.find(s => s.id === binding.spellId);
                if (spell) {
                    startChargingForSpell(spell);
                }
            },
            onHoldProgress: (id, binding, elapsed) => {
                if (!id.startsWith('ai:spell:')) return;
                updateChargingProgress(elapsed);
            },
            onHoldComplete: (id, binding, elapsed) => {
                if (!id.startsWith('ai:spell:')) return;
                completeChargingWithDuration(elapsed, binding.spellId);
            },
            onHoldCancel: (id, binding) => {
                if (!id.startsWith('ai:spell:')) return;
                cancelCharging();
            },
        });

        // Open menu with jj double-tap
        KeybindingManager.handle('ai:open-menu', (e) => {
            // Capture selection before showing menu
            const sel = window.getSelection();
            const editorCtx = getContext();

            if (sel && !sel.isCollapsed && sel.rangeCount > 0) {
                capturedSelection = {
                    text: sel.toString(),
                    range: sel.getRangeAt(0).cloneRange(),
                    selectionStart: editorCtx.selectionStart,
                    selectionEnd: editorCtx.selectionEnd,
                    selectedText: editorCtx.selectedText || editorCtx.selection,
                    cursor: editorCtx.cursor,
                    hadSelection: true,
                    documentContext: editorCtx.documentContext,
                    localContext: editorCtx.localContext
                };
            } else {
                capturedSelection = {
                    cursor: editorCtx.cursor,
                    hadSelection: false,
                    documentContext: editorCtx.documentContext,
                    localContext: editorCtx.localContext
                };
            }

            updateCursorPosition();
            showMenu();
        });

        // Close menu
        KeybindingManager.handle('ai:close-menu', () => {
            hide();
        });

        // Toggle scope mode
        KeybindingManager.handle('ai:toggle-scope', () => {
            toggleScopeMode();
        });

        // Navigate up
        KeybindingManager.handle('ai:navigate-up', () => {
            highlightedIndex = (highlightedIndex - 1 + filteredSpells.length) % filteredSpells.length;
            updateHighlight();
        });

        // Navigate down
        KeybindingManager.handle('ai:navigate-down', () => {
            highlightedIndex = (highlightedIndex + 1) % filteredSpells.length;
            updateHighlight();
        });

        // Execute selected
        KeybindingManager.handle('ai:execute-selected', () => {
            const spell = filteredSpells[highlightedIndex];
            if (spell) {
                if (spell.needsPrompt) {
                    showPromptInput(spell);
                } else {
                    executeAction(spell.id);
                }
            }
        });

        // Register handlers for each spell key
        // These use hold behavior defined in keybindings.js
        const spellBindings = getAiSpellBindings();
        for (const binding of spellBindings) {
            KeybindingManager.handle(binding.id, (e, bindingDef, opts) => {
                // The handler is called after hold completes
                // opts.holdDuration contains the duration
                const spell = AI_SPELLS.find(s => s.id === bindingDef.spellId);
                if (spell) {
                    if (spell.needsPrompt) {
                        showPromptInput(spell);
                    } else {
                        executeAction(spell.id);
                    }
                }
            });
        }
    }

    /**
     * Unregister keybinding handlers
     */
    function unregisterAiPaletteKeybindings() {
        KeybindingManager.unregisterContext('ai-menu');
        KeybindingManager.setHoldCallbacks({});

        KeybindingManager.unhandle('ai:open-menu');
        KeybindingManager.unhandle('ai:close-menu');
        KeybindingManager.unhandle('ai:toggle-scope');
        KeybindingManager.unhandle('ai:navigate-up');
        KeybindingManager.unhandle('ai:navigate-down');
        KeybindingManager.unhandle('ai:execute-selected');

        const spellBindings = getAiSpellBindings();
        for (const binding of spellBindings) {
            KeybindingManager.unhandle(binding.id);
        }
    }

    /**
     * Start charging for a spell (called by hold callback)
     */
    function startChargingForSpell(spell) {
        if (chargeState) return; // Already charging

        const overlay = createChargeOverlay();

        // Position overlay near cursor or palette
        if (cursorScreenPos) {
            overlay.style.left = `${cursorScreenPos.x}px`;
            overlay.style.top = `${cursorScreenPos.y + 30}px`;
        } else if (paletteEl) {
            const rect = paletteEl.getBoundingClientRect();
            overlay.style.left = `${rect.left}px`;
            overlay.style.top = `${rect.bottom + 8}px`;
        }

        // Set the key being charged
        overlay.querySelector('.charge-key').textContent = spell.key;
        overlay.querySelector('.charge-level-label').textContent = JUICE_LEVELS[0].name;
        overlay.querySelector('.charge-bar-fill').style.width = '0%';

        overlay.classList.add('visible');

        chargeState = {
            spell,
            startTime: Date.now(),
            animFrame: null
        };
    }

    /**
     * Update charging progress (called by hold callback)
     */
    function updateChargingProgress(elapsed) {
        if (!chargeState) return;

        const progress = Math.min(elapsed / MAX_CHARGE_TIME, 1);
        const currentLevel = getJuiceLevelFromTime(elapsed);

        // Update overlay
        if (chargeOverlay) {
            chargeOverlay.querySelector('.charge-bar-fill').style.width = `${progress * 100}%`;
            chargeOverlay.querySelector('.charge-level-label').textContent = JUICE_LEVELS[currentLevel].name;
        }

        // Update palette segments
        if (paletteEl) {
            const segments = paletteEl.querySelectorAll('.juice-segment');
            segments.forEach((seg, i) => {
                seg.classList.toggle('active', i <= currentLevel);
                seg.classList.toggle('charging', i === currentLevel && elapsed > 100);
            });
            const juiceLabel = paletteEl.querySelector('.juice-label');
            if (juiceLabel) {
                juiceLabel.textContent = JUICE_LEVELS[currentLevel].name;
            }
        }
    }

    /**
     * Complete charging with the final duration (called by hold callback)
     */
    function completeChargingWithDuration(elapsed, spellId) {
        // Calculate final juice level
        const finalLevel = getJuiceLevelFromTime(elapsed);

        // Hide overlay
        if (chargeOverlay) {
            chargeOverlay.classList.remove('visible');
        }

        // Set the juice level
        juiceLevel = finalLevel;
        localStorage.setItem('mrmd-juice-level', juiceLevel.toString());
        updateJuiceIndicator();

        // Clear charge state
        chargeState = null;

        // Find and check if spell needs prompt
        const spell = AI_SPELLS.find(s => s.id === spellId);
        if (spell?.needsPrompt) {
            showPromptInput(spell);
        }
        // Note: The actual spell execution is handled by the KeybindingManager handler
    }

    // ===========================================================================
    // API
    // ===========================================================================

    return {
        hide,
        isVisible: () => isVisible,
        isLoading: () => isLoading,
        getPendingCount: () => pendingRequests.size,
        executeAction,
        attachToEditor,
        setContext: (ctx) => { currentContext = ctx; },
        getSpells: () => AI_SPELLS,
        getJuiceLevels: () => JUICE_LEVELS,
        getJuice: () => juiceLevel,
        setJuice: setJuiceLevel,
        updateCursorPosition,
        setCurrentFile,  // Hide/show markers when switching files
        destroy: () => {
            hide();
            hidePromptInput();
            hideAllPendingMarkers();
            cancelCharging();
            if (paletteEl) {
                paletteEl.remove();
                paletteEl = null;
            }
            if (cursorIndicator) {
                cursorIndicator.remove();
                cursorIndicator = null;
            }
            if (chargeOverlay) {
                chargeOverlay.remove();
                chargeOverlay = null;
            }
            if (promptInput) {
                promptInput.remove();
                promptInput = null;
            }
        }
    };
}

export { AI_SPELLS, JUICE_LEVELS };
export default createAiPalette;
