import assert from "node:assert/strict";
import { test } from "node:test";
import { readUiControlAttempt, type UiControlRequestView } from "../../../../contracts/headless";
import { createWindowTakeoverController, type DraftHandoff, type TakeoverGrant, type WindowTakeoverPort } from "../windowTakeoverController";

const id = (index: number) => `e38b2781-e605-4de3-83e1-${String(index).padStart(12, "0")}`;
const request = (i: number): UiControlRequestView => {
  const target = readUiControlAttempt({
    hostIncarnationId: id(1), windowId: id(2), uiIncarnationId: id(3),
    workspaceId: "example", requestId: id(i), attemptId: id(i + 100),
  });
  assert.ok(target);
  return { target, agentSessionId: id(4), taskId: id(5), status: "pending", expiresAt: 5000 };
};
const grant = (req: UiControlRequestView): TakeoverGrant => ({
  target: { ...req.target, leaseId: id(6), generation: 1 }, remainingMs: 5_000,
});
const turn = async () => { await Promise.resolve(); await Promise.resolve(); await Promise.resolve(); };

test("revoke immediately restores manual state before sending exact cancel and suppresses a later grant", async () => {
  const pending = request(10);
  let release!: (result: TakeoverGrant) => void;
  const seen: unknown[] = [];
  const port: WindowTakeoverPort = {
    accept: () => new Promise(resolve => { release = resolve; }),
    async ready() { assert.fail("Cannot signal readiness after local revoke."); },
    async revoke(target) { seen.push([controller.getSnapshot().status, target]); return false; },
  };
  const controller = createWindowTakeoverController({ port, now: () => 0, readDraft: () => ({ status: "clean" }) });
  controller.update(pending);
  controller.accept();
  const fence = controller.fence();
  assert.equal(controller.getSnapshot().status, "activating");
  controller.revoke();
  assert.equal(controller.getSnapshot().status, "manual");
  assert.deepEqual(seen, [["manual", pending.target]]);
  assert.equal(controller.permits(grant(pending).target, fence), false);
  release(grant(pending));
  await turn();
  controller.update(pending);
  assert.equal(controller.getSnapshot().status, "manual");
  controller.close();
});

test("dirty work requires a separate explicit save and a failed save keeps manual control", async () => {
  const pending = request(10);
  let saved = 0;
  let draft: DraftHandoff = {
    status: "dirty", async save() { saved++; return false; },
  };
  const port: WindowTakeoverPort = {
    async accept() { assert.fail("Rejected save must not reach the host."); },
    async ready() { assert.fail("Rejected save must not become ready."); },
    async revoke() { return true; },
  };
  const controller = createWindowTakeoverController({ port, now: () => 0, readDraft: () => draft });
  controller.update(pending);
  controller.accept();
  assert.equal(controller.getSnapshot().status, "confirm-save");
  assert.equal(saved, 0);
  controller.saveAndAccept();
  assert.equal(saved, 1);
  await turn();
  assert.deepEqual(controller.getSnapshot(), { status: "manual", notice: "unavailable" });
  assert.equal(draft.status, "dirty");
  controller.close();
});

test("only exact ready reply activates, subsequent transport loss closes old callbacks", async () => {
  const pending = request(10);
  const active = grant(pending);
  let release!: (result: TakeoverGrant) => void;
  const seen: unknown[] = [];
  const port: WindowTakeoverPort = {
    async accept() { return active; },
    ready: () => new Promise(resolve => { release = resolve; }),
    async revoke(target) { seen.push(target); return true; },
  };
  const controller = createWindowTakeoverController({ port, now: () => 0, readDraft: () => ({ status: "clean" }) });
  controller.update(pending);
  controller.accept();
  await turn();
  assert.equal(controller.getSnapshot().status, "activating");
  assert.equal(controller.permits(active.target, controller.fence()), false);
  const observeBeforeReady = controller.beginObservation();
  release(active);
  await turn();
  observeBeforeReady({ ...pending, status: "awaiting-readiness" });
  assert.equal(controller.getSnapshot().status, "active");
  const fence = controller.fence();
  assert.equal(controller.permits(active.target, fence), true);
  assert.equal(controller.permits({ ...active.target, generation: 2 }, fence), false);
  controller.beginObservation()(undefined);
  assert.equal(controller.getSnapshot().status, "manual");
  assert.equal(controller.permits(active.target, fence), false);
  assert.deepEqual(seen, [active.target]);
  controller.close();
});

test("a held revoke for A does not delay B and its retry never substitutes B", async () => {
  const a = request(10);
  const b = request(20);
  const calls: string[] = [];
  let release!: (acknowledged: boolean) => void;
  const controller = createWindowTakeoverController({
    now: () => 0,
    readDraft: () => ({ status: "clean" }),
    port: {
      async accept() { return undefined; }, async ready() { return undefined; },
      revoke(target) {
        calls.push(target.attemptId);
        if (target.attemptId === a.target.attemptId && calls.length === 1) {
          return new Promise(resolve => { release = resolve; });
        }
        return Promise.resolve(true);
      },
    },
  });
  controller.update(a);
  controller.revoke();
  controller.update(b);
  controller.revoke();
  assert.deepEqual(calls, [a.target.attemptId, b.target.attemptId]);
  release(false);
  await turn();
  controller.beginObservation()(undefined);
  assert.deepEqual(calls, [a.target.attemptId, b.target.attemptId, a.target.attemptId]);
  controller.close();
});
