import type {
  SystemRunWorkflowHandlerPort,
  SystemRunWorkflowRequestContext,
} from "../../ports/system-run-workflow";
import type { ExecutionPlanRepositoryPort } from "../../ports/execution-plans";
import {
  SYSTEM_RUN_WORKFLOW_SCHEMA_VERSION,
  systemRunWorkflowFailure,
  systemRunWorkflowSuccess,
  type InvokeSystemRunWorkflowCommand,
  type ListSystemRunWorkflowProfilesQuery,
  type PrepareSystemRunWorkflowQuery,
  type SystemRunWorkflowProfileSummary,
  type SystemRunWorkflowResult,
  type SystemRunWorkflowSnapshot,
  type SystemRunWorkflowTranscriptEntry,
} from "../../../contracts/system-run-workflow";
import {
  checkExpectedSnapshot,
  requiredString,
  withBlocks,
} from "./system-run-workflow-handler-helpers";

export const CONVERSATION_WORKFLOW_PROFILE_ID =
  "builtin.workflow.conversation@1.0.0";

interface ConversationWorkflowServices {
  readonly create: {
    execute(input: {
      workspaceId: string;
      sourceExecutionPlanId: string;
    }): Promise<unknown>;
  };
  readonly approve: {
    execute(input: {
      workspaceId: string;
      conversationSessionId: string;
      approvalId: string;
    }): Promise<unknown>;
  };
  readonly submitTurn: {
    execute(input: {
      workspaceId: string;
      conversationSessionId: string;
      text: string;
      operationId: string;
    }): Promise<unknown>;
  };
  readonly cancelTurn: {
    execute(input: {
      workspaceId: string;
      conversationSessionId: string;
      conversationTurnId: string;
      operationId: string;
    }): Promise<unknown>;
  };
  readonly retryTurn: {
    execute(input: {
      workspaceId: string;
      conversationSessionId: string;
      conversationTurnId: string;
      operationId: string;
    }): Promise<unknown>;
  };
  readonly readSessions: {
    listConversationSessions(input: {
      workspaceId: string;
      sourceExecutionPlanId?: string;
      includeArchived?: boolean;
      limit?: number;
    }): Promise<unknown>;
    readDetail(input: {
      workspaceId: string;
      conversationSessionId: string;
    }): Promise<unknown>;
  };
  readonly readTranscript: {
    readTranscript(input: {
      workspaceId: string;
      conversationSessionId: string;
    }): Promise<unknown>;
  };
}

export interface CreateConversationWorkflowHandlerOptions {
  readonly executionPlans: ExecutionPlanRepositoryPort;
  readonly conversations: ConversationWorkflowServices;
  readonly profileId?: string;
  readonly now?: () => string;
}

