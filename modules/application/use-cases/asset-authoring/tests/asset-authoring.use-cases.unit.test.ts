import test from 'node:test';
import assert from 'node:assert/strict';
import { CreateAssetDraftUseCase, CreateWorkspaceAuthoredAssetUseCase, PublishAssetDraftUseCase, UpdateAssetDraftUseCase } from '../use-cases';

const ws='ws1' as any;

test('create draft requires workspace and persists', async()=>{
  const saved:any[]=[];
  const uc=new CreateAssetDraftUseCase({assetDraftRepository:{saveAssetDraftRecord:async(r:any)=>{saved.push(r);return r;},updateAssetDraftRecord:async(r:any)=>r,readAssetDraftRecord:async()=>undefined,listAssetDraftRecords:async()=>({records:[]})},generateAssetDraftId:()=> 'd1', now:()=> '2026-01-01T00:00:00.000Z'});
  const r=await uc.execute({targetWorkspaceId:ws,draftEditableValues:{'display-name':'Name'}} as any);
  assert.equal(r.kind,'success'); assert.equal(saved.length,1);
});

test('update draft rejects missing', async()=>{
  const uc=new UpdateAssetDraftUseCase({assetDraftRepository:{updateAssetDraftRecord:async(r:any)=>r,readAssetDraftRecord:async()=>undefined,saveAssetDraftRecord:async(r:any)=>r,listAssetDraftRecords:async()=>({records:[]})}} as any);
  const r=await uc.execute({targetWorkspaceId:ws,draftId:'d1',draftEditablePatch:{summary:'x'}} as any);
  assert.equal(r.kind,'failure'); assert.equal((r as any).failure.code,'not-found');
});

test('create authored asset rejects base target', async()=>{
  const uc=new CreateWorkspaceAuthoredAssetUseCase({authoredAssetRepository:{saveAuthoredAssetRecord:async(r:any)=>r,updateAuthoredAssetRecord:async(r:any)=>r,readAuthoredAssetRecordById:async()=>undefined,readAuthoredAssetRecordByWorkspace:async()=>undefined,listAuthoredAssetRecords:async()=>({records:[]}),findAuthoredAssetByBaseReference:async()=>undefined},assetRevisionRepository:{saveAssetRevisionRecord:async(r:any)=>r,readAssetRevisionRecord:async()=>undefined,listAssetRevisionRecords:async()=>({records:[]}),findLatestPublishedAssetRevision:async()=>undefined},generateAuthoredAssetId:()=> 'a1', generateAssetRevisionId:()=> 'r1'});
  const r=await uc.execute({workspaceId:ws,initialEditableValues:{'display-name':'n'},baseTarget:{targetWorkspaceId:ws,sourceKind:"workspace-local-asset",effectiveAssetReference:{kind:"asset-instance",id:"asset.1"}}} as any);
  assert.equal(r.kind,'failure'); assert.equal((r as any).failure.code,'unsupported');
});
test("create authored asset draft persists a current revision", async () => {
  let saved: any;
  let savedRevision: any;
  const uc=new CreateWorkspaceAuthoredAssetUseCase({authoredAssetRepository:{saveAuthoredAssetRecord:async(r:any)=>{saved=r;return r;},updateAuthoredAssetRecord:async(r:any)=>r,readAuthoredAssetRecordById:async()=>undefined,readAuthoredAssetRecordByWorkspace:async()=>undefined,listAuthoredAssetRecords:async()=>({records:[]}),findAuthoredAssetByBaseReference:async()=>undefined},assetRevisionRepository:{saveAssetRevisionRecord:async(r:any)=>{savedRevision=r;return r;},readAssetRevisionRecord:async()=>undefined,listAssetRevisionRecords:async()=>({records:[]}),findLatestPublishedAssetRevision:async()=>undefined},generateAuthoredAssetId:()=> 'a1', generateAssetRevisionId:()=> 'r1'});
  const r=await uc.execute({workspaceId:ws,initialEditableValues:{'display-name':'n'}} as any);
  assert.equal(r.kind,'success');
  assert.equal(saved.status, "draft");
  assert.equal(saved.currentRevisionId, "r1");
  assert.equal(savedRevision.revisionId, "r1");
});

test('publish draft marks published', async()=>{
  let updated:any;
  const draft={draftId:'d1',targetWorkspaceId:ws,draftEditableValues:{'display-name':'n'},status:'draft',provenance:{kind:'authored-from-scratch',operationAt:'2026-01-01T00:00:00.000Z',targetWorkspaceId:ws},createdAt:'2026-01-01T00:00:00.000Z',updatedAt:'2026-01-01T00:00:00.000Z'};
  const uc=new PublishAssetDraftUseCase({assetDraftRepository:{readAssetDraftRecord:async()=>draft as any,updateAssetDraftRecord:async(r:any)=>{updated=r;return r;},saveAssetDraftRecord:async(r:any)=>r,listAssetDraftRecords:async()=>({records:[]})},authoredAssetRepository:{saveAuthoredAssetRecord:async(r:any)=>r,updateAuthoredAssetRecord:async(r:any)=>r,readAuthoredAssetRecordById:async()=>undefined,readAuthoredAssetRecordByWorkspace:async()=>undefined,listAuthoredAssetRecords:async()=>({records:[]}),findAuthoredAssetByBaseReference:async()=>undefined},assetRevisionRepository:{saveAssetRevisionRecord:async(r:any)=>r,readAssetRevisionRecord:async()=>undefined,listAssetRevisionRecords:async()=>({records:[]}),findLatestPublishedAssetRevision:async()=>undefined},generateAuthoredAssetId:()=> 'a1', generateAssetRevisionId:()=> 'r1', now:()=> '2026-01-01T00:00:00.000Z'} as any);
  const r=await uc.execute({targetWorkspaceId:ws,draftId:'d1'} as any);
  assert.equal(r.kind,'success'); assert.equal(updated.status,'published');
});
