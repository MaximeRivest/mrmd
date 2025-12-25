const { app, BrowserWindow, dialog, ipcMain, Menu } = require('electron');
const { spawn, execSync } = require('child_process');
const path = require('path');
const net = require('net');
const fs = require('fs');
const os = require('os');

let mainWindow = null;
let projectWindows = new Map(); // Map of project path -> BrowserWindow
let serverProcess = null;
let serverPort = 8765;

// Detect if running as packaged app
const isPackaged = app.isPackaged;

// Logging helper
function log(...args) {
    console.log('[MRMD]', ...args);
}

// Get resources path (different in dev vs packaged)
function getResourcesPath() {
    if (isPackaged) {
        // In packaged app: MRMD.app/Contents/Resources/
        return process.resourcesPath;
    } else {
        // In dev: electron-app/bundled/ (if exists) or project root
        const bundledPath = path.join(__dirname, 'bundled');
        if (fs.existsSync(bundledPath)) {
            return bundledPath;
        }
        return null;
    }
}

// Check if bundled Python exists
function hasBundledPython() {
    const resources = getResourcesPath();
    if (!resources) return false;

    const pythonPath = path.join(resources, 'venv', 'bin', 'python');
    return fs.existsSync(pythonPath);
}

// Get bundled Python path
function getBundledPython() {
    const resources = getResourcesPath();
    if (!resources) return null;

    const pythonPath = path.join(resources, 'venv', 'bin', 'python');
    if (fs.existsSync(pythonPath)) {
        return pythonPath;
    }
    return null;
}

// Find uv binary (for dev mode fallback)
function findUv() {
    const home = os.homedir();
    const candidates = [
        path.join(home, '.local/bin/uv'),
        path.join(home, '.cargo/bin/uv'),
        '/usr/local/bin/uv',
        '/usr/bin/uv',
    ];

    for (const candidate of candidates) {
        if (fs.existsSync(candidate)) {
            return candidate;
        }
    }

    // Try which
    try {
        const result = execSync('which uv', { encoding: 'utf8' }).trim();
        if (result) return result;
    } catch (e) {}

    return null;
}

// Install uv if not found (dev mode only)
async function installUv() {
    const home = os.homedir();
    const binDir = path.join(home, '.local/bin');

    log('Installing uv...');

    return new Promise((resolve, reject) => {
        const proc = spawn('sh', ['-c', 'curl -LsSf https://astral.sh/uv/install.sh | sh'], {
            env: { ...process.env, UV_INSTALL_DIR: binDir }
        });

        proc.on('close', (code) => {
            if (code === 0) {
                const uvPath = path.join(binDir, 'uv');
                if (fs.existsSync(uvPath)) {
                    resolve(uvPath);
                } else {
                    reject(new Error('uv installed but binary not found'));
                }
            } else {
                reject(new Error(`uv installation failed with code ${code}`));
            }
        });
    });
}

// Get or install uv (dev mode)
async function getOrInstallUv() {
    let uvPath = findUv();
    if (uvPath) {
        log('Found uv at:', uvPath);
        return uvPath;
    }

    log('uv not found, installing...');
    return await installUv();
}

// Find mrmd project directory (dev mode)
function findMrmdDir() {
    // Check env var
    if (process.env.MRMD_PROJECT_DIR) {
        return process.env.MRMD_PROJECT_DIR;
    }

    // Check parent of electron-app
    const parentDir = path.dirname(__dirname);
    if (fs.existsSync(path.join(parentDir, 'pyproject.toml'))) {
        return parentDir;
    }

    // Check current directory
    const cwd = process.cwd();
    if (fs.existsSync(path.join(cwd, 'pyproject.toml'))) {
        return cwd;
    }

    // Check ~/Projects/mrmd
    const home = os.homedir();
    const defaultPath = path.join(home, 'Projects/mrmd');
    if (fs.existsSync(path.join(defaultPath, 'pyproject.toml'))) {
        return defaultPath;
    }

    return null;
}

// Check if port is in use
function isPortInUse(port) {
    return new Promise((resolve) => {
        const socket = new net.Socket();
        socket.setTimeout(1000);
        socket.on('connect', () => {
            socket.destroy();
            resolve(true);
        });
        socket.on('timeout', () => {
            socket.destroy();
            resolve(false);
        });
        socket.on('error', () => {
            resolve(false);
        });
        socket.connect(port, '127.0.0.1');
    });
}

