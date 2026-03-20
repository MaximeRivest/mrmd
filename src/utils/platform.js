import os from 'os';
import path from 'path';
import fs from 'fs';

export const isWin = process.platform === 'win32';
export const isMac = process.platform === 'darwin';

/**
 * Platform-aware config directory.
 */
export function getConfigDir() {
  if (isWin) return process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming', 'mrmd');
  if (isMac) return path.join(os.homedir(), 'Library', 'Application Support', 'mrmd');
  return path.join(process.env.XDG_CONFIG_HOME || path.join(os.homedir(), '.config'), 'mrmd');
}

/**
 * Platform-aware data directory (runtimes registry, logs, etc.).
 */
export function getDataDir() {
  return path.join(os.homedir(), '.mrmd');
}

/**
 * Path to the daemon socket.
 */
export function getSocketPath() {
  if (isWin) {
    return '\\\\.\\pipe\\mrmd-daemon';
  }
  return path.join(os.tmpdir(), `mrmd-daemon-${os.userInfo().uid}.sock`);
}

/**
 * Path to daemon PID file.
 */
export function getPidPath() {
  return path.join(getDataDir(), 'daemon.pid');
}

/**
 * Check if a process is alive.
 * @param {number} pid
 * @returns {boolean}
 */
export function isProcessAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

/**
 * Kill a process tree.
 * @param {number} pid
 * @param {string} [signal='SIGTERM']
 */
export async function killProcessTree(pid, signal = 'SIGTERM') {
  try {
    process.kill(-pid, signal);
  } catch {
    try {
      process.kill(pid, signal);
    } catch {
      // already dead
    }
  }
}

/**
 * Resolve sibling package binary path.
 * Looks for ../mrmd-{name}/bin/mrmd-{name} relative to this package.
 */
export function findSiblingBinary(name) {
  const pkgDir = path.resolve(new URL('..', import.meta.url).pathname, '..', '..');
  
  // Platform-specific binary name
  const platform = process.platform === 'darwin' ? 'darwin' : 'linux';
  const arch = process.arch === 'arm64' ? 'arm64' : 'amd64';
  
  const candidates = [
    // Development: sibling directory with prebuilt binary
    path.join(pkgDir, `mrmd-${name}`, 'bin', `mrmd-${name}-${platform}-${arch}`),
    path.join(pkgDir, `mrmd-${name}`, 'bin', `mrmd-${name}`),
    // TODO: packaged/bundled paths
  ];

  for (const p of candidates) {
    if (fs.existsSync(p)) return p;
  }
  return null;
}
