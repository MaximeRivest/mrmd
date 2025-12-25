/**
 * Notifications System for mrmd
 *
 * Manages notifications for completed AI/code tasks and running tasks indicator.
 * Features:
 * - Status bar badges for notifications and running tasks
 * - Notification dropdown with history
 * - Running tasks panel
 * - Polling for updates
 */

import { escapeHtml } from './utils.js';

/**
 * Create a notification manager.
 *
 * @param {Object} options - Configuration options
 * @param {Function} options.onNavigate - Called when user clicks to navigate to a notification location
 * @param {Function} options.onStatusChange - Called when notification/running counts change
 * @returns {Object} Notification manager API
 */
export function createNotificationManager(options = {}) {
    const state = {
        notifications: [],
        runningJobs: [],
        unreadCount: 0,
        runningCount: 0,
        pollInterval: null,
        lastCheck: null,
        dropdownVisible: false,
        runningPanelVisible: false,
    };

    // ==================== Polling ====================

    /**
     * Start polling for updates.
     * @param {number} intervalMs - Poll interval in milliseconds (default: 5000)
     */
    function startPolling(intervalMs = 5000) {
        if (state.pollInterval) {
            clearInterval(state.pollInterval);
        }

        // Initial fetch
        fetchStatus();

        // Poll periodically
        state.pollInterval = setInterval(fetchStatus, intervalMs);
    }

    /**
     * Stop polling.
     */
    function stopPolling() {
        if (state.pollInterval) {
            clearInterval(state.pollInterval);
            state.pollInterval = null;
        }
    }

    /**
     * Fetch current status from server.
     */
    async function fetchStatus() {
        try {
            const response = await fetch('/api/jobs/status');
            const data = await response.json();

            const changed =
                state.unreadCount !== data.unread_notifications ||
                state.runningCount !== data.running_count;

            state.unreadCount = data.unread_notifications;
            state.runningCount = data.running_count + data.pending_count;

            if (changed) {
                options.onStatusChange?.({
                    unread: state.unreadCount,
                    running: state.runningCount,
                });
            }
        } catch (err) {
            console.error('[Notifications] Failed to fetch status:', err);
        }
    }

    /**
     * Fetch full notification list from server and merge with local notifications.
     */
    async function fetchNotifications() {
        try {
            const response = await fetch('/api/jobs/notifications');
            const data = await response.json();
            const serverNotifications = data.notifications || [];

            // Preserve local notifications (they have local: true flag)
            const localNotifications = state.notifications.filter(n => n.local);

            // Merge: local notifications first, then server notifications
            state.notifications = [...localNotifications, ...serverNotifications];

            return state.notifications;
        } catch (err) {
            console.error('[Notifications] Failed to fetch notifications:', err);
            // On error, keep existing notifications (including local ones)
            return state.notifications;
        }
    }

    /**
     * Fetch running jobs.
     */
    async function fetchRunningJobs() {
        try {
            const response = await fetch('/api/jobs?status=running');
            const data = await response.json();
            state.runningJobs = data.jobs || [];
            return state.runningJobs;
        } catch (err) {
            console.error('[Notifications] Failed to fetch running jobs:', err);
            return [];
        }
    }

    // ==================== Notifications ====================

    /**
     * Mark a notification as read.
     */
    async function markRead(notificationId) {
        try {
            await fetch('/api/jobs/notifications/read', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ notification_id: notificationId }),
            });

            // Update local state
            const notif = state.notifications.find((n) => n.id === notificationId);
            if (notif) notif.read = true;

            state.unreadCount = Math.max(0, state.unreadCount - 1);
            options.onStatusChange?.({
                unread: state.unreadCount,
                running: state.runningCount,
            });
        } catch (err) {
            console.error('[Notifications] Failed to mark read:', err);
        }
    }

    /**
     * Mark all notifications as read.
     */
    async function markAllRead() {
        try {
            await fetch('/api/jobs/notifications/read', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ all: true }),
            });

            state.notifications.forEach((n) => (n.read = true));
            state.unreadCount = 0;
            options.onStatusChange?.({
                unread: 0,
                running: state.runningCount,
            });
        } catch (err) {
            console.error('[Notifications] Failed to mark all read:', err);
        }
    }

    // ==================== Job Actions ====================

    /**
     * Cancel a running job.
     */
    async function cancelJob(jobId) {
        try {
            await fetch(`/api/jobs/${jobId}`, { method: 'DELETE' });
            await fetchStatus();
        } catch (err) {
            console.error('[Notifications] Failed to cancel job:', err);
        }
    }

    // ==================== UI Components ====================

    /**
     * Create notification badge element for status bar.
     * @returns {HTMLElement}
     */
    function createNotificationBadge() {
        const badge = document.createElement('span');
        badge.className = 'status-indicator notification-badge';
        badge.innerHTML = `
            <span class="badge-icon">🔔</span>
            <span class="badge-count">0</span>
        `;

        badge.addEventListener('click', () => {
            toggleDropdown(badge);
        });

        return badge;
    }

    /**
     * Create running tasks badge element for status bar.
     * @returns {HTMLElement}
     */
    function createRunningBadge() {
        const badge = document.createElement('span');
        badge.className = 'status-indicator running-badge';
        badge.innerHTML = `
            <span class="badge-icon">⏳</span>
            <span class="badge-count">0</span>
        `;

        badge.addEventListener('click', () => {
            toggleRunningPanel(badge);
        });

        return badge;
    }

    /**
     * Update notification badge display.
     */
    function updateNotificationBadge(badge) {
        const countEl = badge.querySelector('.badge-count');
        countEl.textContent = state.unreadCount;
        badge.classList.toggle('has-unread', state.unreadCount > 0);
    }

    /**
     * Update running badge display.
     */
    function updateRunningBadge(badge) {
        const countEl = badge.querySelector('.badge-count');
        countEl.textContent = state.runningCount;
        badge.classList.toggle('has-running', state.runningCount > 0);
    }

    /**
     * Toggle notification dropdown.
     */
    async function toggleDropdown(anchorElement) {
        // Close running panel if open
        closeRunningPanel();

        if (state.dropdownVisible) {
            closeDropdown();
            return;
        }

        // Fetch latest notifications
        await fetchNotifications();

        // Create dropdown
        const dropdown = document.createElement('div');
        dropdown.className = 'notification-dropdown';
        dropdown.innerHTML = `
            <div class="notification-header">
                <span>Notifications</span>
                <button class="notification-mark-all" title="Mark all read">✓</button>
            </div>
            <div class="notification-list"></div>
        `;

        const list = dropdown.querySelector('.notification-list');

        if (state.notifications.length === 0) {
            list.innerHTML = '<div class="notification-empty">No notifications</div>';
        } else {
            for (const notif of state.notifications) {
                const item = createNotificationItem(notif);
                list.appendChild(item);
            }
        }

        // Mark all read button
        dropdown.querySelector('.notification-mark-all').addEventListener('click', async () => {
            await markAllRead();
            // Re-render
            list.querySelectorAll('.notification-item').forEach((item) => {
                item.classList.remove('unread');
            });
        });

        // Position dropdown above the status bar
        document.body.appendChild(dropdown);
        const rect = anchorElement.getBoundingClientRect();
        const dropdownRect = dropdown.getBoundingClientRect();

        // Position above the anchor, align left edge
        let left = rect.left;
        let bottom = window.innerHeight - rect.top + 6;

        // Keep within viewport
        if (left + dropdownRect.width > window.innerWidth - 8) {
            left = window.innerWidth - dropdownRect.width - 8;
        }
        if (left < 8) left = 8;

        dropdown.style.bottom = `${bottom}px`;
        dropdown.style.left = `${left}px`;
        dropdown.style.top = 'auto';

        state.dropdownVisible = true;

        // Close on click outside
        setTimeout(() => {
            document.addEventListener('click', handleOutsideClick);
        }, 0);

        function handleOutsideClick(e) {
            if (!dropdown.contains(e.target) && !anchorElement.contains(e.target)) {
                closeDropdown();
                document.removeEventListener('click', handleOutsideClick);
            }
        }
    }

    function createNotificationItem(notif) {
        const item = document.createElement('div');
        item.className = `notification-item ${notif.read ? '' : 'unread'}`;
        item.dataset.id = notif.id;

        const icon = notif.type === 'error' ? '✗' : notif.type.includes('ai') ? '◇' : '✓';
        const timeAgo = formatTimeAgo(new Date(notif.created_at));

        // For local/AI notifications, show an "open" button
        const hasOpenAction = notif.local && notif.message;
        console.log('[Notifications] Creating item:', notif.id, 'local:', notif.local, 'hasMessage:', !!notif.message, 'hasOpenAction:', hasOpenAction);

        item.innerHTML = `
            <span class="notification-icon">${icon}</span>
            <div class="notification-content">
                <div class="notification-title">${escapeHtml(notif.title)}</div>
                <div class="notification-meta">${escapeHtml(notif.message).substring(0, 80)}${notif.message.length > 80 ? '...' : ''} • ${timeAgo}</div>
            </div>
            ${notif.file_path ? '<button class="notification-goto" title="Go to location">→</button>' : ''}
            ${hasOpenAction ? '<button class="notification-open" title="Open full message">⤢</button>' : ''}
        `;

        // Click to mark read
        item.addEventListener('click', () => {
            if (!notif.read) {
                markRead(notif.id);
                item.classList.remove('unread');
            }
        });

        // Go to file button
        const gotoBtn = item.querySelector('.notification-goto');
        if (gotoBtn) {
            gotoBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                options.onNavigate?.({
                    filePath: notif.file_path,
                    blockIndex: notif.block_index,
                });
                closeDropdown();
            });
        }

        // Open full message button (for AI/local notifications)
        const openBtn = item.querySelector('.notification-open');
        console.log('[Notifications] Open button found:', !!openBtn, 'hasOpenAction was:', hasOpenAction);
        if (openBtn) {
            openBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                console.log('[Notifications] Open button clicked for:', notif.id);
                // Call the onOpenMessage callback to open as temp markdown
                if (options.onOpenMessage) {
                    console.log('[Notifications] Calling onOpenMessage');
                    options.onOpenMessage({
                        title: notif.title,
                        message: notif.message,
                        type: notif.type,
                        created_at: notif.created_at,
                    });
                } else {
                    console.warn('[Notifications] onOpenMessage callback not set!');
                }
                closeDropdown();
                // Mark as read
                if (!notif.read) {
                    markRead(notif.id);
                    item.classList.remove('unread');
                }
            });
        }

        return item;
    }

    function closeDropdown() {
        const dropdown = document.querySelector('.notification-dropdown');
        if (dropdown) {
            dropdown.remove();
        }
        state.dropdownVisible = false;
    }

    /**
     * Toggle running tasks panel.
     */
    async function toggleRunningPanel(anchorElement) {
        // Close notification dropdown if open
        closeDropdown();

        if (state.runningPanelVisible) {
            closeRunningPanel();
            return;
        }

        // Fetch latest running jobs
        await fetchRunningJobs();

        // Create panel
        const panel = document.createElement('div');
        panel.className = 'running-tasks-panel';
        panel.innerHTML = `
            <div class="running-header">
                <span>Running Tasks</span>
            </div>
            <div class="running-list"></div>
        `;

        const list = panel.querySelector('.running-list');

        if (state.runningJobs.length === 0) {
            list.innerHTML = '<div class="running-empty">No running tasks</div>';
        } else {
            for (const job of state.runningJobs) {
                const item = createRunningItem(job);
                list.appendChild(item);
            }
        }

        // Position panel above the status bar
        document.body.appendChild(panel);
        const rect = anchorElement.getBoundingClientRect();
        const panelRect = panel.getBoundingClientRect();

        // Position above the anchor, align left edge
        let left = rect.left;
        let bottom = window.innerHeight - rect.top + 6;

        // Keep within viewport
        if (left + panelRect.width > window.innerWidth - 8) {
            left = window.innerWidth - panelRect.width - 8;
        }
        if (left < 8) left = 8;

        panel.style.bottom = `${bottom}px`;
        panel.style.left = `${left}px`;
        panel.style.top = 'auto';

        state.runningPanelVisible = true;

        // Close on click outside
        setTimeout(() => {
            document.addEventListener('click', handleOutsideClick);
        }, 0);

        function handleOutsideClick(e) {
            if (!panel.contains(e.target) && !anchorElement.contains(e.target)) {
                closeRunningPanel();
                document.removeEventListener('click', handleOutsideClick);
            }
        }
    }

    function createRunningItem(job) {
        const item = document.createElement('div');
        item.className = 'running-item';
        item.dataset.id = job.id;

        const icon = job.type === 'ai' ? '◇' : '▸';
        const name = job.program_name || job.language || 'Task';
        const status = job.progress || job.status;

        item.innerHTML = `
            <span class="running-icon">${icon}</span>
            <div class="running-content">
                <div class="running-title">${escapeHtml(name)}</div>
                <div class="running-meta">${escapeHtml(status)}</div>
            </div>
            <button class="running-cancel" title="Cancel">✕</button>
        `;

        // Cancel button
        item.querySelector('.running-cancel').addEventListener('click', async (e) => {
            e.stopPropagation();
            await cancelJob(job.id);
            item.remove();
            if (document.querySelectorAll('.running-item').length === 0) {
                closeRunningPanel();
            }
        });

        return item;
    }

    function closeRunningPanel() {
        const panel = document.querySelector('.running-tasks-panel');
        if (panel) {
            panel.remove();
        }
        state.runningPanelVisible = false;
    }

    // ==================== Helpers ====================

    // escapeHtml is imported at the module level from utils.js

    function formatTimeAgo(date) {
        const now = new Date();
        const diff = now - date;
        const minutes = Math.floor(diff / 60000);
        const hours = Math.floor(diff / 3600000);
        const days = Math.floor(diff / 86400000);

        if (minutes < 1) return 'just now';
        if (minutes < 60) return `${minutes}m ago`;
        if (hours < 24) return `${hours}h ago`;
        return `${days}d ago`;
    }

    // ==================== Local Notifications ====================

    /**
     * Add a local (ephemeral) notification that shows in the tray.
     * Also shows a brief toast popup for immediate visibility.
     * @param {string} title - Notification title
     * @param {string} message - Notification message
     * @param {string} type - Type: 'info', 'success', 'error', 'ai'
     */
    function addLocalNotification(title, message, type = 'info') {
        const notif = {
            id: `local-${Date.now()}`,
            title,
            message,
            type,
            read: false,
            created_at: new Date().toISOString(),
            local: true,  // Mark as local/ephemeral
        };

        // Add to beginning of notifications list
        state.notifications.unshift(notif);
        state.unreadCount++;

        // Notify status change (updates badge)
        options.onStatusChange?.({
            unread: state.unreadCount,
            running: state.runningCount,
        });

        // Show brief toast for immediate visibility
        showToast(title, message, type);

        console.log('[Notifications] Added local notification:', title, message);

        return notif;
    }

    /**
     * Show a brief toast popup.
     */
    function showToast(title, message, type = 'info') {
        // Remove any existing toast
        const existing = document.querySelector('.notification-toast');
        if (existing) existing.remove();

        const toast = document.createElement('div');
        toast.className = `notification-toast notification-toast-${type}`;

        // Color based on type
        const colors = {
            info: '#17a2b8',
            success: '#28a745',
            error: '#dc3545',
            ai: '#bb9af7',
        };
        const bgColor = colors[type] || colors.info;

        toast.style.cssText = `
            position: fixed;
            bottom: 40px;
            right: 20px;
            max-width: 350px;
            padding: 10px 14px;
            background: ${bgColor};
            color: white;
            border-radius: 6px;
            box-shadow: 0 4px 12px rgba(0,0,0,0.3);
            z-index: 10000;
            font-size: 13px;
            line-height: 1.4;
            cursor: pointer;
            animation: toastSlideIn 0.3s ease-out;
        `;

        toast.innerHTML = `
            <div style="font-weight: 600; margin-bottom: 2px;">${escapeHtml(title)}</div>
            <div style="opacity: 0.9;">${escapeHtml(message).substring(0, 150)}${message.length > 150 ? '...' : ''}</div>
        `;

        // Add animation keyframes if not exists
        if (!document.getElementById('toast-animation-styles')) {
            const style = document.createElement('style');
            style.id = 'toast-animation-styles';
            style.textContent = `
                @keyframes toastSlideIn {
                    from { transform: translateX(100%); opacity: 0; }
                    to { transform: translateX(0); opacity: 1; }
                }
            `;
            document.head.appendChild(style);
        }

        document.body.appendChild(toast);

        // Click to dismiss
        toast.onclick = () => {
            toast.style.opacity = '0';
            toast.style.transition = 'opacity 0.2s';
            setTimeout(() => toast.remove(), 200);
        };

        // Auto-remove after 4 seconds
        setTimeout(() => {
            if (toast.parentNode) {
                toast.style.opacity = '0';
                toast.style.transition = 'opacity 0.3s';
                setTimeout(() => toast.remove(), 300);
            }
        }, 4000);
    }

    // ==================== Return API ====================

    return {
        startPolling,
        stopPolling,
        fetchStatus,
        fetchNotifications,
        fetchRunningJobs,
        markRead,
        markAllRead,
        cancelJob,
        createNotificationBadge,
        createRunningBadge,
        updateNotificationBadge,
        updateRunningBadge,
        toggleDropdown,
        closeDropdown,
        toggleRunningPanel,
        closeRunningPanel,
        addLocalNotification,
        getState: () => ({ ...state }),
    };
}
