import test from "node:test";
import assert from "node:assert/strict";
import {ARTIFACT_SAMPLE_NAME,ARTIFACT_SAMPLE_TEXT,ARTIFACT_SAMPLE_BYTES,ARTIFACT_SAMPLE_SHA256,artifactWorkspace,artifactKey,captureLocalArtifactState,artifactHostPhases,artifactHostReport} from "../visual-composer/functional-artifact-oracles";
import {readArtifactHostStateInBrowser} from "../visual-composer/e2e/artifact-host-browser-reads";
const workspace="workspace.artifact-fixture",key="uploads/fixture/qualification-inventory.json",run="artifact-phase-fixture-20261029",source="source."+"a".repeat(64);
const state=()=>({requestedWorkspaceId:workspace,storageKey:key,originalName:ARTIFACT_SAMPLE_NAME,sourceKind:"upload",sizeBytes:ARTIFACT_SAMPLE_BYTES,sha256:ARTIFACT_SAMPLE_SHA256,contentAvailable:true,hasImportedBacking:false,hasPublishedBacking:false});
const detail=()=>({ok:true,value:{artifact:{locator:{storageKey:key},originalName:ARTIFACT_SAMPLE_NAME,sourceKind:"upload",sizeBytes:ARTIFACT_SAMPLE_BYTES,metadata:{}}}});
const descriptor=()=>({ok:true,value:{content:{locator:{storageKey:key},availability:"available"}}});
test("local readback binds exact request scope, logical key and synthetic content without claiming response ownership",()=>{
  assert.equal(captureLocalArtifactState(state(),workspace,key).requestedWorkspaceId,workspace);
  for(const patch of [{requestedWorkspaceId:"workspace.other"},{storageKey:"uploads/other.json"},{originalName:"other.json"},{sourceKind:"provider"},{sizeBytes:0},{sha256:"0".repeat(64)},{contentAvailable:false},{hasImportedBacking:true},{hasPublishedBacking:true},{privateError:"hidden"}])assert.throws(()=>captureLocalArtifactState({...state(),...patch},workspace,key));
  for(const k of ["../other","/absolute","C:/private","x\\y","x//y","x/../y","x\0y"])assert.throws(()=>artifactKey(k));assert.throws(()=>artifactWorkspace("../other"));
  let reads=0;const v=state();Object.defineProperty(v,"sha256",{get(){reads++;throw false;}});assert.throws(()=>captureLocalArtifactState(v,workspace,key));assert.equal(reads,0);
});
test("ordered host-specific phases preserve explicit scope and refuse partial or invented completion",()=>{
  for(const host of ["packaged-desktop","thin-chrome"] as const){
    const phases=artifactHostPhases(host,"local-lifecycle");assert.equal(phases.includes("export-bytes-confirmed"),host==="packaged-desktop");assert(phases.indexOf("cross-workspace-read-denied")<phases.indexOf("second-artifact-imported"));
    for(let n=0;n<phases.length;n++)assert.equal(artifactHostReport(run,source,host,"local-lifecycle",phases.slice(0,n),false).status,"failed");
    const passed=artifactHostReport(run,source,host,"local-lifecycle",[...phases],false);assert.equal(passed.status,"passed");assert.equal(passed.parentQualificationGranted,false);assert.equal(passed.modelQualityQualified,false);assert.equal(passed.physicalSharedObjectOwnershipQualified,false);
    assert.equal(artifactHostReport(run,source,host,"local-lifecycle",[...phases],true).status,"failed");assert.throws(()=>artifactHostReport(run,source,host,"local-lifecycle",[phases[1]],false));
  }
  assert.throws(()=>artifactHostPhases("packaged-desktop","publication-denial"));
  let reads=0;assert.throws(()=>artifactHostReport(run,source,"thin-chrome","publication-denial",new Proxy([],{get(){reads++;throw false;}}),false));assert.equal(reads,0);
});
async function desktop(bytes:unknown,action:()=>Promise<void>){
  const old=Object.getOwnPropertyDescriptor(globalThis,"window"),calls:string[]=[];
  Object.defineProperty(globalThis,"window",{configurable:true,value:{desktopApi:{
    readArtifactDetail:async(locator:unknown,context:unknown)=>{calls.push("detail");assert.deepEqual(locator,{storageKey:key});assert.deepEqual(context,{workspaceId:workspace});return detail();},
    readArtifactContentDescriptor:async()=>{calls.push("content");return descriptor();},
    readArtifactViewerMedia:async(_l:unknown,c:unknown)=>{calls.push("media");assert.deepEqual(c,{workspaceId:workspace,maximumBytes:4096});return {ok:true,value:{bytes}};},
  }}});
  try{await action();}finally{if(old)Object.defineProperty(globalThis,"window",old);else delete (globalThis as unknown as Record<string,unknown>).window;}
  return calls;
}
test("actual Desktop callback preserves bounded canonical byte carriers and omits private metadata",async()=>{
  const bytes=Uint8Array.from(Buffer.from(ARTIFACT_SAMPLE_TEXT));
  for(const raw of [bytes,bytes.buffer,new DataView(bytes.buffer),Array.from(bytes),Object.fromEntries(Array.from(bytes,(v,i)=>[String(i),v]))]){
    const calls=await desktop(raw,async()=>{const result=await readArtifactHostStateInBrowser({host:"packaged-desktop",workspaceId:workspace,key,mode:"inspect"});assert.deepEqual(result,state());captureLocalArtifactState(result,workspace,key);});assert.deepEqual(calls,["detail","content","media"]);
  }
});
test("actual Desktop callback refuses sparse, malformed and oversized byte payloads",async()=>{
  for(const raw of [[,1],{0:1,2:2},[256],[NaN],new Uint8Array(4097)])await desktop(raw,async()=>{await assert.rejects(readArtifactHostStateInBrowser({host:"packaged-desktop",workspaceId:workspace,key,mode:"inspect"}),/invalid|bound/);});
});
test("actual Desktop callback refuses an oversized array before enumerating its fields",async()=>{
  let enumerations=0;const raw=new Proxy(new Array(4097).fill(1),{ownKeys(){enumerations++;throw new Error("Enumeration must not occur.");}});
  await desktop(raw,async()=>{await assert.rejects(readArtifactHostStateInBrowser({host:"packaged-desktop",workspaceId:workspace,key,mode:"inspect"}),/bound/);});assert.equal(enumerations,0);
});
async function http(replies:Response[],action:()=>Promise<void>){
  const old=globalThis.fetch,storage=Object.getOwnPropertyDescriptor(globalThis,"localStorage"),requests:{url:string;init?:RequestInit}[]=[];
  Object.defineProperty(globalThis,"localStorage",{configurable:true,value:{getItem:()=>"p".repeat(43)}});
  globalThis.fetch=async(input,init)=>{requests.push({url:String(input),init});const reply=replies.shift();if(!reply)throw new Error("Unexpected read.");return reply;};
  try{await action();assert.equal(replies.length,0);}finally{globalThis.fetch=old;if(storage)Object.defineProperty(globalThis,"localStorage",storage);else delete (globalThis as unknown as Record<string,unknown>).localStorage;}
  return requests;
}
const json=(value:unknown,status=200)=>new Response(JSON.stringify(value),{status,headers:{"content-type":"application/json"}});
test("actual Thin callback binds authenticated read then genuine route403 and refuses invalid-token401",async()=>{
  const token="r".repeat(43);
  const requests=await http([json(detail()),json({ok:false,error:{code:"forbidden",operation:"security.forbidden"}},403)],async()=>{
    assert.deepEqual(await readArtifactHostStateInBrowser({host:"thin-chrome",workspaceId:workspace,key,mode:"readonly-control",bearer:token}),{authenticatedReadSucceeded:true,storageKey:key});
    assert.deepEqual(await readArtifactHostStateInBrowser({host:"thin-chrome",workspaceId:workspace,key,mode:"deny-publication",bearer:token,artifactId:key}),{authenticatedRouteDenied:true,status:403,permission:"artifact:write"});
  });
  assert.equal(requests[1]!.url,"/api/artifact/publish");assert.equal((requests[1]!.init!.headers as Record<string,string>).authorization,"Bearer "+token);assert.equal(JSON.parse(requests[1]!.init!.body as string).repositoryCreation,undefined);
  await http([json({ok:false,error:{code:"security.invalid-token"}},401)],async()=>{await assert.rejects(readArtifactHostStateInBrowser({host:"thin-chrome",workspaceId:workspace,key,mode:"deny-publication",bearer:token,artifactId:key}),/actual route permission/);});
});
test("actual Thin callback verifies the bounded binary read and exact content projection",async()=>{
  const calls=await http([json(detail()),json(descriptor()),new Response(ARTIFACT_SAMPLE_TEXT)],async()=>{assert.deepEqual(await readArtifactHostStateInBrowser({host:"thin-chrome",workspaceId:workspace,key,mode:"inspect"}),state());});
  const media=new URL(calls[2]!.url,"http://127.0.0.1");assert.equal(media.pathname,"/api/artifact/media/view");assert.equal(media.searchParams.get("workspaceId"),workspace);assert.equal(media.searchParams.get("maximumBytes"),"4096");assert.equal(calls[2]!.init!.method,"GET");
});
test("actual Thin absence requires not-found detail and bytes, not an authorization error or orphaned media",async()=>{
  await http([json({ok:false,error:{code:"not-found"}},404),new Response(null,{status:404})],async()=>{assert.deepEqual(await readArtifactHostStateInBrowser({host:"thin-chrome",workspaceId:workspace,key,mode:"gone"}),{requestedWorkspaceId:workspace,storageKey:key,absent:true,isolated:false});});
  await http([json({ok:false,error:{code:"not-found"}},403),new Response(null,{status:404})],async()=>{await assert.rejects(readArtifactHostStateInBrowser({host:"thin-chrome",workspaceId:workspace,key,mode:"gone"}),/unproved/);});
  await http([json({ok:false,error:{code:"not-found"}},404),new Response(ARTIFACT_SAMPLE_TEXT)],async()=>{await assert.rejects(readArtifactHostStateInBrowser({host:"thin-chrome",workspaceId:workspace,key,mode:"gone"}),/unproved/);});
});
test("actual Thin callback cancels an oversized Unicode response before projection",async()=>{
  let cancelled=false,pulls=0;const chunk=new TextEncoder().encode("\u20ac".repeat(30000));
  const stream=new ReadableStream<Uint8Array>({pull(c){pulls++;c.enqueue(chunk);},cancel(){cancelled=true;}},{highWaterMark:0});
  await http([new Response(stream,{headers:{"content-type":"application/json"}})],async()=>{await assert.rejects(readArtifactHostStateInBrowser({host:"thin-chrome",workspaceId:workspace,key:"",mode:"list"}),/byte bound/);assert.equal(cancelled,true);assert.equal(pulls,1);});
});
