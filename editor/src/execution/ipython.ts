/**
 * IPython Executor Adapter
 *
 * Wraps the IPythonClient from frontend/core/ipython-client.js
 * to implement the Executor interface.
 */

import type {
  Executor,
  ExecutionResult,
  ExecutionError,
  DisplayData,
  SavedAsset,
  StreamCallback,
} from './executor';

/**
 * IPythonClient interface - matches frontend/core/ipython-client.js
 */
export interface IPythonClient {
  apiBase: string;
  sessionId: string;
  projectPath: string | null;
  figureDir: string | null;

  setSession(sessionId: string): void;
  setProjectPath(projectPath: string): void;
  setFigureDir(figureDir: string): void;

  execute(code: string, storeHistory?: boolean): Promise<IPythonExecutionResult | null>;

  executeStreaming(
    code: string,
    onChunk: (accumulated: string, done: boolean) => void,
    storeHistory?: boolean
  ): Promise<IPythonExecutionResult | null>;

  complete(code: string, cursorPos: number): Promise<IPythonCompletionResult | null>;
  inspect(code: string, cursorPos: number, detailLevel?: number): Promise<IPythonInspectionResult | null>;
  reset(): Promise<{ success: boolean } | null>;
}

/**
 * Raw execution result from IPythonClient
 */
export interface IPythonExecutionResult {
  success: boolean;
  stdout: string;
  stderr: string;
  result?: string;
  error?: string;
  traceback?: string;
  display_data?: IPythonDisplayData[];
  saved_assets?: IPythonSavedAsset[];
  execution_count?: number;
  formatted_output?: string;
}

/**
 * Raw display data from IPython
 */
export interface IPythonDisplayData {
  [mimeType: string]: string;
}

/**
 * Raw saved asset from IPython
 */
export interface IPythonSavedAsset {
  path: string;
  mime_type: string;
  asset_type: string;
}

/**
 * Completion result from IPython
 */
export interface IPythonCompletionResult {
  matches: string[];
  cursor_start: number;
  cursor_end: number;
  metadata: Record<string, unknown>;
}

/**
 * Inspection result from IPython
 */
export interface IPythonInspectionResult {
  found: boolean;
  name: string;
  signature?: string;
  docstring?: string;
  type?: string;
}

/**
 * Configuration for IPythonExecutor
 */
export interface IPythonExecutorConfig {
  /** IPythonClient instance */
  client: IPythonClient;
  /** Languages to support (default: ['python']) */
  supportedLanguages?: string[];
}

/**
 * IPython Executor - implements Executor interface using IPythonClient
 */
export class IPythonExecutor implements Executor {
  private client: IPythonClient;
  private supportedLanguages: Set<string>;
  private executionCount = 0;

  constructor(config: IPythonExecutorConfig) {
    this.client = config.client;
    this.supportedLanguages = new Set(
      config.supportedLanguages ?? ['python', 'py', 'python3']
    );
  }

  /**
   * Check if this executor supports a language
   */
  supports(language: string): boolean {
    return this.supportedLanguages.has(language.toLowerCase());
  }

  /**
   * Execute code and return result
   */
  async execute(code: string, language: string): Promise<ExecutionResult> {
    if (!this.supports(language)) {
      return this.unsupportedLanguageResult(language);
    }

    const result = await this.client.execute(code);
    return this.convertResult(result);
  }

  /**
   * Execute code with streaming output
   */
  async executeStreaming(
    code: string,
    language: string,
    onChunk: StreamCallback
  ): Promise<ExecutionResult> {
    if (!this.supports(language)) {
      return this.unsupportedLanguageResult(language);
    }

    let lastAccumulated = '';

    const result = await this.client.executeStreaming(
      code,
      (accumulated: string, done: boolean) => {
        // Calculate the new chunk (delta from last accumulated)
        const chunk = accumulated.slice(lastAccumulated.length);
        lastAccumulated = accumulated;
        onChunk(chunk, accumulated, done);
      }
    );

    return this.convertResult(result);
  }

