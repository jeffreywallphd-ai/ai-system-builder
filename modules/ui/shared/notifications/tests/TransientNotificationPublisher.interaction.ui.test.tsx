// @ts-expect-error jsdom is a runtime test dependency without local declarations.
import { JSDOM } from "jsdom";
import { act, useEffect } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it } from "../../../../testing/node-test";

import { NotificationProvider, useNotificationCenter } from "../NotificationProvider";
import { TransientNotificationPublisher } from "../TransientNotificationPublisher";

const dom = new JSDOM("<!doctype html><html><body></body></html>", { url: "http://localhost/" });
(globalThis as any).window = dom.window;
(globalThis as any).document = dom.window.document;
(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | undefined;
let container: HTMLDivElement | undefined;

afterEach(async () => {
  if (root) await act(async () => root?.unmount());
  container?.remove();
  root = undefined;
  container = undefined;
});

function Records() {
  const notifications = useNotificationCenter();
  return <output data-count={notifications.records.length}>{notifications.records[0]?.id ?? ""}</output>;
}

function ActiveWorkspace() {
  const notifications = useNotificationCenter();
  useEffect(() => notifications.setActiveWorkspaceId("workspace.publisher"), [notifications.setActiveWorkspaceId]);
  return null;
}

function Harness({ message }: { readonly message?: string }) {
  return (
    <NotificationProvider>
      <ActiveWorkspace />
      <TransientNotificationPublisher
        message={message}
        title="Asset saved"
        tone="success"
        source="Asset Studio"
        workspaceId="workspace.publisher"
      />
      <Records />
    </NotificationProvider>
  );
}

describe("TransientNotificationPublisher", () => {
  it("publishes once per message transition and permits the same later outcome", async () => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);

    await act(async () => root?.render(<Harness message="Saved." />));
    const firstId = container.querySelector("output")?.textContent;
    expect(container.querySelector("output")?.getAttribute("data-count")).toBe("1");

    await act(async () => root?.render(<Harness message="Saved." />));
    expect(container.querySelector("output")?.textContent).toBe(firstId);

    await act(async () => root?.render(<Harness />));
    await act(async () => root?.render(<Harness message="Saved." />));
    expect(container.querySelector("output")?.textContent).not.toBe(firstId);
    expect(container.querySelector("output")?.getAttribute("data-count")).toBe("1");
  });

  it("is safe in isolated reusable-component tests without an application provider", async () => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    await act(async () => root?.render(
      <TransientNotificationPublisher message="Saved." source="Isolated preview" />,
    ));
    expect(container.textContent).toBe("");
  });
});
