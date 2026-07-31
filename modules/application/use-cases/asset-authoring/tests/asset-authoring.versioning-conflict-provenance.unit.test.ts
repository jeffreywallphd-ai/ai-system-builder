import test from "node:test";
import assert from "node:assert/strict";
import { CreateWorkspaceAuthoredAssetUseCase, PublishAssetDraftUseCase, CreateAssetOverrideUseCase, UpdateAssetOverrideUseCase } from "..";

const ws = "ws1" as any;

test("publish draft rejects expected base mismatch", async () => {
  const draft = { draftId:"d1", targetWorkspaceId:ws, baseAssetReference:{ kind:"asset-instance", id:"asset.a", version:"2" }, draftEditableValues:{ summary:"x" }, status:"draft", provenance:{ kind:"authored-from-scratch", targetWorkspaceId:ws, operationAt:"2026-01-01T00:00:00.000Z" }, createdAt:"2026-01-01T00:00:00.000Z", updatedAt:"2026-01-01T00:00:00.000Z" } as any;
  const uc = new PublishAssetDraftUseCase({ assetDraftRepository:{ readAssetDraftRecord: async()=>draft, updateAssetDraftRecord: async(r:any)=>r, saveAssetDraftRecord: async(r:any)=>r, listAssetDraftRecords: async()=>({records:[]}) }, authoredAssetRepository:{ saveAuthoredAssetRecord: async(r:any)=>r, updateAuthoredAssetRecord: async(r:any)=>r, readAuthoredAssetRecordById: async()=>undefined, readAuthoredAssetRecordByWorkspace: async()=>undefined, listAuthoredAssetRecords: async()=>({records:[]}), findAuthoredAssetByBaseReference: async()=>undefined }, assetRevisionRepository:{ saveAssetRevisionRecord: async(r:any)=>r, readAssetRevisionRecord: async()=>undefined, listAssetRevisionRecords: async()=>({records:[]}), findLatestPublishedAssetRevision: async()=>undefined }, generateAuthoredAssetId:()=>"a1", generateAssetRevisionId:()=>"r1" } as any);
  const result = await uc.execute({ targetWorkspaceId: ws, draftId:"d1", expectedBaseRevision:"1" } as any);
  assert.equal(result.kind, "failure");
  assert.equal((result as any).failure.code, "conflict");
});

test("create authored asset uses authored-from-scratch provenance and invalid generated revision id fails", async () => {
  const uc = new CreateWorkspaceAuthoredAssetUseCase({authoredAssetRepository:{saveAuthoredAssetRecord:async(r:any)=>r,updateAuthoredAssetRecord:async(r:any)=>r,readAuthoredAssetRecordById:async()=>undefined,readAuthoredAssetRecordByWorkspace:async()=>undefined,listAuthoredAssetRecords:async()=>({records:[]}),findAuthoredAssetByBaseReference:async()=>undefined},assetRevisionRepository:{saveAssetRevisionRecord:async(r:any)=>r,readAssetRevisionRecord:async()=>undefined,listAssetRevisionRecords:async()=>({records:[]}),findLatestPublishedAssetRevision:async()=>undefined},generateAuthoredAssetId:()=>"a1",generateAssetRevisionId:()=>" "} as any);
  const fail = await uc.execute({ workspaceId: ws, initialEditableValues: {"display-name":"n"} } as any);
  assert.equal(fail.kind, "failure");
});

test("override create/update detect base revision mismatch", async () => {
  const create = new CreateAssetOverrideUseCase({ assetOverrideRepository:{ saveAssetOverrideRecord: async(r:any)=>r, updateAssetOverrideRecord:async(r:any)=>r, readAssetOverrideRecord:async()=>undefined, listAssetOverrideRecords:async()=>({records:[]}), findActiveOverrideForTarget:async()=>undefined, listConflictedOverridesByWorkspace:async()=>[] }, targetReader:{ readCustomizationTargetByReference: async()=>({ targetWorkspaceId:ws, sourceKind:"workspace-local-asset", effectiveAssetReference:{kind:"asset-instance",id:"a",version:"1.0.0"}, baseRevision:"2" }) }, generateAssetOverrideId:()=>"o1" } as any);
  const r = await create.execute({ targetWorkspaceId: ws, target:{ targetWorkspaceId:ws, sourceKind:"workspace-local-asset", effectiveAssetReference:{kind:"asset-instance",id:"a",version:"1.0.0"}, baseRevision:"2" }, baseRevision:"1", overrideValues:{ summary:"x" } } as any);
  assert.equal(r.kind, "failure");

  const update = new UpdateAssetOverrideUseCase({ assetOverrideRepository:{ saveAssetOverrideRecord: async(r:any)=>r, updateAssetOverrideRecord: async(r:any)=>r, readAssetOverrideRecord: async()=>({ overrideId:"o1", targetWorkspaceId:ws, customizationTarget:{ targetWorkspaceId:ws, sourceKind:"workspace-local-asset", effectiveAssetReference:{kind:"asset-instance",id:"a",version:"1.0.0"} }, baseAssetReference:{kind:"asset-instance",id:"a",version:"1.0.0"}, baseRevision:"2", overrideScope:"workspace-local", overrideValues:{}, status:"active", provenance:{ kind:"derived-from-workspace-local-asset", operationAt:"2026-01-01T00:00:00.000Z" }, createdAt:"2026-01-01T00:00:00.000Z", updatedAt:"2026-01-01T00:00:00.000Z" }), listAssetOverrideRecords:async()=>({records:[]}), findActiveOverrideForTarget:async()=>undefined, listConflictedOverridesByWorkspace:async()=>[] } } as any);
  const u = await update.execute({ targetWorkspaceId: ws, overrideId:"o1", expectedBaseRevision:"1", overrideValues:{ summary:"z" } } as any);
  assert.equal(u.kind, "failure");
  assert.equal((u as any).failure.code, "conflict");
});
