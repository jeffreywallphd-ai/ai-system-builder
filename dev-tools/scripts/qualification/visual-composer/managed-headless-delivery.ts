import assert from "node:assert/strict";
import { writeFile } from "node:fs/promises";
import https from "node:https";
import path from "node:path";

import { parseHeadlessChangeCursor, type HeadlessChangeCursor } from "../../../../modules/contracts/headless";
import { startManagedReferenceHost } from "./managed-reference-host";

const prefix = "/api/headless/system-builder";
const eventSize = 32 * 1024;
type Frame = { readonly value: string; readonly observedAt: number };

class StreamClosed extends Error {
  constructor(readonly observedAt: number) { super("The admitted connection was interrupted."); }
}

function subscribe(origin: string, ca: Buffer, bearer: string, organizationId: string, body: unknown) {
  const settings = { ca, method: "POST", headers: { authorization: `Bearer ${bearer}`,
    "x-organization-id": organizationId, "content-type": "application/json" } };
  const controller = new AbortController();
  let admitted: () => void;
  let rejectAdmission: (error: Error) => void;
  const ready = new Promise<void>((resolve, reject) => { admitted = resolve; rejectAdmission = reject; });
  void ready.catch(() => {});
  let state: "connecting" | "open" | "closed" = "connecting";
  const next = new Promise<Frame>((resolve, reject) => {
    const fail = (error: Error) => { state = "closed"; reject(error); };
    const request = https.request(new URL(`${prefix}/stream`, origin), {...settings, signal: controller.signal}, response => {
      if (response.statusCode !== 200 || !/^text\/event-stream\b/i.test(response.headers["content-type"] ?? "")) {
        response.destroy();
        fail(new Error("The saved-state stream was not admitted."));
        return;
      }
      response.setEncoding("utf8");
      let buffer = "";
      response.on("data", (chunk: string) => {
        buffer += chunk;
        if (Buffer.byteLength(buffer) > eventSize) {
          fail(new Error("The saved-state frame exceeded its bound."));
          controller.abort();
          return;
        }
        for (let end = buffer.indexOf("\n\n"); end >= 0; end = buffer.indexOf("\n\n")) {
          const frame = buffer.slice(0, end);
          buffer = buffer.slice(end + 2);
          if (frame === ": ready") { state = "open"; admitted!(); }
          else if (frame.startsWith("event: ")) {
            state = "closed";
            admitted!();
            resolve({ value: frame, observedAt: performance.now() });
            controller.abort();
            return;
          }
        }
      });
      const connectionLost = () => fail(!controller.signal.aborted && state === "open" && !response.complete
        ? new StreamClosed(performance.now()) : new Error("The stream ended without a qualified interruption."));
      response.once("close", connectionLost);
      response.on("error", () => {}); // The final HTTP close provides the completion and interruption witness.
    });
    request.on("error", () => {
      if (state === "connecting") fail(new Error("The saved-state connection could not open."));
    });
    request.end(JSON.stringify(body));
  });
  const timer = setTimeout(() => controller.abort(), 8_000);
  void next.catch(error => rejectAdmission!(error)).finally(() => clearTimeout(timer));
  return { ready, next, isOpen: () => state === "open", close: () => controller.abort() };
}

