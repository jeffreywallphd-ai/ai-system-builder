import type { RuntimeBinding, RuntimeBindingStatus, RuntimeProviderAvailabilityStatus, RuntimeReadinessBinding, RuntimeReadinessBlocker, RuntimeReadinessDiagnostic, RuntimeReadinessDiagnosticCode, RuntimeReadinessStatus } from "../../../contracts/runtime-readiness";

const statusPriority: RuntimeReadinessStatus[] = [
  "invalid", "blocked", "missing-requirements", "provider-unavailable", "provider-unsupported", "configuration-required", "permission-required", "stale", "ready-for-setup", "draft",
];

const pushBlocker = (list: RuntimeReadinessBlocker[], code: RuntimeReadinessBlocker["code"], message: string, safeDetails?: Record<string, string>) => {
  list.push({ code, message, ...(safeDetails ? { safeDetails } : {}) });
};
const pushDiagnostic = (list: RuntimeReadinessDiagnostic[], code: RuntimeReadinessDiagnostic["code"], severity: RuntimeReadinessDiagnostic["severity"], message: string) => {
  list.push({ code, severity, message });
};

const requiredStatusMap: Record<RuntimeProviderAvailabilityStatus, { status: RuntimeReadinessStatus; code: RuntimeReadinessDiagnosticCode }> = {
  available: { status: "ready-for-setup", code: "runtime-readiness-execution-deferred" },
  unavailable: { status: "provider-unavailable", code: "runtime-readiness-provider-unavailable" },
  "not-installed": { status: "provider-unavailable", code: "runtime-readiness-provider-not-installed" },
  unsupported: { status: "provider-unsupported", code: "runtime-readiness-capability-unsupported" },
  "not-configured": { status: "configuration-required", code: "runtime-readiness-provider-not-configured" },
  "permission-required": { status: "permission-required", code: "runtime-readiness-provider-permission-required" },
  stale: { status: "stale", code: "runtime-readiness-inventory-stale" },
  unknown: { status: "provider-unavailable", code: "runtime-readiness-provider-unavailable" },
  error: { status: "provider-unavailable", code: "runtime-readiness-service-unavailable" },
};

const toBindingStatus = (status: RuntimeReadinessStatus): RuntimeBindingStatus => {
  if (status === "provider-unsupported") return "unsupported";
  if (status === "missing-requirements") return "missing-requirement";
  if (status === "ready-for-setup") return "selected";
  if (status === "draft" || status === "checking" || status === "archived") return "candidate";
  return status;
};

