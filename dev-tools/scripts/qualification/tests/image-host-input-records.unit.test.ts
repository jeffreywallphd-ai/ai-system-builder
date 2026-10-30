import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import {createInMemoryStructuredDocumentStore} from "../../../../modules/adapters/persistence/shared";
import {createOrganizationId} from "../../../../modules/contracts/organization";
import {createWorkspaceId} from "../../../../modules/contracts/workspace";
import {createLocalModelRegistryAdapter} from "../../../../modules/adapters/persistence/model/createLocalModelRegistryAdapter";
import {seedImageInputRecords} from "../visual-composer/image-host-input-records";
import {captureImageHostFixture,imageHostWorkspace,imageHostModelRecord,type ImageHost,type ImageJourney} from "../visual-composer/image-generation-host-oracles";
const run="image-records-synthetic-20261029",source="source."+"a".repeat(64),root=path.resolve(".local-codex/t/image-records-synthetic");
function fixture(host:ImageHost,journey:ImageJourney){return captureImageHostFixture(JSON.stringify({schemaVersion:"image-host-fixture-v1",runId:run,sourceRevision:source,host,journey,
  workspaceId:imageHostWorkspace(run,host,journey),modelRecordId:imageHostModelRecord(run,host,journey),checkpointFileName:"synthetic.safetensors",checkpointSha256:"b".repeat(64)}),run,source,host,journey)!;}
test("both hosts and cases retain distinct scoped input models without results or cross-workspace leakage",async()=>{
  const all=createInMemoryStructuredDocumentStore(),documents=all.forOrganization(createOrganizationId("qualification.local"));
  for(const host of ["packaged-desktop","thin-chrome"] as const)for(const journey of ["create-register","task-recovery"] as const){
    const f=fixture(host,journey),options={rootDirectory:root,checkpointDirectory:path.join(root,"inputs"),documents,fixture:f};
    assert.deepEqual(JSON.parse(await seedImageInputRecords(options)),f);
    const registry=createLocalModelRegistryAdapter({rootDirectory:root,filePath:path.join(root,"models.json"),documents,discovery:{enabled:false}});
    const models=await registry.listModels({workspaceId:createWorkspaceId(f.workspaceId),includeDiscovered:false});
    assert.equal(models.models.length,1);assert.equal(models.models[0]!.modelRecordId,f.modelRecordId);assert.equal(models.models[0]!.lifecycleStatus,"downloaded");
    assert.equal(models.models[0]!.metadata?.checkpointFile,"synthetic.safetensors");
    await assert.rejects(seedImageInputRecords(options),/fresh workspace/);
  }
  const namespaces=await documents.listNamespaces();assert.equal(namespaces.some(name=>/task|artifact|result/.test(name)),false);
  const foreign=all.forOrganization(createOrganizationId("qualification.other"));assert.deepEqual(await foreign.listNamespaces(),[]);
});
test("unscoped stores and foreign declarations fail before input writes",async()=>{
  const documents=createInMemoryStructuredDocumentStore(),f=fixture("thin-chrome","create-register");
  await assert.rejects(seedImageInputRecords({rootDirectory:root,checkpointDirectory:root,documents,fixture:f}));assert.deepEqual(await documents.listNamespaces(),[]);
  await assert.rejects(seedImageInputRecords({rootDirectory:root,checkpointDirectory:root,documents:documents.forOrganization(createOrganizationId("qualification.local")),fixture:{...f,modelRecordId:"model.foreign"}}));
  assert.deepEqual(await documents.forOrganization(createOrganizationId("qualification.local")).listNamespaces(),[]);
});
