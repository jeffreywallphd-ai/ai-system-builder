import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { test } from "node:test";
import { spawn, execFile } from "node:child_process";
import { createServer } from "node:http";
import { copyFile, mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";
import { promisify } from "node:util";
import { createPythonRuntimeAdapterFoundation } from "../createPythonRuntimePort";
import { selectPythonRuntimeLoopbackEndpoint } from "../network/selectPythonRuntimeEndpoint";
import { OWNED_RUNTIME_READY_PREFIX } from "../supervisor/ownedPythonRuntimeProof";

const health = () => ({ok: true, status: 200, json: async () => ({healthy: true, status: {runtimeId: "python-sidecar", status: "ready"}})}) as Response;
function fixture(mode: "manual" | "valid" = "manual") {
  const children: Array<EventEmitter & {stdout: PassThrough; stderr: PassThrough; kill: () => boolean}> = [];
  const nonces: string[] = [], events: unknown[] = [];
  let requests = 0, transport: undefined | (() => Promise<Response>);
  const foundation = createPythonRuntimeAdapterFoundation({
    client: {baseUrl: "http://127.0.0.1:43111", fetchImplementation: (async () => {requests++; return transport ? transport() : health();}) as never},
    supervisor: {command: "synthetic-owned-child", startupTimeoutMs: 150, healthCheckIntervalMs: 1,
      // Even an untyped caller cannot downgrade the managed foundation.
      ...({requireOwnedStartupProof: false} as object),
      spawnImplementation: ((_command, _args, options) => {
        const child = new EventEmitter() as typeof children[number];
        child.stdout = new PassThrough(); child.stderr = new PassThrough();
        child.kill = () => {queueMicrotask(() => child.emit("exit", 0, null)); return true;};
        nonces.push(options.env!.PYTHON_RUNTIME_STARTUP_PROOF!); children.push(child);
        if (mode === "valid") queueMicrotask(() => child.stdout.write(OWNED_RUNTIME_READY_PREFIX + nonces.at(-1) + " 127.0.0.1:43111\n"));
        return child;
      }) as never,
      onEvent: event => events.push(event),
    },
  });
  return {foundation, children, nonces, events, get requests() {return requests;}, set transport(value: () => Promise<Response>) {transport = value;}};
}
const tick = () => new Promise(resolve => setTimeout(resolve, 5));

test("foundation refuses conflicting endpoint settings before any spawn or HTTP", () => {
  let effects = 0;
  assert.throws(() => createPythonRuntimeAdapterFoundation({
    client: {baseUrl: "http://127.0.0.1:43111", fetchImplementation: (async () => {effects++; return health();}) as never},
    supervisor: {command: "synthetic", env: {PYTHON_RUNTIME_PORT: "43112"}, spawnImplementation: (() => {effects++; throw new Error("unexpected");}) as never},
  }), /endpoints must match/);
  assert.equal(effects, 0);
});

test("managed foundation sends no HTTP before an exact current child's bound-ready proof", async () => {
  const f = fixture();
  await assert.rejects(f.foundation.runtimePort.getModelStatus!(), /ownership/);
  const starting = f.foundation.supervisor.start();
  await tick(); assert.equal(f.requests, 0); assert.equal(f.children.length, 1);
  const frame = OWNED_RUNTIME_READY_PREFIX + f.nonces[0] + " 127.0.0.1:43111\n";
  f.children[0]!.stderr.write(frame); f.children[0]!.stdout.write(OWNED_RUNTIME_READY_PREFIX + "0".repeat(64) + " 127.0.0.1:43111\n");
  await tick(); assert.equal(f.requests, 0);
  f.children[0]!.stdout.write(frame.slice(0, 24)); await tick(); assert.equal(f.requests, 0);
  f.children[0]!.stdout.write(frame.slice(24)); await starting;
  assert.equal(f.foundation.supervisor.getStatus(), "ready"); assert.equal(f.requests, 1);
  f.children[0]!.stdout.write(frame); await tick();
  assert.equal(f.events.filter((e: any) => e.type === "owned-ready").length, 1);
  const report = JSON.stringify(f.events);
  assert.equal(f.nonces.some(n => report.includes(n)), false);
  assert.equal(report.includes(OWNED_RUNTIME_READY_PREFIX), false);
  await f.foundation.supervisor.stop();
});

test("missing proof times out before any HTTP and owned cleanup stays required", async () => {
  const f = fixture();
  await assert.rejects(f.foundation.supervisor.start(), /failed to report healthy/);
  assert.equal(f.requests, 0); assert.equal(f.foundation.supervisor.getStatus(), "failed");
  await assert.rejects(f.foundation.supervisor.start(), /stop the owned process/);
  assert.equal(f.children.length, 1);
  await f.foundation.supervisor.stop();
});

test("stop before proof rejects late and old-child markers without HTTP or reincarnation", async () => {
  const f = fixture();
  const first = f.foundation.supervisor.start(); const refused = assert.rejects(first);
  await tick(); const old = f.children[0]!, oldFrame = OWNED_RUNTIME_READY_PREFIX + f.nonces[0] + " 127.0.0.1:43111\n";
  await f.foundation.supervisor.stop(); await refused;
  const next = f.foundation.supervisor.start(); await tick();
  old.stdout.write(oldFrame); f.children[1]!.stdout.write(oldFrame); await tick();
  assert.equal(f.requests, 0); assert.notEqual(f.nonces[0], f.nonces[1]);
  f.children[1]!.stdout.write(OWNED_RUNTIME_READY_PREFIX + f.nonces[1] + " 127.0.0.1:43111\n"); await next;
  assert.equal(f.requests, 1); await f.foundation.supervisor.stop();
});

test("a body held across worker replacement cannot revive an earlier HTTP response", async () => {
  const f = fixture("valid"); await f.foundation.supervisor.start();
  let release!: (value: unknown) => void, entered!: () => void;
  const parsing = new Promise<void>(resolve => {entered = resolve;});
  f.transport = async () => ({ok: true, status: 200, json: () => {entered(); return new Promise(resolve => {release = resolve;});}}) as Response;
  const pending = f.foundation.runtimePort.getModelStatus!();
  const refused = assert.rejects(pending, /ownership/);
  await parsing; await f.foundation.supervisor.stop();
  f.transport = async () => health(); await f.foundation.supervisor.start();
  release({models: []}); await refused;
  await f.foundation.supervisor.stop();
});

test("child exit before proof never authorizes health or capabilities", async () => {
  const f = fixture();
  const starting = f.foundation.supervisor.start(); const refused = assert.rejects(starting);
  await tick(); f.children[0]!.emit("exit", 1, null); await refused;
  assert.equal(f.requests, 0);
  await assert.rejects(f.foundation.runtimePort.getModelStatus!(), /ownership/);
});

const execute = promisify(execFile);
async function physicalFixture() {
  const python = process.env.PYTHON;
  assert.ok(python && path.isAbsolute(python), "The existing verified Python test interpreter is required.");
  const parent = await realpath(tmpdir());
  const root = await mkdtemp(path.join(parent, "owned-runtime-startup-"));
  await copyFile(path.resolve("modules/adapters/runtime/python/worker/main.py"), path.join(root, "main.py"));
  // Isolate the unchanged worker bind/proof bootstrap from model imports. This
  // controlled ASGI app is not real Context, model, authorization or parent proof.
  await writeFile(path.join(root, "app.py"), `import json
async def app(scope, receive, send):
    if scope["type"] == "lifespan":
        while True:
            event = await receive()
            if event["type"] == "lifespan.startup": await send({"type":"lifespan.startup.complete"})
            elif event["type"] == "lifespan.shutdown":
                await send({"type":"lifespan.shutdown.complete"}); return
    else:
        body = json.dumps({"healthy":True,"status":{"runtimeId":"python-sidecar","status":"ready"}}).encode()
        await send({"type":"http.response.start","status":200,"headers":[(b"content-type",b"application/json")]})
        await send({"type":"http.response.body","body":body})
`, {flag: "wx"});
  const endpoint = await selectPythonRuntimeLoopbackEndpoint({env: {}});
  let spawned = 0, http = 0;
  const closed: Promise<void>[] = [];
  const foundation = createPythonRuntimeAdapterFoundation({
    client: {baseUrl: endpoint.baseUrl, transportRequestTimeoutMs: 1000,
      fetchImplementation: async (...args) => {http++; return fetch(...args);}},
    supervisor: {command: python, args: ["-I", "-B", path.join(root, "main.py")], cwd: root,
      env: {...process.env, PYTHON_RUNTIME_HOST: endpoint.host, PYTHON_RUNTIME_PORT: endpoint.port},
      startupTimeoutMs: 5000, healthCheckIntervalMs: 20, verifyRuntimeEnvironment: async () => true,
      spawnImplementation: ((...args) => {
        spawned++; const child = spawn(...args);
        closed.push(new Promise(resolve => child.once("close", () => resolve())));
        return child;
      }) as typeof spawn},
  });
  return {foundation, endpoint, python, get spawned() {return spawned;}, get http() {return http;},
    async retire() {
      await foundation.supervisor.stop();
      let deadline: ReturnType<typeof setTimeout> | undefined;
      try {
        await Promise.race([Promise.all(closed), new Promise((_, reject) => {
          deadline = setTimeout(() => reject(new Error("Owned test worker pipe retirement is unconfirmed.")), 3000);
        })]);
      } finally {clearTimeout(deadline);}
      const actual = await realpath(root);
      assert.equal(path.dirname(actual), parent); assert.ok(path.basename(actual).startsWith("owned-runtime-startup-"));
      await rm(actual, {recursive: true, force: false, maxRetries: 3, retryDelay: 50});
    }};
}

test("real healthy listener winning the port handoff gets no managed HTTP and cannot be adopted", {timeout: 15000}, async () => {
  const f = await physicalFixture();
  let foreignRequests = 0;
  const foreign = createServer((_request, response) => {
    foreignRequests++;
    response.writeHead(200, {"content-type": "application/json"});
    response.end(JSON.stringify({healthy: true, status: {runtimeId: "python-sidecar", status: "ready"}, capabilities: []}));
  });
  try {
    await new Promise<void>((resolve, reject) => {
      foreign.once("error", reject); foreign.listen({host: "127.0.0.1", port: Number(f.endpoint.port), exclusive: true}, resolve);
    });
    await assert.rejects(f.foundation.supervisor.startWithoutInstalling!());
    assert.equal(f.spawned, 1); assert.equal(f.http, 0); assert.equal(foreignRequests, 0);
    assert.notEqual(f.foundation.supervisor.getStatus(), "ready");
  } finally {
    await f.retire();
    await new Promise<void>((resolve, reject) => foreign.close(error => error ? reject(error) : resolve()));
  }
});

test("real owned worker binds exclusively before proof and rejects a reuse-address peer", {timeout: 15000}, async () => {
  const f = await physicalFixture();
  try {
    await f.foundation.supervisor.startWithoutInstalling!();
    assert.equal(f.foundation.supervisor.getStatus(), "ready");
    assert.equal(f.spawned, 1); assert.ok(f.http > 0);
    const result = await execute(f.python, ["-I", "-B", "-c", `import socket,sys
s=socket.socket(socket.AF_INET,socket.SOCK_STREAM)
s.setsockopt(socket.SOL_SOCKET,socket.SO_REUSEADDR,1)
try:
    s.bind(("127.0.0.1",int(sys.argv[1])))
except OSError:
    print("exclusive-bind-denied")
else:
    raise RuntimeError("exclusive-bind-not-proven")
finally:
    s.close()
`, f.endpoint.port], {timeout: 5000, maxBuffer: 1024, windowsHide: true});
    assert.equal(result.stdout.trim(), "exclusive-bind-denied");
  } finally {await f.retire();}
});