export class RuntimeReadinessValidationService {
  public validate(binding: RuntimeReadinessBinding, targetWorkspaceId: string): { status: RuntimeReadinessStatus; blockers: RuntimeReadinessBlocker[]; diagnostics: RuntimeReadinessDiagnostic[]; bindings: readonly RuntimeBinding[] } {
    const blockers: RuntimeReadinessBlocker[] = [];
    const diagnostics: RuntimeReadinessDiagnostic[] = [];

    if (binding.targetWorkspaceId !== targetWorkspaceId) pushBlocker(blockers, "runtime-readiness-workspace-invalid", "Readiness binding workspace mismatch.");
    if (!binding.compositionPlanId) pushBlocker(blockers, "runtime-readiness-composition-plan-required", "Readiness binding does not reference a composition plan.");

    const requirementsById = new Map(binding.requirements.map((item) => [item.requirementId, item]));
    const providersById = new Map(binding.providerCandidates.map((item) => [item.providerCandidateId, item]));
    const candidatesByRequirement = new Map<string, RuntimeReadinessBinding["bindingCandidates"][number][]>();

    const evaluateAvailability = (requirementId: string, isRequired: boolean, scope: "provider" | "capability", availabilityStatus: RuntimeProviderAvailabilityStatus) => {
      const mapped = requiredStatusMap[availabilityStatus];
      if (mapped.status === "ready-for-setup") return;
      const message = mapped.code === "runtime-readiness-service-unavailable" ? `${scope} availability check failed with sanitized error.` : `Required ${scope} is ${availabilityStatus}.`;
      if (isRequired) pushBlocker(blockers, mapped.code, message, { requirementId });
      else pushDiagnostic(diagnostics, mapped.code, "warning", `Optional ${scope} is ${availabilityStatus}.`);
    };

    for (const candidate of binding.bindingCandidates) {
      if (!candidatesByRequirement.has(candidate.requirementId)) candidatesByRequirement.set(candidate.requirementId, []);
      candidatesByRequirement.get(candidate.requirementId)?.push(candidate);
      const requirement = requirementsById.get(candidate.requirementId);
      const provider = providersById.get(candidate.providerCandidateId);
      if (!requirement) pushBlocker(blockers, "runtime-readiness-requirement-missing", "Binding candidate references unknown requirement.");
      if (!provider) pushBlocker(blockers, "runtime-readiness-provider-missing", "Binding candidate references unknown provider candidate.");
      const capability = provider?.capabilities.find((item) => item.capabilityId === candidate.capabilityId);
      if (candidate.capabilityId && !capability) pushBlocker(blockers, "runtime-readiness-capability-missing", "Binding candidate references unknown capability.");
      if (requirement && provider) {
        evaluateAvailability(requirement.requirementId, requirement.isRequired, "provider", provider.availabilityStatus);
        if (capability) evaluateAvailability(requirement.requirementId, requirement.isRequired, "capability", capability.availabilityStatus);
      }
    }

    const nextBindings = binding.bindings.map((item) => {
      const requirement = requirementsById.get(item.requirementId);
      const provider = providersById.get(item.selectedProviderCandidateId);
      const selectedCandidate = binding.bindingCandidates.find((candidate) => candidate.requirementId === item.requirementId && candidate.providerCandidateId === item.selectedProviderCandidateId && candidate.capabilityId === item.selectedCapabilityId);
      const capability = provider?.capabilities.find((entry) => entry.capabilityId === item.selectedCapabilityId);
      let status = item.status;

      if (!requirement) { pushBlocker(blockers, "runtime-readiness-requirement-missing", "Selected binding references unknown requirement."); status = "invalid"; }
      if (!provider) { pushBlocker(blockers, "runtime-readiness-provider-missing", "Selected binding references unknown provider candidate."); status = "invalid"; }
      if (item.selectedCapabilityId && !capability) { pushBlocker(blockers, "runtime-readiness-capability-missing", "Selected binding references unknown capability."); status = "invalid"; }
      if (!selectedCandidate) { pushBlocker(blockers, "runtime-readiness-binding-candidate-missing", "Selected binding does not map to a known binding candidate."); status = "invalid"; }

      if (requirement && provider) {
        evaluateAvailability(requirement.requirementId, requirement.isRequired, "provider", provider.availabilityStatus);
        if (capability) evaluateAvailability(requirement.requirementId, requirement.isRequired, "capability", capability.availabilityStatus);
        const providerStatus = requiredStatusMap[provider.availabilityStatus].status;
        const capabilityStatus = capability ? requiredStatusMap[capability.availabilityStatus].status : "provider-unavailable";
        if (providerStatus !== "ready-for-setup") status = toBindingStatus(providerStatus);
        else if (capabilityStatus !== "ready-for-setup") status = toBindingStatus(capabilityStatus);
      }
      return { ...item, status };
    });

    for (const requirement of binding.requirements) {
      if (requirement.targetWorkspaceId !== binding.targetWorkspaceId) pushBlocker(blockers, "runtime-readiness-workspace-invalid", "Requirement workspace mismatch.");
      if (requirement.compositionPlanId !== binding.compositionPlanId) pushBlocker(blockers, "runtime-readiness-composition-plan-not-valid", "Requirement composition plan mismatch.");
      const candidates = candidatesByRequirement.get(requirement.requirementId) ?? [];
      const selected = nextBindings.filter((entry) => entry.requirementId === requirement.requirementId && ["selected", "bound"].includes(entry.status));
      if (candidates.length === 0) {
        if (requirement.isRequired) pushBlocker(blockers, "runtime-readiness-capability-missing", "Required capability has no runtime candidate.", { capabilityKey: requirement.capabilityKey });
        else pushDiagnostic(diagnostics, "runtime-readiness-capability-missing", "warning", "Optional capability has no runtime candidate.");
      }
      if (selected.length > 1 && requirement.isRequired) pushBlocker(blockers, "runtime-readiness-binding-candidate-missing", "Conflicting selected bindings found for one required capability.");
      if (requirement.isRequired && candidates.length > 0 && selected.length === 0) {
        const hasSpecificRequirementBlocker = blockers.some((blocker) => blocker.safeDetails?.requirementId === requirement.requirementId);
        if (!hasSpecificRequirementBlocker) pushBlocker(blockers, "runtime-readiness-provider-unavailable", "Required capability has candidates but no safe selected binding.");
      }
      if (!requirement.isRequired && candidates.length > 1 && selected.length === 0) pushDiagnostic(diagnostics, "runtime-readiness-binding-candidate-missing", "warning", "Optional capability has ambiguous unselected candidates.");
    }

    const hasCode = (...codes: string[]) => blockers.some((entry) => codes.includes(entry.code));
    const has = (status: RuntimeReadinessStatus) => ({
      invalid: hasCode("runtime-readiness-workspace-invalid", "runtime-readiness-requirement-missing", "runtime-readiness-provider-missing"),
      blocked: hasCode("runtime-readiness-composition-plan-not-valid", "runtime-readiness-composition-plan-missing", "runtime-readiness-composition-plan-required"),
      "missing-requirements": hasCode("runtime-readiness-capability-missing", "runtime-readiness-model-missing"),
      "provider-unavailable": hasCode("runtime-readiness-provider-unavailable", "runtime-readiness-provider-not-installed", "runtime-readiness-service-unavailable"),
      "provider-unsupported": hasCode("runtime-readiness-capability-unsupported"),
      "configuration-required": hasCode("runtime-readiness-configuration-required", "runtime-readiness-provider-not-configured"),
      "permission-required": hasCode("runtime-readiness-permission-required", "runtime-readiness-provider-permission-required"),
      stale: hasCode("runtime-readiness-inventory-stale", "runtime-readiness-composition-plan-stale"),
      "ready-for-setup": false,
      draft: false,
      checking: false,
      archived: false,
    }[status]);

    const requiredIds = binding.requirements.filter((entry) => entry.isRequired).map((entry) => entry.requirementId);
    const allRequiredSafe = requiredIds.every((requirementId) => nextBindings.some((entry) => entry.requirementId === requirementId && ["selected", "bound"].includes(entry.status)));
    const status = statusPriority.find((entry) => entry === "ready-for-setup" ? blockers.length === 0 && allRequiredSafe : has(entry)) ?? "draft";

    return { status, blockers, diagnostics, bindings: nextBindings };
  }
}
