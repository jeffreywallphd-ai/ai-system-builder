import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import * as applicationPorts from "../../index";
import type {
  ConversationTurnInvocationOutcome,
  ConversationalAdapterSelection,
  ConversationalRuntimeGuardStatus,
  ProtectedConversationalInvocationContext,
} from "../index";

test("conversational execution ports and parent barrel load", () => {
  assert.ok(applicationPorts);
  const outcome: ConversationTurnInvocationOutcome = { status: "unsupported" };
  const selection: ConversationalAdapterSelection = { status: "deferred" };
  const guard: ConversationalRuntimeGuardStatus = "configuration-required";
  assert.deepEqual(
    [outcome.status, selection.status, guard],
    ["unsupported", "deferred", "configuration-required"],
  );
});

test("protected context shape is provider-neutral and source-associated", () => {
  const context: ProtectedConversationalInvocationContext = {
    contextKind: "protected-conversational-invocation",
    source: {
      workspaceId: "workspace.1",
      conversationSessionId: "conversation.session.1",
      sourceExecutionPlanId: "execution.plan.1",
      sourceCompositionPlanId: "composition.plan.1",
      sourceRuntimeReadinessBindingId: "readiness.binding.1",
      executionApprovalId: "execution.approval.1",
      runtimeReferenceId: "runtime.reference.1",
    },
    runtime: {
      runtimeId: "runtime.1",
      capabilityKind: "text-generation",
      runtimeReferenceId: "runtime.reference.1",
    },
    userTurnContent: "Hello",
  };
  assert.equal(context.source.sourceCompositionPlanId, "composition.plan.1");
});

test("port sources preserve application boundary discipline", () => {
  const family = [
    "conversation-turn-invocation.port.ts",
    "conversational-runtime-adapter-catalog.port.ts",
    "conversational-invocation-context.port.ts",
    "conversational-runtime-guard.port.ts",
  ]
    .map((file) =>
      readFileSync(
        `modules/application/ports/conversational-execution/${file}`,
        "utf8",
      ),
    )
    .join("\n");
  const forbiddenImports = [
    "/adapters/",
    "/hosts/",
    "/api/",
    "/ipc/",
    "/preload/",
    "/ui/",
    "node:fs",
    "node:process",
    "electron",
    "express",
    "comfyui",
    "python-runtime",
    "secret-manager",
  ];
  for (const token of forbiddenImports) {
    assert.equal(family.toLowerCase().includes(`from ${token}`), false);
  }
  assert.equal(/\bproviderPayload\s*[:?]/.test(family), false);
  assert.equal(/\bcredentials?\s*[:?]/.test(family), false);
  assert.equal(/\bmodelPath\s*[:?]/.test(family), false);

  const parentBarrel = readFileSync(
    "modules/application/ports/index.ts",
    "utf8",
  );
  assert.match(parentBarrel, /conversational-execution/);
});
