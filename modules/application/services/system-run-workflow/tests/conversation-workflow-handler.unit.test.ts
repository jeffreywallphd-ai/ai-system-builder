import { describe, expect, it } from "../../../../testing/node-test";
import type { ExecutionPlanRepositoryPort } from "../../../ports/execution-plans";
import { createConversationWorkflowHandler } from "../conversation-workflow-handler.service";

const plan = {
  id: "plan-1",
  workspaceId: "workspace-1",
  status: "ready-for-review",
  updatedAt: "2026-07-29T00:00:00.000Z",
  blockers: [],
};
const actor = {
  actorId: "owner-1",
  roles: ["owner"],
  authenticated: true,
} as const;
const source = {
  kind: "reviewed-execution-plan" as const,
  sourceId: "plan-1",
  sourceRevision: plan.updatedAt,
  label: "Plan 1",
};

const fixture = () => {
  const calls = { listSessions: 0, create: 0, transcript: 0 };
  const executionPlans = {
    getExecutionPlanById: async () => plan,
    listExecutionPlans: async () => ({ plans: [plan] }),
  } as unknown as ExecutionPlanRepositoryPort;
  const handler = createConversationWorkflowHandler({
    executionPlans,
    conversations: {
      create: {
        async execute() {
          calls.create += 1;
          return {
            kind: "success",
            value: { id: "session-1", conversationSessionId: "session-1" },
          };
        },
      },
      approve: { execute: async () => ({ kind: "success", value: {} }) },
      submitTurn: { execute: async () => ({ kind: "success", value: {} }) },
      cancelTurn: { execute: async () => ({ kind: "success", value: {} }) },
      retryTurn: { execute: async () => ({ kind: "success", value: {} }) },
      readSessions: {
        async listConversationSessions() {
          calls.listSessions += 1;
          return { items: [] };
        },
        async readDetail() {
          return {
            conversationSessionId: "session-1",
            status: "awaiting-approval",
          };
        },
      },
      readTranscript: {
        async readTranscript() {
          calls.transcript += 1;
          return {
            ok: true,
            turns: [
              {
                userMessage: {
                  id: "message-1",
                  role: "user",
                  text: "Hello",
                },
              },
            ],
          };
        },
      },
    },
    now: () => "2026-07-29T00:00:00.000Z",
  });
  return { calls, handler };
};

describe("conversation workflow handler", () => {
  it("discovers reviewed plans without reading sessions", async () => {
    const { calls, handler } = fixture();
    const result = await handler.discover(
      { workspaceId: "workspace-1" },
      actor,
    );
    expect(result.ok).toBe(true);
    expect(calls).toEqual({ listSessions: 0, create: 0, transcript: 0 });
  });

  it("prepares sessions only after the profile is selected", async () => {
    const { calls, handler } = fixture();
    const result = await handler.prepare(
      {
        workspaceId: "workspace-1",
        profileId: handler.profileId,
        source,
      },
      actor,
    );
    expect(result.ok).toBe(true);
    expect(
      result.ok
        ? result.value.actions.map((action) => action.actionId)
        : [],
    ).toEqual([
      "refresh",
      "create-session",
      "open-session",
      "approve-session",
      "send-message",
      "cancel-turn",
      "retry-turn",
    ]);
    expect(calls.listSessions).toBe(1);
    expect(calls.transcript).toBe(0);
  });

  it("starts a session only after an explicit action and then reads its transcript", async () => {
    const { calls, handler } = fixture();
    const result = await handler.invoke(
      {
        workspaceId: "workspace-1",
        profileId: handler.profileId,
        source,
        actionId: "create-session",
        operationId: "operation-1",
        values: {},
      },
      actor,
    );
    expect(result.ok).toBe(true);
    expect(calls.create).toBe(1);
    expect(calls.transcript).toBe(1);
  });

  it("rejects stale plan revisions before reading sessions", async () => {
    const { calls, handler } = fixture();
    const result = await handler.prepare(
      {
        workspaceId: "workspace-1",
        profileId: handler.profileId,
        source: {
          ...source,
          sourceRevision: "2026-07-28T00:00:00.000Z",
        },
      },
      actor,
    );
    expect(result.ok).toBe(false);
    expect(result.ok ? "" : result.error.code).toBe("workflow.source-stale");
    expect(calls.listSessions).toBe(0);
  });
});
