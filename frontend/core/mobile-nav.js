/**
 * Mobile Bottom Navigation for MRMD Compact Mode
 *
 * iOS/Android style bottom navigation bar for mobile viewports.
 */

import * as SessionState from './session-state.js';

let navEl = null;
let activeItem = null;
let onItemClick = null;

// Navigation items
// Note: 'format' removed - now using selection-triggered floating toolbar
const NAV_ITEMS = [
    { id: 'files', icon: '\uD83D\uDCC1', label: 'Files' },
    { id: 'run', icon: '\u25B6', label: 'Run' },
    { id: 'ai', icon: '\uD83E\uDD16', label: 'AI' },
    { id: 'code', icon: '\u25A3', label: 'Code' },
    { id: 'more', icon: '\u2026', label: 'More' }
];

/**
 * Create the mobile bottom navigation
 * @param {Object} options
 * @param {Function} options.onItemClick - Called when a nav item is clicked
 * @returns {HTMLElement}
 */
export function createMobileNav(options = {}) {
    onItemClick = options.onItemClick || (() => {});

    navEl = document.createElement('div');
    navEl.className = 'mobile-bottom-nav';

    NAV_ITEMS.forEach(item => {
        const btn = document.createElement('button');
        btn.className = 'mobile-nav-item';
        btn.dataset.nav = item.id;

        const icon = document.createElement('span');
        icon.className = 'mobile-nav-icon';
        icon.textContent = item.icon;

        const label = document.createElement('span');
        label.className = 'mobile-nav-label';
        label.textContent = item.label;

        btn.appendChild(icon);
        btn.appendChild(label);

        btn.addEventListener('click', () => handleItemClick(item));

        navEl.appendChild(btn);
    });

    return navEl;
}

/**
 * Handle navigation item click
 */
function handleItemClick(item) {
    // Toggle active state
    const wasActive = activeItem === item.id;

    // Deactivate all
    navEl.querySelectorAll('.mobile-nav-item').forEach(btn => {
        btn.classList.remove('active');
    });

    if (wasActive) {
        activeItem = null;
    } else {
        activeItem = item.id;
        const btn = navEl.querySelector(`[data-nav="${item.id}"]`);
        if (btn) {
            btn.classList.add('active');
        }
    }

    if (onItemClick) {
        onItemClick(wasActive ? null : item);
    }

    // Emit event
    SessionState.emit('mobile-nav-clicked', {
        item: wasActive ? null : item,
        id: wasActive ? null : item.id
    });
}

/**
 * Set the active navigation item
 */
export function setActive(itemId) {
    navEl?.querySelectorAll('.mobile-nav-item').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.nav === itemId);
    });
    activeItem = itemId;
}

/**
 * Clear active state
 */
export function clearActive() {
    navEl?.querySelectorAll('.mobile-nav-item').forEach(btn => {
        btn.classList.remove('active');
    });
    activeItem = null;
}

/**
 * Get the active item ID
 */
export function getActive() {
    return activeItem;
}

/**
 * Show the navigation
 */
export function show() {
    if (navEl) {
        navEl.style.display = 'flex';
    }
}

/**
 * Hide the navigation
 */
export function hide() {
    if (navEl) {
        navEl.style.display = 'none';
    }
}

/**
 * Get the navigation element
 */
export function getElement() {
    return navEl;
}

/**
 * Destroy the navigation
 */
export function destroy() {
    if (navEl && navEl.parentNode) {
        navEl.parentNode.removeChild(navEl);
    }
    navEl = null;
    activeItem = null;
}

export default {
    createMobileNav,
    setActive,
    clearActive,
    getActive,
    show,
    hide,
    getElement,
    destroy
};
