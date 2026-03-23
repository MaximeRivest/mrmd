/**
 * Sync server subsystem for mrmd.
 *
 * Provides:
 * - Yjs WebSocket sync for real-time collaboration
 * - File system persistence with atomic writes
 * - Yjs state persistence for crash recovery
 * - Bidirectional sync: file changes ↔ Yjs updates
 * - Structured logging, health checks, metrics
 * - Graceful shutdown with pending write flush
 */

import { WebSocketServer } from 'ws';
import http from 'http';
import * as Y from 'yjs';
import { diffChars } from 'diff';
import { watch } from 'chokidar';
import {
  readFileSync,
  writeFileSync,
  renameSync,
  unlinkSync,
  existsSync,
  mkdirSync,
  statSync,
  rmSync,
  readdirSync,
} from 'fs';
import { join, dirname, relative, resolve, basename } from 'path';
import { createHash } from 'crypto';
import { tmpdir } from 'os';

const DOC_EXTENSIONS = ['.md', '.qmd'];

function getDocExtension(docName) {
  if (!docName) return '';
  const lower = docName.toLowerCase();
  for (const ext of DOC_EXTENSIONS) {
    if (lower.endsWith(ext)) return ext;
  }
  return '';
}

function resolveDocFilePath(docName, resolvedDir) {
  const hasDocExt = !!getDocExtension(docName);
  if (docName.startsWith('/')) {
    return hasDocExt ? docName : `${docName}.md`;
  }
  return hasDocExt ? join(resolvedDir, docName) : join(resolvedDir, `${docName}.md`);
}

// =============================================================================
// PID FILE - Prevents multiple instances on same directory
// =============================================================================

function acquirePidLock(lockDir, port, log) {
  const pidFile = join(lockDir, 'server.pid');
  const pid = process.pid;
  const lockData = JSON.stringify({ pid, port, startedAt: new Date().toISOString() });

  // Check if another instance is running
  if (existsSync(pidFile)) {
    try {
      const existing = JSON.parse(readFileSync(pidFile, 'utf8'));

      // Check if the process is still alive
      try {
        process.kill(existing.pid, 0); // Signal 0 = check if process exists
        throw new Error(
          `Another mrmd-sync instance is already running on this directory.\n\n` +
          `  PID: ${existing.pid}\n` +
          `  Port: ${existing.port}\n` +
          `  Started: ${existing.startedAt}\n\n` +
          `Stop the other instance first, or use a different directory.\n` +
          `If the process is stale, delete: ${pidFile}`
        );
      } catch (err) {
        if (err.code === 'ESRCH') {
          // Process doesn't exist - stale PID file, safe to remove
          log.info('Removing stale PID file', { stalePid: existing.pid });
          unlinkSync(pidFile);
        } else if (err.code !== 'EPERM') {
          // EPERM means process exists but we can't signal it (still alive)
          throw err;
        } else {
          // Process exists (EPERM) - another instance is running
          throw new Error(
            `Another mrmd-sync instance is already running on this directory.\n\n` +
            `  PID: ${existing.pid}\n` +
            `  Port: ${existing.port}\n` +
            `  Started: ${existing.startedAt}\n\n` +
            `Stop the other instance first, or use a different directory.`
          );
        }
      }
    } catch (err) {
      if (err.message.includes('Another mrmd-sync')) {
        throw err;
      }
      // Invalid JSON or other error - remove and recreate
      log.warn('Invalid PID file, recreating', { error: err.message });
      try { unlinkSync(pidFile); } catch { /* ignore */ }
    }
  }

  // Write our PID
  writeFileSync(pidFile, lockData);

  return () => {
    // Cleanup function - remove PID file on shutdown
    try {
      if (existsSync(pidFile)) {
        const current = JSON.parse(readFileSync(pidFile, 'utf8'));
        if (current.pid === pid) {
          unlinkSync(pidFile);
        }
      }
    } catch { /* ignore cleanup errors */ }
  };
}

// y-websocket server utils
import * as syncProtocol from 'y-protocols/sync';
import * as awarenessProtocol from 'y-protocols/awareness';
import * as encoding from 'lib0/encoding';
import * as decoding from 'lib0/decoding';

const messageSync = 0;
const messageAwareness = 1;

// =============================================================================
// LOGGING - Structured JSON logging with levels
// =============================================================================

const LOG_LEVELS = { debug: 0, info: 1, warn: 2, error: 3 };

function createLogger(minLevel = 'info') {
  const minLevelNum = LOG_LEVELS[minLevel] ?? 1;

  const log = (level, message, data = {}) => {
    if (LOG_LEVELS[level] < minLevelNum) return;

    const entry = {
      timestamp: new Date().toISOString(),
      level,
      message,
      ...data,
    };

    const output = JSON.stringify(entry);
    if (level === 'error') {
      console.error(output);
    } else {
      console.log(output);
    }
  };

  return {
    debug: (msg, data) => log('debug', msg, data),
    info: (msg, data) => log('info', msg, data),
    warn: (msg, data) => log('warn', msg, data),
    error: (msg, data) => log('error', msg, data),
  };
}

// =============================================================================
// ASYNC MUTEX - Prevents race conditions in file operations
// =============================================================================

class AsyncMutex {
  constructor() {
    this._queue = [];
    this._locked = false;
  }

  async acquire() {
    return new Promise((resolve) => {
      if (!this._locked) {
        this._locked = true;
        resolve();
      } else {
        this._queue.push(resolve);
      }
    });
  }

  release() {
    if (this._queue.length > 0) {
      const next = this._queue.shift();
      next();
    } else {
      this._locked = false;
    }
  }

  async withLock(fn) {
    await this.acquire();
    try {
      return await fn();
    } finally {
      this.release();
    }
  }
}

// =============================================================================
// METRICS - Track server statistics
// =============================================================================

class Metrics {
  constructor() {
    this.startTime = Date.now();
    this.totalConnections = 0;
    this.activeConnections = 0;
    this.totalMessages = 0;
    this.totalBytesIn = 0;
    this.totalBytesOut = 0;
    this.totalFileSaves = 0;
    this.totalFileLoads = 0;
    this.totalErrors = 0;
    this.lastActivity = Date.now();
  }

