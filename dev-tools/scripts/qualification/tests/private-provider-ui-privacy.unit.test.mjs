import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {createRequire} from "node:module";
import {spawnSync} from "node:child_process";
import {runPrivateProviderArtifactBoundary} from "../visual-composer/private-provider-artifact-boundary.mjs";
import Reporter,{summarizePrivateProviderRun} from "../visual-composer/fixed-private-provider-reporter.mjs";
import SyntheticProbeReporter from "./fixtures/private-provider-failure-probe-reporter.mjs";
const root=process.cwd(),here=path.join(root,"dev-tools/scripts/qualification/tests/fixtures"),require=createRequire(import.meta.url);
const title="thin client provider source registers an exact reference and optional localized bytes";
const passed={id:"thin-source",status:"passed",duration_ms:1};
const base={mode:"test",host:"thin-chrome",sourceRequested:true,publicationRequested:false,suiteStatus:"passed",cases:[passed],frameworkErrors:0};
test("recording-free boundary forwards exact missing browser and request options and retires its listener",async()=>{
  let listener,removed,timeout;
  const playwright={_instrumentation:{addListener:x=>{listener=x;},removeListener:x=>{removed=x;}}};
  const options={acceptDownloads:false,viewport:{width:1280,height:720},userAgent:"synthetic-device"};
  await runPrivateProviderArtifactBoundary(playwright,options,async()=>{
    assert.deepEqual(Object.keys(listener).sort(),["runBeforeCreateBrowserContext","runBeforeCreateRequestContext"]);
    const browser={},request={acceptDownloads:true,userAgent:"explicit-option"};
    await listener.runBeforeCreateBrowserContext(browser);await listener.runBeforeCreateRequestContext(request);
    assert.deepEqual(browser,options);assert.deepEqual(request,{...options,acceptDownloads:true,userAgent:"explicit-option"});
  },{project:{timeout:180000},setTimeout:x=>{timeout=x;}});
  assert.equal(timeout,180000);assert.equal(removed,listener);
});
for(const failure of [undefined,null,false,0,""])test("falsey fixture failure remains a failure: "+String(failure),async()=>{
  let added,removed,caught=false;
  try{await runPrivateProviderArtifactBoundary({_instrumentation:{addListener:x=>{added=x;},removeListener:x=>{removed=x;}}},{},async()=>{throw failure;},{project:{timeout:2},setTimeout(){}});}
  catch(error){caught=true;assert.equal(error,failure);}
  assert(caught);assert.equal(removed,added);
});
test("partial listener registration and both errors remain visible",async()=>{
  const primary=new Error("synthetic registration failure"),cleanup=new Error("synthetic removal failure");let added,removed;
  await assert.rejects(runPrivateProviderArtifactBoundary({_instrumentation:{addListener:x=>{added=x;throw primary;},removeListener:x=>{removed=x;throw cleanup;}}},{},async()=>assert.fail("use must not run"),{project:{timeout:2},setTimeout(){}}),error=>error instanceof AggregateError&&error.errors[0]===primary&&error.errors[1]===cleanup);
  assert.equal(removed,added);
});
test("fixed summaries require actual expected outcomes and preserve inactive Desktop skips",()=>{
  assert(summarizePrivateProviderRun(base).local_case_outcomes_satisfied);
  for(const changed of [{cases:[]},{cases:[{...passed,status:"skipped"}]},{cases:[passed,passed]},{frameworkErrors:1},{suiteStatus:"failed"},{mode:"list"},{sourceRequested:false},{cases:[{...passed,id:"unknown"}]}])assert.equal(summarizePrivateProviderRun({...base,...changed}).local_case_outcomes_satisfied,false);
  assert(summarizePrivateProviderRun({...base,host:"packaged-desktop",cases:[{...passed,id:"desktop-source"},{id:"desktop-publication",status:"skipped",duration_ms:0}]}).local_case_outcomes_satisfied);
  assert(summarizePrivateProviderRun({...base,host:"packaged-desktop",publicationRequested:true,cases:[{...passed,id:"desktop-source"},{...passed,id:"desktop-publication"}]}).local_case_outcomes_satisfied);
  assert.throws(()=>summarizePrivateProviderRun({...base,suiteStatus:"arbitrary raw error"}));
});
test("reporter ignores raw payloads, error getters and attachments",()=>{
  const r=new Reporter(),unknown=new Proxy({},{get(){throw new Error("Synthetic raw getter must not execute.");}});
  r.onError(unknown);r.onStdOut(unknown);r.onStdErr(unknown);
  const result={status:"passed",duration:2};Object.defineProperty(result,"errors",{get(){throw new Error("Raw errors must not be inspected.");}});Object.defineProperty(result,"attachments",{get(){throw new Error("Raw attachments must not be inspected.");}});
  r.onTestEnd({title},result);assert.equal(r.frameworkErrors,1);assert.deepEqual(r.cases,[{id:"thin-source",status:"passed",duration_ms:2}]);assert.equal(r.printsToStdio(),true);
});
test("installed reporter composition adds no raw fallback; false metadata reproduces the old integration defect",async()=>{
  const {runnerReporters:{createReporters}}=require(path.join(root,"node_modules/playwright/lib/runner/index.js"));
  const config={configDir:root,config:{rootDir:root,tags:[],reporter:[]}};
  const fixed=path.join(root,"dev-tools/scripts/qualification/visual-composer/fixed-private-provider-reporter.mjs"),control=path.join(here,"private-provider-failure-probe-reporter.mjs");
  for(const mode of ["test","list"]){const actual=await createReporters(config,mode,[[fixed]]);assert.equal(actual.length,1);assert.equal(actual[0].printsToStdio(),true);}
  const prior=process.env.AISB_PRIVATE_PROVIDER_FALLBACK_CONTROL;
  try{process.env.AISB_PRIVATE_PROVIDER_FALLBACK_CONTROL="1";const actual=await createReporters(config,"test",[[control]]);assert.equal(actual.length,2,"installed supplier must reproduce its raw fallback for false metadata");}
  finally{if(prior===undefined)delete process.env.AISB_PRIVATE_PROVIDER_FALLBACK_CONTROL;else process.env.AISB_PRIVATE_PROVIDER_FALLBACK_CONTROL=prior;}
});

