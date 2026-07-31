import {
  normalizeRefreshEffectiveAssetProjectionCommand,
  type EffectiveAssetProjectionPolicy,
  type EffectiveAssetProjectionStatus,
  type RefreshEffectiveAssetProjectionCommand,
  type RefreshEffectiveAssetProjectionResult,
} from "../../../contracts/effective-asset-projections";
import type { AssetCustomizationTargetReaderPort, AssetOverrideRepositoryPort } from "../../ports/asset-authoring";
import type { EffectiveAssetProjectionRepositoryPort } from "../../ports/effective-asset-projections";
import { mapEditableToProjectedFields } from "./effective-asset-projection-field-mapper.service";
import { createProjectionProvenance } from "./effective-asset-projection-provenance.service";
import { projectionFailure } from "./effective-asset-projection-result-helpers";
import { defaultEffectiveAssetProjectionValidationService } from "./effective-asset-projection-validation.service";
import { deriveOverrideProjectionStatus } from "./effective-asset-override-projection-status.service";
import { defaultEffectiveAssetProjectionDiagnosticsService } from "./effective-asset-projection-diagnostics.service";

const SUPPORTED = new Set(["workspace-customized","linked-with-workspace-override","copied-with-workspace-override","imported-with-workspace-override","system-derived-override"]);

export class RefreshOverrideEffectiveProjectionUseCase {
  constructor(private readonly d:{projectionRepository:EffectiveAssetProjectionRepositoryPort;assetOverrideRepository:AssetOverrideRepositoryPort;targetReader:AssetCustomizationTargetReaderPort;now?:()=>string;}){}
  async execute(command:RefreshEffectiveAssetProjectionCommand):Promise<RefreshEffectiveAssetProjectionResult>{
    let c; try{c=normalizeRefreshEffectiveAssetProjectionCommand(command);}catch{return projectionFailure("validation","effective-projection-workspace-required");}
    const existing=await this.d.projectionRepository.readEffectiveAssetProjectionRecord(c.targetWorkspaceId,c.projectionId); if(!existing) return projectionFailure("not-found","effective-projection-source-missing");
    if(!SUPPORTED.has(existing.sourceKind)) return projectionFailure("unsupported","effective-projection-source-unsupported");
    const overrideId = existing.source.overrideId; if(!overrideId) return projectionFailure("validation","effective-projection-source-required");
    const o=await this.d.assetOverrideRepository.readAssetOverrideRecord(c.targetWorkspaceId, overrideId);
    const now=(this.d.now??(()=>new Date().toISOString()))();
    if(!o) {
      const projection = {
        ...existing,
        status: "source-missing" as const,
        policy: "blocked" as const,
        projectedFields: {},
        diagnostics: [defaultEffectiveAssetProjectionDiagnosticsService.createDiagnostic("effective-projection-source-missing")],
        blockers: [defaultEffectiveAssetProjectionDiagnosticsService.createBlocker("effective-projection-source-missing")],
        provenance: createProjectionProvenance(c.targetWorkspaceId, existing.source, now),
        updatedAt: now,
        materializedAt: now,
      };
      try{return {status:"success",value:await this.d.projectionRepository.updateEffectiveAssetProjectionRecord(projection)};}catch{return projectionFailure("unavailable","effective-projection-materialization-unavailable");}
    }
    const target=await this.d.targetReader.readCustomizationTargetByReference(c.targetWorkspaceId,existing.target.effectiveAssetReference);
    const validation = defaultEffectiveAssetProjectionValidationService.validate({targetWorkspaceId:c.targetWorkspaceId,sourceWorkspaceId:o.targetWorkspaceId,sourceKind:existing.sourceKind,policy:existing.policy,targetReaderAvailable:Boolean(target),targetReferenceCompatible:Boolean(target && target.effectiveAssetReference.id===o.customizationTarget.effectiveAssetReference.id && target.effectiveAssetReference.kind===o.customizationTarget.effectiveAssetReference.kind),sourceRelationshipCompatible:o.customizationTarget.sourceKind===target?.sourceKind,baseVersionCompatible:!o.baseRevision || o.baseRevision===target?.currentBaseRevision,overrideConflictOpen:o.conflictStatus==="open",sourceStatus:o.status==="active"?"published":o.status==="archived"?"archived":"disabled"});
    const statusModel=deriveOverrideProjectionStatus(o);
    const mapped = statusModel.status === "ready" ? mapEditableToProjectedFields(o.overrideValues) : {projectedFields:{},diagnostics:[],blockers:[],blocked:false};
    const status: EffectiveAssetProjectionStatus = !validation.ok ? (validation.code==="effective-projection-materialization-unavailable"?"blocked":"conflicted") : mapped.blocked?"blocked":statusModel.status;
    const policy: EffectiveAssetProjectionPolicy = status==="ready"?"safe-fields-only":"blocked";
    const projection = {...existing,status,policy,projectedFields:status==="ready"?mapped.projectedFields:{},diagnostics:validation.ok?mapped.diagnostics:defaultEffectiveAssetProjectionValidationService.asDiagnostics(validation.code).diagnostics,blockers:validation.ok?mapped.blockers:defaultEffectiveAssetProjectionValidationService.asDiagnostics(validation.code).blockers,provenance:createProjectionProvenance(c.targetWorkspaceId,existing.source,now),updatedAt:now,materializedAt:now};
    try{return {status:"success",value:await this.d.projectionRepository.updateEffectiveAssetProjectionRecord(projection)};}catch{return projectionFailure("unavailable","effective-projection-materialization-unavailable");}
  }
}
