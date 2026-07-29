import type { AssetBinding, AssetJsonValue } from "../asset";

export const SYSTEM_BUILDER_CONVERSATION_INTERACTION_KIND =
  "conversation-turn";
export const SYSTEM_BUILDER_CONVERSATION_INTERACTION_SCHEMA_VERSION = "1.0";
export const SYSTEM_BUILDER_CONVERSATION_INTERACTION_METADATA_KEY =
  "systemBuilderInteraction";

export interface SystemBuilderConversationInteraction {
  readonly schemaVersion: typeof SYSTEM_BUILDER_CONVERSATION_INTERACTION_SCHEMA_VERSION;
  readonly kind: typeof SYSTEM_BUILDER_CONVERSATION_INTERACTION_KIND;
  readonly composerInstanceId: string;
  readonly historyInstanceId: string;
  readonly transcriptMode: "persisted-only";
}

export function createSystemBuilderConversationInteractionMetadata(): Readonly<
  Record<string, AssetJsonValue>
> {
  return {
    [SYSTEM_BUILDER_CONVERSATION_INTERACTION_METADATA_KEY]: {
      schemaVersion: SYSTEM_BUILDER_CONVERSATION_INTERACTION_SCHEMA_VERSION,
      kind: SYSTEM_BUILDER_CONVERSATION_INTERACTION_KIND,
      transcriptMode: "persisted-only",
    },
  };
}

export function readSystemBuilderConversationInteraction(
  binding: AssetBinding,
): SystemBuilderConversationInteraction | undefined {
  if (
    binding.bindingKind !== "control" ||
    binding.sourceRef.kind !== "asset-instance" ||
    binding.targetRef.kind !== "asset-instance"
  ) {
    return undefined;
  }
  const value = binding.metadata?.[
    SYSTEM_BUILDER_CONVERSATION_INTERACTION_METADATA_KEY
  ];
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return undefined;
  }
  const interaction = value as Readonly<Record<string, AssetJsonValue>>;
  if (
    interaction.schemaVersion !==
      SYSTEM_BUILDER_CONVERSATION_INTERACTION_SCHEMA_VERSION ||
    interaction.kind !== SYSTEM_BUILDER_CONVERSATION_INTERACTION_KIND ||
    interaction.transcriptMode !== "persisted-only"
  ) {
    return undefined;
  }
  return {
    schemaVersion: SYSTEM_BUILDER_CONVERSATION_INTERACTION_SCHEMA_VERSION,
    kind: SYSTEM_BUILDER_CONVERSATION_INTERACTION_KIND,
    composerInstanceId: String(binding.sourceRef.id),
    historyInstanceId: String(binding.targetRef.id),
    transcriptMode: "persisted-only",
  };
}
