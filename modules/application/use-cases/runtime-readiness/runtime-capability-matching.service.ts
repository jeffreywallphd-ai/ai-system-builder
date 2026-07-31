import { normalizeRuntimeBindingCandidate, type RuntimeBindingCandidate, type RuntimeInventory, type RuntimeProviderAvailabilityStatus, type RuntimeReadinessBlocker, type RuntimeReadinessDiagnostic, type RuntimeRequirement } from "../../../contracts/runtime-readiness";

const blockedStatuses = new Set<RuntimeProviderAvailabilityStatus>(["unavailable","not-installed","not-configured","permission-required","unsupported","stale","unknown","error"]);
const toMatchStatus = (status: RuntimeProviderAvailabilityStatus): RuntimeBindingCandidate["matchStatus"] => status === "available" ? "matched" : status === "unsupported" ? "unsupported" : status === "unknown" ? "unknown" : "provider-unavailable";

export class RuntimeCapabilityMatchingService {
  public match(input: { inventory: readonly RuntimeInventory[]; requirements: readonly RuntimeRequirement[]; targetWorkspaceId: RuntimeRequirement["targetWorkspaceId"]; nextBindingCandidateId: () => RuntimeBindingCandidate["bindingCandidateId"]; now: string }) {
    const candidates: RuntimeBindingCandidate[] = [];
    const blockers: RuntimeReadinessBlocker[] = [];
    const diagnostics: RuntimeReadinessDiagnostic[] = [];
    const providerCandidates = input.inventory.flatMap((record) => record.discoveredProviderCandidates);
    const allCapabilities = input.inventory.flatMap((record) => record.discoveredCapabilities);
    for (const requirement of input.requirements) {
      const providerMatches = providerCandidates.flatMap((provider) => provider.capabilities.filter((c) => c.capabilityKind === requirement.capabilityKind && c.capabilityKey === requirement.capabilityKey).map((capability) => ({ provider, capability })));
      const topLevelMatches = allCapabilities.filter((c) => c.capabilityKind === requirement.capabilityKind && c.capabilityKey === requirement.capabilityKey);
      if (providerMatches.length === 0 && topLevelMatches.length === 0) {
        (requirement.isRequired ? blockers : diagnostics).push({ code: "runtime-readiness-capability-missing", ...(requirement.isRequired ? {} : { severity: "warning" as const }), message: "Sanitized runtime capability diagnostic." } as any);
        continue;
      }
      for (const match of providerMatches) {
        const status = match.capability.availabilityStatus === "available" ? match.provider.availabilityStatus : match.capability.availabilityStatus;
        const cBlockers: RuntimeReadinessBlocker[] = [];
        const cDiagnostics: RuntimeReadinessDiagnostic[] = [];
        if (blockedStatuses.has(status)) {
          cBlockers.push({ code: status === "not-installed" ? "runtime-readiness-provider-not-installed" : status === "not-configured" ? "runtime-readiness-provider-not-configured" : status === "permission-required" ? "runtime-readiness-provider-permission-required" : status === "unsupported" ? "runtime-readiness-capability-unsupported" : "runtime-readiness-provider-unavailable", message: "Sanitized runtime provider/capability blocker." });
          cDiagnostics.push({ code: "runtime-readiness-provider-unavailable", severity: "warning", message: "Sanitized runtime provider/capability diagnostic." });
        }
        candidates.push(normalizeRuntimeBindingCandidate({ bindingCandidateId: input.nextBindingCandidateId(), targetWorkspaceId: input.targetWorkspaceId, requirementId: requirement.requirementId, providerCandidateId: match.provider.providerCandidateId, capabilityId: match.capability.capabilityId, matchStatus: toMatchStatus(status), blockers: cBlockers, diagnostics: cDiagnostics, createdAt: input.now, updatedAt: input.now }));
      }
      if (providerMatches.length === 0 && topLevelMatches.length > 0) diagnostics.push({ code: "runtime-readiness-provider-missing", severity: "warning", message: "Sanitized top-level capability diagnostic." });
    }
    return { candidates, blockers, diagnostics, providerCandidates };
  }
}
