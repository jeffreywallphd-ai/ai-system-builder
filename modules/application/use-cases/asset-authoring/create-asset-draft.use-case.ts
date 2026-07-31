import { normalizeAssetDraftId, normalizeAuthoredAssetDraftRecord, normalizeCreateAssetDraftCommand, type CreateAssetDraftCommand, type CreateAssetDraftResult } from "../../../contracts/asset-authoring";
import type { AssetDraftRepositoryPort } from "../../ports/asset-authoring";
import { fail } from "./asset-authoring-use-case-results";
import { createAuthoredFromScratchProvenance } from "./asset-authoring-provenance.service";
const nowIso = () => new Date().toISOString();
export interface CreateAssetDraftUseCaseDependencies { assetDraftRepository: AssetDraftRepositoryPort; now?:()=>string; generateAssetDraftId:()=>string; }
export class CreateAssetDraftUseCase { constructor(private readonly d:CreateAssetDraftUseCaseDependencies){}
async execute(command:CreateAssetDraftCommand):Promise<CreateAssetDraftResult>{ let c; try{ c=normalizeCreateAssetDraftCommand(command);}catch{return fail("validation","Create asset draft command is invalid.");}
if(c.baseTarget) return fail("unsupported","Draft base-target creation is deferred."); const at=(this.d.now??nowIso)();
let draft; try{draft=normalizeAuthoredAssetDraftRecord({draftId:normalizeAssetDraftId(this.d.generateAssetDraftId()),targetWorkspaceId:c.targetWorkspaceId,draftEditableValues:c.draftEditableValues,status:"draft",provenance:createAuthoredFromScratchProvenance(c.targetWorkspaceId,at),createdAt:at,updatedAt:at});}catch{return fail("internal","Generated identifier is invalid.");}
try{return {kind:"success",value:await this.d.assetDraftRepository.saveAssetDraftRecord(draft)};}catch{return fail("unavailable","Unable to persist asset draft record.");}}
}
