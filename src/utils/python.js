/**
 * Python discovery utilities.
 *
 * Two main functions:
 *   findInterpreters() — find all Python installations (uses uv)
 *   findEnvironments() — find all venvs and conda envs (filesystem + OS index)
 *
 * Design constraints:
 *   - Total scan time < 500ms
 *   - One subprocess max (uv python list)
 *   - Filesystem ops are stat/readdir/readFile only
 *   - OS file index (mdfind/locate) for comprehensive venv discovery
 *   - Works on Linux, macOS, Windows
 */

import os from 'os';
import path from 'path';
import fs from 'fs';
import { execFileSync } from 'child_process';
import { isWin, isMac } from './platform.js';
import { findProjectRoot as _findProjectRootShared, isProjectBoundary as _isProjectBoundaryShared } from './project.js';

// ── Path helpers ──────────────────────────────────────────

/**
 * The bin directory name inside a venv.
 * @returns {'bin'|'Scripts'}
 */
export function venvBinDir() {
  return isWin ? 'Scripts' : 'bin';
}

/**
 * Path to the python binary inside an environment.
 * @param {string} envPath
 * @returns {string}
 */
export function envPython(envPath) {
  return path.join(envPath, venvBinDir(), isWin ? 'python.exe' : 'python');
}

/**
 * Path to the mrmd-python entry point inside an environment.
 * @param {string} envPath
 * @returns {string}
 */
export function envMrmdPython(envPath) {
  return path.join(envPath, venvBinDir(), isWin ? 'mrmd-python.exe' : 'mrmd-python');
}

// ── Venv detection ────────────────────────────────────────

/**
 * Check if a directory is a PEP 405 virtual environment.
 * @param {string} dirPath
 * @returns {boolean}
 */
export function isVenv(dirPath) {
  return _exists(path.join(dirPath, 'pyvenv.cfg'));
}

/**
 * Check if a directory is a conda environment.
 * @param {string} dirPath
 * @returns {boolean}
 */
export function isCondaEnv(dirPath) {
  return _isDir(path.join(dirPath, 'conda-meta'));
}

/**
 * Check if a directory is any Python environment (venv or conda).
 * @param {string} dirPath
 * @returns {boolean}
 */
export function isPythonEnv(dirPath) {
  return isVenv(dirPath) || isCondaEnv(dirPath);
}

/**
 * Parse pyvenv.cfg. Returns key-value pairs.
 * Gives us Python version without spawning a subprocess.
 *
 * Typical contents:
 *   home = /usr/bin
 *   implementation = CPython
 *   version_info = 3.12.1
 *   include-system-site-packages = false
 *
 * @param {string} envPath - Path to the venv root (not to pyvenv.cfg itself)
 * @returns {{ home?: string, version?: string, implementation?: string, prompt?: string } | null}
 */
export function readPyvenvCfg(envPath) {
  const cfgPath = path.join(envPath, 'pyvenv.cfg');
  try {
    const text = fs.readFileSync(cfgPath, 'utf8');
    const result = {};
    for (const line of text.split('\n')) {
      const eq = line.indexOf('=');
      if (eq === -1) continue;
      const key = line.slice(0, eq).trim();
      const value = line.slice(eq + 1).trim();
      if (key === 'version_info' || key === 'version') {
        result.version = value;
      } else if (key === 'home') {
        result.home = value;
      } else if (key === 'implementation') {
        result.implementation = value;
      } else if (key === 'prompt') {
        result.prompt = value;
      }
    }
    return Object.keys(result).length > 0 ? result : null;
  } catch {
    return null;
  }
}

/**
 * Get the Python version for a conda env by reading the python binary
 * version from its filename or the conda-meta json files.
 * @param {string} envPath
 * @returns {string|null}
 */
