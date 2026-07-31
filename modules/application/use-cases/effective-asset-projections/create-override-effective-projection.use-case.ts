import { normalizeCreateEffectiveAssetProjectionCommand, normalizeEffectiveAssetProjectionId, normalizeEffectiveAssetProjectionRecord, type CreateEffectiveAssetProjectionCommand, type CreateEffectiveAssetProjectionResult } from "../../../contracts/effective-asset-projections";
import type { AssetCustomizationTargetReaderPort, AssetOverrideRepositoryPort } from "../../ports/asset-authoring";
import type { EffectiveAssetProjectionRepositoryPort } from "../../ports/effective-asset-projections";
import { mapEditableToProjectedFields } from "./effective-asset-projection-field-mapper.service";
import { createProjectionProvenance } from "./effective-asset-projection-provenance.service";
import { projectionFailure } from "./effective-asset-projection-result-helpers";
import { defaultEffectiveAssetProjectionValidationService } from "./effective-asset-projection-validation.service";
import { defaultEffectiveAssetProjectionDiagnosticsService } from "./effective-asset-projection-diagnostics.service";
import { defaultEffectiveAssetProjectionConflictBlockingService } from "./effective-asset-projection-conflict-blocking.service";
import { deriveOverrideProjectionStatus } from "./effective-asset-override-projection-status.service";

const SUPPORTED = new Set(["workspace-customized","linked-with-workspace-override","copied-with-workspace-override","imported-with-workspace-override","system-derived-override"]);

export class CreateOverrideEffectiveProjectionUseCase {
  constructor(private readonly d:{projectionRepository:EffectiveAssetProjectionRepositoryPort;assetOverrideRepository:AssetOverrideRepositoryPort;targetReader:AssetCustomizationTargetReaderPort;generateEffectiveAssetProjectionId:()=>string;now?:()=>string;}){}
  async execute(command:CreateEffectiveAssetProjectionCommand):Promise<CreateEffectiveAssetProjectionResult>{
    let c; try{c=normalizeCreateEffectiveAssetProjectionCommand(command);}catch{return projectionFailure("validation","effective-projection-workspace-required");}
    if(!SUPPORTED.has(c.source.sourceKind)) return projectionFailure("unsupported","effective-projection-source-unsupported");
    if(!c.targetWorkspaceId) return projectionFailure("validation","effective-projection-workspace-required");
    const overrideId = c.source.overrideId; if(!overrideId) return projectionFailure("validation","effective-projection-source-required");
    const o = await this.d.assetOverrideRepository.readAssetOverrideRecord(c.targetWorkspaceId, overrideId); if(!o) return projectionFailure("not-found","effective-projection-source-missing");
    if(o.targetWorkspaceId!==c.targetWorkspaceId) return projectionFailure("conflict","effective-projection-source-required");
    const target = await this.d.targetReader.readCustomizationTargetByReference(c.targetWorkspaceId, c.target.effectiveAssetReference);
    if(!target) return projectionFailure("blocked","effective-projection-source-missing");
    if(target.targetWorkspaceId!==c.targetWorkspaceId || target.effectiveAssetReference.id!==o.customizationTarget.effectiveAssetReference.id) return projectionFailure("conflict","effective-projection-conflict-detected");
    const statusModel = deriveOverrideProjectionStatus(o);
    const mapped = statusModel.status === "ready" ? mapEditableToProjectedFields(o.overrideValues) : { projectedFields:{},diagnostics:[],blockers:[],blocked:false };
    const now=(this.d.now??(()=>new Date().toISOString()))();
    let projectionId; try{projectionId=normalizeEffectiveAssetProjectionId(this.d.generateEffectiveAssetProjectionId());}catch{return projectionFailure("internal","effective-projection-materialization-unavailable");}
    const blocked = mapped.blocked || statusModel.status !== "ready";
    const status = mapped.blocked ? "blocked" : statusModel.status;
    const record = normalizeEffectiveAssetProjectionRecord({projectionId,targetWorkspaceId:c.targetWorkspaceId,source:c.source,target:c.target,sourceKind:c.source.sourceKind,effectiveAssetReference:c.target.effectiveAssetReference,sourceAssetReference:c.source.sourceAssetReference,status,policy:blocked?"blocked":statusModel.policy,projectedFields: mapped.blocked?{}:mapped.projectedFields,diagnostics:statusModel.diagnosticCode?[defaultEffectiveAssetProjectionDiagnosticsService.createDiagnostic(statusModel.diagnosticCode)]:mapped.diagnostics,blockers:statusModel.diagnosticCode?[defaultEffectiveAssetProjectionDiagnosticsService.createBlocker(statusModel.diagnosticCode)]:mapped.blockers,provenance:createProjectionProvenance(c.targetWorkspaceId,c.source,now),createdAt:now,updatedAt:now,materializedAt:now});
    try{return {status:"success",value:await this.d.projectionRepository.saveEffectiveAssetProjectionRecord(record)};}catch{return projectionFailure("unavailable","effective-projection-materialization-unavailable");}
  }
}
