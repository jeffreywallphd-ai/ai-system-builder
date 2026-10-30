import test from "node:test";
import assert from "node:assert/strict";
import {FUNCTIONAL_PROVIDER_REPOSITORY,FUNCTIONAL_PROVIDER_OBJECT_BYTES,validateProviderFixtureManifest,parseProviderFixtureManifest,providerFixtureReference,providerFixtureIdentity,providerFixturePlan,safeProviderFixturePlan,providerPublicationPath,providerRepositoryInfoUrl,providerPublicationObjectUrl} from "../visual-composer/functional-provider-plan.mjs";
const run="provider-qualification-fixture-0001",source=`source.${"a".repeat(64)}`,revision="b".repeat(40);
const manifest=()=>({schema_version:"functional-private-provider-v1",repository:FUNCTIONAL_PROVIDER_REPOSITORY,credential_file:".local-codex/private-fixture/credential.json",source_file:{path:"data/train-00000-of-00001.parquet",revision,size_bytes:1024,sha256:"c".repeat(64),localize:false}});
const identity=(host="packaged-desktop",purpose="provider-source")=>providerFixtureIdentity(run,source,host,purpose);
const invalid={message:/^The provider fixture declaration is invalid\.$/};
test("pure declarations distinguish reference-only import, explicit localization and Desktop publication without authority",()=>{
  let calls=0;const original=globalThis.fetch;globalThis.fetch=()=>{calls++;throw Error("No network.");};
  try{
    const value=validateProviderFixtureManifest(manifest());assert.ok(Object.isFrozen(value)&&Object.isFrozen(value.source_file));assert.equal(value.source_file.localize,false);
    const plan=providerFixturePlan(value,identity("thin-chrome"));assert.equal(plan.sourceReferenceOnly,true);assert.equal(plan.publicationPath,undefined);
    const summary=safeProviderFixturePlan(plan);assert.deepEqual(summary,{purpose:"provider-source",host:"thin-chrome",requiresExplicitTestCredential:true,sourceReferenceOnly:true,localizationRequested:false,repositoryCreation:false,remoteDeletion:false,credentialRead:false,networkRun:false,qualificationGranted:false});assert.doesNotMatch(JSON.stringify(summary),/credential\.json|private-fixture|token|sha256|OpenFinAL/);
    const local=manifest();local.source_file.localize=true;assert.equal(safeProviderFixturePlan(providerFixturePlan(local,identity())).localizationRequested,true);
    const publication=manifest();delete publication.source_file;const published=providerFixturePlan(publication,identity("packaged-desktop","provider-publication"));assert.equal(published.publicationPath,providerPublicationPath(run));assert.equal(published.sourceReferenceOnly,false);assert.equal(safeProviderFixturePlan(published).localizationRequested,false);assert.equal(calls,0);
  }finally{globalThis.fetch=original;}
});
test("manifest parsing bounds actual UTF8 bytes and refuses malformed, missing, substituted or extra source declarations",()=>{
  const bytes=Buffer.from(JSON.stringify(manifest()));assert.deepEqual(parseProviderFixtureManifest(bytes),validateProviderFixtureManifest(manifest()));
  for(const value of [Buffer.alloc(0),Buffer.alloc(8193,32),Buffer.from([0xc3,0x28]),Buffer.from('{'),Buffer.from('null'),"{}",new Uint16Array(4)])assert.throws(()=>parseProviderFixtureManifest(value),invalid);
  const mutations=[v=>v.repository="Other/private",v=>v.private=true,v=>v.creation_approved=true,v=>v.token="canary_secret",v=>v.source_file=undefined,v=>v.source_file.revision="main",v=>v.source_file.revision="a".repeat(7),v=>v.source_file.sha256="wrong",v=>v.source_file.size_bytes=FUNCTIONAL_PROVIDER_OBJECT_BYTES+1,v=>v.source_file.size_bytes=0,v=>v.source_file.size_bytes=NaN,v=>v.source_file.size_bytes=1.5,v=>v.source_file.path="data/rows.json",v=>v.source_file.localize="true",v=>v.source_file.extra="canary_secret"];
  for(const mutate of mutations){const v=manifest();mutate(v);assert.throws(()=>validateProviderFixtureManifest(v),error=>invalid.message.test(error.message)&&!error.message.includes("canary_secret"));}
});
test("explicit input references reject traversal, device names, aliasing, URL and absolute-path forms before any file read",()=>{
  for(const value of ["C:/token.json","C:token.json","/token.json","//server/token.json",".local-codex/../token.json",".local-codex//token.json",".local-codex/./token.json",".local-codex/a./token.json",".local-codex/nul.json",".local-codex/COM1/file.json",".local-codex/a.json:stream",".local-codex/%2e%2e/token.json",".local-codex/a\\token.json",".local-codex/\u0000token.json",".local-codex/é.json","https://huggingface.co/token.json","elsewhere/token.json",`.local-codex/${"a".repeat(240)}.json`])assert.throws(()=>providerFixtureReference(value),invalid);
  assert.equal(providerFixtureReference(".local-codex/explicit-test/credential.json"),".local-codex/explicit-test/credential.json");
});
test("in-memory getters/proxies, wrong host/purpose and forged safe summaries refuse without invoking traps",()=>{
  let traps=0;const getter=manifest();Object.defineProperty(getter,"credential_file",{get(){traps++;return "canary_secret";},enumerable:true});assert.throws(()=>validateProviderFixtureManifest(getter),invalid);
  const proxy=new Proxy(manifest(),{ownKeys(){traps++;throw Error("Trap.");},get(){traps++;throw Error("Trap.");}});assert.throws(()=>validateProviderFixtureManifest(proxy),invalid);assert.throws(()=>safeProviderFixturePlan(proxy),invalid);assert.equal(traps,0);
  for(const value of [identity("packaged-desktop","provider-publication"),{...identity(),host:"thin-chrome",purpose:"provider-publication"},{...identity(),runId:"short"},{...identity(),sourceRevision:"main"},{...identity(),purpose:"model-reference"}]){
    if(value.host==="packaged-desktop"&&value.purpose==="provider-publication")continue;
    assert.throws(()=>providerFixturePlan(manifest(),value),invalid);
  }
  const missing=manifest();delete missing.source_file;assert.throws(()=>providerFixturePlan(missing,identity()),invalid);
  const plan=providerFixturePlan(manifest(),identity());assert.throws(()=>safeProviderFixturePlan({...plan,sourceReferenceOnly:false}),invalid);assert.throws(()=>safeProviderFixturePlan({...plan,publicationPath:"other"}),invalid);
});
test("remote witness URLs are fixed to the authorized repository and fresh synthetic path with an immutable revision",()=>{
  assert.equal(providerRepositoryInfoUrl(),"https://huggingface.co/api/datasets/OpenFinAL/ai-system-builder-test");
  const expected=`https://huggingface.co/datasets/OpenFinAL/ai-system-builder-test/resolve/${revision}/qualification/functional-host/${run}/qualification-inventory.json`;assert.equal(providerPublicationObjectUrl(run,revision),expected);
  for(const bad of ["main","refs/convert/parquet","https://elsewhere.invalid/","a".repeat(7),"b".repeat(41)])assert.throws(()=>providerPublicationObjectUrl(run,bad),invalid);
});
