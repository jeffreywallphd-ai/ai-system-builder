// @vitest-environment jsdom
import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

import type {
  AssetBinding,
  AssetInstance,
  AssetPort,
} from "../../../../contracts/asset";
import { normalizeAssetId } from "../../../../contracts/asset";
import type { SystemBuilderComposerAsset } from "../../../../contracts/system-builder";
import { SystemComposerInspector } from "../SystemComposerInspector";

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

describe("SystemComposerInspector interactions", () => {
  it("renders ordered schema controls, validation, defaults, and the advanced fallback", async () => {
    const definition = asset("builtin.card", [], {
      fields: [
        {
          fieldId: "title",
          valueKind: "string",
          label: "Title",
          required: true,
          defaultValue: "Default title",
          uiHint: { hintKind: "text", section: "Content", order: 1 },
        },
        { fieldId: "enabled", valueKind: "boolean", label: "Enabled" },
        {
          fieldId: "mode",
          valueKind: "enum",
          label: "Mode",
          options: [
            { value: "safe", label: "Safe" },
            { value: "fast", label: "Fast" },
          ],
        },
        {
          fieldId: "source",
          valueKind: "asset-reference",
          label: "Source asset",
        },
      ],
    });
    const selected = instance("instance.card", definition, { title: "" });
    const onConfigurationChange = vi.fn();
    render(
      <SystemComposerInspector
        mode="configuration"
        selectedInstance={selected}
        selectedDefinition={definition}
        instances={[selected]}
        catalog={[definition]}
        bindings={[]}
        onConfigurationChange={onConfigurationChange}
        onAddConnection={vi.fn()}
        onRemoveConnection={vi.fn()}
      />,
    );

    expect(container!.textContent).toContain("General");
    expect(container!.textContent).toContain("Content");
    expect(container!.textContent).toContain("Title is required.");
    expect(container!.textContent).toContain("Advanced JSON");
    expect(button("Design").getAttribute("aria-selected")).toBe("true");
    await click(button("Data"));
    expect(button("Data").getAttribute("aria-selected")).toBe("true");
    await click(button("Design"));
    expect(
      container!.querySelectorAll<HTMLSelectElement>("select")[1]?.options,
    ).toHaveLength(2);

    const mode = Array.from(
      container!.querySelectorAll<HTMLSelectElement>("select"),
    ).find((item) => item.id === "mode")!;
    await change(mode, JSON.stringify("fast"));
    expect(onConfigurationChange).toHaveBeenCalledWith(
      expect.objectContaining({ mode: "fast", title: "" }),
    );

    await click(button("Reset defaults"));
    expect(onConfigurationChange).toHaveBeenCalledWith(
      expect.objectContaining({ title: "Default title" }),
    );
  });

  it("offers only compatible declared targets and adds/removes typed bindings", async () => {
    const sourceDefinition = asset("builtin.source", [
      port("records", "output", "json", "records"),
    ]);
    const targetDefinition = asset("builtin.target", [
      port("records", "input", "json", "records"),
    ]);
    const wrongDefinition = asset("builtin.wrong", [
      port("text", "input", "text", "text"),
    ]);
    const source = instance("instance.source", sourceDefinition);
    const target = instance("instance.target", targetDefinition);
    const wrong = instance("instance.wrong", wrongDefinition);
    const binding: AssetBinding = {
      bindingId: "binding.one",
      bindingKind: "output",
      sourceRef: { kind: "asset-instance", id: source.instanceId },
      targetRef: { kind: "asset-instance", id: target.instanceId },
      lifecycleStatus: "draft",
      provenance: { sourceKind: "human-authored" },
    };
    const onAddConnection = vi.fn();
    const onRemoveConnection = vi.fn();
    render(
      <SystemComposerInspector
        mode="connections"
        selectedInstance={source}
        selectedDefinition={sourceDefinition}
        instances={[source, target, wrong]}
        catalog={[sourceDefinition, targetDefinition, wrongDefinition]}
        bindings={[binding]}
        onConfigurationChange={vi.fn()}
        onAddConnection={onAddConnection}
        onRemoveConnection={onRemoveConnection}
      />,
    );

    const selects = container!.querySelectorAll<HTMLSelectElement>("select");
    await change(selects[0]!, "instance.source::records");
    const targetSelect =
      container!.querySelectorAll<HTMLSelectElement>("select")[1]!;
    expect(
      Array.from(targetSelect.options).map((option) => option.textContent),
    ).toContain("instance.target · records");
    expect(
      Array.from(targetSelect.options).map((option) => option.textContent),
    ).not.toContain("instance.wrong · text");
    await change(targetSelect, "instance.target::records");
    await click(button("Add output connection"));
    expect(onAddConnection).toHaveBeenCalledTimes(1);

    await click(
      container!.querySelector<HTMLButtonElement>(
        '[aria-label="Remove connection binding.one"]',
      )!,
    );
    expect(onRemoveConnection).toHaveBeenCalledWith("binding.one");
  });

  it("locks system-foundation layout geometry to declared semantic fields", () => {
    const definition: SystemBuilderComposerAsset = {
      ...asset("builtin.layout.application.standard", [], {
        fields: [
          { fieldId: "title", valueKind: "string", label: "Title" },
          {
            fieldId: "accessibilityLabel",
            valueKind: "string",
            label: "Accessibility label",
          },
        ],
        strict: true,
      }),
      layoutRole: "application-shell",
      layoutGeometry: {
        columnPattern: "single",
        areas: [["top-bar"], ["content"]],
        sourceOrder: ["top-bar", "content"],
        dimensionsLocked: true,
      },
    };
    const selected = instance("instance.layout", definition);
    render(
      <SystemComposerInspector
        mode="configuration"
        selectedInstance={selected}
        selectedDefinition={definition}
        instances={[selected]}
        catalog={[definition]}
        bindings={[]}
        onConfigurationChange={vi.fn()}
        onAddConnection={vi.fn()}
        onRemoveConnection={vi.fn()}
      />,
    );

    expect(container!.textContent).toContain(
      "System Foundation controls this layout's width, height, regions, and responsive rules.",
    );
    expect(container!.textContent).not.toContain("Advanced JSON");
    expect(container!.querySelector("#title")).not.toBeNull();
    expect(container!.querySelector("#width")).toBeNull();
    expect(container!.querySelector("#height")).toBeNull();
  });
});

