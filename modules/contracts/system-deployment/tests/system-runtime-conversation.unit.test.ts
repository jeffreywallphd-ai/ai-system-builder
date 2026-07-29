import assert from "node:assert/strict";
import test from "node:test";

import {
  SYSTEM_RUNTIME_CONVERSATION_MAX_INPUT_CHARACTERS,
  isSystemRuntimeConversationViewResult,
  normalizeSubmitSystemRuntimeConversationTurnCommand,
} from "..";

test("normalizes bounded runtime conversation submissions", () => {
  assert.deepEqual(
    normalizeSubmitSystemRuntimeConversationTurnCommand({
      text: "Hello\nworld",
      operationId: "operation.runtime.1",
    }),
    { text: "Hello\nworld", operationId: "operation.runtime.1" },
  );
  assert.throws(() =>
    normalizeSubmitSystemRuntimeConversationTurnCommand({
      text: "x".repeat(SYSTEM_RUNTIME_CONVERSATION_MAX_INPUT_CHARACTERS + 1),
      operationId: "operation.runtime.2",
    }),
  );
  assert.throws(() =>
    normalizeSubmitSystemRuntimeConversationTurnCommand({
      text: "Hello",
      operationId: "../foreign-runtime",
    }),
  );
});

test("accepts only bounded safe runtime conversation projections", () => {
  const result = {
    ok: true as const,
    value: {
      schemaVersion: "1.0" as const,
      title: "Controlled chatbot",
      state: "ready" as const,
      messages: [
        {
          id: "message.1",
          role: "assistant" as const,
          text: "Ready",
          createdAt: "2026-07-29T18:00:00.000Z",
        },
      ],
      maxInputCharacters: SYSTEM_RUNTIME_CONVERSATION_MAX_INPUT_CHARACTERS,
      canSubmit: true,
    },
  };
  assert.equal(isSystemRuntimeConversationViewResult(result), true);
  assert.equal(
    isSystemRuntimeConversationViewResult({
      ...result,
      value: {
        ...result.value,
        messages: Array.from({ length: 201 }, () => result.value.messages[0]),
      },
    }),
    false,
  );
  assert.equal(
    isSystemRuntimeConversationViewResult({
      ok: false,
      error: { code: "internal-path", message: "C:\\private\\runtime.db" },
    }),
    false,
  );
});
