import assert from "node:assert/strict";
import test from "node:test";
import {createPythonRuntimeHttpClient} from "../client/createPythonRuntimeHttpClient";
import {MODEL_SOURCE_IDENTITY_CAPABILITY, MODEL_SOURCE_IDENTITY_VERSION, modelSourceIdentityMac,
  verifyModelSourceIdentityMac, type ModelSourceIdentityProof} from "../client/modelSourceIdentity";

const runtime = {runtimeId: "synthetic-worker", workerStartedAt: "2026-11-19T00:00:00+00:00"};
const input = {phase: "roots" as const, taskId: "11111111-1111-4111-8111-111111111111",
  acquisitionId: "44444444-4444-4444-8444-444444444444", handoffId: "22222222-2222-4222-8222-222222222222", challenge: "d".repeat(64)};
const secret = Buffer.alloc(32, 3), auth = "synthetic-owned-model-runtime-credential";
function envelope() {
  const identity = ["15621880057181568646", "5066549586512172", "16877", "16", "0"] as const;
  const proof: ModelSourceIdentityProof = {...input, ...runtime, version: MODEL_SOURCE_IDENTITY_VERSION,
    roots: {acquisition: identity, source: identity, receiver: identity}, manifestDigest: null, files: []};
  return {proof, mac: modelSourceIdentityMac(secret, proof).toString("hex")};
}
function clientFixture(options: {owned?: boolean; healthy?: boolean; capability?: boolean;
  proof?: () => Response | Promise<Response>} = {}) {
  let current = true; const calls: string[] = [];
  const client = createPythonRuntimeHttpClient({baseUrl: "http://127.0.0.1:43111", authorizationToken: auth,
    ...(options.owned === false ? {} : {captureProcessOwnership: () => () => {if (!current) throw new Error("Synthetic worker retired.");}}),
    fetchImplementation: (async (url: unknown, init?: RequestInit) => {
      const endpoint = new URL(String(url)).pathname; calls.push(endpoint);
      assert.equal((init?.headers as Record<string, string>).authorization, "Bearer " + auth);
      if (endpoint === "/health") return Response.json({healthy: options.healthy !== false,
        status: {status: options.healthy === false ? "error" : "ready", ...runtime}});
      if (endpoint === "/capabilities") return Response.json({runtimeId: runtime.runtimeId,
        capabilities: options.capability === false ? [] : [MODEL_SOURCE_IDENTITY_CAPABILITY]});
      assert.equal(endpoint, "/models/source-identity");
      assert.deepEqual(JSON.parse(String(init?.body)), {...input, ...runtime});
      assert.doesNotMatch(String(init?.body), /secret|proofPath|localPath/);
      return options.proof ? options.proof() : Response.json(envelope());
    }) as never});
  return {client, calls, retire: () => {current = false;}};
}

test("private identity probe uses only the existing owned worker and returns exact separate full facts", async () => {
  const f = clientFixture(), probe = await f.client.captureModelSourceIdentityProbe();
  assert.ok(Object.isFrozen(probe)); assert.equal(probe.runtimeId, runtime.runtimeId);
  const value = await probe.inspect(input); verifyModelSourceIdentityMac(secret, value);
  assert.equal(value.proof.roots.receiver[0], "15621880057181568646");
  assert.deepEqual(f.calls, ["/health", "/capabilities", "/models/source-identity"]);
});

test("missing owned launch, unavailable worker or missing capability never starts or installs anything", async () => {
  for (const options of [{owned: false}, {healthy: false}, {capability: false}]) {
    const f = clientFixture(options); await assert.rejects(f.client.captureModelSourceIdentityProbe());
    assert.ok(f.calls.every(endpoint => ["/health", "/capabilities"].includes(endpoint)));
    if (options.owned === false) assert.deepEqual(f.calls, []);
  }
});

test("retired captured worker cannot borrow a fresh request guard or send another probe", async () => {
  const f = clientFixture(), probe = await f.client.captureModelSourceIdentityProbe();
  f.retire(); await assert.rejects(probe.inspect(input)); assert.deepEqual(f.calls, ["/health", "/capabilities"]);
});

test("strict passive probe input cannot add paths, hooks or proxy traps before transport", async () => {
  const f = clientFixture(), probe = await f.client.captureModelSourceIdentityProbe(); let hooks = 0, traps = 0;
  const getter = {...input}; Object.defineProperty(getter, "challenge", {enumerable: true, get() {hooks++; return input.challenge;}});
  const proxy = new Proxy({...input}, {getPrototypeOf() {traps++; return Object.prototype;}});
  for (const body of [{...input, path: "synthetic-private-marker"}, {...input, phase: "other"},
    {...input, toJSON() {hooks++; return input;}}, getter, proxy]) await assert.rejects(probe.inspect(body as never));
  assert.equal(hooks, 0); assert.equal(traps, 0); assert.deepEqual(f.calls, ["/health", "/capabilities"]);
});

test("replayed challenge, wrong incarnation, wrong phase and unknown response fields deny", async () => {
  for (const field of ["challenge", "workerStartedAt", "phase", "unknown"]) {
    const value = envelope();
    if (field === "unknown") Object.assign(value.proof, {path: "synthetic-private-marker"});
    else (value.proof as unknown as Record<string, unknown>)[field] = field === "phase" ? "snapshot" : "different";
    const f = clientFixture({proof: () => Response.json(value)}), probe = await f.client.captureModelSourceIdentityProbe();
    await assert.rejects(probe.inspect(input));
  }
});

test("actual streamed response limit cancels an oversized body before metadata is accepted", async () => {
  let cancelled = 0;
  const f = clientFixture({proof: () => new Response(new ReadableStream({start(controller) {controller.enqueue(new Uint8Array(65537));},
    cancel() {cancelled++;}}))});
  const probe = await f.client.captureModelSourceIdentityProbe(); await assert.rejects(probe.inspect(input));
  assert.equal(cancelled, 1);
});

test("worker withdrawal during an actual body read cannot return late identity metadata", async () => {
  let entered!: () => void, release!: () => void;
  const started = new Promise<void>(resolve => {entered = resolve;}), held = new Promise<void>(resolve => {release = resolve;});
  const bytes = Buffer.from(JSON.stringify(envelope())), half = Math.floor(bytes.length / 2);
  const f = clientFixture({proof: () => new Response(new ReadableStream({
    start(controller) {controller.enqueue(bytes.subarray(0, half));},
    async pull(controller) {entered(); await held; controller.enqueue(bytes.subarray(half)); controller.close();},
  }, {highWaterMark: 0}))});
  const probe = await f.client.captureModelSourceIdentityProbe(), operation = probe.inspect(input);
  await started; f.retire(); release(); await assert.rejects(operation);
});

test("a valid MAC over full facts fails after mutation or reuse with a different secret", () => {
  const value = envelope();
  assert.throws(() => verifyModelSourceIdentityMac(Buffer.alloc(32, 4), value));
  const changed = structuredClone(value); (changed.proof.roots.receiver as unknown as string[])[0] = "3423665798";
  assert.throws(() => verifyModelSourceIdentityMac(secret, changed));
});