  connectionOpened() {
    this.totalConnections++;
    this.activeConnections++;
    this.lastActivity = Date.now();
  }

  connectionClosed() {
    this.activeConnections--;
  }

  messageReceived(bytes) {
    this.totalMessages++;
    this.totalBytesIn += bytes;
    this.lastActivity = Date.now();
  }

  messageSent(bytes) {
    this.totalBytesOut += bytes;
  }

  fileSaved() {
    this.totalFileSaves++;
  }

  fileLoaded() {
    this.totalFileLoads++;
  }

  errorOccurred() {
    this.totalErrors++;
  }

  getStats() {
    return {
      uptime: Math.floor((Date.now() - this.startTime) / 1000),
      connections: {
        total: this.totalConnections,
        active: this.activeConnections,
      },
      messages: {
        total: this.totalMessages,
        bytesIn: this.totalBytesIn,
        bytesOut: this.totalBytesOut,
      },
      files: {
        saves: this.totalFileSaves,
        loads: this.totalFileLoads,
      },
      errors: this.totalErrors,
      lastActivity: new Date(this.lastActivity).toISOString(),
    };
  }
}

// =============================================================================
// DEFAULT CONFIGURATION
// =============================================================================

const DEFAULT_CONFIG = {
  dir: '.',
  port: 4444,
  auth: null,
  debounceMs: 1000,
  maxConnections: 100,
  maxConnectionsPerDoc: 50,
  maxMessageSize: 1024 * 1024, // 1MB
  pingIntervalMs: 30000,
  docCleanupDelayMs: 60000,
  maxFileSize: 10 * 1024 * 1024, // 10MB
  dangerouslyAllowSystemPaths: false,
  logLevel: 'info',
  persistYjsState: true, // Save Yjs snapshots for crash recovery
  snapshotIntervalMs: 30000, // Snapshot every 30s
  storage: null, // null = filesystem (default), or a storage backend object
                 // e.g. createPostgresStorage({ pool }) for cloud mode
  pathPrefix: '', // URL path prefix to strip from doc names
                  // e.g. '/sync' so ws://host/sync/foo becomes doc name 'foo'
  onRequest: null, // async (req, res, url) => bool - custom HTTP request handler
                   // Return true if handled, false to fall through to built-in routes
  handleProcessSignals: true, // embedded daemon mode can disable internal SIGINT/SIGTERM hooks
};

// Paths that require dangerouslyAllowSystemPaths: true
const DANGEROUS_PATHS = ['/', '/etc', '/usr', '/var', '/bin', '/sbin', '/root', '/home'];

// =============================================================================
// DATA LOSS PREVENTION - Memory Monitoring
// =============================================================================
// Added after investigating unexplained data loss on 2026-01-16.
// The sync server crashed with OOM after ~9 minutes, consuming 4GB for a 2.5KB
// document. User lost ~2.5 hours of work because the editor gave no warning.
//
// These safeguards ensure:
// 1. Memory usage is monitored and warnings are logged
// 2. Y.Doc compaction runs periodically to bound memory growth
// 3. Server fails fast (512MB limit in electron main.js) rather than OOM later
// =============================================================================

const MEMORY_WARNING_MB = 200;   // Warn at 200MB
// DISABLED: Compaction causes document duplication!
// When clients reconnect after compaction, Yjs merges their state with the
// server's fresh state, causing content to double. Need a different approach.
// Keeping memory monitoring for warnings only.
const MEMORY_COMPACT_MB = Infinity;   // Disabled
const MEMORY_CHECK_INTERVAL_MS = 30000; // Check every 30 seconds
const COMPACTION_INTERVAL_MS = Infinity; // Disabled

/**
 * Get current memory usage in MB
 */
function getMemoryUsageMB() {
  const usage = process.memoryUsage();
  return {
    heapUsed: Math.round(usage.heapUsed / 1024 / 1024),
    heapTotal: Math.round(usage.heapTotal / 1024 / 1024),
    rss: Math.round(usage.rss / 1024 / 1024),
    external: Math.round(usage.external / 1024 / 1024),
  };
}

/**
 * Compact a Y.Doc by creating a fresh doc with only current content.
 * This discards all operation history and tombstones, dramatically reducing memory.
 *
 * NOTE: This will disconnect all clients, who will need to reconnect.
 * The content itself is preserved via the file and snapshot.
 *
 * @param {Object} docData - The document data object from getDoc()
 * @param {Object} log - Logger instance
 * @returns {Object} - New Y.Doc and Y.Text
 */
function compactYDoc(docData, log) {
  const { ydoc, ytext, docName } = docData;

  // Get current content before compaction
  const currentContent = ytext.toString();
  const oldStateSize = Y.encodeStateAsUpdate(ydoc).length;

  log.info('Compacting Y.Doc', {
    doc: docName,
    contentLength: currentContent.length,
    oldStateSize,
  });

  // Create fresh Y.Doc
  const newYdoc = new Y.Doc();
  newYdoc.name = docName;
  const newYtext = newYdoc.getText('content');

  // Insert current content into fresh doc
  if (currentContent.length > 0) {
    newYdoc.transact(() => {
      newYtext.insert(0, currentContent);
    });
  }

  const newStateSize = Y.encodeStateAsUpdate(newYdoc).length;

  log.info('Y.Doc compacted', {
    doc: docName,
    oldStateSize,
    newStateSize,
    reduction: `${Math.round((1 - newStateSize / oldStateSize) * 100)}%`,
  });

  return { newYdoc, newYtext };
}

// =============================================================================
// UTILITY FUNCTIONS
// =============================================================================

/**
 * Check if a directory path is considered dangerous
 */
