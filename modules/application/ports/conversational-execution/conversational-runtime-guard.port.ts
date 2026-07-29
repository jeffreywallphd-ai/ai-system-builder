import type {
  ApprovedConversationalInvocationSource,
  ConversationalInvocationRuntimeReference,
} from "./conversation-turn-invocation.port";

export type ConversationalRuntimeGuardStatus =
  | "ready"
  | "starting"
  | "unavailable"
  | "configuration-required"
  | "permission-required"
  | "unsupported"
  | "unhealthy"
  | "stale"
  | "blocked"
  | "deferred";

export type ConversationalRuntimeGuardRequest = Readonly<{
  adapterId: string;
  source: ApprovedConversationalInvocationSource;
  runtime: ConversationalInvocationRuntimeReference;
}>;

export interface ConversationalRuntimeGuardPort {
  getRuntimeStatus(
    request: ConversationalRuntimeGuardRequest,
  ): Promise<ConversationalRuntimeGuardStatus>;
}
