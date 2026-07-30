import assert from "node:assert/strict";
import test from "node:test";

import {
  DESKTOP_SYSTEM_RUNTIME_CONVERSATION_CHANNELS,
  createIpcSuccessResponse,
} from "../../../../../modules/contracts/ipc";
import { SYSTEM_RUNTIME_CONVERSATION_MAX_INPUT_CHARACTERS } from "../../../../../modules/contracts/system-deployment";
import {
  createSystemRuntimePreloadApi,
  type SystemRuntimeIpcRendererPort,
} from "../systemRuntimePreloadApi";

const ready = {
  ok: true as const,
  value: {
    schemaVersion: "1.0" as const,
    title: "Controlled chatbot",
    state: "ready" as const,
    messages: [],
    maxInputCharacters: SYSTEM_RUNTIME_CONVERSATION_MAX_INPUT_CHARACTERS,
    canSubmit: true,
  },
};

test("exposes only bounded read and submit operations on dedicated channels", async () => {
  const calls: Array<{ channel: string; request: unknown }> = [];
  const ipcRenderer: SystemRuntimeIpcRendererPort = {
    async invoke(channel, request) {
      calls.push({ channel, request });
      const descriptor = Object.values(
        DESKTOP_SYSTEM_RUNTIME_CONVERSATION_CHANNELS,
      ).find((candidate) => candidate.request.value === channel)!;
      return createIpcSuccessResponse(descriptor.response, ready);
    },
  };
  const api = createSystemRuntimePreloadApi({ ipcRenderer });
  assert.deepEqual(Object.keys(api).sort(), ["read", "submit"]);
  assert.equal((await api.read()).ok, true);
  assert.equal(
    (await api.submit({ text: "Hello", operationId: "operation.1" })).ok,
    true,
  );
  assert.deepEqual(
    calls.map((call) => call.channel),
    [
      DESKTOP_SYSTEM_RUNTIME_CONVERSATION_CHANNELS.read.request.value,
      DESKTOP_SYSTEM_RUNTIME_CONVERSATION_CHANNELS.submit.request.value,
    ],
  );
});

test("rejects malformed input locally and sanitizes invalid IPC responses", async () => {
  let invocations = 0;
  const api = createSystemRuntimePreloadApi({
    ipcRenderer: {
      async invoke() {
        invocations += 1;
        return { path: "C:\\private\\runtime.db", stack: "internal" };
      },
    },
  });
  const invalid = await api.submit({ text: "", operationId: "../bad" });
  assert.equal(invalid.ok, false);
  assert.equal(invocations, 0);
  const unavailable = await api.read();
  assert.deepEqual(unavailable, {
    ok: false,
    error: {
      code: "runtime-unavailable",
      message: "The published system connection is unavailable.",
    },
  });
  assert.equal(JSON.stringify(unavailable).includes("private"), false);
});