function isDangerousPath(dirPath) {
  const resolved = dirPath.startsWith('/') ? dirPath : null;
  if (!resolved) return false;

  for (const dangerous of DANGEROUS_PATHS) {
    if (resolved === dangerous || resolved.startsWith(dangerous + '/')) {
      if (dangerous === '/home' && resolved.split('/').length > 3) {
        return false;
      }
      if (dangerous !== '/home' && dangerous !== '/' && resolved !== dangerous) {
        return true;
      }
      return true;
    }
  }
  return false;
}

/**
 * Safe file read with error handling
 */
function safeReadFile(filePath, maxSize) {
  try {
    if (!existsSync(filePath)) {
      return { content: null, error: null };
    }
    const stats = statSync(filePath);
    if (stats.size > maxSize) {
      return { content: null, error: `File too large: ${stats.size} bytes (max: ${maxSize})` };
    }
    const content = readFileSync(filePath, 'utf8');
    return { content, error: null };
  } catch (err) {
    return { content: null, error: `Failed to read file: ${err.message}` };
  }
}

/**
 * Atomic file write - writes to temp file then renames
 */
function atomicWriteFile(filePath, content) {
  const tmpPath = `${filePath}.tmp.${process.pid}.${Date.now()}`;
  try {
    const fileDir = dirname(filePath);
    mkdirSync(fileDir, { recursive: true });

    // Write to temp file
    writeFileSync(tmpPath, content, 'utf8');

    // Atomic rename
    renameSync(tmpPath, filePath);

    return { success: true, error: null };
  } catch (err) {
    // Clean up temp file if it exists
    try {
      if (existsSync(tmpPath)) {
        unlinkSync(tmpPath);
      }
    } catch {
      // Ignore cleanup errors
    }
    return { success: false, error: `Failed to write file: ${err.message}` };
  }
}

/**
 * Clean up stale temp files left behind by crashed processes.
 * Temp files have pattern: {filename}.tmp.{pid}.{timestamp}
 * A file is stale if:
 *   - The PID no longer exists (process died)
 *   - OR the timestamp is older than maxAgeMs (fallback safety)
 */
function cleanupStaleTempFiles(dir, log, maxAgeMs = 3600000) {
  const tmpPattern = /\.tmp\.(\d+)\.(\d+)$/;
  let cleaned = 0;
  let errors = 0;

  function walkDir(currentDir) {
    let entries;
    try {
      entries = readdirSync(currentDir, { withFileTypes: true });
    } catch {
      return; // Skip directories we can't read
    }

    for (const entry of entries) {
      const fullPath = join(currentDir, entry.name);

      if (entry.isDirectory()) {
        // Skip hidden directories and node_modules
        if (!entry.name.startsWith('.') && entry.name !== 'node_modules') {
          walkDir(fullPath);
        }
        continue;
      }

      // Check if this is a temp file
      const match = entry.name.match(tmpPattern);
      if (!match) continue;

      const pid = parseInt(match[1], 10);
      const timestamp = parseInt(match[2], 10);
      const age = Date.now() - timestamp;

      // Check if process is dead
      let processIsDead = false;
      try {
        process.kill(pid, 0); // Signal 0 = check if process exists
      } catch (err) {
        if (err.code === 'ESRCH') {
          processIsDead = true; // Process doesn't exist
        }
        // EPERM means process exists but we can't signal it
      }

      // Remove if process is dead OR file is older than maxAgeMs
      if (processIsDead || age > maxAgeMs) {
        try {
          unlinkSync(fullPath);
          cleaned++;
          log.info('Removed stale temp file', {
            path: fullPath,
            pid,
            processIsDead,
            ageMs: age,
          });
        } catch (err) {
          errors++;
          log.warn('Failed to remove stale temp file', {
            path: fullPath,
            error: err.message,
          });
        }
      }
    }
  }

  walkDir(dir);

  if (cleaned > 0 || errors > 0) {
    log.info('Temp file cleanup complete', { cleaned, errors });
  }

  return { cleaned, errors };
}

/**
 * Save Yjs document state for crash recovery
 */
function saveYjsSnapshot(snapshotPath, ydoc) {
  try {
    const state = Y.encodeStateAsUpdate(ydoc);
    const buffer = Buffer.from(state);
    atomicWriteFile(snapshotPath, buffer.toString('base64'));
    return { success: true };
  } catch (err) {
    return { success: false, error: err.message };
  }
}

/**
 * Load Yjs document state from snapshot
 */
function loadYjsSnapshot(snapshotPath, ydoc) {
  try {
    if (!existsSync(snapshotPath)) {
      return { loaded: false };
    }
    const base64 = readFileSync(snapshotPath, 'utf8');
    const state = Buffer.from(base64, 'base64');
    Y.applyUpdate(ydoc, new Uint8Array(state));
    return { loaded: true };
  } catch (err) {
    return { loaded: false, error: err.message };
  }
}

/**
 * Safe WebSocket send with error handling and metrics
 */
function safeSend(ws, data, metrics) {
  try {
    if (ws.readyState === 1) {
      ws.send(data);
      if (metrics) {
        metrics.messageSent(data.length);
      }
      return true;
    }
  } catch (err) {
    // Silently fail - connection may be closing
  }
  return false;
}

/**
 * Decode URL-encoded room name safely
 */
function decodeRoomName(url) {
  try {
    const path = url?.slice(1).split('?')[0] || 'default';
    return decodeURIComponent(path);
  } catch {
    return url?.slice(1).split('?')[0] || 'default';
  }
}

/**
 * Validate room/doc name
 * Supports both relative names (within docs dir) and absolute paths
 */
function isValidDocName(name) {
  if (!name || typeof name !== 'string') return false;
  if (name.length > 1024) return false; // Allow longer for absolute paths
  if (name.includes('..')) return false; // No directory traversal

  // Absolute paths are allowed (start with /)
  if (name.startsWith('/')) {
    // Must be a reasonable path - no control chars, null bytes, etc.
    // Allow spaces because real file names can contain spaces.
    return /^\/[\w\-./ ]+$/.test(name);
  }

  // Relative names: alphanumeric, dashes, underscores, dots, slashes, spaces
  if (name.startsWith('\\')) return false;
  return /^[\w\-./ ]+$/.test(name);
}

