import { normalizeRuntimeBinding, type RuntimeBinding, type RuntimeBindingCandidate, type RuntimeReadinessDiagnostic, type RuntimeRequirement } from "../../../contracts/runtime-readiness";

export class RuntimeBindingCandidateSelectionService {
  public select(input: { readinessBindingId: RuntimeBinding["readinessBindingId"]; targetWorkspaceId: RuntimeBinding["targetWorkspaceId"]; requirements: readonly RuntimeRequirement[]; candidates: readonly RuntimeBindingCandidate[]; nextBindingId: () => RuntimeBinding["bindingId"]; now: string }) {
    const bindings: RuntimeBinding[] = [];
    const diagnostics: RuntimeReadinessDiagnostic[] = [];
    for (const requirement of input.requirements.filter((item) => item.isRequired)) {
      const matches = input.candidates.filter((candidate) => candidate.requirementId === requirement.requirementId);
      const selectable = matches.filter((m) => m.matchStatus === "matched" && m.blockers.length === 0);
      if (matches.length > 1) diagnostics.push({ code: "runtime-readiness-binding-candidate-missing", severity: "warning", message: "Sanitized binding ambiguity diagnostic." });
      if (selectable.length === 1 && matches.length === 1) {
        bindings.push(normalizeRuntimeBinding({ bindingId: input.nextBindingId(), targetWorkspaceId: input.targetWorkspaceId, readinessBindingId: input.readinessBindingId, requirementId: requirement.requirementId, selectedProviderCandidateId: selectable[0].providerCandidateId, selectedCapabilityId: selectable[0].capabilityId, status: "selected", diagnostics: [], blockers: [], provenance: [], createdAt: input.now, updatedAt: input.now }));
      } else if (matches.length === 0 || selectable.length === 0) {
        diagnostics.push({ code: "runtime-readiness-binding-candidate-missing", severity: "warning", message: "Sanitized required binding candidate not selected diagnostic." });
      }
    }
    return { bindings, diagnostics };
  }
}
