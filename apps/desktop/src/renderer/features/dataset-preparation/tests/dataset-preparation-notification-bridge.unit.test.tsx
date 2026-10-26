import { act, useEffect } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  NotificationProvider,
  NotificationViewport,
  useNotificationCenter,
} from "../../../../../../../modules/ui/shared";
import { DatasetPreparationNotificationBridge } from "../components/DatasetPreparationNotificationBridge";
import { announceDatasetPreparationStarted } from "../hooks/datasetPreparationNotificationEvents";
import { createDesktopDatasetPreparationClient, type DesktopDatasetPreparationTaskReadResult } from "../api/desktopDatasetPreparationClient";
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

describe("DatasetPreparationNotificationBridge", () => {
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

  it("opens global progress and keeps polling independently of the preparation page", async () => {
    let status: "running" | "succeeded" = "running";
    const readPrepareTrainingDatasetTask = vi.fn(async () =>
      status === "running"
        ? {
            ok: true as const,
            status: "running" as const,
            progress: {
              message:
                "Loading the selected model and creating the first batch. The first batch can take longer.",
              processed: 0,
              total: 31,
            },
          }
        : {
            ok: true as const,
            status: "succeeded" as const,
            value: {} as never,
          },
    );
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    await act(async () => {
      root?.render(
        <NotificationProvider>
          <ActiveWorkspace workspaceId="workspace-a" />
          <DatasetPreparationNotificationBridge
            client={{ readPrepareTrainingDatasetTask }}
            workspaceId="workspace-a"
          />
          <NotificationViewport />
        </NotificationProvider>,
      );
    });

    await act(async () => {
      announceDatasetPreparationStarted({
        requestId: "prepare-1",
        workspaceId: "workspace-a",
      });
      await Promise.resolve();
    });

    expect(container.querySelector("#application-notification-panel")).not.toBeNull();
    expect(container.textContent).toContain("Preparing the training dataset.");
    expect(container.textContent).toContain("0%");

    status = "succeeded";
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000);
      await Promise.resolve();
    });
    expect(container.textContent).toContain("Training dataset is ready.");
    expect(readPrepareTrainingDatasetTask).toHaveBeenCalledWith(
      "prepare-1",
      "workspace-a",
    );
  });

  it("opens a warning when the runtime actually uses bounded disk overflow", async () => {
    const readPrepareTrainingDatasetTask = vi.fn(async () => ({
      ok: true as const,
      status: "running" as const,
      progress: {
        message:
          "The model is using system-managed disk/swap because available memory is low. Generation may run more slowly.",
        processed: 0,
        total: 1,
        phase: "memory-overflow",
        memoryOverflowActive: true,
        estimatedMemoryOverflowBytes: 512 * 1024 ** 2,
        memoryOverflowLimitBytes: 1024 ** 3,
      },
    }));
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    await act(async () => {
      root?.render(
        <NotificationProvider>
          <ActiveWorkspace workspaceId="workspace-a" />
          <DatasetPreparationNotificationBridge
            client={{ readPrepareTrainingDatasetTask }}
            workspaceId="workspace-a"
          />
          <NotificationViewport />
        </NotificationProvider>,
      );
    });

    await act(async () => {
      announceDatasetPreparationStarted({
        requestId: "prepare-overflow",
        workspaceId: "workspace-a",
      });
      await Promise.resolve();
    });

    expect(container.querySelector("#application-notification-panel")).not.toBeNull();
    expect(container.textContent).toContain("Model is using disk space");
    expect(container.textContent).toContain(
      "Available memory is too low for the selected model",
    );
    expect(container.textContent).toContain("Generation may run more slowly");
  });

  async function mount(client: { readPrepareTrainingDatasetTask: (id: string, workspace?: string) => Promise<DesktopDatasetPreparationTaskReadResult> }, workspaceId = "workspace-a", ready?: (value: TaskObservationManager) => void) {
    if (!container) { container = document.createElement("div"); document.body.appendChild(container); root = createRoot(container); }
    await act(async () => root?.render(<NotificationProvider><TaskObservationProvider>{ready && <ObserveManager ready={ready} />}<ActiveWorkspace workspaceId={workspaceId} /><DatasetPreparationNotificationBridge client={client} workspaceId={workspaceId} /><NotificationViewport /></TaskObservationProvider></NotificationProvider>));
  }
  async function start(requestId = "prepare-1", workspaceId = "workspace-a") {
    await act(async () => { announceDatasetPreparationStarted({ requestId, workspaceId }); await Promise.resolve(); });
  }
  async function advance() { await act(async () => { await vi.advanceTimersByTimeAsync(2000); }); }

  it("does not copy free-text runtime progress", async () => {
    const readPrepareTrainingDatasetTask = vi.fn().mockResolvedValue({ ok: true, status: "running", progress: { message: "PRIVATE_PROGRESS", processed: 2, total: 4 } });
    await mount({ readPrepareTrainingDatasetTask }); await start();
    expect(container?.textContent).not.toContain("PRIVATE_");
    expect(container?.textContent).toContain("Preparing the training dataset.");
    expect(container?.querySelector("progress")?.value).toBe(50);
  });

  it.each([
    ["ocr_unavailable", "Text recognition is unavailable. Choose an installed Windows recognition language, or turn off scanned-PDF recognition."],
    ["unrecognized", "Dataset preparation could not finish. Review the selected files and settings, then retry."],
  ])("keeps safe actionable %s failure copy without runtime text", async (code, expected) => {
    const readPrepareTrainingDatasetTask = vi.fn().mockResolvedValue({ ok: false, error: { code, message: "PRIVATE_FAILURE", details: { message: "PRIVATE_DETAIL" } } });
    await mount({ readPrepareTrainingDatasetTask }); await start();
    expect(container?.textContent).toContain(expected);
    expect(container?.textContent).not.toContain("PRIVATE_");
  });

  it.each([
    { processed: Number.NaN, total: 4 }, { processed: Number.POSITIVE_INFINITY, total: 4 },
    { processed: -1, total: 4 }, { processed: 5, total: 4 }, { processed: 1.5, total: 4 },
    { processed: 0, total: 0 }, { processed: 1, total: Number.MAX_SAFE_INTEGER + 1 },
  ])("omits invalid numeric progress: %j", async progress => {
    const readPrepareTrainingDatasetTask = vi.fn().mockResolvedValue({ ok: true, status: "running", progress });
    await mount({ readPrepareTrainingDatasetTask }); await start();
    expect(container?.querySelector("progress")).toBeNull();
  });

  it.each([undefined, {}, { ok: true, status: "not-supported" }])("keeps malformed status uncertain and retries: %j", async value => {
    const readPrepareTrainingDatasetTask = vi.fn().mockResolvedValueOnce(value).mockResolvedValue({ ok: true, status: "cancelled" });
    await mount({ readPrepareTrainingDatasetTask }); await start();
    expect(container?.textContent).toContain("Progress is temporarily unavailable");
    await advance(); expect(container?.textContent).toContain("Dataset preparation was cancelled.");
  });

  it("keeps measured memory-shortfall advice through the real client into Notifications", async () => {
    const previous = window.desktopApi;
    try {
      window.desktopApi = { readPrepareTrainingDatasetTask: vi.fn().mockResolvedValue({ ok: true, value: { status: "failed", error: {
        code: "generation_insufficient_resources", stage: "generation", message: "PRIVATE_MEMORY_ERROR",
        memoryShortfall: { resource: "ram", requiredBytes: 3758096384, availableBytes: 3503902720, allowedOverflowBytes: 0, path: "PRIVATE_PATH" },
      } } }) } as never;
      await mount(createDesktopDatasetPreparationClient()); await start();
      expect(container?.textContent).toContain("Free at least 243 MiB of RAM");
      expect(container?.textContent).toContain("available memory can change");
      expect(container?.textContent).not.toContain("PRIVATE_");
    } finally { window.desktopApi = previous; }
  });

  it("does not trust a free-text memory amount without valid numeric facts", async () => {
    const readPrepareTrainingDatasetTask = vi.fn().mockResolvedValue({ ok: false, error: { code: "generation_insufficient_resources", message: "PRIVATE_FAKE_MEMORY_AMOUNT", details: { memoryShortfall: { requiredBytes: "PRIVATE" } } } });
    await mount({ readPrepareTrainingDatasetTask }); await start();
    expect(container?.textContent).toContain("Close memory-heavy applications or select a smaller built-in model");
    expect(container?.textContent).not.toContain("PRIVATE"); expect(container?.textContent).not.toContain("MiB");
  });

  it("does not replay a terminal request as a different outcome", async () => {
    const readPrepareTrainingDatasetTask = vi.fn().mockResolvedValueOnce({ ok: true, status: "succeeded", value: {} }).mockResolvedValue({ ok: false, error: { code: "task_failed", message: "PRIVATE_REPLAY" } });
    await mount({ readPrepareTrainingDatasetTask }); await start(); await start(); await advance();
    expect(readPrepareTrainingDatasetTask).toHaveBeenCalledTimes(1);
    expect(container?.textContent).toContain("Training dataset is ready.");
  });

  it.each([
    ["pending", "Waiting to prepare the dataset."], ["review-required", "Return to Dataset Preparation to review the results."],
    ["unknown", "Dataset preparation status is no longer available."],
  ])("preserves supported %s outcome", async (status, expected) => {
    const readPrepareTrainingDatasetTask = vi.fn().mockResolvedValue({ ok: true, status, value: {} });
    await mount({ readPrepareTrainingDatasetTask }); await start(); expect(container?.textContent).toContain(expected);
  });

  it("retires a delayed client result and a foreign workspace start", async () => {
    let resolve!: (value: DesktopDatasetPreparationTaskReadResult) => void;
    const old = { readPrepareTrainingDatasetTask: vi.fn(() => new Promise<DesktopDatasetPreparationTaskReadResult>((done) => { resolve = done; })) };
    const next = { readPrepareTrainingDatasetTask: vi.fn().mockResolvedValue({ ok: true, status: "running" }) };
    await mount(old); await start("prepare-1", "workspace-b"); expect(old.readPrepareTrainingDatasetTask).not.toHaveBeenCalled();
    await start(); await mount(next); await start("prepare-2");
    await act(async () => resolve({ ok: true, status: "succeeded", value: {} as never })); await advance();
    expect(container?.textContent).not.toContain("Training dataset is ready.");
    expect(container?.textContent).toContain("Preparing the training dataset.");
  });

  it("warns once for a real overflow flag and ignores a malformed flag", async () => {
    const readPrepareTrainingDatasetTask = vi.fn().mockResolvedValueOnce({ ok: true, status: "running", progress: { memoryOverflowActive: "true" } }).mockResolvedValue({ ok: true, status: "running", progress: { memoryOverflowActive: true } });
    await mount({ readPrepareTrainingDatasetTask }); await start();
    expect(container?.textContent).not.toContain("Model is using disk space");
    await advance(); await advance();
    expect(container?.querySelectorAll('#application-notification-panel .ui-notification__item')).toHaveLength(2);
    expect(container?.textContent).toContain("Model is using disk space");
  });

  it("retries a transport rejection with fixed copy", async () => {
    const readPrepareTrainingDatasetTask = vi.fn().mockRejectedValueOnce(new Error("PRIVATE_TRANSPORT_ERROR")).mockResolvedValue({ ok: true, status: "cancelled" });
    await mount({ readPrepareTrainingDatasetTask }); await start();
    expect(container?.textContent).toContain("Progress is temporarily unavailable");
    expect(container?.textContent).not.toContain("PRIVATE_"); await advance();
    expect(container?.textContent).toContain("Dataset preparation was cancelled.");
  });

  it("retires only the bridge listener for a synchronous shared review snapshot", async () => {
    let manager!: TaskObservationManager;
    const readPrepareTrainingDatasetTask = vi.fn().mockResolvedValue({ ok: true, status: "running" });
    await mount({ readPrepareTrainingDatasetTask }, "workspace-a", (value) => { manager = value; });
    let stop!: () => void;
    await act(async () => { stop = manager.subscribe({ workspaceId: "workspace-a", family: "dataset-preparation", requestId: "prepare-1" }, async () => ({ value: { ok: true, status: "review-required", value: {} } as DesktopDatasetPreparationTaskReadResult, activity: "terminal" }), () => {}); await Promise.resolve(); });
    await start(); await advance();
    expect(container?.textContent).toContain("Return to Dataset Preparation to review the results.");
    expect(readPrepareTrainingDatasetTask).not.toHaveBeenCalled(); expect(manager.subscriptionCount).toBe(1);
    await act(async () => stop()); expect(manager.subscriptionCount).toBe(0);
  });
});