  /**
   * Convert IPython result to ExecutionResult format
   */
  private convertResult(result: IPythonExecutionResult | null): ExecutionResult {
    if (!result) {
      // Only increment local count when IPython doesn't provide one
      this.executionCount++;
      return {
        stdout: '',
        stderr: 'Execution failed: No response from IPython',
        displayData: [],
        savedAssets: [],
        executionCount: this.executionCount,
        success: false,
        error: {
          type: 'ConnectionError',
          message: 'No response from IPython server',
          traceback: [],
        },
      };
    }

    // Convert display_data from IPython format
    const displayData: DisplayData[] = [];
    if (result.display_data) {
      for (const data of result.display_data) {
        // IPython sends { "mime/type": "data" } objects
        for (const [mimeType, content] of Object.entries(data)) {
          displayData.push({ mimeType, data: content });
        }
      }
    }

    // Convert saved_assets from IPython format
    const savedAssets: SavedAsset[] = [];
    if (result.saved_assets) {
      for (const asset of result.saved_assets) {
        savedAssets.push({
          path: asset.path,
          mimeType: asset.mime_type,
          assetType: asset.asset_type as 'image' | 'svg' | 'html',
        });
      }
    }

    // Build error if present
    let error: ExecutionError | undefined;
    if (result.error || result.traceback) {
      error = {
        type: 'ExecutionError',
        message: result.error || 'Unknown error',
        traceback: result.traceback ? result.traceback.split('\n') : [],
      };
    }

    return {
      stdout: result.stdout || '',
      stderr: result.stderr || '',
      result: result.result,
      error,
      displayData,
      savedAssets,
      executionCount: result.execution_count ?? ++this.executionCount,
      success: result.success,
    };
  }

  /**
   * Return error result for unsupported language
   */
  private unsupportedLanguageResult(language: string): ExecutionResult {
    return {
      stdout: '',
      stderr: `Language "${language}" is not supported by IPython executor`,
      displayData: [],
      savedAssets: [],
      executionCount: 0,
      success: false,
      error: {
        type: 'UnsupportedLanguage',
        message: `Language "${language}" is not supported`,
        traceback: [],
      },
    };
  }

  /**
   * Get the underlying IPython client for advanced operations
   */
  getClient(): IPythonClient {
    return this.client;
  }

  /**
   * Set the session ID
   */
  setSession(sessionId: string): void {
    this.client.setSession(sessionId);
  }

  /**
   * Set the project path
   */
  setProjectPath(projectPath: string): void {
    this.client.setProjectPath(projectPath);
  }

  /**
   * Set the figure directory for matplotlib
   */
  setFigureDir(figureDir: string): void {
    this.client.setFigureDir(figureDir);
  }

  /**
   * Reset the IPython session
   */
  async reset(): Promise<boolean> {
    const result = await this.client.reset();
    return result?.success ?? false;
  }
}

/**
 * Create a minimal IPythonClient from just an API base URL
 * For use when the full ipython-client.js is not available
 */
export function createMinimalIPythonClient(apiBase: string): IPythonClient {
  let sessionId = 'main';
  let projectPath: string | null = null;
  let figureDir: string | null = null;

  const makeRequest = async (endpoint: string, body: Record<string, unknown> = {}) => {
    const requestBody: Record<string, unknown> = { session: sessionId, ...body };
    if (figureDir) requestBody.figure_dir = figureDir;
    if (projectPath) requestBody.project_path = projectPath;

    try {
      const res = await fetch(`${apiBase}${endpoint}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(requestBody),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return await res.json();
    } catch (err) {
      console.error(`IPython API error (${endpoint}):`, err);
      return null;
    }
  };

  return {
    apiBase,
    get sessionId() { return sessionId; },
    get projectPath() { return projectPath; },
    get figureDir() { return figureDir; },

    setSession(id: string) { sessionId = id; },
    setProjectPath(path: string) { projectPath = path; },
    setFigureDir(dir: string) { figureDir = dir; },

    async execute(code: string, storeHistory = true) {
      return makeRequest('/api/ipython/execute', { code, store_history: storeHistory });
    },

    async executeStreaming(code, onChunk, storeHistory = true) {
      return new Promise((resolve, reject) => {
        const body: Record<string, unknown> = {
          code,
          session: sessionId,
          store_history: storeHistory,
        };
        if (projectPath) body.project_path = projectPath;
        if (figureDir) body.figure_dir = figureDir;

        fetch(`${apiBase}/api/ipython/execute/stream`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        })
          .then(async (response) => {
            if (!response.ok) throw new Error(`HTTP ${response.status}`);

            const reader = response.body?.getReader();
            if (!reader) throw new Error('No response body');

            const decoder = new TextDecoder();
            let buffer = '';
            let finalResult: IPythonExecutionResult | null = null;

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
                        onChunk(parsed.accumulated || parsed.content || '', false);
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

            resolve(finalResult);
          })
          .catch(reject);
      });
    },

    async complete(code: string, cursorPos: number) {
      return makeRequest('/api/ipython/complete', { code, cursor_pos: cursorPos });
    },

    async inspect(code: string, cursorPos: number, detailLevel = 0) {
      return makeRequest('/api/ipython/inspect', {
        code,
        cursor_pos: cursorPos,
        detail_level: detailLevel,
      });
    },

    async reset() {
      return makeRequest('/api/ipython/reset', {});
    },
  };
}
