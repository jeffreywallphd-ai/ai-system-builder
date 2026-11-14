import assert from "node:assert/strict";
import { after, test } from "node:test";
import { JSDOM } from "jsdom";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { readUiControlAttempt } from "../../../../contracts/headless";
import { ModalDialog } from "../../components/ModalDialog";
import { WindowTakeoverControls, WindowTakeoverProvider } from "../WindowTakeoverControls";
import { createWindowTakeoverController } from "../windowTakeoverController";

const dom = new JSDOM("<!doctype html><body><div id='app'></div></body>", { url: "http://localhost" });
Object.assign(globalThis, { window: dom.window, document: dom.window.document, Node: dom.window.Node, IS_REACT_ACT_ENVIRONMENT: true });
after(() => dom.window.close());
const id = (index: number) => `e38b2781-e605-4de3-83e1-${String(index).padStart(12, "0")}`;

test("stacks an out-of-flow consent dialog over an ordinary dialog and restores its control on revoke", async () => {
  const target = readUiControlAttempt({ hostIncarnationId: id(1), windowId: id(2), uiIncarnationId: id(3),
    workspaceId: "example", requestId: id(4), attemptId: id(5) });
  assert.ok(target);
  const grant = { target: { ...target, leaseId: id(8), generation: 1 }, remainingMs: 2_000 };
  const rescinded: unknown[] = [];
  const controller = createWindowTakeoverController({
    now: () => 0, readDraft: () => ({ status: "clean" }),
    port: { async accept() { return grant; }, async ready() { return grant; },
      async revoke(value) { rescinded.push(value); return false; } },
  });
  const control = { controller, registerDraft: () => () => {} };
  const app = document.getElementById("app")!;
  const root = createRoot(app);
  const content = (open: boolean) => (
    <WindowTakeoverProvider control={control}>
      <WindowTakeoverControls workspaceLabel="Fixture workspace" />
      <ModalDialog open={open} title="Ordinary dialog" onClose={() => {}}>
        <button type="button">Read details</button>
      </ModalDialog>
    </WindowTakeoverProvider>
  );
  try {
    await act(async () => root.render(content(true)));
    const dialog = document.querySelector("[role='dialog']")!;
    await act(async () => controller.update({ target, status: "pending", agentSessionId: id(6), taskId: id(7), expiresAt: 1000 }));
    const consent = document.querySelector(".ui-window-takeover-consent-overlay [role='dialog']")!;
    assert.equal(consent.getAttribute("aria-modal"), "true");
    assert.equal(consent.parentElement?.parentElement, document.body);
    assert.equal(app.querySelector("[role='dialog']"), null);
    assert.match(consent.textContent!, /Fixture workspace/);
    assert.equal(document.activeElement?.textContent, "Decline");
    const accept = [...consent.querySelectorAll("button")].find(button => button.textContent === "Accept automation takeover");
    assert.ok(accept);
    await act(async () => accept.click());
    assert.equal(controller.getSnapshot().status, "active");
    assert.equal(consent.isConnected, false);
    assert.ok(dialog.querySelector(".ui-modal-body")?.hasAttribute("inert"));
    const revoke = [...dialog.querySelectorAll("button")].find(button => button.textContent?.trim() === "Revoke automation takeover");
    assert.ok(revoke);
    revoke.focus();
    assert.equal(document.activeElement, revoke);
    await act(async () => revoke.click());
    assert.equal(controller.getSnapshot().status, "manual");
    assert.deepEqual(rescinded, [grant.target]);
    assert.equal(document.querySelector("[role='dialog']"), dialog);
    assert.equal(dialog.querySelector(".ui-modal-body")?.hasAttribute("inert"), false);
    assert.equal(document.activeElement, dialog.querySelector("button.ui-modal-close"));
    assert.match(app.textContent!, /Chat tasks can continue/);
  } finally {
    await act(async () => root.unmount());
    controller.close();
  }
});

