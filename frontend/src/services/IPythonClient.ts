import type {
    CompletionResult,
    InspectionResult,
    IExecutionResult,
    VariablesResponse,
    InspectObjectResult,
    HoverResult,
    IsCompleteResult,
    SessionInfo,
    SessionListResponse,
    ReconfigureResult,
    FormatCodeResult
} from './interfaces';

export interface IPythonClientOptions {
    apiBase?: string;
    sessionId?: string;
    projectPath?: string;
    figureDir?: string;
    fetch?: typeof fetch;
}

export class IPythonClient {
    private apiBase: string;
    private sessionId: string;
    private projectPath: string | null;
    private figureDir: string | null;
    private _fetch: typeof fetch;

    constructor(options: IPythonClientOptions = {}) {
        this.apiBase = options.apiBase || '';
        this.sessionId = options.sessionId || 'main';
        this.projectPath = options.projectPath || null;
        this.figureDir = options.figureDir || null;
        this._fetch = options.fetch || globalThis.fetch.bind(globalThis);
    }

    setSession(sessionId: string) {
        this.sessionId = sessionId;
    }

    setProjectPath(projectPath: string) {
        this.projectPath = projectPath;
    }

    setFigureDir(figureDir: string) {
        this.figureDir = figureDir;
    }

    private async _request<T>(endpoint: string, body: any = {}): Promise<T | null> {
        try {
            const requestBody = { session: this.sessionId, ...body };
            if (this.figureDir) {
                requestBody.figure_dir = this.figureDir;
            }
            if (this.projectPath) {
                requestBody.project_path = this.projectPath;
            }
            const res = await this._fetch(`${this.apiBase}${endpoint}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(requestBody)
            });
            if (!res.ok) {
                throw new Error(`HTTP ${res.status}: ${res.statusText}`);
            }
            return await res.json();
        } catch (err) {
            console.error(`IPython API error (${endpoint}):`, err);
            return null;
        }
    }

    private async _get<T>(endpoint: string): Promise<T | null> {
        try {
            const res = await this._fetch(`${this.apiBase}${endpoint}`, {
                method: 'GET'
            });
            if (!res.ok) {
                throw new Error(`HTTP ${res.status}: ${res.statusText}`);
            }
            return await res.json();
        } catch (err) {
            console.error(`IPython API error (${endpoint}):`, err);
            return null;
        }
    }

    async complete(code: string, cursorPos: number): Promise<CompletionResult | null> {
        return this._request<CompletionResult>('/api/ipython/complete', { code, cursor_pos: cursorPos });
    }

    async inspect(code: string, cursorPos: number, detailLevel: number = 0): Promise<InspectionResult | null> {
        return this._request<InspectionResult>('/api/ipython/inspect', {
            code,
            cursor_pos: cursorPos,
            detail_level: detailLevel
        });
    }

    async execute(code: string, storeHistory: boolean = true): Promise<IExecutionResult | null> {
        return this._request<IExecutionResult>('/api/ipython/execute', {
            code,
            store_history: storeHistory
        });
    }

    async executeStreaming(
        code: string, 
        onChunk: (accumulated: string, done: boolean) => void, 
        storeHistory: boolean = true
    ): Promise<IExecutionResult | null> {
        return new Promise((resolve, reject) => {
            let finalResult: IExecutionResult | null = null;

            const body: any = {
                code,
                session: this.sessionId,
                store_history: storeHistory,
            };
            if (this.projectPath) {
                body.project_path = this.projectPath;
            }
            if (this.figureDir) {
                body.figure_dir = this.figureDir;
            }

            this._fetch(`${this.apiBase}/api/ipython/execute/stream`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(body),
            }).then(async response => {
                if (!response.ok) {
                    throw new Error(`Streaming execution failed: ${response.statusText}`);
                }

                if (!response.body) {
                    throw new Error('No response body');
                }

                const reader = response.body.getReader();
                const decoder = new TextDecoder();
                let buffer = '';

                while (true) {
                    const { done, value } = await reader.read();
                    if (done) break;

                    buffer += decoder.decode(value, { stream: true });

                    const lines = buffer.split('\n');
                    buffer = lines.pop() || '';

                    let eventType = '';
                    let eventData = '';

                    for (const line of lines) {
                        if (line.startsWith('event: ')) {
                            eventType = line.slice(7);
                        } else if (line.startsWith('data: ')) {
                            eventData = line.slice(6);

                            if (eventType && eventData) {
                                try {
                                    const parsed = JSON.parse(eventData);

                                    if (eventType === 'chunk') {
                                        const accumulated = parsed.accumulated || parsed.content || '';
                                        onChunk(accumulated, false);
                                    } else if (eventType === 'result') {
                                        finalResult = parsed;
                                    } else if (eventType === 'done') {
                                        onChunk(finalResult?.formatted_output || '', true);
                                        resolve(finalResult);
                                    }
                                } catch (e) {
                                    console.error('SSE parse error:', e);
                                }

                                eventType = '';
                                eventData = '';
                            }
                        }
                    }
                }

                if (finalResult) {
                    resolve(finalResult);
                } else {
                    resolve(null);
                }
            }).catch(error => {
                console.error('Streaming execution error:', error);
                reject(error);
            });
        });
    }

    async getVariables(): Promise<VariablesResponse | null> {
        return this._request('/api/ipython/variables', {});
    }

    async hoverInspect(name: string): Promise<HoverResult | null> {
        return this._request('/api/ipython/hover', { name });
    }

    async isComplete(code: string): Promise<IsCompleteResult | null> {
        return this._request('/api/ipython/is_complete', { code });
    }

    async inspectObject(path: string): Promise<InspectObjectResult | null> {
        return this._request('/api/ipython/inspect_object', { path });
    }

    async reset(): Promise<{ status?: string; session_id?: string; error?: string } | null> {
        return this._request('/api/ipython/reset', {});
    }

    async interrupt(): Promise<{ status?: string; session_id?: string; warning?: string; error?: string } | null> {
        return this._request('/api/ipython/interrupt', {});
    }

    async sessionInfo(): Promise<SessionInfo | null> {
        return this._request('/api/ipython/session_info', {});
    }

    async reconfigure(options: { pythonPath?: string; cwd?: string } = {}): Promise<ReconfigureResult | null> {
        return this._request('/api/ipython/reconfigure', {
            python_path: options.pythonPath,
            cwd: options.cwd
        });
    }

    async listSessions(): Promise<SessionListResponse | null> {
        return this._get('/api/ipython/sessions');
    }

    async formatCode(code: string, language: string = 'python'): Promise<FormatCodeResult | null> {
        return this._request('/api/ipython/format', { code, language });
    }

    async restartServer(): Promise<{ status?: string; message?: string } | null> {
        return this._request('/api/server/restart', {});
    }
}
