type Activity = {
  requestId?: unknown;
  status?: unknown;
  progress?: { percent?: unknown };
  updatedAt?: unknown;
};

export type ProgressTransition = Readonly<{
  requestId: string;
  percent: 10;
  emittedAt: number;
}>;

function timestamp(value: unknown): number {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)) {
    throw new Error("Task visibility timestamp is unavailable.");
  }
  const result = Date.parse(value);
  if (!Number.isSafeInteger(result) || result < 0 || new Date(result).toISOString() !== value) throw new Error("Task visibility timestamp is invalid.");
  return result;
}

/** Fixed initial milestone, captured before navigation. Never substitute a later
 * easier transition after observing a slow reload or stale rendered progress. */
export function captureInitialProgress(activity: Activity, requestId: string): ProgressTransition {
  if (activity.requestId !== requestId || activity.status !== "running" || activity.progress?.percent !== 10) {
    throw new Error("The fixed initial task progress transition was not captured.");
  }
  return Object.freeze({ requestId, percent: 10, emittedAt: timestamp(activity.updatedAt) });
}

function elapsed(emittedAt: number, visibleAt: number): number {
  const result = visibleAt - emittedAt;
  if (!Number.isSafeInteger(visibleAt) || !Number.isFinite(result) || result < 0) {
    throw new Error("Task visibility delay is invalid.");
  }
  return result;
}

export function progressVisibilityDelay(transition: ProgressTransition, visiblePercent: number, visibleAt: number): number {
  if (!Number.isFinite(visiblePercent) || visiblePercent < transition.percent || visiblePercent > 100) {
    throw new Error("Rendered progress does not satisfy the captured task transition.");
  }
  return elapsed(transition.emittedAt, visibleAt);
}

export function terminalVisibilityDelay(completedAt: unknown, visibleAt: number): number {
  return elapsed(timestamp(completedAt), visibleAt);
}
