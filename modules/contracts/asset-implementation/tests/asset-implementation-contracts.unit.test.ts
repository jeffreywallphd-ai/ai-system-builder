import { describe, expect, it } from "../../../testing/node-test";
import { createWorkspaceId } from "../../workspace";
import {
  normalizeAssetImplementationFacet,
  normalizeAssetImplementationRelease,
  normalizeAssetImplementationReleaseId,
} from "..";

const digest = `sha256:${"a".repeat(64)}` as const;

describe("asset implementation contracts", () => {
  it("normalizes immutable release metadata without executable payloads", () => {
    const release = normalizeAssetImplementationRelease({
      releaseId: normalizeAssetImplementationReleaseId("release.text-input.1"),
      workspaceId: createWorkspaceId("workspace-a"),
      definitionRef: {
        kind: "asset-definition-version",
        id: "system.text-input" as never,
        version: "1.0.0",
      },
      version: "1.0.0",
      status: "published",
      trustLevel: "system-trusted",
      facets: [
        {
          facetId: "facet.ui" as never,
          kind: "ui",
          runtimeKind: "trusted-built-in",
          entryKey: "foundation.text-input",
          requiredCapabilities: [],
          compatibility: {
            definitionVersion: "1.0.0",
            hostApiRange: ">=1.0.0 <2.0.0",
            deploymentProfiles: [
              "thin-client",
              "local-desktop",
              "local-desktop",
            ],
          },
        },
      ],
      packageDigest: digest,
      evidenceArtifacts: [],
      createdAt: "2026-07-17T12:00:00.000Z",
      publishedAt: "2026-07-17T12:00:00.000Z",
      publishedBy: "system",
    });

    expect(release.facets[0]?.compatibility.deploymentProfiles).toEqual([
      "local-desktop",
      "thin-client",
    ]);
    expect(JSON.stringify(release)).not.toMatch(
      /sourceCode|storageKey|localPath|secret|token|bytes/i,
    );
  });

  it("requires exact definition versions and rejects host payload fields", () => {
    expect(() =>
      normalizeAssetImplementationRelease({
        releaseId: "release.bad" as never,
        definitionRef: {
          kind: "asset-definition",
          id: "system.text-input" as never,
        },
        version: "1.0.0",
        status: "published",
        trustLevel: "system-trusted",
        facets: [
          {
            facetId: "facet.ui" as never,
            kind: "ui",
            runtimeKind: "trusted-built-in",
            entryKey: "foundation.text-input",
            requiredCapabilities: [],
            compatibility: {
              definitionVersion: "1.0.0",
              hostApiRange: "=1.0.0",
              deploymentProfiles: ["local-desktop"],
            },
          },
        ],
        packageDigest: digest,
        evidenceArtifacts: [],
        createdAt: "2026-07-17T12:00:00.000Z",
        publishedAt: "2026-07-17T12:00:00.000Z",
        publishedBy: "system",
      }),
    ).toThrow(/exact/);

    expect(() =>
      normalizeAssetImplementationFacet({
        facetId: "facet.bad" as never,
        kind: "logic",
        runtimeKind: "trusted-built-in",
        entryKey: "foundation.bad",
        artifact: {
          artifactId: "artifact.bad" as never,
          kind: "bundle",
          digest,
          mediaType: "application/javascript",
          sizeBytes: 4,
        },
        requiredCapabilities: [],
        compatibility: {
          definitionVersion: "1.0.0",
          hostApiRange: "=1.0.0",
          deploymentProfiles: ["local-desktop"],
        },
      }),
    ).toThrow(/closed entry key/);
  });
});
