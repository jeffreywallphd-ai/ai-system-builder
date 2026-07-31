import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "../../../../testing/node-test";
import {
  mapAssetDefinitionDetail,
  mapAssetDefinitionListResult,
  mapAssetResourceBackedViewDetail,
  mapAssetResourceBackedViewListResult,
  mapTransportEnvelopeError,
  filterAssetDefinitionsByCategory,
  filterAssetDefinitionsByPack,
  filterAssetDefinitionsBySourceLayer,
  getAssetCategoryLabel,
  getAssetPackLabel,
  getAssetSourceBadge,
  groupAssetDefinitionsByCategory,
  groupAssetDefinitionsByPack,
  sanitizeAssetLibraryDiagnosticMessages,
} from "../index";
import * as assetLibraryExports from "../index";

const unsafeValues = [
  "C:\\Users\\name\\secret.txt",
  "/tmp/private/file",
  "/home/user/.cache/token",
  "/Users/name/private/file",
  "Bearer abc123",
  "apiKey=abc123",
  "signedUrl",
  "access_token",
  "token",
  "password",
  "secret",
  "auth",
  "stack trace",
  "command",
  "process.env",
  "base64",
  "data:image/png;base64,AAAA",
  "workflowJson",
  "prompt",
  "command line",
  "bytes",
  "blobs",
  "raw provider payload",
  "raw provider payloads",
  "https://example.invalid/object?X-Amz-Signature=abc",
  "https://example.invalid/object?token=abc",
];

function detailPayload(overrides: Record<string, unknown> = {}) {
  return {
    builtIn: true,
    definition: {
      definitionId: "builtin.document",
      version: "1.0.0",
      assetType: "document",
      assetFamily: "resource-backed",
      displayName: "Document",
      description: "Reusable document descriptor",
      lifecycleStatus: "published",
      reviewStatus: "approved",
      provenance: {
        sourceKind: "system-generated",
        authorship: "human-authored",
        createdAt: "2026-05-01T00:00:00.000Z",
        updatedAt: "2026-05-02T00:00:00.000Z",
        redactedGenerationSummary: "safe generation summary",
      },
      aiContext: {
        purpose: "Represent document-backed assets",
        userFacingSummary: "Document asset",
        developerFacingSummary: "Maps document resources",
        capabilities: [{ summary: "Reads descriptors" }],
        limitations: [{ summary: "No byte reads" }],
        safetyNotes: [{ summary: "Metadata only" }],
      },
      configurationSchema: {
        schemaId: "document.schema",
        schemaVersion: "1",
        fields: [{ fieldId: "title", valueKind: "string" }],
        requiredFieldIds: ["title"],
        strict: true,
      },
      ports: [
        { portId: "in", direction: "input" },
        { portId: "out", direction: "output" },
      ],
      requirements: [
        {
          requirementKind: "runtime-capability",
          required: true,
          runtimeCapabilityId: "python-runtime",
          safetyStatus: "requires-review",
        },
      ],
      metadata: {
        safe: "visible",
        localPath: "/tmp/private/file",
        nested: {
          token: "Bearer abc123",
          note: "safe nested note",
        },
      },
      ...overrides,
    },
    validationSummary: {
      status: "valid-with-warnings",
      issues: [{ severity: "warning", category: "ai-context", message: "Safe warning" }],
      validatedAt: "2026-05-03T00:00:00.000Z",
    },
  };
}

