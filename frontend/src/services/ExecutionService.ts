import { IExecutionService, IExecutionResult } from './interfaces';
import { IPythonClient } from './IPythonClient';

type Unsubscribe = () => void;

export class ExecutionService implements IExecutionService {
    private client: IPythonClient;
    private _isRunning: boolean = false;
    private _listeners: {
        executionStart: Set<(blockId?: string) => void>;
        executionComplete: Set<(result: IExecutionResult, blockId?: string) => void>;
        statusChange: Set<(status: 'idle' | 'busy' | 'starting') => void>;
    } = {
        executionStart: new Set(),
        executionComplete: new Set(),
        statusChange: new Set()
    };

    constructor() {
        this.client = new IPythonClient();
    }

    get isRunning(): boolean {
        return this._isRunning;
    }

    setProjectPath(path: string) {
        this.client.setProjectPath(path);
        // Default figure dir convention
        this.client.setFigureDir(path + '/.mrmd/assets');
    }

    setSessionId(sessionId: string) {
        this.client.setSession(sessionId);
    }

    async runCode(code: string, lang: string): Promise<IExecutionResult> {
        return this.runBlock(undefined, code, lang);
    }

    async runBlock(blockId: string | undefined, code: string, lang: string): Promise<IExecutionResult> {
        if (this._isRunning) {
            // TODO: Queueing logic
            console.warn('Execution already in progress, queueing not yet implemented in Service');
        }

        this._isRunning = true;
        this._emit('statusChange', 'busy');
        this._emit('executionStart', blockId);

        try {
            // Check language
            if (lang !== 'python') {
                // TODO: Support JS execution in browser
                const result: IExecutionResult = {
                    success: false,
                    stdout: '',
                    stderr: `Language '${lang}' not supported yet in ExecutionService`,
                    result: '',
                    display_data: []
                };
                this._finish(result, blockId);
                return result;
            }

            // Execute
            // We use executeStreaming to support real-time output updates if we were hooked up to UI
            // But for now, we just wait for the final result
            // TODO: Add onProgress callback to runBlock signature
            const result = await this.client.executeStreaming(code, (accumulated, done) => {
                // Here we could emit progress events
            });

            if (!result) {
                throw new Error('Execution returned null');
            }

            this._finish(result, blockId);
            return result;

        } catch (err: any) {
            const errorResult: IExecutionResult = {
                success: false,
                stdout: '',
                stderr: err.message || 'Unknown execution error',
                result: '',
                error: {
                    ename: 'Error',
                    evalue: err.message,
                    traceback: []
                },
                display_data: []
            };
            this._finish(errorResult, blockId);
            return errorResult;
        }
    }

    private _finish(result: IExecutionResult, blockId?: string) {
        this._isRunning = false;
        this._emit('statusChange', 'idle');
        this._emit('executionComplete', result, blockId);
    }

    async cancelExecution(): Promise<void> {
        await this.interruptKernel();
    }

    async restartKernel(): Promise<void> {
        this._emit('statusChange', 'starting');
        await this.client.restartServer(); // Actually restarts the server/kernel process
        this._emit('statusChange', 'idle');
    }

    async interruptKernel(): Promise<void> {
        await this.client.interrupt();
    }

    async resetKernel(): Promise<void> {
        await this.client.reset();
    }

    async getVariables() {
        return this.client.getVariables();
    }

    async complete(code: string, cursorPos: number) {
        return this.client.complete(code, cursorPos);
    }

    async inspect(code: string, cursorPos: number, detailLevel: number = 0) {
        return this.client.inspect(code, cursorPos, detailLevel);
    }

    async inspectObject(path: string) {
        return this.client.inspectObject(path);
    }

    async hover(name: string) {
        return this.client.hoverInspect(name);
    }

    async isComplete(code: string) {
        return this.client.isComplete(code);
    }

    async getSessionInfo() {
        return this.client.sessionInfo();
    }

    async listSessions() {
        return this.client.listSessions();
    }

    async reconfigureSession(options: { pythonPath?: string; cwd?: string }) {
        return this.client.reconfigure(options);
    }

    async formatCode(code: string, language: string = 'python') {
        return this.client.formatCode(code, language);
    }

    // Events
    onExecutionStart(callback: (blockId?: string) => void): Unsubscribe {
        this._listeners.executionStart.add(callback);
        return () => this._listeners.executionStart.delete(callback);
    }

    onExecutionComplete(callback: (result: IExecutionResult, blockId?: string) => void): Unsubscribe {
        this._listeners.executionComplete.add(callback);
        return () => this._listeners.executionComplete.delete(callback);
    }

    onStatusChange(callback: (status: 'idle' | 'busy' | 'starting') => void): Unsubscribe {
        this._listeners.statusChange.add(callback);
        return () => this._listeners.statusChange.delete(callback);
    }

    private _emit<K extends keyof typeof this._listeners>(event: K, ...args: any[]) {
        // @ts-ignore
        this._listeners[event].forEach(cb => cb(...args));
    }
}