test("synthetic reporter refuses real-host inputs before callbacks or zero-case output",()=>{
  const keys=["AISB_PRIVATE_PROVIDER_FAILURE_PROBE","AISB_PRIVATE_PROVIDER_FAILURE_PROBE_ROOT","VISUAL_COMPOSER_FUNCTIONAL_HOST","VISUAL_COMPOSER_FUNCTIONAL_PROVIDER_CONFIG"],prior=Object.fromEntries(keys.map(key=>[key,process.env[key]]));
  const temp=fs.realpathSync(os.tmpdir()),folder=fs.mkdtempSync(path.join(temp,"private-provider-privacy-"));let passed=false;
  try{
    process.env.AISB_PRIVATE_PROVIDER_FAILURE_PROBE="protected";process.env.AISB_PRIVATE_PROVIDER_FAILURE_PROBE_ROOT=folder;
    for(const input of ["host","manifest"]){
      delete process.env.VISUAL_COMPOSER_FUNCTIONAL_HOST;delete process.env.VISUAL_COMPOSER_FUNCTIONAL_PROVIDER_CONFIG;
      if(input==="host")process.env.VISUAL_COMPOSER_FUNCTIONAL_HOST="1";else process.env.VISUAL_COMPOSER_FUNCTIONAL_PROVIDER_CONFIG="synthetic-forbidden-manifest";
      const reporter=new SyntheticProbeReporter();
      assert.throws(()=>reporter.onTestEnd({},{}),/Only isolated synthetic failures/);
      assert.throws(()=>reporter.onEnd({status:"failed"}),/Only isolated synthetic failures/);
      assert.deepEqual(fs.readdirSync(folder),[]);
    }
    passed=true;
  }finally{
    for(const key of keys)if(prior[key]===undefined)delete process.env[key];else process.env[key]=prior[key];
    if(passed){assert.equal(fs.realpathSync(folder),folder);assert.equal(path.dirname(folder),temp);fs.rmdirSync(folder);}
  }
});
test("actual failed no-page supplier runs retain failure and eliminate raw error-context write attempts",{timeout:90000},()=>{
  const cli=require.resolve("@playwright/test/cli"),temp=fs.realpathSync(os.tmpdir());
  for(const [mode,beforeBody,loader] of [["control",false,false],["protected",false,false],["protected",true,false],["control",false,true],["protected",false,true]]){
    const folder=fs.mkdtempSync(path.join(temp,"private-provider-privacy-"));let proven=false;
    const env={};for(const key of ["PATH","PATHEXT","SystemRoot","WINDIR","COMSPEC","SYSTEMDRIVE","PROCESSOR_ARCHITECTURE","NUMBER_OF_PROCESSORS","TEMP","TMP","HOME","USERPROFILE","APPDATA","LOCALAPPDATA"])if(typeof process.env[key]==="string")env[key]=process.env[key];
    Object.assign(env,{NODE_OPTIONS:"",NODE_NO_WARNINGS:"1",TSX_DISABLE_CACHE:"1",PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD:"1",PLAYWRIGHT_NO_COPY_PROMPT:"1",AISB_PRIVATE_PROVIDER_FAILURE_PROBE:mode,AISB_PRIVATE_PROVIDER_FAILURE_PROBE_ROOT:folder,VISUAL_COMPOSER_FUNCTIONAL_PROVIDER_SOURCE:"1"});
    if(beforeBody)env.AISB_PRIVATE_PROVIDER_FAILURE_PROBE_BEFORE_BODY="1";
    if(loader)env.AISB_PRIVATE_PROVIDER_LOADER_PROBE="1";
    try{
      const result=spawnSync(process.execPath,[cli,"test","--config",path.join(here,"private-provider-failure-probe.config.mjs")],{cwd:root,env,windowsHide:true,timeout:30000,maxBuffer:65536,encoding:"utf8"});
      assert.equal(result.error,undefined);assert.equal(result.signal,null);assert.equal(result.status,1);assert.equal(result.stderr,"");assert(!result.stdout.includes("SYNTHETIC_PRIVATE_FAILURE_CANARY"));
      const worker=JSON.parse(fs.readFileSync(path.join(folder,"worker-observation.json"),"utf8")),reporter=JSON.parse(fs.readFileSync(path.join(folder,"reporter-observation.json"),"utf8"));
      if(loader){const loaded=JSON.parse(fs.readFileSync(path.join(folder,"loader-observation.json"),"utf8"));assert.deepEqual(loaded,{schema_version:"private-provider-inert-loader-v1",actual_mjs_ts_loader_returned:true,definition_exports_available:true,executing_fixture_opened:false,network_calls:0});}
      assert.equal(worker.mode,mode);assert.equal(worker.no_browser_requested,true);assert.equal(worker.no_credentials_read,true);
      assert.equal(worker.body_entered,!beforeBody);
      assert.equal(reporter.expected_body_errors,beforeBody?0:1);assert.equal(reporter.synthetic_error_compared,true);assert.equal(reporter.raw_error_persisted,false);
      assert.equal(reporter.cases.length,1,"the fixed reporter must retain the actual failed case result");
      const deliberateBodyFailureProved=worker.body_entered===true&&reporter.expected_body_errors===1;
      assert.equal(deliberateBodyFailureProved,!beforeBody,"a setup failure must not count as evidence for the deliberate body failure");
      if(mode==="protected"){
        assert.equal(reporter.error_count,1,"the protected failure must not hide an unrelated fixture failure");
        assert.equal(reporter.framework_errors,0,`the protected fixture must preserve the deliberate failure without a framework error; synthetic fixture setups=${worker.fixture_setup_count}`);
      }
      if(mode==="control")assert(worker.error_context_write_attempts>0,"positive control must reach the real supplier writer");else assert.equal(worker.error_context_write_attempts,0);
      assert.equal(reporter.suite_status,"failed");assert.equal(reporter.cases.length,1);assert.equal(reporter.cases[0].status,"failed");
      const outputs=fs.readdirSync(folder,{recursive:true});assert(outputs.length<=64);assert(!outputs.some(name=>String(name).endsWith("error-context.md")));
      proven=true;
    }finally{
      // Retain uncertain/failed probe evidence. Only this exact new generated
      // synthetic directory is eligible for cleanup after observed root exit.
      if(proven){assert.equal(fs.realpathSync(folder),folder);assert.equal(path.dirname(folder),temp);assert(path.basename(folder).startsWith("private-provider-privacy-"));fs.rmSync(folder,{recursive:true});}
    }
  }
});