/**
 * Generate content hash for change detection
 */
function contentHash(content) {
  return createHash('md5').update(content).digest('hex');
}

// =============================================================================
// MAIN SERVER
// =============================================================================

/**
 * Create a production-ready sync server
 */
export function createServer(options = {}) {
  const config = { ...DEFAULT_CONFIG, ...options };
  const {
    dir,
    port,
    auth,
    debounceMs,
    maxConnections,
    maxConnectionsPerDoc,
    maxMessageSize,
    pingIntervalMs,
    docCleanupDelayMs,
    maxFileSize,
    dangerouslyAllowSystemPaths,
    logLevel,
    persistYjsState,
    snapshotIntervalMs,
    storage,
    pathPrefix,
    onRequest,
    handleProcessSignals,
  } = config;

  // Storage mode: 'postgres' if storage backend provided, 'filesystem' otherwise
  const storageMode = storage?.type === 'postgres' ? 'postgres' : 'filesystem';

  // Initialize logger and metrics
  const log = createLogger(logLevel);
  const metrics = new Metrics();

  // Resolve directory path (not needed in postgres-only mode, but keep for compat)
  const resolvedDir = storageMode === 'filesystem' ? resolve(dir) : dir;

  let dirHash, snapshotDir, releasePidLock;

  if (storageMode === 'filesystem') {
    // Use temp directory for state (PID file, Yjs snapshots)
    dirHash = createHash('sha256').update(resolvedDir).digest('hex').slice(0, 12);
    snapshotDir = join(tmpdir(), `mrmd-sync-${dirHash}`);

    // Security check
    if (isDangerousPath(resolvedDir) && !dangerouslyAllowSystemPaths) {
      throw new Error(
        `Refusing to sync dangerous system path: "${resolvedDir}"\n\n` +
        `Syncing system directories can expose sensitive files.\n\n` +
        `To proceed, set: createServer({ dangerouslyAllowSystemPaths: true })\n` +
        `Or use CLI: mrmd-sync --i-know-what-i-am-doing ${dir}`
      );
    }

    // Ensure directories exist
    mkdirSync(resolvedDir, { recursive: true });
    mkdirSync(snapshotDir, { recursive: true });

    // Acquire PID lock to prevent multiple instances on same directory
    releasePidLock = acquirePidLock(snapshotDir, port, log);

    // Clean up stale temp files from previous crashed processes
    cleanupStaleTempFiles(resolvedDir, log);
  } else {
    dirHash = 'postgres';
    snapshotDir = null;
    releasePidLock = () => {};
    log.info('Postgres storage mode — no filesystem operations');
  }

  // Document storage
  const docs = new Map();

  // Pending writes tracker for graceful shutdown
  const pendingWrites = new Map();

  // Shutdown state
  let isShuttingDown = false;

  // =============================================================================
  // DOCUMENT MANAGEMENT
  // =============================================================================

  function getDoc(docName) {
    if (docs.has(docName)) {
      return docs.get(docName);
    }

    const ydoc = new Y.Doc();
    ydoc.name = docName;

    const awareness = new awarenessProtocol.Awareness(ydoc);
    const conns = new Set();
    const mutex = new AsyncMutex();

    // Filesystem mode: resolve file path for local persistence
    const isAbsolutePath = docName.startsWith('/');
    const filePath = storageMode === 'filesystem'
      ? resolveDocFilePath(docName, resolvedDir) : null;

    // For snapshots, always use the snapshot dir with a safe name
    const safeSnapshotName = docName.replace(/\//g, '__').replace(/^_+/, '');
    const snapshotPath = (persistYjsState && snapshotDir)
      ? join(snapshotDir, `${safeSnapshotName}.yjs`)
      : null;

    const ytext = ydoc.getText('content');
    const docData = {
      docName,
      ydoc,
      ytext,
      awareness,
      conns,
      mutex,
      filePath,
      snapshotPath,
      applyFileChange: null,
      flushWrite: null,
      scheduleCleanup: null,
      cancelCleanup: null,
      scheduleWrite: null,
    };

    // Track state
    let lastFileHash = null;
    let isWritingToFile = false;
    let isWritingToYjs = false;
    let writeTimeout = null;
    let snapshotTimeout = null;
    let cleanupTimeout = null;

    // Log document opening
    log.info('Opening document', {
      doc: docName,
      path: filePath,
      storage: storageMode,
    });

    // ── Load initial state ──────────────────────────────────────────────

    if (storageMode === 'postgres') {
      // Postgres mode: load is async, handled via _loadFromPostgres below.
      // The doc is returned immediately; async load merges state on arrival.
      // This keeps getDoc synchronous for compatibility with the rest of the code.
      docData._pgLoaded = false;
      docData._pgLoadPromise = (async () => {
        try {
          const { yjsState, content: pgContent } = await storage.load(docName);
          // Track what was actually loaded from Postgres (not the current Y.Doc
          // state, which may already include updates from connected clients that
          // arrived while this async load was in progress).
          let loadedContent = '';
          if (yjsState && yjsState.byteLength > 0) {
            // Extract the stored content BEFORE merging into the live doc,
            // because the live doc may already have client updates.
            try {
              const tmpDoc = new Y.Doc();
              Y.applyUpdate(tmpDoc, yjsState);
              loadedContent = tmpDoc.getText('content').toString();
              tmpDoc.destroy();
            } catch { loadedContent = ''; }
            Y.applyUpdate(ydoc, yjsState);
            log.info('Loaded from Postgres', { doc: docName, bytes: yjsState.byteLength });
          } else if (pgContent !== null) {
            loadedContent = pgContent;
            ydoc.transact(() => {
              if (ytext.length > 0) ytext.delete(0, ytext.length);
              ytext.insert(0, pgContent);
            });
            log.info('Loaded text from Postgres', { doc: docName, chars: pgContent.length });
          }
          // IMPORTANT: Hash what was loaded, not ytext.toString(). A client may
          // have already sent content via the sync protocol while Postgres was
          // loading. If we hash ytext now, the debounced write will think content
          // is unchanged and skip saving new data to Postgres.
          lastFileHash = contentHash(loadedContent);
          docData._pgLoaded = true;
        } catch (err) {
          log.error('Postgres load error', { doc: docName, error: err.message });
          metrics.errorOccurred();
          docData._pgLoaded = true; // Mark loaded so we don't block forever
        }
      })();
    } else {
      // Filesystem mode: synchronous load (original behavior)

      // Try to load from Yjs snapshot first (for crash recovery)
      let loadedFromSnapshot = false;
      if (snapshotPath) {
        const { loaded, error } = loadYjsSnapshot(snapshotPath, ydoc);
        if (loaded) {
          loadedFromSnapshot = true;
          log.info('Loaded Yjs snapshot', { doc: docName });
        } else if (error) {
          log.warn('Failed to load Yjs snapshot', { doc: docName, error });
        }
      }

      // Load from file if exists
      const { content, error } = safeReadFile(filePath, maxFileSize);
      if (error) {
        log.error('Error loading file', { path: filePath, error });
        metrics.errorOccurred();
      } else if (content !== null) {
        const currentContent = ytext.toString();
        if (!loadedFromSnapshot || currentContent !== content) {
          if (currentContent !== content) {
            ydoc.transact(() => {
              if (ytext.length > 0) ytext.delete(0, ytext.length);
              ytext.insert(0, content);
            });
          }
        }
        lastFileHash = contentHash(content);
        log.info('Loaded file', { path: filePath, chars: content.length });
        metrics.fileLoaded();
      }
    } // end storageMode === 'filesystem' load block

    // ── Debounced write (storage-aware) ─────────────────────────────────
    const scheduleWrite = () => {
      if (isWritingToYjs || isShuttingDown) return;

      clearTimeout(writeTimeout);

      const writeId = Date.now();
      pendingWrites.set(docName, writeId);

      writeTimeout = setTimeout(async () => {
        await mutex.withLock(async () => {
          if (isShuttingDown) return;

          isWritingToFile = true;
          const content = docData.ytext.toString();
          const hash = contentHash(content);

          // Skip if content unchanged
          if (hash === lastFileHash) {
            isWritingToFile = false;
            pendingWrites.delete(docName);
            return;
          }

          if (storageMode === 'postgres') {
            // Postgres mode: save Yjs state + text to DB
            try {
              const yjsState = Y.encodeStateAsUpdate(docData.ydoc);
              await storage.save(docName, content, yjsState);
              lastFileHash = hash;
              log.info('Saved to Postgres', { doc: docName, chars: content.length });
              metrics.fileSaved();
            } catch (err) {
              log.error('Postgres save error', { doc: docName, error: err.message });
              metrics.errorOccurred();
            }
          } else {
            // Filesystem mode: atomic write to .md file
            const { success, error } = atomicWriteFile(docData.filePath, content);
            if (error) {
              log.error('Error saving file', { path: filePath, error });
              metrics.errorOccurred();
            } else {
              lastFileHash = hash;
              log.info('Saved file', { path: filePath, chars: content.length });
              metrics.fileSaved();
            }
          }

          isWritingToFile = false;
          pendingWrites.delete(docName);
        });
      }, debounceMs);
    };

    docData.scheduleWrite = scheduleWrite;

    // Listen for Yjs updates
    docData.ydoc.on('update', scheduleWrite);

    // Schedule Yjs snapshot saves
    if (persistYjsState && snapshotPath) {
      const scheduleSnapshot = () => {
        clearTimeout(snapshotTimeout);
        snapshotTimeout = setTimeout(() => {
          const { success, error } = saveYjsSnapshot(snapshotPath, docData.ydoc);
          if (error) {
            log.warn('Failed to save Yjs snapshot', { doc: docName, error });
          }
          scheduleSnapshot();
        }, snapshotIntervalMs);
      };
      scheduleSnapshot();
    }

    // Apply external file changes to Yjs
    const applyFileChange = async (newContent) => {
      await mutex.withLock(() => {
        if (isWritingToFile) return;

        const newHash = contentHash(newContent);
        if (newHash === lastFileHash) return;

        const oldContent = docData.ytext.toString();
        if (oldContent === newContent) {
          lastFileHash = newHash;
          return;
        }

        isWritingToYjs = true;
        const changes = diffChars(oldContent, newContent);

        docData.ydoc.transact(() => {
          let pos = 0;
          for (const change of changes) {
            if (change.added) {
              docData.ytext.insert(pos, change.value);
              pos += change.value.length;
            } else if (change.removed) {
              docData.ytext.delete(pos, change.value.length);
            } else {
              pos += change.value.length;
            }
          }
        });

        lastFileHash = newHash;
        log.info('Applied external file change', { path: filePath });
        isWritingToYjs = false;
      });
    };

    // Immediate flush for shutdown
    const flushWrite = async () => {
      clearTimeout(writeTimeout);
      await mutex.withLock(async () => {
        const content = docData.ytext.toString();
        const hash = contentHash(content);
        if (hash !== lastFileHash) {
          if (storageMode === 'postgres') {
            try {
              const yjsState = Y.encodeStateAsUpdate(docData.ydoc);
              await storage.save(docName, content, yjsState);
              log.info('Flushed to Postgres on shutdown', { doc: docName });
            } catch (err) {
              log.error('Postgres flush error', { doc: docName, error: err.message });
            }
          } else {
            const { error } = atomicWriteFile(docData.filePath, content);
            if (error) {
              log.error('Error flushing file', { path: filePath, error });
            } else {
              log.info('Flushed file on shutdown', { path: filePath });
            }
          }
        }
        // Save final snapshot (filesystem mode only)
        if (snapshotPath) {
          saveYjsSnapshot(snapshotPath, docData.ydoc);
        }
      });
      pendingWrites.delete(docName);
    };

    // Cleanup
    const scheduleCleanup = () => {
      clearTimeout(cleanupTimeout);
      cleanupTimeout = setTimeout(async () => {
        if (conns.size === 0) {
          await flushWrite();
          clearTimeout(snapshotTimeout);
          docData.awareness.destroy();
          docData.ydoc.destroy();
          docs.delete(docName);
          log.info('Cleaned up document', { doc: docName });
        }
      }, docCleanupDelayMs);
    };

    const cancelCleanup = () => {
      clearTimeout(cleanupTimeout);
    };

    docData.applyFileChange = applyFileChange;
    docData.flushWrite = flushWrite;
    docData.scheduleCleanup = scheduleCleanup;
    docData.cancelCleanup = cancelCleanup;

    docs.set(docName, docData);
    return docData;
  }

  // =============================================================================
  // FILE WATCHER (filesystem mode only)
  // =============================================================================

  let watcher = null;

  if (storageMode === 'filesystem') {
    // Ignore directories that should never be watched for .md/.qmd changes.
    // Uses a function so we can combine: all hidden dirs (. prefix) + known heavy dirs.
    const IGNORED_DIR_NAMES = new Set([
      'node_modules', 'venv', '__pycache__', 'target', 'dist', 'build',
      '_site', '_freeze', '_build', 'site-packages', 'vendor', 'deps',
      '.julia', 'pkg', 'Pods', 'DerivedData',
    ]);
    const ignoreFn = (filePath) => {
      const base = basename(filePath);
      // Skip all hidden directories/files (catches .git, .venv*, .tox, .mypy_cache, etc.)
      if (base.startsWith('.') && base !== '.') return true;
      // Skip known heavy non-hidden directories
      if (IGNORED_DIR_NAMES.has(base)) return true;
      return false;
    };

    watcher = watch([
      join(resolvedDir, '**/*.md'),
      join(resolvedDir, '**/*.qmd'),
    ], {
      ignoreInitial: true,
      awaitWriteFinish: { stabilityThreshold: 300 },
      ignored: ignoreFn,
    });

    watcher.on('change', async (filePath) => {
      for (const [name, doc] of docs) {
        if (doc.filePath === filePath) {
          const { content, error } = safeReadFile(filePath, maxFileSize);
          if (error) {
            log.error('Error reading changed file', { path: filePath, error });
            metrics.errorOccurred();
          } else if (content !== null) {
            await doc.applyFileChange(content);
          }
          break;
        }
      }
    });

    watcher.on('add', async (filePath) => {
      const relativePath = relative(resolvedDir, filePath);
      const docName = relativePath.toLowerCase().endsWith('.md')
        ? relativePath.replace(/\.md$/i, '')
        : relativePath;

      if (docs.has(docName)) {
        const { content, error } = safeReadFile(filePath, maxFileSize);
        if (error) {
          log.error('Error reading new file', { path: filePath, error });
          metrics.errorOccurred();
        } else if (content !== null) {
          await docs.get(docName).applyFileChange(content);
        }
      }
    });

    watcher.on('error', (err) => {
      log.error('File watcher error', { error: err.message });
      metrics.errorOccurred();
    });
  }

  // =============================================================================
  // HTTP SERVER WITH HEALTH ENDPOINT
  // =============================================================================

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, `http://${req.headers.host}`);

    // CORS headers
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');

    if (req.method === 'OPTIONS') {
      res.writeHead(204);
      res.end();
      return;
    }

    // Custom request handler (e.g. sync-relay's document API)
    if (onRequest) {
      try {
        const handled = await onRequest(req, res, url);
        if (handled) return;
      } catch (err) {
        log.error('onRequest handler error', { error: err.message });
        if (!res.headersSent) {
          res.writeHead(500, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Internal server error' }));
        }
        return;
      }
    }

    // Health check endpoint
    if (url.pathname === '/health' || url.pathname === '/healthz') {
      const healthy = !isShuttingDown && metrics.activeConnections >= 0;
      res.writeHead(healthy ? 200 : 503, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        status: healthy ? 'healthy' : 'unhealthy',
        shutting_down: isShuttingDown,
      }));
      return;
    }

    // Metrics endpoint
    if (url.pathname === '/metrics') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(metrics.getStats(), null, 2));
      return;
    }

    // Stats endpoint (detailed)
    if (url.pathname === '/stats') {
      const stats = {
        ...metrics.getStats(),
        documents: Array.from(docs.entries()).map(([name, doc]) => ({
          name,
          connections: doc.conns.size,
          path: doc.filePath,
        })),
        config: {
          port,
          dir: resolvedDir,
          debounceMs,
          maxConnections,
          maxConnectionsPerDoc,
        },
      };
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(stats, null, 2));
      return;
    }

    // Default response
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end('mrmd-sync server\n\nEndpoints:\n  /health - Health check\n  /metrics - Server metrics\n  /stats - Detailed statistics');
  });

  // =============================================================================
  // WEBSOCKET SERVER
  // =============================================================================

  const wss = new WebSocketServer({
    server,
    maxPayload: maxMessageSize,
  });

  wss.on('connection', async (ws, req) => {
    // Hook: let the caller handle custom connection types (e.g. runtime tunnels)
    // before the Yjs sync handler runs. Return true to take ownership.
    if (config.onConnection) {
      try {
        const handled = await config.onConnection(ws, req);
        if (handled) return;
      } catch (err) {
        log.error('onConnection hook error', { error: err.message });
      }
    }

    if (isShuttingDown) {
      ws.close(1001, 'Server shutting down');
      return;
    }

    if (metrics.activeConnections >= maxConnections) {
      log.warn('Connection rejected: max connections reached');
      ws.close(1013, 'Max connections reached');
      return;
    }

    let docName = decodeRoomName(req.url);

    // Strip path prefix if configured (e.g. '/sync' → 'userId/project/doc')
    if (pathPrefix) {
      const normalizedPrefix = pathPrefix.replace(/^\/+|\/+$/g, '');
      if (normalizedPrefix && (docName === normalizedPrefix || docName.startsWith(`${normalizedPrefix}/`))) {
        docName = docName.slice(normalizedPrefix.length).replace(/^\/+/, '');
      }
    }

    if (!isValidDocName(docName)) {
      log.warn('Connection rejected: invalid doc name', { docName });
      ws.close(1008, 'Invalid document name');
      return;
    }

    // Auth check
    if (auth) {
      try {
        const authResult = await auth(req, docName);
        if (!authResult) {
          log.warn('Connection rejected: auth failed', { docName });
          ws.close(1008, 'Unauthorized');
          return;
        }

        // Allow auth handlers to attach metadata (e.g. role/read-only policy).
        if (authResult && typeof authResult === 'object') {
          ws._mrmdAuth = authResult;
        }
      } catch (err) {
        log.error('Auth error', { error: err.message });
        ws.close(1011, 'Auth error');
        return;
      }
    }

    const doc = getDoc(docName);
    const { ydoc, awareness, conns, cancelCleanup, scheduleCleanup } = doc;

    if (conns.size >= maxConnectionsPerDoc) {
      log.warn('Connection rejected: max per-doc connections', { docName });
      ws.close(1013, 'Max connections for document reached');
      return;
    }

    metrics.connectionOpened();
    conns.add(ws);
    cancelCleanup();

    log.info('Client connected', {
      doc: docName,
      clients: conns.size,
      total: metrics.activeConnections,
    });

    // Heartbeat
    let isAlive = true;
    ws.on('pong', () => { isAlive = true; });

    const pingInterval = setInterval(() => {
      if (!isAlive) {
        log.debug('Client timed out', { doc: docName });
        ws.terminate();
        return;
      }
      isAlive = false;
      ws.ping();
    }, pingIntervalMs);

    // Send initial sync
    const encoder = encoding.createEncoder();
    encoding.writeVarUint(encoder, messageSync);
    syncProtocol.writeSyncStep1(encoder, ydoc);
    safeSend(ws, encoding.toUint8Array(encoder), metrics);

    // Send awareness
    const awarenessStates = awareness.getStates();
    if (awarenessStates.size > 0) {
      const awarenessEncoder = encoding.createEncoder();
      encoding.writeVarUint(awarenessEncoder, messageAwareness);
      encoding.writeVarUint8Array(
        awarenessEncoder,
        awarenessProtocol.encodeAwarenessUpdate(awareness, Array.from(awarenessStates.keys()))
      );
      safeSend(ws, encoding.toUint8Array(awarenessEncoder), metrics);
    }

    // Message handler
    ws.on('message', (message) => {
      try {
        const data = new Uint8Array(message);
        metrics.messageReceived(data.length);

        const decoder = decoding.createDecoder(data);
        const messageType = decoding.readVarUint(decoder);

        // Read-only support: allow initial sync requests and awareness, but block
        // client-originated document updates when the auth handler marks the
        // connection as read-only.
        const authMeta = ws._mrmdAuth || null;
        const readOnly = authMeta?.readOnly === true
          || (typeof authMeta?.isReadOnly === 'function' && authMeta.isReadOnly());

        if (readOnly && messageType === messageSync) {
          // Yjs sync protocol:
          //   byte[0] = message type (0 = sync)
          //   byte[1] = sync subtype (0 = step1, 1 = step2, 2 = update)
          // In read-only mode we allow step1 and step2 (the initial handshake),
          // but block update (subtype 2) because those carry actual edits.
          // Step2 is the client's reply to the server's step1 — it contains
          // the diff the server needs, which is necessary for sync to complete.
          const syncSubtype = data.length >= 2 ? data[1] : null;
          if (syncSubtype !== 0 && syncSubtype !== 1) {
            return;
          }
        }

        switch (messageType) {
          case messageSync: {
            const responseEncoder = encoding.createEncoder();
            encoding.writeVarUint(responseEncoder, messageSync);
            syncProtocol.readSyncMessage(decoder, responseEncoder, ydoc, ws);

            if (encoding.length(responseEncoder) > 1) {
              safeSend(ws, encoding.toUint8Array(responseEncoder), metrics);
            }
            break;
          }
          case messageAwareness: {
            awarenessProtocol.applyAwarenessUpdate(
              awareness,
              decoding.readVarUint8Array(decoder),
              ws
            );
            break;
          }
        }
      } catch (err) {
        log.error('Error processing message', { error: err.message, doc: docName });
        metrics.errorOccurred();
      }
    });

    // Broadcast updates
    const updateHandler = (update, origin) => {
      const broadcastEncoder = encoding.createEncoder();
      encoding.writeVarUint(broadcastEncoder, messageSync);
      syncProtocol.writeUpdate(broadcastEncoder, update);
      const msg = encoding.toUint8Array(broadcastEncoder);

      conns.forEach((conn) => {
        if (conn !== origin) {
          safeSend(conn, msg, metrics);
        }
      });
    };
    ydoc.on('update', updateHandler);

    // Broadcast awareness
    const awarenessHandler = ({ added, updated, removed }) => {
      const changedClients = added.concat(updated).concat(removed);
      const awarenessEncoder = encoding.createEncoder();
      encoding.writeVarUint(awarenessEncoder, messageAwareness);
      encoding.writeVarUint8Array(
        awarenessEncoder,
        awarenessProtocol.encodeAwarenessUpdate(awareness, changedClients)
      );
      const msg = encoding.toUint8Array(awarenessEncoder);
      conns.forEach((conn) => safeSend(conn, msg, metrics));
    };
    awareness.on('update', awarenessHandler);

    // Cleanup on close
    ws.on('close', () => {
      clearInterval(pingInterval);
      metrics.connectionClosed();
      conns.delete(ws);
      ydoc.off('update', updateHandler);
      awareness.off('update', awarenessHandler);
      awarenessProtocol.removeAwarenessStates(awareness, [ydoc.clientID], null);

      log.info('Client disconnected', {
        doc: docName,
        clients: conns.size,
        total: metrics.activeConnections,
      });

      if (conns.size === 0) {
        scheduleCleanup();
      }
    });

    ws.on('error', (err) => {
      log.error('WebSocket error', { error: err.message, doc: docName });
      metrics.errorOccurred();
    });
  });

  wss.on('error', (err) => {
    log.error('WebSocket server error', { error: err.message });
    metrics.errorOccurred();
  });

  // =============================================================================
  // GRACEFUL SHUTDOWN
  // =============================================================================

  let gracefulShutdown = async (signal) => {
    if (isShuttingDown) return;
    isShuttingDown = true;

    log.info('Graceful shutdown initiated', { signal });

    // Stop accepting new connections
    wss.clients.forEach((client) => {
      client.close(1001, 'Server shutting down');
    });

    // Flush all pending writes
    log.info('Flushing pending writes', { count: docs.size });
    const flushPromises = Array.from(docs.values()).map((doc) => doc.flushWrite());
    await Promise.all(flushPromises);

    // Close watcher (filesystem mode only)
    if (watcher) await watcher.close();

    // Close servers and wait for them to fully stop accepting/serving work.
    await Promise.all([
      new Promise((resolve) => {
        try {
          wss.close(() => resolve());
        } catch {
          resolve();
        }
      }),
      new Promise((resolve) => {
        try {
          server.close(() => resolve());
        } catch {
          resolve();
        }
      }),
    ]);

    // Cleanup docs
    docs.forEach((doc) => {
      doc.awareness.destroy();
      doc.ydoc.destroy();
    });
    docs.clear();

    // Release PID lock
    releasePidLock();

    log.info('Shutdown complete');
  };

  // Register shutdown handlers only in standalone mode. When embedded in the
  // mrmd daemon, the daemon owns process lifecycle and calls close() directly.
  if (handleProcessSignals) {
    process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
    process.on('SIGINT', () => gracefulShutdown('SIGINT'));
  }

  // =============================================================================
  // START SERVER
  // =============================================================================

  server.listen(port, '0.0.0.0', () => {
    log.info('Server started', {
      port,
      dir: resolvedDir,
      stateDir: snapshotDir,
      storage: storageMode,
      debounceMs,
      maxConnections,
      persistYjsState,
    });
  });

  // =============================================================================
  // DATA LOSS PREVENTION - Memory Monitoring
  // =============================================================================
  // Added after investigating unexplained data loss on 2026-01-16.
  // Monitors memory usage and triggers compaction if needed.
  // =============================================================================

  let lastCompactionTime = Date.now();
  let memoryWarningLogged = false;
  let compactionInProgress = false;

  const memoryMonitorInterval = setInterval(async () => {
    if (isShuttingDown) return;

    const mem = getMemoryUsageMB();

    // Log warning if memory is getting high
    if (mem.heapUsed >= MEMORY_WARNING_MB && !memoryWarningLogged) {
      log.warn('High memory usage detected', {
        heapUsed: `${mem.heapUsed}MB`,
        heapTotal: `${mem.heapTotal}MB`,
        rss: `${mem.rss}MB`,
        threshold: `${MEMORY_WARNING_MB}MB`,
      });
      memoryWarningLogged = true;
    } else if (mem.heapUsed < MEMORY_WARNING_MB) {
      memoryWarningLogged = false;
    }

    if (compactionInProgress) return;

    // Trigger compaction if memory is critical OR if enough time has passed
    const timeSinceLastCompaction = Date.now() - lastCompactionTime;
    const shouldCompact =
      mem.heapUsed >= MEMORY_COMPACT_MB ||
      timeSinceLastCompaction >= COMPACTION_INTERVAL_MS;

    if (shouldCompact && docs.size > 0) {
      compactionInProgress = true;
      try {
        log.info('Triggering Y.Doc compaction', {
          reason: mem.heapUsed >= MEMORY_COMPACT_MB ? 'memory-pressure' : 'periodic',
          heapUsed: `${mem.heapUsed}MB`,
          docsCount: docs.size,
        });

        // Compact all documents
        for (const [docName, docData] of docs) {
          try {
            await docData.flushWrite();

            // Disconnect all clients (they will reconnect and get fresh state)
            for (const ws of docData.conns) {
              try {
                ws.close(4000, 'Document compacted - please reconnect');
              } catch (e) {
                // Ignore close errors
              }
            }
            docData.conns.clear();

            // Destroy old doc and create fresh one
            const oldYdoc = docData.ydoc;
            const oldAwareness = docData.awareness;
            const { newYdoc, newYtext } = compactYDoc(docData, log);
            const newAwareness = new awarenessProtocol.Awareness(newYdoc);

            oldYdoc.off('update', docData.scheduleWrite);

            // Update the document entry
            docData.ydoc = newYdoc;
            docData.ytext = newYtext;
            docData.awareness = newAwareness;

            // Re-register the update listener
            newYdoc.on('update', docData.scheduleWrite);

            // Clean up old doc
            oldAwareness.destroy();
            oldYdoc.destroy();

            log.info('Document compacted successfully', { doc: docName });
          } catch (e) {
            log.error('Error compacting document', { doc: docName, error: e.message });
          }
        }

        lastCompactionTime = Date.now();

        // Force garbage collection if available (--expose-gc flag)
        if (global.gc) {
          global.gc();
          const afterMem = getMemoryUsageMB();
          log.info('GC completed', {
            heapUsed: `${afterMem.heapUsed}MB`,
            freed: `${mem.heapUsed - afterMem.heapUsed}MB`,
          });
        }
      } finally {
        compactionInProgress = false;
      }
    }
  }, MEMORY_CHECK_INTERVAL_MS);

  // Clean up interval on shutdown
  const originalGracefulShutdown = gracefulShutdown;
  gracefulShutdown = async (signal) => {
    clearInterval(memoryMonitorInterval);
    return originalGracefulShutdown(signal);
  };

  // =============================================================================
  // PUBLIC API
  // =============================================================================

  return {
    server,
    wss,
    docs,
    getDoc,
    config,
    metrics,
    log,

    getStats() {
      return {
        ...metrics.getStats(),
        docs: Array.from(docs.entries()).map(([name, doc]) => ({
          name,
          connections: doc.conns.size,
        })),
      };
    },

    async close() {
      await gracefulShutdown('API');
    },
  };
}

export default { createServer };
