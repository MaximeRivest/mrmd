/**
 * AI Commands Panel for MRMD Compact Mode
 *
 * Provides a discoverable UI for the AI spell system (jj shortcuts).
 */

import * as SessionState from './session-state.js';

let panelEl = null;
let onSpellTrigger = null;
let selectedContext = 'line';

// AI Spell definitions (matching ai-palette.js)
const QUICK_ACTIONS = [
    { key: 'j', name: 'Finish line', description: 'Complete the current line' },
    { key: 'k', name: 'Finish section', description: 'Complete the current section' },
    { key: 'f', name: 'Fix + finish', description: 'Fix errors and complete' }
];

const TEXT_ACTIONS = [
    { key: 'g', name: 'Grammar fix', description: 'Fix grammar and spelling' },
    { key: 't', name: 'Clean transcription', description: 'Clean up transcribed text' },
    { key: 'm', name: 'Reformat markdown', description: 'Improve markdown formatting' }
];

const CODE_ACTIONS = [
    { key: 'd', name: 'Add documentation', description: 'Add docstrings and comments' },
    { key: 'c', name: 'Complete function', description: 'Implement the function body' },
    { key: 'h', name: 'Add type hints', description: 'Add Python type annotations' },
    { key: 'v', name: 'Better variable names', description: 'Improve naming conventions' },
    { key: 'e', name: 'Explain with comments', description: 'Add explanatory comments' }
];

const QUALITY_LEVELS = [
    { level: 0, name: 'Quick', model: 'Kimi K2' },
    { level: 1, name: 'Balanced', model: 'Sonnet 4.5' },
    { level: 2, name: 'Deep', model: 'Gemini 3' },
    { level: 3, name: 'Maximum', model: 'Opus 4.5' },
    { level: 4, name: 'Ultimate', model: 'Multi-model' }
];

/**
 * Create the AI commands panel content
 * @param {Object} options
 * @param {Function} options.onSpellTrigger - Called when a spell is triggered
 * @returns {HTMLElement}
 */
export function createAIPanel(options = {}) {
    onSpellTrigger = options.onSpellTrigger || (() => {});

    panelEl = document.createElement('div');
    panelEl.className = 'ai-panel';

    // Context selector
    const contextSelector = createContextSelector();
    panelEl.appendChild(contextSelector);

    // Ask Claude input
    const askInput = createAskInput();
    panelEl.appendChild(askInput);

    // Quick actions section
    panelEl.appendChild(createActionSection('Quick Actions', QUICK_ACTIONS));

    // Text actions section
    panelEl.appendChild(createActionSection('For Text', TEXT_ACTIONS));

    // Code actions section
    panelEl.appendChild(createActionSection('For Code', CODE_ACTIONS));

    // Quality selector
    const qualitySelector = createQualitySelector();
    panelEl.appendChild(qualitySelector);

    // Keyboard hint
    const hint = document.createElement('div');
    hint.className = 'ai-panel-hint';
    hint.style.cssText = 'font-size: 11px; color: var(--muted); margin-top: 16px; text-align: center;';
    hint.textContent = 'Keyboard: jj to open, then key';
    panelEl.appendChild(hint);

    return panelEl;
}

/**
 * Create context selector (Line / Selection / Doc)
 */
function createContextSelector() {
    const container = document.createElement('div');
    container.className = 'ai-context-selector';

    ['Line', 'Selection', 'Doc'].forEach(ctx => {
        const btn = document.createElement('button');
        btn.className = 'ai-context-option';
        if (ctx.toLowerCase() === selectedContext) {
            btn.classList.add('active');
        }
        btn.textContent = ctx;
        btn.addEventListener('click', () => {
            container.querySelectorAll('.ai-context-option').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            selectedContext = ctx.toLowerCase();
        });
        container.appendChild(btn);
    });

    return container;
}

/**
 * Create "Ask Claude" input
 */
