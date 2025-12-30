#!/usr/bin/env node
/**
 * mrmd Frontend Build Script
 *
 * Uses esbuild to bundle the frontend modules for production.
 *
 * Build order:
 * 1. Compile core/*.ts → core/*.js (individual ESM modules)
 * 2. Bundle boot.ts → boot.js (with core modules as externals)
 * 3. Bundle core/index.js → dist/mrmd.bundle.js
 *
 * Usage:
 *   node build.js          # Production build
 *   node build.js --watch  # Watch mode for development
 */

const esbuild = require('esbuild');
const path = require('path');
const fs = require('fs');

const isWatch = process.argv.includes('--watch');

// Bundle config for legacy JS modules
const config = {
    entryPoints: ['core/index.js'],
    bundle: true,
    outfile: 'dist/mrmd.bundle.js',
    format: 'esm',
    minify: !isWatch,
    sourcemap: true,
    target: ['es2020'],
    external: ['/editor-dist/index.browser.js'],
    banner: {
        js: '/* mrmd frontend bundle - https://mrmd.dev */\n'
    }
};

// Config for service-based boot entry point (Atelier architecture)
// Uses @mrmd/editor directly - no bridge/shim
const bootConfig = {
    entryPoints: ['src/boot.ts'],
    bundle: true,
    outfile: 'src/boot.js',
    format: 'esm',
    minify: false,
    sourcemap: true,
    target: ['es2020'],
    // External modules - loaded at runtime from server
    external: [
        // @mrmd/editor - the core editor package
        '/editor-dist/index.browser.js',
        // Legacy UI modules (kept for now, will migrate to TS later)
        '/core/ipython-client.js',
        '/core/utils.js',
        '/core/session-state.js',
        '/core/session-ui.js',
        '/core/file-tabs.js',
        '/core/recent-projects.js',
        '/core/file-browser.js',
        '/core/ai-client.js',
        '/core/ai-palette.js',
        '/core/history-panel.js',
        '/core/collab-client.js',
        '/core/terminal-tabs.js',
        '/core/notifications.js',
        '/core/process-sidebar.js',
        '/core/compact-mode.js',
        '/core/selection-toolbar.js',
        '/core/keybinding-manager.js',
        '/core/editor-keybindings.js',
        '/core/variables-panel.js',
        '/core/developer-status.js',
        '/core/keybindings.js',
    ],
    banner: {
        js: '/* Atelier boot - clean service architecture */\n'
    }
};

/**
 * Build individual TypeScript modules in core/ to ESM JavaScript.
 * These are NOT bundled - they remain as individual modules loaded at runtime.
 */
async function buildCoreModules() {
    const coreDir = path.join(__dirname, 'core');
    const files = fs.readdirSync(coreDir);
    const tsFiles = files.filter(f => f.endsWith('.ts') && !f.endsWith('.d.ts'));

    if (tsFiles.length === 0) {
        console.log('No TypeScript core modules found');
        return;
    }

    console.log(`Building ${tsFiles.length} core TypeScript module(s)...`);

    await Promise.all(
        tsFiles.map(tsFile => {
            const inFile = path.join('core', tsFile);
            const outFile = path.join('core', tsFile.replace(/\.ts$/, '.js'));

            return esbuild.build({
                entryPoints: [inFile],
                outfile: outFile,
                format: 'esm',
                bundle: false,  // Don't bundle - keep as individual module
                sourcemap: true,
                target: ['es2020'],
                logLevel: 'warning',
            });
        })
    );

    console.log('Core TypeScript modules built:', tsFiles.map(f => f.replace('.ts', '.js')).join(', '));
}

async function build() {
    // Ensure dist directory exists
    const distDir = path.join(__dirname, 'dist');
    if (!fs.existsSync(distDir)) {
        fs.mkdirSync(distDir, { recursive: true });
    }

    // Copy CSS to dist
    const cssSource = path.join(__dirname, 'styles', 'main.css');
    const cssDest = path.join(distDir, 'mrmd.css');
    fs.copyFileSync(cssSource, cssDest);
    console.log('Copied styles/main.css -> dist/mrmd.css');

    // 1. Build core TypeScript modules FIRST (before boot, which has them as externals)
    await buildCoreModules();

    // 2. Build the boot entry point (service architecture)
    console.log('Building boot entry...');
    await esbuild.build(bootConfig);
    console.log('Built:', bootConfig.outfile);

    if (isWatch) {
        const ctx = await esbuild.context(config);
        const bootCtx = await esbuild.context(bootConfig);
        await Promise.all([ctx.watch(), bootCtx.watch()]);
        console.log('Watching for changes...');
    } else {
        const result = await esbuild.build(config);
        console.log('Build complete:', config.outfile);
        if (result.metafile) {
            console.log('Bundle size:',
                Object.values(result.metafile.outputs)
                    .reduce((sum, o) => sum + o.bytes, 0), 'bytes');
        }
    }
}

build().catch((err) => {
    console.error('Build failed:', err);
    process.exit(1);
});
