/**
 * Portal Screen for MRMD
 *
 * The level above the home screen - shows all Claude's Homes for this user.
 * Design philosophy (from SaaS Vision):
 * - Quiet and calm, same aesthetic as home screen
 * - Claude's Homes front and center
 * - Account/billing accessible but not prominent
 * - "Claude packs everything" - the voice of the product
 */

import * as SessionState from './session-state.js';

let containerEl = null;
let isVisible = false;
let onHomeSelect = null;

/**
 * Tier display info
 */
const TIER_INFO = {
    starter: { name: 'Starter', desc: 'a desk', specs: '2 vCPU · 4 GB · 50 GB' },
    workshop: { name: 'Workshop', desc: 'an office', specs: '4 vCPU · 16 GB · 100 GB' },
    studio: { name: 'Studio', desc: 'a floor', specs: '8 vCPU · 32 GB · 200 GB' },
    lab: { name: 'Lab', desc: 'a building', specs: '8 vCPU · 64 GB · A10 GPU' },
    datacenter: { name: 'Datacenter', desc: 'a campus', specs: '96 vCPU · 1 TB · 8× H200' }
};

/**
 * Create the portal screen element
 * @param {Object} options
 * @param {Function} options.onHomeSelect - Callback when a home is selected
 * @returns {HTMLElement}
 */
export function createPortalScreen(options = {}) {
    onHomeSelect = options.onHomeSelect;

    containerEl = document.createElement('div');
    containerEl.className = 'portal-screen';
    containerEl.innerHTML = `
        <div class="portal-screen-content">
            <main class="portal-main">
                <div class="portal-header">
                    <h1 class="portal-title">Your Spaces</h1>
                </div>

                <div class="portal-homes" id="portal-homes">
                    <!-- Claude's Homes will be rendered here -->
                </div>

                <button class="portal-new-home" id="portal-new-home">
                    + New space
                </button>
            </main>

            <footer class="portal-footer">
                <button class="portal-account-btn" id="portal-account-btn">Account</button>
                <span class="portal-footer-spacer"></span>
                <span class="portal-username" id="portal-username"></span>
            </footer>

            <div class="portal-account-view" id="portal-account-view">
                <!-- Account overlay -->
            </div>
        </div>
    `;

    // Wire up event listeners
    setupEventListeners();

    // Listen for state changes
    SessionState.on('homes-updated', renderHomes);
    SessionState.on('user-updated', updateUsername);

    // Initial render
    renderHomes();
    updateUsername();

    return containerEl;
}

/**
 * Set up DOM event listeners
 */
function setupEventListeners() {
    // Account button
    const accountBtn = containerEl.querySelector('#portal-account-btn');
    accountBtn?.addEventListener('click', showAccountView);

    // New home button
    const newHomeBtn = containerEl.querySelector('#portal-new-home');
    newHomeBtn?.addEventListener('click', handleNewHome);

    // Account view overlay - close on escape or clicking outside
    const accountView = containerEl.querySelector('#portal-account-view');
    accountView?.addEventListener('click', (e) => {
        if (e.target === accountView) {
            closeAccountView();
        }
    });

    // Keyboard shortcuts
    document.addEventListener('keydown', handleGlobalKeydown);
}

/**
 * Render Claude's Homes
 */
