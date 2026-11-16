import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import type { DesktopHeadlessChatTasks } from "../../../../../../../modules/contracts/headless";
import type { DesktopPlanApprovalView } from "../../../../../../../modules/contracts/headless";
import { isHeadlessHostIncarnationId, parseHeadlessBuildPlanProposal } from "../../../../../../../modules/contracts/headless";
import { createWorkspaceId } from "../../../../../../../modules/contracts/workspace";
import { HeadlessClientSettings } from "../components/HeadlessClientSettings";

const { workspace, readTasks, readPairing, listPlans, openPlan, decidePlan, dismissPlan } = vi.hoisted(() => ({
  workspace: { id: "workspace-a" }, readTasks: vi.fn(), readPairing: vi.fn(), listPlans: vi.fn(), openPlan: vi.fn(),
  decidePlan: vi.fn(), dismissPlan: vi.fn(),
}));
vi.mock("../../workspace", () => ({
  useActiveWorkspace: () => ({ activeWorkspaceId: workspace.id, status: "ready" }),
}));
vi.mock("../../../lib/desktopApi", () => ({ getDesktopApi: () => ({
  readRecentHeadlessChatTasks: readTasks, readHeadlessPairingStatus: readPairing,
  listHeadlessPlanApprovals: listPlans, openHeadlessPlanApproval: openPlan,
  decideHeadlessPlanApproval: decidePlan, dismissHeadlessPlanApproval: dismissPlan,
}) }));

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