function render(element: ReactNode): void {
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  act(() => root?.render(element));
}

function button(label: string): HTMLButtonElement {
  const match = Array.from(
    container!.querySelectorAll<HTMLButtonElement>("button"),
  ).find((item) => item.textContent?.trim() === label);
  if (!match) throw new Error(`Missing button: ${label}`);
  return match;
}

async function click(element: HTMLElement): Promise<void> {
  await act(async () => element.click());
}

async function change(
  element: HTMLInputElement | HTMLSelectElement,
  value: string,
): Promise<void> {
  await act(async () => {
    element.value = value;
    element.dispatchEvent(new Event("change", { bubbles: true }));
  });
}

function instance(
  instanceId: string,
  definition: SystemBuilderComposerAsset,
  selectedConfiguration = {},
): AssetInstance {
  return {
    instanceId: normalizeAssetId(instanceId),
    definitionRef: definition.definitionRef,
    displayName: instanceId,
    lifecycleStatus: "draft",
    selectedConfiguration,
    provenance: { sourceKind: "system-generated" },
  };
}

function port(
  portId: string,
  direction: AssetPort["direction"],
  contractKind: "json" | "text",
  dataKind: string,
): AssetPort {
  return { portId, direction, contract: { contractKind, dataKind } };
}

function asset(
  definitionId: string,
  ports: readonly AssetPort[],
  configurationSchema?: SystemBuilderComposerAsset["configurationSchema"],
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
    assetType: "ui-component",
    assetFamily: "structural",
    lifecycleStatus: "published",
    builtIn: true,
    configurationSchema,
    ports,
    slots: [],
    compatibility: { status: "compatible" },
    implementationAvailability: "trusted-system-foundation",
    previewAvailability: "trusted-declarative",
  };
}
