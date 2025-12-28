/**
 * Execution Queue Manager
 *
 * Manages a queue of code cell executions with:
 * - FIFO ordering (first triggered, first run)
 * - Cancellation support
 * - Code change detection (re-trigger cancels old)
 * - Yjs Awareness integration for collaboration visibility
 * - LLM-readable status in output blocks
 *
 * Integrates with existing infrastructure:
 * - ExecutionTracker for actual execution
 * - Yjs Awareness for collaborative state
 * - ProjectSessionManager (backend) for session bindings
 */

import type { EditorView } from '@codemirror/view';
import type { Awareness } from 'y-protocols/awareness';

/** Execution status */
export type ExecutionStatus = 'queued' | 'running' | 'complete' | 'cancelled' | 'error';

/** A queued execution */
export interface QueuedExecution {
  /** Unique execution ID */
  id: string;
  /** Code to execute */
  code: string;
  /** Hash of code for change detection */
  codeHash: string;
  /** Language (python, javascript, etc.) */
  language: string;
  /** File path containing the code block */
  filePath: string;
  /** Position in document where code block ends (for output insertion) */
  codeBlockEnd: number;
  /** Current status */
  status: ExecutionStatus;
  /** Position in queue (1-indexed, 0 if not queued) */
  queuePosition: number;
  /** Timestamp when queued */
  queuedAt: number;
  /** Timestamp when started (if running) */
  startedAt?: number;
  /** Timestamp when completed/cancelled/errored */
  endedAt?: number;
  /** Error message (if error status) */
  error?: string;
  /** Abort controller for cancellation */
  controller?: AbortController;
}

/** Queue state for Yjs Awareness */
export interface ExecutionAwarenessState {
  /** Currently running execution ID */
  running: string | null;
  /** Queued execution IDs in order */
  queued: string[];
  /** Map of execution ID to basic info */
  executions: Record<string, {
    filePath: string;
    language: string;
    status: ExecutionStatus;
    queuePosition: number;
  }>;
}

/** Events emitted by the queue */
export interface QueueEvents {
  /** Execution was queued */
  queued: (exec: QueuedExecution) => void;
  /** Execution started running */
  started: (exec: QueuedExecution) => void;
  /** Execution completed successfully */
  completed: (exec: QueuedExecution) => void;
  /** Execution was cancelled */
  cancelled: (exec: QueuedExecution) => void;
  /** Execution errored */
  errored: (exec: QueuedExecution, error: string) => void;
  /** Queue changed (for UI updates) */
  queueChanged: (queue: QueuedExecution[]) => void;
}

type EventCallback<K extends keyof QueueEvents> = QueueEvents[K];

/** Simple hash function for code change detection */
function hashCode(str: string): string {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash; // Convert to 32bit integer
  }
  return hash.toString(36);
}

