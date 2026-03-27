/**
 * Language descriptor registry.
 *
 * Each descriptor is a plain object with a common shape:
 *   name, findBinary, buildArgs, check, provision
 *   (plus optional: detectMissingPackages, installPackages, listPackages)
 *
 * Descriptors are registered by language name. RuntimeService uses
 * getDescriptor() to look them up.
 */

import bash from './bash.js';
import python from './python.js';

/** @type {Map<string, object>} */
const descriptors = new Map();

// Register built-in descriptors
descriptors.set('bash', bash);
descriptors.set('python', python);

/**
 * Get a descriptor by language name.
 * @param {string} language
 * @returns {object|null}
 */
export function getDescriptor(language) {
  return descriptors.get(language.toLowerCase()) || null;
}

/**
 * Get all registered descriptors.
 * @returns {Map<string, object>}
 */
export function getDescriptors() {
  return descriptors;
}

/**
 * List supported language names.
 * @returns {string[]}
 */
export function supportedLanguages() {
  return [...descriptors.keys()];
}
