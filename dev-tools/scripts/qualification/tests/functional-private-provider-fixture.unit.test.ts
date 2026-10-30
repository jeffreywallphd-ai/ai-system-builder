import test from "node:test";
import assert from "node:assert/strict";
import {mkdtempSync,mkdirSync,readFileSync,writeFileSync,existsSync,rmSync,linkSync,symlinkSync} from "node:fs";
import fs from "node:fs";
import {syncBuiltinESMExports} from "node:module";
import {tmpdir} from "node:os";
import path from "node:path";
import {spawn,spawnSync} from "node:child_process";
import {pathToFileURL} from "node:url";
import {once} from "node:events";
import {beginProviderFixtureAdmission,openExecutingProviderFixture,privateProviderFailureStage} from "../visual-composer/functional-private-provider-fixture";
import {providerFixtureIdentity,FUNCTIONAL_PROVIDER_REPOSITORY} from "../visual-composer/functional-provider-plan.mjs";
import {functionalHostLayout,createFunctionalHostEnvironment} from "../visual-composer/functional-host-launch-plan.mjs";
import {observeOwnedHostShutdown} from "../visual-composer/owned-host-shutdown.mjs";
const run="provider-fixture-unit-run-00001",source=`source.${"a".repeat(64)}`,canary="synthetic-only-provider-canary";
function fixture(t:test.TestContext,host:"packaged-desktop"|"thin-chrome"="packaged-desktop",purpose:"provider-source"|"provider-publication"="provider-source"){
  const base=path.resolve(tmpdir()),repo=mkdtempSync(path.join(base,"provider-fixture-"));
  t.after(()=>{assert.equal(path.dirname(repo),base);assert.ok(path.basename(repo).startsWith("provider-fixture-"));rmSync(repo,{recursive:true});});
  const identity=providerFixtureIdentity(run,source,host,purpose),manifestRef=".local-codex/explicit-test/manifest.json",credentialRef=".local-codex/explicit-test/credential.json";
  mkdirSync(path.join(repo,".local-codex/explicit-test"),{recursive:true});const input=path.join(repo,...credentialRef.split("/"));writeFileSync(input,JSON.stringify({token:canary}));
  const declaration={schema_version:"functional-private-provider-v1",repository:FUNCTIONAL_PROVIDER_REPOSITORY,credential_file:credentialRef,source_file:{path:"data/test.parquet",revision:"b".repeat(40),size_bytes:1024,sha256:"c".repeat(64),localize:false}};
  writeFileSync(path.join(repo,...manifestRef.split("/")),JSON.stringify(declaration));
  const admission=beginProviderFixtureAdmission(repo,identity),layout=functionalHostLayout(repo,run,source),root=host==="packaged-desktop"?path.join(layout.desktopDataRoot,`functional-${purpose}`):layout.serverStorageRoot;
  mkdirSync(root,{recursive:true});const destination=path.join(root,...(host==="packaged-desktop"?["artifacts","config"]:["config"]),"hugging-face-token.json");
  const open=()=>openExecutingProviderFixture({repoRoot:repo,manifestRef,identity,executing:true});
  return{repo,identity,manifestRef,input,admission,root,destination,declaration,open};
}
function fixedError(error:unknown){assert.ok(error instanceof Error);assert.doesNotMatch(error.message,new RegExp(canary));assert.equal(privateProviderFailureStage(new Error(canary)),"provider-test-failed");return true;}
test("production-format seeding uses a fresh opaque admission, preserves input and retires only its own prelaunch file",t=>{
  const f=fixture(t),before=readFileSync(f.input);let network=0;const old=globalThis.fetch;globalThis.fetch=async()=>{network++;throw Error(canary);};
  try{
    const capsule=f.open();assert.doesNotMatch(JSON.stringify(capsule),/synthetic-only|credential\.json|explicit-test/);const seeded=capsule.seedCredential(f.admission);
    assert.deepEqual(JSON.parse(readFileSync(f.destination,"utf8")),{token:canary});assert.deepEqual(readFileSync(f.input),before);assert.equal(network,0);
    assert.throws(()=>capsule.seedCredential(f.admission),fixedError);seeded.retireBeforeLaunch();assert.equal(existsSync(f.destination),false);assert.deepEqual(readFileSync(f.input),before);assert.throws(()=>seeded.retireBeforeLaunch(),fixedError);
  }finally{globalThis.fetch=old;}
});
test("missing execution opt-in refuses before any private file read or network",()=>{
  const original=fs.readSync;let reads=0,fetches=0;const old=globalThis.fetch;
  fs.readSync=((...args:unknown[])=>{reads++;return Reflect.apply(original,fs,args);}) as typeof fs.readSync;syncBuiltinESMExports();globalThis.fetch=async()=>{fetches++;throw Error(canary);};
  try{assert.throws(()=>openExecutingProviderFixture({repoRoot:"not-a-physical-root",manifestRef:".local-codex/private/credential.json",identity:providerFixtureIdentity(run,source,"packaged-desktop","provider-source"),executing:false}),fixedError);assert.equal(reads,0);assert.equal(fetches,0);}
  finally{fs.readSync=original;syncBuiltinESMExports();globalThis.fetch=old;}
});
test("malformed, oversized and multiply linked explicit inputs refuse before store creation",t=>{
  for(const kind of ["malformed","extra","oversized","hardlink"]){const f=fixture(t);if(kind==="malformed")writeFileSync(f.input,"{");if(kind==="extra")writeFileSync(f.input,JSON.stringify({token:canary,other:canary}));if(kind==="oversized")writeFileSync(f.input,"x".repeat(8193));if(kind==="hardlink")linkSync(f.input,path.join(path.dirname(f.input),"second.json"));assert.throws(f.open,fixedError);assert.equal(existsSync(f.destination),false);}
});
test("linked parents, stale roots, forged admission and existing destination preserve known files",t=>{
  const linked=fixture(t),alias=path.join(linked.repo,".local-codex/alias");symlinkSync(path.dirname(linked.input),alias,"junction");
  writeFileSync(path.join(linked.repo,...linked.manifestRef.split("/")),JSON.stringify({...linked.declaration,credential_file:".local-codex/alias/credential.json"}));assert.throws(linked.open,fixedError);assert.equal(existsSync(linked.destination),false);
  const f=fixture(t);assert.throws(()=>beginProviderFixtureAdmission(f.repo,f.identity),fixedError);const capsule=f.open();assert.throws(()=>capsule.seedCredential(Object.freeze({})),fixedError);
  mkdirSync(path.dirname(f.destination),{recursive:true});writeFileSync(f.destination,"owned-existing-synthetic-file");assert.throws(()=>capsule.seedCredential(f.admission),fixedError);assert.equal(readFileSync(f.destination,"utf8"),"owned-existing-synthetic-file");
});
test("changed destination is retained; changed input is preserved while independent owned cleanup still runs",t=>{
  const first=fixture(t),a=first.open().seedCredential(first.admission);writeFileSync(first.destination,"changed-synthetic-file");assert.throws(()=>a.retireBeforeLaunch(),fixedError);assert.equal(readFileSync(first.destination,"utf8"),"changed-synthetic-file");assert.equal(JSON.parse(readFileSync(first.input,"utf8")).token,canary);
  const second=fixture(t),b=second.open().seedCredential(second.admission);writeFileSync(second.input,JSON.stringify({token:"changed-synthetic-input"}));assert.throws(()=>b.retireBeforeLaunch(),fixedError);assert.equal(existsSync(second.destination),false);assert.equal(JSON.parse(readFileSync(second.input,"utf8")).token,"changed-synthetic-input");
});
test("a genuine owned inert Server must acknowledge and exit before exact secret retirement",async t=>{
  const f=fixture(t,"thin-chrome"),seed=f.open().seedCredential(f.admission);seed.markConsumerLaunch();
  const moduleUrl=pathToFileURL(path.resolve("dev-tools/scripts/qualification/visual-composer/owned-host-shutdown.mjs")).href;
  const script=`import {installOwnedHostShutdown} from ${JSON.stringify(moduleUrl)}; installOwnedHostShutdown("functional-data",{input:process.stdin,output:process.stdout,runId:${JSON.stringify(run)},sourceRevision:${JSON.stringify(source)},shutdown:async()=>{},onSettled:passed=>process.stdout.write("",()=>process.exit(passed?0:1))});process.stdout.write("READY\\n");`;
  const env=createFunctionalHostEnvironment(process.env,f.repo,run,source,"thin-chrome"),child=spawn(process.execPath,["--input-type=module","--eval",script],{cwd:f.repo,env,windowsHide:true,stdio:["pipe","pipe","pipe"]});seed.bindConsumer(child);
  const observer=observeOwnedHostShutdown("functional-data",child,run,source);
  try{
    await once(child.stdout!,"data");assert.throws(()=>seed.retireBeforeLaunch(),fixedError);assert.throws(()=>seed.retireServerAfterStop({status:"stopped"}),fixedError);assert.equal(existsSync(f.destination),true);
    const ack=await observer.stop();assert.throws(()=>seed.retireServerAfterStop({...ack,pid:child.pid!+1}),fixedError);assert.equal(existsSync(f.destination),true);seed.retireServerAfterStop(ack);assert.equal(existsSync(f.destination),false);assert.equal(JSON.parse(readFileSync(f.input,"utf8")).token,canary);
  }finally{if(child.exitCode===null&&child.signalCode===null){const timer=setTimeout(()=>child.kill(),5000);try{await observer.stop();}catch{}finally{clearTimeout(timer);}}}
});
test("actual MJS setup loads the production TS entry explicitly while inactive and plan modes read no credential",t=>{
  const base=path.resolve(tmpdir()),entry=path.resolve("dev-tools/scripts/qualification/tests/fixtures/functional-provider-loader-proof.mjs");
  for(const mode of ["inactive","plan","execute"]){
    const root=mkdtempSync(path.join(base,"provider-loader-"));t.after(()=>{assert.equal(path.dirname(root),base);assert.ok(path.basename(root).startsWith("provider-loader-"));rmSync(root,{recursive:true});});
    const env=createFunctionalHostEnvironment(process.env,root,run,source,"packaged-desktop");env.TEMP=env.TMP=base;
    const result=spawnSync(process.execPath,[entry,root,mode],{cwd:root,env,windowsHide:true,timeout:15_000,maxBuffer:8192,encoding:"utf8"});
    assert.equal(result.status,0);assert.equal(result.stderr,"");const value=JSON.parse(result.stdout);assert.equal(value.schemaVersion,"functional-provider-loader-proof-v1");assert.equal(value.mode,mode);assert.equal(value.loader,"actual-functional-MJS-tsImport");assert.equal(value.networkCalls,0);assert.equal(value.inputUnchanged,true);assert.equal(value.productionFormatVerified,mode==="execute");assert.equal(value.fixtureFileRetired,mode==="execute");assert.equal(mode==="execute"?value.credentialReads>0:value.credentialReads===0,true);assert.doesNotMatch(result.stdout,/synthetic-only|credential\.json|token|sha256/);
  }
});
test("Desktop retirement binds separate launcher and main records after actual inert launcher exit",async t=>{
  const f=fixture(t,"packaged-desktop","provider-publication"),seed=f.open().seedCredential(f.admission);seed.markConsumerLaunch();
  const child=spawn(process.execPath,["--eval",'process.stdin.once("data",()=>process.stdout.write("",()=>process.exit(0)));process.stdout.write("READY\\n");'],{cwd:f.repo,env:createFunctionalHostEnvironment(process.env,f.repo,run,source,"packaged-desktop"),windowsHide:true,stdio:["pipe","pipe","pipe"]});seed.bindConsumer(child);
  try{
    await once(child.stdout!,"data");assert.throws(()=>seed.retireDesktopAfterStop(),fixedError);const stopped=once(child,"close");child.stdin!.end("STOP\n");assert.deepEqual(await stopped,[0,null]);assert.throws(()=>seed.retireDesktopAfterStop(),fixedError);
    const mainPid=child.pid!+10000,ack=path.join(f.root,"qualification-functional-will-quit.json"),report=path.join(f.repo,"artifacts/qualification/visual-composer/runs",run,"functional-source","functional-provider-publication","desktop-shutdown.json");
    writeFileSync(ack,JSON.stringify({pid:mainPid,event:"will-quit"}));mkdirSync(path.dirname(report),{recursive:true});
    const facts={schemaVersion:"real-functional-desktop-main-shutdown-v1",status:"failed",sourceRevision:source,launchedPid:child.pid,mainPid,mainExitCode:0,willQuitAcknowledged:true,modelWorkers:"not-qualified"};
    writeFileSync(report,JSON.stringify({...facts,sourceRevision:`source.${"f".repeat(64)}`}));assert.throws(()=>seed.retireDesktopAfterStop(),fixedError);assert.equal(existsSync(f.destination),true);
    // A separate evidence-publication failure cannot turn a stopped main into
    // a live consumer. This unit checks facts only, never native qualification.
    writeFileSync(report,JSON.stringify(facts));seed.retireDesktopAfterStop();assert.equal(existsSync(f.destination),false);assert.equal(JSON.parse(readFileSync(f.input,"utf8")).token,canary);
  }finally{if(child.exitCode===null&&child.signalCode===null){const closed=once(child,"close"),timer=setTimeout(()=>child.kill(),5000);child.stdin?.end("STOP\n");try{await closed;}finally{clearTimeout(timer);}}}
});
test("a previous Desktop stop report is not adopted as fresh credential-retirement evidence",t=>{
  const f=fixture(t,"packaged-desktop","provider-publication"),report=path.join(f.repo,"artifacts/qualification/visual-composer/runs",run,"functional-source","functional-provider-publication","desktop-shutdown.json");mkdirSync(path.dirname(report),{recursive:true});writeFileSync(report,"old-synthetic-evidence");
  assert.throws(()=>f.open().seedCredential(f.admission),fixedError);assert.equal(existsSync(f.destination),false);assert.equal(readFileSync(report,"utf8"),"old-synthetic-evidence");
});