function renderHomes() {
    const container = containerEl?.querySelector('#portal-homes');
    if (!container) return;

    const homes = SessionState.getHomes?.() || getMockHomes();
    const currentHome = SessionState.getCurrentHome?.();

    if (homes.length === 0) {
        container.innerHTML = `
            <div class="portal-empty">
                <p>No spaces yet.</p>
                <p class="portal-empty-hint">Create one to give Claude a home.</p>
            </div>
        `;
        return;
    }

    container.innerHTML = homes.map((home, index) => {
        const tier = TIER_INFO[home.tier] || TIER_INFO.starter;
        const isCurrent = currentHome?.id === home.id;
        const statusClass = home.status === 'running' ? 'running' :
                           home.status === 'stopped' ? 'stopped' : 'starting';

        return `
            <button class="portal-home-card ${isCurrent ? 'current' : ''}"
                    data-id="${escapeHtml(home.id)}"
                    data-index="${index}">
                <div class="portal-home-status ${statusClass}" title="${home.status}"></div>
                <div class="portal-home-info">
                    <span class="portal-home-name">${escapeHtml(home.name)}</span>
                    <span class="portal-home-tier">${escapeHtml(tier.name)}</span>
                    <span class="portal-home-desc">Claude has ${escapeHtml(tier.desc)}</span>
                </div>
                <div class="portal-home-meta">
                    <span class="portal-home-specs">${escapeHtml(tier.specs)}</span>
                    ${home.notebookCount ? `<span class="portal-home-count">${home.notebookCount} notebooks</span>` : ''}
                </div>
            </button>
        `;
    }).join('');

    // Add click handlers
    container.querySelectorAll('.portal-home-card').forEach(card => {
        card.addEventListener('click', () => {
            const id = card.dataset.id;
            selectHome(id);
        });
    });
}

/**
 * Get mock homes for development
 */
function getMockHomes() {
    return [
        {
            id: 'home-1',
            name: 'Workshop',
            tier: 'workshop',
            status: 'running',
            notebookCount: 12,
            region: 'us-east-1'
        },
        {
            id: 'home-2',
            name: 'ML Lab',
            tier: 'lab',
            status: 'stopped',
            notebookCount: 3,
            region: 'us-east-1'
        }
    ];
}

/**
 * Update username display
 */
function updateUsername() {
    const usernameEl = containerEl?.querySelector('#portal-username');
    if (!usernameEl) return;

    const user = SessionState.getUser?.() || { username: 'maxime' };
    usernameEl.textContent = user.username;
}

/**
 * Select a Claude's Home
 */
function selectHome(id) {
    const homes = SessionState.getHomes?.() || getMockHomes();
    const home = homes.find(h => h.id === id);

    if (home) {
        // Set current home in state
        SessionState.setCurrentHome?.(home);

        // Hide portal
        hide();

        // Callback
        if (onHomeSelect) {
            onHomeSelect(home);
        }

        // Emit event
        SessionState.emit('home-selected', { home });
    }
}

/**
 * Handle new home creation
 */
function handleNewHome() {
    showNewHomeView();
}

/**
 * Show account view overlay
 */
function showAccountView() {
    const container = containerEl?.querySelector('#portal-account-view');
    if (!container) return;

    const user = SessionState.getUser?.() || { username: 'maxime', email: 'maxime@example.com' };

    container.innerHTML = `
        <div class="account-view-content">
            <div class="account-view-header">Account</div>

            <div class="account-section">
                <div class="account-row">
                    <span class="account-label">Username</span>
                    <span class="account-value">${escapeHtml(user.username)}</span>
                </div>
                <div class="account-row">
                    <span class="account-label">Email</span>
                    <span class="account-value">${escapeHtml(user.email || '')}</span>
                </div>
            </div>

            <div class="account-section">
                <div class="account-section-title">Billing</div>
                <div class="account-row">
                    <span class="account-label">Plan</span>
                    <span class="account-value">Pay as you go</span>
                </div>
                <button class="account-action-btn">Manage billing →</button>
            </div>

            <div class="account-section">
                <button class="account-action-btn account-signout">Sign out</button>
            </div>

            <div class="account-hint">esc</div>
        </div>
    `;
    container.classList.add('visible');

    // Wire up sign out
    const signoutBtn = container.querySelector('.account-signout');
    signoutBtn?.addEventListener('click', () => {
        SessionState.emit('signout-requested', {});
    });

    // Wire up billing
    const billingBtn = container.querySelector('.account-action-btn:not(.account-signout)');
    billingBtn?.addEventListener('click', () => {
        SessionState.emit('billing-requested', {});
    });
}

/**
 * Close account view overlay
 */
function closeAccountView() {
    const container = containerEl?.querySelector('#portal-account-view');
    if (container) {
        container.classList.remove('visible');
    }
}

