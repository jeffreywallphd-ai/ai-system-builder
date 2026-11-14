import assert from "node:assert/strict";
import { setTimeout as wait } from "node:timers/promises";
import test from "node:test";

import { observeManagedSavedSystems } from "./observeManagedSavedSystems";

const hostIncarnationId = "00000000-0000-4000-a000-000000000001";
const cursor = (sequence: number) => ({ hostIncarnationId, sequence, scopeTag: "a".repeat(64) });
const snapshot = (sequence = 0) => Response.json({ ok: true, value: { cursor: cursor(sequence), systems: [] } });
const update = (sequence: number) => ({ kind: "changes", cursor: cursor(sequence), more: false,
  events: [{ systemId: "fixture.system", recordRevision: sequence, revisionId: null, sequence }] });
const frame = (sequence: number) => `event: changes\ndata: ${JSON.stringify(update(sequence))}\n\n`;
const capture = (current = () => true) => () => ({ readable: true, hasToken: true, isCurrent: current, clearIfCurrent: () => false });

test("using one scoped stream ignores duplicate, stale and out-of-order checkpoints", async () => {
  const visibility = new Visibility();
  const encoder = new TextEncoder();
  const calls: string[] = [];
  let changes = 0;
  const endFrame = frame(2);
  const stream = new ReadableStream<Uint8Array>({ start(sink) {
    for (const chunk of [frame(1), frame(1), frame(3), endFrame.slice(0, 12), endFrame.slice(12), frame(1)]) sink.enqueue(encoder.encode(chunk));
    sink.close();
  } });
  const dispose = observeManagedSavedSystems({ workspaceId: "space-fixture", visibility, captureConnection: capture(),
    changed: () => { changes += 1; }, async fetch(url, request) {
      const path = String(url);
      calls.push(path);
      assert.equal(path.includes("?"), false);
      assert.equal(request?.redirect, "error");
      const body = JSON.parse(String(request?.body));
      assert.equal(body.workspaceId, "space-fixture");
      if (path.endsWith("/snapshot")) return snapshot();
      if (path.endsWith("/stream")) return new Response(stream, { headers: { "Content-Type": "text/event-stream" } });
      assert.equal(body.cursor.sequence, 2);
      return Response.json({ ok: true, value: { kind: "changes", cursor: cursor(2), events: [], more: false } });
    } });
  try {
    await until(() => calls.length === 3);
    assert.equal(changes, 3);
  } finally { dispose(); }
});

test("a failed stream reconnect uses the same cursor for replay", async () => {
  const visibility = new Visibility();
  let changes = 0;
  const calls: string[] = [];
  const dispose = observeManagedSavedSystems({ workspaceId: "space-fixture", visibility, captureConnection: capture(),
    changed: () => { changes += 1; }, async fetch(url, request) {
      const path = String(url);
      calls.push(path.slice(path.lastIndexOf("/") + 1));
      if (path.endsWith("/snapshot")) return snapshot(1);
      if (path.endsWith("/stream")) throw new Error("synthetic interruption");
      assert.equal(JSON.parse(String(request?.body)).cursor.sequence, 1);
      return Response.json({ ok: true, value: update(2) });
    } });
  try {
    await until(() => changes === 2);
    assert.deepEqual(calls, ["snapshot", "stream", "changes"]);
  } finally { dispose(); }
});

test("held snapshots from hidden, retired, or replaced connections cannot refresh saved state", async () => {
  for (const reason of ["hide", "dispose", "token"] as const) {
    const visibility = new Visibility();
    let current = true;
    let changes = 0;
    let requested = false;
    let finish = (_response: Response) => {};
    const held = new Promise<Response>((resolve) => { finish = resolve; });
    const dispose = observeManagedSavedSystems({ workspaceId: "scope-fixture", visibility, captureConnection: capture(() => current),
      changed: () => { changes += 1; }, async fetch() { requested = true; return held; } });
    try {
      assert.equal(requested, true);
      if (reason === "hide") { visibility.hidden = true; visibility.dispatchEvent(new Event("visibilitychange")); }
      else if (reason === "dispose") dispose();
      else current = false;
      finish(snapshot());
      await wait(15);
      assert.equal(changes, 0);
    } finally { dispose(); }
  }
});

test("the visible tab resumes with a fresh request after a hidden read settles", async () => {
  const visibility = new Visibility();
  let changes = 0;
  let requests = 0;
  let finish = (_response: Response) => {};
  const held = new Promise<Response>((resolve) => { finish = resolve; });
  const dispose = observeManagedSavedSystems({ workspaceId: "scope-fixture", visibility, captureConnection: capture(),
    changed: () => { changes += 1; }, async fetch(url) {
      if (!String(url).endsWith("/snapshot")) return new Response(null, { status: 403 });
      return ++requests === 1 ? held : snapshot(2);
    } });
  try {
    visibility.hidden = true;
    visibility.dispatchEvent(new Event("visibilitychange"));
    visibility.hidden = false;
    visibility.dispatchEvent(new Event("visibilitychange"));
    assert.equal(requests, 1);
    finish(snapshot(1));
    await until(() => changes === 1);
    assert.equal(requests, 2);
  } finally { dispose(); }
});

test("one active saved query witness retires on token replacement, hide, resume, or disposal", async () => {
  const visibility = new Visibility();
  const connectionChanges = new EventTarget();
  const witnesses: Array<() => boolean> = [];
  let generation = 0;
  let snapshots = 0;
  const dispose = observeManagedSavedSystems({
    workspaceId: "space-fixture",
    visibility,
    captureConnection: () => {
      const current = generation;
      return capture(() => generation === current)();
    },
    subscribeToConnection(listener) {
      connectionChanges.addEventListener("change", listener);
      return () => connectionChanges.removeEventListener("change", listener);
    },
    changed: (witness) => witnesses.push(witness),
    async fetch(url) {
      if (String(url).endsWith("/snapshot")) return snapshot(++snapshots);
      return new Response(null, { status: 503 });
    },
  });
  try {
    await until(() => witnesses.length === 1);
    assert.equal(witnesses[0](), true);
    generation++;
    connectionChanges.dispatchEvent(new Event("change"));
    assert.equal(witnesses[0](), false);
    await until(() => witnesses.length === 2);
    assert.equal(witnesses[1](), true);
    visibility.hidden = true;
    visibility.dispatchEvent(new Event("visibilitychange"));
    assert.equal(witnesses[1](), false);
    visibility.hidden = false;
    visibility.dispatchEvent(new Event("visibilitychange"));
    await until(() => witnesses.length === 3);
    assert.equal(witnesses[2](), true);
    dispose();
    assert.ok(witnesses.every((current) => !current()));
  } finally { dispose(); }
});

class Visibility extends EventTarget { hidden = false; }

async function until(condition: () => boolean) {
  for (let attempts = 0; attempts < 50 && !condition(); attempts += 1) await wait(10);
  assert.ok(condition());
}
