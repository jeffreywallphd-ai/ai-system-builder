import assert from "node:assert/strict";
import test from "node:test";

import { createControlledConversationRuntimeWorker } from "../visual-composer/controlled-conversation-runtime-worker.mjs";

test("controlled conversation worker authenticates, bounds, and completes synthetic turns", async () => {
  const token = "qualification-token-0123456789abcdef";
  const worker = createControlledConversationRuntimeWorker({
    host: "127.0.0.1",
    port: 0,
    token,
  });
  const address = await worker.start();
  const origin = `http://${address.host}:${address.port}`;
  try {
    assert.equal((await fetch(`${origin}/health`)).status, 401);

    const headers = { authorization: `Bearer ${token}` };
    const health = await fetch(`${origin}/health`, { headers });
    assert.equal(health.status, 200);
    assert.equal((await health.json()).status.status, "ready");

    const started = await fetch(`${origin}/tasks/start`, {
      method: "POST",
      headers: { ...headers, "content-type": "application/json" },
      body: JSON.stringify({
        requestId: "conversation-text-generation.synthetic",
        taskType: "conversation-text-generation",
        payload: {
          selectedModelId: "qualification/controlled-chat",
          messages: [{ role: "user", content: "Hello qualification" }],
        },
      }),
    });
    assert.equal(started.status, 200);
    const status = await fetch(
      `${origin}/tasks/conversation-text-generation.synthetic`,
      { headers },
    );
    assert.deepEqual((await status.json()).data, {
      assistantResponseText: "Controlled response to: Hello qualification",
    });

    const oversized = await fetch(`${origin}/tasks/start`, {
      method: "POST",
      headers: { ...headers, "content-type": "application/json" },
      body: "x".repeat(65 * 1024),
    });
    assert.equal(oversized.status, 413);
    assert.equal(
      (await oversized.json()).error.code,
      "runtime.request-too-large",
    );
  } finally {
    await worker.stop();
  }
});

test("controlled conversation worker rejects non-loopback and weak launch identity", () => {
  assert.throws(
    () =>
      createControlledConversationRuntimeWorker({
        host: "0.0.0.0",
        port: 43172,
        token: "qualification-token-0123456789abcdef",
      }),
    /loopback/,
  );
  assert.throws(
    () =>
      createControlledConversationRuntimeWorker({
        host: "127.0.0.1",
        port: 43172,
        token: "short",
      }),
    /authentication/,
  );
});
