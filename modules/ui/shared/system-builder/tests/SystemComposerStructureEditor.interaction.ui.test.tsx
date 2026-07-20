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
    const system = composerAsset("builtin.system.system", [
      "application-shell",
    ]);
    const shell = applicationLayout(
      "builtin.layout.application.navigation-footer",
      ["top-bar", "start-sidebar", "content", "footer"],
      [
        ["top-bar", "top-bar"],
        ["start-sidebar", "content"],
        ["footer", "footer"],
      ],
      "start-content",
    );
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
        layoutOptions={[shell]}
        selectedLayoutDefinitionId={shell.definitionId}
        selectedInstanceId="instance.shell"
        targetSlot={{ parentInstanceId: "instance.shell", slotId: "content" }}
        protectedInstanceIds={new Set(["instance.root", "instance.shell"])}
        canUndo={false}
        canRedo
        onSelect={onSelect}
        onTargetSlotChange={onTargetSlotChange}
        onSelectLayout={vi.fn()}
        onAdd={onAdd}
        onPlace={vi.fn()}
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
    await fire(treeItems[0]!, "keydown", { key: "ArrowLeft" });
    expect(
      container!.querySelectorAll<HTMLButtonElement>('[role="treeitem"]'),
    ).toHaveLength(1);
    await fire(treeItems[0]!, "keydown", { key: "ArrowRight" });
    expect(
      container!.querySelectorAll<HTMLButtonElement>('[role="treeitem"]'),
    ).toHaveLength(2);

    expect(
      Array.from(
        container!.querySelectorAll<HTMLElement>(
          ".system-composer__workspace > .system-composer__panel",
        ),
      ).map(
        (panel) => panel.className.match(/system-composer__panel--[a-z]+/)?.[0],
      ),
    ).toEqual([
      "system-composer__panel--library",
      "system-composer__panel--canvas",
      "system-composer__panel--details",
    ]);
    await click(button("Properties"));
    await flushFocus();
    expect(document.activeElement?.id).toBe("system-composer-details-panel");
    expect(
      container!
        .querySelector("#system-composer-properties-panel")
        ?.hasAttribute("hidden"),
    ).toBe(false);
    await click(button("Layers & Structure"));
    expect(
      container!
        .querySelector("#system-composer-properties-panel")
        ?.hasAttribute("hidden"),
    ).toBe(true);
    expect(
      container!
        .querySelector("#system-composer-layers-panel")
        ?.hasAttribute("hidden"),
    ).toBe(false);
    const collapseDetails = container!.querySelector<HTMLButtonElement>(
      "button[aria-label='Collapse Properties and Layers sidebar']",
    );
    expect(collapseDetails).not.toBeNull();
    await click(collapseDetails!);
    expect(
      container!
        .querySelector("#system-composer-details-panel")
        ?.getAttribute("data-collapsed"),
    ).toBe("true");
    await click(
      container!.querySelector<HTMLButtonElement>(
        "button[aria-label='Expand Properties and Layers sidebar']",
      )!,
    );
    expect(
      container!
        .querySelector("#system-composer-details-panel")
        ?.getAttribute("data-collapsed"),
    ).toBe("false");

    await click(
      container!.querySelector<HTMLButtonElement>(
        "button[aria-label='Collapse Asset Palette sidebar']",
      )!,
    );
    expect(
      container!
        .querySelector(".system-composer__workspace")
        ?.getAttribute("data-library-collapsed"),
    ).toBe("true");
    expect(
      container!
        .querySelector(".system-composer__workspace")
        ?.getAttribute("data-details-collapsed"),
    ).toBe("false");
    await click(
      container!.querySelector<HTMLButtonElement>(
        "button[aria-label='Expand Asset Palette sidebar']",
      )!,
    );

    const contentRegion = container!.querySelector<HTMLElement>(
      '[aria-label="content region"]',
    );
    expect(contentRegion).not.toBeNull();
    expect(contentRegion?.textContent).not.toContain("Add here");
    await click(button("content"));
    expect(onTargetSlotChange).toHaveBeenCalledWith({
      parentInstanceId: "instance.shell",
      slotId: "content",
    });

    const canvas = container!.querySelector<HTMLElement>(
      ".system-composer__panel--canvas",
    )!;
    expect(canvas.getAttribute("data-active-layout")).toBe(shell.definitionId);
    expect(canvas.querySelector("h3")?.textContent).toBe("Canvas");
    expect(
      Array.from(canvas.querySelectorAll<HTMLElement>("[data-slot-id]")).map(
        (slot) => slot.dataset.slotId,
      ),
    ).toEqual(["top-bar", "start-sidebar", "content", "footer"]);
    expect(
      canvas.querySelector('[data-slot-id="application-shell"]'),
    ).toBeNull();

    const paletteDragHandle = container!.querySelector<HTMLButtonElement>(
      '[aria-label="Drag builtin.container.card"]',
    );
    expect(paletteDragHandle).not.toBeNull();
    expect(
      paletteDragHandle?.querySelector(".system-composer__palette-icon"),
    ).not.toBeNull();
    expect(container!.textContent).not.toContain("Move to another slot");
    expect(container!.textContent).not.toContain("Move before");
    expect(container!.textContent).not.toContain("Wrap in a container");
    expect(container!.textContent?.toLowerCase()).not.toContain("slot");
    expect(paletteDragHandle?.getAttribute("aria-describedby")).not.toBeNull();
    expect(container!.textContent).toContain("Press Space to pick up an asset");
    await fire(paletteDragHandle!, "keydown", { key: " ", code: "Space" });
    await fire(paletteDragHandle!, "keydown", {
      key: "Escape",
      code: "Escape",
    });
    expect(container!.textContent).toContain(
      "Drag cancelled. No composition changes were made.",
    );
    expect(button("Undo").disabled).toBe(true);
    await click(button("Redo"));
    expect(onRedo).toHaveBeenCalledTimes(1);
    expect(button("Remove selected subtree").disabled).toBe(true);
    expect(onRemove).not.toHaveBeenCalled();
  });

  it("offers predefined layouts as a native single-choice gallery", async () => {
    const onSelect = vi.fn();
    const standard = applicationLayout(
      "builtin.layout.application.standard",
      ["top-bar", "content"],
      [["top-bar"], ["content"]],
      "single",
    );
    const sidebar = applicationLayout(
      "builtin.layout.application.navigation",
      ["top-bar", "start-sidebar", "content"],
      [
        ["top-bar", "top-bar"],
        ["start-sidebar", "content"],
      ],
      "start-content",
    );

    render(
      <SystemLayoutGallery
        layouts={[standard, sidebar]}
        selectedDefinitionId={standard.definitionId}
        compact
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
    expect(
      container!.querySelector<HTMLElement>(
        '[data-layout-area="start-sidebar"]',
      )?.style.gridArea,
    ).toBe("start-sidebar");
    await act(async () => {
      choices[1]?.click();
    });
    expect(onSelect).toHaveBeenCalledWith(sidebar);
  });

  it("keeps visual assets discoverable before a canvas region is selected", () => {
    const system = composerAsset("builtin.system.system", [
      "application-shell",
    ]);
    const shell = applicationLayout(
      "builtin.layout.application.standard",
      ["top-bar", "content"],
      [["top-bar"], ["content"]],
      "single",
    );
    const card = composerAsset("builtin.container.card", ["body"]);

    render(
      <SystemComposerStructureEditor
        draft={{
          instances: [
            instance("instance.root", "builtin.system.system", "System root"),
          ],
          placements: [],
          bindings: [],
        }}
        rootInstanceRefs={[
          { kind: "asset-instance", id: normalizeAssetId("instance.root") },
        ]}
        catalog={[system, shell, card]}
        compatibleAssets={[]}
        layoutOptions={[shell]}
        selectedLayoutDefinitionId={undefined}
        selectedInstanceId="instance.root"
        targetSlot={undefined}
        protectedInstanceIds={new Set(["instance.root"])}
        canUndo={false}
        canRedo={false}
        onSelect={vi.fn()}
        onTargetSlotChange={vi.fn()}
        onSelectLayout={vi.fn()}
        onAdd={vi.fn()}
        onPlace={vi.fn()}
        onRemove={vi.fn()}
        onUndo={vi.fn()}
        onRedo={vi.fn()}
      />,
    );

    expect(
      container!.querySelector('[aria-label="Drag builtin.container.card"]'),
    ).not.toBeNull();
    expect(
      container!.querySelector(
        '[aria-label="Drag builtin.layout.application.standard"]',
      ),
    ).toBeNull();
    expect(container!.textContent).toContain(
      "Select a Canvas region to filter by compatibility.",
    );
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
async function fire(
  element: HTMLElement,
  type: string,
  init: KeyboardEventInit,
): Promise<void> {
  await act(async () =>
    element.dispatchEvent(new KeyboardEvent(type, { ...init, bubbles: true })),
  );
}

async function flushFocus(): Promise<void> {
  await act(async () => new Promise((resolve) => setTimeout(resolve, 0)));
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

function applicationLayout(
  definitionId: string,
  slotIds: readonly string[],
  areas: readonly (readonly string[])[],
  columnPattern:
    "single" | "start-content" | "content-end" | "equal-split" | "three-panel",
): SystemBuilderComposerAsset {
  return {
    ...composerAsset(definitionId, slotIds),
    layoutRole: "application-shell",
    layoutGeometry: {
      columnPattern,
      areas,
      sourceOrder: slotIds,
      dimensionsLocked: true,
    },
  };
}
