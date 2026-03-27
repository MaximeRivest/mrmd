/**
 * Project root detection.
 *
 * Shared by preferences, python discovery, and other modules
 * that need to locate the project a file belongs to.
 */

import path from 'path';
import fs from 'fs';
import os from 'os';

const PROJECT_MARKERS = [
  '.git',
  // Python
  'pyproject.toml', 'setup.py', 'setup.cfg', 'Pipfile',
  // Julia
  'Project.toml', 'JuliaProject.toml',
  // R
  'DESCRIPTION', '.Rproj',
  // Editors / IDEs
  '.vscode', '.idea', '.project',
];

/**
 * Check if a directory is a project boundary.
 * @param {string} dir
 * @returns {boolean}
 */
export function isProjectBoundary(dir) {
  for (const marker of PROJECT_MARKERS) {
    try {
      fs.accessSync(path.join(dir, marker));
      return true;
    } catch { }
  }
  return false;
}

/**
 * Find the project root by walking up from a starting path.
 * Stops at the first directory containing a project marker.
 * Never walks above the home directory.
 *
 * @param {string} startPath - File or directory to start from
 * @returns {string|null} Project root, or null if not found
 */
export function findProjectRoot(startPath) {
  const home = os.homedir();
  const root = path.parse(startPath).root;
  let dir = startPath;

  try {
    if (!fs.statSync(dir).isDirectory()) {
      dir = path.dirname(dir);
    }
  } catch {
    dir = path.dirname(dir);
  }

  while (dir && dir !== root) {
    // Don't go above home
    if (dir.length < home.length && home.startsWith(dir)) return null;
    if (isProjectBoundary(dir)) return dir;
    dir = path.dirname(dir);
  }
  return null;
}
