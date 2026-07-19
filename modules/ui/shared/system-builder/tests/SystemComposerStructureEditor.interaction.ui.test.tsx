// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

import type {
  AssetInstance,
  AssetPlacement,
} from "../../../../contracts/asset";
import {
  ASSET_PLACEMENT_SCHEMA_VERSION,
  normalizeAssetId,
  normalizeAssetSlotId,
} from "../../../../contracts/asset";
import type { SystemBuilderComposerAsset } from "../../../../contracts/system-builder";
import {
  SystemComposerStructureEditor,
  SystemLayoutGallery,
} from "../SystemComposerStructureEditor";

(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | undefined;
let container: HTMLDivElement | undefined;

afterEach(() => {
  act(() => root?.unmount());
  container?.remove();
  document.body.innerHTML = "";
  root = undefined;
  container = undefined;
});

describe("SystemComposerStructureEditor interactions", () => {
  it("keeps the semantic canvas, keyboard tree, and native actions on one draft", async () => {
    const onSelect = vi.fn();
    const onTargetSlotChange = vi.fn();
    const onAdd = vi.fn();
    const onRemove = vi.fn();
    const onRedo = vi.fn();
    const onWrap = vi.fn();
    const onWrapTargetChange = vi.fn();
    const system = composerAsset("builtin.system.system", [
      "application-shell",
    ]);
    const shell = composerAsset("builtin.layout.application.standard", [
      "content",
    ]);
    const card = composerAsset("builtin.container.card", ["body"]);

    render(
      <SystemComposerStructureEditor
        draft={{
          instances: [
            instance("instance.root", "builtin.system.system", "System root"),
            instance("instance.shell", shell.definitionId, "Application shell"),
          ],
          placements: [
            placement("instance.root", "application-shell", "instance.shell"),
          ],
          bindings: [],
        }}
        rootInstanceRefs={[
          { kind: "asset-instance", id: normalizeAssetId("instance.root") },
        ]}
        catalog={[system, shell, card]}
        compatibleAssets={[card]}
        selectedInstanceId="instance.shell"
        targetSlot={{ parentInstanceId: "instance.shell", slotId: "content" }}
        protectedInstanceIds={new Set(["instance.root", "instance.shell"])}
        canUndo={false}
        canRedo
        onSelect={onSelect}
        onTargetSlotChange={onTargetSlotChange}
        onAdd={onAdd}
        onMove={vi.fn()}
        onReparent={vi.fn()}
        onWrap={onWrap}
        wrapCompatibility={{ status: "compatible" }}
        onWrapTargetChange={onWrapTargetChange}
        onRemove={onRemove}
        onUndo={vi.fn()}
        onRedo={onRedo}
      />,
    );

    const treeItems = Array.from(
      container!.querySelectorAll<HTMLButtonElement>('[role="treeitem"]'),
    );
    expect(treeItems).toHaveLength(2);
    expect(treeItems[1]?.getAttribute("aria-selected")).toBe("true");
    expect(container!.textContent).toContain("System root");
    expect(container!.textContent).toContain("Application shell");

    await fire(treeItems[1]!, "keydown", { key: "ArrowUp" });
    expect(onSelect).toHaveBeenCalledWith("instance.root");

    const contentSlot = container!.querySelector<HTMLElement>(
      '[aria-label="content slot"]',
    );
    expect(contentSlot).not.toBeNull();
    await click(contentSlot!.querySelector<HTMLButtonElement>("button")!);
    expect(onTargetSlotChange).toHaveBeenCalledWith({
      parentInstanceId: "instance.shell",
      slotId: "content",
    });

    await click(button("Add"));
    expect(onAdd).toHaveBeenCalledWith(card, {
      parentInstanceId: "instance.shell",
      slotId: "content",
    });
    const wrapFieldset = Array.from(
      container!.querySelectorAll("fieldset"),
    ).find((fieldset) =>
      fieldset.textContent?.includes("Wrap in a container"),
    )!;
    const wrapperSelect =
      wrapFieldset.querySelectorAll<HTMLSelectElement>("select")[0]!;
    await change(wrapperSelect, card.definitionId);
    const slotSelect =
      wrapFieldset.querySelectorAll<HTMLSelectElement>("select")[1]!;
    await change(slotSelect, "body");
    expect(onWrapTargetChange).toHaveBeenLastCalledWith(card, "body");
    await click(button("Wrap asset"));
    expect(onWrap).toHaveBeenCalledWith(card, "body");

    expect(button("Undo").disabled).toBe(true);
    await click(button("Redo"));
    expect(onRedo).toHaveBeenCalledTimes(1);
    expect(button("Remove selected subtree").disabled).toBe(true);
    expect(onRemove).not.toHaveBeenCalled();
  });

  it("offers predefined layouts as a native single-choice gallery", async () => {
    const onSelect = vi.fn();
    const standard = composerAsset("builtin.layout.application.standard", [
      "top-bar",
      "content",
    ]);
    const sidebar = composerAsset("builtin.layout.application.sidebar", [
      "top-bar",
      "side-bar",
      "content",
    ]);

    render(
      <SystemLayoutGallery
        layouts={[standard, sidebar]}
        selectedDefinitionId={standard.definitionId}
        onSelect={onSelect}
      />,
    );

    const choices = Array.from(
      container!.querySelectorAll<HTMLInputElement>(
        'input[name="system-layout"]',
      ),
    );
    expect(choices).toHaveLength(2);
    expect(choices[0]?.checked).toBe(true);
    await act(async () => {
      choices[1]?.click();
    });
    expect(onSelect).toHaveBeenCalledWith(sidebar);
  });
});

function render(element: React.ReactNode): void {
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  act(() => root?.render(element));
}

function button(label: string): HTMLButtonElement {
  const match = Array.from(
    container!.querySelectorAll<HTMLButtonElement>("button"),
  ).find((candidate) => candidate.textContent?.trim() === label);
  if (!match) throw new Error(`Missing button: ${label}`);
  return match;
}

async function click(element: HTMLElement): Promise<void> {
  await act(async () => element.click());
}
async function change(
  element: HTMLSelectElement,
  value: string,
): Promise<void> {
  await act(async () => {
    element.value = value;
    element.dispatchEvent(new Event("change", { bubbles: true }));
  });
}

async function fire(
  element: HTMLElement,
  type: string,
  init: KeyboardEventInit,
): Promise<void> {
  await act(async () =>
    element.dispatchEvent(new KeyboardEvent(type, { ...init, bubbles: true })),
  );
}

function instance(
  instanceId: string,
  definitionId: string,
  displayName: string,
): AssetInstance {
  return {
    instanceId: normalizeAssetId(instanceId),
    definitionRef: {
      kind: "asset-definition-version",
      id: normalizeAssetId(definitionId),
      version: "2.0.0",
    },
    displayName,
    lifecycleStatus: "draft",
    selectedConfiguration: {},
    provenance: { sourceKind: "system-generated" },
  };
}

function placement(
  parentId: string,
  slotId: string,
  childId: string,
): AssetPlacement {
  return {
    schemaVersion: ASSET_PLACEMENT_SCHEMA_VERSION,
    placementId: normalizeAssetId(`placement.${parentId}.${slotId}.${childId}`),
    parentInstanceRef: {
      kind: "asset-instance",
      id: normalizeAssetId(parentId),
    },
    slotId: normalizeAssetSlotId(slotId),
    childInstanceRef: { kind: "asset-instance", id: normalizeAssetId(childId) },
    order: 0,
  };
}

function composerAsset(
  definitionId: string,
  slotIds: readonly string[],
): SystemBuilderComposerAsset {
  return {
    definitionRef: {
      kind: "asset-definition-version",
      id: normalizeAssetId(definitionId),
      version: "2.0.0",
    },
    definitionId,
    version: "2.0.0",
    displayName: definitionId,
    description: `${definitionId} description`,
    assetType: "ui-component",
    assetFamily: "structural",
    lifecycleStatus: "published",
    builtIn: true,
    ports: [],
    slots: slotIds.map((slotId) => ({
      schemaVersion: "asset-slot-definition.v1",
      slotId: normalizeAssetSlotId(slotId),
      displayName: slotId,
      cardinality: { minItems: 0, maxItems: 8 },
      acceptedAssetTypes: ["ui-component"],
    })),
    compatibility: { status: "compatible" },
    implementationAvailability: "trusted-system-foundation",
    previewAvailability: "trusted-declarative",
  };
}
