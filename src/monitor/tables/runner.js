/**
 * Linked-table job runner.
 */

import { spawn } from 'node:child_process';
import fsPromises from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { createTableRuntime } from '../../../../mrmd-table-runtime/src/index.js';
import { createRDplyrEngine } from '../../../../mrmd-table-engine-r-dplyr/src/index.js';

const DEFAULT_NODE_FS = fsPromises;

function cloneValue(value) {
  if (Array.isArray(value)) return value.map(cloneValue);
  if (value && typeof value === 'object') {
    const out = {};
    for (const key of Object.keys(value)) out[key] = cloneValue(value[key]);
    return out;
  }
  return value;
}

function warningDiagnostic(code, message, path = []) {
  return { level: 'warning', code, message, path };
}

function resolveBaseDir(options = {}) {
  if (options.projectRoot && options.documentPath) {
    return path.resolve(options.projectRoot, path.dirname(options.documentPath));
  }
  return options.projectRoot || options.cwd || process.cwd();
}

function resolveMaybeRelativePath(filePath, options = {}) {
  if (typeof filePath !== 'string' || filePath.trim() === '') return null;
  if (path.isAbsolute(filePath)) return filePath;
  return path.resolve(resolveBaseDir(options), filePath);
}

function inferFormatFromPath(filePath) {
  const ext = path.extname(String(filePath || '')).toLowerCase();
  if (ext === '.csv') return 'csv';
  if (ext === '.tsv') return 'tsv';
  if (ext === '.feather' || ext === '.arrow' || ext === '.ipc') return 'arrow';
  if (ext === '.parquet') return 'parquet';
  return null;
}

function pickFsMethod(fsLike, methodName) {
  if (!fsLike) return null;
  if (typeof fsLike[methodName] === 'function') return fsLike[methodName].bind(fsLike);
  if (fsLike.promises && typeof fsLike.promises[methodName] === 'function') {
    return fsLike.promises[methodName].bind(fsLike.promises);
  }
  return null;
}

async function tryStat(fsLike, filePath) {
  const stat = pickFsMethod(fsLike, 'stat');
  if (!stat || !filePath) return null;
  try {
    return await stat(filePath);
  } catch {
    return null;
  }
}

async function ensureParentDirectory(fsLike, filePath) {
  const mkdir = pickFsMethod(fsLike, 'mkdir');
  if (!mkdir || !filePath) return false;
  await mkdir(path.dirname(filePath), { recursive: true });
  return true;
}

function normalizeNow(now) {
  if (typeof now === 'function') {
    const value = now();
    if (typeof value === 'string') return value;
    if (value instanceof Date) return value.toISOString();
  }
  return new Date().toISOString();
}

function summarizeFailure(result) {
  const diagnostics = [];
  if (Array.isArray(result?.errors)) diagnostics.push(...result.errors);
  if (Array.isArray(result?.diagnostics)) diagnostics.push(...result.diagnostics);
  if (diagnostics.length === 0) return 'Linked-table job failed';
  return diagnostics.map(item => item.message || String(item)).join('; ');
}

function splitDelimitedLine(line, delimiter) {
  const values = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const ch = line[i];

    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }

    if (ch === delimiter && !inQuotes) {
      values.push(current);
      current = '';
      continue;
    }

    current += ch;
  }

  values.push(current);
  return values;
}

function parseDelimitedText(text, delimiter) {
  const lines = String(text || '')
    .split(/\r?\n/)
    .filter((line) => line.length > 0);

  if (lines.length === 0) {
    return {
      columnNames: [],
      rows: [],
    };
  }

  const columnNames = splitDelimitedLine(lines[0], delimiter);
  const rows = [];

  for (let index = 1; index < lines.length; index++) {
    const values = splitDelimitedLine(lines[index], delimiter);
    const row = {};
    for (let columnIndex = 0; columnIndex < columnNames.length; columnIndex++) {
      row[columnNames[columnIndex]] = values[columnIndex] ?? '';
    }
    rows.push(row);
  }

  return {
    columnNames,
    rows,
  };
}

export async function readDelimitedTable(filePath, format = 'csv', options = {}) {
  const fsLike = options.fs || DEFAULT_NODE_FS;
  const readFile = pickFsMethod(fsLike, 'readFile');
  if (!readFile) {
    throw new Error('No `readFile` implementation available for delimited table reading');
  }

  const delimiter = format === 'tsv' ? '\t' : ',';
  const text = await readFile(filePath, 'utf8');
  const parsed = parseDelimitedText(text, delimiter);
  return {
    ...parsed,
    rowCount: parsed.rows.length,
  };
}

async function writeScriptFile(contract, options = {}) {
  const fsLike = options.fs || DEFAULT_NODE_FS;
  const writeFile = pickFsMethod(fsLike, 'writeFile');
  if (!writeFile) {
    throw new Error('No `writeFile` implementation available for subprocess execution');
  }

  const resolvedTransformPath = resolveMaybeRelativePath(contract.transformPath, options);
  if (resolvedTransformPath) {
    await ensureParentDirectory(fsLike, resolvedTransformPath);
    await writeFile(resolvedTransformPath, contract.scriptText || '', 'utf8');
    return {
      scriptPath: resolvedTransformPath,
      temporary: false,
    };
  }

  const tempDir = await fsPromises.mkdtemp(path.join(os.tmpdir(), 'mrmd-table-'));
  const scriptPath = path.join(tempDir, 'transform.R');
  await writeFile(scriptPath, contract.scriptText || '', 'utf8');
  return {
    scriptPath,
    temporary: true,
  };
}

