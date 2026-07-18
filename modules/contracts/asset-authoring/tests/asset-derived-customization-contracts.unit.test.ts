import { describe, expect, it } from "../../../testing/node-test";
import type {
  AssetImplementationArtifactDescriptor,
  Sha256Digest,
} from "../../asset-implementation";
import {
  ASSET_CUSTOMIZATION_PROTECTED_FIELDS,
  createAssetCustomizationSourceOverlayDescriptor,
  normalizeAssetCustomizationProtectedField,
  normalizeAssetCustomizationSourceChanges,
  normalizeAssetDerivedCustomizationDraftRecord,
  normalizeAssetDerivedCustomizationStatus,
  tryNormalizeAssetDerivedCustomizationDraftRecord,
  type AssetDerivedCustomizationDraftRecord,
} from "..";

const digest = (character: string) =>
  `sha256:${character.repeat(64)}` as Sha256Digest;

const artifact = (
  artifactId: string,
  character: string,
  kind: AssetImplementationArtifactDescriptor["kind"] = "source",
): AssetImplementationArtifactDescriptor =>
  ({
    artifactId,
    kind,
    digest: digest(character),
    mediaType: "application/vnd.ai-system-builder.asset-source+json",
    sizeBytes: 128,
  }) as AssetImplementationArtifactDescriptor;

const base = {
  definitionRef: {
    kind: "asset-definition-version",
    id: "asset.base",
    version: "1.0.0",
  },
  implementationReleaseId: "release.asset.base.1",
  sourceSnapshotId: "snapshot.asset.base.1",
  sourceArtifact: artifact("artifact.asset.base.1", "a"),
} as const;

const makeDraft = (
  overrides: Partial<AssetDerivedCustomizationDraftRecord> = {},
): AssetDerivedCustomizationDraftRecord =>
  ({
    customizationId: "customization.asset.1",
    workspaceId: "workspace-1",
    base,
    derivedDefinitionRef: {
      kind: "asset-definition-version",
      id: "asset.customized",
      version: "1.0.0",
    },
    semanticPatch: { "display-name": "Customized asset" },
    status: "draft",
    revision: 1,
    provenance: {
      kind: "layered-derived-customization",
      sourceKind: "system-owned-asset",
      baseDefinitionRef: base.definitionRef,
      baseImplementationReleaseId: base.implementationReleaseId,
      baseSourceSnapshotId: base.sourceSnapshotId,
      derivedAt: "2026-07-18T12:00:00.000Z",
      derivedBy: "actor-1",
    },
    createdAt: "2026-07-18T12:00:00.000Z",
    updatedAt: "2026-07-18T12:00:00.000Z",
    createdBy: "actor-1",
    ...overrides,
  }) as AssetDerivedCustomizationDraftRecord;

