/**
 * mrmd Server Manager
 *
 * Manages the lifecycle of the mrmd Python server.
 */

import * as vscode from 'vscode';
import * as cp from 'child_process';
import * as http from 'http';
import * as net from 'net';
import * as fs from 'fs';
import * as path from 'path';

/**
 * Find an available port by binding to port 0 and checking what we get
 */
async function findFreePort(): Promise<number> {
    return new Promise((resolve, reject) => {
        const server = net.createServer();
        server.listen(0, '127.0.0.1', () => {
            const address = server.address();
            if (address && typeof address === 'object') {
                const port = address.port;
                server.close(() => resolve(port));
            } else {
                server.close(() => reject(new Error('Could not get port')));
            }
        });
        server.on('error', reject);
    });
}

/**
 * Find running mrmd servers by scanning common port ranges
 */
export async function findRunningServers(): Promise<{ port: number; sessions: string[] }[]> {
    const servers: { port: number; sessions: string[] }[] = [];

    // Scan ephemeral port range where dynamic ports are typically assigned
    // This is a heuristic - we check ports that respond to our health endpoint
    const checkPort = async (port: number): Promise<{ port: number; sessions: string[] } | null> => {
        return new Promise((resolve) => {
            const req = http.get(`http://localhost:${port}/api/sessions`, (res) => {
                if (res.statusCode === 200) {
                    let data = '';
                    res.on('data', chunk => data += chunk);
                    res.on('end', () => {
                        try {
                            const json = JSON.parse(data);
                            resolve({ port, sessions: json.sessions || [] });
                        } catch {
                            resolve({ port, sessions: [] });
                        }
                    });
                } else {
                    resolve(null);
                }
            });
            req.on('error', () => resolve(null));
            req.setTimeout(200, () => {
                req.destroy();
                resolve(null);
            });
        });
    };

    // Check known mrmd ports - we'll track them in global state
    const knownPorts = getKnownPorts();

    const results = await Promise.all(knownPorts.map(checkPort));
    for (const result of results) {
        if (result) {
            servers.push(result);
        }
    }

    return servers;
}

// Track known ports in a simple way (stored in extension global state)
let knownPortsSet: Set<number> = new Set();

export function registerPort(port: number): void {
    knownPortsSet.add(port);
}

export function unregisterPort(port: number): void {
    knownPortsSet.delete(port);
}

export function getKnownPorts(): number[] {
    return Array.from(knownPortsSet);
}

/**
 * Kill a server running on a specific port
 */
export async function killServerOnPort(port: number): Promise<boolean> {
    return new Promise((resolve) => {
        // Send shutdown request to the server
        const req = http.request({
            hostname: 'localhost',
            port: port,
            path: '/api/shutdown',
            method: 'POST',
        }, (res) => {
            resolve(res.statusCode === 200);
        });
        req.on('error', () => {
            // Try to find and kill the process directly
            const platform = process.platform;
            let cmd: string;
            if (platform === 'win32') {
                cmd = `for /f "tokens=5" %a in ('netstat -aon ^| findstr :${port}') do taskkill /F /PID %a`;
            } else {
                cmd = `lsof -ti:${port} | xargs kill -9 2>/dev/null || fuser -k ${port}/tcp 2>/dev/null`;
            }
            cp.exec(cmd, (err) => {
                resolve(!err);
            });
        });
        req.setTimeout(1000, () => {
            req.destroy();
            resolve(false);
        });
        req.end();
    });
}

export class MrmdServerManager {
    private process: cp.ChildProcess | null = null;
    private outputChannel: vscode.OutputChannel;
    private port: number = 0;  // 0 = will be assigned dynamically
    private _onServerReady = new vscode.EventEmitter<void>();
    private _onServerStopped = new vscode.EventEmitter<void>();

    readonly onServerReady = this._onServerReady.event;
    readonly onServerStopped = this._onServerStopped.event;

    constructor(private context: vscode.ExtensionContext) {
        this.outputChannel = vscode.window.createOutputChannel('mrmd Server');
        // Port will be assigned dynamically on start()
    }

    get serverUrl(): string {
        return `http://localhost:${this.port}`;
    }

    get serverPort(): number {
        return this.port;
    }