/** Generate unique execution ID */
function generateExecId(): string {
  return `exec-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
}

/**
 * Execution Queue Manager
 */
export class ExecutionQueue {
  private queue: QueuedExecution[] = [];
  private running: QueuedExecution | null = null;
  private completed: Map<string, QueuedExecution> = new Map();
  private awareness: Awareness | null = null;
  private listeners: Map<keyof QueueEvents, Set<Function>> = new Map();
  private isProcessing = false;

  constructor(awareness?: Awareness) {
    this.awareness = awareness ?? null;
  }

  /**
   * Set Yjs Awareness for collaborative state
   */
  setAwareness(awareness: Awareness): void {
    this.awareness = awareness;
    this.broadcastState();
  }

  /**
   * Enqueue an execution
   * Returns the execution ID
   */
  enqueue(params: {
    code: string;
    language: string;
    filePath: string;
    codeBlockEnd: number;
  }): string {
    const { code, language, filePath, codeBlockEnd } = params;
    const codeHash = hashCode(code);

    // Check if same code block is already queued or running
    const existing = this.findByCodeBlockEnd(filePath, codeBlockEnd);
    if (existing) {
      if (existing.codeHash !== codeHash) {
        // Code changed - cancel old execution
        this.cancel(existing.id);
      } else {
        // Same code, already queued/running - return existing ID
        return existing.id;
      }
    }

    const exec: QueuedExecution = {
      id: generateExecId(),
      code,
      codeHash,
      language,
      filePath,
      codeBlockEnd,
      status: 'queued',
      queuePosition: this.queue.length + 1,
      queuedAt: Date.now(),
      controller: new AbortController(),
    };

    this.queue.push(exec);
    this.updateQueuePositions();
    this.emit('queued', exec);
    this.emit('queueChanged', this.getQueue());
    this.broadcastState();

    // Start processing if not already
    this.processNext();

    return exec.id;
  }

  /**
   * Cancel an execution (queued or running)
   */
  cancel(execId: string): boolean {
    // Check if running
    if (this.running?.id === execId) {
      this.running.controller?.abort();
      this.running.status = 'cancelled';
      this.running.endedAt = Date.now();
      this.completed.set(execId, this.running);
      this.emit('cancelled', this.running);
      this.running = null;
      this.broadcastState();
      this.processNext();
      return true;
    }

    // Check if queued
    const index = this.queue.findIndex(e => e.id === execId);
    if (index !== -1) {
      const [exec] = this.queue.splice(index, 1);
      exec.status = 'cancelled';
      exec.endedAt = Date.now();
      exec.controller?.abort();
      this.completed.set(execId, exec);
      this.updateQueuePositions();
      this.emit('cancelled', exec);
      this.emit('queueChanged', this.getQueue());
      this.broadcastState();
      return true;
    }

    return false;
  }

  /**
   * Cancel all queued and running executions
   */
  cancelAll(): void {
    // Cancel running
    if (this.running) {
      this.cancel(this.running.id);
    }

    // Cancel all queued
    const toCancel = [...this.queue];
    for (const exec of toCancel) {
      this.cancel(exec.id);
    }
  }

  /**
   * Get current queue (does not include running)
   */
  getQueue(): QueuedExecution[] {
    return [...this.queue];
  }

  /**
   * Get currently running execution
   */
  getRunning(): QueuedExecution | null {
    return this.running;
  }

  /**
   * Get all active executions (running + queued)
   */
  getActive(): QueuedExecution[] {
    const active: QueuedExecution[] = [];
    if (this.running) active.push(this.running);
    active.push(...this.queue);
    return active;
  }

  /**
   * Get execution by ID
   */
  get(execId: string): QueuedExecution | undefined {
    if (this.running?.id === execId) return this.running;
    return this.queue.find(e => e.id === execId) ?? this.completed.get(execId);
  }

  /**
   * Get status string for output block
   * Format: [status:running] [1/3] or [status:queued] [2/3]
   */
  getStatusString(execId: string): string {
    const exec = this.get(execId);
    if (!exec) return '';

    const total = this.queue.length + (this.running ? 1 : 0);

    if (exec.status === 'running') {
      return `[status:running] [1/${total}]`;
    } else if (exec.status === 'queued') {
      return `[status:queued] [${exec.queuePosition}/${total}]`;
    }

    return '';
  }

  /**
   * Check if an execution is active (running or queued)
   */
  isActive(execId: string): boolean {
    if (this.running?.id === execId) return true;
    return this.queue.some(e => e.id === execId);
  }

  /**
   * Find execution by code block position
   */
  private findByCodeBlockEnd(filePath: string, codeBlockEnd: number): QueuedExecution | null {
    if (this.running?.filePath === filePath && this.running.codeBlockEnd === codeBlockEnd) {
      return this.running;
    }
    return this.queue.find(e => e.filePath === filePath && e.codeBlockEnd === codeBlockEnd) ?? null;
  }

  /**
   * Update queue positions after changes
   */
  private updateQueuePositions(): void {
    this.queue.forEach((exec, index) => {
      exec.queuePosition = index + 1 + (this.running ? 1 : 0);
    });
  }

  /**
   * Process next item in queue
   */
  private async processNext(): Promise<void> {
    // Already processing or nothing to process
    if (this.isProcessing || this.running || this.queue.length === 0) {
      return;
    }

    this.isProcessing = true;

    const exec = this.queue.shift()!;
    exec.status = 'running';
    exec.startedAt = Date.now();
    exec.queuePosition = 0;
    this.running = exec;
    this.updateQueuePositions();

    this.emit('started', exec);
    this.emit('queueChanged', this.getQueue());
    this.broadcastState();

    this.isProcessing = false;
  }

  /**
   * Mark an execution as complete
   * Called by ExecutionTracker when execution finishes
   */
  markComplete(execId: string, success: boolean, error?: string): void {
    if (this.running?.id === execId) {
      this.running.status = success ? 'complete' : 'error';
      this.running.endedAt = Date.now();
      if (error) this.running.error = error;

      this.completed.set(execId, this.running);

      if (success) {
        this.emit('completed', this.running);
      } else {
        this.emit('errored', this.running, error ?? 'Unknown error');
      }

      this.running = null;
      this.broadcastState();
      this.emit('queueChanged', this.getQueue());

      // Process next in queue
      this.processNext();
    }
  }

  /**
   * Broadcast state to Yjs Awareness
   */
  private broadcastState(): void {
    if (!this.awareness) return;

    const state: ExecutionAwarenessState = {
      running: this.running?.id ?? null,
      queued: this.queue.map(e => e.id),
      executions: {},
    };

    if (this.running) {
      state.executions[this.running.id] = {
        filePath: this.running.filePath,
        language: this.running.language,
        status: this.running.status,
        queuePosition: 0,
      };
    }

    for (const exec of this.queue) {
      state.executions[exec.id] = {
        filePath: exec.filePath,
        language: exec.language,
        status: exec.status,
        queuePosition: exec.queuePosition,
      };
    }

    this.awareness.setLocalStateField('execution', state);
  }

  /**
   * Get execution state from remote awareness
   */
  getRemoteExecutionStates(): Map<number, ExecutionAwarenessState> {
    if (!this.awareness) return new Map();

    const states = new Map<number, ExecutionAwarenessState>();
    this.awareness.getStates().forEach((state, clientId) => {
      if (state.execution) {
        states.set(clientId, state.execution as ExecutionAwarenessState);
      }
    });

    return states;
  }

  /**
   * Event handling
   */
  on<K extends keyof QueueEvents>(event: K, callback: EventCallback<K>): () => void {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, new Set());
    }
    this.listeners.get(event)!.add(callback);

    return () => {
      this.listeners.get(event)?.delete(callback);
    };
  }

  private emit<K extends keyof QueueEvents>(
    event: K,
    ...args: Parameters<QueueEvents[K]>
  ): void {
    const callbacks = this.listeners.get(event);
    if (callbacks) {
      callbacks.forEach(cb => (cb as Function)(...args));
    }
  }

  /**
   * Clean up
   */
  destroy(): void {
    this.cancelAll();
    this.listeners.clear();
    if (this.awareness) {
      this.awareness.setLocalStateField('execution', null);
    }
  }
}

/**
 * Create execution queue with optional awareness
 */
export function createExecutionQueue(awareness?: Awareness): ExecutionQueue {
  return new ExecutionQueue(awareness);
}
