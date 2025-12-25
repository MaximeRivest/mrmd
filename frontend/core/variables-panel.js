/**
 * Variables Panel for MRMD Web Editor
 * Displays Python session variables in a sidebar panel
 */

let containerEl = null;
let contentEl = null;
let refreshBtn = null;
let ipythonClient = null;

// Keep reference to the bound handler so we can remove it
let executionCompleteHandler = null;

// Debounce timer for refresh
let refreshDebounceTimer = null;
const REFRESH_DEBOUNCE_MS = 100;

/**
 * Create the variables panel
 * @param {Object} options
 * @param {Object} options.ipython - IPython client instance
 * @returns {HTMLElement}
 */
export function createVariablesPanel(options = {}) {
    ipythonClient = options.ipython;

    console.log('[Variables] Creating panel, ipythonClient:', ipythonClient ? 'provided' : 'null');

    // Inject styles once
    injectStyles();

    containerEl = document.createElement('div');
    containerEl.className = 'variables-panel';
    containerEl.innerHTML = `
        <div class="env-pane-header">
            <span class="env-pane-title">Environment</span>
            <button class="env-pane-refresh" title="Refresh">↻</button>
        </div>
        <div class="env-pane-content">
            <div class="env-pane-empty">Run code to see variables</div>
        </div>
    `;

    contentEl = containerEl.querySelector('.env-pane-content');
    refreshBtn = containerEl.querySelector('.env-pane-refresh');

    // Wire up refresh button
    refreshBtn.addEventListener('click', () => refresh());

    // Create bound handler for execution complete event
    executionCompleteHandler = (event) => {
        console.log('[Variables] Execution complete event received:', event?.detail);
        debouncedRefresh();
    };

    // Listen for execution events to auto-refresh
    document.addEventListener('mrmd:execution-complete', executionCompleteHandler);

    return containerEl;
}

/**
 * Set the IPython client (for late binding)
 */
export function setIPythonClient(client) {
    console.log('[Variables] Setting IPython client:', client ? 'provided' : 'null');
    ipythonClient = client;
}

/**
 * Debounced refresh to avoid multiple rapid calls
 */
function debouncedRefresh() {
    if (refreshDebounceTimer) {
        clearTimeout(refreshDebounceTimer);
    }
    refreshDebounceTimer = setTimeout(() => {
        refreshDebounceTimer = null;
        refresh();
    }, REFRESH_DEBOUNCE_MS);
}

/**
 * Refresh the variables list
 */
export async function refresh() {
    if (!contentEl) {
        console.warn('[Variables] Cannot refresh: contentEl is null');
        return;
    }

    if (!ipythonClient) {
        console.warn('[Variables] Cannot refresh: ipythonClient is null');
        return;
    }

    // Show loading state
    refreshBtn?.classList.add('loading');

    try {
        console.log('[Variables] Fetching variables...');
        const result = await ipythonClient.getVariables();
        console.log('[Variables] Got result:', result);

        if (!result || !result.variables) {
            console.log('[Variables] No variables in result');
            contentEl.innerHTML = '<div class="env-pane-empty">Run code to see variables</div>';
            return;
        }

        const variables = result.variables;

        if (variables.length === 0) {
            contentEl.innerHTML = '<div class="env-pane-empty">No variables defined</div>';
            return;
        }

        console.log('[Variables] Rendering', variables.length, 'variables');

        // Render variables
        contentEl.innerHTML = variables.map(v => {
            const kind = getVariableKind(v.type);
            const preview = esc(truncate(v.value, 50));
            const typeStr = esc(v.type);
            const sizeStr = v.size ? ` (${esc(v.size)})` : '';

            return `
                <div class="env-var" data-kind="${kind}" data-name="${esc(v.name)}">
                    <span class="env-var-expand"></span>
                    <span class="env-var-name">${esc(v.name)}</span>
                    <span class="env-var-type">${typeStr}${sizeStr}</span>
                    <span class="env-var-preview">${preview}</span>
                </div>
            `;
        }).join('');

    } catch (err) {
        console.error('[Variables] Failed to fetch:', err);
        contentEl.innerHTML = '<div class="env-pane-empty">Failed to load variables</div>';
    } finally {
        refreshBtn?.classList.remove('loading');
    }
}

/**
 * Get the panel element
 */
export function getElement() {
    return containerEl;
}

/**
 * Destroy the panel
 */
export function destroy() {
    // Remove the event listener using the same handler reference
    if (executionCompleteHandler) {
        document.removeEventListener('mrmd:execution-complete', executionCompleteHandler);
        executionCompleteHandler = null;
    }

    // Clear debounce timer
    if (refreshDebounceTimer) {
        clearTimeout(refreshDebounceTimer);
        refreshDebounceTimer = null;
    }

    containerEl?.remove();
    containerEl = null;
    contentEl = null;
    refreshBtn = null;
    ipythonClient = null;

    console.log('[Variables] Panel destroyed');
}