    get isRunning(): boolean {
        return this.process !== null;
    }

    /**
     * Start the mrmd server
     */
    async start(): Promise<boolean> {
        if (this.process) {
            this.outputChannel.appendLine('Server already running');
            return true;
        }

        // Find a free port dynamically
        try {
            this.port = await findFreePort();
            registerPort(this.port);  // Track this port for zombie detection
            this.outputChannel.appendLine(`Using port ${this.port}`);
        } catch (err) {
            this.outputChannel.appendLine(`Failed to find free port: ${err}`);
            return false;
        }

        return new Promise((resolve) => {
            const { command, args, pythonPath } = this.getServerCommand();
            this.outputChannel.appendLine(`Starting server: ${command} ${args.join(' ')}`);
            this.outputChannel.show(true);

            let stderrBuffer = '';

            this.process = cp.spawn(command, args, {
                env: { ...process.env, PYTHONUNBUFFERED: '1' }
            });

            this.process.stdout?.on('data', (data) => {
                this.outputChannel.append(data.toString());
            });

            this.process.stderr?.on('data', (data) => {
                const text = data.toString();
                stderrBuffer += text;
                this.outputChannel.append(text);
            });

            this.process.on('error', (err) => {
                this.outputChannel.appendLine(`Server error: ${err.message}`);
                vscode.window.showErrorMessage(`Failed to start mrmd server: ${err.message}`);
                this.process = null;
                resolve(false);
            });

            this.process.on('exit', (code) => {
                this.outputChannel.appendLine(`Server exited with code ${code}`);
                this.process = null;
                this._onServerStopped.fire();

                // Check if it failed due to missing mrmd module
                if (code !== 0 && stderrBuffer.includes('No module named') && stderrBuffer.includes('mrmd')) {
                    this.offerMrmdInstall(pythonPath);
                }
            });

            // Wait for server to be ready
            this.waitForServer(30).then((ready) => {
                if (ready) {
                    this.outputChannel.appendLine('Server is ready');
                    this._onServerReady.fire();
                    resolve(true);
                } else {
                    this.outputChannel.appendLine('Server failed to start');
                    this.stop();
                    resolve(false);
                }
            });
        });
    }

    /**
     * Offer to install mrmd package when module not found
     */
    private async offerMrmdInstall(pythonPath?: string): Promise<void> {
        const install = await vscode.window.showErrorMessage(
            'The mrmd Python package is not installed in your environment. Would you like to install it?',
            'Install mrmd',
            'Cancel'
        );

        if (install === 'Install mrmd') {
            await this.installMrmdPackage(pythonPath);
        }
    }

    /**
     * Install mrmd package using uv pip
     */
    async installMrmdPackage(pythonPath?: string): Promise<boolean> {
        return vscode.window.withProgress({
            location: vscode.ProgressLocation.Notification,
            title: 'Installing mrmd...',
            cancellable: false
        }, async (progress) => {
            try {
                this.outputChannel.show();
                this.outputChannel.appendLine('Installing mrmd package...');

                const extensionPath = this.context.extensionPath;

                // Build uv pip install command
                // -p/--python specifies which Python/venv to install into
                const pythonFlag = pythonPath ? `-p "${pythonPath}"` : '';

                let installCmd: string;

                // Check for local mrmd source path setting
                const config = vscode.workspace.getConfiguration('mrmd');
                const localMrmdPath = config.get<string>('localMrmdPath', '');

                if (localMrmdPath) {
                    // User specified a local path
                    installCmd = `uv pip install ${pythonFlag} -e "${localMrmdPath}"`;
                    this.outputChannel.appendLine(`Installing from configured path: ${localMrmdPath}`);
                } else if (extensionPath.endsWith('/vscode') || extensionPath.endsWith('\\vscode')) {
                    // Dev mode: install from local path with -e (editable)
                    const mrmdPath = path.dirname(extensionPath);
                    installCmd = `uv pip install ${pythonFlag} -e "${mrmdPath}"`;
                    this.outputChannel.appendLine(`Installing from local path: ${mrmdPath}`);
                } else {
                    // Production: install from PyPI
                    installCmd = `uv pip install ${pythonFlag} mrmd`;
                }

                progress.report({ message: 'Installing mrmd package...' });
                this.outputChannel.appendLine(`Running: ${installCmd}`);

                await this.execCommand(installCmd);

                this.outputChannel.appendLine('✓ mrmd installed successfully');
                vscode.window.showInformationMessage('✓ mrmd installed! Starting server...');

                // Try to start server again
                setTimeout(() => this.start(), 500);
                return true;
            } catch (error) {
                const msg = error instanceof Error ? error.message : String(error);
                this.outputChannel.appendLine(`✗ Failed to install mrmd: ${msg}`);
                vscode.window.showErrorMessage(`Failed to install mrmd: ${msg}`);
                return false;
            }
        });
    }

