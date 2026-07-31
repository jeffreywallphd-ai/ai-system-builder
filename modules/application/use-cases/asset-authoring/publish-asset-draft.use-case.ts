import { normalizeAuthoredAssetDraftRecord, normalizeAuthoredAssetRecord, normalizePublishAssetDraftCommand, normalizeAuthoredAssetId, type PublishAssetDraftCommand, type PublishAssetDraftResult } from "../../../contracts/asset-authoring";
import type { AssetDraftRepositoryPort, AssetRevisionRepositoryPort, AuthoredAssetRepositoryPort } from "../../ports/asset-authoring";
import { fail } from "./asset-authoring-use-case-results";
import { detectExpectedBaseRevisionConflict } from "./asset-authoring-conflict.service";
import { createPublishedRevisionFromDraft, normalizeGeneratedRevisionId } from "./asset-authoring-versioning.service";
import { createEditedAuthoredAssetProvenance } from "./asset-authoring-provenance.service";
const nowIso=()=>new Date().toISOString();
export interface PublishAssetDraftUseCaseDependencies { assetDraftRepository: AssetDraftRepositoryPort; authoredAssetRepository: AuthoredAssetRepositoryPort; assetRevisionRepository: AssetRevisionRepositoryPort; now?:()=>string; generateAuthoredAssetId:()=>string; generateAssetRevisionId:()=>string; }
export class PublishAssetDraftUseCase { constructor(private readonly d:PublishAssetDraftUseCaseDependencies){}
async execute(command:PublishAssetDraftCommand):Promise<PublishAssetDraftResult>{ let c; try{c=normalizePublishAssetDraftCommand(command);}catch{return fail("validation","Publish asset draft command is invalid.");}
let draft; try{draft=await this.d.assetDraftRepository.readAssetDraftRecord(c.targetWorkspaceId,c.draftId);}catch{return fail("unavailable","Unable to read asset draft record.");}
if(!draft) return fail("not-found","Asset draft was not found."); if(draft.status!=="draft") return fail("conflict","Draft status is not publishable.");
const conflict=detectExpectedBaseRevisionConflict(c.expectedBaseRevision,draft.baseAssetReference?.version); if(conflict) return fail("conflict",conflict.message);
const at=(this.d.now??nowIso)(); let authoredAssetId; try{authoredAssetId=normalizeAuthoredAssetId(this.d.generateAuthoredAssetId());}catch{return fail("internal","Generated identifier is invalid.");}
const revisionId=normalizeGeneratedRevisionId(this.d.generateAssetRevisionId); if(revisionId.kind==="failure") return revisionId;
const revision=createPublishedRevisionFromDraft({draft,revisionId:revisionId.value,authoredAssetId,now:at,revisionLabel:"1"}); if(revision.kind==="failure") return revision;
const authored=normalizeAuthoredAssetRecord({authoredAssetId,workspaceId:c.targetWorkspaceId,assetReference:{kind:"asset-instance",id:authoredAssetId as never,version:"1.0.0"},currentRevisionId:revision.value.revisionId,status:"published",editableValues:draft.draftEditableValues,provenance:createEditedAuthoredAssetProvenance(c.targetWorkspaceId,at),createdAt:at,updatedAt:at});
try{await this.d.assetRevisionRepository.saveAssetRevisionRecord(revision.value); await this.d.authoredAssetRepository.saveAuthoredAssetRecord(authored); await this.d.assetDraftRepository.updateAssetDraftRecord(normalizeAuthoredAssetDraftRecord({...draft,status:"published",updatedAt:at}));}catch{return fail("unavailable","Unable to publish draft due to persistence failure.");}
return {kind:"success",value:revision.value}; }
}