// Wait for server to be ready
async function waitForServer(port, maxAttempts = 60) {
    log('Waiting for server on port', port);
    for (let i = 0; i < maxAttempts; i++) {
        try {
            const response = await fetch(`http://localhost:${port}/api/health`);
            if (response.ok) {
                log('Server ready after', (i + 1) * 500, 'ms');
                return true;
            }
        } catch (e) {}
        await new Promise(r => setTimeout(r, 500));
        if (i % 10 === 9) {
            log('Still waiting...', Math.round((i + 1) / 2), 's');
        }
    }
    return false;
}

// Start the mrmd server using bundled Python
async function startBundledServer() {
    log('Starting bundled server...');

    const pythonPath = getBundledPython();
    const resources = getResourcesPath();

    log('Python:', pythonPath);
    log('Resources:', resources);

    // Set up environment
    const env = { ...process.env };
    env.PATH = `${path.dirname(pythonPath)}:${env.PATH}`;

    // Start the server
    serverProcess = spawn(pythonPath, ['-m', 'mrmd.cli.main', 'serve', '--port', serverPort.toString()], {
        cwd: resources,
        env: env,
        stdio: ['ignore', 'pipe', 'pipe']
    });

    serverProcess.stdout.on('data', (data) => {
        log('Server:', data.toString().trim());
    });

    serverProcess.stderr.on('data', (data) => {
        log('Server stderr:', data.toString().trim());
    });

    serverProcess.on('close', (code) => {
        log('Server process exited with code', code);
        serverProcess = null;
    });

    serverProcess.on('error', (err) => {
        log('Server process error:', err.message);
    });

    log('Server process spawned, pid:', serverProcess.pid);
    return serverPort;
}

// Start the mrmd server using uv (dev mode)
async function startDevServer() {
    log('Starting dev server with uv...');

    const uvPath = await getOrInstallUv();
    const mrmdDir = findMrmdDir();

    if (!mrmdDir) {
        throw new Error('Could not find mrmd project directory. Set MRMD_PROJECT_DIR or run from project root.');
    }

    log('Using mrmd directory:', mrmdDir);
    log('Starting:', uvPath, 'run mrmd serve --port', serverPort);

    // Expand PATH
    const home = os.homedir();
    const expandedPath = `${home}/.local/bin:${home}/.cargo/bin:/usr/local/bin:${process.env.PATH}`;

    serverProcess = spawn(uvPath, ['run', 'mrmd', 'serve', '--port', serverPort.toString()], {
        cwd: mrmdDir,
        env: { ...process.env, PATH: expandedPath },
        stdio: ['ignore', 'pipe', 'pipe']
    });

    serverProcess.stdout.on('data', (data) => {
        log('Server:', data.toString().trim());
    });

    serverProcess.stderr.on('data', (data) => {
        log('Server stderr:', data.toString().trim());
    });

    serverProcess.on('close', (code) => {
        log('Server process exited with code', code);
        serverProcess = null;
    });

    log('Server process spawned, pid:', serverProcess.pid);
    return serverPort;
}

// Start the server (auto-detect mode)
async function startServer() {
    log('=== Starting MRMD Server ===');
    log('Packaged:', isPackaged);
    log('Has bundled Python:', hasBundledPython());

    // Check if already running
    if (await isPortInUse(serverPort)) {
        log('Port', serverPort, 'already in use, assuming server running');
        return serverPort;
    }

    // Choose startup mode
    if (hasBundledPython()) {
        await startBundledServer();
    } else {
        await startDevServer();
    }

    // Wait for server to be ready
    const ready = await waitForServer(serverPort);
    if (!ready) {
        log('WARNING: Server did not respond after 30s');
    }

    return serverPort;
}

// Stop the server
function stopServer() {
    if (serverProcess) {
        log('Stopping server...');
        serverProcess.kill();
        serverProcess = null;
    }
}

// Create the main window
function createWindow() {
    mainWindow = new BrowserWindow({
        width: 1200,
        height: 800,
        minWidth: 800,
        minHeight: 600,
        title: 'MRMD',
        backgroundColor: '#1a1a1a',
        webPreferences: {
            nodeIntegration: false,
            contextIsolation: true,
            preload: path.join(__dirname, 'preload.js')
        }
    });

    // Load the server URL
    mainWindow.loadURL(`http://localhost:${serverPort}/`);

    // Open DevTools in development
    if (process.env.NODE_ENV === 'development') {
        mainWindow.webContents.openDevTools();
    }

    mainWindow.on('closed', () => {
        mainWindow = null;
    });
}

