import path from "node:path";
import {composeInternalAssetRegistry} from "../../../../modules/hosts/shared/composition/composeInternalAssetRegistry";
import {createLocalModelRegistryAdapter} from "../../../../modules/adapters/persistence/model/createLocalModelRegistryAdapter";
import type {StructuredDocumentStore} from "../../../../modules/adapters/persistence/shared";
import {createWorkspaceId} from "../../../../modules/contracts/workspace";
import {captureImageHostFixture,IMAGE_HOST_WORKSPACE_NAME,type ImageHostFixture} from "./image-generation-host-oracles";

/** Trusted prelaunch composition. This creates input records, never tasks or results. */
export async function seedImageInputRecords(options:{rootDirectory:string;checkpointDirectory:string;documents:StructuredDocumentStore;fixture:ImageHostFixture}):Promise<string>{
  const {rootDirectory,checkpointDirectory,documents}=options,f=options.fixture;
  const captured=captureImageHostFixture(JSON.stringify(f),f.runId,f.sourceRevision,f.host,f.journey);
  if(!captured||!documents.organizationId||!path.isAbsolute(rootDirectory)||!path.isAbsolute(checkpointDirectory))throw new Error("Image input records require their scoped prelaunch store.");
  const workspaceId=createWorkspaceId(captured.workspaceId);
  const composition=composeInternalAssetRegistry({rootDirectory,documents});
  if(await composition.workspaceRepositories.workspaceRepository.readWorkspace(workspaceId))throw new Error("Image input records require a fresh workspace.");
  const created=await composition.workspaceUseCases.createWorkspace.execute({command:{displayName:IMAGE_HOST_WORKSPACE_NAME},organizationId:documents.organizationId,generateWorkspaceId:()=>workspaceId,selectAfterCreate:true});
  if(created.status!=="created"||created.workspace?.workspaceId!==workspaceId)throw new Error("Image input workspace creation failed.");
  const registry=createLocalModelRegistryAdapter({filePath:path.join(rootDirectory,"model-registry/models.json"),rootDirectory,documents,discovery:{enabled:false}});
  const result=await registry.registerDownloadedModel({workspaceId,modelRecordId:captured.modelRecordId,displayName:"Image qualification checkpoint",source:"local",provider:"unknown",
    localPath:checkpointDirectory,artifactForm:"checkpoint",inferenceMode:"text-to-image",taskTags:["text-to-image"],serializationFormat:"safetensors",metadata:{checkpointFile:captured.checkpointFileName}});
  if(result.model.modelRecordId!==captured.modelRecordId||result.model.workspaceId!==workspaceId)throw new Error("Image input model registration failed.");
  return JSON.stringify(captured);
}
