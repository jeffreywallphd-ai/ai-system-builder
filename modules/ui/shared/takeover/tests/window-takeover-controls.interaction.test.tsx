import assert from "node:assert/strict";
import { after, test } from "node:test";
import { JSDOM } from "jsdom";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { readUiControlAttempt } from "../../../../contracts/headless";
import { ModalDialog } from "../../components/ModalDialog";
import { WindowTakeoverControls, WindowTakeoverProvider } from "../WindowTakeoverControls";
import { createWindowTakeoverController } from "../windowTakeoverController";
import { PresentedWindowResource } from "../PresentedWindowResource";

const dom = new JSDOM("<!doctype html><body><div id='app'></div></body>", { url: "http://localhost" });
Object.assign(globalThis, { window: dom.window, document: dom.window.document, Node: dom.window.Node, IS_REACT_ACT_ENVIRONMENT: true });
after(() => dom.window.close());
const id = (index: number) => `e38b2781-e605-4de3-83e1-${String(index).padStart(12, "0")}`;

test("Context cards show the exact saved selection or accepted task without missing identifiers", async () => {
  const app = document.getElementById("app")!, root = createRoot(app);
  const reference = {workspaceId: "example" as never, contextId: id(31), taskId: id(32), kind: "rag-database" as const,
    artifactDigest: "sha256:" + "a".repeat(64)};
  try {
    await act(async () => {root.render(<PresentedWindowResource elementRef={null} intent={{action: "show-context-artifact", reference}}
      detail={{title: "Saved RAG database", summary: "Sources: 2. Chunks: 3. Size: 42 bytes."}} />);});
    assert.ok(app.querySelector('[aria-label="Resource shown by automation"]'));
    assert.deepEqual([...app.querySelectorAll("code")].map(node => node.textContent), [reference.contextId, reference.artifactDigest]);
    assert.match(app.textContent!, /Saved RAG database/); assert.doesNotMatch(app.textContent!, /undefined|private-query|private-source/);
    await act(async () => {root.render(<PresentedWindowResource elementRef={null} intent={{action: "show-context-task", taskId: reference.taskId}}
      detail={{title: "Context task", summary: "Task status: running."}} />);});
    assert.deepEqual([...app.querySelectorAll("code")].map(node => node.textContent), [reference.taskId]);
    assert.doesNotMatch(app.textContent!, /sha256:|undefined/);
    await act(async () => {root.render(<PresentedWindowResource elementRef={null} intent={{action: "show-context-query", taskId: reference.taskId}}
      detail={{title: "Context search", summary: "Status: succeeded. Citation results: 2. Cleanup: complete."}} />);});
    assert.deepEqual([...app.querySelectorAll("code")].map(node => node.textContent), [reference.taskId]);
    assert.match(app.textContent!, /Context search.*Citation results: 2/);
    assert.doesNotMatch(app.textContent!, /private-query|private-source|undefined/);
  } finally {await act(async () => {root.unmount();});}
});

test("stacks an out-of-flow consent dialog over an ordinary dialog and restores its control on revoke", async () => {
  const target = readUiControlAttempt({ hostIncarnationId: id(1), windowId: id(2), uiIncarnationId: id(3),
    workspaceId: "example", requestId: id(4), attemptId: id(5) });
  assert.ok(target);
  const grant = { target: { ...target, leaseId: id(8), generation: 1 }, remainingMs: 2_000 };
  const rescinded: unknown[] = [];
  let finishReady!: (value: typeof grant) => void;
  const readiness = new Promise<typeof grant>(resolve => {finishReady = resolve;});
  let submits = 0;
  let clicks = 0;
  const controller = createWindowTakeoverController({
    now: () => 0, readDraft: () => ({ status: "clean" }),
    port: { async accept() { return grant; }, async ready() { return readiness; },
      async revoke(value) { rescinded.push(value); return false; } },
  });
  const control = { controller, registerDraft: () => () => {} };
  const app = document.getElementById("app")!;
  const root = createRoot(app);
  const content = (open: boolean) => (
    <WindowTakeoverProvider control={control}>
      <WindowTakeoverControls workspaceLabel="Fixture workspace" />
      <ModalDialog open={open} title="Ordinary dialog" onClose={() => {}}>
        <form onSubmit={event => {event.preventDefault(); submits++;}}>
          <button type="button" onClick={() => {clicks++;}}>Read details</button>
          <button type="submit">Save changes</button>
        </form>
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
    const form = dialog.querySelector("form")!;
    const readDetails = form.querySelector<HTMLButtonElement>("button[type='button']")!;
    function attemptBodyActions() {
      form.dispatchEvent(new dom.window.Event("submit", {bubbles: true, cancelable: true}));
      readDetails.click();
    }
    await act(async () => {
      accept.click();
      assert.equal(controller.getSnapshot().status, "activating");
      attemptBodyActions();
      assert.deepEqual([submits, clicks], [0, 0]);
    });
    await act(async () => finishReady(grant));
    assert.equal(controller.getSnapshot().status, "active");
    assert.equal(consent.isConnected, false);
    assert.ok(dialog.querySelector(".ui-modal-body")?.hasAttribute("inert"));
    attemptBodyActions();
    assert.deepEqual([submits, clicks], [0, 0]);
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
    attemptBodyActions();
    assert.deepEqual([submits, clicks], [1, 1]);
    assert.match(app.textContent!, /Chat tasks can continue/);
  } finally {
    finishReady(grant);
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