it("uses the modal to display exact proposed changes and discard a workspace's late view", async () => {
  const first = createWorkspaceId("workspace-a");
  const other = createWorkspaceId("workspace-b");
  workspace.id = first;
  readTasks.mockReset();
  readPairing.mockReset().mockResolvedValue({ status: "ready", running: false, clients: [], planReviewAvailable: true });
  const hostIncarnationId = "d5ed1db7-f069-4c48-bbc4-815697889c5d";
  if (!isHeadlessHostIncarnationId(hostIncarnationId)) throw new Error("Invalid fixture host");
  const plan = parseHeadlessBuildPlanProposal({ hostIncarnationId, workspaceId: first, steps: [
    { operation: "systems.create", name: "Review Library", templateId: "reference.secured-data-review@1.0.0",
      idempotencyKey: "c6acfd8a-7c11-486a-95af-e1a7b08d16ef" },
    { operation: "systems.clone", name: "Review Queue", systemId: "fixture-system",
      baseRecordRevision: 5, baseRevisionId: "fixture-system.r3", idempotencyKey: "c6acfd8a-7c11-486a-95af-e1a7b08d16aa" },
  ] }, hostIncarnationId);
  if (!plan.ok) throw new Error("Invalid fixture plan");
  const viewId = "eb49f5b8-e0ab-4fd9-aab7-9452426c1800";
  const nextViewId = "02e51545-3d6e-4aa5-9792-cc7544b82719";
  const lateViewId = "af1e57af-fe88-4ce0-869b-16f7c13ce39b";
  const wholePlanViewId = "56d7370f-095f-4ec4-86cd-b8cb75e5851c";
  const confirmedViewId = "5bdc1626-e379-4eaf-a792-e53b2e14b328";
  const cancelViewId = "8fd29f01-159c-4acd-99ff-0f9cc32ce125";
  const dismissedViewId = "7a13a745-3468-481e-a843-39084563a55f";
  const selection = { workspaceId: first, fingerprint: "a".repeat(64), registeredClientId: "ac444b4b-af32-4fed-b292-9bfc872b8949" };
  const state = { fingerprint: selection.fingerprint, revision: 1, expiresAt: Date.now() + 60_000,
    status: "pending", stepCount: 2, approvedSteps: 0 } as const;
  const view: DesktopPlanApprovalView = { selection, viewId, state, preview: plan.preview };
  const partiallyApproved = { ...state, revision: 2, approvedSteps: 1, mode: "each-change" } as const;
  const approved = { ...state, revision: 2, approvedSteps: 2, mode: "whole-plan", status: "approved" } as const;
  const cancelled = { ...state, revision: 2, status: "cancelled" } as const;
  let settle!: (value: DesktopPlanApprovalView) => void;
  openPlan.mockReset().mockResolvedValueOnce(view)
    .mockResolvedValueOnce({ ...view, viewId: nextViewId, state: partiallyApproved })
    .mockImplementationOnce(() => new Promise(resolve => { settle = resolve; }))
    .mockResolvedValueOnce({ ...view, viewId: wholePlanViewId })
    .mockResolvedValueOnce({ ...view, viewId: confirmedViewId, state: approved })
    .mockResolvedValueOnce({ ...view, viewId: cancelViewId })
    .mockResolvedValueOnce({ ...view, viewId: dismissedViewId });
  listPlans.mockReset().mockImplementation(async id => id === first ? [{ ...selection, expiresAt: state.expiresAt }] : []);
  let reply!: (value: DesktopPlanApprovalView["state"]) => void;
  decidePlan.mockReset().mockResolvedValueOnce(partiallyApproved).mockResolvedValueOnce(approved).mockResolvedValueOnce(cancelled)
    .mockImplementationOnce(() => new Promise(resolve => { reply = resolve; }));
  dismissPlan.mockReset().mockResolvedValue(true);
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  const button = (host: ParentNode, label: string) => [...host.querySelectorAll("button")]
    .find(item => item.textContent?.trim() === label || item.getAttribute("aria-label") === label)!;
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  try {
    await act(async () => root.render(<HeadlessClientSettings />));
    const trigger = button(container, "Review plan requests");
    trigger.focus();
    await act(async () => trigger.click());
    const dialog = document.querySelector('[role="dialog"]')!;
    expect(dialog.getAttribute("aria-modal")).toBe("true");
    expect(container.contains(dialog)).toBe(false);
    const request = "Review request aaaaaaaa from Client ac444b4b";
    await act(async () => button(dialog, request).click());
    expect(openPlan.mock.calls).toEqual([[selection]]);
    expect([...dialog.querySelectorAll("ol li strong")].map(item => item.textContent)).toEqual([
      "Create Review Library", "Copy as Review Queue",
    ]);
    expect(dialog.textContent).toContain("Saved revision: fixture-system.r3.");
    expect(dialog.textContent).toContain("Record version: 5.");
    expect([...dialog.querySelectorAll('ul[aria-label="Permissions and limits"] li')].map(item => item.textContent)).toEqual([
      "Save only the changes shown below in this workspace.",
      "Limit of 2 saved changes for this plan.",
      "No outside service calls or provider charges.",
    ]);
    expect(dialog.textContent).toContain("Approve all listed changes");
    expect(dialog.textContent).toContain("Approve each change separately");
    await act(async () => button(dialog, "Approve change 1").click());
    expect(decidePlan.mock.calls).toEqual([[{ selection, viewId, expectedRevision: 1,
      decision: { kind: "approve", mode: "each-change", step: 1 } }]]);
    expect(dialog.textContent).toContain("1 of 2 changes approved.");
    expect(button(dialog, "Approve change 2")).toBeDefined();
    await act(async () => button(dialog, "Back to requests").click());
    expect(dismissPlan).toHaveBeenCalledWith(nextViewId);
    await act(async () => button(dialog, request).click());
    workspace.id = other;
    await act(async () => root.render(<HeadlessClientSettings />));
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    await act(async () => settle({ ...view, viewId: lateViewId }));
    expect(dismissPlan).toHaveBeenCalledWith(lateViewId);
    expect(decidePlan).toHaveBeenCalledTimes(1);
    await act(async () => button(container, "Review plan requests").click());
    expect(listPlans).toHaveBeenLastCalledWith(other);
    expect(document.querySelector('[role="dialog"]')?.textContent).toContain("No requests to review.");
    expect(document.querySelector('[role="dialog"]')?.textContent).not.toContain("Review Library");

    workspace.id = first;
    await act(async () => root.render(<HeadlessClientSettings />));
    const finalTrigger = button(container, "Review plan requests");
    finalTrigger.focus();
    await act(async () => finalTrigger.click());
    const finalDialog = document.querySelector('[role="dialog"]')!;
    await act(async () => button(finalDialog, request).click());
    const wholePlan = [...finalDialog.querySelectorAll("label")].find(label =>
      label.textContent?.trim() === "Approve all listed changes")?.querySelector("input");
    expect(wholePlan).toBeDefined();
    await act(async () => wholePlan?.click());
    await act(async () => button(finalDialog, "Approve all changes").click());
    expect(decidePlan).toHaveBeenLastCalledWith({ selection, viewId: wholePlanViewId, expectedRevision: 1,
      decision: { kind: "approve", mode: "whole-plan" } });
    expect(finalDialog.textContent).toContain("All 2 changes are approved.");
    expect(button(finalDialog, "Withdraw approval")).toBeDefined();
    await act(async () => button(finalDialog, "Close plan review").click());
    expect(dismissPlan).toHaveBeenCalledWith(confirmedViewId);
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    expect(document.activeElement).toBe(finalTrigger);
    await act(async () => finalTrigger.click());
    const cancelDialog = document.querySelector('[role="dialog"]')!;
    await act(async () => button(cancelDialog, request).click());
    await act(async () => button(cancelDialog, "Cancel request").click());
    expect(decidePlan).toHaveBeenLastCalledWith({ selection, viewId: cancelViewId, expectedRevision: 1,
      decision: { kind: "cancel" } });
    expect(cancelDialog.textContent).toContain("Request canceled.");
    await act(async () => button(cancelDialog, request).click());
    await act(async () => button(cancelDialog, "Approve change 1").click());
    expect(cancelDialog.textContent).toContain("Recording your decision…");
    await act(async () => button(cancelDialog, "Close plan review")
      .dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })));
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    expect(dismissPlan).toHaveBeenCalledWith(dismissedViewId);
    const opensBeforeLateDecision = openPlan.mock.calls.length;
    await act(async () => reply(partiallyApproved));
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    expect(openPlan).toHaveBeenCalledTimes(opensBeforeLateDecision);
  } finally {
    await act(async () => root.unmount());
    container.remove();
    readPairing.mockReset();
    vi.unstubAllGlobals();
  }
});
