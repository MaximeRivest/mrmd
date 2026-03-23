/**
 * Linked-table snapshot rewrite helpers.
 */

import * as Y from 'yjs';

import {
  findLinkedTableBlocks,
  serializeLinkedTableHeader,
} from '../../../../mrmd-table-spec/src/index.js';

function toRelativePositionJson(yText, index, assoc) {
  const relPos = Y.createRelativePositionFromTypeIndex(yText, index, assoc);
  return Y.relativePositionToJSON(relPos);
}

function toAbsoluteIndex(ydoc, relPosJson) {
  if (!relPosJson) return null;

  try {
    const relPos = Y.createRelativePositionFromJSON(relPosJson);
    const absPos = Y.createAbsolutePositionFromRelativePosition(relPos, ydoc);
    return absPos?.index ?? null;
  } catch {
    return null;
  }
}

export function createLinkedTableBlockAnchor(yText, range, options = {}) {
  return {
    type: 'linked-table-block-anchor-v1',
    tableId: options.tableId || range?.tableId || null,
    from: toRelativePositionJson(yText, range.from, 1),
    to: toRelativePositionJson(yText, range.to, -1),
    createdAt: Date.now(),
  };
}

export function resolveLinkedTableBlockRange(ydoc, anchor, options = {}) {
  if (!ydoc) return null;

  const from = toAbsoluteIndex(ydoc, anchor?.from);
  const to = toAbsoluteIndex(ydoc, anchor?.to);
  if (Number.isInteger(from) && Number.isInteger(to) && to >= from) {
    return {
      from,
      to,
      tableId: anchor?.tableId || options.tableId || null,
    };
  }

  const tableId = anchor?.tableId || options.tableId;
  if (!tableId) return null;

  const yText = ydoc.getText(options.textName || 'content');
  const block = findLinkedTableBlocks(yText.toString()).find(item => item.spec.id === tableId);
  if (!block) return null;

  return {
    from: block.headerFrom,
    to: block.snapshotTo,
    tableId,
  };
}

export function buildLinkedTableBlockText(spec, snapshotMarkdown) {
  const headerText = serializeLinkedTableHeader(spec).trimEnd();
  const snapshotText = String(snapshotMarkdown || '').trim();
  return snapshotText ? `${headerText}\n${snapshotText}` : headerText;
}

export function rewriteLinkedTableBlock(options = {}) {
  const {
    ydoc,
    textName = 'content',
    blockAnchor,
    tableId,
    spec,
    snapshotMarkdown,
  } = options;

  if (!ydoc) {
    throw new TypeError('rewriteLinkedTableBlock requires a Y.Doc');
  }

  const yText = ydoc.getText(textName);
  const range = resolveLinkedTableBlockRange(ydoc, blockAnchor, { textName, tableId });
  if (!range) {
    throw new Error(`Could not resolve linked-table block anchor${tableId ? ` for ${tableId}` : ''}`);
  }

  const replacement = buildLinkedTableBlockText(spec, snapshotMarkdown);
  ydoc.transact(() => {
    yText.delete(range.from, range.to - range.from);
    yText.insert(range.from, replacement);
  });

  return {
    from: range.from,
    to: range.from + replacement.length,
    replacement,
    blockAnchor: createLinkedTableBlockAnchor(yText, {
      from: range.from,
      to: range.from + replacement.length,
      tableId: tableId || spec?.id || null,
    }),
  };
}

export default {
  createLinkedTableBlockAnchor,
  resolveLinkedTableBlockRange,
  buildLinkedTableBlockText,
  rewriteLinkedTableBlock,
};