test("Escape declines the exact request and returns focus without accepting it", async () => {
  const target = readUiControlAttempt({ hostIncarnationId: id(11), windowId: id(12), uiIncarnationId: id(13),
    workspaceId: "example", requestId: id(14), attemptId: id(15) });
  assert.ok(target);
  const declined: unknown[] = [];
  const controller = createWindowTakeoverController({
    now: () => 0, readDraft: () => ({ status: "clean" }),
    port: { async accept() { assert.fail("Escape cannot accept"); }, async ready() { assert.fail("No readiness"); },
      async revoke(value) { declined.push(value); return true; } },
  });
  const root = createRoot(document.getElementById("app")!);
  const content = (ordinaryOpen: boolean) => (
    <WindowTakeoverProvider control={{ controller, registerDraft: () => () => {} }}>
      <button type="button">Previous control</button>
      <WindowTakeoverControls />
      <ModalDialog open={ordinaryOpen} title="Late ordinary dialog" stacked onClose={() => assert.fail("Consent owns Escape")}>
        <button type="button" data-modal-initial-focus>Late dialog action</button>
      </ModalDialog>
    </WindowTakeoverProvider>
  );
  const pressEscape = () => act(async () => document.activeElement?.dispatchEvent(new dom.window.KeyboardEvent("keydown", {
    key: "Escape", bubbles: true, cancelable: true,
  })));
  try {
    await act(async () => root.render(content(false)));
    const previous = document.querySelector("button")!;
    previous.focus();
    await act(async () => controller.update({ target, status: "pending", agentSessionId: id(16), taskId: id(17), expiresAt: 1000 }));
    await pressEscape();
    assert.equal(document.querySelector("[role='dialog']"), null);
    assert.equal(document.activeElement, previous);
    assert.deepEqual(declined, [target]);

    const next = { ...target, requestId: id(18), attemptId: id(19) };
    await act(async () => controller.update({ target: next, status: "pending", agentSessionId: id(16), taskId: id(17), expiresAt: 1000 }));
    await act(async () => root.render(content(true)));
    const consent = document.querySelector(".ui-window-takeover-consent-overlay")!;
    assert.ok(consent.contains(document.activeElement));
    assert.equal(document.activeElement?.textContent, "Decline");
    await pressEscape();
    assert.equal(document.querySelector(".ui-window-takeover-consent-overlay"), null);
    assert.equal(document.querySelector("[role='dialog'] h2")?.textContent, "Late ordinary dialog");
    assert.equal(document.activeElement?.textContent, "Late dialog action");
    assert.deepEqual(declined, [target, next]);
  } finally {
    await act(async () => root.unmount());
    controller.close();
  }
});

test("keeps the classic scrollbar gutter stable through consent and restores its original style", async () => {
  const html = document.documentElement;
  Object.defineProperty(html, "clientWidth", { configurable: true, value: window.innerWidth - 15 });
  html.style.scrollbarGutter = "auto";
  const app = document.getElementById("app")!;
  const root = createRoot(app);
  const dialogs = (childOpen: boolean, parentOpen: boolean) => (
    <>
      <ModalDialog open={parentOpen} title="Parent" onClose={() => {}}>Parent details</ModalDialog>
      <ModalDialog open={childOpen} title="Child" stacked onClose={() => {}}>Child details</ModalDialog>
    </>
  );
  try {
    await act(async () => root.render(dialogs(true, true)));
    assert.equal(html.style.scrollbarGutter, "stable");
    await act(async () => root.render(dialogs(false, true)));
    assert.equal(html.style.scrollbarGutter, "stable");
    await act(async () => root.render(dialogs(false, false)));
    assert.equal(html.style.scrollbarGutter, "auto");
  } finally {
    await act(async () => root.unmount());
    delete (html as unknown as { clientWidth?: number }).clientWidth;
    html.style.scrollbarGutter = "";
  }
});