describe("layered derived asset customization contracts", () => {
  it("normalizes the accepted lifecycle and protected-field vocabulary", () => {
    expect(normalizeAssetDerivedCustomizationStatus(" READY-FOR-REVIEW ")).toBe(
      "ready-for-review",
    );
    expect(normalizeAssetCustomizationProtectedField("TRUST")).toBe("trust");
    expect(ASSET_CUSTOMIZATION_PROTECTED_FIELDS).toContain(
      "implementation-release",
    );
    expect(ASSET_CUSTOMIZATION_PROTECTED_FIELDS).toContain("artifact-digest");
    expect(() =>
      normalizeAssetDerivedCustomizationStatus("auto-rebased"),
    ).toThrow();
    expect(() =>
      normalizeAssetCustomizationProtectedField("prompt-text"),
    ).toThrow();
  });

  it("accepts bounded upserts and deletes and stores only an overlay descriptor", () => {
    const changes = normalizeAssetCustomizationSourceChanges([
      {
        operation: "upsert",
        path: "src\\view.ts",
        content: "export const view = true;",
      },
      { operation: "delete", path: "src/legacy.ts" },
    ]);
    expect(changes[0]).toEqual({
      operation: "upsert",
      path: "src/view.ts",
      role: "other",
      mediaType: "text/typescript",
      content: "export const view = true;",
    });

    const descriptor = createAssetCustomizationSourceOverlayDescriptor(
      artifact("artifact.overlay.1", "b"),
      changes,
    );
    expect(descriptor.changeCount).toBe(2);
    expect(descriptor.upsertCount).toBe(1);
    expect(descriptor.deleteCount).toBe(1);
    expect(descriptor.totalCharacters).toBe(25);
    expect("changes" in descriptor).toBe(false);
    expect("path" in descriptor).toBe(false);
    expect("content" in descriptor).toBe(false);
  });

  it("rejects unsafe, duplicate, unsupported, oversized, and secret-bearing source changes", () => {
    expect(() =>
      normalizeAssetCustomizationSourceChanges([
        { operation: "delete", path: "../outside.ts" },
      ]),
    ).toThrow();
    expect(() =>
      normalizeAssetCustomizationSourceChanges([
        { operation: "delete", path: "src/.env" },
      ]),
    ).toThrow();
    expect(() =>
      normalizeAssetCustomizationSourceChanges([
        { operation: "delete", path: "src/view.exe" },
      ]),
    ).toThrow();
    expect(() =>
      normalizeAssetCustomizationSourceChanges([
        {
          operation: "upsert",
          path: "src/View.ts",
          content: "export const first = true;",
        },
        { operation: "delete", path: "src/view.ts" },
      ]),
    ).toThrow();
    expect(() =>
      normalizeAssetCustomizationSourceChanges([
        {
          operation: "upsert",
          path: "src/secret.ts",
          content: "const api_key = 'sk_abcdefghijklmnop';",
        },
      ]),
    ).toThrow();
    expect(() =>
      normalizeAssetCustomizationSourceChanges([
        {
          operation: "upsert",
          path: "src/huge.ts",
          content: "x".repeat(200_001),
        },
      ]),
    ).toThrow();
    expect(() =>
      createAssetCustomizationSourceOverlayDescriptor(
        artifact("artifact.package.1", "c", "package"),
        [{ operation: "delete", path: "src/view.ts" }],
      ),
    ).toThrow(/source content/);
  });

  it("requires workspace scope and exact immutable semantic and implementation bases", () => {
    const normalized =
      normalizeAssetDerivedCustomizationDraftRecord(makeDraft());
    expect(normalized.workspaceId).toBe("workspace-1");
    expect(normalized.base.definitionRef).toEqual({
      kind: "asset-definition-version",
      id: "asset.base",
      version: "1.0.0",
    });

    expect(() =>
      normalizeAssetDerivedCustomizationDraftRecord(
        makeDraft({ workspaceId: " " as never }),
      ),
    ).toThrow();
    expect(() =>
      normalizeAssetDerivedCustomizationDraftRecord(
        makeDraft({
          base: {
            ...base,
            definitionRef: {
              kind: "asset-definition",
              id: "asset.base",
              version: "1.0.0",
            },
          } as never,
        }),
      ),
    ).toThrow(/exact asset-definition-version/);
    expect(() =>
      normalizeAssetDerivedCustomizationDraftRecord(
        makeDraft({
          base: {
            ...base,
            definitionRef: {
              kind: "asset-definition-version",
              id: "asset.base",
            },
          } as never,
        }),
      ),
    ).toThrow(/exact asset definition version/);
    expect(() =>
      normalizeAssetDerivedCustomizationDraftRecord(
        makeDraft({
          semanticPatch: { version: "2.0.0" } as never,
        }),
      ),
    ).toThrow(/unsupported/);
    expect(() =>
      normalizeAssetDerivedCustomizationDraftRecord(
        makeDraft({
          provenance: {
            ...makeDraft().provenance,
            baseImplementationReleaseId: "release.other.1",
          } as never,
        }),
      ),
    ).toThrow(/does not match/);
    expect(() =>
      normalizeAssetDerivedCustomizationDraftRecord({
        ...makeDraft(),
        baseAssetReference: {
          kind: "asset-definition-version",
          id: "asset.replacement",
          version: "2.0.0",
        },
      } as never),
    ).toThrow(/unsupported fields/);
  });

  it("accepts bounded structured definition sections while rejecting storage and secret fields", () => {
    const normalized = normalizeAssetDerivedCustomizationDraftRecord(
      makeDraft({
        semanticPatch: {
          "display-name": "Structured customization",
          "configuration-schema": {
            fields: [
              {
                fieldId: "mode",
                valueKind: "string",
                required: true,
              },
            ],
            requiredFieldIds: ["mode"],
            strict: true,
          },
          "default-configuration": { mode: "safe" },
          ports: [
            {
              portId: "input",
              direction: "input",
              contract: { contractKind: "data" },
            },
          ],
        } as never,
      }),
    );
    expect(normalized.semanticPatch["configuration-schema"]).toEqual({
      fields: [
        { fieldId: "mode", valueKind: "string", required: true },
      ],
      requiredFieldIds: ["mode"],
      strict: true,
    });
    expect(normalized.semanticPatch.ports?.[0]?.portId).toBe("input");

    expect(() =>
      normalizeAssetDerivedCustomizationDraftRecord(
        makeDraft({
          semanticPatch: {
            ports: [{ portId: "unsafe", storageRoot: "/tmp/private" }],
          } as never,
        }),
      ),
    ).toThrow(/unsafe field/);
  });

  it("binds review and publication to the exact revision, overlay, and distinct lineage", () => {
    const sourceOverlay = createAssetCustomizationSourceOverlayDescriptor(
      artifact("artifact.overlay.2", "d"),
      [
        {
          operation: "upsert",
          path: "src/view.ts",
          content: "export const view = 'custom';",
        },
      ],
    );
    const review = {
      implementationDraftId: "implementation-draft.asset.customized.1",
      sourceSnapshotId: "snapshot.asset.customized.1",
      sourceArtifact: artifact("artifact.materialized.1", "e"),
      semanticPatchDigest: digest("f"),
      sourceOverlayDigest: sourceOverlay.artifact.digest,
      materializedFromRevision: 2,
      materializedAt: "2026-07-18T13:00:00.000Z",
      materializedBy: "reviewer-1",
    } as const;
    const publication = {
      definitionRef: {
        kind: "asset-definition-version",
        id: "asset.customized",
        version: "1.0.0",
      },
      implementationDraftId: "implementation-draft.asset.customized.1",
      sourceSnapshotId: review.sourceSnapshotId,
      publishedAt: "2026-07-18T14:00:00.000Z",
      publishedBy: "publisher-1",
    } as const;

    const normalized = normalizeAssetDerivedCustomizationDraftRecord(
      makeDraft({
        sourceOverlay,
        status: "published",
        revision: 3,
        review,
        publication,
        updatedAt: "2026-07-18T14:00:00.000Z",
      } as never),
    );
    expect(normalized.publication?.definitionRef.id).toBe("asset.customized");

    expect(() =>
      normalizeAssetDerivedCustomizationDraftRecord(
        makeDraft({
          sourceOverlay,
          status: "reviewed",
          revision: 3,
          review,
        } as never),
      ),
    ).toThrow(/stale/);
    expect(() =>
      normalizeAssetDerivedCustomizationDraftRecord(
        makeDraft({
          sourceOverlay,
          status: "published",
          revision: 3,
          review,
        } as never),
      ),
    ).toThrow(/publication status/);
    expect(() =>
      normalizeAssetDerivedCustomizationDraftRecord(
        makeDraft({
          sourceOverlay,
          status: "published",
          revision: 3,
          review,
          publication: {
            ...publication,
            definitionRef: base.definitionRef,
          },
        } as never),
      ),
    ).toThrow(/distinct reviewed asset lineage/);
    expect(normalized.publication?.implementationDraftId).toBe(
      "implementation-draft.asset.customized.1",
    );
  });

  it("returns a sanitized failure without reflecting unsafe input", () => {
    const result = tryNormalizeAssetDerivedCustomizationDraftRecord({
      ...makeDraft(),
      semanticPatch: { "prompt-text": "sk-secret" },
    } as never);
    expect(result).toEqual({
      ok: false,
      code: "asset-authoring.derived-customization.invalid",
    });
  });
});
