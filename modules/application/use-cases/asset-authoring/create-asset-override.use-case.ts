import { normalizeAssetOverrideId, normalizeAssetOverrideRecord, normalizeCreateAssetOverrideCommand, type AssetAuthoringFailure, type CreateAssetOverrideCommand, type CreateAssetOverrideResult } from "../../../contracts/asset-authoring";
import type { AssetCustomizationTargetReaderPort, AssetOverrideRepositoryPort } from "../../ports/asset-authoring";
import { detectExpectedBaseRevisionConflict } from "./asset-authoring-conflict.service";
import { mapOverrideScopeForSourceKind, validateOverrideTargetSemantics } from "./asset-authoring-use-case-safety";
import { createCustomizedDetachedUserLibraryCopyProvenance, createCustomizedLinkedUserLibraryAssetProvenance, createCustomizedWorkspaceImportProvenance, createDerivedFromWorkspaceLocalAssetProvenance, createEditedAuthoredAssetProvenance, createSystemDerivedOverrideProvenance } from "./asset-authoring-provenance.service";
const nowIso = () => new Date().toISOString();
const fail = (code: AssetAuthoringFailure["code"], message: string): CreateAssetOverrideResult => ({ kind: "failure", failure: { code, message } });

const provenanceFor = (sourceKind: CreateAssetOverrideCommand["target"]["sourceKind"], workspaceId: CreateAssetOverrideCommand["targetWorkspaceId"], operationAt: string, sourceWorkspaceId?: CreateAssetOverrideCommand["targetWorkspaceId"]) => {
  if (sourceKind === "workspace-local-asset") return createDerivedFromWorkspaceLocalAssetProvenance(workspaceId, operationAt, sourceWorkspaceId);
  if (sourceKind === "user-library-linked-asset") return createCustomizedLinkedUserLibraryAssetProvenance(workspaceId, operationAt, sourceWorkspaceId);
  if (sourceKind === "user-library-copied-asset") return createCustomizedDetachedUserLibraryCopyProvenance(workspaceId, operationAt, sourceWorkspaceId);
  if (sourceKind === "workspace-imported-asset") return createCustomizedWorkspaceImportProvenance(workspaceId, operationAt, sourceWorkspaceId);
  if (sourceKind === "system-owned-asset") return createSystemDerivedOverrideProvenance(workspaceId, operationAt, sourceWorkspaceId);
  return createEditedAuthoredAssetProvenance(workspaceId, operationAt);
};
export interface CreateAssetOverrideUseCaseDependencies { assetOverrideRepository: AssetOverrideRepositoryPort; targetReader: AssetCustomizationTargetReaderPort; now?: () => string; generateAssetOverrideId: () => string; }
export class CreateAssetOverrideUseCase { constructor(private readonly d: CreateAssetOverrideUseCaseDependencies) {}
  async execute(command: CreateAssetOverrideCommand): Promise<CreateAssetOverrideResult> {
    let c; try { c = normalizeCreateAssetOverrideCommand(command); } catch { return fail("validation", "Create asset override command is invalid."); }
    if (c.targetWorkspaceId !== c.target.targetWorkspaceId) return fail("validation", "Target workspace id must match command workspace id.");
    if (c.target.sourceKind === "customized-asset") return fail("unsupported", "Customized-asset target chaining is deferred.");
    let found; try { found = await this.d.targetReader.readCustomizationTargetByReference(c.targetWorkspaceId, c.target.effectiveAssetReference); } catch { return fail("unavailable", "Customization target reader is unavailable."); }
    if (!found) return fail("not-found", "Customization target relationship was not found.");
    const invalid = validateOverrideTargetSemantics(c.target, found); if (invalid) return fail(invalid.includes("deferred") ? "unsupported" : "conflict", invalid);
    if (c.target.sourceKind === "system-owned-asset" && mapOverrideScopeForSourceKind(c.target.sourceKind) !== "system-derived") return fail("validation", "System-owned target requires system-derived override scope.");
    const baseConflict = detectExpectedBaseRevisionConflict(c.baseRevision, found.currentBaseRevision ?? c.target.baseRevision); if (baseConflict) return fail("conflict", baseConflict.message);
    const existing = await this.d.assetOverrideRepository.findActiveOverrideForTarget(c.targetWorkspaceId, c.target.effectiveAssetReference); if (existing) return fail("conflict", "An active override already exists for the customization target.");
    const at = (this.d.now ?? nowIso)(); let overrideId; try { overrideId = normalizeAssetOverrideId(this.d.generateAssetOverrideId()); } catch { return fail("internal", "Generated override identifier is invalid."); }
    const record = normalizeAssetOverrideRecord({ overrideId, targetWorkspaceId: c.targetWorkspaceId, customizationTarget: c.target, baseAssetReference: c.target.effectiveAssetReference, baseRevision: c.baseRevision ?? c.target.baseRevision, overrideScope: mapOverrideScopeForSourceKind(c.target.sourceKind), overrideValues: c.overrideValues, status: "active", provenance: provenanceFor(c.target.sourceKind, c.targetWorkspaceId, at, found.sourceWorkspaceId), createdAt: at, updatedAt: at });
    try { return { kind: "success", value: await this.d.assetOverrideRepository.saveAssetOverrideRecord(record) }; } catch { return fail("unavailable", "Unable to persist asset override record."); }
  }
}
