/**
 * PreferencesService
 *
 * Manages runtime configuration. Persists to <CONFIG_DIR>/preferences.json.
 * Resolution chain: global defaults → project overrides → notebook overrides.
 *
 * All heads see the same preferences via the daemon. When a preference
 * changes, a `prefs:changed` event is broadcast to all connected heads.
 *
 * Fields that can be set at any level:
 *   environment  — path to venv/conda env (null for no-venv mode)
 *   interpreter  — explicit python binary path
 *   scope        — 'notebook' | 'project' | 'global'
 *   cwd          — 'project' | 'document' | '/absolute/path'
 *   env          — { KEY: 'VALUE' } extra environment variables
 *   target       — 'local' | target ID (TODO: ComputeTargets)
 */

import { EventEmitter } from 'events';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { getConfigDir } from '../utils/platform.js';
import { findProjectRoot } from '../utils/project.js';
import {
  resolveEnvironment,
  resolveInterpreter,
  envPython,
  envMrmdPython,
  isVenv,
  isCondaEnv,
  readPyvenvCfg,
  condaEnvPythonVersion,
} from '../utils/python.js';

/** Fields that can be set at any preference level. */
const PREF_FIELDS = ['environment', 'interpreter', 'scope', 'cwd', 'env', 'target'];

/**
 * Short hash for runtime name generation.
 * @param {string} s
 * @returns {string} 6-char hex
 */
function shortHash(s) {
  return crypto.createHash('md5').update(s).digest('hex').slice(0, 6);
}

export class PreferencesService extends EventEmitter {
  constructor() {
    super();
    this._configPath = path.join(getConfigDir(), 'preferences.json');
    this._prefs = null; // lazy load
  }

  // ── Raw read/write ──────────────────────────────────────

  /**
   * Get the raw preferences object, optionally filtered to a project.
   *
   * @param {object} [opts]
   * @param {string} [opts.projectRoot] - Return only this project's overrides
   * @returns {object}
   */
  get(opts = {}) {
    const prefs = this._load();

    if (opts.projectRoot) {
      return {
        defaults: prefs.defaults,
        project: prefs.projects?.[opts.projectRoot] || {},
        notebooks: this._notebooksForProject(prefs, opts.projectRoot),
      };
    }

    return prefs;
  }

  /**
   * Set a global default for a language.
   *
   * @param {string} language
   * @param {object} patch - Fields to set (environment, interpreter, scope, etc.)
   */
  setDefault(language, patch) {
    const prefs = this._load();
    if (!prefs.defaults) prefs.defaults = {};
    if (!prefs.defaults[language]) prefs.defaults[language] = {};

    this._applyPatch(prefs.defaults[language], patch);
    this._save(prefs);

    this.emit('prefs:changed', {
      level: 'defaults',
      projectRoot: null,
      documentPath: null,
      language,
      patch,
    });
  }

  /**
   * Set a project-level override for a language.
   *
   * @param {string} projectRoot - Absolute path to project root
   * @param {string} language
   * @param {object} patch - Fields to set
   */
  setProjectOverride(projectRoot, language, patch) {
    const prefs = this._load();
    if (!prefs.projects) prefs.projects = {};
    if (!prefs.projects[projectRoot]) prefs.projects[projectRoot] = {};
    if (!prefs.projects[projectRoot][language]) prefs.projects[projectRoot][language] = {};

    this._applyPatch(prefs.projects[projectRoot][language], patch);
    this._save(prefs);

    this.emit('prefs:changed', {
      level: 'project',
      projectRoot,
      documentPath: null,
      language,
      patch,
    });
  }

  /**
   * Set a notebook-level override for a language.
   *
   * @param {string} documentPath - Absolute path to the .md file
   * @param {string} language
   * @param {object} patch - Fields to set
   */
  setNotebookOverride(documentPath, language, patch) {
    const prefs = this._load();
    if (!prefs.notebooks) prefs.notebooks = {};
    if (!prefs.notebooks[documentPath]) prefs.notebooks[documentPath] = {};
    if (!prefs.notebooks[documentPath][language]) prefs.notebooks[documentPath][language] = {};

    this._applyPatch(prefs.notebooks[documentPath][language], patch);
    this._save(prefs);

    const projectRoot = findProjectRoot(documentPath);

    this.emit('prefs:changed', {
      level: 'notebook',
      projectRoot,
      documentPath,
      language,
      patch,
    });
  }

  /**
   * Clear notebook-level overrides. Falls back to project/global defaults.
   *
   * @param {string} documentPath
   * @param {string} language
   */
  clearNotebookOverride(documentPath, language) {
    const prefs = this._load();
    if (prefs.notebooks?.[documentPath]) {
      delete prefs.notebooks[documentPath][language];
      // Clean up empty objects
      if (Object.keys(prefs.notebooks[documentPath]).length === 0) {
        delete prefs.notebooks[documentPath];
      }
      this._save(prefs);
    }

    const projectRoot = findProjectRoot(documentPath);

    this.emit('prefs:changed', {
      level: 'notebook',
      projectRoot,
      documentPath,
      language,
      patch: null, // cleared
    });
  }

  // ── Resolution ──────────────────────────────────────────

