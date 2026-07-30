import { renderToStaticMarkup } from "react-dom/server";

import type {
  AssetInstance,
  AssetPlacement,
} from "../../../../contracts/asset";
import type { SystemBuilderComposerAsset } from "../../../../contracts/system-builder";
import { describe, expect, it } from "../../../../testing/node-test";
import {
  buildSystemCompositionPreviewModel,
  MAX_SYSTEM_COMPOSITION_PREVIEW_DEPTH,
  MAX_SYSTEM_COMPOSITION_PREVIEW_INPUT_INSTANCES,
  MAX_SYSTEM_COMPOSITION_PREVIEW_SURFACES,
  MAX_SYSTEM_COMPOSITION_PREVIEW_TEXT_LENGTH,
  SystemCompositionPreview,
} from "../SystemCompositionPreview";

function instance(
  instanceId: string,
  definitionId: string,
  displayName = definitionId,
  selectedConfiguration: Record<string, unknown> = {
    title: `${displayName} configured`,
  },
  version = "1.0.0",
): AssetInstance {
  return {
    instanceId,
    definitionRef: {
      kind: "asset-definition-version",
      id: definitionId,
      version,
    },
    displayName,
    lifecycleStatus: "draft",
    selectedConfiguration,
    provenance: { sourceKind: "human-authored" },
  } as unknown as AssetInstance;
}

