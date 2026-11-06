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
    <button id="open-fixture-panel" type="button" onClick={() => notifications.setPanelOpen(true)}>Open panel</button>
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

  it.each(["mousedown", "touchstart"])("keeps another control focused when %s closes the panel", async (eventType) => {
    await act(async () => bell().click());
    const outside = publish();
    outside.focus();
    expect(bell().getAttribute("aria-expanded")).toBe("true");
    expect(document.activeElement).toBe(outside);

    await act(async () => outside.dispatchEvent(new Event(eventType, { bubbles: true })));

    expect(view.querySelector('[role="dialog"]')).toBeNull();
    expect(document.activeElement).toBe(outside);
  });

  it.each(["Escape", "Close"])("returns focus on %s after a batched close and reopen", async (action) => {
    await act(async () => bell().click());
    const panel = view.querySelector<HTMLElement>('[role="dialog"]')!;
    const reopen = view.querySelector<HTMLButtonElement>("#open-fixture-panel")!;
    const outside = publish();
    outside.focus();
    await act(async () => {
      outside.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
      reopen.click();
    });

    expect(view.querySelector('[role="dialog"]')).toBe(panel);
    expect(document.activeElement).toBe(outside);
    await act(async () => {
      if (action === "Escape") {
        outside.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
      } else {
        panel.querySelector<HTMLButtonElement>('[aria-label="Close notifications"]')!.click();
      }
    });

    expect(view.querySelector('[role="dialog"]')).toBeNull();
    expect(document.activeElement).toBe(bell());
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

it("keeps live toast text while the narrow open panel owns the visible controls", async () => {
  await act(async () => bell().click());
  const panel = view.querySelector<HTMLElement>(".ui-notification__panel")!;
  const toasts = view.querySelector<HTMLElement>(".ui-notification__panel + .ui-notification__toasts")!;
  expect(panel.textContent).toContain("Sample saved.");
  expect(toasts.getAttribute("aria-live")).toBe("polite");
  expect(toasts.querySelector('[role="status"]')?.textContent).toContain("Sample saved.");
  expect(document.activeElement).toBe(panel.querySelector('[aria-label="Close notifications"]'));

  const sheet = document.createElement("style");
  sheet.textContent = readFileSync("modules/ui/shared/styles/components/notifications.css", "utf8");
  document.head.appendChild(sheet);
  try {
    const media = Array.from(sheet.sheet!.cssRules)
      .filter((rule): rule is CSSMediaRule => rule.type === CSSRule.MEDIA_RULE);
    const narrow = media.find(rule => rule.media.mediaText === "(max-width: 54rem)");
    expect(narrow).toBeDefined();
    const rules = Array.from(narrow!.cssRules).filter((rule): rule is CSSStyleRule => rule.type === CSSRule.STYLE_RULE);
    const adjacent = ".ui-notification__panel + .ui-notification__toasts";
    expect(rules.find(rule => rule.selectorText === adjacent + ":not(:focus-within)")?.style.getPropertyValue("clip-path")).toBe("inset(50%)");
    const otherToast = adjacent + " .ui-notification__toast:not(:focus-within)";
    expect(rules.find(rule => rule.selectorText === otherToast + " .ui-notification__icon-button")?.style.display).toBe("none");
    expect(rules.find(rule => rule.selectorText === adjacent + ":focus-within")?.style.getPropertyValue("inset-block-end")).toBe("var(--space-sm)");
    expect(rules.find(rule => rule.selectorText === adjacent + " .ui-notification__toast:focus-within")?.style.overflow).toBe("auto");
  } finally {
    sheet.remove();
  }
});
