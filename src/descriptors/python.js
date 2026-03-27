/**
 * Python language descriptor.
 *
 * Supports two spawn modes:
 *   1. Entry point: {env}/bin/mrmd-python --port PORT ...
 *   2. Module:      {interpreter} -m mrmd_python.cli --port PORT ...
 *
 * The entry point mode is preferred (explicit venv). Module mode is
 * the fallback for no-venv users or when mrmd-python is pip-installed
 * globally.
 *
 * findBinary does NOT install mrmd-python. If the bridge is missing,
 * it returns null. The head should call ensureBridge() after getting
 * user confirmation, then retry findBinary.
 */

import fs from 'fs';
import path from 'path';
import { execFileSync } from 'child_process';
import {
  isVenv,
  isCondaEnv,
  envPython,
  envMrmdPython,
  readPyvenvCfg,
  condaEnvPythonVersion,
  findUv,
  venvBinDir,
} from '../utils/python.js';
import { isWin } from '../utils/platform.js';

/**
 * Minimum Python version for mrmd-python.
 */
const MIN_PYTHON_VERSION = '3.10';

export default {
  name: 'python',
  startupTimeout: 15000,

  /**
   * Locate how to spawn mrmd-python.
   *
   * Uses config.environment and config.interpreter from the preferences
   * resolve chain. Does NOT install mrmd-python — returns null if the
   * bridge is missing. Call ensureBridge() first if check() reports it.
   *
   * @param {object} config - ResolvedConfig from preferences
   * @param {string} config.cwd
   * @param {string} [config.environment] - Path to venv/conda env
   * @param {string} [config.interpreter] - Path to python binary
   * @returns {{ command: string, commandArgs: string[], interpreter: string, environment: string|null, via: string, spawnEnv: object }|null}
   */
  findBinary(config) {
    const { environment, interpreter } = config;

    // Mode 1: We have an environment — look for mrmd-python entry point
    if (environment) {
      const bridgeBin = envMrmdPython(environment);
      const pythonBin = envPython(environment);

      if (_isExecutable(bridgeBin)) {
        return {
          command: bridgeBin,
          commandArgs: [],
          interpreter: pythonBin,
          environment,
          via: 'env-entrypoint',
          spawnEnv: _envVarsForEnv(environment),
        };
      }

      // Bridge not installed — check if we can fall back to module mode
      if (_isExecutable(pythonBin) && _hasMrmdPythonModule(pythonBin)) {
        return {
          command: pythonBin,
          commandArgs: ['-m', 'mrmd_python.cli'],
          interpreter: pythonBin,
          environment,
          via: 'env-module',
          spawnEnv: _envVarsForEnv(environment),
        };
      }

      // Bridge not installed and module not importable
      return null;
    }

    // Mode 2: No environment — bare interpreter (no-venv mode)
    if (interpreter) {
      if (!_isExecutable(interpreter)) return null;

      // Check if mrmd-python is importable by this interpreter
      if (_hasMrmdPythonModule(interpreter)) {
        return {
          command: interpreter,
          commandArgs: ['-m', 'mrmd_python.cli'],
          interpreter,
          environment: null,
          via: 'interpreter-module',
          spawnEnv: {},
        };
      }

      // mrmd-python not available for this interpreter
      return null;
    }

    // Nothing to work with
    return null;
  },

  /**
   * Build spawn arguments for the Python runtime.
   * Appended to findBinary().commandArgs.
   *
   * @param {number} port
   * @param {object} config
   * @returns {string[]}
   */
  buildArgs(port, config) {
    const args = [
      '--port', String(port),
      '--host', '127.0.0.1',
      '--cwd', config.cwd,
      '--foreground',
      '--managed',
    ];

    if (config.name) {
      args.push('--id', config.name);
    }

    // Pass --venv so mrmd-python doesn't auto-detect
    if (config.environment) {
      args.push('--venv', config.environment);
    }

    return args;
  },

  /**
   * Check if Python runtime is available for a config.
   * Returns structured result with problems and fix hints.
   *
   * @param {object} config
   * @returns {Promise<CheckResult>}
   */
  async check(config) {
    const problems = [];
    const { environment, interpreter } = config;

    // Check environment
    if (environment) {
      if (!fs.existsSync(environment)) {
        return {
          ok: false,
          interpreter: null,
          environment: null,
          problems: [{
            message: `Environment does not exist: ${environment}`,
            action: 'create-env',
            fix: `uv venv ${environment}`,
          }],
        };
      }

      const pythonBin = envPython(environment);
      if (!_isExecutable(pythonBin)) {
        return {
          ok: false,
          interpreter: null,
          environment: { path: environment, hasBridge: false },
          problems: [{
            message: `Python not found in environment: ${pythonBin}`,
            action: 'broken-env',
            fix: `Recreate the environment: rm -rf ${environment} && uv venv ${environment}`,
          }],
        };
      }

      // Check Python version
      const version = _pythonVersionForEnv(environment);
      if (version && !_versionAtLeast(version, MIN_PYTHON_VERSION)) {
        problems.push({
          message: `Python ${version} in ${environment} is below minimum ${MIN_PYTHON_VERSION}`,
          action: 'python-too-old',
          fix: `Create a new venv with a newer Python: uv venv --python 3.12 ${environment}`,
        });
      }

      // Check bridge
      const hasBridge = _isExecutable(envMrmdPython(environment));
      if (!hasBridge) {
        problems.push({
          message: `mrmd-python not installed in ${environment}`,
          action: 'install-bridge',
          fix: _bridgeInstallCommand(environment),
        });
      }

      if (problems.length > 0) {
        return {
          ok: false,
          interpreter: { path: pythonBin, version },
          environment: { path: environment, hasBridge },
          problems,
        };
      }

      return {
        ok: true,
        interpreter: { path: pythonBin, version },
        environment: { path: environment, hasBridge: true },
        problems: [],
      };
    }

    // No environment — check bare interpreter
    if (interpreter) {
      if (!_isExecutable(interpreter)) {
        return {
          ok: false,
          interpreter: null,
          environment: null,
          problems: [{
            message: `Interpreter not found: ${interpreter}`,
            action: 'no-interpreter',
            fix: 'Install Python: uv python install 3.12',
          }],
        };
      }

      const hasModule = _hasMrmdPythonModule(interpreter);
      if (!hasModule) {
        problems.push({
          message: `mrmd-python not importable by ${interpreter}`,
          action: 'install-bridge',
          fix: `${interpreter} -m pip install mrmd-python`,
        });
      }

      return {
        ok: problems.length === 0,
        interpreter: { path: interpreter, version: null },
        environment: null,
        problems,
      };
    }

    // Nothing configured
    return {
      ok: false,
      interpreter: null,
      environment: null,
      problems: [{
        message: 'No Python environment or interpreter configured',
        action: 'no-python',
        fix: 'Create a venv: uv venv',
      }],
    };
  },

  /**
   * Install mrmd-python into an environment or for an interpreter.
   *
   * Heads should call this after getting user confirmation.
   * NOT called by findBinary — the head decides when to install.
   *
   * @param {object} opts
   * @param {string} [opts.environment] - Venv/conda env path
   * @param {string} [opts.interpreter] - Bare interpreter (no-venv mode)
   * @returns {Promise<{ installed: boolean, version: string|null, method: string|null, error: string|null }>}
   */
  async ensureBridge(opts = {}) {
    const { environment, interpreter } = opts;

    if (environment) {
      return _installBridgeInEnv(environment);
    }

    if (interpreter) {
      return _installBridgeForInterpreter(interpreter);
    }

    return { installed: false, version: null, method: null, error: 'No environment or interpreter specified' };
  },

  /**
   * Provision a Python environment for a project.
   * Creates a venv and installs mrmd-python.
   *
   * @param {string} projectRoot
   * @param {object} [opts]
   * @param {string} [opts.pythonVersion] - e.g. '3.12'
   * @returns {Promise<ProvisionResult>}
   */
  async provision(projectRoot, opts = {}) {
    const actions = [];
    const envPath = path.join(projectRoot, '.venv');

    if (isVenv(envPath)) {
      actions.push(`Using existing .venv at ${envPath}`);
    } else {
      // Create venv
      const uv = findUv();
      if (uv) {
        const venvArgs = ['venv', envPath];
        if (opts.pythonVersion) venvArgs.push('--python', opts.pythonVersion);
        try {
          execFileSync(uv, venvArgs, { cwd: projectRoot, timeout: 30000, stdio: 'pipe' });
          actions.push(`Created .venv with ${opts.pythonVersion || 'default Python'}`);
        } catch (err) {
          throw new Error(`Failed to create venv: ${err.message}`);
        }
      } else {
        throw new Error('uv not found. Install uv to create Python environments.');
      }
    }

    // Install bridge
    const bridgeResult = await _installBridgeInEnv(envPath);
    if (bridgeResult.installed) {
      actions.push(`Installed mrmd-python ${bridgeResult.version || ''}`);
    } else if (bridgeResult.error) {
      actions.push(`Warning: failed to install mrmd-python: ${bridgeResult.error}`);
    }

    return {
      interpreter: envPython(envPath),
      environment: envPath,
      bridgeVersion: bridgeResult.version,
      actions,
    };
  },
};

