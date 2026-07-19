import { renderToStaticMarkup } from "react-dom/server";

import type { AssetInstance } from "../../../../contracts/asset";
import { describe, expect, it } from "../../../../testing/node-test";
import {
  buildSystemCompositionPreviewModel,
  MAX_SYSTEM_COMPOSITION_PREVIEW_SURFACES,
  SystemCompositionPreview,
} from "../SystemCompositionPreview";

function instance(
  instanceId: string,
  definitionId: string,
  displayName = definitionId,
): AssetInstance {
  return {
    instanceId,
    definitionRef: {
      kind: "asset-definition-version",
      id: definitionId,
      version: "1.0.0",
    },
    displayName,
    lifecycleStatus: "draft",
    selectedConfiguration: { title: `${displayName} configured` },
    provenance: { sourceKind: "human-authored" },
  } as AssetInstance;
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
        includesUnsavedChanges
      />,
    );
    expect(html).toContain('aria-label="Requests current UI preview"');
    expect(html).toContain(
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
        includesUnsavedChanges={false}
      />,
    );
    expect(html).toContain("No previewable frontend surfaces");
    expect(html).toContain("qualified sandbox");
  });
});
