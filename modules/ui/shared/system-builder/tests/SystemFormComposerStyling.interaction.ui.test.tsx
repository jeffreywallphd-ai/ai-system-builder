// @vitest-environment jsdom
import { act, useState } from "react";
import { createRoot } from "react-dom/client";
import { expect, it } from "vitest";
import { readSystemFoundationManifest } from "../../../../application/services/asset-packs/system-packs";
import { normalizeAssetId, normalizeAssetSlotId, type AssetInstance } from "../../../../contracts/asset";
import { systemBuilderSuccess, type SystemBuilderComposerAsset } from "../../../../contracts/system-builder";
import { SystemFormComposerView } from "../SystemFormComposerView";
import type { SystemComposerDraft } from "../systemComposerDraft";

function foundation(id: string): SystemBuilderComposerAsset {
  const definition = readSystemFoundationManifest("3.0.0")!.assets.find(row => row.definition.definitionId === id)!.definition;
  return {
    definitionId: id, version: definition.version, displayName: definition.displayName,
    description: definition.description, assetType: definition.assetType, assetFamily: definition.assetFamily,
    lifecycleStatus: definition.lifecycleStatus, builtIn: true,
    definitionRef: { kind: "asset-definition-version", id: definition.definitionId, version: definition.version },
    configurationSchema: definition.configurationSchema, defaultConfiguration: definition.defaultConfiguration,
    ports: definition.ports, slots: definition.slots, compatibility: { status: "compatible" },
    implementationAvailability: "trusted-system-foundation", previewAvailability: "trusted-declarative",
  };
}

it("keeps Foundation text in the form page and styling and behavior in independent Properties sections", async () => {
  const form = foundation("builtin.form.form"), step = foundation("builtin.form.field-group"), submit = foundation("builtin.form.submit-action");
  const instance = (id: string, definition: SystemBuilderComposerAsset, name: string, config: AssetInstance["selectedConfiguration"]): AssetInstance => ({
    instanceId: normalizeAssetId(id), definitionRef: definition.definitionRef, displayName: name,
    selectedConfiguration: config, lifecycleStatus: "draft", provenance: { sourceKind: "human-authored" },
  });
  const intake = instance("fixture.form", form, "Equipment intake", {
    title: "Equipment intake", description: "Explain your request.", validationMode: "on-blur", styleFormTreatment: "filled",
  });
  const first = instance("fixture.page", step, "Page 1", { title: "Page 1", description: "Page instructions." });
  const button = instance("fixture.submit", submit, "Send button", { label: "Send now", confirmationRequired: true });
  const initial = [intake, first, button];
  const placements: SystemComposerDraft["placements"] = [first, button].map((child, order) => ({
    schemaVersion: "asset-placement.v1", placementId: `place.${child.instanceId}`,
    parentInstanceRef: { kind: "asset-instance", id: intake.instanceId }, childInstanceRef: { kind: "asset-instance", id: child.instanceId },
    slotId: normalizeAssetSlotId(order ? "actions" : "fields"), order,
  }));
  const readDefinition = async (asset: AssetInstance) => systemBuilderSuccess([form, step, submit].find(item => item.definitionId === asset.definitionRef.id)!);
  function Fixture() {
    const [instances, setInstances] = useState(initial);
    return <SystemFormComposerView draft={{ instances, placements, bindings: [] }} form={{ form: instances[0]!, steps: [instances[1]!] }}
      ready readDefinition={readDefinition} onUpdatePresentation={(id, _definition, selectedConfiguration) => setInstances(current =>
        current.map(item => item.instanceId === id ? { ...item, selectedConfiguration } : item))}
      canUndo={false} canRedo={false} onBackToCanvas={() => {}} onAddStep={async () => undefined} onAddField={async () => undefined}
      onMove={() => {}} onRemoveElement={() => false} onUpdate={() => {}} onSaveRoute={() => {}} onRemoveRoute={() => {}}
      onUpdateAction={() => {}} onUndo={() => {}} onRedo={() => {}} />;
  }
  const global = globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean };
  const previous = global.IS_REACT_ACT_ENVIRONMENT;
  global.IS_REACT_ACT_ENVIRONMENT = true;
  const container = document.createElement("div"); document.body.append(container);
  const root = createRoot(container);
  try {
    await act(async () => root.render(<Fixture />));
    const appearance = container.querySelector('[aria-label="Element appearance"]')!;
    const properties = container.querySelector('aside[aria-label="Properties"]')!;
    const styling = () => properties.querySelector('[aria-label="Styling"]')!;
    const pick = (select: HTMLSelectElement, value: string) => act(async () => {
      select.value = value; select.dispatchEvent(new Event("change", { bubbles: true }));
    });
    const reset = (scope: Element, label: string) => act(async () => {
      const control = [...scope.querySelectorAll("button")].find(item => item.textContent?.trim() === label);
      expect(control).toBeDefined(); control!.click();
    });
    expect(styling().querySelector("#layout")).not.toBeNull();
    expect(appearance.querySelector("#layout")).toBeNull();
    await pick(appearance.querySelector("select")!, String(intake.instanceId));
    const value = (scope: Element, field: string) => scope.querySelector<HTMLInputElement>(`#${field}`)?.value;
    const selected = (scope: Element, field: string) => JSON.parse(value(scope, field)!);
    expect(value(appearance, "title")).toBe("Equipment intake");
    expect(value(appearance, "description")).toBe("Explain your request.");
    expect(selected(styling(), "styleFormTreatment")).toBe("filled");
    expect(value(appearance, "styleFormTreatment")).toBeUndefined();
    expect(selected(properties, "validationMode")).toBe("on-blur");
    await reset(styling(), "Reset styling defaults");
    expect(selected(styling(), "styleFormTreatment")).toBe("inherit");
    expect(value(appearance, "description")).toBe("Explain your request.");
    expect(selected(properties, "validationMode")).toBe("on-blur");
    await pick(styling().querySelector<HTMLSelectElement>("#styleFormTreatment")!, JSON.stringify("underlined"));
    await reset(properties, "Reset behavior defaults");
    await reset(appearance, "Reset appearance defaults");
    expect(selected(properties, "validationMode")).toBe("on-submit");
    expect(value(appearance, "description")).toBe("");
    expect(selected(styling(), "styleFormTreatment")).toBe("underlined");
    await pick(appearance.querySelector("select")!, String(button.instanceId));
    expect(value(appearance, "label")).toBe("Send now");
    expect(styling().querySelector("#styleButtonTreatment")).not.toBeNull();
    expect(appearance.querySelector("#styleButtonTreatment")).toBeNull();
    expect(properties.querySelector<HTMLInputElement>("#confirmationRequired")?.checked).toBe(true);
  } finally {
    await act(async () => root.unmount()); container.remove(); global.IS_REACT_ACT_ENVIRONMENT = previous;
  }
});
