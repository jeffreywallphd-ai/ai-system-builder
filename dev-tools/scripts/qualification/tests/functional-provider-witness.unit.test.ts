import test from "node:test";
import assert from "node:assert/strict";
import {mkdtempSync,mkdirSync,writeFileSync,rmSync} from "node:fs";
import {tmpdir} from "node:os";
import path from "node:path";
import {openExecutingProviderFixture,privateProviderFailureStage} from "../visual-composer/functional-private-provider-fixture";
import {providerFixtureIdentity,FUNCTIONAL_PROVIDER_REPOSITORY,providerRepositoryInfoUrl,providerPublicationObjectUrl,FUNCTIONAL_PROVIDER_METADATA_BYTES,FUNCTIONAL_PROVIDER_TIMEOUT_MS} from "../visual-composer/functional-provider-plan.mjs";
import {ARTIFACT_SAMPLE_TEXT,ARTIFACT_SAMPLE_BYTES,ARTIFACT_SAMPLE_SHA256} from "../visual-composer/functional-artifact-oracles";
const run="provider-witness-unit-run-0001",source=`source.${"a".repeat(64)}`,before="b".repeat(40),after="c".repeat(40),canary="synthetic-provider-witness-canary";
function fixture(t:test.TestContext){
  const base=path.resolve(tmpdir()),repo=mkdtempSync(path.join(base,"provider-witness-"));t.after(()=>{assert.equal(path.dirname(repo),base);assert.ok(path.basename(repo).startsWith("provider-witness-"));rmSync(repo,{recursive:true});});
  mkdirSync(path.join(repo,".local-codex/test-input"),{recursive:true});writeFileSync(path.join(repo,".local-codex/test-input/credential.json"),JSON.stringify({token:canary}));
  writeFileSync(path.join(repo,".local-codex/test-input/manifest.json"),JSON.stringify({schema_version:"functional-private-provider-v1",repository:FUNCTIONAL_PROVIDER_REPOSITORY,credential_file:".local-codex/test-input/credential.json"}));
  return openExecutingProviderFixture({repoRoot:repo,manifestRef:".local-codex/test-input/manifest.json",identity:providerFixtureIdentity(run,source,"packaged-desktop","provider-publication"),executing:true});
}
const info=(revision=before,extra:Record<string,unknown>={})=>new Response(JSON.stringify({id:FUNCTIONAL_PROVIDER_REPOSITORY,private:true,sha:revision,...extra}),{status:200,headers:{"content-type":"application/json"}});
const absent=()=>new Response("Synthetic entry missing",{status:404,headers:{"x-error-code":"EntryNotFound"}});
function safe(error:unknown){assert.ok(error instanceof Error);assert.doesNotMatch(error.message,new RegExp(canary));assert.notEqual(privateProviderFailureStage(error),"provider-test-failed");return true;}
async function mocked<T>(callback:typeof fetch,run:()=>Promise<T>){const old=globalThis.fetch;globalThis.fetch=callback;try{return await run();}finally{globalThis.fetch=old;}}
test("independent remote proof admits an absent owned path and distinguishes persisted main from immutable exact bytes",async t=>{
  const capsule=fixture(t),calls:string[]=[];
  await mocked(async(url,options)=>{
    assert.equal(options?.redirect,"error");assert.equal(options?.method,"GET");assert.equal(new Headers(options?.headers).get("authorization"),`Bearer ${canary}`);calls.push(String(url));
    if(calls.length===1)return info();if(calls.length===2)return absent();if(calls.length===3||calls.length===5)return info(after);if(calls.length===4)return new Response(ARTIFACT_SAMPLE_TEXT);throw Error("Unexpected request.");
  },async()=>{
    assert.deepEqual(await capsule.admitPublicationPath(),{privateVerified:true,pathAbsent:true,baseRevision:before});
    const witness=await capsule.observePublishedObject();assert.deepEqual(witness,{privateVerified:true,remoteRevision:after,sizeBytes:ARTIFACT_SAMPLE_BYTES,sha256:ARTIFACT_SAMPLE_SHA256,localBackingRevisionKind:"branch"});assert.doesNotMatch(JSON.stringify(witness),/canary|token|credential/);
  });
  assert.deepEqual(calls,[providerRepositoryInfoUrl(),providerPublicationObjectUrl(run,before),providerRepositoryInfoUrl(),providerPublicationObjectUrl(run,after),providerRepositoryInfoUrl()]);
});
test("publication observation cannot run without actual prior private-state and path-absence admission",async t=>{
  const capsule=fixture(t);let calls=0;
  await mocked(async()=>{calls++;throw Error(canary);},async()=>{await assert.rejects(capsule.observePublishedObject(),safe);assert.equal(calls,0);});
});
test("public, misbound, malformed, abbreviated or unavailable private metadata cannot admit publication",async t=>{
  const factories=[()=>info(before,{private:false}),()=>info(before,{id:"Other/repository"}),()=>info("main"),()=>info("b".repeat(7)),()=>new Response("{",{status:200}),()=>new Response(canary,{status:401}),()=>new Response(canary,{status:404}),()=>Response.redirect("https://example.invalid/",302)];
  for(const factory of factories){const capsule=fixture(t);let calls=0;await mocked(async()=>{calls++;return factory();},async()=>{await assert.rejects(capsule.admitPublicationPath(),safe);assert.equal(calls,1);await assert.rejects(capsule.observePublishedObject(),safe);assert.equal(calls,1);});}
});
test("an existing path and generic, revision or permission failures never count as an absent owned target",async t=>{
  const replies=[()=>new Response("",{status:200}),()=>new Response(canary,{status:404}),()=>new Response(canary,{status:404,headers:{"x-error-code":"RevisionNotFound"}}),()=>new Response(canary,{status:403}),()=>new Response(canary,{status:401})];
  for(const reply of replies){const capsule=fixture(t);let calls=0;await mocked(async()=>++calls===1?info():reply(),async()=>{await assert.rejects(capsule.admitPublicationPath(),safe);assert.equal(calls,2);await assert.rejects(capsule.observePublishedObject(),safe);assert.equal(calls,2);});}
});
test("remote commit, actual bytes and post-write privacy must each pass independently",async t=>{
  for(const mode of ["same-commit","wrong-bytes","public-after-bytes"]){const capsule=fixture(t);let calls=0;await mocked(async()=>{
    calls++;if(calls===1)return info();if(calls===2)return absent();if(calls===3)return info(mode==="same-commit"?before:after);if(calls===4)return new Response(mode==="wrong-bytes"?"wrong synthetic bytes":ARTIFACT_SAMPLE_TEXT);if(calls===5)return info(after,{private:false});throw Error("Unexpected request.");
  },async()=>{await capsule.admitPublicationPath();await assert.rejects(capsule.observePublishedObject(),safe);assert.equal(calls,mode==="same-commit"?3:mode==="wrong-bytes"?4:5);});}
});
test("metadata projects only three bound fields while allowing the provider's other bounded fields",async t=>{
  const capsule=fixture(t),extra=Object.fromEntries(Array.from({length:25},(_,i)=>[`metadata_${i}`,`synthetic-${i}`]));
  await mocked(async()=>info(before,extra),async()=>{assert.deepEqual(await capsule.observePrivateRepository(),{private:true,revision:before});});
});
test("early refusal and streamed UTF8 overflow cancel response bodies without disclosing native failures",async t=>{
  for(const mode of ["status","length","stream","invalid-utf8"]){const capsule=fixture(t);let canceled=false;
    const stream=new ReadableStream<Uint8Array>({start(controller){controller.enqueue(mode==="invalid-utf8"?new Uint8Array([0xc3,0x28]):new Uint8Array(FUNCTIONAL_PROVIDER_METADATA_BYTES+1));if(mode==="invalid-utf8")controller.close();},cancel(){canceled=true;}});
    const response=new Response(stream,{status:mode==="status"?403:200,headers:mode==="length"?{"content-length":String(FUNCTIONAL_PROVIDER_METADATA_BYTES+1)}:{}});
    await mocked(async()=>response,async()=>{await assert.rejects(capsule.observePrivateRepository(),safe);assert.equal(canceled,mode!=="invalid-utf8");});
  }
});
test("a stalled stream is bounded independently of fetch signal cooperation",async t=>{
  const capsule=fixture(t);let canceled=false,deadlines=0;const nativeTimer=globalThis.setTimeout;
  // Unit clock scaling only: assert the actual production delay remains15s.
  globalThis.setTimeout=((callback:Parameters<typeof setTimeout>[0],delay?:number,...args:unknown[])=>{
    if(delay===FUNCTIONAL_PROVIDER_TIMEOUT_MS){deadlines++;return Reflect.apply(nativeTimer,globalThis,[callback,20,...args]);}
    return Reflect.apply(nativeTimer,globalThis,[callback,delay,...args]);
  }) as typeof setTimeout;
  try{await mocked(async()=>new Response(new ReadableStream<Uint8Array>({start(controller){controller.enqueue(new Uint8Array([123]));},cancel(){canceled=true;}})),async()=>{await assert.rejects(capsule.observePrivateRepository(),safe);assert.equal(canceled,true);assert.equal(deadlines,1);});}
  finally{globalThis.setTimeout=nativeTimer;}
});
test("request budget and untrusted exceptions fail closed without inspecting exception proxies",async t=>{
  const capsule=fixture(t);let calls=0;await mocked(async()=>{calls++;return info();},async()=>{for(let i=0;i<8;i++)await capsule.observePrivateRepository();await assert.rejects(capsule.observePrivateRepository(),safe);assert.equal(calls,8);});
  const another=fixture(t);let traps=0;const error=new Proxy({},{getPrototypeOf(){traps++;throw Error(canary);},get(){traps++;throw Error(canary);}});
  assert.equal(privateProviderFailureStage(error),"provider-test-failed");await mocked(async()=>{throw error;},async()=>{await assert.rejects(another.observePrivateRepository(),safe);assert.equal(traps,0);});
});
