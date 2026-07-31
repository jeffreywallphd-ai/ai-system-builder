import { normalizeAuthoredAssetDraftRecord, normalizeUpdateAssetDraftCommand, type UpdateAssetDraftCommand, type UpdateAssetDraftResult } from "../../../contracts/asset-authoring";
import type { AssetDraftRepositoryPort } from "../../ports/asset-authoring";
import { fail } from "./asset-authoring-use-case-results";
const nowIso = () => new Date().toISOString();
export interface UpdateAssetDraftUseCaseDependencies { assetDraftRepository: AssetDraftRepositoryPort; now?:()=>string; }
export class UpdateAssetDraftUseCase { constructor(private readonly d:UpdateAssetDraftUseCaseDependencies){}
async execute(command:UpdateAssetDraftCommand):Promise<UpdateAssetDraftResult>{ let c; try{ c=normalizeUpdateAssetDraftCommand(command);}catch{return fail("validation","Update asset draft command is invalid.");}
let found; try{found=await this.d.assetDraftRepository.readAssetDraftRecord(c.targetWorkspaceId,c.draftId);}catch{return fail("unavailable","Unable to read asset draft record.");}
if(!found) return fail("not-found","Asset draft was not found."); if(found.status!=="draft") return fail("conflict","Draft status is not editable.");
const updated=normalizeAuthoredAssetDraftRecord({...found,draftEditableValues:{...found.draftEditableValues,...c.draftEditablePatch},updatedAt:(this.d.now??nowIso)()});
try{return {kind:"success",value:await this.d.assetDraftRepository.updateAssetDraftRecord(updated)};}catch{return fail("unavailable","Unable to update asset draft record.");}}
}
