import type {
  ApprovedConversationalInvocationSource,
  ConversationalInvocationRuntimeReference,
  ProtectedConversationalInvocationContext,
} from "./conversation-turn-invocation.port";

export type ConversationalInvocationContextRequest = Readonly<{
  source: ApprovedConversationalInvocationSource;
  runtime: ConversationalInvocationRuntimeReference;
  userTurnContent: string;
  conversationTurnId?: string;
  executionRunId?: string;
  executionAttemptId?: string;
  operationId?: string;
}>;

export type ConversationalInvocationContextPreparationResult =
  | Readonly<{
      status: "prepared";
      context: ProtectedConversationalInvocationContext;
    }>
  | Readonly<{ status: "invalid" | "unavailable" | "blocked" }>;

export interface ConversationalInvocationContextPort {
  prepareProtectedInvocationContext(
    request: ConversationalInvocationContextRequest,
  ): Promise<ConversationalInvocationContextPreparationResult>;
}