    /**
     * Execute a shell command
     */
    private execCommand(command: string): Promise<string> {
        return new Promise((resolve, reject) => {
            cp.exec(command, {
                timeout: 120000,
                env: process.env
            }, (error, stdout, stderr) => {
                if (error) {
                    reject(new Error(stderr || error.message));
                } else {
                    resolve(stdout + stderr);
                }
            });
        });
    }

    /**
     * Stop the mrmd server
     */
    async stop(): Promise<void> {
        if (this.process) {
            this.outputChannel.appendLine('Stopping server...');
            this.process.kill();
            this.process = null;
            this._onServerStopped.fire();

            // Wait for the server to actually stop responding
            for (let i = 0; i < 20; i++) {
                if (!(await this.checkHealth())) {
                    this.outputChannel.appendLine('Server stopped');
                    unregisterPort(this.port);
                    return;
                }
                await new Promise(r => setTimeout(r, 100));
            }
            this.outputChannel.appendLine('Warning: Server may still be running');
        }
    }

    /**
     * Restart the server
     */
    async restart(): Promise<boolean> {
        await this.stop();
        return this.start();
    }

    /**
     * Check if the server is healthy
     */
    async checkHealth(): Promise<boolean> {
        return new Promise((resolve) => {
            const req = http.get(`${this.serverUrl}/api/sessions`, (res) => {
                resolve(res.statusCode === 200);
            });
            req.on('error', () => resolve(false));
            req.setTimeout(1000, () => {
                req.destroy();
                resolve(false);
            });
        });
    }

    /**
     * Wait for server to become available
     */
    private async waitForServer(maxAttempts: number): Promise<boolean> {
        for (let i = 0; i < maxAttempts; i++) {
            if (await this.checkHealth()) {
                return true;
            }
            await new Promise(r => setTimeout(r, 500));
        }
        return false;
    }

    /**
     * Find Python executable in a venv directory
     */
    private findVenvPython(venvPath: string): string | null {
        // Check for common venv python locations
        const candidates = [
            path.join(venvPath, 'bin', 'python'),           // Linux/macOS
            path.join(venvPath, 'bin', 'python3'),          // Linux/macOS
            path.join(venvPath, 'Scripts', 'python.exe'),   // Windows
        ];

        for (const candidate of candidates) {
            if (fs.existsSync(candidate)) {
                return candidate;
            }
        }
        return null;
    }

    /**
     * Look for .venv in a directory and return Python path if found
     */
    private findVenvInDir(dir: string): string | null {
        const venvNames = ['.venv', 'venv', '.env', 'env'];
        for (const name of venvNames) {
            const venvPath = path.join(dir, name);
            if (fs.existsSync(venvPath)) {
                const pythonPath = this.findVenvPython(venvPath);
                if (pythonPath) {
                    this.outputChannel.appendLine(`Found venv Python: ${pythonPath}`);
                    return pythonPath;
                }
            }
        }
        return null;
    }

