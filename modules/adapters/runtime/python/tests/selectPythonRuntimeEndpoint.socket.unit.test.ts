import assert from "node:assert/strict";
import { createServer, type Server } from "node:net";
import { test } from "node:test";
import { selectPythonRuntimeLoopbackEndpoint } from "../network/selectPythonRuntimeEndpoint";

const listen = (server: Server, port: number) => new Promise<void>((resolve, reject) => {
  server.once("error", reject);
  server.listen({ host: "127.0.0.1", port, exclusive: true }, resolve);
});
const close = (server: Server) => new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));

test("real selection avoids an occupied listener and releases its own port before returning", async () => {
  const occupied = createServer(socket => socket.destroy());
  const replacement = createServer(socket => socket.destroy());
  try {
    await listen(occupied, 0);
    const existing = occupied.address(); assert.ok(existing && typeof existing === "object");
    const endpoint = await selectPythonRuntimeLoopbackEndpoint({ env: {} });
    assert.equal(endpoint.host, "127.0.0.1");
    assert.notEqual(Number(endpoint.port), existing.port);
    assert.equal(endpoint.baseUrl, `http://127.0.0.1:${endpoint.port}`);
    await listen(replacement, Number(endpoint.port));
    assert.ok(replacement.listening);
  } finally {
    if (replacement.listening) await close(replacement);
    if (occupied.listening) await close(occupied);
  }
});