function createAskInput() {
    const container = document.createElement('div');
    container.className = 'ai-ask-input';

    const input = document.createElement('input');
    input.type = 'text';
    input.placeholder = 'Ask Claude...';

    const btn = document.createElement('button');
    btn.textContent = 'Ask';
    btn.addEventListener('click', () => {
        if (input.value.trim()) {
            triggerSpell('ask', { prompt: input.value.trim(), context: selectedContext });
            input.value = '';
        }
    });

    input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && input.value.trim()) {
            triggerSpell('ask', { prompt: input.value.trim(), context: selectedContext });
            input.value = '';
        }
    });

    container.appendChild(input);
    container.appendChild(btn);

    return container;
}

/**
 * Create an action section
 */
function createActionSection(title, actions) {
    const section = document.createElement('div');
    section.className = 'ai-action-section';
    section.style.marginBottom = '16px';

    const titleEl = document.createElement('div');
    titleEl.className = 'formatting-section-title';
    titleEl.textContent = title;
    section.appendChild(titleEl);

    const list = document.createElement('div');
    list.className = 'ai-action-list';

    actions.forEach(action => {
        const item = document.createElement('button');
        item.className = 'ai-action-item';

        const key = document.createElement('span');
        key.className = 'ai-action-key';
        key.textContent = action.key;

        const name = document.createElement('span');
        name.textContent = action.name;

        item.appendChild(key);
        item.appendChild(name);

        item.addEventListener('click', () => {
            triggerSpell(action.key, { context: selectedContext });
        });

        list.appendChild(item);
    });

    section.appendChild(list);
    return section;
}

/**
 * Create quality level selector
 */
function createQualitySelector() {
    const container = document.createElement('div');
    container.className = 'ai-quality-selector';

    const title = document.createElement('div');
    title.className = 'formatting-section-title';
    title.textContent = 'Quality Level';
    container.appendChild(title);

    // Get saved quality level
    const savedLevel = parseInt(localStorage.getItem('mrmd-ai-quality') || '1', 10);

    QUALITY_LEVELS.forEach(q => {
        const option = document.createElement('label');
        option.className = 'ai-quality-option';
        if (q.level === savedLevel) {
            option.classList.add('selected');
        }

        const radio = document.createElement('input');
        radio.type = 'radio';
        radio.name = 'ai-quality';
        radio.value = q.level;
        radio.checked = q.level === savedLevel;

        radio.addEventListener('change', () => {
            container.querySelectorAll('.ai-quality-option').forEach(o => o.classList.remove('selected'));
            option.classList.add('selected');
            localStorage.setItem('mrmd-ai-quality', String(q.level));
            SessionState.emit('ai-quality-changed', { level: q.level });
        });

        const text = document.createElement('span');
        text.innerHTML = `${q.name} <span style="color: var(--muted);">— ${q.model}</span>`;

        option.appendChild(radio);
        option.appendChild(text);
        container.appendChild(option);
    });

    return container;
}

/**
 * Trigger an AI spell
 */
function triggerSpell(spellKey, options = {}) {
    console.log('[AIPanel] Triggering spell:', spellKey, options);

    if (onSpellTrigger) {
        onSpellTrigger(spellKey, {
            ...options,
            qualityLevel: parseInt(localStorage.getItem('mrmd-ai-quality') || '1', 10)
        });
    }

    // Also emit event for ai-palette.js to pick up
    SessionState.emit('ai-spell-triggered', {
        spell: spellKey,
        context: options.context || selectedContext,
        prompt: options.prompt,
        qualityLevel: parseInt(localStorage.getItem('mrmd-ai-quality') || '1', 10)
    });
}

/**
 * Get the current context
 */
export function getContext() {
    return selectedContext;
}

/**
 * Set the context
 */
export function setContext(ctx) {
    selectedContext = ctx;
    if (panelEl) {
        panelEl.querySelectorAll('.ai-context-option').forEach(btn => {
            btn.classList.toggle('active', btn.textContent.toLowerCase() === ctx);
        });
    }
}

/**
 * Get the panel element
 */
export function getElement() {
    return panelEl;
}

/**
 * Destroy the panel
 */
export function destroy() {
    panelEl = null;
    onSpellTrigger = null;
}

export default {
    createAIPanel,
    getContext,
    setContext,
    getElement,
    destroy
};
