/**
 * Document Writer
 *
 * Handles Y.Text manipulation for writing execution output.
 *
 * @module mrmd/monitor/document
 */

import * as Y from 'yjs';

/**
 * Writer for execution output to Y.Text
 */
export class DocumentWriter {
  /**
   * @param {Y.Doc} ydoc - Yjs document
   * @param {string} [textName='content'] - Name of the Y.Text
   */
  constructor(ydoc, textName = 'content') {
    /** @type {Y.Doc} */
    this.ydoc = ydoc;

    /** @type {Y.Text} */
    this.ytext = ydoc.getText(textName);
  }

  /**
   * Find output block by execId
   *
   * Searches for ```output:<execId> marker in the document.
   *
   * @param {string} execId
   * @returns {{markerStart: number, contentStart: number, contentEnd: number}|null}
   */
  findOutputBlock(execId) {
    const text = this.ytext.toString();
    const marker = '```output:' + execId;
    const markerStart = text.indexOf(marker);

    if (markerStart === -1) return null;

    // Find the newline after marker
    const newlineAfterMarker = text.indexOf('\n', markerStart);
    if (newlineAfterMarker === -1) return null;

    const contentStart = newlineAfterMarker + 1;

    // Find the closing ``` - it's the first ``` after contentStart
    // Output blocks don't contain nested code, so this is safe
    const closingPos = text.indexOf('```', contentStart);
    const contentEnd = closingPos === -1 ? text.length : closingPos;

    return {
      markerStart,
      contentStart,
      contentEnd,
    };
  }

  /**
   * Append content to output block
   *
   * @param {string} execId
   * @param {string} content
   * @returns {boolean} true if successful
   */
  appendOutput(execId, content) {
    const block = this.findOutputBlock(execId);
    if (!block) {
      console.warn(`[DocumentWriter] Output block not found for ${execId}`);
      return false;
    }

    // Insert just before the closing ```
    this.ytext.insert(block.contentEnd, content);
    return true;
  }

  /**
   * Replace all content in output block
   *
   * @param {string} execId
   * @param {string} content
   * @returns {boolean} true if successful
   */
  replaceOutput(execId, content) {
    const block = this.findOutputBlock(execId);
    if (!block) {
      console.warn(`[DocumentWriter] Output block not found for ${execId}`);
      return false;
    }

    // Ensure content ends with newline so closing ``` stays on its own line
    const normalizedContent = content && !content.endsWith('\n') ? content + '\n' : content;

    // Use transaction for atomic delete+insert
    this.ydoc.transact(() => {
      // Delete existing content
      const existingLength = block.contentEnd - block.contentStart;
      if (existingLength > 0) {
        this.ytext.delete(block.contentStart, existingLength);
      }

      // Insert new content
      if (normalizedContent) {
        this.ytext.insert(block.contentStart, normalizedContent);
      }
    });

    return true;
  }

  /**
   * Create relative position for output block insertion point
   *
   * @param {string} execId
   * @returns {Object|null} RelativePosition as JSON, or null if not found
   */
  createOutputPosition(execId) {
    const block = this.findOutputBlock(execId);
    if (!block) return null;

    const relPos = Y.createRelativePositionFromTypeIndex(this.ytext, block.contentStart);
    return Y.relativePositionToJSON(relPos);
  }

  /**
   * Get absolute position from stored relative position
   *
   * @param {Object} relPosJson - RelativePosition as JSON
   * @returns {number|null} Absolute position, or null if invalid
   */
  getAbsolutePosition(relPosJson) {
    if (!relPosJson) return null;

    try {
      const relPos = Y.createRelativePositionFromJSON(relPosJson);
      const absPos = Y.createAbsolutePositionFromRelativePosition(relPos, this.ydoc);
      return absPos?.index ?? null;
    } catch (err) {
      console.warn('[DocumentWriter] Failed to resolve relative position:', err.message);
      return null;
    }
  }

  /**
   * Insert at relative position
   *
   * @param {Object} relPosJson - RelativePosition as JSON
   * @param {string} content
   * @returns {boolean} true if successful
   */
  insertAtPosition(relPosJson, content) {
    const absPos = this.getAbsolutePosition(relPosJson);
    if (absPos === null) {
      console.warn('[DocumentWriter] Could not resolve position');
      return false;
    }

    this.ytext.insert(absPos, content);
    return true;
  }

  /**
   * Get current output block content
   *
   * @param {string} execId
   * @returns {string|null}
   */
  getOutputContent(execId) {
    const block = this.findOutputBlock(execId);
    if (!block) return null;

    const text = this.ytext.toString();
    return text.slice(block.contentStart, block.contentEnd);
  }

  /**
   * Check if output block exists
   *
   * @param {string} execId
   * @returns {boolean}
   */
  hasOutputBlock(execId) {
    return this.findOutputBlock(execId) !== null;
  }
}
