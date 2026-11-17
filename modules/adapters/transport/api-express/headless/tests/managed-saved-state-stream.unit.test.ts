import assert from "node:assert/strict";
import test from "node:test";

import type { HeadlessChangeCursor } from "../../../../../contracts/headless";
import { normalizeSystemBuilderSystemId, systemBuilderSuccess } from "../../../../../contracts/system-builder";
import { serveManagedSavedStateStream } from "../serveManagedSavedStateStream";

const cursor = { hostIncarnationId: "00000000-0000-4000-a000-000000000001", sequence: 0, scopeTag: "a".repeat(64) } as HeadlessChangeCursor;

test("stream stops on backpressure without starting another read", async () => {
  let reads = 0;
  const observed: string[] = [];
  const result = await serveManagedSavedStateStream(cursor, {
    signal: new AbortController().signal, current: () => true,
    async read() {
      reads += 1;
      return systemBuilderSuccess({ kind: "changes", events: [{ systemId: normalizeSystemBuilderSystemId("test.system"),
        revisionId: null, recordRevision: 1, sequence: 1 }], cursor: { ...cursor, sequence: 1 }, more: false });
    },
    open: () => observed.push("open"), send: (frame) => { observed.push(frame); return false; },
    onExpire: () => assert.fail("stream should close immediately"),
  });
  assert.equal(result, "closed");
  assert.deepEqual(observed.map((item) => item.split("\n")[0]), ["open", "event: changes"]);
  assert.equal(reads, 1);
});

test("held stream read never publishes after disconnect or scope loss", async () => {
  for (const reason of ["disconnect", "scope"] as const) {
    let current = true;
    const cancel = new AbortController();
    let resume = () => {};
    const held = new Promise<void>((resolve) => { resume = resolve; });
    const result = serveManagedSavedStateStream(cursor, {
      signal: cancel.signal, current: () => current,
      async read() { await held; return systemBuilderSuccess({ kind: "resync" }); },
      open: () => assert.fail("no opening after authority loss"), send: () => assert.fail("no data after authority loss"),
      onExpire: () => assert.fail("expected early close"),
    });
    if (reason === "disconnect") cancel.abort();
    else current = false;
    resume();
    assert.equal(await result, "closed");
  }
});

test("the transport deadline closes even when a database read has not returned", async (context) => {
  context.mock.timers.enable({ apis: ["setTimeout"] });
  let finish = () => {};
  const held = new Promise<void>((resolve) => { finish = resolve; });
  let expired = false;
  let authorizedAtEnd: boolean | undefined;
  const result = serveManagedSavedStateStream(cursor, {
    signal: new AbortController().signal, current: () => true,
    async read(_cursor, current) {
      await held;
      authorizedAtEnd = current();
      return systemBuilderSuccess({ kind: "resync" });
    },
    open: () => assert.fail("no opening after the deadline"), send: () => assert.fail("no data after the deadline"),
    onExpire: () => { expired = true; },
  });
  context.mock.timers.tick(15_000);
  assert.equal(expired, true);
  finish();
  assert.equal(await result, "closed");
  assert.equal(authorizedAtEnd, false);
});
