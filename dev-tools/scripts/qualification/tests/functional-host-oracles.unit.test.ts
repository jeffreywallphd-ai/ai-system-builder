import test from "node:test";
import assert from "node:assert/strict";
import {FUNCTIONAL_REFERENCE_MODEL,MODEL_REFERENCE_PHASES,captureModelReferenceInventory,functionalHostIdentity,modelReferenceHostReport} from "../visual-composer/functional-host-oracles";
import {readFunctionalModelInventoryInBrowser} from "../visual-composer/e2e/functional-host-common";
const run="functional-model-fixture-20261029",source="source."+"a".repeat(64),workspace="workspace.functional-test";
const row=()=>({modelRecordId:"model.reference-test",modelId:FUNCTIONAL_REFERENCE_MODEL,workspaceId:workspace,provider:"huggingface",source:"huggingface",lifecycleStatus:"saved-reference",artifactForm:"full-model",localFilesAvailable:false});
test("only the exact saved reference in the exact workspace is accepted without local files",()=>{
  assert.deepEqual(captureModelReferenceInventory([],workspace),[]);
  const result=captureModelReferenceInventory([row()],workspace);assert.equal(result.length,1);assert.equal(result[0].modelRecordId,"model.reference-test");assert.equal(Object.isFrozen(result),true);
  for(const patch of [{workspaceId:"workspace.other"},{modelId:"Qwen/other"},{provider:"other"},{source:"local"},{lifecycleStatus:"downloaded"},{artifactForm:"adapter"},{localFilesAvailable:true},{modelRecordId:"../private"},{modelRecordId:"x".repeat(161)},{privatePath:"synthetic-private"}])assert.throws(()=>captureModelReferenceInventory([{...row(),...patch}],workspace));
  assert.throws(()=>captureModelReferenceInventory([row(),row()],workspace));
});
test("inventory rejects sparse/custom/proxy/getter observations without reading private data",()=>{
  let reads=0;const value=row();Object.defineProperty(value,"provider",{get(){reads++;throw false;}});
  const proxy=new Proxy([],{get(){reads++;throw false;},ownKeys(){reads++;throw false;}});
  for(const input of [[value],proxy,[,row()],Object.assign([row()],{extra:1}),Array.from({length:21},row),Object.setPrototypeOf([row()],null)])assert.throws(()=>captureModelReferenceInventory(input,workspace));
  assert.equal(reads,0);assert.throws(()=>captureModelReferenceInventory([row()],"../workspace"));
});
test("all ordered completed phases are necessary and never qualify a model or parent",()=>{
  for(const host of ["packaged-desktop","thin-chrome"]){
    for(let n=0;n<MODEL_REFERENCE_PHASES.length;n++)assert.equal(modelReferenceHostReport(run,source,host,MODEL_REFERENCE_PHASES.slice(0,n),false).status,"failed");
    const report=modelReferenceHostReport(run,source,host,[...MODEL_REFERENCE_PHASES],false);
    assert.equal(report.status,"passed");assert.equal(report.parentQualificationGranted,false);assert.equal(report.modelLoadingQualified,false);assert.equal(report.modelQualityQualified,false);assert.equal(report.weightDownloadPerformed,false);
    assert.equal(modelReferenceHostReport(run,source,host,[...MODEL_REFERENCE_PHASES],true).status,"failed");
    assert.throws(()=>modelReferenceHostReport(run,source,host,[MODEL_REFERENCE_PHASES[1]],false));
  }
});
test("identity and phase capture refuse arbitrary metadata, proxies, accessors and false success",()=>{
  for(const args of [["bad",source,"thin-chrome"],[run,"HEAD","thin-chrome"],[run,source,"browser"]])assert.throws(()=>functionalHostIdentity(...args as [unknown,unknown,unknown]));
  let reads=0;const proxy=new Proxy([],{get(){reads++;throw false;}}),getter:unknown[]=[];Object.defineProperty(getter,"0",{get(){reads++;throw false;}});
  for(const phases of [proxy,getter,[...MODEL_REFERENCE_PHASES,"private-detail"],Object.assign([],{extra:1})])assert.throws(()=>modelReferenceHostReport(run,source,"thin-chrome",phases,false));
  assert.equal(reads,0);assert.throws(()=>modelReferenceHostReport(run,source,"thin-chrome",[],"passed"));
});

async function withBrowserFixture(response:Response,action:()=>Promise<void>){
  const oldFetch=globalThis.fetch,storage=Object.getOwnPropertyDescriptor(globalThis,"localStorage");let requests=0;
  Object.defineProperty(globalThis,"localStorage",{configurable:true,value:{getItem:(key:string)=>{assert.equal(key,"ai-system-builder.paired-device-token");return "synthetic-test-bearer";}}});
  globalThis.fetch=async(input,init)=>{requests++;assert.equal(input,"/api/model/list");assert.equal(init?.method,"POST");assert.deepEqual(JSON.parse(init!.body as string),{workspaceId:workspace,limit:20,includeDiscovered:false,includeSharedStorage:false});assert.ok(init?.signal);return response;};
  try{await action();assert.equal(requests,1);}finally{globalThis.fetch=oldFetch;if(storage)Object.defineProperty(globalThis,"localStorage",storage);else delete (globalThis as Record<string,unknown>).localStorage;}
}
test("actual browser callback reads bounded Unicode JSON and returns only the fixed reference projection",async()=>{
  const response=new Response(JSON.stringify({ok:true,value:{models:[{...row(),description:"synthetic-private-"+"\u20ac".repeat(100),localPath:"",validationReportPath:"synthetic-private-path"}]}}),{headers:{"content-type":"application/json"}});
  await withBrowserFixture(response,async()=>{
    const captured=await readFunctionalModelInventoryInBrowser({host:"thin-chrome",workspaceId:workspace});assert.deepEqual(captured,[row()]);assert.doesNotMatch(JSON.stringify(captured),/synthetic-private/);
  });
});
test("actual browser callback cancels excess UTF-8 bytes before consuming the remaining stream",async()=>{
  let pulls=0,cancelled=false;const chunk=new TextEncoder().encode("\u20ac".repeat(50000));
  const stream=new ReadableStream<Uint8Array>({pull(controller){pulls++;controller.enqueue(chunk);},cancel(){cancelled=true;}},{highWaterMark:0});
  await withBrowserFixture(new Response(stream,{headers:{"content-type":"application/json"}}),async()=>{
    await assert.rejects(readFunctionalModelInventoryInBrowser({host:"thin-chrome",workspaceId:workspace}),/byte bound/);assert.equal(pulls,2);assert.equal(cancelled,true);
  });
});
test("actual browser callback rejects invalid UTF-8, incomplete pages and oversized projected fields",async()=>{
  const fixtures=[new Response(new Uint8Array([255]),{headers:{"content-type":"application/json"}}),new Response(JSON.stringify({ok:true,value:{models:[],nextCursor:"next"}}),{headers:{"content-type":"application/json"}}),new Response(JSON.stringify({ok:true,value:{models:[{...row(),modelRecordId:"x".repeat(193)}]}}),{headers:{"content-type":"application/json"}})];
  for(const response of fixtures)await withBrowserFixture(response,async()=>{await assert.rejects(readFunctionalModelInventoryInBrowser({host:"thin-chrome",workspaceId:workspace}),/invalid|incomplete/);});
});
