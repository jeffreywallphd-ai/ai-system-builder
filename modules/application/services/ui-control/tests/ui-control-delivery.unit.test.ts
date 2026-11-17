import assert from "node:assert/strict";
import { test } from "node:test";
import { readUiControlLeaseTarget, UI_PRESENTATION_LIMITS, type UiPresentationSubmission } from "../../../../contracts/headless";
import { createUiControlDelivery } from "../ui-control-delivery.service";

const id = (index: number) => `e38b2781-e605-4de3-83e1-${String(index).padStart(12, "0")}`;
const target = readUiControlLeaseTarget({
  hostIncarnationId: id(1), windowId: id(2), uiIncarnationId: id(3), workspaceId: "example",
  requestId: id(4), attemptId: id(5), leaseId: id(6), generation: 1,
})!;
const command = (index: number): UiPresentationSubmission => ({
  target, commandId: id(10 + index),
  intent: { action: "open-system", systemId: "example", revisionId: `revision.${index}` },
});

test("places each exact ID once, serializes delivery and preserves original terminal outcomes", () => {
  const delivery = createUiControlDelivery({ target, now: () => 1, isCurrent: () => true });
  const first = command(1);
  const second = command(2);
  assert.deepEqual(delivery.submit(first), { status: "accepted", receipt: { sequence: 1, commandId: first.commandId, status: "accepted" } });
  assert.equal(delivery.submit(second).status, "accepted");
  assert.equal(delivery.submit({ ...second, commandId: first.commandId }).status, "conflict");
  assert.deepEqual(delivery.next(target, 2), { status: "gap", sequence: 1 });
  assert.equal(delivery.acknowledge(target, 1, first.commandId, "applied"), undefined);
  assert.equal(delivery.next(target, 1).status, "delivered");
  assert.equal(delivery.acknowledge(target, 1, second.commandId, "applied"), undefined);
  assert.equal(delivery.acknowledge(target, 1, first.commandId, "applied")?.status, "applied");
  assert.equal(delivery.acknowledge(target, 1, first.commandId, "discarded")?.status, "applied");
  assert.deepEqual(delivery.submit(first), { status: "duplicate", receipt: { commandId: first.commandId, sequence: 1, status: "applied" } });
  assert.equal(delivery.next(target, 1).status, "terminal");
  assert.equal(delivery.next(target, 2).status, "delivered");
  assert.equal(delivery.next({ ...target, generation: 2 }, 2).status, "denied");
});

test("bounds queue and receipts and expiry advances only completed positions", () => {
  let now = 0;
  let live = true;
  const delivery = createUiControlDelivery({ target, now: () => now, isCurrent: () => live });
  const { queued, commandMs, receipts } = UI_PRESENTATION_LIMITS;
  for (let sequence = 1; sequence <= queued; sequence++) assert.equal(delivery.submit(command(sequence)).status, "accepted");
  assert.equal(delivery.submit(command(queued + 1)).status, "busy");
  assert.equal(delivery.next(target, 1).status, "delivered");
  now = commandMs;
  assert.deepEqual(delivery.next(target, 1), { status: "terminal",
    receipt: { commandId: command(1).commandId, sequence: 1, status: "unconfirmed" } });
  assert.equal(delivery.acknowledge(target, 1, command(1).commandId, "applied")?.status, "applied");
  assert.equal(delivery.acknowledge(target, 1, command(1).commandId, "discarded")?.status, "applied");
  assert.equal(delivery.next(target, queued).status, "terminal");
  for (let sequence = queued + 1; sequence <= receipts; sequence++) {
    assert.equal(delivery.submit(command(sequence)).status, "accepted");
    assert.equal(delivery.next(target, sequence).status, "delivered");
    assert.equal(delivery.acknowledge(target, sequence, command(sequence).commandId, "applied")?.status, "applied");
  }
  assert.equal(delivery.submit(command(receipts + 1)).status, "busy");
  assert.equal(delivery.submit(command(1)).status, "duplicate");
  live = false;
  assert.equal(delivery.next(target, receipts).status, "denied");
  live = true;
  assert.equal(delivery.next(target, receipts).status, "denied");
});

test("context stores only an exact detached projection and retires it with the lease", () => {
  let live = true;
  const delivery = createUiControlDelivery({ target, now: () => 1, isCurrent: () => live });
  const selection = { action: "show-run", runId: "run.1" };
  const context = { view: "run", ready: true, dirtyNavigationBlocked: false, selection };
  assert.equal(delivery.publishContext({ ...target, generation: 2 }, context), false);
  assert.equal(delivery.publishContext(target, { ...context, form: ["fixture"] }), false);
  assert.equal(delivery.publishContext(target, { ...context, view: "system" }), false);
  assert.equal(delivery.publishContext(target, { ...context, ready: false }), false);
  assert.equal(delivery.publishContext(target, context), true);
  selection.runId = "other";
  assert.deepEqual(delivery.readContext(target), { ...context, selection: { action: "show-run", runId: "run.1" } });
  live = false;
  assert.equal(delivery.readContext(target), undefined);
  live = true;
  assert.equal(delivery.publishContext(target, context), false);
  assert.equal(delivery.readContext(target), undefined);
});
