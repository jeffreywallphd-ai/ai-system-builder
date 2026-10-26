// @vitest-environment jsdom
import { act, useEffect } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { ContextTaskSummary } from "../../../../contracts/context-management";
import { ContextTaskNotificationBridge, type ContextManagementClient } from "../ContextStudio";
import { NotificationProvider, useNotificationCenter } from "../../notifications/NotificationProvider";
import { NotificationViewport } from "../../notifications/NotificationCenter";
import { useTaskObservationManager } from "../../notifications/TaskObservationProvider";
import type { TaskObservationManager } from "../../notifications/taskObservation";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root | undefined, container: HTMLDivElement | undefined;
let observer!: TaskObservationManager, notifications!: ReturnType<typeof useNotificationCenter>;
function Ready() {
  notifications = useNotificationCenter(); observer = useTaskObservationManager();
  useEffect(() => { notifications.setActiveWorkspaceId("workspace-a"); notifications.setPanelOpen(true); }, [notifications.setActiveWorkspaceId, notifications.setPanelOpen]);
  return <NotificationViewport />;
}
function task(overrides: Partial<ContextTaskSummary> = {}): ContextTaskSummary { return { requestId: "context-task-1", taskType: "context-generation", status: "running", ...overrides }; }
async function mount(execute: Pick<ContextManagementClient, "execute">["execute"], enabled = true) {
  if (!container) { container = document.createElement("div"); document.body.appendChild(container); root = createRoot(container); }
  await act(async () => root!.render(<NotificationProvider>{enabled && <ContextTaskNotificationBridge client={{ execute }} workspaceId="workspace-a" />}<Ready /></NotificationProvider>));
}
async function refresh() { await act(async () => { observer.invalidate({ workspaceId: "workspace-a", family: "context", requestId: "list" }); await Promise.resolve(); }); }
beforeEach(() => vi.useFakeTimers());
afterEach(async () => { if (root) await act(async () => root!.unmount()); container?.remove(); root = undefined; container = undefined; vi.restoreAllMocks(); vi.useRealTimers(); });

it("does not copy private progress or unknown unit strings", async () => {
  await mount(vi.fn().mockResolvedValue({ action: "task-list", tasks: [task({ progress: { message: "PRIVATE_CONTEXT_PROGRESS", current: 2, total: 4, percent: 50, unit: "PRIVATE_UNIT" } })] }));
  expect(container?.textContent).not.toContain("PRIVATE"); expect(container?.textContent).toContain("Preparing Context.");
  expect(container?.querySelector("progress")?.getAttribute("value")).toBe("50");
});

it("preserves only the exact fixed installation message", async () => {
  const message = "Installing the local vector database. This runs once for the managed Python runtime.";
  const execute = vi.fn().mockResolvedValueOnce({ action: "task-list", tasks: [task({ progress: { message, percent: 0 } })] }).mockResolvedValue({ action: "task-list", tasks: [task({ progress: { message: message + " PRIVATE_SUFFIX", percent: 0 } })] });
  await mount(execute); expect(container?.textContent).toContain(message);
  await refresh(); expect(container?.textContent).not.toContain("PRIVATE"); expect(container?.textContent).toContain("Preparing Context.");
});

it("derives the embedding message and percentage from validated counts", async () => {
  await mount(vi.fn().mockResolvedValue({ action: "task-list", tasks: [task({ progress: { message: "PRIVATE_EMBEDDING", current: 2, total: 4, percent: 12, unit: "chunk" } })] }));
  expect(container?.textContent).toContain("Embedding chunk 2 of 4.");
  expect(container?.querySelector("progress")?.getAttribute("value")).toBe("50");
});

it.each([
  ["queued", "Waiting to start Context work."], ["succeeded", "Context work completed."],
  ["failed", "Context work failed. Return to Context to review the task and retry."],
  ["cancelled", "Context work was cancelled."], ["unknown", "Context task status is unavailable."],
])("keeps truthful %s status without private progress", async (status, message) => {
  await mount(vi.fn().mockResolvedValue({ action: "task-list", tasks: [task({ status: status as ContextTaskSummary["status"], progress: { message: "PRIVATE_TERMINAL" } })] }));
  expect(container?.textContent).toContain(message); expect(container?.textContent).not.toContain("PRIVATE");
  expect(notifications.records.find(v => v.kind === "activity")?.status).toBe(status);
});

it.each([
  { label: "null", tasks: null }, { label: "object", tasks: {} },
  { label: "duplicate", tasks: [task(), task()] },
  { label: "oversized", tasks: Array.from({ length: 101 }, (_, i) => task({ requestId: `context-${i}` })) },
  { label: "blank identity", tasks: [task({ requestId: " " })] }, { label: "long identity", tasks: [task({ requestId: "x".repeat(513) })] },
  { label: "foreign family", tasks: [task({ taskType: "foreign-family" as never })] }, { label: "unsupported status", tasks: [task({ status: "unexpected" as never })] },
])("refuses the whole invalid task page and recovers: $label", async ({ tasks }) => {
  const execute = vi.fn().mockResolvedValueOnce({ action: "task-list", tasks }).mockResolvedValue({ action: "task-list", tasks: [task()] });
  await mount(execute); expect(notifications.records).toHaveLength(0);
  await refresh(); expect(container?.textContent).toContain("Context preparation");
});

it.each([
  { current: -1, total: 4, percent: 50 }, { current: 5, total: 4, percent: 50 },
  { current: 1.5, total: 4, percent: 50 }, { current: 0, total: 0, percent: 50 },
  { current: 1, total: Number.MAX_SAFE_INTEGER + 1 }, { percent: 101 }, { percent: -1 },
])("omits invalid Context progress: %j", async progress => {
  await mount(vi.fn().mockResolvedValue({ action: "task-list", tasks: [task({ progress })] }));
  expect(container?.querySelector("progress") === null).toBe(true);
});

it("keeps retrieval separate and accepts finite percentage-only progress", async () => {
  await mount(vi.fn().mockResolvedValue({ action: "task-list", tasks: [task({ taskType: "context-retrieval", progress: { percent: 12.5 } })] }));
  expect(container?.textContent).toContain("Context retrieval"); expect(container?.textContent).toContain("Retrieving Context.");
  expect(container?.querySelector("progress")?.getAttribute("value")).toBe("12.5");
});

it("checks a shared cached page before publishing", async () => {
  const execute = vi.fn().mockResolvedValue({ action: "task-list", tasks: [task()] });
  await mount(execute, false); let stop!: () => void;
  await act(async () => { stop = observer.subscribe({ workspaceId: "workspace-a", family: "context", requestId: "list" }, async () => ({ value: [task({ taskType: "foreign" as never, progress: { message: "PRIVATE_CACHED" } })], activity: "idle" }), () => {}); await Promise.resolve(); });
  await mount(execute); expect(notifications.records).toHaveLength(0);
  await act(async () => { stop(); await Promise.resolve(); }); await refresh();
  expect(container?.textContent).not.toContain("PRIVATE"); expect(container?.textContent).toContain("Context preparation");
});
