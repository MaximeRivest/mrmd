/**
 * Linked-table job bridge.
 *
 * Watches `Y.Map('tableJobs')`, claims runnable work, runs the table runtime,
 * and rewrites the markdown snapshot back into the shared document.
 */

import { rewriteLinkedTableBlock } from './snapshot-rewriter.js';
import { runTableJob } from './runner.js';
import { TABLE_JOB_STATUS, isTerminalTableJobStatus } from './status.js';

function defaultLogger() {
  return {
    debug() {},
    info() {},
    warn() {},
    error() {},
  };
}

function cloneValue(value) {
  if (Array.isArray(value)) return value.map(cloneValue);
  if (value && typeof value === 'object') {
    const out = {};
    for (const key of Object.keys(value)) out[key] = cloneValue(value[key]);
    return out;
  }
  return value;
}

function summarizeError(error) {
  const result = error?.result;
  const firstDiagnostic = result?.errors?.[0] || result?.diagnostics?.[0] || null;
  return {
    code: error?.code || firstDiagnostic?.code || 'table-job-failed',
    message: error?.message || firstDiagnostic?.message || 'Linked-table job failed',
    diagnostics: cloneValue(result?.errors || result?.diagnostics || []),
  };
}

export class TableJobsBridge {
  constructor(options = {}) {
    if (!options.ydoc) {
      throw new TypeError('TableJobsBridge requires a Y.Doc');
    }

    this.ydoc = options.ydoc;
    this.clientId = options.clientId || this.ydoc.clientID;
    this.jobs = this.ydoc.getMap('tableJobs');
    this.textName = options.textName || 'content';
    this.runtime = options.runtime || null;
    this.logger = options.logger || defaultLogger();
    this.runnerOptions = {
      runtime: this.runtime,
      projectRoot: options.projectRoot,
      documentPath: options.documentPath,
      cwd: options.cwd,
      env: cloneValue(options.env || {}),
      fs: options.fs,
      exec: options.exec,
      logger: this.logger,
      sourceProviders: options.sourceProviders,
      engines: options.engines,
      engineOptions: options.engineOptions,
      getRuntimeContext: options.getRuntimeContext,
      now: options.now,
    };
    this._observer = null;
    this._activeJobs = new Set();
    this._started = false;

    if (options.autoStart !== false) {
      this.start();
    }
  }

  start() {
    if (this._started) return this;
    this._started = true;

    this._observer = (event) => {
      event.changes.keys.forEach((_change, jobId) => {
        this._considerJob(jobId);
      });
    };

    this.jobs.observe(this._observer);
    this._checkExistingJobs();
    return this;
  }

  _checkExistingJobs() {
    this.jobs.forEach((_job, jobId) => this._considerJob(jobId));
  }

  _considerJob(jobId) {
    const job = this.jobs.get(jobId);
    if (!job || isTerminalTableJobStatus(job.status)) return;

    if (job.status === TABLE_JOB_STATUS.REQUESTED) {
      const claimed = this.claimJob(jobId);
      if (claimed) {
        queueMicrotask(() => this._runJob(jobId));
      }
      return;
    }

    if (job.status === TABLE_JOB_STATUS.CLAIMED && job.claimedBy === this.clientId) {
      queueMicrotask(() => this._runJob(jobId));
    }
  }

  claimJob(jobId) {
    const job = this.jobs.get(jobId);
    if (!job) return false;
    if (job.status !== TABLE_JOB_STATUS.REQUESTED) return false;
    if (job.claimedBy !== null && job.claimedBy !== undefined) return false;

    this.jobs.set(jobId, {
      ...job,
      status: TABLE_JOB_STATUS.CLAIMED,
      claimedBy: this.clientId,
      claimedAt: Date.now(),
    });
    this.logger.info?.('[mrmd-monitor/tables] claimed table job', { jobId, tableId: job.tableId, jobType: job.jobType });
    return true;
  }

  async _runJob(jobId) {
    if (this._activeJobs.has(jobId)) return;

    let job = this.jobs.get(jobId);
    if (!job || job.claimedBy !== this.clientId || isTerminalTableJobStatus(job.status)) return;

    this._activeJobs.add(jobId);

    try {
      this.jobs.set(jobId, {
        ...job,
        status: TABLE_JOB_STATUS.RUNNING,
        startedAt: Date.now(),
      });

      job = this.jobs.get(jobId);
      const result = await runTableJob(job, this.runnerOptions);

      const latest = this.jobs.get(jobId);
      if (!latest || latest.status === TABLE_JOB_STATUS.CANCELLED) {
        this.logger.info?.('[mrmd-monitor/tables] table job cancelled before write', { jobId, tableId: job.tableId });
        return;
      }

      this.jobs.set(jobId, {
        ...latest,
        status: TABLE_JOB_STATUS.WRITING,
        writingAt: Date.now(),
      });

      const rewrite = rewriteLinkedTableBlock({
        ydoc: this.ydoc,
        textName: this.textName,
        tableId: job.tableId,
        blockAnchor: latest.blockAnchor || job.blockAnchor,
        spec: result.updatedSpec,
        snapshotMarkdown: result.snapshotMarkdown,
      });

      const finalJob = this.jobs.get(jobId) || latest;
      this.jobs.set(jobId, {
        ...finalJob,
        status: TABLE_JOB_STATUS.COMPLETED,
        completedAt: Date.now(),
        result: {
          tableId: job.tableId,
          updatedSpec: cloneValue(result.updatedSpec),
          snapshot: cloneValue(result.snapshot),
          materialized: cloneValue(result.materialized),
          codePreview: cloneValue(result.codePreview),
          transformText: result.transformText,
          artifacts: cloneValue(result.artifacts || {}),
          warnings: cloneValue(result.warnings || []),
          diagnostics: cloneValue(result.diagnostics || []),
          blockAnchor: cloneValue(rewrite.blockAnchor),
        },
      });

      this.logger.info?.('[mrmd-monitor/tables] completed table job', {
        jobId,
        tableId: job.tableId,
        rowCount: result.snapshot?.rowCount ?? result.materialized?.rowCount ?? null,
      });
    } catch (error) {
      const latest = this.jobs.get(jobId) || job;
      this.jobs.set(jobId, {
        ...latest,
        status: TABLE_JOB_STATUS.ERROR,
        completedAt: Date.now(),
        error: summarizeError(error),
      });
      this.logger.error?.('[mrmd-monitor/tables] table job failed', { jobId, tableId: job?.tableId, error: error?.message || String(error) });
    } finally {
      this._activeJobs.delete(jobId);
    }
  }

  destroy() {
    if (this._observer) {
      this.jobs.unobserve(this._observer);
      this._observer = null;
    }
    this._activeJobs.clear();
    this._started = false;
  }
}

export function createTableJobsBridge(options = {}) {
  return new TableJobsBridge(options);
}

export default {
  TableJobsBridge,
  createTableJobsBridge,
  TABLE_JOB_STATUS,
};
