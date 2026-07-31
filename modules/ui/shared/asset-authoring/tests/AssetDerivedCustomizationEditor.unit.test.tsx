import { renderToStaticMarkup } from "react-dom/server";

import { describe, expect, it } from "../../../../testing/node-test";
import type { AssetDerivedCustomizationTargetDetail } from "../../../../contracts/asset-authoring";
import {
  AssetDerivedCustomizationEditor,
  type AssetDerivedCustomizationClient,
} from "../AssetDerivedCustomizationEditor";
import {
  buildAssetCustomizationSubmission,
  buildAssetCustomizationSourceUpdate,
  createAssetCustomizationEditorValues,
  createAssetCustomizationResourceDrafts,
} from "../assetDerivedCustomizationEditorModel";

const target = {
  workspaceId: "workspace-1",
  sourceKind: "system-owned-asset",
  definitionRef: {
    kind: "asset-definition-version",
    id: "builtin.button",
    version: "1.0.0",
  },
  implementationReleaseId: "implementation-release.button.1",
  displayName: "Button",
  description: "A reusable button.",
  eligibility: { eligible: true, code: "eligible", message: "Eligible." },
  resources: {
    total: 4,
    editable: 3,
    frontendStructure: 1,
    frontendStyle: 1,
    backendLogic: 1,
    other: 1,
  },
  definition: {
    definitionId: "builtin.button",
    assetType: "component",
    assetFamily: "ui-structure",
    version: "1.0.0",
    displayName: "Button",
    description: "A reusable button.",
    lifecycleStatus: "published",
    provenance: {},
    ports: [],
    requirements: [],
    compositionRules: [],
    dependencies: [],
  },
  backingResources: [
    {
      path: "frontend/Button.tsx",
      role: "frontend-structure",
      mediaType: "text/typescript",
      sizeCharacters: 20,
      editable: true,
      content: "export const Button=1;",
    },
    {
      path: "styles/button.css",
      role: "frontend-style",
      mediaType: "text/css",
      sizeCharacters: 13,
      editable: true,
      content: ".button{}",
    },
    {
      path: "backend/button.json",
      role: "backend-logic",
      mediaType: "application/json",
      sizeCharacters: 14,
      editable: true,
      content: '{"action":1}',
    },
    {
      path: "other/definition.json",
      role: "other",
      mediaType: "application/json",
      sizeCharacters: 10,
      editable: false,
      content: "{}",
    },
  ],
  protectedFields: ["asset-identity", "ownership"],
} as unknown as AssetDerivedCustomizationTargetDetail;

describe("AssetDerivedCustomizationEditor", () => {
  it("renders the complete ordered semantic and implementation workflow", () => {
    const html = renderToStaticMarkup(
      <AssetDerivedCustomizationEditor
        workspaceId="workspace-1"
        client={{} as AssetDerivedCustomizationClient}
      />,
    );

    for (const label of [
      "Choose the asset",
      "Definition and identity",
      "Configuration and interfaces",
      "AI context and composition",
      "Frontend structure",
      "Frontend styling",
      "Backend logic",
      "Other backing resources",
      "Save, review, and publish",
    ])
      expect(html).toContain(label);
  });

  it("builds sparse semantic and source changes while preserving the base", () => {
    const values = createAssetCustomizationEditorValues(target);
    const resources = createAssetCustomizationResourceDrafts(target).map(
      (resource) =>
        resource.path === "frontend/Button.tsx"
          ? { ...resource, content: "export const Button=2;" }
          : resource,
    );
    const submission = buildAssetCustomizationSubmission(
      target,
      values,
      resources,
    );

    expect(submission.derivedDefinitionRef).toEqual({
      kind: "asset-definition-version",
      id: "builtin.button.custom",
      version: "1.0.0",
    });
    expect(submission.semanticPatch).toEqual({
      "display-name": "Button (Custom)",
    });
    expect(submission.sourceChanges).toEqual([
      {
        operation: "upsert",
        path: "frontend/Button.tsx",
        role: "frontend-structure",
        mediaType: "text/typescript",
        content: "export const Button=2;",
      },
    ]);
  });

  it("rejects invalid structured section JSON before transport", () => {
    const values = {
      ...createAssetCustomizationEditorValues(target),
      ports: "{",
    };
    expect(() =>
      buildAssetCustomizationSubmission(
        target,
        values,
        createAssetCustomizationResourceDrafts(target),
      ),
    ).toThrow("Ports must be valid JSON.");
  });

  it("clears a persisted source overlay when all resources return to their base content", () => {
    expect(buildAssetCustomizationSourceUpdate(true, [])).toEqual({
      clearSourceOverlay: true,
    });
    expect(buildAssetCustomizationSourceUpdate(false, [])).toEqual({});
  });
});
