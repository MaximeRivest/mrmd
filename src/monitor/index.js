/**
 * Monitor subsystem for mrmd.
 *
 * Headless Yjs peer for monitoring and executing code in mrmd notebooks.
 * Ensures long-running executions survive browser disconnects.
 *
 * @module mrmd/monitor
 */

export { RuntimeMonitor, createMonitor } from './monitor.js';
export { ExecutionHandler } from './execution.js';
export { DocumentWriter } from './document.js';
export { CoordinationProtocol, EXECUTION_STATUS } from './coordination.js';
export { TerminalBuffer, processTerminalOutput } from './terminal.js';
export {
  TABLE_JOB_STATUS,
  isTerminalTableJobStatus,
  TableJobsBridge,
  createTableJobsBridge,
  createDefaultExec,
  executeMaterializationContract,
  readDelimitedTable,
  createLocalFileSourceProvider,
  createDefaultTableRuntime,
  runTableJob,
  createLinkedTableBlockAnchor,
  resolveLinkedTableBlockRange,
  buildLinkedTableBlockText,
  rewriteLinkedTableBlock,
} from './tables/index.js';
