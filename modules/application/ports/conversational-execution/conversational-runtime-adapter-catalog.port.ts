import type {
  ApprovedConversationalInvocationSource,
  ConversationalInvocationRuntimeReference,
} from "./conversation-turn-invocation.port";

export type ConversationalAdapterCapability = Readonly<{
  progress: boolean;
  cancellation: boolean;
}>;

export type ConversationalAdapterSelectionRequest = Readonly<{
  source: ApprovedConversationalInvocationSource;
  runtime: ConversationalInvocationRuntimeReference;
}>;

export type ConversationalAdapterSelection =
  | Readonly<{
      status: "supported";
      adapterId: string;
      capabilityKind: "text-generation";
      capabilities: ConversationalAdapterCapability;
    }>
  | Readonly<{
      status:
        "deferred" | "unsupported" | "unavailable" | "invalid" | "blocked";
    }>;

export interface ConversationalRuntimeAdapterCatalogPort {
  resolveForRuntime(
    request: ConversationalAdapterSelectionRequest,
  ): Promise<ConversationalAdapterSelection>;
}
