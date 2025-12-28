/**
 * Cell Status Widget
 *
 * Shows execution status on code cells:
 * - Idle: Play button (▶) to run
 * - Queued: Queue position with cancel (⏳ 2 ✕)
 * - Running: Spinner with cancel (◉ ✕)
 *
 * Integrates with ExecutionQueue for status and cancellation.
 */

import { WidgetType, EditorView } from '@codemirror/view';
import type { ExecutionQueue } from '../execution/queue';

/** Cell execution state */
export type CellState = 'idle' | 'queued' | 'running';

/**
 * Widget for displaying cell execution status
 */
export class CellStatusWidget extends WidgetType {
  constructor(
    readonly codeBlockFrom: number,
    readonly codeBlockTo: number,
    readonly language: string,
    readonly state: CellState,
    readonly queuePosition: number | null,
    readonly execId: string | null,
    readonly view: EditorView,
    readonly queue: ExecutionQueue | null,
    readonly onRun?: () => void
  ) {
    super();
  }

  eq(other: CellStatusWidget): boolean {
    return (
      other.codeBlockFrom === this.codeBlockFrom &&
      other.codeBlockTo === this.codeBlockTo &&
      other.state === this.state &&
      other.queuePosition === this.queuePosition &&
      other.execId === this.execId
    );
  }

  toDOM(): HTMLElement {
    const container = document.createElement('span');
    container.className = 'cm-cell-status';

    switch (this.state) {
      case 'idle':
        return this.createPlayButton(container);
      case 'queued':
        return this.createQueuedIndicator(container);
      case 'running':
        return this.createRunningIndicator(container);
      default:
        return this.createPlayButton(container);
    }
  }

  private createPlayButton(container: HTMLElement): HTMLElement {
    const btn = document.createElement('button');
    btn.className = 'cm-cell-btn cm-cell-btn-play';
    btn.innerHTML = '▶';
    btn.title = `Run ${this.language || 'code'}`;

    btn.onclick = (e) => {
      e.preventDefault();
      e.stopPropagation();
      this.onRun?.();
    };

    container.appendChild(btn);
    return container;
  }

  private createQueuedIndicator(container: HTMLElement): HTMLElement {
    container.classList.add('cm-cell-status-queued');

    // Queue icon with position
    const status = document.createElement('span');
    status.className = 'cm-cell-queue-status';
    status.innerHTML = `<span class="cm-cell-queue-icon">⏳</span>`;
    if (this.queuePosition !== null) {
      status.innerHTML += `<span class="cm-cell-queue-pos">${this.queuePosition}</span>`;
    }
    status.title = `Queued at position ${this.queuePosition}`;

    // Cancel button
    const cancelBtn = document.createElement('button');
    cancelBtn.className = 'cm-cell-btn cm-cell-btn-cancel';
    cancelBtn.innerHTML = '✕';
    cancelBtn.title = 'Cancel execution';

    cancelBtn.onclick = (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (this.execId && this.queue) {
        this.queue.cancel(this.execId);
      }
    };

    container.appendChild(status);
    container.appendChild(cancelBtn);
    return container;
  }

  private createRunningIndicator(container: HTMLElement): HTMLElement {
    container.classList.add('cm-cell-status-running');

    // Spinner
    const spinner = document.createElement('span');
    spinner.className = 'cm-cell-spinner';
    spinner.innerHTML = '◉';
    spinner.title = 'Running...';

    // Cancel button
    const cancelBtn = document.createElement('button');
    cancelBtn.className = 'cm-cell-btn cm-cell-btn-cancel';
    cancelBtn.innerHTML = '✕';
    cancelBtn.title = 'Cancel execution';

    cancelBtn.onclick = (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (this.execId && this.queue) {
        this.queue.cancel(this.execId);
      }
    };

    container.appendChild(spinner);
    container.appendChild(cancelBtn);
    return container;
  }

  ignoreEvent(): boolean {
    return true; // Handle all events ourselves
  }
}

/**
 * CSS styles for cell status widget
 */
export const cellStatusStyles = `
.cm-cell-status {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  margin-left: 8px;
  vertical-align: middle;
}

.cm-cell-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 20px;
  height: 20px;
  padding: 0;
  border: none;
  border-radius: 3px;
  background: transparent;
  color: var(--cell-btn-color, rgba(255, 255, 255, 0.6));
  cursor: pointer;
  font-size: 12px;
  transition: all 0.15s ease;
}

.cm-cell-btn:hover {
  background: var(--cell-btn-hover-bg, rgba(255, 255, 255, 0.1));
  color: var(--cell-btn-hover-color, rgba(255, 255, 255, 0.9));
}

.cm-cell-btn-play {
  color: var(--cell-play-color, #4ade80);
}

.cm-cell-btn-play:hover {
  color: var(--cell-play-hover-color, #22c55e);
  background: var(--cell-play-hover-bg, rgba(74, 222, 128, 0.1));
}

.cm-cell-btn-cancel {
  color: var(--cell-cancel-color, rgba(255, 255, 255, 0.5));
  font-size: 10px;
}

.cm-cell-btn-cancel:hover {
  color: var(--cell-cancel-hover-color, #f87171);
  background: var(--cell-cancel-hover-bg, rgba(248, 113, 113, 0.1));
}

.cm-cell-status-queued {
  color: var(--cell-queued-color, #fbbf24);
}

.cm-cell-status-running {
  color: var(--cell-running-color, #60a5fa);
}

.cm-cell-queue-status {
  display: inline-flex;
  align-items: center;
  gap: 2px;
  font-size: 12px;
}

.cm-cell-queue-icon {
  font-size: 14px;
}

.cm-cell-queue-pos {
  font-size: 10px;
  font-weight: 600;
  min-width: 14px;
  text-align: center;
}

.cm-cell-spinner {
  font-size: 14px;
  animation: cell-spin 1s linear infinite;
}

@keyframes cell-spin {
  from { transform: rotate(0deg); }
  to { transform: rotate(360deg); }
}
`;

/**
 * Determine cell state from queue
 */
export function getCellState(
  queue: ExecutionQueue | null,
  filePath: string,
  codeBlockEnd: number
): { state: CellState; queuePosition: number | null; execId: string | null } {
  if (!queue) {
    return { state: 'idle', queuePosition: null, execId: null };
  }

  // Check if running
  const running = queue.getRunning();
  if (running && running.filePath === filePath && running.codeBlockEnd === codeBlockEnd) {
    return { state: 'running', queuePosition: null, execId: running.id };
  }

  // Check if queued
  const queued = queue.getQueue();
  const queuedExec = queued.find(
    e => e.filePath === filePath && e.codeBlockEnd === codeBlockEnd
  );
  if (queuedExec) {
    return {
      state: 'queued',
      queuePosition: queuedExec.queuePosition,
      execId: queuedExec.id,
    };
  }

  return { state: 'idle', queuePosition: null, execId: null };
}