export const createConversationWorkflowHandler = (
  options: CreateConversationWorkflowHandlerOptions,
): SystemRunWorkflowHandlerPort => {
  const profileId = options.profileId ?? CONVERSATION_WORKFLOW_PROFILE_ID;
  const now = options.now ?? (() => new Date().toISOString());

  const discover = async (
    query: ListSystemRunWorkflowProfilesQuery,
    context: SystemRunWorkflowRequestContext,
  ): Promise<
    SystemRunWorkflowResult<readonly SystemRunWorkflowProfileSummary[]>
  > => {
    if (query.sourceKind && query.sourceKind !== "reviewed-execution-plan")
      return systemRunWorkflowSuccess([]);
    const plans = query.sourceId
      ? [
          await options.executionPlans.getExecutionPlanById(
            query.workspaceId as never,
            query.sourceId as never,
          ),
        ].filter((plan): plan is NonNullable<typeof plan> => !!plan)
      : (
          await options.executionPlans.listExecutionPlans({
            workspaceId: query.workspaceId as never,
            archived: false,
            limit: 64,
          })
        ).plans;
    return systemRunWorkflowSuccess(
      plans
        .filter(
          (plan) =>
            plan.workspaceId === query.workspaceId &&
            !plan.archivedAt &&
            plan.status === "ready-for-review",
        )
        .map((plan) => ({
          schemaVersion: SYSTEM_RUN_WORKFLOW_SCHEMA_VERSION,
          profileId,
          source: {
            kind: "reviewed-execution-plan" as const,
            sourceId: String(plan.id),
            sourceRevision: plan.updatedAt,
            label: `Execution plan ${String(plan.id)}`,
          },
          title: "Test a conversation",
          description:
            "Start and approve a controlled conversation, then send bounded test messages.",
          category: "conversation",
          availability: context.authenticated ? ("available" as const) : ("blocked" as const),
          blockers: context.authenticated
            ? []
            : [
                {
                  code: "workflow.conversation.authentication-required",
                  message: "Sign in before testing this conversation.",
                },
              ],
        })),
    );
  };

  const exactPlan = async (
    query: PrepareSystemRunWorkflowQuery,
  ): Promise<SystemRunWorkflowResult<NonNullable<Awaited<ReturnType<ExecutionPlanRepositoryPort["getExecutionPlanById"]>>>>> => {
    if (query.source.kind !== "reviewed-execution-plan")
      return systemRunWorkflowFailure(
        "workflow.validation",
        "This workflow requires a reviewed execution plan.",
        "source",
      );
    const plan = await options.executionPlans.getExecutionPlanById(
      query.workspaceId as never,
      query.source.sourceId as never,
    );
    if (
      !plan ||
      plan.workspaceId !== query.workspaceId ||
      plan.archivedAt ||
      plan.status !== "ready-for-review" ||
      plan.updatedAt !== query.source.sourceRevision
    )
      return systemRunWorkflowFailure(
        "workflow.source-stale",
        "The execution plan changed or is no longer eligible.",
        "source",
      );
    return systemRunWorkflowSuccess(plan);
  };

  const prepare = async (
    query: PrepareSystemRunWorkflowQuery,
    context: SystemRunWorkflowRequestContext,
  ): Promise<SystemRunWorkflowResult<SystemRunWorkflowSnapshot>> => {
    if (!context.authenticated)
      return systemRunWorkflowFailure(
        "workflow.unauthorized",
        "Sign in before testing this conversation.",
      );
    const plan = await exactPlan(query);
    if (!plan.ok) return plan;
    const sessionsValue =
      await options.conversations.readSessions.listConversationSessions({
        workspaceId: query.workspaceId,
        sourceExecutionPlanId: query.source.sourceId,
        includeArchived: false,
        limit: 100,
      });
    const sessions = arrayFrom(sessionsValue, "items", "sessions")
      .map(asRecord)
      .filter((item) => identifier(item, "conversationSessionId", "id"));
    return systemRunWorkflowSuccess({
      schemaVersion: SYSTEM_RUN_WORKFLOW_SCHEMA_VERSION,
      profile: {
        schemaVersion: SYSTEM_RUN_WORKFLOW_SCHEMA_VERSION,
        profileId,
        source: query.source,
        title: "Test a conversation",
        description:
          "Start and approve a controlled conversation, then send bounded test messages.",
        category: "conversation",
        availability: "available",
        blockers: [],
      },
      snapshotRevision: `conversation:${sessions.length}:${latestRevision(sessions, plan.value.updatedAt)}`,
      refreshedAt: now(),
      blocks: [
        {
          blockId: "sessions",
          kind: "table",
          title: "Test conversations",
          columns: [
            { columnId: "sessionId", label: "Conversation" },
            { columnId: "status", label: "Status" },
            { columnId: "approval", label: "Approval" },
          ],
          rows: sessions.map((session) => ({
            rowId:
              identifier(session, "conversationSessionId", "id") ??
              "unknown-session",
            values: {
              sessionId:
                identifier(session, "conversationSessionId", "id") ??
                "unknown-session",
              status: stringValue(session.status) ?? "unknown",
              approval:
                stringValue(session.approvalStatus) ??
                stringValue(session.executionApprovalStatus) ??
                "not-approved",
            },
          })),
          emptyMessage: "No test conversations have been started.",
        },
      ],
      actions: conversationActions(),
    });
  };

  const sessionBlocks = async (
    workspaceId: string,
    sessionId: string,
  ): Promise<SystemRunWorkflowResult<SystemRunWorkflowSnapshot["blocks"]>> => {
    const [detailValue, transcriptValue] = await Promise.all([
      options.conversations.readSessions.readDetail({
        workspaceId,
        conversationSessionId: sessionId,
      }),
      options.conversations.readTranscript.readTranscript({
        workspaceId,
        conversationSessionId: sessionId,
      }),
    ]);
    const detail = asRecord(detailValue);
    if (detail.ok === false)
      return conversationFailure(detail, "Conversation is unavailable.");
    const entries = transcriptEntries(transcriptValue);
    return systemRunWorkflowSuccess([
      {
        blockId: "session-status",
        kind: "key-value",
        title:
          stringValue(detail.sessionLabel) ??
          stringValue(detail.systemLabel) ??
          sessionId,
        entries: [
          { key: "sessionId", label: "Conversation", value: sessionId },
          {
            key: "status",
            label: "Status",
            value: stringValue(detail.status) ?? "unknown",
          },
          {
            key: "approval",
            label: "Approval",
            value:
              stringValue(detail.approvalStatus) ??
              stringValue(detail.executionApprovalStatus) ??
              "not-approved",
          },
        ],
      },
      {
        blockId: "transcript",
        kind: "transcript",
        title: "Conversation",
        entries,
      },
    ]);
  };

  const invoke = async (
    command: InvokeSystemRunWorkflowCommand,
    context: SystemRunWorkflowRequestContext,
  ): Promise<SystemRunWorkflowResult<SystemRunWorkflowSnapshot>> => {
    const current = await prepare(command, context);
    if (!current.ok) return current;
    const expected = checkExpectedSnapshot(
      command.expectedSnapshotRevision,
      current.value,
    );
    if (!expected.ok) return expected;
    try {
      if (command.actionId === "refresh") return current;
      if (command.actionId === "open-session") {
        const blocks = await sessionBlocks(
          command.workspaceId,
          requiredString(command.values, "sessionId"),
        );
        return blocks.ok
          ? systemRunWorkflowSuccess(withBlocks(current.value, blocks.value))
          : blocks;
      }
      let result: unknown;
      let sessionId = "";
      switch (command.actionId) {
        case "create-session":
          result = await options.conversations.create.execute({
            workspaceId: command.workspaceId,
            sourceExecutionPlanId: command.source.sourceId,
          });
          sessionId = resultIdentifier(result, "conversationSessionId", "id");
          break;
        case "approve-session":
          sessionId = requiredString(command.values, "sessionId");
          result = await options.conversations.approve.execute({
            workspaceId: command.workspaceId,
            conversationSessionId: sessionId,
            approvalId: requiredString(command.values, "approvalId"),
          });
          break;
        case "send-message":
          sessionId = requiredString(command.values, "sessionId");
          result = await options.conversations.submitTurn.execute({
            workspaceId: command.workspaceId,
            conversationSessionId: sessionId,
            text: requiredString(command.values, "message"),
            operationId: command.operationId,
          });
          break;
        case "cancel-turn":
          sessionId = requiredString(command.values, "sessionId");
          result = await options.conversations.cancelTurn.execute({
            workspaceId: command.workspaceId,
            conversationSessionId: sessionId,
            conversationTurnId: requiredString(command.values, "turnId"),
            operationId: command.operationId,
          });
          break;
        case "retry-turn":
          sessionId = requiredString(command.values, "sessionId");
          result = await options.conversations.retryTurn.execute({
            workspaceId: command.workspaceId,
            conversationSessionId: sessionId,
            conversationTurnId: requiredString(command.values, "turnId"),
            operationId: command.operationId,
          });
          break;
        default:
          return systemRunWorkflowFailure(
            "workflow.unsupported",
            "The workflow action is not supported.",
            "actionId",
          );
      }
      const failure = conversationFailureFromUnknown(result);
      if (failure) return failure;
      const refreshed = await prepare(command, context);
      if (!refreshed.ok) return refreshed;
      if (!sessionId) return refreshed;
      const blocks = await sessionBlocks(command.workspaceId, sessionId);
      return blocks.ok
        ? systemRunWorkflowSuccess(withBlocks(refreshed.value, blocks.value))
        : refreshed;
    } catch (cause) {
      return systemRunWorkflowFailure(
        "workflow.validation",
        cause instanceof Error ? cause.message : "Workflow values are invalid.",
      );
    }
  };

  return { profileId, discover, prepare, invoke };
};