export function condaEnvPythonVersion(envPath) {
  // Check for python3.X binary name in bin/
  const binDir = path.join(envPath, venvBinDir());
  try {
    const entries = fs.readdirSync(binDir);
    for (const entry of entries) {
      const match = entry.match(/^python(3\.\d+)(?:\.exe)?$/);
      if (match) return match[1];
    }
  } catch {}

  // Fallback: look in conda-meta for python-*.json
  try {
    const metaDir = path.join(envPath, 'conda-meta');
    const entries = fs.readdirSync(metaDir);
    for (const entry of entries) {
      const match = entry.match(/^python-(\d+\.\d+\.\d+)/);
      if (match) return match[1];
    }
  } catch {}

  return null;
}

// ── Find interpreters (via uv) ────────────────────────────

/**
 * Find uv binary. Checks common locations without spawning a process.
 * @returns {string|null}
 */
export function findUv() {
  const home = os.homedir();
  const candidates = isWin
    ? [
        path.join(home, '.local', 'bin', 'uv.exe'),
        path.join(home, '.cargo', 'bin', 'uv.exe'),
        path.join(process.env.LOCALAPPDATA || '', 'uv', 'uv.exe'),
      ]
    : [
        path.join(home, '.local', 'bin', 'uv'),
        path.join(home, '.cargo', 'bin', 'uv'),
        '/usr/local/bin/uv',
        '/usr/bin/uv',
      ];

  for (const p of candidates) {
    if (p && _exists(p)) return p;
  }

  // Last resort: check PATH via which/where
  try {
    const cmd = isWin ? 'where' : 'which';
    const result = execFileSync(cmd, ['uv'], {
      timeout: 2000,
      stdio: ['ignore', 'pipe', 'ignore'],
      encoding: 'utf8',
    });
    const found = result.trim().split('\n')[0].trim();
    if (found && _exists(found)) return found;
  } catch {}

  return null;
}

/**
 * @typedef {{ path: string, version: string, source: string, implementation: string }} InterpreterInfo
 */

/**
 * Find all Python interpreters using `uv python list --only-installed`.
 *
 * Parses output like:
 *   cpython-3.13.3-linux-x86_64-gnu    /home/user/.local/share/uv/python/.../bin/python3.13
 *   cpython-3.10.12-linux-x86_64-gnu   /usr/bin/python3 -> python3.10
 *
 * @param {string} uvPath - Path to uv binary
 * @returns {InterpreterInfo[]}
 */
export function findInterpreters(uvPath) {
  let output;
  try {
    output = execFileSync(uvPath, ['python', 'list', '--only-installed'], {
      timeout: 10000,
      stdio: ['ignore', 'pipe', 'ignore'],
      encoding: 'utf8',
    });
  } catch {
    return [];
  }

  const results = [];
  const seen = new Set();

  for (const line of output.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    // Format: "cpython-3.13.3-linux-x86_64-gnu    /path/to/python"
    // Sometimes has " -> target" at the end for symlinks
    const match = trimmed.match(
      /^(\w+)-(\d+\.\d+(?:\.\d+)?(?:\+\w+)?)-\S+\s+(.+?)(?:\s+->\s+.+)?$/
    );
    if (!match) continue;

    const [, implementation, version, binPath] = match;

    // Resolve symlinks for dedup
    let resolved;
    try {
      resolved = fs.realpathSync(binPath);
    } catch {
      resolved = binPath;
    }
    if (seen.has(resolved)) continue;
    seen.add(resolved);

    // Determine source from path
    const source = _interpreterSource(binPath);

    results.push({
      path: binPath,
      version,
      source,
      implementation,
    });
  }

  return results;
}

/**
 * Classify where an interpreter came from based on its path.
 * @param {string} binPath
 * @returns {string}
 */
