import assert from "node:assert/strict";
import test from "node:test";

import {
  DESKTOP_SYSTEM_RUNTIME_CONVERSATION_CHANNELS,
  createDesktopSystemRuntimeConversationReadRequest,
  createDesktopSystemRuntimeConversationSubmitRequest,
} from "../../../../../contracts/ipc";
import {
  SYSTEM_RUNTIME_CONVERSATION_MAX_INPUT_CHARACTERS,
  type SystemRuntimeConversationView,
} from "../../../../../contracts/system-deployment";
import { registerSystemRuntimeConversationIpc } from "../registerSystemRuntimeConversationIpc";

const view: SystemRuntimeConversationView = {
  schemaVersion: "1.0",
  title: "Controlled chatbot",
  state: "ready",
  messages: [],
  maxInputCharacters: SYSTEM_RUNTIME_CONVERSATION_MAX_INPUT_CHARACTERS,
  canSubmit: true,
};

test("serves only the session bound to the exact runtime sender", async () => {
  const handlers = new Map<string, (event: unknown, request: unknown) => Promise<unknown>>();
  const trusted = {};
  const submissions: unknown[] = [];
  registerSystemRuntimeConversationIpc({
    ipcMain: {
      handle(channel, listener) {
        handlers.set(channel, listener);
      },
    },
    resolveSession: (event) =>
      event === trusted
        ? {
            async read() { return { ok: true, value: view }; },
            async submit(command) {
              submissions.push(command);
              return { ok: true, value: view };
            },
          }
        : undefined,
  });

  const read = await handlers.get(
    DESKTOP_SYSTEM_RUNTIME_CONVERSATION_CHANNELS.read.request.value,
  )!(trusted, createDesktopSystemRuntimeConversationReadRequest()) as {
    ok: boolean;
    value?: unknown;
  };
  assert.equal(read.ok, true);
  assert.deepEqual(read.value, { ok: true, value: view });

  const submit = await handlers.get(
    DESKTOP_SYSTEM_RUNTIME_CONVERSATION_CHANNELS.submit.request.value,
  )!(
    trusted,
    createDesktopSystemRuntimeConversationSubmitRequest({
      text: "Hello",
      operationId: "operation.1",
    }),
  ) as { ok: boolean };
  assert.equal(submit.ok, true);
  assert.deepEqual(submissions, [{ text: "Hello", operationId: "operation.1" }]);

  const denied = await handlers.get(
    DESKTOP_SYSTEM_RUNTIME_CONVERSATION_CHANNELS.read.request.value,
  )!({}, createDesktopSystemRuntimeConversationReadRequest()) as {
    ok: boolean;
    error?: { code?: string; message?: string };
  };
  assert.equal(denied.ok, false);
  assert.equal(denied.error?.code, "forbidden");
  assert.equal(JSON.stringify(denied).includes("runtime.db"), false);
});

test("rejects malformed envelopes and submissions before the session is called", async () => {
  const handlers = new Map<string, (event: unknown, request: unknown) => Promise<unknown>>();
  let submissions = 0;
  registerSystemRuntimeConversationIpc({
    ipcMain: { handle: (channel, listener) => void handlers.set(channel, listener) },
    resolveSession: () => ({
      async read() { return { ok: true, value: view }; },
      async submit() {
        submissions += 1;
        return { ok: true, value: view };
      },
    }),
  });
  const malformed = await handlers.get(
    DESKTOP_SYSTEM_RUNTIME_CONVERSATION_CHANNELS.submit.request.value,
  )!({}, {
    ...createDesktopSystemRuntimeConversationSubmitRequest({
      text: "Hello",
      operationId: "operation.1",
    }),
    payload: { text: "", operationId: "../invalid" },
  }) as { ok: boolean; error?: { message?: string } };
  assert.equal(malformed.ok, false);
  assert.equal(submissions, 0);
  assert.equal(malformed.error?.message, "The runtime conversation request is invalid.");
});