// Create a window for a specific project
function createProjectWindow(projectPath) {
    // Check if window already exists for this project
    if (projectWindows.has(projectPath)) {
        const existingWindow = projectWindows.get(projectPath);
        if (!existingWindow.isDestroyed()) {
            existingWindow.focus();
            return existingWindow;
        }
        projectWindows.delete(projectPath);
    }

    const projectName = path.basename(projectPath);

    const projectWindow = new BrowserWindow({
        width: 1200,
        height: 800,
        minWidth: 800,
        minHeight: 600,
        title: `MRMD - ${projectName}`,
        backgroundColor: '#1a1a1a',
        webPreferences: {
            nodeIntegration: false,
            contextIsolation: true,
            preload: path.join(__dirname, 'preload.js')
        }
    });

    // Encode the project path for the URL
    const encodedPath = encodeURIComponent(projectPath);
    projectWindow.loadURL(`http://localhost:${serverPort}/?project=${encodedPath}`);

    // Open DevTools in development
    if (process.env.NODE_ENV === 'development') {
        projectWindow.webContents.openDevTools();
    }

    projectWindow.on('closed', () => {
        projectWindows.delete(projectPath);
    });

    // Update window title when page loads
    projectWindow.webContents.on('page-title-updated', (event, title) => {
        event.preventDefault();
        projectWindow.setTitle(`MRMD - ${projectName}`);
    });

    projectWindows.set(projectPath, projectWindow);
    log('Created project window for:', projectPath);

    return projectWindow;
}

// Create application menu with standard edit shortcuts (Cmd+C, Cmd+V, etc.)
function createAppMenu() {
    const isMac = process.platform === 'darwin';

    const template = [
        // App menu (macOS only)
        ...(isMac ? [{
            label: app.name,
            submenu: [
                { role: 'about' },
                { type: 'separator' },
                { role: 'services' },
                { type: 'separator' },
                { role: 'hide' },
                { role: 'hideOthers' },
                { role: 'unhide' },
                { type: 'separator' },
                { role: 'quit' }
            ]
        }] : []),
        // File menu
        {
            label: 'File',
            submenu: [
                isMac ? { role: 'close' } : { role: 'quit' }
            ]
        },
        // Edit menu - essential for Cmd+C/V/X/A to work
        {
            label: 'Edit',
            submenu: [
                { role: 'undo' },
                { role: 'redo' },
                { type: 'separator' },
                { role: 'cut' },
                { role: 'copy' },
                { role: 'paste' },
                ...(isMac ? [
                    { role: 'pasteAndMatchStyle' },
                    { role: 'delete' },
                    { role: 'selectAll' },
                ] : [
                    { role: 'delete' },
                    { type: 'separator' },
                    { role: 'selectAll' }
                ])
            ]
        },
        // View menu
        {
            label: 'View',
            submenu: [
                { role: 'reload' },
                { role: 'forceReload' },
                { role: 'toggleDevTools' },
                { type: 'separator' },
                { role: 'resetZoom' },
                { role: 'zoomIn' },
                { role: 'zoomOut' },
                { type: 'separator' },
                { role: 'togglefullscreen' }
            ]
        },
        // Window menu
        {
            label: 'Window',
            submenu: [
                { role: 'minimize' },
                { role: 'zoom' },
                ...(isMac ? [
                    { type: 'separator' },
                    { role: 'front' },
                    { type: 'separator' },
                    { role: 'window' }
                ] : [
                    { role: 'close' }
                ])
            ]
        }
    ];

    const menu = Menu.buildFromTemplate(template);
    Menu.setApplicationMenu(menu);
}

// App lifecycle
app.whenReady().then(async () => {
    try {
        createAppMenu();
        await startServer();
        createWindow();
    } catch (err) {
        log('Failed to start:', err.message);
        dialog.showErrorBox('MRMD Error', `Failed to start: ${err.message}`);
        app.quit();
    }
});

app.on('window-all-closed', () => {
    stopServer();
    if (process.platform !== 'darwin') {
        app.quit();
    }
});

app.on('activate', () => {
    if (mainWindow === null) {
        createWindow();
    }
});

app.on('before-quit', () => {
    stopServer();
});

// IPC handlers for renderer
ipcMain.handle('restart-server', async () => {
    stopServer();
    await startServer();
    return serverPort;
});

ipcMain.handle('get-server-port', () => {
    return serverPort;
});

ipcMain.handle('open-project-window', (event, projectPath) => {
    log('Opening project in new window:', projectPath);
    createProjectWindow(projectPath);
    return true;
});

ipcMain.handle('select-folder', async () => {
    const result = await dialog.showOpenDialog({
        properties: ['openDirectory'],
        title: 'Select Project Folder'
    });
    if (!result.canceled && result.filePaths.length > 0) {
        return result.filePaths[0];
    }
    return null;
});

