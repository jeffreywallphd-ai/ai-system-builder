import { describe, expect, it } from "../../../../testing/node-test";
import type {
  AssetInstance,
  AssetPlacement,
  AssetReference,
  AssetType,
} from "../../../../contracts/asset";
import type { SystemBuilderComposerAsset } from "../../../../contracts/system-builder";
import {
  groupSystemComposerUnplacedInstances,
  isSystemComposerVisualInstance,
} from "../systemComposerAssetClassification";

describe("System Composer unplaced asset classification", () => {
  it("separates draggable visual assets from nonvisual resources using exact catalog types", () => {
    const root = instance("system.root", "builtin.system.system");
    const visual = instance("system.card", "builtin.ui.card");
    const policy = instance("system.policy", "builtin.security.policy");
    const assistant = instance(
      "system.assistant",
      "conversation.basic-assistant-system",
    );
    const messageInput = instance(
      "system.message-input",
      "conversation.user-message-input",
    );
    const unknown = instance("system.unknown", "workspace.unknown");
    const placedPage = instance("system.page", "builtin.shell.page");
    const catalog = [
      asset("builtin.ui.card", "ui-component"),
      asset("builtin.security.policy", "policy"),
      {
        ...asset("conversation.basic-assistant-system", "system"),
        slots: [slot("interface")],
      },
      asset("conversation.user-message-input", "schema"),
      asset("builtin.shell.page", "page"),
    ];

    const result = groupSystemComposerUnplacedInstances({
      instances: [
        root,
        visual,
        policy,
        assistant,
        messageInput,
        unknown,
        placedPage,
      ],
      placements: [placement(root, placedPage)],
      rootInstanceRefs: [reference(root)],
      catalog,
    });

    expect(result.unplacedInstances.map(id)).toEqual([
      "system.card",
      "system.policy",
      "system.assistant",
      "system.message-input",
      "system.unknown",
    ]);
    expect(result.unassignedVisualInstances.map(id)).toEqual([
      "system.card",
      "system.assistant",
      "system.message-input",
    ]);
    expect(result.systemResourceInstances.map(id)).toEqual([
      "system.policy",
      "system.unknown",
    ]);
    expect(isSystemComposerVisualInstance(visual, catalog)).toBe(true);
    expect(isSystemComposerVisualInstance(policy, catalog)).toBe(false);
    expect(isSystemComposerVisualInstance(assistant, catalog)).toBe(true);
    expect(isSystemComposerVisualInstance(messageInput, catalog)).toBe(true);
    expect(isSystemComposerVisualInstance(unknown, catalog)).toBe(false);
  });

  it("does not expose an application layout shell as a draggable unassigned visual", () => {
    const shell = instance(
      "system.shell",
      "builtin.layout.application.minimal",
    );
    const catalog = [
      {
        ...asset("builtin.layout.application.minimal", "ui-component"),
        layoutRole: "application-shell" as const,
      },
    ];
    expect(isSystemComposerVisualInstance(shell, catalog)).toBe(false);
  });

  it("fails closed for an untrusted system container", () => {
    const container = instance("system.custom", "workspace.custom-system");
    const catalog = [
      {
        ...asset("workspace.custom-system", "system"),
        slots: [slot("content")],
        implementationAvailability: "definition-only" as const,
        previewAvailability: "unavailable" as const,
      },
    ];
    expect(isSystemComposerVisualInstance(container, catalog)).toBe(false);
  });
});

function slot(slotId: string): SystemBuilderComposerAsset["slots"][number] {
  return {
    schemaVersion: "asset-slot-definition.v1",
    slotId: slotId as never,
    displayName: slotId,
    cardinality: { minItems: 0, maxItems: 8 },
    acceptedAssetTypes: ["ui-component"],
  };
}

function instance(instanceId: string, definitionId: string): AssetInstance {
  return {
    instanceId,
    definitionRef: {
      kind: "asset-definition-version",
      id: definitionId,
      version: "2.0.0",
    },
    lifecycleStatus: "draft",
    provenance: { sourceKind: "human-authored" },
  } as unknown as AssetInstance;
}

function asset(
  definitionId: string,
  assetType: AssetType,
): SystemBuilderComposerAsset {
  return {
    definitionRef: {
      kind: "asset-definition-version",
      id: definitionId,
      version: "2.0.0",
    },
    definitionId,
    version: "2.0.0",
    displayName: definitionId,
    description: definitionId,
    assetType,
    assetFamily: "structural",
    lifecycleStatus: "published",
    builtIn: true,
    ports: [],
    slots: [],
    compatibility: { status: "not-evaluated" },
    implementationAvailability: "trusted-system-foundation",
    previewAvailability: "trusted-declarative",
  } as unknown as SystemBuilderComposerAsset;
}

function reference(instanceValue: AssetInstance): AssetReference {
  return {
    kind: "asset-instance",
    id: instanceValue.instanceId,
  } as AssetReference;
}

function placement(
  parent: AssetInstance,
  child: AssetInstance,
): AssetPlacement {
  return {
    schemaVersion: "asset-placement.v1",
    placementId: "placement.page",
    parentInstanceRef: reference(parent),
    slotId: "content",
    childInstanceRef: reference(child),
    order: 0,
  } as AssetPlacement;
}

function id(instanceValue: AssetInstance): string {
  return String(instanceValue.instanceId);
}