async function main() {
  const host = await startManagedReferenceHost(process.env.MANAGED_REFERENCE_DATABASE ?? "", {headlessDelivery: true});
  let completed = false;
  let phase = "start-secondary";
  const evidence: Record<string, unknown> = {};
  const subscriptions: ReturnType<typeof subscribe>[] = [];
  try {
    assert.ok(host.delivery);
    const { workspaceId, caPem, startDeliveryWorker } = host.delivery;
    const { token, serverOrigin, organizationId } = host;
    const post = (url: string, input: unknown, origin = serverOrigin) =>
      host.request(url, {token, organizationId, method: "POST", body: input}, origin);
    const snapshot = async (origin: string) => {
      const response = await post(`${prefix}/snapshot`, { workspaceId }, origin);
      evidence.last_snapshot_status = response.status;
      assert.equal(response.status, 200);
      assert.equal(response.body.ok, true);
      const cursor = parseHeadlessChangeCursor(response.body.value.cursor);
      assert.ok(cursor);
      return {cursor, systems: response.body.value.systems as Array<{systemId: string; recordRevision: number}>};
    };
    const changes = async (origin: string, cursor: HeadlessChangeCursor) => {
      const response = await post(`${prefix}/changes`, { workspaceId, cursor }, origin);
      assert.equal(response.status, 200);
      assert.equal(response.body.ok, true);
      return response.body.value;
    };
    const create = async (name: string) => {
      const response = await post("/api/systems/create", {workspaceId, name});
      assert.equal(response.status, 200);
      assert.equal(response.body.ok, true);
      assert.equal(typeof response.body.value.systemId, "string");
      return { id: response.body.value.systemId as string, completedAt: performance.now() };
    };
    const open = (origin: string, cursor: HeadlessChangeCursor) => {
      const stream = subscribe(origin, caPem, token, organizationId, {workspaceId, cursor});
      subscriptions.push(stream);
      return stream;
    };

    const secondary = await startDeliveryWorker();
    phase = "snapshot";
    const [first, second] = await Promise.all([snapshot(serverOrigin), snapshot(secondary.origin)]);
    assert.notEqual(first.cursor.hostIncarnationId, second.cursor.hostIncarnationId);
    assert.equal(first.cursor.sequence, second.cursor.sequence);
    phase = "cross-worker-resync";
    assert.equal((await changes(secondary.origin, first.cursor)).kind, "resync");
    evidence.foreign_worker_cursor_resync = true;
    const streams = [open(serverOrigin, first.cursor), open(secondary.origin, second.cursor)];
    phase = "subscribe";
    await Promise.all(streams.map(stream => stream.ready));
    phase = "create";
    const primarySave = await create("Synthetic shared saved-state test");
    phase = "delivery";
    const frames = await Promise.all(streams.map(stream => stream.next));
    for (const {value} of frames) {
      assert.match(value, /^event: changes\ndata: /);
      const page = JSON.parse(value.slice("event: changes\ndata: ".length));
      assert.equal(page.kind, "changes");
      assert.deepEqual(page.events.map((event: {systemId: string}) => event.systemId), [primarySave.id]);
      assert.equal(page.events[0].recordRevision, 1);
    }
    evidence.workers_receiving_committed_event = frames.length;
    evidence.response_to_notice_ms = frames.map(frame => Math.max(0, frame.observedAt - primarySave.completedAt));

    const priorCursor = (await snapshot(secondary.origin)).cursor;
    const interruptedStream = open(secondary.origin, priorCursor);
    await interruptedStream.ready;
    phase = "interruption";
    const interrupted = await create("Synthetic restart recovery test");
    evidence.stream_open_after_commit = interruptedStream.isOpen();
    assert.equal(interruptedStream.isOpen(), true, "The admitted connection must still be active after commit.");
    const interruptStarted = performance.now();
    await secondary.interrupt();
    evidence.stream_outcome = await interruptedStream.next.then(() => "delivered", (error: unknown) => {
      if (!(error instanceof StreamClosed)) return "unexpected-close";
      const elapsed = error.observedAt - interruptStarted;
      return elapsed >= 0 && elapsed <= 5_000 ? "owned-interruption" : "outside-interruption-window";
    });
    assert.equal(evidence.stream_outcome, "owned-interruption");
    evidence.interrupted_stream = "closed-without-delivery";
    const successor = await startDeliveryWorker();
    phase = "recovery";
    assert.notEqual(successor.pid, secondary.pid);
    assert.equal((await changes(successor.origin, priorCursor)).kind, "resync");
    const recovered = await snapshot(successor.origin);
    assert.notEqual(recovered.cursor.hostIncarnationId, priorCursor.hostIncarnationId);
    assert.deepEqual(recovered.systems.map(system => system.systemId).sort(), [primarySave.id, interrupted.id].sort());
    assert.ok(recovered.systems.every(system => system.recordRevision === 1));
    assert.equal(recovered.cursor.sequence, priorCursor.sequence + 1);
    const replay = await changes(serverOrigin, first.cursor);
    assert.deepEqual(replay.events.map((event: {systemId: string}) => event.systemId), [primarySave.id, interrupted.id]);
    evidence.interrupted_worker_replaced = true;
    evidence.successor_recovered_both_commits = true;
    evidence.survivor_replayed_both_commits = true;
    evidence.commit_to_recovered_snapshot_ms = performance.now() - interrupted.completedAt;

    const denied = await host.request(`${prefix}/snapshot`, {token, method: "POST", body: {workspaceId},
      organizationId: "qualification.foreign"}, successor.origin);
    assert.equal(denied.status, 403);
    evidence.foreign_organization_denied = true;
    completed = true;
  } finally {
    for (const subscription of subscriptions) subscription.close();
    try { await host.stop(); }
    catch { completed = false; }
    await writeFile(path.join(host.runRoot, "managed-headless-delivery-evidence.json"), JSON.stringify({
      schema_version: "managed-headless-delivery-v1", source_revision: host.sourceRevision,
      status: completed ? "passed" : "failed", phase, tls_verification: true, evidence,
    }, null, 2) + "\n", {flag: "wx"});
  }
  assert.equal(completed, true, "The managed delivery qualification or cleanup failed.");
  process.stdout.write(JSON.stringify({status: "passed", evidence}) + "\n");
}

void main().catch(() => {
  process.stderr.write(JSON.stringify({status: "failed", code: "managed-headless.deliveries-unqualified"}) + "\n");
  process.exitCode = 1;
});