// ============================================================================
// Helpers
// ============================================================================

function getVariableKind(type) {
    const t = type.toLowerCase();
    if (['int', 'float', 'str', 'bool', 'nonetype', 'bytes'].some(p => t.includes(p))) {
        return 'primitive';
    }
    if (['list', 'tuple', 'set', 'dict', 'array', 'frozenset'].some(p => t.includes(p))) {
        return 'collection';
    }
    if (['dataframe', 'series', 'ndarray', 'tensor'].some(p => t.includes(p))) {
        return 'data';
    }
    if (['function', 'method', 'lambda', 'builtin'].some(p => t.includes(p))) {
        return 'callable';
    }
    if (t.includes('class') || t.includes('type')) {
        return 'class';
    }
    return 'object';
}

function truncate(value, maxLen) {
    if (!value) return '';
    if (value.length <= maxLen) return value;
    return value.slice(0, maxLen) + '...';
}

function esc(text) {
    const div = document.createElement('div');
    div.textContent = text || '';
    return div.innerHTML;
}

// ============================================================================
// Styles
// ============================================================================

let stylesInjected = false;

function injectStyles() {
    if (stylesInjected) return;
    if (document.getElementById('variables-panel-styles')) {
        stylesInjected = true;
        return;
    }

    const style = document.createElement('style');
    style.id = 'variables-panel-styles';
    style.textContent = `
        .variables-panel {
            display: flex;
            flex-direction: column;
            height: 100%;
        }
        .variables-panel .env-pane-header {
            padding: 10px 16px;
            display: flex;
            align-items: center;
            border-bottom: 1px solid rgba(255, 255, 255, 0.06);
        }
        .variables-panel .env-pane-title {
            font-size: 10px;
            font-weight: 500;
            color: var(--muted);
            text-transform: uppercase;
            letter-spacing: 0.05em;
            flex: 1;
        }
        .variables-panel .env-pane-refresh {
            background: none;
            border: none;
            color: var(--muted);
            font-size: 14px;
            cursor: pointer;
            padding: 4px;
            border-radius: 4px;
            opacity: 0.6;
            transition: all 0.15s ease;
        }
        .variables-panel .env-pane-refresh:hover {
            background: rgba(255, 255, 255, 0.06);
            color: var(--text);
            opacity: 1;
        }
        .variables-panel .env-pane-refresh.loading {
            animation: vars-spin 0.8s linear infinite;
            opacity: 0.6;
        }
        @keyframes vars-spin {
            from { transform: rotate(0deg); }
            to { transform: rotate(360deg); }
        }
        .variables-panel .env-pane-content {
            flex: 1;
            overflow-y: auto;
            padding: 0 8px 8px;
        }
        .variables-panel .env-pane-empty {
            padding: 24px 16px;
            text-align: center;
            color: var(--muted);
            font-size: 11px;
            opacity: 0.6;
        }
        .variables-panel .env-var {
            display: flex;
            align-items: flex-start;
            padding: 5px 8px;
            border-radius: 4px;
            margin: 1px 0;
            border-left: 2px solid transparent;
        }
        .variables-panel .env-var:hover {
            background: rgba(255, 255, 255, 0.04);
        }
        .variables-panel .env-var-expand {
            width: 14px;
            height: 14px;
            flex-shrink: 0;
        }
        .variables-panel .env-var-name {
            font-family: 'SF Mono', Monaco, monospace;
            font-size: 11px;
            color: var(--text);
            flex-shrink: 0;
            margin-right: 8px;
        }
        .variables-panel .env-var-type {
            color: var(--muted);
            font-size: 10px;
            margin-right: 6px;
            flex-shrink: 0;
        }
        .variables-panel .env-var-preview {
            color: var(--muted);
            font-family: 'SF Mono', Monaco, monospace;
            font-size: 11px;
            opacity: 0.7;
            overflow: hidden;
            text-overflow: ellipsis;
            white-space: nowrap;
            flex: 1;
            min-width: 0;
        }
        /* Kind-based colors */
        .variables-panel .env-var[data-kind="primitive"] { border-left-color: #6b7280; }
        .variables-panel .env-var[data-kind="collection"] { border-left-color: #8b5cf6; }
        .variables-panel .env-var[data-kind="object"] { border-left-color: #f59e0b; }
        .variables-panel .env-var[data-kind="callable"] { border-left-color: #10b981; }
        .variables-panel .env-var[data-kind="class"] { border-left-color: #ec4899; }
        .variables-panel .env-var[data-kind="data"] { border-left-color: #3b82f6; }
    `;
    document.head.appendChild(style);
    stylesInjected = true;
}

export default {
    createVariablesPanel,
    setIPythonClient,
    refresh,
    getElement,
    destroy,
};
