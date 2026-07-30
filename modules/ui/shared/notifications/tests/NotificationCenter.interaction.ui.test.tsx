// @ts-expect-error jsdom is a runtime test dependency without local declarations.
import { JSDOM } from "jsdom";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it } from "../../../../testing/node-test";

import { NotificationBell, NotificationViewport } from "../NotificationCenter";
import { NotificationProvider, useNotificationCenter } from "../NotificationProvider";
import { NOTIFICATION_TOAST_FADE_MS, NOTIFICATION_TOAST_VISIBLE_MS } from "../notificationState";

const dom = new JSDOM("<!doctype html><html><body></body></html>", { url: "http://localhost/" });
(globalThis as any).window = dom.window;
(globalThis as any).document = dom.window.document;
(globalThis as any).Node = dom.window.Node;
(globalThis as any).MouseEvent = dom.window.MouseEvent;
(globalThis as any).KeyboardEvent = dom.window.KeyboardEvent;
(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | undefined;
let container: HTMLDivElement | undefined;

afterEach(async () => {
  if (root) await act(async () => root?.unmount());
  container?.remove();
  root = undefined;
  container = undefined;
});

function Harness() {
  const notifications = useNotificationCenter();
  return (
    <>
      <button type="button" onClick={() => notifications.publish({ title: "Saved", message: "The record was saved.", tone: "success" })}>Publish</button>
      <NotificationBell />
      <NotificationViewport />
    </>
  );
}

describe("NotificationCenter", () => {
  it("schedules the exact five-second fade, opens the panel, and restores focus on Escape", async () => {
    const scheduled: Array<{ delay: number; handler: () => void }> = [];
    const originalSetTimeout = window.setTimeout.bind(window);
    const originalClearTimeout = window.clearTimeout.bind(window);
    window.setTimeout = ((handler: TimerHandler, delay?: number) => {
      scheduled.push({ delay: delay ?? 0, handler: handler as () => void });
      return scheduled.length as unknown as number;
    }) as typeof window.setTimeout;
    window.clearTimeout = (() => undefined) as typeof window.clearTimeout;
    try {
      container = document.createElement("div");
      document.body.appendChild(container);
      root = createRoot(container);
      await act(async () => root?.render(<NotificationProvider><Harness /></NotificationProvider>));

      const publish = Array.from(container.querySelectorAll("button")).find((button) => button.textContent === "Publish")!;
      await act(async () => publish.click());
      expect(container.querySelector(".ui-notification__toast")?.textContent).toContain("The record was saved.");
      expect(scheduled.map((item) => item.delay)).toEqual([
        NOTIFICATION_TOAST_VISIBLE_MS,
        NOTIFICATION_TOAST_VISIBLE_MS + NOTIFICATION_TOAST_FADE_MS,
      ]);

      const bell = container.querySelector<HTMLButtonElement>("#application-notification-bell")!;
      await act(async () => bell.click());
      expect(bell.getAttribute("aria-expanded")).toBe("true");
      expect(container.querySelector("#application-notification-panel")?.textContent).toContain("The record was saved.");

      await act(async () => document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })));
      expect(bell.getAttribute("aria-expanded")).toBe("false");
      expect(document.activeElement).toBe(bell);
    } finally {
      window.setTimeout = originalSetTimeout;
      window.clearTimeout = originalClearTimeout;
    }
  });
});