const conversationActions = () =>
  [
    {
      actionId: "refresh",
      label: "Refresh conversations",
      description: "Read the latest conversation state.",
      intent: "read",
      emphasis: "normal",
      requiresConfirmation: false,
      enabled: true,
      fields: [],
    },
    {
      actionId: "create-session",
      label: "Start a test conversation",
      description: "Create a controlled session from this reviewed plan.",
      intent: "mutate",
      emphasis: "normal",
      requiresConfirmation: true,
      enabled: true,
      fields: [],
    },
    {
      actionId: "open-session",
      label: "Open a conversation",
      description: "Read one conversation and its bounded transcript.",
      intent: "read",
      emphasis: "normal",
      requiresConfirmation: false,
      enabled: true,
      fields: [sessionIdField()],
    },
    {
      actionId: "approve-session",
      label: "Approve execution",
      description: "Grant explicit execution approval to one conversation.",
      intent: "mutate",
      emphasis: "caution",
      requiresConfirmation: true,
      enabled: true,
      fields: [
        sessionIdField(),
        {
          fieldId: "approvalId",
          label: "Approval identifier",
          kind: "text",
          required: true,
          maximumLength: 200,
        },
      ],
    },
    {
      actionId: "send-message",
      label: "Send a test message",
      description: "Invoke the approved conversational runtime once.",
      intent: "execute",
      emphasis: "normal",
      requiresConfirmation: true,
      enabled: true,
      fields: [
        sessionIdField(),
        {
          fieldId: "message",
          label: "Message",
          kind: "multiline",
          required: true,
          maximumLength: 4_000,
        },
      ],
    },
    {
      actionId: "cancel-turn",
      label: "Cancel a turn",
      description: "Request cancellation for one in-progress turn.",
      intent: "mutate",
      emphasis: "caution",
      requiresConfirmation: true,
      enabled: true,
      fields: [sessionIdField(), turnIdField()],
    },
    {
      actionId: "retry-turn",
      label: "Retry a turn",
      description: "Explicitly retry one eligible failed turn.",
      intent: "execute",
      emphasis: "caution",
      requiresConfirmation: true,
      enabled: true,
      fields: [sessionIdField(), turnIdField()],
    },
  ] as const;

