import type {
  AssetImplementationBinding,
  AssetImplementationDiagnostic,
  AssetImplementationRelease,
  AssetImplementationResolutionRequest,
  AssetImplementationResolutionResult,
  AssetImplementationRevocation,
} from "../../../contracts/asset-implementation";
import { toAssetImplementationReleaseSummary } from "./asset-implementation-safe-read-model.service";

interface Candidate {
  readonly binding: AssetImplementationBinding;
  readonly release: AssetImplementationRelease;
}

export function resolveAssetImplementation(
  request: AssetImplementationResolutionRequest,
  bindings: readonly AssetImplementationBinding[],
  releases: readonly AssetImplementationRelease[],
  revocations: readonly AssetImplementationRevocation[],
): AssetImplementationResolutionResult {
  const exactBindings = bindings.filter(
    (binding) =>
      binding.status === "active" &&
      (!binding.workspaceId || binding.workspaceId === request.workspaceId) &&
      sameDefinition(binding.definitionRef, request.definitionRef) &&
      (!request.lockedReleaseId ||
        binding.releaseId === request.lockedReleaseId),
  );
  if (exactBindings.length === 0)
    return result(
      request,
      "unimplemented",
      "implementation.binding.missing",
      "No active implementation binding is available.",
    );

  const releaseById = new Map(
    releases.map((release) => [release.releaseId, release]),
  );
  const candidates: Candidate[] = exactBindings.flatMap((binding) => {
    const release = releaseById.get(binding.releaseId);
    return release ? [{ binding, release }] : [];
  });
  if (candidates.length === 0)
    return result(
      request,
      "unimplemented",
      "implementation.release.missing",
      "Active bindings do not reference an available release.",
    );

  const revokedIds = new Set(revocations.map((item) => item.releaseId));
  const notRevoked = candidates.filter(
    ({ release }) => !revokedIds.has(release.releaseId),
  );
  if (notRevoked.length === 0)
    return result(
      request,
      "revoked",
      "implementation.release.revoked",
      "Every bound implementation release is revoked.",
    );

  const trusted = notRevoked.filter(({ release }) =>
    request.permittedTrustLevels.includes(release.trustLevel),
  );
  if (trusted.length === 0)
    return result(
      request,
      "blocked",
      "implementation.trust.denied",
      "Available implementation releases are not permitted by trust policy.",
    );

  const compatible = trusted.filter(({ release }) =>
    release.facets.some(
      (facet) =>
        facet.compatibility.deploymentProfiles.includes(
          request.deploymentProfile,
        ) &&
        isVersionInRange(
          request.hostApiVersion,
          facet.compatibility.hostApiRange,
        ) &&
        (!facet.compatibility.runtimeAbiRange ||
          (!!request.runtimeAbiVersion &&
            isVersionInRange(
              request.runtimeAbiVersion,
              facet.compatibility.runtimeAbiRange,
            ))),
    ),
  );
  if (compatible.length === 0)
    return result(
      request,
      "incompatible",
      "implementation.compatibility.none",
      "No implementation release is compatible with this deployment profile and host API.",
    );

  const withFacets = compatible.filter(({ release }) =>
    request.requiredFacets.every((kind) =>
      release.facets.some((facet) => facet.kind === kind),
    ),
  );
  if (withFacets.length === 0)
    return result(
      request,
      "incompatible",
      "implementation.facets.missing",
      "No compatible release provides every required implementation facet.",
    );

  const withCapabilities = withFacets.filter(({ release }) =>
    release.facets
      .filter((facet) => request.requiredFacets.includes(facet.kind))
      .every((facet) =>
        facet.requiredCapabilities.every((capability) =>
          request.availableCapabilities.includes(capability),
        ),
      ),
  );
  if (withCapabilities.length === 0)
    return result(
      request,
      "setup-required",
      "implementation.capability.missing",
      "A compatible implementation exists but required host capabilities are unavailable.",
    );

  const distinct =
    deduplicateCandidates(withCapabilities).sort(compareCandidates);
  const selected = distinct[0];
  if (!selected)
    return result(
      request,
      "blocked",
      "implementation.resolution.failed",
      "Implementation resolution failed.",
    );
  const next = distinct[1];
  if (
    next &&
    compareCandidateRank(selected, next) === 0 &&
    selected.release.releaseId !== next.release.releaseId
  ) {
    return result(
      request,
      "blocked",
      "implementation.resolution.ambiguous",
      "Multiple equally preferred implementation releases are available.",
    );
  }

  return {
    status: "ready",
    definitionRef: request.definitionRef,
    selectedRelease: toAssetImplementationReleaseSummary(
      selected.release,
      revocations,
    ),
    selectedFacets: request.requiredFacets.map((kind) =>
      selected.release.facets.find((facet) => facet.kind === kind)!,
    ),
    diagnostics: [],
  };
}

