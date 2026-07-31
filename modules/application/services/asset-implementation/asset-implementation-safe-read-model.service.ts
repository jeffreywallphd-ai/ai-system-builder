import type {
  AssetImplementationRelease,
  AssetImplementationReleaseSummary,
  AssetImplementationRevocation,
} from "../../../contracts/asset-implementation";

export function toAssetImplementationReleaseSummary(
  release: AssetImplementationRelease,
  revocations: readonly AssetImplementationRevocation[] = [],
): AssetImplementationReleaseSummary {
  return {
    releaseId: release.releaseId,
    definitionRef: release.definitionRef,
    version: release.version,
    status: release.status,
    trustLevel: release.trustLevel,
    facetKinds: [...new Set(release.facets.map((facet) => facet.kind))].sort(),
    packageDigest: release.packageDigest,
    publishedAt: release.publishedAt,
    revoked: revocations.some(
      (revocation) => revocation.releaseId === release.releaseId,
    ),
  };
}

export function assertSafeAssetImplementationReadModel(value: unknown): void {
  const serialized = JSON.stringify(value);
  if (
    /(?:sourceCode|storageKey|localPath|absolutePath|contentBase64|\bbytes\b|secret|token|apiKey|commandLine|environment)/i.test(
      serialized,
    )
  ) {
    throw new Error(
      "Asset implementation read model contains private implementation data.",
    );
  }
}