function _interpreterSource(binPath) {
  const home = os.homedir();
  if (binPath.includes('.local/share/uv/python') || binPath.includes('uv/python')) return 'uv';
  if (binPath.includes('.pyenv/')) return 'pyenv';
  if (isMac && binPath.includes('/opt/homebrew/')) return 'homebrew';
  if (isMac && binPath.includes('/usr/local/Cellar/')) return 'homebrew';
  if (binPath.includes('miniconda') || binPath.includes('anaconda') || binPath.includes('mambaforge')) return 'conda';
  if (binPath.startsWith('/usr/bin/') || binPath.startsWith('/usr/lib/')) return 'system';
  if (isWin && binPath.includes('WindowsApps')) return 'windows-store';
  if (isWin && binPath.match(/[Cc]:\\[Pp]ython/)) return 'system';
  return 'other';
}

// ── Find environments ─────────────────────────────────────

/**
 * @typedef {{ path: string, type: 'venv'|'conda', pythonVersion: string|null, hasBridge: boolean, source: string }} EnvironmentInfo
 */

/**
 * Find all Python environments on this machine.
 *
 * Combines multiple strategies:
 *   1. Active environment ($VIRTUAL_ENV, $CONDA_PREFIX)
 *   2. OS file index (mdfind on macOS, locate on Linux) for venvs
 *   3. conda registry (~/.conda/environments.txt)
 *   4. Known venv registries (virtualenvwrapper, pipenv, pyenv)
 *   5. Project-local scan (walk up from cwd + 2-level scan at project root)
 *
 * @param {object} [opts]
 * @param {string} [opts.cwd] - Current working directory for project-local scan
 * @param {string} [opts.projectRoot] - Project root for local scan (auto-detected from cwd if omitted)
 * @returns {EnvironmentInfo[]}
 */
export function findEnvironments(opts = {}) {
  const seen = new Set();
  const results = [];

  const add = (envPath, type, source) => {
    let resolved;
    try {
      resolved = fs.realpathSync(envPath);
    } catch {
      resolved = envPath;
    }
    if (seen.has(resolved)) return;
    seen.add(resolved);

    const pythonVersion = type === 'venv'
      ? readPyvenvCfg(envPath)?.version || null
      : condaEnvPythonVersion(envPath);

    const hasBridge = _exists(envMrmdPython(envPath));

    results.push({ path: envPath, type, pythonVersion, hasBridge, source });
  };

  // 1. Active environment
  _findActiveEnv(add);

  // 2. OS file index (comprehensive venv search)
  _findVenvsViaOsIndex(add);

  // 3. Conda registry
  _findCondaEnvs(add);

  // 4. Known venv registries
  _findRegistryEnvs(add);

  // 5. Project-local scan
  if (opts.cwd || opts.projectRoot) {
    const projectRoot = opts.projectRoot || _findProjectRoot(opts.cwd);
    if (projectRoot) {
      _findProjectEnvs(projectRoot, add);
    }
    // Walk up from cwd even if different from projectRoot
    if (opts.cwd) {
      _findWalkUpEnvs(opts.cwd, add);
    }
  }

  return results;
}

// ── Environment search strategies ─────────────────────────

/**
 * Check $VIRTUAL_ENV and $CONDA_PREFIX.
 */
function _findActiveEnv(add) {
  const virtualEnv = process.env.VIRTUAL_ENV;
  if (virtualEnv && isVenv(virtualEnv)) {
    add(virtualEnv, 'venv', 'active');
  }

  const condaPrefix = process.env.CONDA_PREFIX;
  if (condaPrefix && isCondaEnv(condaPrefix)) {
    add(condaPrefix, 'conda', 'active');
  }
}

/**
 * Use OS file index to find pyvenv.cfg files.
 * macOS: mdfind (Spotlight) — always available, always current.
 * Linux: locate/plocate — fast but may not be installed.
 */
