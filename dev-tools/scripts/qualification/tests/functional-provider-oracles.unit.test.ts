import test from "node:test";
import assert from "node:assert/strict";
import {createHash} from "node:crypto";
import {readArtifactHostStateInBrowser} from "../visual-composer/e2e/artifact-host-browser-reads";
import {captureProviderBacking,captureProviderBytes,providerHostPhases,providerHostReport} from "../visual-composer/functional-provider-oracles";
import {FUNCTIONAL_PROVIDER_REPOSITORY,providerPublicationPath} from "../visual-composer/functional-provider-plan.mjs";
const workspace="workspace.provider-unit",key="artifact.provider-unit",run="provider-oracle-unit-run-0001",source=`source.${"a".repeat(64)}`;
const bytes=Buffer.from("PAR1PAR1"),sha256=createHash("sha256").update(bytes).digest("hex"),file={path:"data/test.parquet",revision:"b".repeat(40),size_bytes:bytes.length,sha256,localize:true};
function backing(publication=false){return{target:{provider:"huggingface",repository:FUNCTIONAL_PROVIDER_REPOSITORY,path:publication?providerPublicationPath(run):file.path,revision:publication?"main":file.revision,locator:"not-projected"},verification:{exists:true,verifiedAt:"2026-01-01T00:00:00Z"}};}
async function desktop(local:boolean,action:(observed:{mediaReads:()=>number})=>Promise<void>){
  const previous=Object.getOwnPropertyDescriptor(globalThis,"window");let mediaReads=0;
  Object.defineProperty(globalThis,"window",{configurable:true,value:{desktopApi:{
    readArtifactDetail:async()=>({ok:true,value:{artifact:{locator:{storageKey:key},originalName:file.path,sourceKind:"upload",metadata:{importedSourceBacking:backing(),privateNative:"must-not-copy"}}}}),
    readArtifactContentDescriptor:async()=>({ok:true,value:{content:{locator:{storageKey:key},availability:local?"available":"unavailable",retrieval:local?"local":"deferred"}}}),
    readArtifactViewerMedia:async()=>{mediaReads++;return{ok:true,value:{bytes}};},
  }}});
  try{await action({mediaReads:()=>mediaReads});}finally{if(previous)Object.defineProperty(globalThis,"window",previous);else Reflect.deleteProperty(globalThis,"window");}
}
test("actual backing callback proves a remote reference without requesting bytes or inventing catalog size",async()=>{
  await desktop(false,async observed=>{
    const value=await readArtifactHostStateInBrowser({host:"packaged-desktop",workspaceId:workspace,key,mode:"backing"});assert.equal(observed.mediaReads(),0);assert.doesNotMatch(JSON.stringify(value),/privateNative|not-projected|sizeBytes/);
    assert.deepEqual(captureProviderBacking(value,workspace,key,file,false),{workspaceId:workspace,storageKey:key,local:false,role:"imported-source",revisionKind:"immutable"});
    assert.throws(()=>captureProviderBacking(value,"workspace.other",key,file,false));assert.throws(()=>captureProviderBacking(value,workspace,key,file,true));
  });
});
test("media-only callback verifies exact localized bytes while preserving the strict old local-import contract",async()=>{
  await desktop(true,async observed=>{
    const state=await readArtifactHostStateInBrowser({host:"packaged-desktop",workspaceId:workspace,key,mode:"backing"});captureProviderBacking(state,workspace,key,file,true);assert.equal(observed.mediaReads(),0);
    const value=await readArtifactHostStateInBrowser({host:"packaged-desktop",workspaceId:workspace,key,mode:"bytes"});assert.equal(observed.mediaReads(),1);assert.deepEqual(captureProviderBytes(value,workspace,key,file),{workspaceId:workspace,storageKey:key,bytesVerified:true});
    assert.throws(()=>captureProviderBytes({...value,sha256:"0".repeat(64)},workspace,key,file));assert.throws(()=>captureProviderBytes({...value,sizeBytes:0},workspace,key,{size_bytes:0,sha256}));
    await assert.rejects(readArtifactHostStateInBrowser({host:"packaged-desktop",workspaceId:workspace,key,mode:"inspect"}),/content and detail do not agree/);
  });
});
test("published local main remains a branch rather than an invented immutable provider commit",()=>{
  const target=backing(true).target,value={requestedWorkspaceId:workspace,storageKey:key,sourceKind:"upload",originalName:"qualification-inventory.json",contentAvailable:true,importedSourceBacking:null,publishedBacking:{provider:target.provider,repository:target.repository,path:target.path,revision:target.revision,exists:true}};
  assert.equal(captureProviderBacking(value,workspace,key,{publicationRun:run},true).revisionKind,"branch");assert.throws(()=>captureProviderBacking({...value,publishedBacking:{...value.publishedBacking,revision:"c".repeat(40)}},workspace,key,{publicationRun:run},true));
});
test("source/backing substitutions and accessors cannot fabricate a qualifying source tuple",()=>{
  const value={requestedWorkspaceId:workspace,storageKey:key,sourceKind:"upload",originalName:file.path,contentAvailable:false,importedSourceBacking:{provider:"huggingface",repository:FUNCTIONAL_PROVIDER_REPOSITORY,path:file.path,revision:file.revision,exists:true},publishedBacking:null};
  for(const patch of [{storageKey:"other"},{sourceKind:"repo"},{publishedBacking:{}},{importedSourceBacking:{...value.importedSourceBacking,exists:false}},{importedSourceBacking:{...value.importedSourceBacking,revision:"main"}},{importedSourceBacking:{...value.importedSourceBacking,repository:"Other/private"}}])assert.throws(()=>captureProviderBacking({...value,...patch},workspace,key,file,false));
  let calls=0;const accessor={...value};Object.defineProperty(accessor,"sourceKind",{get(){calls++;return"upload";}});assert.throws(()=>captureProviderBacking(accessor,workspace,key,file,false));assert.equal(calls,0);
});
test("phase reports require a dense exact prefix and keep optional localization and qualification separate",()=>{
  const reference=providerHostPhases("thin-chrome","provider-source",false),localized=providerHostPhases("thin-chrome","provider-source",true);assert.equal(localized.length,reference.length+3);
  const result=providerHostReport(run,source,"thin-chrome","provider-source",false,[...reference],false);assert.equal(result.status,"passed");assert.equal(result.rawReadablePairCreated,false);assert.equal(result.parentQualificationGranted,false);
  assert.throws(()=>providerHostReport(run,source,"thin-chrome","provider-source",false,[...reference].reverse(),false));assert.throws(()=>providerHostReport(run,source,"thin-chrome","provider-source",false,new Array(reference.length),false));assert.throws(()=>providerHostReport(run,source,"thin-chrome","provider-source",false,[reference[0]!],false));assert.throws(()=>providerHostPhases("thin-chrome","provider-publication",false));
  assert.equal(providerHostReport(run,source,"thin-chrome","provider-source",false,[reference[0]!],true).status,"failed");
});
test("validated phase values are copied without invoking an inherited iterator",()=>{
  const expected=providerHostPhases("thin-chrome","provider-source",false),phases=[...expected],prototype=Object.create(Array.prototype);let calls=0;
  Object.defineProperty(prototype,Symbol.iterator,{value(){calls++;throw Error("An inherited iterator must not run.");}});Object.setPrototypeOf(phases,prototype);
  const result=providerHostReport(run,source,"thin-chrome","provider-source",false,phases,false);assert.equal(calls,0);assert.deepEqual(result.phases,[...expected]);assert.equal(Object.isFrozen(result.phases),true);assert.equal(result.status,"passed");
});
