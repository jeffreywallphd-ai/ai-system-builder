import assert from "node:assert/strict";
import { test } from "node:test";
import { readUiControlLeaseTarget, UI_PRESENTATION_LIMITS, type UiPresentationDelivery } from "../../../../contracts/headless";
import { createPresentationQueue } from "../presentationQueue";

const id = (index: number) => `e38b2781-e605-4de3-83e1-${String(index).padStart(12, "0")}`;
const target = readUiControlLeaseTarget({
  hostIncarnationId: id(1), windowId: id(2), uiIncarnationId: id(3), workspaceId: "example",
  requestId: id(4), attemptId: id(5), leaseId: id(6), generation: 1,
})!;
const command = (sequence: number): UiPresentationDelivery => ({
  target, sequence, remainingMs: 5_000, commandId: id(10 + sequence),
  intent: { action: "show-run", runId: `run.${sequence}` },
});
const turn = async () => { await Promise.resolve(); await Promise.resolve(); };

test("a missing position holds later actions and terminal retries never repeat the effect", async () => {
  const effects: string[] = [];
  const acks: unknown[] = [];
  const gaps: number[] = [];
  const queue = createPresentationQueue({
    target, now: () => 0, isCurrent: () => true,
    async prepare(intent) { return () => { effects.push(intent.action === "show-run" ? intent.runId : "unexpected"); return true; }; },
    acknowledge(value, outcome) { acks.push([value.sequence, outcome]); },
    requestMissing(sequence) { gaps.push(sequence); },
    detach() { assert.fail("Unexpected detachment"); },
  });
  try {
    assert.equal(queue.receive(command(2), 0), "queued");
    assert.deepEqual(gaps, [1]);
    await turn();
    assert.deepEqual(effects, []);
    queue.receive(command(1), 0);
    await turn();
    assert.deepEqual(effects, ["run.1", "run.2"]);
    assert.equal(queue.receive(command(1), 0), "duplicate");
    assert.deepEqual(acks, [[1, "applied"], [2, "applied"], [1, "applied"]]);
    assert.deepEqual(effects, ["run.1", "run.2"]);
  } finally { queue.close(); }
});

test("a late read after revoke never presents or publishes acknowledgment", async () => {
  let release!: (effect: () => boolean) => void;
  let didAbort = false;
  let authorized = true;
  const queue = createPresentationQueue({
    target, now: () => 0, isCurrent: () => authorized,
    prepare(_intent, signal) {
      signal.addEventListener("abort", () => { didAbort = true; });
      return new Promise(resolve => { release = resolve; });
    },
    acknowledge() { assert.fail("Revoked result must not acknowledge."); },
    requestMissing() { assert.fail("No gap"); },
    detach() { assert.fail("No queue fault"); },
  });
  queue.receive(command(1), 0);
  authorized = false;
  release(() => assert.fail("End-of-lease result must not run."));
  await turn();
  assert.equal(didAbort, true);
  assert.equal(queue.receive(command(1), 0), "denied");
});

test("an excessive sequence gap ends presentation and cannot be resumed by old commands", () => {
  let detached = 0;
  const queue = createPresentationQueue({
    target, now: () => 0, isCurrent: () => true,
    async prepare() { assert.fail("Gaps cannot prepare"); },
    acknowledge() { assert.fail("Gaps cannot acknowledge"); },
    requestMissing(sequence) { assert.equal(sequence, 1); },
    detach() { detached++; },
  });
  const lastAllowed = 1 + UI_PRESENTATION_LIMITS.gap;
  assert.equal(queue.receive(command(lastAllowed), 0), "queued");
  assert.equal(queue.receive(command(lastAllowed + 1), 0), "detached");
  assert.equal(detached, 1);
  assert.equal(queue.receive(command(1), 0), "denied");
});

test("a host-expired position allows ordered progress and delayed copies stay discarded", async () => {
  const effects: string[] = [];
  const acknowledgments: UiPresentationDelivery[] = [];
  const queue = createPresentationQueue({
    target, now: () => 0, isCurrent: () => true,
    async prepare(intent) {
      return () => { if (intent.action === "show-run") effects.push(intent.runId); return true; };
    },
    acknowledge(delivery) { acknowledgments.push(delivery); },
    requestMissing(next) { assert.equal(next, 1); },
    detach() { assert.fail("The exact expired position can be recovered."); },
  });
  try {
    const first = command(1);
    queue.receive(command(2), 0);
    assert.equal(queue.skip({ ...target, generation: 2 }, 1, first.commandId), false);
    assert.equal(queue.skip(target, 2, first.commandId), false);
    assert.equal(queue.skip(target, 1, first.commandId), true);
    await turn();
    assert.equal(queue.receive(first, 0), "duplicate");
    assert.deepEqual(effects, ["run.2"]);
    assert.deepEqual(acknowledgments.map(entry => entry.sequence), [2, 1]);
  } finally { queue.close(); }
});

test("a gap expires on the monotonic clock even when its timer callback is delayed", () => {
  let now = 0;
  let detached = 0;
  const queue = createPresentationQueue({
    target, now: () => now, isCurrent: () => true,
    async prepare() { assert.fail("Expired gap cannot prepare"); },
    acknowledge() { assert.fail("Expired gap cannot acknowledge"); },
    requestMissing(sequence) { assert.equal(sequence, 1); },
    detach() { detached++; },
  });
  queue.receive(command(2), 0);
  now = UI_PRESENTATION_LIMITS.commandMs;
  assert.equal(queue.receive(command(1), now), "detached");
  assert.equal(detached, 1);
  assert.equal(queue.skip(target, 1, command(1).commandId), false);
});

test("a timed out command cannot override a later successful action under the same lease", async () => {
  let release!: (effect: () => boolean) => void;
  let timedOut!: () => void;
  const effects: string[] = [];
  const acks: unknown[] = [];
  const receivedDuringAbort: string[] = [];
  const queue = createPresentationQueue({
    target, now: () => 0, isCurrent: () => true,
    prepare(intent, signal) {
      if (intent.action === "show-run" && intent.runId === "run.1") {
        signal.addEventListener("abort", () => { receivedDuringAbort.push(queue.receive(command(1), 0)); });
        return new Promise(resolve => { release = resolve; });
      }
      return Promise.resolve(() => { effects.push("second"); return true; });
    },
    acknowledge(value, outcome) {
      acks.push([value.sequence, outcome]);
      if (value.sequence === 1) timedOut();
    },
    requestMissing() { assert.fail("No gap"); },
    detach() { assert.fail("Timeout is terminal for one command"); },
  });
  try {
    const timeout = new Promise<void>(resolve => { timedOut = resolve; });
    queue.receive({ ...command(1), remainingMs: 1 }, 0);
    queue.receive(command(2), 0);
    await timeout;
    await turn();
    release(() => { effects.push("late"); return true; });
    await turn();
    assert.deepEqual(effects, ["second"]);
    assert.deepEqual(receivedDuringAbort, ["duplicate"]);
    assert.deepEqual(acks, [[1, "discarded"], [1, "discarded"], [2, "applied"]]);
  } finally { queue.close(); }
});