async function cleanupTemporaryScript(scriptInfo) {
  if (!scriptInfo?.temporary || !scriptInfo.scriptPath) return;
  try {
    await fsPromises.rm(path.dirname(scriptInfo.scriptPath), { recursive: true, force: true });
  } catch {
    // best effort only
  }
}

export async function executeMaterializationContract(contract, options = {}) {
  if (!contract || typeof contract !== 'object') {
    throw new TypeError('executeMaterializationContract requires a contract object');
  }

  const fsLike = options.fs || DEFAULT_NODE_FS;
  const cachePath = resolveMaybeRelativePath(contract.cachePath, options);
  const scriptInfo = await writeScriptFile(contract, { ...options, fs: fsLike });
  const cwd = contract.cwd || options.cwd || options.projectRoot || process.cwd();

  const env = {
    ...process.env,
    ...cloneValue(options.env || {}),
    ...cloneValue(contract.env || {}),
    MRMD_CACHE_PATH: cachePath || '',
    MRMD_TRANSFORM_PATH: scriptInfo.scriptPath,
    MRMD_PROJECT_ROOT: options.projectRoot || '',
    MRMD_DOCUMENT_PATH: options.documentPath || '',
  };

  const args = [...(Array.isArray(contract.args) ? contract.args : []), scriptInfo.scriptPath];

  try {
    const result = await new Promise((resolve, reject) => {
      const child = spawn(contract.executable || 'Rscript', args, {
        cwd,
        env,
        stdio: ['ignore', 'pipe', 'pipe'],
      });

      let stdout = '';
      let stderr = '';

      child.stdout.on('data', (chunk) => {
        stdout += chunk.toString();
      });
      child.stderr.on('data', (chunk) => {
        stderr += chunk.toString();
      });
      child.on('error', reject);
      child.on('close', (code, signal) => {
        resolve({ code, signal, stdout, stderr });
      });
    });

    return {
      ...result,
      scriptPath: scriptInfo.scriptPath,
      cachePath,
    };
  } finally {
    await cleanupTemporaryScript(scriptInfo);
  }
}

export function createDefaultExec(options = {}) {
  return async function defaultExec(contract) {
    const execution = await executeMaterializationContract(contract, options);
    if (execution.code !== 0) {
      const details = execution.stderr || execution.stdout || `exit code ${execution.code}`;
      throw new Error(`Materialization subprocess failed: ${details.trim()}`);
    }

    const cacheFormat = String(contract.cacheFormat || inferFormatFromPath(contract.cachePath) || '').toLowerCase();
    const cachePath = execution.cachePath || resolveMaybeRelativePath(contract.cachePath, options);
    const stat = await tryStat(options.fs || DEFAULT_NODE_FS, cachePath);

    const baseResult = {
      cachePath: contract.cachePath,
      resolvedCachePath: cachePath,
      stdout: execution.stdout,
      stderr: execution.stderr,
      artifacts: {
        scriptPath: execution.scriptPath,
        cacheExists: !!stat,
        cacheSize: stat?.size ?? null,
      },
    };

    if ((cacheFormat === 'csv' || cacheFormat === 'tsv') && cachePath && stat) {
      const table = await readDelimitedTable(cachePath, cacheFormat, { fs: options.fs || DEFAULT_NODE_FS });
      return {
        ...baseResult,
        rowCount: table.rowCount,
        columnNames: table.columnNames,
        rows: table.rows,
      };
    }

    return {
      ...baseResult,
      diagnostics: [
        warningDiagnostic(
          'unsupported-host-cache-read',
          cacheFormat
            ? `Host-side materialization completed, but automatic cache reading is only implemented for csv/tsv in phase 1; got \`${cacheFormat}\``
            : 'Host-side materialization completed, but cache format could not be inferred for automatic reading in phase 1'
        ),
      ],
    };
  };
}

export function createLocalFileSourceProvider(options = {}) {
  return {
    kind() {
      return 'file';
    },

    capabilities() {
      return {
        inspect: true,
        open: false,
        editable: false,
      };
    },

    async inspect(sourceSpec, context = {}) {
      const fsLike = context.fs || options.fs || DEFAULT_NODE_FS;
      const resolvedPath = resolveMaybeRelativePath(sourceSpec.path, {
        projectRoot: context.projectRoot || options.projectRoot,
        documentPath: context.documentPath || options.documentPath,
        cwd: context.cwd || options.cwd,
      });

      const stat = await tryStat(fsLike, resolvedPath);
      return {
        path: sourceSpec.path,
        resolvedPath,
        format: sourceSpec.format || null,
        exists: !!stat,
        size: stat?.size ?? null,
        modifiedAt: stat?.mtime?.toISOString?.() || null,
      };
    },
  };
}

