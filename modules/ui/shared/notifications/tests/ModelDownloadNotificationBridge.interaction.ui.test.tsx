import { useTaskObservationManager } from "../TaskObservationProvider";
import type { TaskObservationManager } from "../taskObservation";
// @ts-expect-error jsdom is a runtime test dependency without local declarations.
import { JSDOM } from "jsdom";
import { act, useEffect } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, testDouble } from "../../../../testing/node-test";
import { createWorkspaceId } from "../../../../contracts/workspace";

import { ModelDownloadNotificationBridge } from "../ModelDownloadNotificationBridge";
import { NotificationBell, NotificationViewport } from "../NotificationCenter";
import { NotificationProvider, useNotificationCenter } from "../NotificationProvider";

const dom = new JSDOM("<!doctype html><html><body></body></html>", { url: "http://localhost/" });
(globalThis as any).window = dom.window;
(globalThis as any).document = dom.window.document;
(globalThis as any).Node = dom.window.Node;
(globalThis as any).MouseEvent = dom.window.MouseEvent;
(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | undefined;
let container: HTMLDivElement | undefined;

function ActiveWorkspace({ workspaceId }: { readonly workspaceId: string }) {
  const notifications = useNotificationCenter();
  useEffect(() => notifications.setActiveWorkspaceId(workspaceId), [notifications.setActiveWorkspaceId, workspaceId]);
  return null;
}

afterEach(async () => {
  if (root) await act(async () => root?.unmount());
  container?.remove();
  root = undefined;
  container = undefined;
});

describe("ModelDownloadNotificationBridge", () => {
  it("keeps authoritative progress visible and announces a later terminal transition", async () => {
    const workspaceId = createWorkspaceId("workspace.downloads");
    let status: "running" | "succeeded" = "running";
    const listModelDownloads = testDouble.fn(async () => ({ activities: [{
      requestId: "download-1",
      workspaceId,
      modelId: "org/model",
      displayName: "Demo model",
      status,
      progress: status === "running" ? { current: 25, total: 100, percent: 25, unit: "bytes", message: "Downloading model." } : undefined,
    }] }));
    let intervalHandler: (() => void) | undefined;
    const originalSetInterval = globalThis.setTimeout;
    const originalClearInterval = globalThis.clearTimeout;
    globalThis.setTimeout = ((handler: () => void, delay: number, ...args: any[]) => { if (delay === 1000) { intervalHandler = handler; return 1; } return originalSetInterval(handler, delay, ...args); }) as typeof globalThis.setTimeout;
    globalThis.clearTimeout = ((timer: any) => { if (timer !== 1) originalClearInterval(timer); }) as typeof globalThis.clearTimeout;
    try {
      container = document.createElement("div");
      document.body.appendChild(container);
      root = createRoot(container);
      await act(async () => root?.render(
        <NotificationProvider>
          <ActiveWorkspace workspaceId={workspaceId} />
          <ModelDownloadNotificationBridge client={{ listModelDownloads }} workspaceId={workspaceId} />
          <NotificationBell />
          <NotificationViewport />
        </NotificationProvider>,
      ));
      await act(async () => Promise.resolve());
      const bell = container.querySelector<HTMLButtonElement>("#application-notification-bell")!;
      await act(async () => bell.click());
      expect(container.textContent).toContain("Demo model");
      expect(container.textContent).toContain("25%");

      status = "succeeded";
      await act(async () => { intervalHandler?.(); await Promise.resolve(); });
      expect(container.textContent).toContain("Model download completed.");
      expect(container.querySelector(".ui-notification__badge")?.textContent).toBe("1");
      expect(listModelDownloads.mock.calls[0]?.[0]).toMatchObject({ workspaceId, includeCompleted: true, limit: 100 });
    } finally {
      globalThis.setTimeout = originalSetInterval;
      globalThis.clearTimeout = originalClearInterval;
    }
  });
});

it("announces only new terminal IDs while a newest-first window grows beyond100", async () => {
  const workspaceId = createWorkspaceId("workspace.downloads"); let newest = 100; let observer!: TaskObservationManager;
  const client = { listModelDownloads: async () => ({ activities: Array.from({ length: 100 }, (_, index) => ({ requestId: String(newest - index), workspaceId, displayName: `Model ${newest - index}`, modelId: "org/model", status: "succeeded" as const })) }) };
  function Records() { const n = useNotificationCenter(); observer = useTaskObservationManager(); return <p data-count={n.records.length}>{n.records.map((r) => r.title).join("|")}</p>; }
  container = document.createElement("div"); document.body.appendChild(container); root = createRoot(container);
  await act(async () => { root!.render(<NotificationProvider><ActiveWorkspace workspaceId={workspaceId} /><ModelDownloadNotificationBridge client={client} workspaceId={workspaceId} /><Records /></NotificationProvider>); });
  expect(container.querySelector("[data-count]")?.getAttribute("data-count")).toBe("0");
  for (newest = 101; newest <= 102; newest++) {
    await act(async () => { observer.invalidate({ workspaceId, family: "model-download" }); await Promise.resolve(); });
    expect(container.querySelector("[data-count]")?.getAttribute("data-count")).toBe(String(newest - 100));
  }
});