function _findVenvsViaOsIndex(add) {
  const home = os.homedir();

  if (isMac) {
    try {
      const output = execFileSync('mdfind', ['-name', 'pyvenv.cfg', '-onlyin', home], {
        timeout: 5000,
        stdio: ['ignore', 'pipe', 'ignore'],
        encoding: 'utf8',
      });
      for (const line of output.split('\n')) {
        const cfgPath = line.trim();
        if (!cfgPath) continue;
        // pyvenv.cfg is in the venv root
        const envPath = path.dirname(cfgPath);
        if (isVenv(envPath)) {
          add(envPath, 'venv', 'spotlight');
        }
      }
    } catch {}
    return;
  }

  if (!isWin) {
    // Linux: try locate/plocate
    for (const cmd of ['plocate', 'locate']) {
      const locateBin = _which(cmd);
      if (!locateBin) continue;
      try {
        const output = execFileSync(locateBin, ['--limit', '500', 'pyvenv.cfg'], {
          timeout: 5000,
          stdio: ['ignore', 'pipe', 'ignore'],
          encoding: 'utf8',
        });
        for (const line of output.split('\n')) {
          const cfgPath = line.trim();
          if (!cfgPath) continue;
          const envPath = path.dirname(cfgPath);
          // Only include envs under home directory
          if (envPath.startsWith(home) && isVenv(envPath)) {
            add(envPath, 'venv', 'locate');
          }
        }
        return; // success — don't try the other command
      } catch {}
    }
  }

  // Windows or no index available: fall back to scanning known locations.
  // The registry scan (_findRegistryEnvs) and project scan cover the common
  // cases. Unusual locations will be missed — the user can pass --environment.
}

/**
 * Read conda's environment registry.
 */
function _findCondaEnvs(add) {
  const envFile = path.join(os.homedir(), '.conda', 'environments.txt');
  try {
    const text = fs.readFileSync(envFile, 'utf8');
    for (const line of text.split('\n')) {
      const envPath = line.trim();
      if (!envPath) continue;
      if (isCondaEnv(envPath)) {
        add(envPath, 'conda', 'conda-registry');
      } else if (isVenv(envPath)) {
        // Some conda envs also have pyvenv.cfg (conda + pip)
        add(envPath, 'venv', 'conda-registry');
      }
    }
  } catch {}
}

/**
 * Check known venv registry directories:
 * virtualenvwrapper, pipenv, pyenv.
 */
function _findRegistryEnvs(add) {
  const home = os.homedir();

  const registries = [
    // virtualenvwrapper
    { dir: process.env.WORKON_HOME || path.join(home, '.virtualenvs'), source: 'virtualenvwrapper' },
    // pipenv
    { dir: path.join(home, '.local', 'share', 'virtualenvs'), source: 'pipenv' },
    // pyenv virtualenvs
    { dir: path.join(home, '.pyenv', 'versions'), source: 'pyenv' },
  ];

  for (const { dir, source } of registries) {
    _scanDirForEnvs(dir, source, add);
  }
}

/**
 * Scan a directory one level deep for Python environments.
 */
function _scanDirForEnvs(dir, source, add) {
  try {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const envPath = path.join(dir, entry.name);
      if (isVenv(envPath)) {
        add(envPath, 'venv', source);
      } else if (isCondaEnv(envPath)) {
        add(envPath, 'conda', source);
      }
    }
  } catch {}
}

/**
 * Scan project root up to 2 levels deep for Python environments.
 * Skips known heavy directories.
 */
