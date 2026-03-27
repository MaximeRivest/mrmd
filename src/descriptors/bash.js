/**
 * Bash language descriptor.
 *
 * Binary:     prebuilt Go binary from ../mrmd-bash/bin/
 * Args:       --port PORT --cwd CWD
 * Environment: none
 * Provision:  nothing (binary is bundled)
 *
 * TODO: Distribution — currently only finds the binary via sibling
 * directory layout (development monorepo). For production, needs:
 *   1. Bundled: {mrmd package}/vendor/mrmd-bash-{platform}-{arch}
 *   2. PATH:    which mrmd-bash
 *   3. Download on first use (like uv downloads Python toolchains)
 * Also needs ensureBridge() to download if missing.
 */

import fs from 'fs';
import { findSiblingBinary } from '../utils/platform.js';

export default {
  name: 'bash',
  startupTimeout: 10000,

  /**
   * Locate the mrmd-bash binary.
   *
   * @param {object} config
   * @returns {{ command: string, commandArgs: string[], interpreter: string, environment: string|null, via: string, spawnEnv: object }|null}
   */
  findBinary(config) {
    const binary = findSiblingBinary('bash');
    if (!binary) return null;
    return {
      command: binary,
      commandArgs: [],
      interpreter: binary,
      environment: null,
      via: 'sibling',
      spawnEnv: {},
    };
  },

  /**
   * Build spawn arguments for the bash runtime.
   * @param {number} port
   * @param {object} config
   * @returns {string[]}
   */
  buildArgs(port, config) {
    return ['--port', String(port), '--cwd', config.cwd];
  },

  /**
   * Check if bash runtime is available.
   * @param {object} config
   * @param {string} config.cwd
   * @returns {Promise<CheckResult>}
   */
  async check(config) {
    const binary = findSiblingBinary('bash');

    if (!binary) {
      return {
        ok: false,
        interpreter: null,
        environment: null,
        problems: [{
          message: 'mrmd-bash binary not found',
          fix: 'Build mrmd-bash or check that the mrmd-bash sibling package exists',
        }],
      };
    }

    // Verify it's executable
    try {
      fs.accessSync(binary, fs.constants.X_OK);
    } catch {
      return {
        ok: false,
        interpreter: { path: binary, version: null },
        environment: null,
        problems: [{
          message: `mrmd-bash binary exists but is not executable: ${binary}`,
          fix: `chmod +x ${binary}`,
        }],
      };
    }

    return {
      ok: true,
      interpreter: { path: binary, version: null },
      environment: null,
      problems: [],
    };
  },

  /**
   * Provision bash for a project. No-op — the binary is bundled.
   * @param {string} projectRoot
   * @returns {Promise<ProvisionResult>}
   */
  async provision(projectRoot) {
    const binary = findSiblingBinary('bash');
    return {
      interpreter: binary,
      environment: null,
      bridgeVersion: null,
      actions: [],
    };
  },
};
