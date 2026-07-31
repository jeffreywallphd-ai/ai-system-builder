import {
  normalizeAssetImplementationRelease,
  type AssetImplementationBuild,
  type AssetImplementationDiagnostic,
  type AssetImplementationRelease,
} from "../../../contracts/asset-implementation";

export interface AssetImplementationReleaseValidationResult {
  readonly valid: boolean;
  readonly release?: AssetImplementationRelease;
  readonly diagnostics: readonly AssetImplementationDiagnostic[];
}

export function validateAssetImplementationRelease(
  candidate: AssetImplementationRelease,
  sourceBuild?: AssetImplementationBuild,
): AssetImplementationReleaseValidationResult {
  try {
    const release = normalizeAssetImplementationRelease(candidate);
    const diagnostics: AssetImplementationDiagnostic[] = [];

    if (
      release.trustLevel !== "system-trusted" &&
      (!release.sourceSnapshotId || !release.sourceBuildId)
    ) {
      diagnostics.push({
        severity: "error",
        code: "implementation.release.source-evidence-required",
        message:
          "Authored and imported releases require an exact source snapshot and successful build.",
      });
    }
    if (
      release.sourceBuildId &&
      (!sourceBuild ||
        sourceBuild.buildId !== release.sourceBuildId ||
        sourceBuild.status !== "succeeded")
    ) {
      diagnostics.push({
        severity: "error",
        code: "implementation.release.build-not-succeeded",
        message: "The referenced implementation build is not successful.",
      });
    }
    if (
      sourceBuild &&
      release.sourceSnapshotId !== sourceBuild.sourceSnapshotId
    ) {
      diagnostics.push({
        severity: "error",
        code: "implementation.release.source-mismatch",
        message: "Release and build source snapshots do not match.",
      });
    }
    if (
      release.trustLevel === "system-trusted" &&
      release.facets.some(
        (facet) =>
          facet.runtimeKind !== "trusted-built-in" &&
          facet.runtimeKind !== "declarative-engine",
      )
    ) {
      diagnostics.push({
        severity: "error",
        code: "implementation.release.system-trust-runtime-invalid",
        message:
          "System-trusted releases may use only closed built-in or declarative engine entries.",
      });
    }

    return {
      valid: diagnostics.every((item) => item.severity !== "error"),
      release,
      diagnostics,
    };
  } catch {
    return {
      valid: false,
      diagnostics: [
        {
          severity: "error",
          code: "implementation.release.invalid",
          message: "Implementation release metadata is invalid.",
        },
      ],
    };
  }
}