const sessionIdField = () =>
  ({
    fieldId: "sessionId",
    label: "Conversation identifier",
    kind: "text",
    required: true,
    maximumLength: 200,
  }) as const;

const turnIdField = () =>
  ({
    fieldId: "turnId",
    label: "Turn identifier",
    kind: "text",
    required: true,
    maximumLength: 200,
  }) as const;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === "object" && !Array.isArray(value);

const asRecord = (value: unknown): Record<string, unknown> =>
  isRecord(value) ? value : {};

const arrayFrom = (
  value: unknown,
  ...fields: readonly string[]
): readonly unknown[] => {
  if (Array.isArray(value)) return value;
  const record = asRecord(value);
  for (const field of fields) if (Array.isArray(record[field])) return record[field];
  return [];
};

const stringValue = (value: unknown): string | undefined =>
  typeof value === "string" && value.trim() ? value.trim() : undefined;

const identifier = (
  value: Record<string, unknown>,
  ...fields: readonly string[]
): string | undefined => {
  for (const field of fields) {
    const found = stringValue(value[field]);
    if (found) return found;
  }
  return undefined;
};

const latestRevision = (
  sessions: readonly Record<string, unknown>[],
  fallback: string,
): string => {
  const revisions = sessions
    .map((session) => stringValue(session.updatedAt))
    .filter((value): value is string => !!value)
    .sort();
  return revisions[revisions.length - 1] ?? fallback;
};

const transcriptEntries = (
  value: unknown,
): readonly SystemRunWorkflowTranscriptEntry[] => {
  const flat = arrayFrom(value, "entries", "messages");
  if (flat.length > 0)
    return flat.flatMap((item, index) => transcriptEntry(item, index));
  return arrayFrom(value, "turns").flatMap((turn, index) => {
    const record = asRecord(turn);
    return [
      ...transcriptEntry(record.userMessage, index * 2),
      ...transcriptEntry(record.assistantResponse, index * 2 + 1),
    ];
  });
};

const transcriptEntry = (
  value: unknown,
  index: number,
): readonly SystemRunWorkflowTranscriptEntry[] => {
  const record = asRecord(value);
  const roleValue = stringValue(record.role) ?? stringValue(record.kind);
  const role =
    roleValue === "assistant"
      ? "assistant"
      : roleValue === "user"
        ? "user"
        : undefined;
  const text = stringValue(record.text) ?? stringValue(record.content);
  if (!role || !text) return [];
  return [
    {
      entryId:
        identifier(record, "id", "entryId", "messageId") ??
        `transcript-${index}`,
      role,
      text,
      ...(stringValue(record.createdAt)
        ? { occurredAt: stringValue(record.createdAt) }
        : {}),
    },
  ];
};

const conversationFailureFromUnknown = (
  value: unknown,
): SystemRunWorkflowResult<never> | undefined => {
  const record = asRecord(value);
  if (record.kind !== "failure" && record.ok !== false) return undefined;
  return conversationFailure(record, "The conversation action failed.");
};

const conversationFailure = (
  record: Record<string, unknown>,
  fallback: string,
): SystemRunWorkflowResult<never> => {
  const diagnostics = arrayFrom(record, "diagnostics");
  const first = asRecord(diagnostics[0]);
  const failureKind = stringValue(record.failureKind);
  return systemRunWorkflowFailure(
    failureKind === "not-found"
      ? "workflow.source-not-found"
      : failureKind === "conflict"
        ? "workflow.conflict"
        : failureKind === "forbidden"
          ? "workflow.unauthorized"
          : "workflow.blocked",
    stringValue(first.message) ?? stringValue(record.message) ?? fallback,
  );
};

const resultIdentifier = (
  value: unknown,
  ...fields: readonly string[]
): string => {
  const record = asRecord(value);
  const nested = asRecord(record.value);
  return identifier(nested, ...fields) ?? identifier(record, ...fields) ?? "";
};
