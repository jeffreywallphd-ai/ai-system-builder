import test from "node:test";
import assert from "node:assert/strict";
import { createServer, get } from "node:http";
import { listenSettingsHostOnLoopback } from "../visual-composer/settings-host-listener.mjs";

const close = (server) => new Promise((resolve, reject) => {
  if (!server.listening) return resolve();
  server.close((error) => error ? reject(error) : resolve());
});
const handlers = (server) => ({
  listening: server.rawListeners("listening"),
  error: server.rawListeners("error"),
});

test("the Settings qualifier serves requests through an actual IPv4 loopback socket", { timeout: 5000 }, async (t) => {
  let requests = 0;
  const server = createServer((_request, response) => {
    requests++;
    response.end("fixture-ready");
  });
  let observed = 0;
  server.on("listening", () => { observed++; });
  const before = handlers(server);
  t.after(() => close(server));
  await listenSettingsHostOnLoopback(server, 0);
  const address = server.address();
  assert.equal(address.address, "127.0.0.1");
  assert.equal(address.family, "IPv4");
  const body = await new Promise((resolve, reject) => {
    const request = get({ host: "127.0.0.1", port: address.port, path: "/", agent: false }, (response) => {
      assert.equal(response.statusCode, 200);
      response.setEncoding("utf8");
      let value = "";
      response.on("data", (chunk) => { value += chunk; });
      response.once("end", () => resolve(value));
      response.once("error", reject);
    });
    request.setTimeout(2000, () => request.destroy(new Error("Local fixture timed out.")));
    request.once("error", reject);
  });
  assert.equal(body, "fixture-ready");
  assert.equal(requests, 1);
  assert.equal(observed, 1);
  assert.deepEqual(handlers(server), before);
  await close(server);
  assert.equal(server.listening, false);
});

test("an occupied local port rejects startup without an alternate address or lingering handlers", { timeout: 5000 }, async (t) => {
  const owner = createServer(), denied = createServer();
  let errors = 0;
  denied.on("error", () => { errors++; });
  const before = handlers(denied);
  t.after(async () => { await close(denied); await close(owner); });
  await listenSettingsHostOnLoopback(owner, 0);
  await assert.rejects(listenSettingsHostOnLoopback(denied, owner.address().port), { code: "EADDRINUSE" });
  assert.equal(denied.listening, false);
  assert.equal(denied.address(), null);
  assert.equal(errors, 1);
  assert.deepEqual(handlers(denied), before);
  assert.equal(owner.address().address, "127.0.0.1");
});

test("a synchronous listen failure leaves no temporary startup handlers", async () => {
  const server = createServer();
  const before = handlers(server);
  await assert.rejects(listenSettingsHostOnLoopback(server, -1), { code: "ERR_SOCKET_BAD_PORT" });
  assert.equal(server.listening, false);
  assert.deepEqual(handlers(server), before);
});