function _findProjectEnvs(projectRoot, add) {
  const skip = new Set([
    'node_modules', '.git', '__pycache__', '.tox', 'dist', 'build',
    '.cache', '.eggs', '.mypy_cache', '.pytest_cache', '.ruff_cache',
    '.nox', 'htmlcov', 'coverage', '.coverage', '_assets',
  ]);

  // Level 0: project root itself
  if (isVenv(projectRoot)) {
    add(projectRoot, 'venv', 'project');
    return; // project root IS a venv? weird but handle it
  }

  // Level 1: direct children
  let level1Dirs;
  try {
    level1Dirs = fs.readdirSync(projectRoot, { withFileTypes: true });
  } catch { return; }

  for (const entry of level1Dirs) {
    if (!entry.isDirectory() || entry.name.startsWith('.') && entry.name !== '.venv') continue;
    if (skip.has(entry.name)) continue;

    const childPath = path.join(projectRoot, entry.name);
    if (isVenv(childPath)) {
      add(childPath, 'venv', 'project');
      continue; // don't descend into a venv
    }
    if (isCondaEnv(childPath)) {
      add(childPath, 'conda', 'project');
      continue;
    }

    // Level 2: grandchildren
    try {
      const grandchildren = fs.readdirSync(childPath, { withFileTypes: true });
      for (const gc of grandchildren) {
        if (!gc.isDirectory()) continue;
        if (skip.has(gc.name)) continue;
        const gcPath = path.join(childPath, gc.name);
        if (isVenv(gcPath)) {
          add(gcPath, 'venv', 'project');
        } else if (isCondaEnv(gcPath)) {
          add(gcPath, 'conda', 'project');
        }
      }
    } catch {}
  }
}

/**
 * Walk up from cwd checking for .venv/ and venv/ at each level.
 * Stops at project boundary markers or home directory.
 */
function _findWalkUpEnvs(cwd, add) {
  const home = os.homedir();
  const root = path.parse(cwd).root;
  let dir = cwd;

  while (dir && dir !== root) {
    // Don't go above home
    if (dir.length < home.length && home.startsWith(dir)) break;

    for (const name of ['.venv', 'venv']) {
      const envPath = path.join(dir, name);
      if (isVenv(envPath)) {
        add(envPath, 'venv', 'project');
      }
    }

    // Stop at project boundary
    if (_isProjectBoundary(dir)) break;

    dir = path.dirname(dir);
  }
}

// ── Project root detection (delegates to shared util) ─────

function _isProjectBoundary(dir) {
  return _isProjectBoundaryShared(dir);
}

function _findProjectRoot(startPath) {
  return _findProjectRootShared(startPath);
}

// ── Resolve: find the ONE to use (fast) ───────────────────

/**
 * @typedef {{
 *   interpreter: string,
 *   environment: string|null,
 *   type: 'venv'|'conda'|null,
 *   hasBridge: boolean,
 *   pythonVersion: string|null,
 *   via: string,
 * }} ResolveResult
 */

/**
 * Resolve the Python environment to use for a runtime.
 *
 * Short-circuits on first match — returns in microseconds for the
 * common case (activated venv or .venv in project). Never spawns
 * a subprocess. Never scans the whole machine.
 *
 * Priority:
 *   1. config.environment — explicit, user knows what they want
 *   2. $VIRTUAL_ENV       — user activated a venv, respect it
 *   3. $CONDA_PREFIX      — user activated a conda env, respect it
 *   4. .venv at project root
 *   5. venv at project root
 *   6. Walk up from cwd for .venv / venv
 *   7. null — ambiguous, caller should show findEnvironments() matrix
 *
 * @param {object} config
 * @param {string} config.cwd - Working directory
 * @param {string} [config.environment] - Explicit env path
 * @param {string} [config.projectRoot] - Project root (auto-detected if omitted)
 * @returns {ResolveResult|null}
 */
