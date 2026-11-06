// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { NotificationBell, NotificationViewport } from "../NotificationCenter";
import { NotificationProvider, useNotificationCenter } from "../NotificationProvider";

let root: Root;
let view: HTMLDivElement;
const publish = () => view.querySelector<HTMLButtonElement>("#publish-fixture-notification")!;
const bell = () => view.querySelector<HTMLButtonElement>("#application-notification-bell")!;
const toastDismiss = () => view.querySelector<HTMLButtonElement>('.ui-notification__toast [aria-label="Dismiss notification"]')!;

function Fixture() {
  const notifications = useNotificationCenter();
  return <>
    <button id="publish-fixture-notification" type="button" onClick={() => notifications.publish({ message: "Sample saved.", tone: "success" })}>Publish</button>
    <NotificationBell />
    <NotificationViewport />
  </>;
}

beforeEach(async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.useFakeTimers();
  view = document.body.appendChild(document.createElement("div"));
  root = createRoot(view);
  await act(async () => root.render(<NotificationProvider><Fixture /></NotificationProvider>));
  await act(async () => publish().click());
});

afterEach(async () => {
  await act(async () => root.unmount());
  view.remove();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("notification dismissal focus", () => {
  it.each([false, true])("returns focus from a dismissed toast to the notification button when panel open is %s", async (panelOpen) => {
    if (panelOpen) await act(async () => bell().click());
    const dismiss = toastDismiss();
    dismiss.focus();
    expect(document.activeElement).toBe(dismiss);
    await act(async () => dismiss.click());
    expect(dismiss.isConnected).toBe(false);
    expect(bell().getAttribute("aria-expanded")).toBe(String(panelOpen));
    expect(document.activeElement).toBe(bell());
  });

  it("keeps focus inside the open panel after dismissing a focused item", async () => {
    await act(async () => bell().click());
    const panel = view.querySelector<HTMLElement>('[role="dialog"]')!;
    const dismiss = panel.querySelector<HTMLButtonElement>('[aria-label="Dismiss notification"]')!;
    const close = panel.querySelector<HTMLButtonElement>('[aria-label="Close notifications"]')!;
    dismiss.focus();
    expect(document.activeElement).toBe(dismiss);
    await act(async () => dismiss.click());
    expect(dismiss.isConnected).toBe(false);
    expect(bell().getAttribute("aria-expanded")).toBe("true");
    expect(document.activeElement).toBe(close);
  });

  it("preserves another control's focus during an unfocused dismissal", async () => {
    const dismiss = toastDismiss();
    publish().focus();
    await act(async () => dismiss.click());
    expect(dismiss.isConnected).toBe(false);
    expect(document.activeElement).toBe(publish());
  });
});

it("allows toast text to shrink and wrap while preserving the dismiss button size", () => {
  const sheet = document.createElement("style");
  sheet.textContent = readFileSync("modules/ui/shared/styles/components/notifications.css", "utf8");
  document.head.appendChild(sheet);
  try {
    const copy = view.querySelector<HTMLElement>(".ui-notification__toast > div")!;
    const copyStyle = getComputedStyle(copy);
    expect(Number.parseFloat(copyStyle.getPropertyValue("min-inline-size"))).toBe(0);
    expect(copyStyle.getPropertyValue("overflow-wrap")).toBe("anywhere");
    expect(getComputedStyle(toastDismiss()).flexShrink).toBe("0");
  } finally {
    sheet.remove();
  }
});
