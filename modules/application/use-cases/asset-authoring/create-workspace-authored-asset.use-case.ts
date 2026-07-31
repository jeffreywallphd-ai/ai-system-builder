import { normalizeAuthoredAssetId, normalizeCreateWorkspaceAuthoredAssetCommand, normalizeSafeAssetEditableFieldPatch, normalizeAuthoredAssetRecord, normalizeAuthoredAssetRevisionRecord, type CreateWorkspaceAuthoredAssetCommand, type CreateWorkspaceAuthoredAssetResult } from "../../../contracts/asset-authoring";
import type { AssetRevisionRepositoryPort, AuthoredAssetRepositoryPort } from "../../ports/asset-authoring";
import { fail } from "./asset-authoring-use-case-results";
import { createAuthoredFromScratchProvenance } from "./asset-authoring-provenance.service";
import { normalizeGeneratedRevisionId } from "./asset-authoring-versioning.service";

const nowIso = () => new Date().toISOString();
export interface CreateWorkspaceAuthoredAssetUseCaseDependencies { authoredAssetRepository: AuthoredAssetRepositoryPort; assetRevisionRepository: AssetRevisionRepositoryPort; now?:()=>string; generateAuthoredAssetId:()=>string; generateAssetRevisionId:()=>string; }
export class CreateWorkspaceAuthoredAssetUseCase {
  constructor(private readonly d:CreateWorkspaceAuthoredAssetUseCaseDependencies){}
  async execute(command:CreateWorkspaceAuthoredAssetCommand):Promise<CreateWorkspaceAuthoredAssetResult>{
    let c; try { c=normalizeCreateWorkspaceAuthoredAssetCommand(command);} catch { return fail("validation","Create workspace authored asset command is invalid."); }
    if (c.baseTarget) return fail("unsupported","Derived/base-target authored asset creation is deferred.");
    const at=(this.d.now??nowIso)();
    let authoredAssetId; try { authoredAssetId=normalizeAuthoredAssetId(this.d.generateAuthoredAssetId()); } catch { return fail("internal","Generated identifier is invalid."); }
    const revisionId=normalizeGeneratedRevisionId(this.d.generateAssetRevisionId); if(revisionId.kind==="failure") return revisionId;
    let revision; try{revision=normalizeAuthoredAssetRevisionRecord({revisionId:revisionId.value,workspaceId:c.workspaceId,authoredAssetId,revision:"1",status:"draft",editableValues:normalizeSafeAssetEditableFieldPatch(c.initialEditableValues),provenance:createAuthoredFromScratchProvenance(c.workspaceId,at),createdAt:at,updatedAt:at});}catch{return fail("internal","Generated revision is invalid.");}
    const authored=normalizeAuthoredAssetRecord({authoredAssetId,workspaceId:c.workspaceId,assetReference:{kind:"asset-instance",id:authoredAssetId as never,version:"1.0.0",label:c.initialEditableValues["display-name"] as string|undefined},currentRevisionId:revision.revisionId,status:"draft",editableValues:normalizeSafeAssetEditableFieldPatch(c.initialEditableValues),provenance:createAuthoredFromScratchProvenance(c.workspaceId,at),createdAt:at,updatedAt:at});
    try { await this.d.assetRevisionRepository.saveAssetRevisionRecord(revision); await this.d.authoredAssetRepository.saveAuthoredAssetRecord(authored);} catch { return fail("unavailable","Unable to persist authored asset record."); }
    return {kind:"success",value:authored};
  }
}
