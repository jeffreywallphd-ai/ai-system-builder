import assert from "node:assert/strict";
import { test } from "node:test";
import { BoundedTaskIds, TaskObservationManager, type TaskObservationClock } from "../taskObservation";

class Clock implements TaskObservationClock {
  now = 0;
  private id = 0;
  private timers = new Map<number, { due: number; callback: () => void }>();
  setTimeout(callback: () => void, ms: number) { const id = ++this.id; this.timers.set(id, { due: this.now + ms, callback }); return id; }
  clearTimeout(id: unknown) { this.timers.delete(id as number); }
  async flush() { for (let n = 0; n < 12; n++) await Promise.resolve(); }
  async advance(ms: number) {
    const end = this.now + ms;
    await this.flush();
    for (;;) {
      const next = [...this.timers].sort((a, b) => a[1].due - b[1].due)[0];
      if (!next || next[1].due > end) break;
      this.now = next[1].due; this.timers.delete(next[0]); next[1].callback(); await this.flush();
    }
    this.now = end; await this.flush();
  }
}
const scope = { workspaceId: "workspace-a", family: "download" };

test("ten-minute idle request measurement reduces each fixed 1500ms bridge by at least 80 percent", async () => {
  for (const family of ["download", "context"]) {
    const clock = new Clock(); const manager = new TaskObservationManager(clock);
    let requests = 0;
    manager.subscribe({ ...scope, family }, async () => { requests++; return { value: [], activity: "idle" }; }, () => {});
    await clock.advance(600_000);
    const baseline = 1 + Math.floor(600_000 / 1500);
    assert.equal(baseline, 401);
    assert.equal(requests, 24);
    assert.ok(requests <= baseline * .2);
    manager.dispose();
  }
});

test("duplicate subscribers share a flight, explicit actions queue only one immediate refresh, and families serialize", async () => {
  const clock = new Clock(); const manager = new TaskObservationManager(clock);
  let release!: () => void; let calls = 0; let second = 0;
  const barrier = new Promise<void>((resolve) => { release = resolve; });
  const read = async () => { calls++; await barrier; return { value: calls, activity: "active" as const }; };
  manager.subscribe(scope, read, () => {}); manager.subscribe(scope, read, () => {});
  assert.equal(calls, 1);
  manager.subscribe({ ...scope, requestId: "detail" }, async () => { second++; return { value: 0, activity: "terminal" }; }, () => {});
  assert.equal(second, 0);
  for (let n = 0; n < 20; n++) manager.invalidate(scope);
  assert.equal(calls, 1);
  release(); await clock.flush();
  assert.equal(calls, 2); assert.equal(second, 1);
  manager.dispose();
});

for (const mode of ["idle", "error"] as const) {
  test(`explicit invalidation immediately interrupts maximum ${mode} backoff without advancing time`, async () => {
    const clock = new Clock(); const manager = new TaskObservationManager(clock);
    let requests = 0; let active = false; let inFlight = 0; let peakFlights = 0;
    const seen: number[] = [];
    manager.subscribe(scope, async () => {
      requests++; inFlight++; peakFlights = Math.max(peakFlights, inFlight);
      try {
        await Promise.resolve();
        if (mode === "error" && !active) throw new Error("Synthetic transport failure.");
        return { value: requests, activity: active ? "active" : "idle" };
      } finally { inFlight--; }
    }, (result) => { if (result) seen.push(result.value); });
    // Both schedules reach their capped backoff well before this point.
    await clock.advance(120_000);
    assert.equal(inFlight, 0);
    const before = requests;
    await clock.advance(1);
    assert.equal(requests, before, "A future idle/error timer must actually be pending.");
    active = true;
    manager.invalidate({ ...scope, workspaceId: "workspace-b" });
    await clock.flush(); assert.equal(requests, before, "Foreign workspace cannot invalidate this reader.");
    const invalidatedAt = clock.now;
    manager.invalidate(scope);
    await clock.flush();
    assert.equal(clock.now, invalidatedAt);
    assert.equal(requests, before + 1);
    assert.equal(seen.at(-1), before + 1);
    assert.equal(peakFlights, 1);
    manager.dispose();
    await clock.advance(60_000);
    assert.equal(requests, before + 1);
  });
}

