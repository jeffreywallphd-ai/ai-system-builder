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
import { SystemComposerStylingPanel } from "../SystemComposerStylingPanel";

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

  it("shows bounded layout properties and regions for ordinary containers", () => {
    const definition: SystemBuilderComposerAsset = {
      ...asset("builtin.ui.container", [], {
        fields: [
          {
            fieldId: "label",
            valueKind: "string",
            label: "Label",
          },
          {
            fieldId: "layoutDirection",
            valueKind: "enum",
            label: "Layout direction",
            options: [{ value: "vertical" }, { value: "horizontal" }],
          },
        ],
      }),
      layoutGeometry: {
        columnPattern: "single",
        areas: [["content"]],
        sourceOrder: ["content"],
        dimensionsLocked: true,
      },
      slots: [
        {
          schemaVersion: "asset-slot-definition.v1",
          slotId: "content" as never,
          displayName: "Content",
          cardinality: { minItems: 0, maxItems: 64 },
          acceptedAssetTypes: ["ui-component"],
        },
      ],
    };
    const selected = instance("instance.container", definition);
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

    expect(container!.textContent).toContain("Container layout");
    expect(container!.textContent).toContain("Regions: Content");
    expect(container!.textContent).toContain("Layout direction");
    expect(container!.textContent).toContain("Advanced JSON");
    expect(container!.textContent).not.toContain(
      "System Foundation controls this layout's width",
    );
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

  it("uses bounded root styling controls and keeps semantic styles out of Advanced JSON", async () => {
    const definition = asset("builtin.system.system", [], {
      fields: [
        {
          fieldId: "title",
          valueKind: "string",
          label: "Title",
          defaultValue: "System",
        },
        {
          fieldId: "themeColorPrimary",
          valueKind: "string",
          label: "Primary color",
          defaultValue: "#2563eb",
          uiHint: {
            hintKind: "color",
            section: "Theme colors",
            metadata: {
              editorScope: "styling",
              semanticStyleField: true,
            },
          },
        },
        {
          fieldId: "themeButtonTreatment",
          valueKind: "enum",
          label: "Button style",
          defaultValue: "solid",
          options: [{ value: "solid" }, { value: "outline" }],
          uiHint: {
            hintKind: "select",
            section: "Buttons",
            metadata: {
              editorScope: "styling",
              semanticStyleField: true,
            },
          },
        },
        {
          fieldId: "styleSurfaceRole",
          valueKind: "enum",
          label: "Background role",
          defaultValue: "inherit",
          options: [{ value: "inherit" }, { value: "primary" }],
          uiHint: {
            hintKind: "select",
            section: "Style overrides",
            metadata: {
              editorScope: "properties",
              semanticStyleField: true,
            },
          },
        },
      ],
      strict: true,
    });
    const selected = instance("instance.root", definition, {
      title: "Configured system",
      themeColorPrimary: "#2563eb",
      themeButtonTreatment: "solid",
      styleSurfaceRole: "inherit",
    });
    const onChange = vi.fn();

    render(
      <SystemComposerInspector
        mode="configuration"
        selectedInstance={selected}
        selectedDefinition={definition}
        instances={[selected]}
        catalog={[definition]}
        bindings={[]}
        onConfigurationChange={onChange}
        onAddConnection={vi.fn()}
        onRemoveConnection={vi.fn()}
      />,
    );
    expect(container!.querySelector("#themeColorPrimary")).toBeNull();
    expect(container!.querySelector("#styleSurfaceRole")).not.toBeNull();
    const advanced = container!.querySelector<HTMLTextAreaElement>(
      ".system-composer-inspector__advanced textarea",
    );
    expect(advanced?.value).toContain('"title"');
    expect(advanced?.value).not.toContain("themeColorPrimary");
    expect(advanced?.value).not.toContain("styleSurfaceRole");

    act(() => root?.unmount());
    root = createRoot(container!);
    act(() =>
      root?.render(
        <SystemComposerStylingPanel
          rootInstance={selected}
          rootDefinition={definition}
          catalog={[definition]}
          onChange={onChange}
        />,
      ),
    );
    const color =
      container!.querySelector<HTMLInputElement>("#themeColorPrimary");
    expect(color?.type).toBe("color");
    expect(container!.querySelector("#themeButtonTreatment")).toBeInstanceOf(
      HTMLSelectElement,
    );
    expect(container!.querySelector("#title")).toBeNull();
    await input(color!, "#123456");
    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({
        title: "Configured system",
        themeColorPrimary: "#123456",
      }),
    );
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

async function input(element: HTMLInputElement, value: string): Promise<void> {
  await act(async () => {
    const descriptor = Object.getOwnPropertyDescriptor(
      Object.getPrototypeOf(element),
      "value",
    );
    descriptor?.set?.call(element, value);
    element.dispatchEvent(new Event("input", { bubbles: true }));
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