describe("SystemCompositionPreview", () => {
  it("renders only registered frontend surfaces without backend execution claims", () => {
    const instances = [
      instance("page", "builtin.shell.page", "Workspace page"),
      instance("form", "builtin.feature.record-form", "Request form"),
      instance("policy", "builtin.security.authorization-policy", "Policy"),
      instance("custom", "workspace.custom-ui", "Custom UI"),
    ];

    const model = buildSystemCompositionPreviewModel(instances);
    expect(model.items.map((item) => item.instanceId)).toEqual([
      "page",
      "form",
    ]);
    expect(model.unavailableCount).toBe(2);
    expect(model.truncatedCount).toBe(0);

    const html = renderToStaticMarkup(
      <SystemCompositionPreview
        systemName="Requests"
        instances={instances}
      />,
    );
    expect(html).toContain('aria-label="Requests current UI preview"');
    expect(html).not.toContain(
      "This preview includes unsaved composition changes.",
    );
    expect(html).toContain("2 frontend surfaces");
    expect(html).toContain("2 unavailable");
    expect(html).toContain("Request form configured");
    expect(html).toContain("does not execute backend logic");
    expect(html).not.toContain("Denied by default");
  });

  it("bounds large previews and exposes a truthful unavailable state", () => {
    const many = Array.from(
      { length: MAX_SYSTEM_COMPOSITION_PREVIEW_SURFACES + 2 },
      (_, index) => instance(`page-${index}`, "builtin.shell.page"),
    );
    expect(buildSystemCompositionPreviewModel(many)).toMatchObject({
      unavailableCount: 0,
      truncatedCount: 2,
    });

    const html = renderToStaticMarkup(
      <SystemCompositionPreview
        systemName="Backend only"
        instances={[
          instance("policy", "builtin.security.authorization-policy"),
        ]}
      />,
    );
    expect(html).toContain("Visual preview unavailable");
    expect(html).toContain("implementation is not executed");
  });

  it("bounds hostile width, depth, configuration text, options, and tables before rendering", () => {
    const wide = Array.from(
      { length: MAX_SYSTEM_COMPOSITION_PREVIEW_INPUT_INSTANCES + 50 },
      (_, index) =>
        instance(
          `table-${index}`,
          "builtin.display.table",
          `Table ${index}`,
          {
            title: "x".repeat(MAX_SYSTEM_COMPOSITION_PREVIEW_TEXT_LENGTH + 50),
            columns: Array.from({ length: 30 }, (_, column) => `Column ${column}`),
            rows: Array.from({ length: 40 }, (_, row) =>
              Array.from({ length: 30 }, (_, column) => `${row}:${column}`),
            ),
          },
        ),
    );
    const model = buildSystemCompositionPreviewModel(wide);
    expect(model.items.length).toBe(MAX_SYSTEM_COMPOSITION_PREVIEW_SURFACES);
    expect(model.truncatedCount).toBe(
      wide.length - MAX_SYSTEM_COMPOSITION_PREVIEW_SURFACES,
    );

    const chain = Array.from(
      { length: MAX_SYSTEM_COMPOSITION_PREVIEW_DEPTH + 10 },
      (_, index) => instance(`page-${index}`, "builtin.shell.page"),
    );
    const chainPlacements = chain.slice(1).map((child, index) =>
      placement(
        `chain-${index}`,
        String(chain[index]!.instanceId),
        "content",
        String(child.instanceId),
        0,
      ),
    );
    const bounded = buildSystemCompositionPreviewModel(
      chain,
      chainPlacements,
      [{ kind: "asset-instance", id: chain[0]!.instanceId } as never],
      [composerDefinition("builtin.shell.page", ["content"])],
    );
    const boundedRoots = JSON.stringify(bounded.roots);
    expect(boundedRoots).toContain(
      `page-${MAX_SYSTEM_COMPOSITION_PREVIEW_DEPTH - 1}`,
    );
    expect(boundedRoots).not.toContain(
      `page-${MAX_SYSTEM_COMPOSITION_PREVIEW_DEPTH}`,
    );

    const html = renderToStaticMarkup(
      <SystemCompositionPreview
        systemName="Bounded"
        instances={[wide[0]!]}
        catalog={[composerDefinition("builtin.display.table", [])]}
      />,
    );
    expect(html).not.toContain(
      "x".repeat(MAX_SYSTEM_COMPOSITION_PREVIEW_TEXT_LENGTH + 1),
    );
    expect((html.match(/<th(?:\s|>)/g) ?? []).length).toBe(20);
    const renderedRows = (html.match(/<tr(?:\s|>)/g) ?? []).length;
    expect(renderedRows > 0 && renderedRows <= 26).toBe(true);
    expect(html).not.toContain("39:29");
  });

  it("renders canonical region order, unassigned assets, and responsive viewport controls", () => {
    const root = instance(
      "root",
      "builtin.system.system",
      "System root",
      {
        title: "System root configured",
        themeColorPrimary: "#123456",
        themeFontFamily: "serif",
        themeButtonTreatment: "outline",
      },
      "3.0.0",
    );
    const shell = instance(
      "shell",
      "builtin.layout.application.standard",
      "Application shell",
      { title: "Application shell configured" },
      "3.0.0",
    );
    const page = instance(
      "page",
      "builtin.shell.page",
      "Workspace page",
      {
        title: "Workspace page configured",
        styleSurfaceRole: "tertiary",
        styleSpacing: "comfortable",
      },
      "3.0.0",
    );
    const form = instance(
      "form",
      "builtin.feature.record-form",
      "Request form",
    );
    const orphan = instance("orphan", "builtin.shell.page", "Unassigned page");
    const placements = [
      placement("root-shell", "root", "application-shell", "shell", 0),
      placement("shell-page", "shell", "content", "page", 0),
      placement("page-form", "page", "content", "form", 0),
    ];
    const catalog = [
      composerDefinition(
        "builtin.system.system",
        ["application-shell"],
        "3.0.0",
      ),
      composerDefinition(
        "builtin.layout.application.standard",
        ["content"],
        "3.0.0",
      ),
      composerDefinition("builtin.shell.page", ["content"], "3.0.0"),
      composerDefinition("builtin.feature.record-form", []),
    ];

    const model = buildSystemCompositionPreviewModel(
      [root, shell, page, form, orphan],
      placements,
      [{ kind: "asset-instance", id: root.instanceId } as never],
      catalog,
    );
    expect(model.roots[0]?.slots[0]?.slotId).toBe("application-shell");
    expect(
      model.roots[0]?.slots[0]?.children[0]?.slots[0]?.children[0]?.item
        .instanceId,
    ).toBe("page");
    expect(model.unassignedCount).toBe(1);

    const html = renderToStaticMarkup(
      <SystemCompositionPreview
        systemName="Nested requests"
        instances={[root, shell, page, form, orphan]}
        placements={placements}
        rootInstanceRefs={[
          { kind: "asset-instance", id: root.instanceId } as never,
        ]}
        catalog={catalog}
      />,
    );
    expect(html).toContain(
      'data-foundation-layout="builtin.layout.application.standard"',
    );
    expect(html).toContain('data-slot="content"');
    expect(html).toContain('data-preview-instance="form"');
    expect(html).toContain("--foundation-color-primary:#123456");
    expect(html).toContain('data-theme-font-family="serif"');
    expect(html).toContain('data-theme-button-treatment="outline"');
    expect(html).toContain('data-style-surface-role="tertiary"');
    expect(html).toContain('data-style-spacing="comfortable"');
    expect(html).not.toContain("Visual preview unavailable");
    expect(html).toContain("Unassigned assets");
    expect(html).toContain('aria-label="Preview viewport"');
    expect(html).toContain(">Desktop</button>");
    expect(html).toContain(">Tablet</button>");
    expect(html).toContain(">Mobile</button>");
    expect(
      html.indexOf('data-preview-instance="root"') <
        html.indexOf('data-preview-instance="shell"'),
    ).toBe(true);
  });
});
function placement(
  placementId: string,
  parentId: string,
  slotId: string,
  childId: string,
  order: number,
): AssetPlacement {
  return {
    schemaVersion: "asset-placement.v1",
    placementId,
    parentInstanceRef: { kind: "asset-instance", id: parentId },
    slotId,
    childInstanceRef: { kind: "asset-instance", id: childId },
    order,
  } as AssetPlacement;
}

function composerDefinition(
  definitionId: string,
  slotIds: readonly string[],
  version = "1.0.0",
): SystemBuilderComposerAsset {
  return {
    definitionRef: {
      kind: "asset-definition-version",
      id: definitionId,
      version,
    },
    definitionId,
    version,
    displayName: definitionId,
    assetType: "ui-component",
    assetFamily: "structural",
    lifecycleStatus: "published",
    builtIn: true,
    ports: [],
    slots: slotIds.map((slotId) => ({
      schemaVersion: "asset-slot-definition.v1",
      slotId,
      displayName: slotId,
      cardinality: { minItems: 0, maxItems: 8 },
      acceptedAssetTypes: ["ui-component"],
    })),
    compatibility: { status: "compatible" },
    implementationAvailability: "trusted-system-foundation",
    previewAvailability: "trusted-declarative",
  } as unknown as SystemBuilderComposerAsset;
}
