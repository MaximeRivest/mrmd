/**
 * Result of code execution
 */
export interface ExecutionResult {
  stdout: string;
  stderr: string;
  result?: string;
  error?: ExecutionError;
  displayData: DisplayData[];
  savedAssets: SavedAsset[];
  executionCount: number;
  success: boolean;
}

/**
 * Execution error details
 */
export interface ExecutionError {
  type: string;
  message: string;
  traceback: string[];
}

/**
 * Rich display output (images, HTML, etc.)
 */
export interface DisplayData {
  mimeType: string;
  data: string;
}

/**
 * Reference to a saved asset (plot, HTML file, etc.)
 */
export interface SavedAsset {
  path: string;
  mimeType: string;
  assetType: 'image' | 'svg' | 'html';
}

/**
 * Callback for streaming execution
 */
export type StreamCallback = (chunk: string, accumulated: string, done: boolean) => void;

/**
 * Interface for code executors (IPython, JavaScript, etc.)
 */
export interface Executor {
  /**
   * Execute code and return result
   */
  execute(code: string, language: string): Promise<ExecutionResult>;

  /**
   * Execute code with streaming output
   */
  executeStreaming(
    code: string,
    language: string,
    onChunk: StreamCallback
  ): Promise<ExecutionResult>;

  /**
   * Cancel a running execution
   */
  cancel?(executionId: string): void;

  /**
   * Check if executor supports a language
   */
  supports(language: string): boolean;
}

/**
 * Mock executor for testing/demo
 */
export class MockExecutor implements Executor {
  supports(language: string): boolean {
    return ['python', 'javascript', 'js'].includes(language.toLowerCase());
  }

  async execute(code: string, language: string): Promise<ExecutionResult> {
    return new Promise((resolve) => {
      setTimeout(() => {
        resolve({
          stdout: `Executed ${language} code:\n${code.split('\n')[0]}...\n`,
          stderr: '',
          displayData: [],
          savedAssets: [],
          executionCount: 1,
          success: true,
        });
      }, 500);
    });
  }

  async executeStreaming(
    code: string,
    language: string,
    onChunk: StreamCallback
  ): Promise<ExecutionResult> {
    const outputs = this.getMockOutputs(code, language);
    let accumulated = '';

    for (const { text, delay } of outputs) {
      await new Promise((r) => setTimeout(r, delay));
      accumulated += text;
      onChunk(text, accumulated, false);
    }

    onChunk('', accumulated, true);

    return {
      stdout: accumulated,
      stderr: '',
      displayData: [],
      savedAssets: [],
      executionCount: 1,
      success: true,
    };
  }

  private getMockOutputs(code: string, language: string): { text: string; delay: number }[] {
    if (language === 'python' && code.includes('time.sleep')) {
      return [
        { text: 'Processing step 1...\n', delay: 100 },
        { text: 'Processing step 2...\n', delay: 300 },
        { text: 'Processing step 3...\n', delay: 300 },
        { text: 'Processing step 4...\n', delay: 300 },
        { text: 'Processing step 5...\n', delay: 300 },
        { text: 'Done!\n', delay: 300 },
      ];
    }

    if (language === 'python' && code.includes('DataFrame')) {
      return [
        { text: '   x         y\n', delay: 100 },
        { text: '0  0  0.496714\n', delay: 50 },
        { text: '1  1  0.358450\n', delay: 50 },
        { text: '2  2  1.006138\n', delay: 50 },
        { text: '3  3  2.529168\n', delay: 50 },
        { text: '4  4  2.295015\n', delay: 50 },
        { text: '5  5  2.052338\n', delay: 50 },
        { text: '6  6  3.010605\n', delay: 50 },
        { text: '7  7  2.854063\n', delay: 50 },
        { text: '8  8  2.378255\n', delay: 50 },
        { text: '9  9  2.864856\n', delay: 50 },
      ];
    }

    if ((language === 'javascript' || language === 'js') && code.includes('fibonacci')) {
      return [
        { text: 'Fibonacci sequence:\n', delay: 50 },
        { text: '  fib(0) = 0\n', delay: 50 },
        { text: '  fib(1) = 1\n', delay: 50 },
        { text: '  fib(2) = 1\n', delay: 50 },
        { text: '  fib(3) = 2\n', delay: 50 },
        { text: '  fib(4) = 3\n', delay: 50 },
        { text: '  fib(5) = 5\n', delay: 50 },
        { text: '  fib(6) = 8\n', delay: 50 },
        { text: '  fib(7) = 13\n', delay: 50 },
        { text: '  fib(8) = 21\n', delay: 50 },
        { text: '  fib(9) = 34\n', delay: 50 },
      ];
    }

    return [
      { text: `Running ${language}...\n`, delay: 100 },
      { text: `> ${code.split('\n')[0]}\n`, delay: 200 },
      { text: 'Execution complete.\n', delay: 200 },
    ];
  }
}
