import { act, useEffect } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  NotificationProvider,
  NotificationViewport,
  useNotificationCenter,
} from "../../../../../../../modules/ui/shared";
import { DatasetPreparationNotificationBridge } from "../components/DatasetPreparationNotificationBridge";
import { announceDatasetPreparationStarted } from "../hooks/datasetPreparationNotificationEvents";

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

describe("DatasetPreparationNotificationBridge", () => {
  let root: Root | undefined;
  let container: HTMLDivElement | undefined;

  afterEach(async () => {
    if (root) await act(async () => root?.unmount());
    container?.remove();
    root = undefined;
    container = undefined;
    vi.restoreAllMocks();
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
    let intervalHandler: (() => void) | undefined;
    vi.spyOn(window, "setInterval").mockImplementation((handler) => {
      intervalHandler = handler as () => void;
      return 1;
    });
    vi.spyOn(window, "clearInterval").mockImplementation(() => undefined);

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
    expect(container.textContent).toContain("Loading the selected model");
    expect(container.textContent).toContain("0%");

    status = "succeeded";
    await act(async () => {
      intervalHandler?.();
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
    vi.spyOn(window, "setInterval").mockImplementation(
      (() => 1) as typeof window.setInterval,
    );
    vi.spyOn(window, "clearInterval").mockImplementation(() => undefined);

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
});
