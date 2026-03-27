/**
 * Shell environment capture.
 *
 * Spawns the user's login shell to capture the full interactive
 * environment (PATH, API keys, LD_LIBRARY_PATH, conda hooks, etc.).
 *
 * Without this, daemon-spawned runtimes only inherit the daemon's
 * own process.env, which misses everything set in .bashrc/.zshrc/.profile.
 *
 * Also provides .env file loading for project-specific overrides.
 */

import { execFileSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import os from 'os';

/**
 * Capture the user's interactive login shell environment.
 *
 * Runs the user's default shell with login + interactive flags
 * and reads back env vars via `env -0` (null-delimited).
 *
 * Falls back gracefully to process.env if the shell can't be run
 * (headless CI, broken shell config, etc.).
 *
 * @param {object} [opts]
 * @param {number} [opts.timeout=5000] - Max time to wait for shell
 * @returns {Record<string, string>}
 */
export function captureShellEnv(opts = {}) {
  const timeout = opts.timeout ?? 5000;
  const shell = _userShell();

  if (!shell) {
    console.log('[shell-env] No login shell detected, using process.env');
    return { ...process.env };
  }

  const shellName = path.basename(shell);

  // Build the command for each shell type.
  // -l  = login shell (sources .profile, .bash_profile, etc.)
  // -i  = interactive (sources .bashrc, .zshrc, etc.)
  // -c  = run command
  // env -0 = print env null-delimited (safe parsing of multi-line values)
  let args;
  if (shellName === 'fish') {
    // fish doesn't support -i -c together the same way
    args = ['-l', '-c', 'env -0'];
  } else {
    // bash, zsh, sh, etc.
    args = ['-li', '-c', 'env -0'];
  }

  try {
    const stdout = execFileSync(shell, args, {
      timeout,
      encoding: 'buffer',
      stdio: ['ignore', 'pipe', 'ignore'],
      env: {
        ...process.env,
        // Prevent shell from trying to read from a terminal
        // (there is none when spawned detached)
        BASH_SILENCE_DEPRECATION_WARNING: '1',
      },
    });

    const env = _parseNullDelimitedEnv(stdout);

    if (Object.keys(env).length < 5) {
      // Suspiciously few vars — shell might have failed silently
      console.log(`[shell-env] Shell returned only ${Object.keys(env).length} vars, falling back to process.env`);
      return { ...process.env };
    }

    console.log(`[shell-env] Captured ${Object.keys(env).length} vars from ${shellName}`);
    return env;
  } catch (err) {
    // Common failures:
    // - Shell config has syntax error → exit code != 0
    // - Timeout → .bashrc does something slow (conda init, nvm, etc.)
    // - No env -0 support (very old systems)
    console.log(`[shell-env] Failed to capture from ${shellName}: ${err.message}. Using process.env`);
    return { ...process.env };
  }
}

/**
 * Load environment variables from .env files in a directory.
 *
 * Reads `.env` from the given directory (typically project root).
 * Supports KEY=VALUE, KEY="VALUE", KEY='VALUE', comments (#), and
 * blank lines. Does NOT do variable expansion.
 *
 * @param {string} dir - Directory to look for .env file
 * @returns {Record<string, string>} Parsed variables (empty object if no file)
 */
export function loadDotEnv(dir) {
  const envPath = path.join(dir, '.env');

  try {
    const content = fs.readFileSync(envPath, 'utf8');
    return parseDotEnv(content);
  } catch {
    return {};
  }
}

/**
 * Parse .env file content.
 *
 * @param {string} content
 * @returns {Record<string, string>}
 */
export function parseDotEnv(content) {
  const env = {};

  for (const rawLine of content.split('\n')) {
    const line = rawLine.trim();

    // Skip blanks and comments
    if (!line || line.startsWith('#')) continue;

    // Skip export prefix
    const stripped = line.startsWith('export ') ? line.slice(7).trim() : line;

    const eqIdx = stripped.indexOf('=');
    if (eqIdx === -1) continue;

    const key = stripped.slice(0, eqIdx).trim();
    let value = stripped.slice(eqIdx + 1).trim();

    // Strip surrounding quotes
    if ((value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }

    if (key) {
      env[key] = value;
    }
  }

  return env;
}

// ── Internal ──────────────────────────────────────────────────

/**
 * Detect the user's login shell.
 * @returns {string|null}
 */
function _userShell() {
  // SHELL env var is the standard way on Unix
  if (process.env.SHELL) return process.env.SHELL;

  // Fallback: read from /etc/passwd (Linux)
  try {
    const uid = os.userInfo().uid;
    const passwd = fs.readFileSync('/etc/passwd', 'utf8');
    for (const line of passwd.split('\n')) {
      const parts = line.split(':');
      if (parts.length >= 7 && parseInt(parts[2], 10) === uid) {
        return parts[6];
      }
    }
  } catch {}

  // Last resort
  if (fs.existsSync('/bin/bash')) return '/bin/bash';
  if (fs.existsSync('/bin/sh')) return '/bin/sh';

  return null;
}

/**
 * Parse null-delimited env output from `env -0`.
 * @param {Buffer} buf
 * @returns {Record<string, string>}
 */
function _parseNullDelimitedEnv(buf) {
  const env = {};
  const str = buf.toString('utf8');
  const entries = str.split('\0');

  for (const entry of entries) {
    if (!entry) continue;
    const eqIdx = entry.indexOf('=');
    if (eqIdx === -1) continue;
    const key = entry.slice(0, eqIdx);
    const value = entry.slice(eqIdx + 1);
    env[key] = value;
  }

  return env;
}