function result(
  request: AssetImplementationResolutionRequest,
  status: AssetImplementationResolutionResult["status"],
  code: string,
  message: string,
): AssetImplementationResolutionResult {
  const diagnostics: readonly AssetImplementationDiagnostic[] = [
    { severity: "error", code, message },
  ];
  return {
    status,
    definitionRef: request.definitionRef,
    selectedFacets: [],
    diagnostics,
  };
}

function sameDefinition(
  left: { kind: string; id: string; version?: string },
  right: { kind: string; id: string; version?: string },
): boolean {
  return (
    left.kind === "asset-definition-version" &&
    right.kind === "asset-definition-version" &&
    left.id === right.id &&
    left.version === right.version
  );
}

function deduplicateCandidates(candidates: readonly Candidate[]): Candidate[] {
  const byRelease = new Map<string, Candidate>();
  for (const candidate of candidates) {
    const current = byRelease.get(candidate.release.releaseId);
    if (!current || candidate.binding.priority > current.binding.priority)
      byRelease.set(candidate.release.releaseId, candidate);
  }
  return [...byRelease.values()];
}

function compareCandidates(left: Candidate, right: Candidate): number {
  const rank = compareCandidateRank(left, right);
  return (
    rank ||
    String(left.release.releaseId).localeCompare(
      String(right.release.releaseId),
    )
  );
}

function compareCandidateRank(left: Candidate, right: Candidate): number {
  if (left.binding.priority !== right.binding.priority)
    return right.binding.priority - left.binding.priority;
  const version = compareVersions(right.release.version, left.release.version);
  if (version !== 0) return version;
  return (
    trustRank(right.release.trustLevel) - trustRank(left.release.trustLevel)
  );
}

function trustRank(value: AssetImplementationRelease["trustLevel"]): number {
  return value === "system-trusted"
    ? 3
    : value === "organization-approved"
      ? 2
      : 1;
}

export function compareVersions(left: string, right: string): number {
  const a = parseVersion(left);
  const b = parseVersion(right);
  for (let index = 0; index < 3; index += 1) {
    const difference = a[index]! - b[index]!;
    if (difference) return difference;
  }
  return 0;
}

export function isVersionInRange(version: string, range: string): boolean {
  const clauses = range.trim().split(/\s+/).filter(Boolean);
  return clauses.every((clause) => {
    const match = /^(>=|<=|>|<|=|\^|~)?(\d+\.\d+\.\d+)$/.exec(clause);
    if (!match) return false;
    const operator = match[1] ?? "=";
    const target = match[2]!;
    const comparison = compareVersions(version, target);
    if (operator === ">=") return comparison >= 0;
    if (operator === "<=") return comparison <= 0;
    if (operator === ">") return comparison > 0;
    if (operator === "<") return comparison < 0;
    if (operator === "^")
      return (
        comparison >= 0 && parseVersion(version)[0] === parseVersion(target)[0]
      );
    if (operator === "~")
      return (
        comparison >= 0 &&
        parseVersion(version).slice(0, 2).join(".") ===
          parseVersion(target).slice(0, 2).join(".")
      );
    return comparison === 0;
  });
}

function parseVersion(value: string): readonly [number, number, number] {
  const match = /^(\d+)\.(\d+)\.(\d+)/.exec(value);
  if (!match) return [0, 0, 0];
  return [Number(match[1]), Number(match[2]), Number(match[3])];
}
