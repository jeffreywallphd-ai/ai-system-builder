import { describe, expect, it } from "../../../testing/node-test";
import {
  ASSET_IMPLEMENTATION_BACKING_RESOURCE_MEDIA_TYPE,
  describeAssetImplementationBackingResourceFiles,
  normalizeAssetImplementationBackingResourceBundle,
  normalizeAssetImplementationBackingResourceRecord,
  type AssetImplementationBackingResourceBundleV1,
} from "..";

const bundle: AssetImplementationBackingResourceBundleV1 = {
  formatVersion: "1.0",
  files: [
    {
      path: "frontend/structure.json",
      role: "frontend-structure",
      mediaType: "application/json",
      content: "{\"kind\":\"form\"}",
    },
    {
      path: "frontend/styles.css",
      role: "frontend-style",
      mediaType: "text/css",
      content: ".form { display: grid; }",
    },
    {
      path: "backend/logic.json",
      role: "backend-logic",
      mediaType: "application/json",
      content: "{\"steps\":[\"validate\",\"save\"]}",
    },
  ],
};

describe("asset implementation backing resource contracts", () => {
  it("normalizes bounded frontend, styling, and backend resources", () => {
    const normalized = normalizeAssetImplementationBackingResourceBundle(bundle);
    expect(normalized.files.map((file) => file.role)).toEqual([
      "frontend-structure",
      "frontend-style",
      "backend-logic",
    ]);
    expect(describeAssetImplementationBackingResourceFiles(bundle)).toEqual(
      bundle.files.map((file) => ({
        path: file.path,
        role: file.role,
        mediaType: file.mediaType,
        sizeCharacters: file.content.length,
        editable: true,
      })),
    );
  });

  it("rejects traversal, duplicate paths, credentials, and unsupported files", () => {
    for (const files of [
      [{ ...bundle.files[0]!, path: "../outside.json" }],
      [bundle.files[0]!, { ...bundle.files[0]!, path: "FRONTEND/structure.json" }],
      [{ ...bundle.files[0]!, content: "api_key='sk_abcdefghijklmnop'" }],
      [{ ...bundle.files[0]!, path: "frontend/program.exe" }],
    ]) {
      expect(() =>
        normalizeAssetImplementationBackingResourceBundle({
          formatVersion: "1.0",
          files,
        }),
      ).toThrow();
    }
  });

  it("keeps structured release links free of raw content and workspace leakage", () => {
    const files = describeAssetImplementationBackingResourceFiles(bundle);
    const record = normalizeAssetImplementationBackingResourceRecord({
      backingResourceId: "implementation-backing.asset.1",
      origin: "system-foundation",
      releaseId: "implementation-release.asset.1" as never,
      definitionRef: {
        kind: "asset-definition-version",
        id: "asset.definition" as never,
        version: "1.0.0",
      },
      scope: "system",
      artifactWorkspaceId: "system.foundation" as never,
      sourceSnapshotId: "source-snapshot.asset.1" as never,
      artifact: {
        artifactId: "artifact.source.asset.1" as never,
        kind: "source",
        digest: `sha256:${"a".repeat(64)}` as never,
        mediaType: ASSET_IMPLEMENTATION_BACKING_RESOURCE_MEDIA_TYPE,
        sizeBytes: 200,
      },
      files,
      createdAt: "2026-07-18T12:00:00.000Z",
      createdBy: "system",
    });
    expect(record.scope).toBe("system");
    expect(JSON.stringify(record)).not.toContain("display: grid");
    expect(() =>
      normalizeAssetImplementationBackingResourceRecord({
        ...record,
        scope: "workspace",
      }),
    ).toThrow(/workspace scope/);
  });
});
