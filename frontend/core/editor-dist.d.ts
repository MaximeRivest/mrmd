/**
 * Type declarations for runtime-loaded editor module
 *
 * The editor is built separately and loaded at runtime from /editor-dist/
 * This provides TypeScript type information for the dynamic import.
 *
 * This file is referenced via paths in tsconfig.json
 * It maps the runtime path /editor-dist/index.browser.js to these declarations
 */

import type { EditorView } from '@codemirror/view';

// Core
export function createEditor(config: import('@mrmd/editor').EditorConfig): import('@mrmd/editor').MrmdEditor;
export type MrmdEditor = import('@mrmd/editor').MrmdEditor;
export type EditorConfig = import('@mrmd/editor').EditorConfig;
export type CursorInfo = import('@mrmd/editor').CursorInfo;
export type CompletionResult = import('@mrmd/editor').CompletionResult;
export type InspectionResult = import('@mrmd/editor').InspectionResult;
export type HoverResult = import('@mrmd/editor').HoverResult;

// Execution
export const IPythonExecutor: typeof import('@mrmd/editor').IPythonExecutor;
export function createMinimalIPythonClient(baseUrl: string): import('@mrmd/editor').IPythonClient;
export type IPythonClient = import('@mrmd/editor').IPythonClient;

// Collaboration / Streaming
export function startStream(
  view: EditorView,
  options: {
    id: string;
    type: 'ai' | 'execution' | 'external';
    anchorPos: number;
    anchorType?: 'after' | 'replace';
    replaceFrom?: number;
    replaceTo?: number;
    owner: { userId: string; userName: string; userColor: string };
    operation?: string;
  }
): void;

export function streamChunk(
  view: EditorView,
  id: string,
  chunk: string,
  replace?: boolean
): void;

export function completeStream(
  view: EditorView,
  id: string,
  finalContent?: string
): void;

export function commitStream(options: {
  streamId: string;
  view: EditorView;
  lockManager?: unknown;
  onCommit?: (content: string) => void;
  onError?: (error: Error) => void;
}): { success: boolean; content?: string; error?: string };

export function cancelStream(view: EditorView, id: string): void;

export function errorStream(view: EditorView, id: string, error: string): void;

// Re-export remaining types from the editor package
export * from '@mrmd/editor';
