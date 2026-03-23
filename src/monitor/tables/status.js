/**
 * Linked-table job status constants.
 *
 * Must stay aligned with the browser-side `tableJobs` client.
 */

export const TABLE_JOB_STATUS = {
  REQUESTED: 'requested',
  CLAIMED: 'claimed',
  RUNNING: 'running',
  WRITING: 'writing',
  COMPLETED: 'completed',
  ERROR: 'error',
  CANCELLED: 'cancelled',
};

export function isTerminalTableJobStatus(status) {
  return [
    TABLE_JOB_STATUS.COMPLETED,
    TABLE_JOB_STATUS.ERROR,
    TABLE_JOB_STATUS.CANCELLED,
  ].includes(status);
}

export default {
  TABLE_JOB_STATUS,
  isTerminalTableJobStatus,
};
