import { describe, expect, it } from "../../../testing/node-test";
import { createWorkspaceId } from "../../workspace";
import {
  ASSET_IMPLEMENTATION_BACKING_RESOURCE_MEDIA_TYPE,
  normalizeAssetImplementationArtifactId,
  normalizeAssetImplementationDraftId,
  normalizeSha256Digest,
} from "../../asset-implementation";
import {
  normalizeAssetStudioAssetDraftRecord,
  normalizeAssetStudioExactDefinitionReference,
} from "..";

describe("Asset Studio asset draft contracts", () => {
  it("normalizes structured semantic data and safe backing-resource descriptors", () => {
    const normalized = normalizeAssetStudioAssetDraftRecord(record());

    expect(normalized.status).toBe("draft");
    expect(normalized.source.files).toEqual([
      {
        path: "backend/logic.ts",
        role: "backend-logic",
        mediaType: "text/typescript",
        sizeCharacters: 31,
        editable: true,
      },
    ]);
    expect("content" in normalized.source.files[0]!).toBe(false);
    expect("resources" in normalized).toBe(false);
  });

  it("rejects floating definition references and inconsistent lifecycle evidence", () => {
    expect(() =>
      normalizeAssetStudioExactDefinitionReference({
        kind: "asset-definition",
        id: "asset.test" as never,
      }),
    ).toThrow(/exact definition reference/i);
    expect(() =>
      normalizeAssetStudioAssetDraftRecord({
        ...record(),
        status: "published",
      }),
    ).toThrow(/lifecycle evidence/i);
  });
});

function record() {
  return {
    draftId: "studio-asset-draft.test" as never,
    workspaceId: createWorkspaceId("workspace-a"),
    definitionRef: {
      kind: "asset-definition-version" as const,
      id: "asset.test" as never,
      version: "1.0.0" as never,
    },
    semanticDefinition: {
      assetType: "tool" as const,
      assetFamily: "behavioral" as const,
      displayName: "Test asset",
      description: "A bounded Studio asset draft contract fixture.",
    },
    implementationDraftId: normalizeAssetImplementationDraftId(
      "implementation.studio-asset-draft.test",
    ),
    source: {
      artifact: {
        artifactId: normalizeAssetImplementationArtifactId(
          "implementation-artifact.test",
        ),
        kind: "source" as const,
        digest: normalizeSha256Digest(`sha256:${"a".repeat(64)}`),
        mediaType: ASSET_IMPLEMENTATION_BACKING_RESOURCE_MEDIA_TYPE,
        sizeBytes: 120,
      },
      files: [
        {
          path: "backend/logic.ts",
          role: "backend-logic" as const,
          mediaType: "text/typescript",
          sizeCharacters: 31,
          editable: true,
        },
      ],
      totalCharacters: 31,
    },
    status: "draft" as const,
    revision: 1,
    provenance: {
      kind: "studio-from-scratch" as const,
      createdAt: "2026-07-18T13:00:00.000Z",
      createdBy: "actor-a",
    },
    createdAt: "2026-07-18T13:00:00.000Z",
    updatedAt: "2026-07-18T13:00:00.000Z",
    createdBy: "actor-a",
  };
}
