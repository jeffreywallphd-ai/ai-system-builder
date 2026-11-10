import test from "node:test";
import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
import path from "node:path";
import functionalHostSetup,{FUNCTIONAL_HOST_SETUP_STAGES,createFunctionalHostSetupFailureTracker,readFunctionalHostSetupFailure} from "../visual-composer/functional-host-global-setup.mjs";
const V=path.resolve("dev-tools/scripts/qualification/visual-composer");
test("named host selectors and journeys use real mounted search, Save, details and workspace controls",async()=>{
  const body=await readFile(path.join(V,"e2e/model-reference-host-journey.ts"),"utf8"),common=await readFile(path.join(V,"e2e/functional-host-common.ts"),"utf8");
  for(const value of ['name:"Search Models"','name:"Browse models"','"Save":"Save reference"','name:"Details"','await page.reload()','"isolation-confirmed"','"original-workspace-confirmed"'])assert.ok(body.includes(value),value);
  assert.doesNotMatch(body,/\.route\(|\.fulfill\(|name:\s*"Download"|saveModelReference\(/);assert.match(common,/api\.listModels\(input\)/);assert.match(common,/fetch\("\/api\/model\/list"/);
  assert.match(common,/includeDiscovered:false,includeSharedStorage:false/);assert.match(common,/result\.nextCursor!==undefined/);assert.doesNotMatch(common,/localPath:m\.localPath|console\.|\.setToken\(/);
  for(const host of ["desktop","thin"]){const text=await readFile(path.resolve(`dev-tools/config/playwright.functional-host-${host}.config.ts`),"utf8");assert.match(text,/workers:1,retries:0/);assert.match(text,/model reference searches, saves and survives reload and workspace changes\$/);assert.match(text,/functional-host-global-setup/);assert.match(text,/screenshot:"off",trace:"off",video:"off"/);}
});
test("functional canonical composition drains owned children before persistence with a fixed separate purpose",async()=>{
  const setup=await readFile(path.join(V,"functional-host-global-setup.mjs"),"utf8"),entry=await readFile(path.join(V,"functional-host-server-entry.ts"),"utf8");
  assert.ok(setup.indexOf("await observer.stop()")<setup.indexOf("await lifecycle.stop()"));assert.match(setup,/observeOwnedHostShutdown\("functional-data",child,runId,source\)/);
  assert.match(setup,/prepareThinClientQualificationIdentity\(plan,"functional-data"\)/);assert.match(setup,/await assertFreshFunctionalHostRoots/);assert.match(setup,/VISUAL_COMPOSER_FUNCTIONAL_METADATA!=="1"/);
  assert.match(entry,/installOwnedHostShutdown\("functional-data"/);assert.match(entry,/shutdownServerResources/);assert.match(entry,/shutdownBackgroundTasks:async/);assert.match(entry,/closePersistence:async/);
  assert.match(entry,/from "\.\/settings-host-listener\.mjs"/);
  assert.match(entry,/await listenQualificationHostOnLoopback\(listener,owner\.config\.port\)/);
  assert.doesNotMatch(entry,/\.listen\(/);
  assert.doesNotMatch(entry,/\.ensureInstalled\(|\.repairInstall\(|setSecret\(|setToken\(/);
});

test("setup diagnostics report only immutable closed stage and native type fields",()=>{
  assert.ok(Object.isFrozen(FUNCTIONAL_HOST_SETUP_STAGES));
  for(const stage of FUNCTIONAL_HOST_SETUP_STAGES){
    const tracker=createFunctionalHostSetupFailureTracker(),error=new TypeError("SYNTHETIC_PRIVATE_ERROR_CANARY");
    assert.ok(Object.isFrozen(tracker));tracker.enter(stage);assert.equal(tracker.remember(error),error);
    const value=readFunctionalHostSetupFailure(error);
    assert.deepEqual(value,{schema_version:"functional-host-setup-failure-v1",stage,stage_available:true,error_type:"TypeError",raw_error_recorded:false,qualification_granted:false});
    assert.ok(Object.isFrozen(value));assert.throws(()=>{value.stage="host-startup";},TypeError);
    assert.equal(JSON.stringify(value).includes("SYNTHETIC_PRIVATE_ERROR_CANARY"),false);
  }
});
test("unregistered forged fields cannot supply an observed setup stage",()=>{
  for(const error of [{stage:"host-startup",error_type:"TypeError"},new Error("SYNTHETIC_CANARY"),null,undefined,false,0,""]){
    const value=readFunctionalHostSetupFailure(error);
    assert.deepEqual(value,{schema_version:"functional-host-setup-failure-v1",stage:"unavailable",stage_available:false,error_type:"Unknown",raw_error_recorded:false,qualification_granted:false});
    assert.ok(Object.isFrozen(value));
  }
});
test("frozen, hostile accessor and revoked proxy errors never invoke user fields",()=>{
  let accesses=0;const forbidden=()=>{accesses++;throw new Error("SYNTHETIC_GETTER_CANARY");};
  const native=new Error("SYNTHETIC_CANARY"),plain={};
  for(const value of [native,plain])for(const key of ["name","message","stack","cause","stage","error_type"])
    Object.defineProperty(value,key,{get:forbidden,configurable:true});
  Object.freeze(native);Object.freeze(plain);
  const proxy=new Proxy({}, {get:forbidden,getPrototypeOf:forbidden,ownKeys:forbidden,getOwnPropertyDescriptor:forbidden});
  const revoked=Proxy.revocable({},{});revoked.revoke();
  for(const [value,expected] of [[native,"Error"],[plain,"Unknown"],[proxy,"Unknown"],[revoked.proxy,"Unknown"]]){
    const tracker=createFunctionalHostSetupFailureTracker();tracker.enter("artifact-read-identity");
    assert.equal(tracker.remember(value),value);assert.equal(readFunctionalHostSetupFailure(value).error_type,expected);
    assert.equal(readFunctionalHostSetupFailure(value).stage,"artifact-read-identity");
  }
  assert.equal(accesses,0);
});
test("remember preserves falsey, frozen and aggregate thrown values without unwrapping",async()=>{
  const primary=Object.freeze(new TypeError("SYNTHETIC_PRIMARY_CANARY"));
  const aggregate=Object.freeze(new AggregateError([primary],"SYNTHETIC_AGGREGATE_CANARY"));
  for(const value of [undefined,null,false,0,"",Object.freeze({}),primary,aggregate]){
    const tracker=createFunctionalHostSetupFailureTracker();tracker.enter("host-startup");let escaped,seen=false;
    try{await(async()=>{try{throw value;}catch(error){throw tracker.remember(error);}})();}catch(error){seen=true;escaped=error;}
    assert.equal(seen,true);assert.equal(escaped,value);
  }
  assert.equal(aggregate.errors[0],primary);assert.equal(readFunctionalHostSetupFailure(aggregate).error_type,"AggregateError");
  assert.equal(readFunctionalHostSetupFailure(aggregate).stage,"host-startup");
});
test("built-in native error prototypes are classified without their names",()=>{
  for(const constructor of [Error,TypeError,RangeError,ReferenceError,SyntaxError,EvalError,URIError,AggregateError]){
    const value=constructor===AggregateError?new constructor([],"SYNTHETIC_CANARY"):new constructor("SYNTHETIC_CANARY");
    const tracker=createFunctionalHostSetupFailureTracker();tracker.remember(value);
    assert.equal(readFunctionalHostSetupFailure(value).error_type,constructor.name);
  }
});
test("invalid stages do not alter a tracker's frontier or another run",()=>{
  const first=createFunctionalHostSetupFailureTracker(),second=createFunctionalHostSetupFailureTracker();first.enter("primary-identity");second.enter("teardown");
  for(const value of ["other","host-startup\0",null,{},undefined,42])assert.throws(()=>first.enter(value),/functional setup stage is invalid/);
  const a=new Error(),b=new Error();first.remember(a);second.remember(b);
  assert.equal(readFunctionalHostSetupFailure(a).stage,"primary-identity");assert.equal(readFunctionalHostSetupFailure(b).stage,"teardown");
  first.enter("host-startup");first.remember(b);assert.equal(readFunctionalHostSetupFailure(b).stage,"host-startup");
  assert.equal(readFunctionalHostSetupFailure(a).stage,"primary-identity");
});
test("real canonical host admission preserves the platform guard before any launch",async()=>{
  const keys=["VISUAL_COMPOSER_FUNCTIONAL_HOST","VISUAL_COMPOSER_FUNCTIONAL_METADATA","VISUAL_COMPOSER_FUNCTIONAL_LOCAL_ARTIFACT","VISUAL_COMPOSER_FUNCTIONAL_PROVIDER_SOURCE","VISUAL_COMPOSER_FUNCTIONAL_PROVIDER_PUBLICATION","VISUAL_COMPOSER_FUNCTIONAL_PROVIDER_CONFIG","VISUAL_COMPOSER_FUNCTIONAL_READY","VISUAL_COMPOSER_FUNCTIONAL_ARTIFACT_READ_BEARER"];
  const before=new Map(keys.map(key=>[key,process.env[key]]));
  try{
    for(const key of keys)delete process.env[key];process.env.VISUAL_COMPOSER_FUNCTIONAL_HOST="1";process.env.VISUAL_COMPOSER_FUNCTIONAL_METADATA="1";
    if(process.platform==="win32"){
      let escaped;try{await functionalHostSetup({projects:[]});}catch(error){escaped=error;}
      assert.ok(escaped instanceof Error);assert.equal(readFunctionalHostSetupFailure(escaped).stage,"admission");
      assert.equal(readFunctionalHostSetupFailure(escaped).qualification_granted,false);
    }else{
      let unsupportedReads=0;
      const unsupported=await functionalHostSetup({get projects(){unsupportedReads++;throw new Error("Unexpected unsupported-host access.");}});
      assert.equal(typeof unsupported,"function");await unsupported();assert.equal(unsupportedReads,0);
    }
    process.env.VISUAL_COMPOSER_FUNCTIONAL_HOST="0";let projectReads=0;
    const inactive=await functionalHostSetup({get projects(){projectReads++;throw new Error("Unexpected admission access.");}});
    assert.equal(typeof inactive,"function");await inactive();assert.equal(projectReads,0);
  }finally{for(const [key,value] of before)value===undefined?delete process.env[key]:process.env[key]=value;}
});
