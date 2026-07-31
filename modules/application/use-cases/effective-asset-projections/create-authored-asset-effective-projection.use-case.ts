import { normalizeCreateEffectiveAssetProjectionCommand, normalizeEffectiveAssetProjectionId, normalizeEffectiveAssetProjectionRecord, type CreateEffectiveAssetProjectionCommand, type CreateEffectiveAssetProjectionResult } from "../../../contracts/effective-asset-projections";
import type { AuthoredAssetRepositoryPort, AssetRevisionRepositoryPort } from "../../ports/asset-authoring";
import type { EffectiveAssetProjectionRepositoryPort } from "../../ports/effective-asset-projections";
import { mapEditableToProjectedFields } from "./effective-asset-projection-field-mapper.service";
import { createProjectionProvenance } from "./effective-asset-projection-provenance.service";
import { projectionFailure } from "./effective-asset-projection-result-helpers";
import { defaultEffectiveAssetProjectionValidationService } from "./effective-asset-projection-validation.service";
import { defaultEffectiveAssetProjectionDiagnosticsService } from "./effective-asset-projection-diagnostics.service";
import { defaultEffectiveAssetProjectionConflictBlockingService } from "./effective-asset-projection-conflict-blocking.service";

export class CreateAuthoredAssetEffectiveProjectionUseCase {
  constructor(private readonly d:{projectionRepository:EffectiveAssetProjectionRepositoryPort;authoredAssetRepository:AuthoredAssetRepositoryPort;assetRevisionRepository:AssetRevisionRepositoryPort;generateEffectiveAssetProjectionId:()=>string;now?:()=>string;}){}
  async execute(command:CreateEffectiveAssetProjectionCommand):Promise<CreateEffectiveAssetProjectionResult>{
    let c; try{c=normalizeCreateEffectiveAssetProjectionCommand(command);}catch{return projectionFailure("validation","effective-projection-workspace-required");}
    if(c.targetWorkspaceId!==c.source.targetWorkspaceId) return projectionFailure("conflict","effective-projection-source-required");
    if(!["workspace-authored","workspace-authored-revision"].includes(c.source.sourceKind)) return projectionFailure("unsupported","effective-projection-source-unsupported");
    const source = c.source.sourceKind === "workspace-authored-revision"
      ? await this.d.assetRevisionRepository.readAssetRevisionRecord(c.targetWorkspaceId,c.source.authoredAssetId!,c.source.revisionId!)
      : await this.d.authoredAssetRepository.readAuthoredAssetRecordByWorkspace(c.targetWorkspaceId,c.source.authoredAssetId!);
    if(!source) return projectionFailure("not-found","effective-projection-source-missing");
    if(source.status!=="published") return projectionFailure("blocked","effective-projection-conflict-detected");
    const mapped = mapEditableToProjectedFields((source as any).editableValues);
    const now=(this.d.now??(()=>new Date().toISOString()))();
    let projectionId; try{projectionId=normalizeEffectiveAssetProjectionId(this.d.generateEffectiveAssetProjectionId());}catch{return projectionFailure("internal","effective-projection-materialization-unavailable");}
    const record = normalizeEffectiveAssetProjectionRecord({projectionId,targetWorkspaceId:c.targetWorkspaceId,source:c.source,target:c.target,sourceKind:c.source.sourceKind,effectiveAssetReference:c.target.effectiveAssetReference,sourceAssetReference:c.source.sourceAssetReference,status:mapped.blocked?"blocked":"ready",policy:mapped.blocked?"blocked":"safe-fields-only",projectedFields:mapped.projectedFields,diagnostics:mapped.diagnostics,blockers:mapped.blockers,provenance:createProjectionProvenance(c.targetWorkspaceId,c.source,now),createdAt:now,updatedAt:now,materializedAt:now});
    try{return {status:"success",value:await this.d.projectionRepository.saveEffectiveAssetProjectionRecord(record)};}catch{return projectionFailure("unavailable","effective-projection-materialization-unavailable");}
  }
}
