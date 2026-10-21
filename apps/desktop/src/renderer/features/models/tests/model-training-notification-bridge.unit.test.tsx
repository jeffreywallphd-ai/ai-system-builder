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
    expect(container.textContent).toContain("Batch [3]/[10]");
    expect(container.textContent).toContain("30%");

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
});
