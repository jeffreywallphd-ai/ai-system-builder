import { useEffect, useRef, useState } from "react";
import type { ExecutionRunStatus } from "../../../../../../../modules/contracts/execution-runs";
import {
  DESKTOP_HEADLESS_CHAT_TASKS_UNAVAILABLE as unavailable, readDesktopHeadlessChatTasks, type DesktopHeadlessChatTasks,
} from "../../../../../../../modules/contracts/headless/desktop-headless-chat-tasks";
import type { WorkspaceId } from "../../../../../../../modules/contracts/workspace";
import { getDesktopApi } from "../../../lib/desktopApi";

const POLL_INTERVAL_MS = 1_000;

const labels: Record<ExecutionRunStatus, string> = {
  draft: "Draft", "awaiting-approval": "Awaiting approval", approved: "Approved", queued: "Queued",
  running: "Running", succeeded: "Completed", failed: "Failed", "cancel-requested": "Cancellation requested",
  cancelled: "Cancelled", retryable: "Retry available", blocked: "Blocked", stale: "Out of date",
  invalid: "Invalid", archived: "Archived",
};

export function RecentHeadlessChatTasks({ workspaceId }: { readonly workspaceId: WorkspaceId }) {
  const refresh = useRef<() => void>(() => {});
  const [result, setResult] = useState<DesktopHeadlessChatTasks>();

  useEffect(() => {
    let current = true;
    let inFlight = false;
    let visibilityEpoch = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const visible = () => document.visibilityState !== "hidden";
    const read = async () => {
      clearTimeout(timer);
      if (!current || !visible() || inFlight) return;
      inFlight = true;
      const epoch = visibilityEpoch;
      try {
        const value = await getDesktopApi().readRecentHeadlessChatTasks?.(workspaceId);
        if (current && epoch === visibilityEpoch && visible())
          setResult(readDesktopHeadlessChatTasks(value, workspaceId));
      } catch {
        if (current && epoch === visibilityEpoch && visible()) setResult(unavailable);
      } finally {
        inFlight = false;
        if (current && visible()) {
          // A request crossing a visibility change cannot publish. Read the
          // current workspace as soon as the previous physical read settles.
          timer = setTimeout(() => void read(), epoch === visibilityEpoch ? POLL_INTERVAL_MS : 0);
        }
      }
    };
    const onVisibilityChange = () => {
      visibilityEpoch++;
      clearTimeout(timer);
      if (visible()) void read();
    };
    refresh.current = () => void read();
    document.addEventListener("visibilitychange", onVisibilityChange);
    void read();
    return () => {
      current = false;
      refresh.current = () => {};
      clearTimeout(timer);
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, [workspaceId]);

  return (
    <section aria-label="Recent chat tasks">
      <h3>Recent chat tasks</h3>
      <button type="button" onClick={() => refresh.current()}>Refresh tasks</button>
      {result?.status === "ready" && result.tasks.length > 0
        ? <ul>{result.tasks.map((task) => <li key={task.runId}>{labels[task.status]} · <code>{task.runId}</code></li>)}</ul>
        : <p role="status">{result?.status === "ready" ? "No recent chat tasks in this workspace."
          : result?.status === "unavailable" ? "Recent chat tasks are unavailable." : "Checking recent chat tasks…"}</p>}
    </section>
  );
}