describe("asset library mappers", () => {
  it("maps definition list cards into safe UI-facing cards and preserves built-in distinction", () => {
    const result = mapAssetDefinitionListResult({
      items: [
        {
          definitionRef: { kind: "asset-definition", id: "builtin.document", version: "1.0.0" },
          definitionId: "builtin.document",
          version: "1.0.0",
          assetType: "document",
          assetFamily: "resource-backed",
          displayName: "Document",
          summary: "Metadata-only document asset",
          lifecycleStatus: "published",
          builtIn: true,
          provenance: { updatedAt: "2026-05-02T00:00:00.000Z" },
          metadata: {
            localPath: "/tmp/secret",
            sourcePackId: "system.foundation",
            sourcePackVersion: "1.0.0",
            sourceKind: "system",
            sourceLayer: "system-default",
            trustStatus: "system-trusted",
            categoryId: "ui-structure",
          },
        },
        {
          definitionId: "custom.tool",
          version: "2.0.0",
          assetType: "tool",
          assetFamily: "behavioral",
          displayName: "Custom Tool",
          lifecycleStatus: "draft",
          builtIn: false,
        },
      ],
      nextCursor: "cursor-2",
    });

    expect(result.items).toEqual([
      {
        id: "builtin.document@1.0.0",
        definitionId: "builtin.document",
        definitionRef: { kind: "asset-definition", id: "builtin.document", version: "1.0.0" },
        version: "1.0.0",
        displayName: "Document",
        summary: "Metadata-only document asset",
        assetType: "document",
        assetTypeLabel: "Document",
        assetFamily: "resource-backed",
        assetFamilyLabel: "Resource Backed",
        lifecycleStatus: "published",
        lifecycleStatusLabel: "Published",
        builtIn: true,
        sourcePackId: "system.foundation",
        sourcePackVersion: "1.0.0",
        sourcePackDisplayName: "System Foundation",
        sourceKind: "system",
        sourceLayer: "system-default",
        trustStatus: "system-trusted",
        packCategoryId: "ui-structure",
        packCategoryDisplayName: "UI Structure",
        systemDefault: true,
        sourceBadgeLabel: "System default",
        packLabel: "System Foundation",
        categoryLabel: "UI Structure",
        updatedAt: "2026-05-02T00:00:00.000Z",
        badges: ["System default", "From System Foundation", "Published"],
      },
      {
        id: "custom.tool@2.0.0",
        definitionId: "custom.tool",
        definitionRef: undefined,
        version: "2.0.0",
        displayName: "Custom Tool",
        summary: undefined,
        assetType: "tool",
        assetTypeLabel: "Tool",
        assetFamily: "behavioral",
        assetFamilyLabel: "Behavioral",
        lifecycleStatus: "draft",
        lifecycleStatusLabel: "Draft",
        builtIn: false,
        sourceBadgeLabel: "Custom",
        packLabel: undefined,
        categoryLabel: undefined,
        updatedAt: undefined,
        badges: ["Custom", "Draft"],
      },
    ]);
    expect(result.nextCursor).toBe("cursor-2");
  });

  it("handles empty lists", () => {
    expect(mapAssetDefinitionListResult({ items: [] })).toEqual({
      items: [],
      diagnostics: [],
    });
  });

  it("maps details with optional expanded sections", () => {
    const detail = mapAssetDefinitionDetail(detailPayload());

    expect(detail.id).toBe("builtin.document@1.0.0");
    expect(detail.overview?.reviewStatus).toBe("approved");
    expect(detail.aiContextSummary?.capabilityCount).toBe(1);
    expect(detail.configurationSummary?.fieldCount).toBe(1);
    expect(detail.portsSummary?.inputCount).toBe(1);
    expect(detail.requirementsSummary?.runtimeCapabilityIds).toEqual(["python-runtime"]);
    expect(detail.provenanceSummary?.updatedAt).toBe("2026-05-02T00:00:00.000Z");
    expect(detail.validationSummary).toMatchObject({
      status: "valid-with-warnings",
      issueCount: 1,
      warningCount: 1,
    });
    expect(detail.metadata).toEqual({ safe: "visible", nested: { note: "safe nested note" } });
  });

  it("drops or redacts unsafe metadata and details", () => {
    const mapped = mapAssetDefinitionDetail(detailPayload({
      description: "/home/user/private",
      aiContext: {
        purpose: "Bearer abc123",
        userFacingSummary: "safe user summary",
        developerFacingSummary: "raw provider payloads",
      },
      provenance: {
        sourceKind: "system-generated",
        redactedGenerationSummary: "command",
      },
      metadata: Object.fromEntries(unsafeValues.map((value, index) => [`unsafe${index}`, value])),
    }));
    const serialized = JSON.stringify(mapped);

    for (const unsafe of unsafeValues) {
      expect(serialized.includes(unsafe)).toBe(false);
    }
    expect(mapped.overview?.description).toBeUndefined();
    expect(mapped.aiContextSummary?.purpose).toBeUndefined();
    expect(mapped.provenanceSummary?.redactedGenerationSummary).toBeUndefined();
  });

  it("does not require validation by default", () => {
    const mapped = mapAssetDefinitionDetail({
      definition: detailPayload({}).definition,
      builtIn: false,
    });

    expect(mapped.validationSummary).toBeUndefined();
  });

  it("does not convert invalid canonical values into valid-looking asset semantics", () => {
    const result = mapAssetDefinitionListResult({
      items: [
        {
          definitionId: "broken.asset",
          version: "1.0.0",
          assetType: "definitely-not-tool",
          assetFamily: "definitely-not-behavioral",
          lifecycleStatus: "definitely-not-draft",
          displayName: "Broken asset",
        },
        {
          definitionId: "missing.asset",
          version: "1.0.0",
          displayName: "Missing asset",
        },
      ],
    });

    expect(result.items[0]).toMatchObject({
      assetType: undefined,
      assetTypeLabel: "Unknown type",
      assetFamily: undefined,
      assetFamilyLabel: "Unknown family",
      lifecycleStatus: undefined,
      lifecycleStatusLabel: "Unknown status",
      sourceBadgeLabel: "Custom",
      badges: ["Custom"],
    });
    expect(result.items[1]).toMatchObject({
      assetType: undefined,
      assetTypeLabel: "Unknown type",
      assetFamily: undefined,
      assetFamilyLabel: "Unknown family",
      lifecycleStatus: undefined,
      lifecycleStatusLabel: "Unknown status",
    });
  });

  it("maps pack source layers to safe source badges and labels", () => {
    const result = mapAssetDefinitionListResult({
      items: [
        {
          definitionId: "workspace.pack",
          version: "1.0.0",
          displayName: "Workspace Pack",
          sourceLayer: "workspace-pack",
          sourcePackId: "workspace.ui",
        },
        {
          definitionId: "workspace.override",
          version: "1.0.0",
          displayName: "Workspace Override",
          sourceLayer: "workspace-pack",
          sourcePackId: "workspace.ui",
          overridesDefinitionRef: { kind: "asset-definition-version", id: "builtin.ui.container", version: "1.0.0" },
        },
        {
          definitionId: "organization.override",
          version: "1.0.0",
          displayName: "Organization Override",
          sourceLayer: "organization-override",
          sourcePackId: "org.ui",
        },
        {
          definitionId: "user.override",
          version: "1.0.0",
          displayName: "User Override",
          sourceLayer: "user-override",
          sourcePackId: "user.ui",
        },
        {
          definitionId: "imported.asset",
          version: "1.0.0",
          displayName: "Imported Asset",
          sourceLayer: "imported-pack",
          sourcePackId: "imported.ui",
        },
        {
          definitionId: "installed.asset",
          version: "1.0.0",
          displayName: "Installed Asset",
          sourceLayer: "installed-pack",
          sourcePackId: "vendor.ui",
        },
        {
          definitionId: "custom.asset",
          version: "1.0.0",
          displayName: "Custom Asset",
        },
      ],
    });

    expect(result.items.map(getAssetSourceBadge)).toEqual([
      "Workspace pack",
      "Workspace override",
      "Organization override",
      "User override",
      "Imported pack",
      "Installed pack",
      "Custom",
    ]);
    expect(result.items[0]?.workspacePack).toBe(true);
    expect(result.items[0]?.workspaceOverride).toBeUndefined();
    expect(result.items[1]?.workspaceOverride).toBe(true);
  });

  it("displays system default only for trusted system foundation metadata", () => {
    const result = mapAssetDefinitionListResult({
      items: [
        {
          definitionId: "trusted.foundation",
          version: "1.0.0",
          displayName: "Trusted Foundation",
          sourcePackId: "system.foundation",
          sourceKind: "system",
          sourceLayer: "system-default",
          trustStatus: "system-trusted",
        },
        {
          definitionId: "bare.foundation",
          version: "1.0.0",
          displayName: "Bare Foundation",
          sourcePackId: "system.foundation",
        },
        {
          definitionId: "marker.foundation",
          version: "1.0.0",
          displayName: "Installed Foundation",
          metadata: {
            sourcePackId: "system.foundation",
            assetPackInstall: {
              packId: "system.foundation",
              packVersion: "1.0.0",
              entryId: "marker.foundation",
              fingerprint: "fnv1a:marker-foundation",
              sourceKind: "system",
              sourceLayer: "system-default",
              trustStatus: "system-trusted",
              managedBy: "asset-kernel",
              installedAt: "2026-05-09T12:00:00.000Z",
            },
          },
        },
      ],
    });

    expect(result.items[0]?.systemDefault).toBe(true);
    expect(result.items[0]?.sourceBadgeLabel).toBe("System default");
    expect(result.items[1]?.systemDefault).toBeUndefined();
    expect(result.items[1]?.sourceBadgeLabel).toBe("Custom");
    expect(result.items[1]?.badges).toEqual(["Custom", "From system.foundation"]);
    expect(result.items[2]?.systemDefault).toBe(true);
    expect(result.items[2]?.sourceBadgeLabel).toBe("System default");
  });

  it("does not display system default for spoofed system foundation metadata", () => {
    const result = mapAssetDefinitionListResult({
      items: [
        {
          definitionId: "wrong.kind",
          version: "1.0.0",
          displayName: "Wrong Kind",
          metadata: {
            sourcePackId: "system.foundation",
            sourceKind: "user",
            sourceLayer: "system-default",
            trustStatus: "system-trusted",
          },
        },
        {
          definitionId: "wrong.layer",
          version: "1.0.0",
          displayName: "Wrong Layer",
          metadata: {
            sourcePackId: "system.foundation",
            sourceKind: "system",
            sourceLayer: "workspace-pack",
            trustStatus: "system-trusted",
          },
        },
        {
          definitionId: "wrong.trust",
          version: "1.0.0",
          displayName: "Wrong Trust",
          metadata: {
            sourcePackId: "system.foundation",
            sourceKind: "system",
            sourceLayer: "system-default",
            trustStatus: "unverified",
          },
        },
      ],
    });

    expect(result.items.map(getAssetSourceBadge)).toEqual(["Custom", "Workspace pack", "Custom"]);
    expect(result.items.some((item) => item.systemDefault === true)).toBe(false);
    expect(result.items.some((item) => item.sourceBadgeLabel === "System default")).toBe(false);
  });

  it("displays workspace-pack override relationships as read-only metadata", () => {
    const detail = mapAssetDefinitionDetail({
      definition: {
        definitionId: "workspace.override",
        version: "1.0.0",
        displayName: "Workspace Override",
        metadata: {
          sourceLayer: "workspace-pack",
          sourcePackId: "workspace.ui",
          overridesDefinitionRef: { kind: "asset-definition-version", id: "builtin.ui.container", version: "1.0.0" },
        },
      },
    });

    expect(detail.sourceBadgeLabel).toBe("Workspace override");
    expect(detail.overridesDefinitionRef).toEqual({ kind: "asset-definition-version", id: "builtin.ui.container", version: "1.0.0" });
    expect(JSON.stringify(detail)).not.toContain("Edit override");
    expect(JSON.stringify(detail)).not.toContain("Create override");
    expect(JSON.stringify(detail)).not.toContain("Delete override");
    expect(JSON.stringify(detail)).not.toContain("Resolve asset");
  });

  it("groups and filters definitions by pack, category, and source layer", () => {
    const result = mapAssetDefinitionListResult({
      items: [
        {
          definitionId: "builtin.ui.container",
          version: "1.0.0",
          displayName: "Container",
          sourcePackId: "system.foundation",
          sourceLayer: "system-default",
          packCategoryId: "ui-structure",
        },
        {
          definitionId: "builtin.form.form",
          version: "1.0.0",
          displayName: "Form",
          sourcePackId: "system.foundation",
          sourceLayer: "system-default",
          packCategoryId: "forms-fields",
        },
        {
          definitionId: "custom.asset",
          version: "1.0.0",
          displayName: "Custom Asset",
        },
      ],
    });

    expect(groupAssetDefinitionsByPack(result.items).map((group) => [group.key, group.items.length])).toEqual([
      ["system.foundation", 2],
      ["custom", 1],
    ]);
    expect(groupAssetDefinitionsByCategory(result.items).map((group) => [group.key, group.label])).toEqual([
      ["ui-structure", "UI Structure"],
      ["forms-fields", "Forms and Fields"],
      ["uncategorized", "Uncategorized"],
    ]);
    expect(filterAssetDefinitionsByPack(result.items, "system.foundation").map((asset) => asset.definitionId)).toEqual([
      "builtin.ui.container",
      "builtin.form.form",
    ]);
    expect(filterAssetDefinitionsBySourceLayer(result.items, "system-default").map((asset) => asset.definitionId)).toEqual([
      "builtin.ui.container",
      "builtin.form.form",
    ]);
    expect(filterAssetDefinitionsByCategory(result.items, "forms-fields").map((asset) => asset.definitionId)).toEqual([
      "builtin.form.form",
    ]);
    expect(getAssetPackLabel(result.items[0]!)).toBe("system.foundation");
    expect(getAssetCategoryLabel(result.items[0]!)).toBe("UI Structure");
  });

  it("drops unsafe pack and override metadata before display", () => {
    const detail = mapAssetDefinitionDetail({
      definition: {
        definitionId: "custom.asset",
        version: "1.0.0",
        displayName: "Custom asset",
        metadata: {
          sourcePackId: "C:\\Users\\name\\pack",
          sourcePackDisplayName: "Bearer abc123",
          sourceLayer: "system-default",
          categoryId: "/tmp/category",
          overridesDefinitionRef: {
            kind: "asset-definition-version",
            id: "C:\\Users\\name\\secret",
            version: "1.0.0",
          },
          overriddenByDefinitionRefs: [
            { kind: "asset-definition-version", id: "workspace.override", version: "1.0.0" },
            { kind: "asset-definition-version", id: "/tmp/unsafe", version: "1.0.0" },
          ],
          effectiveResolutionStatus: "applied",
          resolutionSummary: "Workspace override is active",
        },
      },
    });

    expect(detail.sourcePackId).toBeUndefined();
    expect(detail.sourcePackDisplayName).toBeUndefined();
    expect(detail.packCategoryId).toBeUndefined();
    expect(detail.overridesDefinitionRef).toBeUndefined();
    expect(detail.overriddenByDefinitionRefs).toEqual([
      { kind: "asset-definition-version", id: "workspace.override", version: "1.0.0" },
    ]);
    expect(detail.effectiveResolutionStatus).toBe("applied");
    expect(detail.resolutionSummary).toBe("Workspace override is active");
    expect(JSON.stringify(detail)).not.toContain("C:\\Users");
    expect(JSON.stringify(detail)).not.toContain("/tmp");
    expect(JSON.stringify(detail)).not.toContain("Bearer");
  });

  it("maps resource-backed cards safely and labels generated/external objects as unregistered", () => {
    const result = mapAssetResourceBackedViewListResult({
      items: [
        {
          viewId: "asset-view.generated-output.internal.1",
          viewKind: "generated-output",
          assetType: "image",
          assetFamily: "resource-backed",
          displayName: "Generated output",
          metadata: {
            finalized: false,
            registered: false,
            localPath: "/tmp/private/file",
            prompt: "raw provider payloads",
          },
          diagnostics: [{ severity: "info", code: "generated-output-not-registered", message: "Generated output is not finalized or registered." }],
        },
        {
          viewId: "asset-view.external-repository-object.internal.1",
          viewKind: "external-repository-object",
          assetType: "data-source",
          assetFamily: "resource-backed",
          displayName: "External object",
          metadata: { imported: false, registered: false, token: "Bearer abc123" },
        },
      ],
    });

    expect(result.items[0]).toMatchObject({
      viewId: "asset-view.generated-output.internal.1",
      registrationStatusLabel: "Not finalized or registered",
      diagnostics: ["Generated output is not finalized or registered."],
    });
    expect(result.items[1]).toMatchObject({
      viewId: "asset-view.external-repository-object.internal.1",
      registrationStatusLabel: "Not imported or registered",
    });
    expect(JSON.stringify(result)).not.toContain("/tmp/private/file");
    expect(JSON.stringify(result)).not.toContain("Bearer abc123");
  });

  it("maps resource-backed detail without unsafe metadata, paths, bytes, or prompts", () => {
    const detail = mapAssetResourceBackedViewDetail({
      view: {
        viewId: "asset-view.generated-output.internal.1",
        viewKind: "generated-output",
        displayName: "Generated output",
        metadata: {
          safe: "visible",
          prompt: "safe looking prompt",
          negativePrompt: "safe looking negative prompt",
          workflow: { node: "safe-looking-workflow" },
          requestId: "request-123",
          taskId: "task-123",
          signedUrl: "https://example.invalid/object?X-Amz-Signature=abc",
          storageRootDirectory: "/tmp/private/file",
          bytes: "bytes",
        },
        resourceBacking: {
          resourceKind: "generated-output",
          role: "primary",
          displayName: "Generated output",
          contentType: "image/png",
          localPath: "/tmp/private/file",
        },
      },
    });

    expect(detail.metadata).toEqual({ safe: "visible" });
    expect(detail.resourceBackingSummary).toMatchObject({ resourceKind: "generated-output", contentType: "image/png" });
    expect(JSON.stringify(detail)).not.toContain("/tmp/private/file");
    expect(JSON.stringify(detail)).not.toContain("raw provider payloads");
    expect(JSON.stringify(detail)).not.toContain("safe looking prompt");
    expect(JSON.stringify(detail)).not.toContain("safe looking negative prompt");
    expect(JSON.stringify(detail)).not.toContain("safe-looking-workflow");
    expect(JSON.stringify(detail)).not.toContain("request-123");
    expect(JSON.stringify(detail)).not.toContain("task-123");
    expect(JSON.stringify(detail)).not.toContain("X-Amz-Signature");
    expect(JSON.stringify(detail)).not.toContain("bytes");
  });

  it("sanitizes resource-backed view diagnostics while preserving safe messages", () => {
    const unsafeDiagnostics = unsafeValues.map((message, index) => ({
      severity: "warning",
      code: `unsafe-${index}`,
      message,
    }));
    const result = mapAssetResourceBackedViewListResult({
      diagnostics: [
        { severity: "info", code: "safe", message: "Provider is not configured for this host." },
        ...unsafeDiagnostics,
      ],
      items: [{
        viewId: "asset-view.artifact.safe",
        viewKind: "artifact",
        displayName: "Safe artifact",
        sourceKind: "artifact-browser",
        diagnostics: [
          { severity: "info", code: "safe-card", message: "Safe descriptor-only diagnostic." },
          ...unsafeDiagnostics,
        ],
      }],
    });
    const detail = mapAssetResourceBackedViewDetail({
      view: {
        viewId: "asset-view.artifact.safe",
        viewKind: "artifact",
        displayName: "Safe artifact",
        sourceKind: "artifact-browser",
        diagnostics: [
          { severity: "info", code: "safe-detail", message: "Safe detail diagnostic." },
          ...unsafeDiagnostics,
        ],
      },
    });
    const serialized = JSON.stringify({ result, detail });

    expect(result.diagnostics).toEqual([{ severity: "info", code: "safe", message: "Provider is not configured for this host." }]);
    expect(result.items[0]?.diagnostics).toEqual(["Safe descriptor-only diagnostic."]);
    expect(detail.diagnostics).toEqual(["Safe detail diagnostic."]);
    for (const unsafe of unsafeValues) {
      expect(serialized.includes(unsafe)).toBe(false);
    }
  });

  it("sanitizes standalone diagnostic message arrays for UI rendering", () => {
    expect(sanitizeAssetLibraryDiagnosticMessages([
      "Safe descriptor-only diagnostic.",
      ...unsafeValues,
    ])).toEqual(["Safe descriptor-only diagnostic."]);

    expect(sanitizeAssetLibraryDiagnosticMessages(unsafeValues)).toEqual([]);
    expect(sanitizeAssetLibraryDiagnosticMessages(undefined)).toEqual([]);
    expect(/C:\\|\/tmp|\/home|Bearer|token|secret|password|apiKey|signedUrl|access_token|base64|data:image|raw provider payload|workflowJson|prompt|stack|command line|process\.env/i.test(JSON.stringify(sanitizeAssetLibraryDiagnosticMessages([
      "C:\\Users\\name\\file.png",
      "/tmp/generated.png",
      "/home/user/cache",
      "Bearer abc",
      "token",
      "secret",
      "password",
      "apiKey",
      "signedUrl",
      "access_token",
      "base64",
      "data:image",
      "raw provider payload",
      "workflowJson",
      "prompt",
      "stack",
      "command line",
      "process.env",
    ])))).toBe(false);
  });

  it("normalizes safe client errors without exposing internal detail", () => {
    const error = mapTransportEnvelopeError({
      ok: false,
      requestId: "req-1",
      correlationId: "corr-1",
      error: {
        code: "internal",
        message: "failed at /tmp/secret with stack",
        details: {
          fieldIssues: [{ field: "definitionId", message: "Bearer abc" }],
        },
      },
    }, { status: 500 });

    expect(error).toEqual({
      code: "internal",
      message: "Unable to read Asset Library data.",
      requestId: "req-1",
      correlationId: "corr-1",
      status: 500,
    });
  });

  it("does not export unsupported operation helpers", () => {
    const forbiddenExports = [
      "createAssetDefinition",
      "updateAssetDefinition",
      "deleteAssetDefinition",
      "seedBuiltInAssetDefinitions",
      "importAsset",
      "finalizeAsset",
      "scanResources",
      "executeAsset",
    ];

    for (const exportName of forbiddenExports) {
      expect((assetLibraryExports as Record<string, unknown>)[exportName]).toBeUndefined();
    }

    const source = readFileSync(join(process.cwd(), "modules/ui/shared/asset-library/assetLibraryReadModels.ts"), "utf8");
    expect(source).not.toContain("createAssetDefinition");
    expect(source).not.toContain("seedBuiltInAssetDefinitions");
    expect(/\b(?:importAsset|finalizeAsset|registerAsset|scanResources|executeAsset)\b/.test(source)).toBe(false);
  });
});