export function resolveEnvironment(config) {
  const { cwd } = config;

  // 1. Explicit environment
  if (config.environment) {
    return _resolveFromPath(config.environment, 'config');
  }

  // 2. $VIRTUAL_ENV — user activated a venv
  const virtualEnv = process.env.VIRTUAL_ENV;
  if (virtualEnv && isVenv(virtualEnv)) {
    return _resolveFromPath(virtualEnv, 'active-venv');
  }

  // 3. $CONDA_PREFIX — user activated a conda env
  const condaPrefix = process.env.CONDA_PREFIX;
  if (condaPrefix && isCondaEnv(condaPrefix)) {
    return _resolveFromPath(condaPrefix, 'active-conda');
  }

  // 4-5. .venv or venv at project root
  const projectRoot = config.projectRoot || _findProjectRoot(cwd);
  if (projectRoot) {
    for (const name of ['.venv', 'venv']) {
      const envPath = path.join(projectRoot, name);
      if (isVenv(envPath)) {
        return _resolveFromPath(envPath, 'project-venv');
      }
    }
  }

  // 6. Walk up from cwd
  const walkUp = _walkUpForVenv(cwd);
  if (walkUp) {
    return _resolveFromPath(walkUp, 'walk-up');
  }

  // 7. Nothing found — caller should present the matrix
  return null;
}

/**
 * Resolve a Python interpreter for no-venv mode.
 *
 * Used when: the user explicitly wants no environment, or when we
 * need to know which Python to use for creating a new venv.
 *
 * Short-circuits on first match. Checks filesystem paths only
 * (no subprocess) for the fast path. Falls back to a single
 * `which` call if needed.
 *
 * Priority:
 *   1. config.interpreter — explicit
 *   2. Interpreter from a resolved environment
 *   3. python3 / python at known system paths (stat only, no subprocess)
 *   4. python3 / python via PATH (single which call)
 *   5. null — no Python found
 *
 * @param {object} config
 * @param {string} [config.interpreter] - Explicit interpreter path
 * @param {string} [config.environment] - If set, return the env's python
 * @returns {{ path: string, version: string|null, source: string }|null}
 */
export function resolveInterpreter(config = {}) {
  // 1. Explicit interpreter
  if (config.interpreter) {
    if (_isExecutable(config.interpreter)) {
      return { path: config.interpreter, version: _versionFromBinPath(config.interpreter), source: 'config' };
    }
    return null; // explicit path doesn't exist
  }

  // 2. From environment
  if (config.environment) {
    const py = envPython(config.environment);
    if (_isExecutable(py)) {
      const cfg = isVenv(config.environment) ? readPyvenvCfg(config.environment) : null;
      return { path: py, version: cfg?.version || condaEnvPythonVersion(config.environment), source: 'environment' };
    }
  }

  // 3. Known system paths (no subprocess)
  const systemPaths = _systemPythonPaths();
  for (const p of systemPaths) {
    if (_isExecutable(p)) {
      return { path: p, version: _versionFromBinPath(p), source: _interpreterSource(p) };
    }
  }

  // 4. PATH lookup (one subprocess, last resort)
  for (const name of isWin ? ['python', 'python3'] : ['python3', 'python']) {
    const found = _which(name);
    if (found && _isExecutable(found)) {
      return { path: found, version: _versionFromBinPath(found), source: _interpreterSource(found) };
    }
  }

  // 5. Nothing
  return null;
}

// ── Resolve helpers ───────────────────────────────────────

/**
 * Build a ResolveResult from a confirmed environment path.
 * @param {string} envPath
 * @param {string} via
 * @returns {ResolveResult}
 */
function _resolveFromPath(envPath, via) {
  const type = isCondaEnv(envPath) ? 'conda' : isVenv(envPath) ? 'venv' : null;
  const interpreter = envPython(envPath);
  const hasBridge = _exists(envMrmdPython(envPath));

  let pythonVersion = null;
  if (type === 'venv') {
    pythonVersion = readPyvenvCfg(envPath)?.version || null;
  } else if (type === 'conda') {
    pythonVersion = condaEnvPythonVersion(envPath);
  }

  return {
    interpreter,
    environment: envPath,
    type,
    hasBridge,
    pythonVersion,
    via,
  };
}

/**
 * Walk up from a directory looking for .venv or venv.
 * Stops at project boundary or home directory.
 * Returns the first venv path found, or null.
 * @param {string} startDir
 * @returns {string|null}
 */
