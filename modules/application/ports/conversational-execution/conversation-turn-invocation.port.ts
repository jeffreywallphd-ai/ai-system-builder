/**
 * Safe runtime identity carried across the application invocation boundary.
 *
 * The reference is intentionally provider-neutral. Concrete model names,
 * credentials, endpoints, paths, and provider request options stay adapter-owned.
 */
export type ConversationalInvocationRuntimeReference = Readonly<{
  runtimeId: string;
  capabilityKind: "text-generation";
  runtimeReferenceId: string;
  selectedModelRecordId: string;
}>;

/**
 * The approved, asset-derived source chain for one invocation.
 *
 * This is an in-memory orchestration association, not a persistence record and
 * not proof on its own. Prompt 4 approval validity re-verifies the referenced
 * records before this value can reach a runtime adapter.
 */
export type ApprovedConversationalInvocationSource = Readonly<{
  workspaceId: string;
  conversationSessionId: string;
  sourceExecutionPlanId: string;
  sourceCompositionPlanId: string;
  sourceRuntimeReadinessBindingId: string;
  executionApprovalId: string;
  runtimeReferenceId: string;
}>;

export type ProtectedConversationHistoryEntry = Readonly<{
  role: "user" | "assistant";
  content: string;
}>;

export type ProtectedConversationalGenerationSettings = Readonly<{
  temperature?: number;
  maxOutputTokens?: number;
}>;

/**
 * Transient model-facing context. It must never be copied into ordinary run,
 * event, approval, provenance, diagnostic, or read-model records.
 */
export type ProtectedConversationalInvocationContext = Readonly<{
  contextKind: "protected-conversational-invocation";
  source: ApprovedConversationalInvocationSource;
  runtime: ConversationalInvocationRuntimeReference;
  userTurnContent: string;
  systemInstruction?: string;
  history?: ReadonlyArray<ProtectedConversationHistoryEntry>;
  generation?: ProtectedConversationalGenerationSettings;
}>;

export type ConversationTurnInvocationRequest = Readonly<{
  source: ApprovedConversationalInvocationSource;
  runtime: ConversationalInvocationRuntimeReference;
  context: ProtectedConversationalInvocationContext;
  conversationTurnId?: string;
  executionRunId?: string;
  executionAttemptId?: string;
  operationId?: string;
}>;

export type ConversationTurnInvocationFailureCode =
  "internal" | "validation" | "runtime-error";

export type ConversationTurnInvocationOutcome =
  | Readonly<{ status: "completed"; assistantResponseText: string }>
  | Readonly<{
      status: "failed";
      code: ConversationTurnInvocationFailureCode;
    }>
  | Readonly<{ status: "cancelled" }>
  | Readonly<{ status: "timed-out" }>
  | Readonly<{ status: "unavailable" }>
  | Readonly<{ status: "not-ready" }>
  | Readonly<{ status: "unsupported" }>
  | Readonly<{ status: "blocked" }>;

export type ConversationInvocationOrchestrationFailureStatus =
  | "invalid-request"
  | "approval-required"
  | "approval-invalidated"
  | "source-plan-not-ready"
  | "source-plan-stale"
  | "runtime-readiness-not-acceptable"
  | "session-not-eligible"
  | "deferred"
  | "unsupported"
  | "unavailable"
  | "invalid"
  | "blocked"
  | "starting"
  | "configuration-required"
  | "permission-required"
  | "unhealthy"
  | "stale"
  | "not-ready"
  | "invalid-invocation-context"
  | "cancelled"
  | "timed-out"
  | "failed"
  | "internal-unavailable";

export type ConversationInvocationOrchestrationResult =
  | Readonly<{ status: "completed"; assistantResponseText: string }>
  | Readonly<{
      status: ConversationInvocationOrchestrationFailureStatus;
      reason?: string;
    }>;

export interface ConversationTurnInvocationPort {
  invokeConversationTurn(
    request: ConversationTurnInvocationRequest,
  ): Promise<ConversationTurnInvocationOutcome>;
}
