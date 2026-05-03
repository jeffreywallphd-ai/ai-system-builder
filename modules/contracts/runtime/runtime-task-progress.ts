export interface RuntimeTaskProgress {
  message?: string;
  current?: number;
  total?: number;
  unit?: string;
  /**
   * Progress percentage as a value between 0 and 100.
   */
  percent?: number;
  details?: Record<string, unknown>;
}