function _walkUpForVenv(startDir) {
  const home = os.homedir();
  const root = path.parse(startDir).root;
  let dir = startDir;

  try {
    if (!fs.statSync(dir).isDirectory()) {
      dir = path.dirname(dir);
    }
  } catch {
    dir = path.dirname(dir);
  }

  while (dir && dir !== root) {
    if (dir.length < home.length && home.startsWith(dir)) break;

    for (const name of ['.venv', 'venv']) {
      const envPath = path.join(dir, name);
      if (isVenv(envPath)) return envPath;
    }

    if (_isProjectBoundary(dir)) break;
    dir = path.dirname(dir);
  }
  return null;
}

/**
 * Known system Python paths to check via stat (no subprocess).
 * @returns {string[]}
 */
function _systemPythonPaths() {
  const home = os.homedir();

  if (isWin) {
    const localAppData = process.env.LOCALAPPDATA || path.join(home, 'AppData', 'Local');
    return [
      // Common Windows install paths (newest first)
      ...['3.13', '3.12', '3.11', '3.10'].flatMap(v => [
        path.join(localAppData, 'Programs', 'Python', `Python${v.replace('.', '')}`, 'python.exe'),
        `C:\\Python${v.replace('.', '')}\\python.exe`,
      ]),
      // Windows Store
      path.join(localAppData, 'Microsoft', 'WindowsApps', 'python3.exe'),
      path.join(localAppData, 'Microsoft', 'WindowsApps', 'python.exe'),
    ];
  }

  if (isMac) {
    return [
      // Homebrew (Apple Silicon then Intel)
      ...['3.13', '3.12', '3.11', '3.10'].flatMap(v => [
        `/opt/homebrew/bin/python${v}`,
        `/usr/local/bin/python${v}`,
      ]),
      '/opt/homebrew/bin/python3',
      '/usr/local/bin/python3',
      '/usr/bin/python3',
      // uv-managed
      ...['3.13', '3.12', '3.11', '3.10'].map(v =>
        path.join(home, '.local', 'bin', `python${v}`)
      ),
      path.join(home, '.local', 'bin', 'python3'),
    ];
  }

  // Linux
  return [
    // System (newest first)
    ...['3.13', '3.12', '3.11', '3.10'].flatMap(v => [
      `/usr/bin/python${v}`,
      `/usr/local/bin/python${v}`,
    ]),
    '/usr/bin/python3',
    '/usr/local/bin/python3',
    // uv-managed
    ...['3.13', '3.12', '3.11', '3.10'].map(v =>
      path.join(home, '.local', 'bin', `python${v}`)
    ),
    path.join(home, '.local', 'bin', 'python3'),
  ];
}

/**
 * Extract Python version from a binary path (no subprocess).
 * /usr/bin/python3.12 → '3.12'
 * /usr/bin/python3 → '3'
 * @param {string} binPath
 * @returns {string|null}
 */
function _versionFromBinPath(binPath) {
  const basename = path.basename(binPath).replace(/\.exe$/i, '');
  const match = basename.match(/python(\d+(?:\.\d+)*)/);
  return match ? match[1] : null;
}

/**
 * Check if a path exists and is executable.
 * @param {string} p
 * @returns {boolean}
 */
function _isExecutable(p) {
  try {
    fs.accessSync(p, fs.constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

// ── Internal helpers ──────────────────────────────────────

function _exists(p) {
  try {
    fs.accessSync(p);
    return true;
  } catch {
    return false;
  }
}

function _isDir(p) {
  try {
    return fs.statSync(p).isDirectory();
  } catch {
    return false;
  }
}

function _which(cmd) {
  try {
    const result = execFileSync('which', [cmd], {
      timeout: 2000,
      stdio: ['ignore', 'pipe', 'ignore'],
      encoding: 'utf8',
    });
    const found = result.trim();
    return found || null;
  } catch {
    return null;
  }
}
