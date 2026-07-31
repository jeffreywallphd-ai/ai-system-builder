import {
  normalizeAssetId,
  type AssetBinding,
  type AssetInstance,
  type AssetReference,
} from "../../../contracts/asset";
import {
  createSystemBuilderConversationInteractionMetadata,
  readSystemBuilderConversationInteraction,
  type SystemBuilderComposition,
} from "../../../contracts/system-builder";

const CONTROLLED_CHATBOT_REFERENCE_KIND = "controlled-chatbot";
const MESSAGE_COMPOSER_DEFINITION_ID = "conversation.message-composer";
const MESSAGE_HISTORY_DEFINITION_ID = "conversation.message-history-display";

export interface ReconcileSystemBuilderConversationInteractionsInput {
  readonly systemId: string;
  readonly composition: SystemBuilderComposition;
  readonly instances: readonly AssetInstance[];
  readonly bindings: readonly AssetBinding[];
  readonly actorId: string;
  readonly timestamp: string;
}

export interface ReconciledSystemBuilderConversationInteractions {
  readonly composition: SystemBuilderComposition;
  readonly bindings: readonly AssetBinding[];
  readonly addedBinding: boolean;
}

export function reconcileSystemBuilderConversationInteractions(
  input: ReconcileSystemBuilderConversationInteractionsInput,
): ReconciledSystemBuilderConversationInteractions {
  const referenceInstances = input.instances.filter(
    (instance) =>
      instance.metadata?.referenceSystemKind ===
      CONTROLLED_CHATBOT_REFERENCE_KIND,
  );
  const composers = referenceInstances.filter(
    (instance) =>
      String(instance.definitionRef.id) === MESSAGE_COMPOSER_DEFINITION_ID,
  );
  const histories = referenceInstances.filter(
    (instance) =>
      String(instance.definitionRef.id) === MESSAGE_HISTORY_DEFINITION_ID,
  );
  const interactions = input.bindings
    .map(readSystemBuilderConversationInteraction)
    .filter((interaction) => interaction !== undefined);
  if (
    composers.length !== 1 ||
    histories.length !== 1 ||
    interactions.length !== 0
  ) {
    return {
      composition: input.composition,
      bindings: input.bindings,
      addedBinding: false,
    };
  }

  const bindingId = normalizeAssetId(
    `${input.systemId}.binding.composer-history`,
  );
  if (
    input.bindings.some((binding) => String(binding.bindingId) === bindingId)
  ) {
    return {
      composition: input.composition,
      bindings: input.bindings,
      addedBinding: false,
    };
  }

  const binding: AssetBinding = {
    bindingId,
    bindingKind: "control",
    sourceRef: {
      kind: "asset-instance",
      id: normalizeAssetId(String(composers[0]!.instanceId)),
    },
    targetRef: {
      kind: "asset-instance",
      id: normalizeAssetId(String(histories[0]!.instanceId)),
    },
    lifecycleStatus: "draft",
    provenance: {
      sourceKind: "system-generated",
      createdAt: input.timestamp,
      createdBy: input.actorId,
    },
    metadata: createSystemBuilderConversationInteractionMetadata(),
  };
  const bindingRef: AssetReference = {
    kind: "asset-binding",
    id: bindingId,
  };
  return {
    composition: {
      ...input.composition,
      bindingRefs: [...(input.composition.bindingRefs ?? []), bindingRef],
    },
    bindings: [...input.bindings, binding],
    addedBinding: true,
  };
}