// ── Internal helpers ──────────────────────────────────────

/**
 * Check if a path exists and is executable.
 */
function _isExecutable(p) {
  try {
    fs.accessSync(p, fs.constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

/**
 * Check if mrmd_python is importable by an interpreter.
 * Quick check: stat the module directory in site-packages.
 * Falls back to running the interpreter if site-packages is ambiguous.
 */
function _hasMrmdPythonModule(interpreterPath) {
  // Fast path: check if mrmd_python exists in the interpreter's site-packages
  // by looking at the directory structure (no subprocess)
  const binDir = path.dirname(interpreterPath);
  const envDir = path.dirname(binDir);

  // Venv/conda layout: {env}/lib/python3.X/site-packages/mrmd_python/
  try {
    const libDir = path.join(envDir, 'lib');
    if (fs.existsSync(libDir)) {
      const entries = fs.readdirSync(libDir);
      for (const entry of entries) {
        if (entry.startsWith('python')) {
          const spDir = path.join(libDir, entry, 'site-packages', 'mrmd_python');
          if (fs.existsSync(spDir)) return true;
        }
      }
    }
  } catch {}

  // User site-packages: ~/.local/lib/python3.X/site-packages/mrmd_python/
  try {
    const home = require('os').homedir();
    const localLib = path.join(home, '.local', 'lib');
    if (fs.existsSync(localLib)) {
      const entries = fs.readdirSync(localLib);
      for (const entry of entries) {
        if (entry.startsWith('python')) {
          const spDir = path.join(localLib, entry, 'site-packages', 'mrmd_python');
          if (fs.existsSync(spDir)) return true;
        }
      }
    }
  } catch {}

  return false;
}

/**
 * Build environment variables for spawning inside an env.
 */
function _envVarsForEnv(envPath) {
  const binDir = path.join(envPath, venvBinDir());
  const vars = {};

  if (isVenv(envPath)) {
    vars.VIRTUAL_ENV = envPath;
  } else if (isCondaEnv(envPath)) {
    vars.CONDA_PREFIX = envPath;
  }

  // Prepend env bin to PATH so subprocesses find the right binaries
  const sep = isWin ? ';' : ':';
  vars.PATH = binDir + sep + (process.env.PATH || '');

  return vars;
}

/**
 * Get Python version for an environment without subprocess.
 */
function _pythonVersionForEnv(envPath) {
  if (isVenv(envPath)) {
    return readPyvenvCfg(envPath)?.version || null;
  }
  if (isCondaEnv(envPath)) {
    return condaEnvPythonVersion(envPath);
  }
  return null;
}

/**
 * Check if a version string is >= a minimum.
 * Compares major.minor only.
 */
function _versionAtLeast(version, minimum) {
  const parse = (v) => {
    const parts = v.split('.').map(Number);
    return { major: parts[0] || 0, minor: parts[1] || 0 };
  };
  const v = parse(version);
  const m = parse(minimum);
  if (v.major !== m.major) return v.major > m.major;
  return v.minor >= m.minor;
}

/**
 * Build the command to install mrmd-python into an env.
 */
function _bridgeInstallCommand(envPath) {
  const uv = findUv();
  if (uv) {
    const python = envPython(envPath);
    return `uv pip install --python ${python} mrmd-python`;
  }
  const pip = path.join(envPath, venvBinDir(), isWin ? 'pip.exe' : 'pip');
  return `${pip} install mrmd-python`;
}

/**
 * Install mrmd-python into a venv/conda env.
 */
async function _installBridgeInEnv(envPath) {
  const python = envPython(envPath);

  // Prefer uv
  const uv = findUv();
  if (uv) {
    try {
      execFileSync(uv, ['pip', 'install', '--python', python, 'mrmd-python'], {
        timeout: 60000,
        stdio: 'pipe',
      });
      const version = _getBridgeVersion(envPath);
      return { installed: true, version, method: 'uv-pip', error: null };
    } catch (err) {
      return { installed: false, version: null, method: 'uv-pip', error: err.message };
    }
  }

  // Fallback: pip
  const pip = path.join(envPath, venvBinDir(), isWin ? 'pip.exe' : 'pip');
  if (_isExecutable(pip)) {
    try {
      execFileSync(pip, ['install', 'mrmd-python'], {
        timeout: 60000,
        stdio: 'pipe',
      });
      const version = _getBridgeVersion(envPath);
      return { installed: true, version, method: 'pip', error: null };
    } catch (err) {
      return { installed: false, version: null, method: 'pip', error: err.message };
    }
  }

  return { installed: false, version: null, method: null, error: 'Neither uv nor pip found' };
}

/**
 * Install mrmd-python for a bare interpreter (no-venv mode).
 */
async function _installBridgeForInterpreter(interpreterPath) {
  const uv = findUv();

  if (uv) {
    try {
      execFileSync(uv, ['pip', 'install', '--python', interpreterPath, 'mrmd-python'], {
        timeout: 60000,
        stdio: 'pipe',
      });
      return { installed: true, version: null, method: 'uv-pip', error: null };
    } catch (err) {
      return { installed: false, version: null, method: 'uv-pip', error: err.message };
    }
  }

  // Fallback: interpreter -m pip
  try {
    execFileSync(interpreterPath, ['-m', 'pip', 'install', '--user', 'mrmd-python'], {
      timeout: 60000,
      stdio: 'pipe',
    });
    return { installed: true, version: null, method: 'pip-user', error: null };
  } catch (err) {
    return { installed: false, version: null, method: 'pip-user', error: err.message };
  }
}

/**
 * Get installed mrmd-python version from an environment.
 */
function _getBridgeVersion(envPath) {
  try {
    // Check dist-info directory name
    const libDir = path.join(envPath, 'lib');
    const entries = fs.readdirSync(libDir);
    for (const pyDir of entries) {
      if (!pyDir.startsWith('python')) continue;
      const spDir = path.join(libDir, pyDir, 'site-packages');
      try {
        const spEntries = fs.readdirSync(spDir);
        for (const entry of spEntries) {
          const match = entry.match(/^mrmd_python-(\d+\.\d+\.\d+)/);
          if (match) return match[1];
        }
      } catch {}
    }
  } catch {}
  return null;
}