export function createDefaultTableRuntime(options = {}) {
  return createTableRuntime({
    engines: options.engines || [createRDplyrEngine(options.engineOptions || {})],
    sourceProviders: options.sourceProviders || [createLocalFileSourceProvider(options)],
    logger: options.logger,
  });
}

function addSnapshotMetadata(spec, snapshot, materialized, options = {}) {
  const updatedSpec = cloneValue(spec || {});
  const rowCount = snapshot?.rowCount ?? materialized?.rowCount;

  updatedSpec.snapshot = {
    ...(updatedSpec.snapshot || {}),
    materializedAt: normalizeNow(options.now),
  };

  if (Number.isInteger(rowCount)) {
    updatedSpec.snapshot.rowCount = rowCount;
  }

  return updatedSpec;
}

async function maybeWriteTransform(spec, transformText, options = {}) {
  const fsLike = options.fs || DEFAULT_NODE_FS;
  const writeFile = pickFsMethod(fsLike, 'writeFile');
  if (!writeFile || typeof transformText !== 'string' || transformText === '' || !spec?.transform?.path) {
    return {
      written: false,
      transformPath: spec?.transform?.path || null,
      resolvedTransformPath: resolveMaybeRelativePath(spec?.transform?.path, options),
    };
  }

  const resolvedTransformPath = resolveMaybeRelativePath(spec.transform.path, options);
  await ensureParentDirectory(fsLike, resolvedTransformPath);
  await writeFile(resolvedTransformPath, transformText, 'utf8');

  return {
    written: true,
    transformPath: spec.transform.path,
    resolvedTransformPath,
  };
}

async function buildRuntimeContext(job, options = {}) {
  const fsLike = options.fs || DEFAULT_NODE_FS;
  const baseContext = {
    projectRoot: options.projectRoot,
    documentPath: options.documentPath,
    cwd: options.cwd || resolveBaseDir(options),
    env: cloneValue(options.env || {}),
    fs: fsLike,
    logger: options.logger,
  };

  baseContext.exec = typeof options.exec === 'function'
    ? options.exec
    : createDefaultExec(baseContext);

  if (typeof options.getRuntimeContext === 'function') {
    const extra = await options.getRuntimeContext(job, cloneValue(baseContext));
    return {
      ...baseContext,
      ...(extra || {}),
    };
  }

  return baseContext;
}

async function runMaterializeFlow(runtime, job, runtimeContext) {
  const materialized = await runtime.materializeLinkedTable(job.spec, runtimeContext);
  if (!materialized?.ok) {
    const error = new Error(summarizeFailure(materialized));
    error.result = materialized;
    throw error;
  }

  const snapshot = await runtime.createMarkdownSnapshot(job.spec, materialized, runtimeContext.snapshotOptions || {}, runtimeContext);
  if (!snapshot?.ok) {
    const error = new Error(summarizeFailure(snapshot));
    error.result = snapshot;
    throw error;
  }

  return {
    updatedSpec: addSnapshotMetadata(job.spec, snapshot, materialized, runtimeContext),
    transformText: runtimeContext.compiled?.transformText || null,
    codePreview: runtimeContext.compiled?.codePreview || null,
    materialized,
    snapshotMarkdown: snapshot.markdown,
    snapshot,
    warnings: [...(materialized.warnings || []), ...(snapshot.warnings || [])],
    diagnostics: [...(materialized.diagnostics || []), ...(snapshot.diagnostics || [])],
  };
}

export async function runTableJob(job, options = {}) {
  const runtime = options.runtime || createDefaultTableRuntime(options);
  const runtimeContext = await buildRuntimeContext(job, options);

  let result;
  if (job.jobType === 'materialize') {
    result = await runMaterializeFlow(runtime, job, runtimeContext);
  } else {
    const opList = job.jobType === 'refresh' ? [] : cloneValue(job.opList || []);
    const applied = await runtime.applyOps(job.spec, opList, runtimeContext);
    if (!applied?.ok) {
      const error = new Error(summarizeFailure(applied));
      error.result = applied;
      throw error;
    }

    result = {
      ...applied,
      updatedSpec: addSnapshotMetadata(applied.updatedSpec || job.spec, applied.snapshot, applied.materialized, runtimeContext),
    };
  }

  const transformWrite = await maybeWriteTransform(result.updatedSpec, result.transformText, runtimeContext);

  return {
    ok: true,
    updatedSpec: result.updatedSpec,
    transformText: result.transformText || null,
    codePreview: cloneValue(result.codePreview || null),
    materialized: cloneValue(result.materialized || null),
    snapshotMarkdown: result.snapshotMarkdown,
    snapshot: cloneValue(result.snapshot || null),
    warnings: cloneValue(result.warnings || []),
    diagnostics: cloneValue(result.diagnostics || []),
    artifacts: {
      transformWrite,
    },
  };
}

export default {
  createDefaultExec,
  executeMaterializationContract,
  readDelimitedTable,
  createLocalFileSourceProvider,
  createDefaultTableRuntime,
  runTableJob,
};
