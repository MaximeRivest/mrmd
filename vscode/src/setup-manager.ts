/**
 * Setup Manager for mrmd
 *
 * Handles first-time setup for uv and Python.
 * mrmd package installation is handled by server-manager when server fails to start.
 */

import * as vscode from 'vscode';
import * as cp from 'child_process';
import * as path from 'path';
import * as os from 'os';

interface SetupStatus {
    uvInstalled: boolean;
    uvPath?: string;
    pythonFound: boolean;
    pythonPath?: string;
    pythonVersion?: string;
}

export class SetupManager {
    private outputChannel: vscode.OutputChannel;
    private context: vscode.ExtensionContext;

    constructor(context: vscode.ExtensionContext) {
        this.context = context;
        this.outputChannel = vscode.window.createOutputChannel('mrmd Setup');
    }

    /**
     * Run the setup check when a markdown file is opened
     */
    async checkOnFirstOpen(): Promise<void> {
        // Check if we've already completed setup
        const setupComplete = this.context.globalState.get<boolean>('mrmd.setupComplete', false);
        if (setupComplete) {
            return;
        }

        // Run the setup check
        await this.runSetupWizard();
    }

    /**
     * Force run the setup wizard (can be called from command)
     */
    async runSetupWizard(): Promise<void> {
        const status = await this.checkStatus();

        this.outputChannel.appendLine('=== mrmd Setup Status ===');
        this.outputChannel.appendLine(`uv: ${status.uvInstalled ? `✓ ${status.uvPath}` : '✗ Not found'}`);
        this.outputChannel.appendLine(`Python: ${status.pythonFound ? `✓ ${status.pythonPath} (${status.pythonVersion})` : '✗ Not found'}`);

        // Step 1: Check for uv
        if (!status.uvInstalled) {
            const install = await vscode.window.showInformationMessage(
                'mrmd requires uv (Python package manager) which was not found. Would you like to install it?',
                'Install uv',
                'I\'ll install manually',
                'Help'
            );

            if (install === 'Install uv') {
                const success = await this.installUv();
                if (!success) {
                    return;
                }
                // Re-check status after installation
                status.uvInstalled = true;
                status.uvPath = await this.findUv();
            } else if (install === 'Help') {
                vscode.env.openExternal(vscode.Uri.parse('https://docs.astral.sh/uv/getting-started/installation/'));
                return;
            } else {
                // User will install manually
                vscode.window.showInformationMessage(
                    'Please install uv and restart VS Code. Visit https://docs.astral.sh/uv/ for instructions.'
                );
                return;
            }
        }

        // Step 2: Check for Python (uv can install it)
        if (!status.pythonFound) {
            const install = await vscode.window.showInformationMessage(
                'Python was not found. Would you like uv to install it for you?',
                'Install Python',
                'I\'ll install manually'
            );

            if (install === 'Install Python') {
                const success = await this.installPython();
                if (!success) {
                    return;
                }
                status.pythonFound = true;
            } else {
                vscode.window.showInformationMessage(
                    'Please install Python 3.10+ and restart VS Code.'
                );
                return;
            }
        }

        // Mark setup as complete
        await this.context.globalState.update('mrmd.setupComplete', true);

        // Final status
        if (status.uvInstalled && status.pythonFound) {
            vscode.window.showInformationMessage(
                '✓ uv and Python are ready! The mrmd package will be installed when you first run code.'
            );
        }
    }

    /**
     * Check the current setup status
     */
    async checkStatus(): Promise<SetupStatus> {
        const status: SetupStatus = {
            uvInstalled: false,
            pythonFound: false,
        };

        // Check for uv
        status.uvPath = await this.findUv();
        status.uvInstalled = !!status.uvPath;

        // Check for Python
        const pythonInfo = await this.findPython();
        if (pythonInfo) {
            status.pythonFound = true;
            status.pythonPath = pythonInfo.path;
            status.pythonVersion = pythonInfo.version;
        }

        return status;
    }

    /**
     * Find uv executable
     */
    private async findUv(): Promise<string | undefined> {
        const candidates = ['uv'];

        // Add platform-specific paths
        if (process.platform === 'win32') {
            candidates.push(
                path.join(os.homedir(), '.cargo', 'bin', 'uv.exe'),
                path.join(os.homedir(), 'AppData', 'Local', 'uv', 'uv.exe')
            );
        } else {
            candidates.push(
                path.join(os.homedir(), '.cargo', 'bin', 'uv'),
                path.join(os.homedir(), '.local', 'bin', 'uv'),
                '/usr/local/bin/uv',
                '/opt/homebrew/bin/uv'
            );
        }

        for (const candidate of candidates) {
            try {
                const result = await this.exec(`${candidate} --version`);
                if (result.includes('uv')) {
                    return candidate;
                }
            } catch {
                // Try next candidate
            }
        }

        return undefined;
    }

