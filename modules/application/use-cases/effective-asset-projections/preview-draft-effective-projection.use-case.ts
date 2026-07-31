import { normalizeCreateEffectiveAssetProjectionCommand, normalizeEffectiveAssetProjectionId, normalizeEffectiveAssetProjectionRecord, type CreateEffectiveAssetProjectionResult, type PreviewDraftEffectiveAssetProjectionCommand } from "../../../contracts/effective-asset-projections";
import type { AssetDraftRepositoryPort } from "../../ports/asset-authoring";
import { mapEditableToProjectedFields } from "./effective-asset-projection-field-mapper.service";
import { createProjectionProvenance } from "./effective-asset-projection-provenance.service";
import { projectionFailure } from "./effective-asset-projection-result-helpers";
import { defaultEffectiveAssetProjectionConflictBlockingService } from "./effective-asset-projection-conflict-blocking.service";
import { defaultEffectiveAssetProjectionValidationService } from "./effective-asset-projection-validation.service";

export class PreviewDraftEffectiveAssetProjectionUseCase { constructor(private readonly d:{assetDraftRepository:AssetDraftRepositoryPort;generateEffectiveAssetProjectionId:()=>string;now?:()=>string;}){}
async execute(command:PreviewDraftEffectiveAssetProjectionCommand):Promise<CreateEffectiveAssetProjectionResult>{
if(command.policy!=="draft-preview-only") return projectionFailure("validation","effective-projection-policy-unsupported");
const draft=await this.d.assetDraftRepository.readAssetDraftRecord(command.targetWorkspaceId,command.source.draftId!); if(!draft) return projectionFailure("not-found","effective-projection-source-missing");
const mapped=mapEditableToProjectedFields(draft.draftEditableValues); const now=(this.d.now??(()=>new Date().toISOString()))();
let projectionId; try{projectionId=normalizeEffectiveAssetProjectionId(this.d.generateEffectiveAssetProjectionId());}catch{return projectionFailure("validation","effective-projection-source-required");}
const c=normalizeCreateEffectiveAssetProjectionCommand({targetWorkspaceId:command.targetWorkspaceId,source:command.source,target:{targetWorkspaceId:command.targetWorkspaceId,effectiveAssetReference:command.source.effectiveAssetReference!,intendedPolicy:"draft-preview-only"},policy:"draft-preview-only"});
const validation = defaultEffectiveAssetProjectionValidationService.validate({targetWorkspaceId:c.targetWorkspaceId,sourceWorkspaceId:draft.targetWorkspaceId,sourceKind:c.source.sourceKind,policy:"draft-preview-only",sourceStatus:"draft",projectedFieldsBlocked:mapped.blocked});
const classified = defaultEffectiveAssetProjectionConflictBlockingService.classify({draftOnly:true,unsafeField:mapped.blocked});
const code = validation.ok ? classified.code : validation.code;
const diagnosticsAndBlockers = code ? defaultEffectiveAssetProjectionValidationService.asDiagnostics(code) : { diagnostics: mapped.diagnostics, blockers: mapped.blockers };
const record = normalizeEffectiveAssetProjectionRecord({projectionId,targetWorkspaceId:c.targetWorkspaceId,source:c.source,target:c.target,sourceKind:c.source.sourceKind,effectiveAssetReference:c.target.effectiveAssetReference,status:"draft-only",policy:"draft-preview-only",projectedFields:mapped.projectedFields,diagnostics:diagnosticsAndBlockers.diagnostics,blockers:diagnosticsAndBlockers.blockers,provenance:createProjectionProvenance(c.targetWorkspaceId,c.source,now),createdAt:now,updatedAt:now,materializedAt:now});
return {status:"success",value:record};
}}
