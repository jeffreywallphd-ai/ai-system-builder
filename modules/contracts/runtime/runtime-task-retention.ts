/**
 * In-memory retention policy for completed runtime task records.
 */
export interface RuntimeTaskRetentionPolicy {
  completedTaskTtlMs?: number;
  maxCompletedTasks?: number;
  cleanupIntervalMs?: number;
}