    /**
     * Find Python executable
     */
    private async findPython(): Promise<{ path: string; version: string } | undefined> {
        const candidates = ['python3', 'python'];

        // Add platform-specific paths
        if (process.platform !== 'win32') {
            candidates.push(
                '/usr/bin/python3',
                '/usr/local/bin/python3',
                '/opt/homebrew/bin/python3'
            );
        }

        for (const candidate of candidates) {
            try {
                const version = await this.exec(`${candidate} --version`);
                if (version.includes('Python 3')) {
                    return {
                        path: candidate,
                        version: version.trim().replace('Python ', '')
                    };
                }
            } catch {
                // Try next candidate
            }
        }

        return undefined;
    }

    /**
     * Install uv
     */
    private async installUv(): Promise<boolean> {
        return vscode.window.withProgress({
            location: vscode.ProgressLocation.Notification,
            title: 'Installing uv...',
            cancellable: false
        }, async (progress) => {
            try {
                this.outputChannel.show();
                this.outputChannel.appendLine('Installing uv...');

                let installCmd: string;
                if (process.platform === 'win32') {
                    installCmd = 'powershell -ExecutionPolicy ByPass -c "irm https://astral.sh/uv/install.ps1 | iex"';
                } else {
                    installCmd = 'curl -LsSf https://astral.sh/uv/install.sh | sh';
                }

                progress.report({ message: 'Downloading and installing...' });
                const result = await this.exec(installCmd);
                this.outputChannel.appendLine(result);

                // Verify installation
                progress.report({ message: 'Verifying installation...' });
                const uvPath = await this.findUv();

                if (uvPath) {
                    this.outputChannel.appendLine(`✓ uv installed successfully at ${uvPath}`);
                    vscode.window.showInformationMessage('✓ uv installed successfully!');
                    return true;
                } else {
                    throw new Error('uv installation completed but binary not found. You may need to restart your terminal or VS Code.');
                }
            } catch (error) {
                const msg = error instanceof Error ? error.message : String(error);
                this.outputChannel.appendLine(`✗ Failed to install uv: ${msg}`);
                vscode.window.showErrorMessage(`Failed to install uv: ${msg}`);
                return false;
            }
        });
    }

    /**
     * Install Python using uv
     */
    private async installPython(): Promise<boolean> {
        return vscode.window.withProgress({
            location: vscode.ProgressLocation.Notification,
            title: 'Installing Python...',
            cancellable: false
        }, async (progress) => {
            try {
                this.outputChannel.show();
                this.outputChannel.appendLine('Installing Python via uv...');

                progress.report({ message: 'Downloading Python 3.12...' });
                const result = await this.exec('uv python install 3.12');
                this.outputChannel.appendLine(result);

                this.outputChannel.appendLine('✓ Python installed successfully');
                vscode.window.showInformationMessage('✓ Python installed successfully!');
                return true;
            } catch (error) {
                const msg = error instanceof Error ? error.message : String(error);
                this.outputChannel.appendLine(`✗ Failed to install Python: ${msg}`);
                vscode.window.showErrorMessage(`Failed to install Python: ${msg}`);
                return false;
            }
        });
    }

    /**
     * Execute a shell command
     */
    private exec(command: string): Promise<string> {
        return new Promise((resolve, reject) => {
            cp.exec(command, {
                timeout: 120000,
                env: { ...process.env, PATH: this.getExtendedPath() }
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
     * Get PATH with common binary locations added
     */
    private getExtendedPath(): string {
        const currentPath = process.env.PATH || '';
        const additions: string[] = [];

        if (process.platform === 'win32') {
            additions.push(
                path.join(os.homedir(), '.cargo', 'bin'),
                path.join(os.homedir(), 'AppData', 'Local', 'uv')
            );
        } else {
            additions.push(
                path.join(os.homedir(), '.cargo', 'bin'),
                path.join(os.homedir(), '.local', 'bin'),
                '/usr/local/bin',
                '/opt/homebrew/bin'
            );
        }

        return [...additions, currentPath].join(path.delimiter);
    }

    /**
     * Reset setup state (for testing)
     */
    async resetSetup(): Promise<void> {
        await this.context.globalState.update('mrmd.setupComplete', false);
        vscode.window.showInformationMessage('mrmd setup state has been reset.');
    }

    dispose(): void {
        this.outputChannel.dispose();
    }
}