    /**
     * Get the server command and arguments.
     * Priority:
     * 1. Explicit mrmd.pythonPath setting
     * 2. Auto-detect .venv based on mrmd.pythonEnvSource setting
     * 3. Python extension's active environment
     * 4. uv run (fallback)
     *
     * Returns pythonPath when using a specific Python (for package installation)
     */
    private getServerCommand(): { command: string; args: string[]; pythonPath?: string } {
        const portArgs = ['--port', this.port.toString()];
        const config = vscode.workspace.getConfiguration('mrmd');
        const envSource = config.get<string>('pythonEnvSource', 'workspace');

        // 1. Check extension config for explicit python path
        const configPath = config.get<string>('pythonPath');
        if (envSource === 'explicit' && configPath) {
            this.outputChannel.appendLine(`Using explicit Python path: ${configPath}`);
            return {
                command: configPath,
                args: ['-m', 'mrmd.cli.main', 'serve', ...portArgs],
                pythonPath: configPath
            };
        }

        // 2. Auto-detect .venv based on envSource setting
        let searchDir: string | undefined;

        if (envSource === 'workspace') {
            // Look in workspace root
            searchDir = this.getWorkspaceRoot();
        } else if (envSource === 'markdownFolder') {
            // Look in the folder of the active markdown file
            const activeEditor = vscode.window.activeTextEditor;
            if (activeEditor && activeEditor.document.languageId === 'markdown') {
                searchDir = path.dirname(activeEditor.document.uri.fsPath);
            } else {
                // Fallback to workspace root if no markdown file is active
                searchDir = this.getWorkspaceRoot();
            }
        }

        if (searchDir) {
            const venvPython = this.findVenvInDir(searchDir);
            if (venvPython) {
                return {
                    command: venvPython,
                    args: ['-m', 'mrmd.cli.main', 'serve', ...portArgs],
                    pythonPath: venvPython
                };
            }
        }

        // 3. If explicit pythonPath is set (and we're here because auto-detection failed), use it
        if (configPath) {
            this.outputChannel.appendLine(`Using configured Python path: ${configPath}`);
            return {
                command: configPath,
                args: ['-m', 'mrmd.cli.main', 'serve', ...portArgs],
                pythonPath: configPath
            };
        }

        // 4. Check Python extension for workspace's python
        const pythonExt = vscode.extensions.getExtension('ms-python.python');
        if (pythonExt?.isActive) {
            const pythonApi = pythonExt.exports;
            const envPath = pythonApi?.environments?.getActiveEnvironmentPath?.();
            if (envPath?.path) {
                this.outputChannel.appendLine(`Using Python extension path: ${envPath.path}`);
                return {
                    command: envPath.path,
                    args: ['-m', 'mrmd.cli.main', 'serve', ...portArgs],
                    pythonPath: envPath.path
                };
            }
        }

        // 5. Default to uv with --project pointing to mrmd installation
        let mrmdProjectPath: string;

        // Check if we're in development (extension path contains /vscode)
        const extensionPath = this.context.extensionPath;
        if (extensionPath.endsWith('/vscode') || extensionPath.endsWith('\\vscode')) {
            // Dev mode: mrmd project is parent directory
            mrmdProjectPath = path.dirname(extensionPath);
        } else {
            // Installed extension: mrmd should be in extension's bundled files
            mrmdProjectPath = extensionPath;
        }

        this.outputChannel.appendLine(`Using uv with mrmd project: ${mrmdProjectPath}`);

        // No specific pythonPath - uv manages the environment
        return {
            command: 'uv',
            args: ['run', '--project', mrmdProjectPath, 'python', '-m', 'mrmd.cli.main', 'serve', ...portArgs]
        };
    }

    /**
     * Get workspace root folder
     */
    private getWorkspaceRoot(): string | undefined {
        const folders = vscode.workspace.workspaceFolders;
        return folders?.[0]?.uri.fsPath;
    }

    /**
     * Execute code in a session
     */
    async execute(code: string, sessionId: string = 'default'): Promise<any> {
        const response = await fetch(`${this.serverUrl}/api/interact`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                keys: code + '<enter>',
                session: sessionId,
                wait: 'auto'
            })
        });
        return response.json();
    }

    /**
     * Read a file through the server
     */
    async readFile(path: string): Promise<any> {
        const response = await fetch(`${this.serverUrl}/api/file/read`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ path })
        });
        return response.json();
    }

    /**
     * Write a file through the server
     */
    async writeFile(path: string, content: string): Promise<any> {
        const response = await fetch(`${this.serverUrl}/api/file/write`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ path, content })
        });
        return response.json();
    }

    dispose(): void {
        this.stop();
        this.outputChannel.dispose();
        this._onServerReady.dispose();
        this._onServerStopped.dispose();
    }
}