test("late unsubscribed replies cannot publish into a replacement workspace or subscriber", async () => {
  const clock = new Clock(); const manager = new TaskObservationManager(clock);
  let release!: (value: any) => void;
  const old: unknown[] = [], replacement: unknown[] = [], other: unknown[] = [];
  const stop = manager.subscribe(scope, () => new Promise((resolve) => { release = resolve; }), (r) => old.push(r));
  stop();
  manager.subscribe(scope, async () => ({ value: "replacement", activity: "terminal" }), (r) => replacement.push(r?.value));
  stop(); // Repeated disposal cannot remove the replacement subscription.
  manager.subscribe({ ...scope, workspaceId: "workspace-b" }, async () => ({ value: "other", activity: "terminal" }), (r) => other.push(r?.value));
  release({ value: "old", activity: "terminal" }); await clock.flush();
  assert.deepEqual(old, []); assert.deepEqual(replacement, ["replacement"]); assert.deepEqual(other, ["other"]);
  manager.dispose(); assert.equal(manager.subscriptionCount, 0);
});

test("one-shot reads share observation and reject when their session is disposed", async () => {
  const clock = new Clock(); const manager = new TaskObservationManager(clock); let calls = 0;
  const read = async () => { calls++; return { value: "same", activity: "active" as const }; };
  assert.deepEqual(await Promise.all([manager.readOnce(scope, read), manager.readOnce(scope, read)]), ["same", "same"]);
  await clock.flush(); assert.equal(calls, 1); assert.equal(manager.subscriptionCount, 0);
  const pending = manager.readOnce(scope, () => new Promise(() => {}));
  manager.dispose(); await assert.rejects(pending, /unavailable/);
});

test("errors retain identity and retry; hidden observation pauses and visibility refreshes immediately", async () => {
  const clock = new Clock(); const manager = new TaskObservationManager(clock); let requests = 0; const seen: unknown[] = [];
  manager.subscribe(scope, async () => { if (++requests === 1) throw new Error("private transport failure"); return { value: "recovered", activity: "active" }; }, (r) => seen.push(r?.value));
  await clock.advance(1500); assert.deepEqual(seen, [undefined, "recovered"]);
  manager.setVisible(false); await clock.advance(60_000); assert.equal(requests, 2);
  manager.setVisible(true); await clock.flush(); assert.equal(requests, 3);
  manager.dispose();
});

test("healthy 100ms transport delivers active and terminal updates within two seconds at p95", async () => {
  const clock = new Clock(); const manager = new TaskObservationManager(clock); const delays: number[] = [];
  let version = 0, changedAt = 0;
  manager.subscribe(scope, async () => { await new Promise<void>((resolve) => clock.setTimeout(resolve, 100)); return { value: version, activity: version === 30 ? "terminal" : "active" }; }, (r) => { if (r?.value) delays.push(clock.now - changedAt); });
  await clock.advance(100);
  for (version = 1; version <= 30; version++) { changedAt = clock.now; await clock.advance(1100); }
  assert.equal(delays.length, 30); assert.equal(delays.sort((a, b) => a - b)[28], 1100);
  manager.dispose();
});

test("terminal retention and subscriptions have finite bounds", () => {
  const ids = new BoundedTaskIds(); for (let n = 0; n < 1000; n++) ids.add(String(n));
  assert.equal(ids.size, 100); assert.equal(ids.has("0"), false); assert.equal(ids.has("999"), true);
  const manager = new TaskObservationManager();
  for (let n = 0; n < 128; n++) manager.subscribe({ ...scope, requestId: String(n) }, async () => ({ value: 0, activity: "terminal" }), () => {});
  assert.throws(() => manager.subscribe({ ...scope, requestId: "overflow" }, async () => ({ value: 0, activity: "terminal" }), () => {}), /capacity/);
  manager.dispose();
});


test("a surviving subscriber takes read ownership and never receives a detached reader's late result", async () => {
  const clock = new Clock(); const manager = new TaskObservationManager(clock);
  let release!: (value: any) => void; let reads = 0; const seen: unknown[] = [];
  const stop = manager.subscribe(scope, () => new Promise((resolve) => { release = resolve; }), () => {});
  manager.subscribe(scope, async () => { reads++; return { value: "live reader", activity: "terminal" }; }, (r) => seen.push(r?.value));
  stop(); release({ value: "disposed reader", activity: "idle" }); await clock.flush();
  assert.equal(reads, 1); assert.deepEqual(seen, ["live reader"]);
  manager.dispose();
});
