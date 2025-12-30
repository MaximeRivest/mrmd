/**
 * Atelier Boot - Application Entry Point
 *
 * This is the main entry point for the Atelier application.
 * Single unified app with two interface modes based on URL/domain:
 *
 * - Study (atelier.study): Compact mode - minimal chrome, writer-focused
 * - Codes (atelier.codes): Developer mode - full IDE with sidebar, terminal
 *
 * Both modes share the same codebase; only the default interface differs.
 * Users can toggle between modes at runtime via the mode switcher.
 *
 * Detection order:
 * 1. ?mode=study or ?mode=codes URL parameter
 * 2. Domain name (atelier.study vs atelier.codes)
 * 3. Default to 'codes' (developer mode)
 */

import { DocumentService } from './services/DocumentService';
import { CollaborationService } from './services/CollaborationService';
import type { IDocumentService, ICollaborationService } from './services/interfaces';

// ============================================================================
// Service Container
// ============================================================================

export interface Services {
    documents: IDocumentService;
    collaboration: ICollaborationService;
}

// ============================================================================
// Mode Detection
// ============================================================================

type AppMode = 'study' | 'codes';

function detectMode(): AppMode {
    // 1. Check URL parameter
    const urlParams = new URLSearchParams(window.location.search);
    const modeParam = urlParams.get('mode');
    if (modeParam === 'study' || modeParam === 'codes') {
        return modeParam;
    }

    // 2. Check domain
    const hostname = window.location.hostname;
    if (hostname === 'atelier.study' || hostname.includes('study')) {
        return 'study';
    }
    if (hostname === 'atelier.codes' || hostname.includes('codes')) {
        return 'codes';
    }

    // 3. Default to codes (developer mode)
    return 'codes';
}

// ============================================================================
// Service Initialization
// ============================================================================

function createServices(): Services {
    return {
        documents: new DocumentService(),
        collaboration: new CollaborationService(),
    };
}

// ============================================================================
// Application Bootstrap
// ============================================================================

async function boot(): Promise<void> {
    const mode = detectMode();
    const defaultInterface = mode === 'study' ? 'compact' : 'developer';
    console.log(`[Boot] Starting Atelier (${mode} → ${defaultInterface} mode)...`);

    // Create services
    const services = createServices();
    console.log('[Boot] Services initialized');

    // Load unified app with appropriate default mode
    try {
        const app = await import('./apps/codes/index');
        await app.mount(services, { defaultMode: defaultInterface });
        console.log(`[Boot] ${mode === 'study' ? 'Study' : 'Codes'} mode ready`);
    } catch (err) {
        console.error('[Boot] Failed to load app:', err);
        showBootError(err);
    }
}

// ============================================================================
// Error Handling
// ============================================================================

function showBootError(err: unknown): void {
    const message = err instanceof Error ? err.message : String(err);
    document.body.innerHTML = `
        <div style="
            display: flex;
            flex-direction: column;
            align-items: center;
            justify-content: center;
            height: 100vh;
            background: #1a1b26;
            color: #f7768e;
            font-family: system-ui, -apple-system, sans-serif;
            padding: 20px;
            text-align: center;
        ">
            <h1 style="font-size: 24px; margin-bottom: 16px;">Failed to start Atelier</h1>
            <pre style="
                background: rgba(255, 255, 255, 0.05);
                padding: 16px 24px;
                border-radius: 8px;
                font-size: 14px;
                max-width: 600px;
                overflow-x: auto;
            ">${message}</pre>
            <button onclick="location.reload()" style="
                margin-top: 24px;
                padding: 12px 24px;
                background: rgba(122, 162, 247, 0.15);
                border: 1px solid rgba(122, 162, 247, 0.3);
                border-radius: 6px;
                color: #7aa2f7;
                cursor: pointer;
                font-size: 14px;
            ">Reload</button>
        </div>
    `;
}

// ============================================================================
// Start
// ============================================================================

// Boot when DOM is ready
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
} else {
    boot();
}
