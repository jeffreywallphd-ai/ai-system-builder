import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import type { DesktopHeadlessChatTasks } from "../../../../../../../modules/contracts/headless/desktop-headless-chat-tasks";
import { createWorkspaceId } from "../../../../../../../modules/contracts/workspace";
import { HeadlessClientSettings } from "../components/HeadlessClientSettings";

const { workspace, readTasks } = vi.hoisted(() => ({ workspace: { id: "workspace-a" }, readTasks: vi.fn() }));
vi.mock("../../workspace", () => ({
  useActiveWorkspace: () => ({ activeWorkspaceId: workspace.id, status: "ready" }),
}));
vi.mock("../../../lib/desktopApi", () => ({ getDesktopApi: () => ({ readRecentHeadlessChatTasks: readTasks }) }));

it("renders saved task status, refreshes without stealing focus, and discards old workspace replies", async () => {
  const first = createWorkspaceId("workspace-a");
  const second = createWorkspaceId("workspace-b");
  const ready = (workspaceId: typeof first, runId: string, status: "running" | "succeeded"): DesktopHeadlessChatTasks => ({
    status: "ready", workspaceId, tasks: [{ sessionId: "session-1", turnId: "turn-1", runId, status }],
  });
  let late!: (value: DesktopHeadlessChatTasks) => void;
  workspace.id = first;
  readTasks.mockReset().mockResolvedValueOnce(ready(first, "run-a", "running"))
    .mockImplementationOnce(() => new Promise((resolve) => { late = resolve; }))
    .mockResolvedValueOnce(ready(second, "run-b", "succeeded"));
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  try {
    await act(async () => root.render(<HeadlessClientSettings />));
    expect(container.textContent).toContain("Running · run-a");
    const button = Array.from(container.querySelectorAll("button")).find((item) => item.textContent === "Refresh tasks")!;
    button.focus();
    await act(async () => button.click());
    expect(document.activeElement).toBe(button);
    expect(readTasks.mock.calls).toEqual([[first], [first]]);
    expect(container.textContent).toContain("Running · run-a");
    workspace.id = second;
    await act(async () => root.render(<HeadlessClientSettings />));
    expect(container.textContent).toContain("Completed · run-b");
    await act(async () => late(ready(first, "run-a-late", "succeeded")));
    expect(container.textContent).toContain("Completed · run-b");
    expect(container.textContent).not.toContain("run-a-late");
    expect(readTasks.mock.calls).toEqual([[first], [first], [second]]);
  } finally {
    await act(async () => root.unmount());
    container.remove();
  }
});


it("polls once at a time, pauses when hidden, and resumes without publishing a hidden result", async () => {
  vi.useFakeTimers();
  let visibility: DocumentVisibilityState = "visible";
  const visibilityState = vi.spyOn(document, "visibilityState", "get").mockImplementation(() => visibility);
  const id = createWorkspaceId("workspace-a");
  workspace.id = id;
  const ready = (runId: string, status: "running" | "succeeded"): DesktopHeadlessChatTasks => ({
    status: "ready", workspaceId: id, tasks: [{ sessionId: "session-1", turnId: "turn-1", runId, status }],
  });
  let settle!: (value: DesktopHeadlessChatTasks) => void;
  readTasks.mockReset().mockResolvedValueOnce(ready("run-a", "running"))
    .mockImplementationOnce(() => new Promise((resolve) => { settle = resolve; }))
    .mockResolvedValueOnce(ready("run-a", "succeeded"));
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  try {
    await act(async () => root.render(<HeadlessClientSettings />));
    expect(container.textContent).toContain("Running · run-a");
    await act(async () => vi.advanceTimersByTimeAsync(1_000));
    expect(readTasks).toHaveBeenCalledTimes(2);
    const button = Array.from(container.querySelectorAll("button")).find((item) => item.textContent === "Refresh tasks")!;
    button.focus();
    await act(async () => { button.click(); await vi.advanceTimersByTimeAsync(3_000); });
    expect(readTasks).toHaveBeenCalledTimes(2);
    visibility = "hidden";
    await act(async () => document.dispatchEvent(new Event("visibilitychange")));
    await act(async () => settle(ready("run-obsolete", "succeeded")));
    await act(async () => vi.advanceTimersByTimeAsync(3_000));
    expect(readTasks).toHaveBeenCalledTimes(2);
    expect(container.textContent).not.toContain("run-obsolete");
    visibility = "visible";
    await act(async () => document.dispatchEvent(new Event("visibilitychange")));
    expect(readTasks).toHaveBeenCalledTimes(3);
    expect(container.textContent).toContain("Completed · run-a");
    expect(document.activeElement).toBe(button);
  } finally {
    await act(async () => root.unmount());
    container.remove();
    visibilityState.mockRestore();
    vi.useRealTimers();
  }
});
