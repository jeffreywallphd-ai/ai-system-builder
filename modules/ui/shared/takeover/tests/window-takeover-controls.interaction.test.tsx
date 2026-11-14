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

test("shows the exact ticket and puts revoke inside the ordinary dialog focus trap", async () => {
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
    await act(async () => root.render(content(false)));
    await act(async () => controller.update({ target, status: "pending", agentSessionId: id(6), taskId: id(7), expiresAt: 1000 }));
    assert.match(app.textContent!, /Fixture workspace/);
    const accept = [...app.querySelectorAll("button")].find(button => button.textContent === "Accept automation takeover");
    assert.ok(accept);
    await act(async () => accept.click());
    assert.equal(controller.getSnapshot().status, "active");
    await act(async () => root.render(content(true)));
    const dialog = document.querySelector("[role='dialog']")!;
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
