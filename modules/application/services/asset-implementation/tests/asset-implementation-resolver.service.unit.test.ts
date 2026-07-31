import { describe, expect, it } from "../../../../testing/node-test";
import { createWorkspaceId } from "../../../../contracts/workspace";
import type {
  AssetImplementationBinding,
  AssetImplementationRelease,
  AssetImplementationResolutionRequest,
} from "../../../../contracts/asset-implementation";
import { resolveAssetImplementation } from "../asset-implementation-resolver.service";

const workspaceId = createWorkspaceId("workspace-a");
const definitionRef = {
  kind: "asset-definition-version",
  id: "system.text-input",
  version: "1.0.0",
} as const;
const digest = `sha256:${"a".repeat(64)}`;

function release(
  id: string,
  version: string,
  overrides: Partial<AssetImplementationRelease> = {},
): AssetImplementationRelease {
  return {
    releaseId: id as never,
    definitionRef: definitionRef as never,
    version,
    status: "published",
    trustLevel: "system-trusted",
    facets: [
      {
        facetId: `facet.${id}` as never,
        kind: "ui",
        runtimeKind: "trusted-built-in",
        entryKey: `foundation.${id}`,
        requiredCapabilities: [],
        compatibility: {
          definitionVersion: "1.0.0",
          hostApiRange: ">=1.0.0 <2.0.0",
          deploymentProfiles: ["local-desktop", "thin-client"],
        },
      },
    ],
    packageDigest: digest,
    evidenceArtifacts: [],
    createdAt: "2026-07-17T12:00:00.000Z",
    publishedAt: "2026-07-17T12:00:00.000Z",
    publishedBy: "system",
    ...overrides,
  };
}

function binding(
  id: string,
  releaseId: string,
  priority = 100,
): AssetImplementationBinding {
  return {
    bindingId: id as never,
    definitionRef: definitionRef as never,
    releaseId: releaseId as never,
    status: "active",
    priority,
    revision: 1,
    createdAt: "2026-07-17T12:00:00.000Z",
    updatedAt: "2026-07-17T12:00:00.000Z",
    approvedBy: "system",
  };
}

function request(
  overrides: Partial<AssetImplementationResolutionRequest> = {},
): AssetImplementationResolutionRequest {
  return {
    workspaceId,
    definitionRef: definitionRef as never,
    requiredFacets: ["ui"],
    deploymentProfile: "local-desktop",
    availableCapabilities: [],
    permittedTrustLevels: ["system-trusted"],
    hostApiVersion: "1.2.0",
    ...overrides,
  };
}

describe("asset implementation resolver", () => {
  it("selects the highest compatible release at equal priority and honors exact locks", () => {
    const releases = [
      release("release.v1", "1.0.0"),
      release("release.v2", "1.1.0"),
    ];
    const bindings = [
      binding("binding.v1", "release.v1"),
      binding("binding.v2", "release.v2"),
    ];
    expect(
      resolveAssetImplementation(request(), bindings, releases, [])
        .selectedRelease?.releaseId,
    ).toBe("release.v2");
    expect(
      resolveAssetImplementation(
        request({ lockedReleaseId: "release.v1" as never }),
        bindings,
        releases,
        [],
      ).selectedRelease?.releaseId,
    ).toBe("release.v1");
  });

  it("blocks ambiguity, revocation, incompatibility, and missing setup truthfully", () => {
    const sameVersion = [
      release("release.a", "1.0.0"),
      release("release.b", "1.0.0"),
    ];
    const sameRank = [
      binding("binding.a", "release.a"),
      binding("binding.b", "release.b"),
    ];
    expect(
      resolveAssetImplementation(request(), sameRank, sameVersion, []).status,
    ).toBe("blocked");

    expect(
      resolveAssetImplementation(
        request(),
        [binding("binding.a", "release.a")],
        [sameVersion[0]!],
        [
          {
            revocationId: "revoke.a" as never,
            releaseId: "release.a" as never,
            reasonCode: "unsafe",
            message: "Unsafe release.",
            revokedAt: "2026-07-17T13:00:00.000Z",
            revokedBy: "security",
          },
        ],
      ).status,
    ).toBe("revoked");

    expect(
      resolveAssetImplementation(
        request({ deploymentProfile: "cloud-server" }),
        sameRank.slice(0, 1),
        sameVersion.slice(0, 1),
        [],
      ).status,
    ).toBe("incompatible");

    const requiresCapability = release("release.setup", "1.0.0", {
      facets: [
        {
          ...sameVersion[0]!.facets[0]!,
          facetId: "facet.setup" as never,
          requiredCapabilities: ["asset.preview"],
        },
      ],
    });
    expect(
      resolveAssetImplementation(
        request(),
        [binding("binding.setup", "release.setup")],
        [requiresCapability],
        [],
      ).status,
    ).toBe("setup-required");
  });
});