/**
 * Show new home creation view
 */
function showNewHomeView() {
    const container = containerEl?.querySelector('#portal-account-view');
    if (!container) return;

    container.innerHTML = `
        <div class="account-view-content new-home-view">
            <div class="account-view-header">New Space</div>

            <div class="new-home-form">
                <label class="new-home-field">
                    <span class="new-home-label">Name</span>
                    <input type="text" class="new-home-input" id="new-home-name"
                           placeholder="My Project" autofocus>
                </label>

                <div class="new-home-tiers">
                    <span class="new-home-label">Size</span>
                    ${Object.entries(TIER_INFO).map(([key, tier]) => `
                        <label class="new-home-tier ${key === 'starter' ? 'selected' : ''}">
                            <input type="radio" name="tier" value="${key}"
                                   ${key === 'starter' ? 'checked' : ''}>
                            <span class="new-home-tier-name">${tier.name}</span>
                            <span class="new-home-tier-desc">Claude has ${tier.desc}</span>
                            <span class="new-home-tier-specs">${tier.specs}</span>
                        </label>
                    `).join('')}
                </div>
            </div>

            <div class="new-home-actions">
                <button class="new-home-cancel">Cancel</button>
                <button class="new-home-create">Create space</button>
            </div>

            <div class="account-hint">esc</div>
        </div>
    `;
    container.classList.add('visible');

    // Wire up tier selection visual feedback
    container.querySelectorAll('.new-home-tier').forEach(tierEl => {
        tierEl.addEventListener('click', () => {
            container.querySelectorAll('.new-home-tier').forEach(t => t.classList.remove('selected'));
            tierEl.classList.add('selected');
        });
    });

    // Wire up cancel
    const cancelBtn = container.querySelector('.new-home-cancel');
    cancelBtn?.addEventListener('click', closeAccountView);

    // Wire up create
    const createBtn = container.querySelector('.new-home-create');
    createBtn?.addEventListener('click', () => {
        const name = container.querySelector('#new-home-name')?.value || 'My Project';
        const tier = container.querySelector('input[name="tier"]:checked')?.value || 'starter';

        SessionState.emit('create-home-requested', { name, tier });
        closeAccountView();
    });
}

/**
 * Handle global keyboard shortcuts
 */
function handleGlobalKeydown(e) {
    if (!isVisible) return;

    // Escape - close overlays or portal
    if (e.key === 'Escape') {
        const accountView = containerEl?.querySelector('#portal-account-view');
        if (accountView?.classList.contains('visible')) {
            e.preventDefault();
            closeAccountView();
            return;
        }

        // Close portal itself
        e.preventDefault();
        hide();
        return;
    }
}

/**
 * Show the portal screen
 */
export function show() {
    if (!containerEl) return;

    containerEl.classList.add('visible');
    isVisible = true;

    renderHomes();
    updateUsername();

    SessionState.emit('portal-screen-shown', {});
}

/**
 * Hide the portal screen
 */
export function hide() {
    if (!containerEl) return;

    containerEl.classList.remove('visible');
    isVisible = false;

    SessionState.emit('portal-screen-hidden', {});
}

/**
 * Toggle portal screen visibility
 */
export function toggle() {
    if (isVisible) {
        hide();
    } else {
        show();
    }
}

/**
 * Check if portal screen is visible
 */
export function isShown() {
    return isVisible;
}

/**
 * Get the container element
 */
export function getElement() {
    return containerEl;
}

/**
 * Destroy the portal screen
 */
export function destroy() {
    document.removeEventListener('keydown', handleGlobalKeydown);

    SessionState.off('homes-updated', renderHomes);
    SessionState.off('user-updated', updateUsername);

    if (containerEl && containerEl.parentNode) {
        containerEl.parentNode.removeChild(containerEl);
    }

    containerEl = null;
    isVisible = false;
}

/**
 * Escape HTML entities
 */
function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text || '';
    return div.innerHTML;
}

export default {
    createPortalScreen,
    show,
    hide,
    toggle,
    isShown,
    getElement,
    destroy
};
