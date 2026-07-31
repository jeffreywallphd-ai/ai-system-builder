import { describe, expect, it } from "../../../../testing/node-test";
import {
  normalizeAssetId,
  type AssetInstance,
} from "../../../../contracts/asset";
import {
  readSystemBuilderConversationInteraction,
  type SystemBuilderComposition,
} from "../../../../contracts/system-builder";
import { reconcileSystemBuilderConversationInteractions } from "../reconcile-system-builder-conversation-interactions.service";

const compositionId = normalizeAssetId("composition.chat");

function instance(
  instanceId: string,
  definitionId: string,
  referenceSystemKind: string | null = "controlled-chatbot",
): AssetInstance {
  return {
    instanceId: normalizeAssetId(instanceId),
    definitionRef: {
      kind: "asset-definition-version",
      id: normalizeAssetId(definitionId),
      version: "3.0.0",
    },
    lifecycleStatus: "draft",
    selectedConfiguration: {},
    parentCompositionRef: { kind: "asset-composition", id: compositionId },
    provenance: { sourceKind: "system-generated" },
    ...(referenceSystemKind !== null
      ? { metadata: { referenceSystemKind } }
      : {}),
  };
}

function composition(
  instances: readonly AssetInstance[],
): SystemBuilderComposition {
  return {
    compositionId,
    compositionType: "system",
    displayName: "Chat",
    version: "0.1.0",
    lifecycleStatus: "draft",
    rootInstanceRefs: instances.map((item) => ({
      kind: "asset-instance" as const,
      id: item.instanceId,
    })),
    instanceRefs: instances.map((item) => ({
      kind: "asset-instance" as const,
      id: item.instanceId,
    })),
    bindingRefs: [],
    provenance: { sourceKind: "system-generated" },
  };
}

describe("reconcile System Builder conversation interactions", () => {
  it("restores the single deterministic interaction for an unambiguous legacy controlled-chatbot reference", () => {
    const composer = instance(
      "system.chat.composer",
      "conversation.message-composer",
    );
    const history = instance(
      "system.chat.history",
      "conversation.message-history-display",
    );
    const result = reconcileSystemBuilderConversationInteractions({
      systemId: "system.chat",
      composition: composition([composer, history]),
      instances: [composer, history],
      bindings: [],
      actorId: "person-1",
      timestamp: "2026-07-29T00:00:00.000Z",
    });

    expect(result.addedBinding).toBe(true);
    expect(result.bindings.length).toBe(1);
    expect(result.composition.bindingRefs.length).toBe(1);
    expect(
      readSystemBuilderConversationInteraction(result.bindings[0]!),
    ).toEqual({
      schemaVersion: "1.0",
      kind: "conversation-turn",
      composerInstanceId: "system.chat.composer",
      historyInstanceId: "system.chat.history",
      transcriptMode: "persisted-only",
    });
  });

  it("does not guess for custom or ambiguous topologies", () => {
    const customComposer = instance(
      "system.custom.composer",
      "conversation.message-composer",
      null,
    );
    const customHistory = instance(
      "system.custom.history",
      "conversation.message-history-display",
      null,
    );
    const referenceComposer = instance(
      "system.chat.composer",
      "conversation.message-composer",
    );
    const firstHistory = instance(
      "system.chat.history-1",
      "conversation.message-history-display",
    );
    const secondHistory = instance(
      "system.chat.history-2",
      "conversation.message-history-display",
    );

    expect(
      reconcileSystemBuilderConversationInteractions({
        systemId: "system.custom",
        composition: composition([customComposer, customHistory]),
        instances: [customComposer, customHistory],
        bindings: [],
        actorId: "person-1",
        timestamp: "2026-07-29T00:00:00.000Z",
      }).addedBinding,
    ).toBe(false);
    expect(
      reconcileSystemBuilderConversationInteractions({
        systemId: "system.chat",
        composition: composition([
          referenceComposer,
          firstHistory,
          secondHistory,
        ]),
        instances: [referenceComposer, firstHistory, secondHistory],
        bindings: [],
        actorId: "person-1",
        timestamp: "2026-07-29T00:00:00.000Z",
      }).addedBinding,
    ).toBe(false);
  });
});