  /**
   * Resolve the effective runtime config for a document + language.
   *
   * Merges: global defaults ← project overrides ← notebook overrides.
   * Auto-discovers environment/interpreter for fields not set in any level.
   *
   * @param {string} documentPath - Absolute path to the .md file
   * @param {string} language
   * @returns {ResolvedConfig}
   */
  resolve(documentPath, language) {
    const prefs = this._load();

    // Find project root
    const projectRoot = findProjectRoot(documentPath) || path.dirname(documentPath);

    // Merge preference levels (later levels override earlier)
    const merged = {};
    const defaults = prefs.defaults?.[language] || {};
    const projectOverrides = prefs.projects?.[projectRoot]?.[language] || {};
    const notebookOverrides = prefs.notebooks?.[documentPath]?.[language] || {};

    for (const field of PREF_FIELDS) {
      merged[field] = notebookOverrides[field] ?? projectOverrides[field] ?? defaults[field] ?? undefined;
    }

    // Resolve scope (default: notebook)
    const scope = merged.scope || 'notebook';

    // Resolve target (default: local)
    // TODO: ComputeTargets — when target is non-local, skip local auto-discovery
    // and instead query the remote daemon for its environments/interpreters.
    const target = merged.target || 'local';

    // Resolve environment + interpreter via auto-discovery if not set
    let environment = merged.environment || null;
    let interpreter = merged.interpreter || null;
    let via = 'config';
    let hasBridge = false;

    if (target === 'local') {
      // Auto-discover environment if not explicitly set
      if (!environment && !interpreter) {
        const autoEnv = resolveEnvironment({
          cwd: projectRoot,
          projectRoot,
        });
        if (autoEnv) {
          environment = autoEnv.environment;
          interpreter = autoEnv.interpreter;
          via = autoEnv.via;
          hasBridge = autoEnv.hasBridge;
        }
      }

      // If we have an environment but no interpreter, derive it
      if (environment && !interpreter) {
        interpreter = envPython(environment);
        via = via === 'config' ? 'config' : via;
      }

      // If we have neither, try bare interpreter
      if (!environment && !interpreter) {
        const autoInterp = resolveInterpreter({});
        if (autoInterp) {
          interpreter = autoInterp.path;
          via = autoInterp.source;
        }
      }

      // Check bridge status
      if (environment) {
        hasBridge = _fileExists(envMrmdPython(environment));
      }

      // Get python version for context
    } else {
      // TODO: ComputeTargets — remote environment resolution
      // For now, trust explicit environment/interpreter from preferences.
      via = 'config';
      if (environment) {
        hasBridge = _fileExists(envMrmdPython(environment));
      }
    }

    // Resolve cwd
    let cwd;
    if (merged.cwd && merged.cwd !== 'project' && merged.cwd !== 'document') {
      cwd = merged.cwd; // absolute path
    } else if (merged.cwd === 'document') {
      cwd = path.dirname(documentPath);
    } else {
      cwd = projectRoot; // default: project root
    }

    // Resolve env vars
    const env = merged.env || {};

    // Generate runtime name
    const name = this._runtimeName({ scope, projectRoot, documentPath, language, environment, interpreter, target });

    return {
      // Fields for RuntimeService.start()
      name,
      language,
      cwd,
      environment,
      interpreter,
      env,
      target,         // TODO: ComputeTargets — RuntimeService checks this field

      // Context
      scope,
      projectRoot,
      documentPath,
      via,
      hasBridge,
    };
  }

  // ── Runtime naming ──────────────────────────────────────

  /**
   * Generate a deterministic runtime name from resolved config.
   *
   * Two documents that resolve to the same name share the same process.
   * The name includes target so local/remote never collide.
   *
   * @param {object} opts
   * @returns {string}
   * @private
   */
  _runtimeName({ scope, projectRoot, documentPath, language, environment, interpreter, target }) {
    const projId = shortHash(projectRoot || 'unknown');
    const envId = shortHash(environment || interpreter || 'system');
    const targetId = shortHash(target || 'local');

    switch (scope) {
      case 'global':
        return `rt:global:${language}:${envId}:${targetId}`;
      case 'project':
        return `rt:project:${projId}:${language}:${envId}:${targetId}`;
      case 'notebook':
      default: {
        const docId = shortHash(documentPath || 'unknown');
        return `rt:notebook:${projId}:${docId}:${language}:${envId}:${targetId}`;
      }
    }
  }

  // ── Internal ────────────────────────────────────────────

  /**
   * Load preferences from disk. Creates default file if missing.
   * Caches in memory — re-reads on every call to pick up external changes.
   * @returns {object}
   * @private
   */
  _load() {
    try {
      const text = fs.readFileSync(this._configPath, 'utf8');
      this._prefs = JSON.parse(text);
    } catch {
      this._prefs = { defaults: {}, projects: {}, notebooks: {} };
    }
    return this._prefs;
  }

  /**
   * Write preferences to disk. Creates config directory if needed.
   * @param {object} prefs
   * @private
   */
  _save(prefs) {
    this._prefs = prefs;
    const dir = path.dirname(this._configPath);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(this._configPath, JSON.stringify(prefs, null, 2) + '\n', 'utf8');
  }

  /**
   * Apply a patch to a preferences object, only setting known fields.
   * @param {object} target
   * @param {object} patch
   * @private
   */
  _applyPatch(target, patch) {
    for (const field of PREF_FIELDS) {
      if (patch[field] !== undefined) {
        if (patch[field] === null) {
          delete target[field];
        } else {
          target[field] = patch[field];
        }
      }
    }
  }

  /**
   * Collect notebook overrides that belong to a project.
   * @param {object} prefs
   * @param {string} projectRoot
   * @returns {object}
   * @private
   */
  _notebooksForProject(prefs, projectRoot) {
    const result = {};
    for (const [docPath, overrides] of Object.entries(prefs.notebooks || {})) {
      if (docPath.startsWith(projectRoot + path.sep) || docPath.startsWith(projectRoot + '/')) {
        result[docPath] = overrides;
      }
    }
    return result;
  }
}

function _fileExists(p) {
  try {
    fs.accessSync(p);
    return true;
  } catch {
    return false;
  }
}
