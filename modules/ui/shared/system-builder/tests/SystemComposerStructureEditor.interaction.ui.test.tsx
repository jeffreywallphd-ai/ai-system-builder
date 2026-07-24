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
      ["top-bar", "start-sidebar", "content", "states", "footer"],
      [
        ["top-bar", "top-bar"],
        ["start-sidebar", "content"],
        ["states", "states"],
        ["footer", "footer"],
      ],
      "start-content",
    );
    const card = composerAsset("builtin.container.card", ["body"]);
    const emptyState = composerAsset("builtin.state.empty-state", []);
    const policy = {
      ...composerAsset("builtin.security.authorization-policy", []),
      assetType: "policy" as const,
    };

    render(
      <SystemComposerStructureEditor
        draft={{
          instances: [
            instance("instance.root", "builtin.system.system", "System root"),
            instance("instance.shell", shell.definitionId, "Application shell"),
            instance("instance.card", card.definitionId, "Unassigned card"),
            instance(
              "instance.empty-state",
              emptyState.definitionId,
              "Empty state",
            ),
            instance("instance.policy", policy.definitionId, "Access policy"),
          ],
          placements: [
            placement("instance.root", "application-shell", "instance.shell"),
            placement("instance.shell", "states", "instance.empty-state"),
          ],
          bindings: [],
        }}
        rootInstanceRefs={[
          { kind: "asset-instance", id: normalizeAssetId("instance.root") },
        ]}
        catalog={[system, shell, card, emptyState, policy]}
        compatibleAssets={[card]}
        layoutOptions={[shell]}
        selectedLayoutDefinitionId={shell.definitionId}
        selectedInstanceId="instance.shell"
        targetSlot={{ parentInstanceId: "instance.shell", slotId: "content" }}
        protectedInstanceIds={new Set(["instance.root", "instance.shell"])}
        propertiesPanel={<div>Property controls</div>}
        stylingPanel={<div>Theme controls</div>}
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

    expect(
      container!.querySelector('[aria-label="Drag builtin.container.card"]'),
    ).toBeNull();
    expect(container!.textContent).not.toContain("Theme controls");
    expect(
      container!.querySelectorAll<HTMLButtonElement>('[role="treeitem"]'),
    ).toHaveLength(0);
    await click(button("Layers"));

    const treeItems = Array.from(
      container!.querySelectorAll<HTMLButtonElement>('[role="treeitem"]'),
    );
    expect(treeItems).toHaveLength(3);
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
    ).toHaveLength(3);

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
    await click(button("Styling"));
    expect(
      container!
        .querySelector("#system-composer-styling-panel")
        ?.hasAttribute("hidden"),
    ).toBe(false);
    expect(
      container!.querySelector("#system-composer-styling-panel")?.textContent,
    ).toContain("Theme controls");
    const sidebarTabList = container!.querySelector<HTMLElement>(
      ".system-composer__sidebar-tabs",
    );
    expect(sidebarTabList?.classList.contains("ui-tabbed-panel__tablist")).toBe(
      true,
    );
    expect(
      Array.from(
        sidebarTabList!.querySelectorAll<HTMLButtonElement>('[role="tab"]'),
      ).every((tab) => tab.classList.contains("ui-tabbed-panel__tab")),
    ).toBe(true);
    expect(
      Array.from(
        sidebarTabList!.querySelectorAll<HTMLButtonElement>('[role="tab"]'),
      ).map((tab) => tab.textContent?.trim()),
    ).toEqual(["Properties", "Styling", "Layers"]);
    const sidebarHeader = container!.querySelector<HTMLElement>(
      ".system-composer__sidebar-header",
    );
    expect(
      sidebarTabList!.compareDocumentPosition(sidebarHeader!) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).not.toBe(0);
    await click(button("Layers"));
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
    const layersPanel = container!.querySelector<HTMLElement>(
      "#system-composer-layers-panel",
    );
    expect(layersPanel?.textContent).not.toContain("Unassigned visual assets");
    expect(layersPanel?.textContent).not.toContain("System resources & logic");
    const collapseDetails = container!.querySelector<HTMLButtonElement>(
      "button[aria-label='Collapse Composer details sidebar']",
    );
    expect(collapseDetails).not.toBeNull();
    expect(collapseDetails?.closest("header")?.textContent).toContain(
      "Configure Application shell",
    );
    await click(collapseDetails!);
    expect(
      container!
        .querySelector("#system-composer-details-panel")
        ?.getAttribute("data-collapsed"),
    ).toBe("true");
    await click(
      container!.querySelector<HTMLButtonElement>(
        "button[aria-label='Expand Composer details sidebar']",
      )!,
    );
    expect(
      container!
        .querySelector("#system-composer-details-panel")
        ?.getAttribute("data-collapsed"),
    ).toBe("false");

    const workspace = container!.querySelector<HTMLElement>(
      ".system-composer__workspace",
    )!;
    expect(workspace.getAttribute("data-library-size")).toBe("normal");
    await click(ariaButton("Maximize Asset Palette"));
    expect(workspace.getAttribute("data-library-size")).toBe("maximized");
    await click(ariaButton("Normal Asset Palette"));
    expect(workspace.getAttribute("data-library-size")).toBe("normal");
    await click(ariaButton("Collapse Asset Palette"));
    expect(workspace.getAttribute("data-library-size")).toBe("collapsed");
    expect(workspace.getAttribute("data-library-collapsed")).toBe("true");
    expect(workspace.getAttribute("data-details-collapsed")).toBe("false");
    await click(ariaButton("Normal Asset Palette"));
    expect(workspace.getAttribute("data-library-collapsed")).toBe("false");

    for (const section of [
      "Layout",
      "Assets",
      "Unassigned visual assets",
      "System resources & logic",
    ]) {
      const expand = ariaButton(`Expand ${section}`);
      const contentId = expand.getAttribute("aria-controls");
      expect(
        container!.querySelector<HTMLElement>(`#${contentId}`)?.hidden,
      ).toBe(true);
      await click(expand);
      expect(
        container!.querySelector<HTMLElement>(`#${contentId}`)?.hidden,
      ).toBe(false);
      await click(ariaButton(`Collapse ${section}`));
      expect(
        container!.querySelector<HTMLElement>(`#${contentId}`)?.hidden,
      ).toBe(true);
    }

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
    ).toEqual(["top-bar", "start-sidebar", "content", "states", "footer"]);
    expect(
      canvas.querySelector<HTMLElement>(
        '[data-instance-id="instance.shell"] > .system-composer__slots',
      )?.style.gridTemplateRows,
    ).toBe(
      "minmax(7rem, max-content) minmax(14rem, max-content) minmax(14rem, max-content) minmax(7rem, max-content)",
    );
    expect(
      canvas.querySelector('[data-slot-id="application-shell"]'),
    ).toBeNull();
    const statesRegion = canvas.querySelector<HTMLElement>(
      '[data-slot-id="states"]',
    )!;
    const statesContent = statesRegion.querySelector<HTMLElement>(
      ".system-composer__slot-content",
    )!;
    expect(statesRegion.getAttribute("data-collapsed")).toBe("true");
    expect(statesContent.hidden).toBe(true);
    expect(
      statesRegion.querySelector('[data-instance-id="instance.empty-state"]'),
    ).toBeNull();
    await click(ariaButton("Expand states region"));
    expect(statesRegion.getAttribute("data-collapsed")).toBe("false");
    expect(statesContent.hidden).toBe(false);
    expect(
      statesRegion.querySelector('[data-instance-id="instance.empty-state"]'),
    ).not.toBeNull();
    await click(ariaButton("Collapse states region"));
    expect(statesRegion.getAttribute("data-collapsed")).toBe("true");
    expect(statesContent.hidden).toBe(true);
    expect(
      statesRegion.querySelector('[data-instance-id="instance.empty-state"]'),
    ).toBeNull();

    await click(ariaButton("Expand Assets"));
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

  it("renders every nested reference container and its draggable child regions", async () => {
    const system = {
      ...composerAsset("builtin.system.system", ["application-shell"]),
      assetType: "system" as const,
    };
    const shell = applicationLayout(
      "builtin.layout.application.standard",
      ["top-bar", "content"],
      [["top-bar"], ["content"]],
      "single",
    );
    const page = {
      ...composerAsset("builtin.shell.page", ["content", "actions"]),
      assetType: "page" as const,
    };
    const assistant = {
      ...composerAsset("conversation.basic-assistant-system", ["interface"]),
      assetType: "system" as const,
    };
    const chatShell = {
      ...composerAsset("conversation.chat-shell", [
        "status",
        "history",
        "composer",
        "states",
      ]),
      assetType: "feature" as const,
    };
    const history = composerAsset("conversation.message-history-display", []);
    const composer = composerAsset("conversation.message-composer", [
      "input",
      "actions",
    ]);
    const input = composerAsset("conversation.user-message-input", []);
    const send = composerAsset("builtin.form.submit-action", []);
    const catalog = [
      system,
      shell,
      page,
      assistant,
      chatShell,
      history,
      composer,
      input,
      send,
    ];

    render(
      <SystemComposerStructureEditor
        draft={{
          instances: [
            instance("instance.root", system.definitionId, "System root"),
            instance("instance.shell", shell.definitionId, "Application shell"),
            {
              ...instance("instance.page", page.definitionId, "Assistant page"),
              definitionRef: {
                ...page.definitionRef,
                version: "1.0.0",
              },
            },
            instance(
              "instance.assistant",
              assistant.definitionId,
              "Basic assistant system",
            ),
            {
              ...instance(
                "instance.chat",
                chatShell.definitionId,
                "Conversation shell",
              ),
              definitionRef: {
                ...chatShell.definitionRef,
                version: "1.0.0",
              },
            },
            instance("instance.history", history.definitionId, "History"),
            instance("instance.composer", composer.definitionId, "Composer"),
            instance("instance.input", input.definitionId, "Message input"),
            instance("instance.send", send.definitionId, "Send"),
          ],
          placements: [
            placement("instance.root", "application-shell", "instance.shell"),
            placement("instance.shell", "content", "instance.page"),
            placement("instance.page", "content", "instance.assistant"),
            placement("instance.assistant", "interface", "instance.chat"),
            placement("instance.chat", "history", "instance.history"),
            placement("instance.chat", "composer", "instance.composer"),
            placement("instance.composer", "input", "instance.input"),
            placement("instance.composer", "actions", "instance.send"),
          ],
          bindings: [],
        }}
        rootInstanceRefs={[
          { kind: "asset-instance", id: normalizeAssetId("instance.root") },
        ]}
        catalog={catalog}
        compatibleAssets={catalog}
        layoutOptions={[shell]}
        selectedLayoutDefinitionId={shell.definitionId}
        selectedInstanceId="instance.page"
        targetSlot={undefined}
        protectedInstanceIds={
          new Set(["instance.root", "instance.shell", "instance.page"])
        }
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

    const canvas = container!.querySelector<HTMLElement>(
      ".system-composer__panel--canvas",
    )!;
    const canvasInstanceIds = Array.from(
      canvas.querySelectorAll<HTMLElement>("[data-instance-id]"),
    ).map((node) => node.dataset.instanceId);
    expect(canvasInstanceIds).toHaveLength(8);
    expect(canvasInstanceIds).toEqual(
      expect.arrayContaining([
        "instance.shell",
        "instance.page",
        "instance.assistant",
        "instance.chat",
        "instance.history",
        "instance.composer",
        "instance.input",
        "instance.send",
      ]),
    );
    const assistantNode = canvas.querySelector<HTMLElement>(
      '[data-instance-id="instance.assistant"]',
    );
    const legacyPageRegion = canvas.querySelector<HTMLElement>(
      '[data-instance-id="instance.page"] [data-slot-id="content"]',
    );
    expect(legacyPageRegion?.dataset.structuralOnly).toBe("true");
    expect(
      legacyPageRegion?.querySelector<HTMLButtonElement>(
        'button[aria-label="Select Content region"]',
      )?.disabled,
    ).toBe(true);
    expect(
      assistantNode?.querySelector(
        '[data-slot-id="interface"] [data-instance-id="instance.chat"] [data-slot-id="composer"] [data-instance-id="instance.composer"] [data-slot-id="input"] [data-instance-id="instance.input"]',
      ),
    ).not.toBeNull();
    expect(
      assistantNode?.querySelector(
        '[data-instance-id="instance.composer"] [data-slot-id="actions"] [data-instance-id="instance.send"]',
      ),
    ).not.toBeNull();
    const legacyChatRegions = Array.from(
      canvas.querySelectorAll<HTMLElement>(
        '[data-instance-id="instance.chat"] > .system-composer__slots > [data-structural-only="true"]',
      ),
    );
    expect(
      legacyChatRegions
        .map((region) => region.dataset.slotId)
        .sort((left, right) => String(left).localeCompare(String(right))),
    ).toEqual(["composer", "history"]);
    expect(
      legacyChatRegions.every((region) => region.style.gridArea === ""),
    ).toBe(true);
    await click(ariaButton("Expand Assets"));
    expect(
      container!.querySelector(
        '[aria-label="Drag conversation.basic-assistant-system"]',
      ),
    ).not.toBeNull();

    for (const instanceId of [
      "instance.shell",
      "instance.page",
      "instance.assistant",
      "instance.chat",
      "instance.composer",
    ]) {
      const node = canvas.querySelector<HTMLElement>(
        `[data-instance-id="${instanceId}"]`,
      );
      expect(directEditablePreview(node)).toBeNull();
    }

    const historyNode = canvas.querySelector<HTMLElement>(
      '[data-instance-id="instance.history"]',
    );
    const historyPreview = directEditablePreview(historyNode);
    expect(
      historyPreview?.querySelector(
        '[data-foundation-definition="conversation.message-history-display"]',
      ),
    ).not.toBeNull();
    expect(historyPreview?.querySelector("textarea")).toBeNull();

    const inputNode = canvas.querySelector<HTMLElement>(
      '[data-instance-id="instance.input"]',
    );
    const inputPreview = directEditablePreview(inputNode);
    expect(
      inputPreview?.querySelector(
        '[data-foundation-definition="conversation.user-message-input"]',
      ),
    ).not.toBeNull();
    expect(inputPreview?.querySelector("textarea")).not.toBeNull();
    expect(inputPreview?.textContent).not.toContain("Conversation");

    expect(canvas.textContent).not.toContain("Send preview");
    expect(
      canvas.querySelector('[aria-label="Example conversation"]'),
    ).toBeNull();
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

  it("keeps visual assets discoverable before a canvas region is selected", async () => {
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

    await click(ariaButton("Expand Assets"));
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

function directEditablePreview(node: HTMLElement | null): HTMLElement | null {
  return (
    (Array.from(node?.children ?? []).find((child) =>
      child.classList.contains("system-composer__editable-preview"),
    ) as HTMLElement | undefined) ?? null
  );
}

function button(label: string): HTMLButtonElement {
  const match = Array.from(
    container!.querySelectorAll<HTMLButtonElement>("button"),
  ).find((candidate) => candidate.textContent?.trim() === label);
  if (!match) throw new Error(`Missing button: ${label}`);
  return match;
}

function ariaButton(label: string): HTMLButtonElement {
  const match = container!.querySelector<HTMLButtonElement>(
    `button[aria-label="${label}"]`,
  );
  if (!match) throw new Error(`Missing aria button: ${label}`);
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
