// @vitest-environment jsdom
import { act, useEffect } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  NotificationProvider,
  NotificationViewport,
  useNotificationCenter,
} from "../../../../../../../modules/ui/shared";
import { ModelTrainingNotificationBridge } from "../components/ModelTrainingNotificationBridge";
import { announceModelTrainingStarted } from "../hooks/modelTrainingNotificationEvents";
import type { DesktopModelTrainingResult } from "../../../lib/desktopApi";
import { TaskObservationProvider, useTaskObservationManager } from "../../../../../../../modules/ui/shared/notifications/TaskObservationProvider";
import type { TaskObservationManager } from "../../../../../../../modules/ui/shared/notifications/taskObservation";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

function ActiveWorkspace({ workspaceId }: { readonly workspaceId: string }) {
  const notifications = useNotificationCenter();
  useEffect(
    () => notifications.setActiveWorkspaceId(workspaceId),
    [notifications.setActiveWorkspaceId, workspaceId],
  );
  return null;
}

function ObserveManager({ ready }: { ready: (value: TaskObservationManager) => void }) {
  const manager = useTaskObservationManager();
  useEffect(() => ready(manager), [manager, ready]);
  return null;
}

describe("ModelTrainingNotificationBridge", () => {
  let root: Root | undefined;
  let container: HTMLDivElement | undefined;

  beforeEach(() => vi.useFakeTimers());
  afterEach(async () => {
    if (root) await act(async () => root?.unmount());
    container?.remove();
    root = undefined;
    container = undefined;
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it("opens global batch progress and keeps polling after the training page is left", async () => {
    let status: "running" | "succeeded" = "running";
    const readModelTrainingStatus = vi.fn(async () =>
      status === "running"
        ? {
            runId: "run-1",
            status: "running" as const,
            progress: {
              epoch: 1,
              totalEpochs: 2,
              batch: 3,
              totalBatches: 10,
              message: "Epoch [1]/[2], Batch [3]/[10]",
            },
          }
        : { runId: "run-1", status: "succeeded" as const },
    );
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    await act(async () => {
      root?.render(
        <NotificationProvider>
          <ActiveWorkspace workspaceId="workspace-a" />
          <ModelTrainingNotificationBridge
            client={{ readModelTrainingStatus }}
            workspaceId="workspace-a"
          />
          <NotificationViewport />
        </NotificationProvider>,
      );
    });

    await act(async () => {
      announceModelTrainingStarted({
        runId: "run-1",
        workspaceId: "workspace-a",
      });
      await Promise.resolve();
    });

    expect(container.querySelector("#application-notification-panel")).not.toBeNull();
    expect(container.textContent).toContain("Training epoch 1 of 2, batch 3 of 10.");
    expect(container.textContent).toContain("30%");
    expect(container.querySelector("progress")?.getAttribute("value")).toBe("30");

    status = "succeeded";
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000);
      await Promise.resolve();
    });
    expect(container.textContent).toContain("Model training completed.");
    expect(readModelTrainingStatus).toHaveBeenCalledWith({
      runId: "run-1",
      workspaceId: "workspace-a",
    });
  });

  async function mount(client: { readModelTrainingStatus: (input: { runId: string; workspaceId: string }) => Promise<DesktopModelTrainingResult> }, workspaceId = "workspace-a", ready?: (value: TaskObservationManager) => void) {
    if (!container) { container = document.createElement("div"); document.body.appendChild(container); root = createRoot(container); }
    await act(async () => root?.render(<NotificationProvider><TaskObservationProvider>{ready && <ObserveManager ready={ready} />}<ActiveWorkspace workspaceId={workspaceId} /><ModelTrainingNotificationBridge client={client} workspaceId={workspaceId} /><NotificationViewport /></TaskObservationProvider></NotificationProvider>));
  }
  async function start(runId = "run-1", workspaceId = "workspace-a") {
    await act(async () => { announceModelTrainingStarted({ runId, workspaceId }); await Promise.resolve(); });
  }
  async function advance() { await act(async () => { await vi.advanceTimersByTimeAsync(2000); }); }

  it.each([
    ["foreign terminal", { runId: "other-run", status: "succeeded" }],
    ["unknown status", { runId: "run-1", status: "unexpected" }],
    ["missing result", null],
  ])("retains observation and retries %s without claiming a terminal outcome", async (_label, reply) => {
    const readModelTrainingStatus = vi.fn().mockResolvedValueOnce(reply).mockResolvedValue({ runId: "run-1", status: "succeeded" });
    await mount({ readModelTrainingStatus }); await start();
    expect(container?.textContent).toContain("Progress is temporarily unavailable");
    expect(container?.textContent).not.toContain("Model training completed.");
    expect(container?.textContent).not.toContain("Model training failed.");
    await advance();
    expect(readModelTrainingStatus).toHaveBeenCalledTimes(2);
    expect(container?.textContent).toContain("Model training completed.");
  });

  it("does not copy runtime error text into notification history", async () => {
    const readModelTrainingStatus = vi.fn().mockResolvedValue({ runId: "run-1", status: "failed", error: { code: "foreign", message: "PRIVATE_TRAINING_DIAGNOSTIC", details: { prompt: "PRIVATE_PAYLOAD" } } });
    await mount({ readModelTrainingStatus }); await start();
    expect(container?.textContent).toContain("Model training failed. Open Model Training to review the run and retry.");
    expect(container?.textContent).not.toContain("PRIVATE_");
  });

  it("does not copy free-text progress and preserves valid zero/current progress", async () => {
    const readModelTrainingStatus = vi.fn().mockResolvedValue({ runId: "run-1", status: "running", progress: { epoch: 1, totalEpochs: 2, batch: 0, totalBatches: 10, message: "PRIVATE_PROGRESS_PAYLOAD" } });
    await mount({ readModelTrainingStatus }); await start();
    expect(container?.textContent).toContain("Training epoch 1 of 2, batch 0 of 10.");
    expect(container?.textContent).not.toContain("PRIVATE_");
    expect(container?.textContent).toContain("0%");
  });

  it.each([
    { epoch: Number.NaN, totalEpochs: 2, batch: Number.POSITIVE_INFINITY, totalBatches: 10 },
    { epoch: -1, totalEpochs: 2, batch: -2, totalBatches: 10 },
    { epoch: 3, totalEpochs: 2, batch: 11, totalBatches: 10 },
    { epoch: 0.5, totalEpochs: 2, batch: 1.5, totalBatches: 10 },
    { epoch: 1, totalEpochs: 0, batch: 0, totalBatches: 0 },
    { epoch: 1, totalEpochs: Number.MAX_SAFE_INTEGER + 1, batch: 1, totalBatches: Number.MAX_SAFE_INTEGER + 1 },
  ])("does not turn invalid progress into numeric success: %j", async (progress) => {
    const readModelTrainingStatus = vi.fn().mockResolvedValue({ runId: "run-1", status: "running", progress });
    await mount({ readModelTrainingStatus }); await start();
    expect(container?.textContent).toContain("Model training is running.");
    expect(container?.querySelector("progress")).toBeNull();
  });

  it.each([
    ["queued", false, "Waiting to start model training."],
    ["succeeded", true, "Model training completed. Review the result to save or discard it."],
    ["cancelled", false, "Model training was cancelled."],
  ])("keeps the supported %s outcome", async (status, reviewPending, expected) => {
    const readModelTrainingStatus = vi.fn().mockResolvedValue({ runId: "run-1", status, reviewPending });
    await mount({ readModelTrainingStatus }); await start();
    expect(container?.textContent).toContain(expected);
  });

  it("retires delayed old-client outcomes after a committed replacement", async () => {
    let resolve!: (value: DesktopModelTrainingResult) => void;
    const oldClient = { readModelTrainingStatus: vi.fn(() => new Promise<DesktopModelTrainingResult>((done) => { resolve = done; })) };
    const nextClient = { readModelTrainingStatus: vi.fn().mockResolvedValue({ runId: "run-2", status: "running" }) };
    await mount(oldClient); await start(); await mount(nextClient); await start("run-2");
    await act(async () => resolve({ runId: "run-1", status: "succeeded" }));
    await advance();
    expect(container?.textContent).not.toContain("Model training completed.");
    expect(container?.textContent).toContain("Model training is running.");
    expect(nextClient.readModelTrainingStatus).toHaveBeenCalledWith({ runId: "run-2", workspaceId: "workspace-a" });
  });

  it("ignores foreign workspace start events and duplicate active starts", async () => {
    const readModelTrainingStatus = vi.fn().mockResolvedValue({ runId: "run-1", status: "running" });
    await mount({ readModelTrainingStatus }); await start("run-1", "workspace-b");
    expect(readModelTrainingStatus).not.toHaveBeenCalled();
    await start(); await start();
    expect(container?.querySelectorAll("progress").length).toBeLessThanOrEqual(1);
    expect(readModelTrainingStatus.mock.calls.every(([value]) => value.workspaceId === "workspace-a" && value.runId === "run-1")).toBe(true);
  });

  it("does not restart an observed terminal run after a duplicate start event", async () => {
    const readModelTrainingStatus = vi.fn().mockResolvedValueOnce({ runId: "run-1", status: "succeeded" }).mockResolvedValue({ runId: "run-1", status: "failed" });
    await mount({ readModelTrainingStatus }); await start(); await start(); await advance();
    expect(readModelTrainingStatus).toHaveBeenCalledTimes(1);
    expect(container?.textContent).toContain("Model training completed.");
    expect(container?.textContent).not.toContain("Model training failed.");
  });

  it("retries a transport rejection without showing its diagnostic", async () => {
    const readModelTrainingStatus = vi.fn().mockRejectedValueOnce(new Error("PRIVATE_STATUS_ERROR")).mockResolvedValue({ runId: "run-1", status: "cancelled" });
    await mount({ readModelTrainingStatus }); await start();
    expect(container?.textContent).toContain("Progress is temporarily unavailable");
    expect(container?.textContent).not.toContain("PRIVATE_");
    await advance(); expect(container?.textContent).toContain("Model training was cancelled.");
  });

  it("does not publish old workspace completion into the new workspace", async () => {
    let resolve!: (value: DesktopModelTrainingResult) => void;
    const client = { readModelTrainingStatus: vi.fn(() => new Promise<DesktopModelTrainingResult>((done) => { resolve = done; })) };
    await mount(client); await start(); await mount(client, "workspace-b");
    await act(async () => resolve({ runId: "run-1", status: "succeeded" })); await advance();
    expect(container?.textContent).not.toContain("Model training completed.");
    expect(client.readModelTrainingStatus).toHaveBeenCalledTimes(1);
  });

  it("retires only its own listener when a shared terminal snapshot arrives synchronously", async () => {
    let manager!: TaskObservationManager;
    const readModelTrainingStatus = vi.fn().mockResolvedValue({ runId: "run-1", status: "running" });
    await mount({ readModelTrainingStatus }, "workspace-a", (value) => { manager = value; });
    let stop!: () => void;
    await act(async () => {
      stop = manager.subscribe({ workspaceId: "workspace-a", family: "model-training", requestId: "run-1" }, async () => ({ value: { runId: "run-1", status: "succeeded" as const }, activity: "terminal" }), () => {});
      await Promise.resolve();
    });
    await start(); await advance();
    expect(container?.textContent).toContain("Model training completed.");
    expect(readModelTrainingStatus).not.toHaveBeenCalled();
    expect(manager.subscriptionCount).toBe(1);
    await act(async () => stop()); expect(manager.subscriptionCount).toBe(0);
  });
});
