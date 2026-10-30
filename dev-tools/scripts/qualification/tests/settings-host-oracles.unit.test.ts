import test from "node:test";
import assert from "node:assert/strict";
import {settingsHostIdentity,settingsHostNamespace,settingsHostPhases,settingsHostReport,isSettingsPanelReadBody,SETTINGS_PASSIVE_MODEL} from "../visual-composer/settings-host-oracles";
import {qualifySettingsHostJourney} from "../visual-composer/e2e/settings-host-journey";
import type {Page,TestInfo} from "@playwright/test";
const run="settings-ui-synthetic-20261029",source="source."+"a".repeat(64);
test("a delayed dashboard or foreign request cannot consume the panel-only fault or Refresh observer",()=>{
  for(const body of ["{}"," \n{}\r\n"," ".repeat(4094)+"{}"])assert.equal(isSettingsPanelReadBody(body),true);
  let reads=0;const foreign={get toString(){reads++;throw new Error("synthetic-private-body-getter");}};
  for(const body of [undefined,null,false,0,{},[],foreign,new Proxy({},{ownKeys(){reads++;return [];}}),"","null","false","0","[]","[{}]","{","{}x","\0"," ".repeat(4095)+"{}",JSON.stringify({keys:["runtime.python.defaultDevice","models.default"]}),JSON.stringify({category:"huggingface"}),'{"__proto__":{}}'])
    assert.equal(isSettingsPanelReadBody(body),false);
  assert.equal(reads,0);
});
test("four finite case definitions have distinct phases and only complete exact observations pass",()=>{
  for(const host of ["packaged-desktop","thin-chrome"] as const)for(const scenario of ["public-values","secret-defaults"] as const){
    const phases=settingsHostPhases(host,scenario);assert.ok(phases.length>=6);const report=settingsHostReport(run,source,host,scenario,[...phases],false);
    assert.equal(report.status,"passed");assert.equal(report.parentQualificationGranted,false);assert.equal(settingsHostReport(run,source,host,scenario,phases.slice(0,-1),false).status,"failed");
    assert.equal(settingsHostReport(run,source,host,scenario,[...phases],true).status,"failed");assert.throws(()=>settingsHostReport(run,source,host,scenario,[...phases].reverse(),false));
  }
  assert.ok(settingsHostPhases("thin-chrome","public-values").includes("failed-read-denies-write"));assert.equal(settingsHostPhases("packaged-desktop","public-values").includes("failed-read-denies-write"),false);
});
test("safe namespace is per-run and host; passive default is a reference rather than a model result",()=>{
  assert.match(settingsHostNamespace(run,source,"packaged-desktop"),/^settings-test-[a-f0-9]{16}$/);
  assert.notEqual(settingsHostNamespace(run,source,"packaged-desktop"),settingsHostNamespace(run,source,"thin-chrome"));assert.notEqual(settingsHostNamespace(run,source,"thin-chrome"),settingsHostNamespace(run+"x",source,"thin-chrome"));
  assert.deepEqual(Object.keys(SETTINGS_PASSIVE_MODEL).sort(),["device","inferenceMode","modelId","provider","torchDtype"]);assert.equal(SETTINGS_PASSIVE_MODEL.modelId,"Qwen/Qwen2.5-0.5B-Instruct");
});
test("malformed identities, sparse data, getters and proxies cannot fabricate phase completion",()=>{
  for(const args of [["../run",source,"thin-chrome","public-values"],[run,"worktree","thin-chrome","public-values"],[run,source,"unknown","public-values"],[run,source,"thin-chrome","unknown"]])assert.throws(()=>settingsHostIdentity(...args as [unknown,unknown,unknown,unknown]));
  let reads=0;const getters:string[]=[];Object.defineProperty(getters,"0",{get(){reads++;throw new Error("synthetic-private-detail");}});
  const proxy=new Proxy([],{get(){reads++;throw new Error("synthetic-private-proxy");}});
  for(const phases of [getters,proxy,new Array(2),{},["settings-opened","secret-save-confirmed"]])assert.throws(()=>settingsHostReport(run,source,"thin-chrome","secret-defaults",phases,false));
  assert.equal(reads,0);
});
test("early workspace port failures retain a fixed phase report and expose no private or falsy rejection",async()=>{
  const keys=["VISUAL_COMPOSER_QUALIFICATION_RUN_ID","VISUAL_COMPOSER_QUALIFICATION_SOURCE_REVISION"],prior=keys.map(key=>process.env[key]);
  process.env[keys[0]!]=run;process.env[keys[1]!]=source;
  try{
    for(const mode of ["label","read"] as const)for(const reason of [undefined,null,false,0,"",new Error("synthetic-private-settings-port")]){
      const calls:string[]=[],attachments:string[]=[];
      const page={getByLabel(){calls.push("workspace-label");if(mode==="label")throw reason;return {inputValue(){calls.push("workspace-read");return Promise.reject(reason);}};},getByRole(){calls.push("unexpected-ui-effect");throw new Error("Unexpected UI effect.");}} as unknown as Page;
      const info={project:{name:"thin-chrome"},attach:async(_name:string,value:{body:string})=>{calls.push("safe-report");attachments.push(value.body);}} as unknown as TestInfo;
      await assert.rejects(qualifySettingsHostJourney(page,info,"thin-chrome","public-values"),{message:"Settings functional host journey failed. See its fixed phase report."});
      assert.deepEqual(calls,mode==="label"?["workspace-label","safe-report"]:["workspace-label","workspace-read","safe-report"]);
      assert.equal(attachments.length,1);assert.doesNotMatch(attachments[0]!,/synthetic-private-settings-port/);
      const report=JSON.parse(attachments[0]!);assert.equal(report.status,"failed");assert.deepEqual(report.phases,[]);assert.equal(report.nextPhase,"settings-opened");assert.equal(report.parentQualificationGranted,false);
    }
  }finally{for(let i=0;i<keys.length;i++)if(prior[i]===undefined)delete process.env[keys[i]!];else process.env[keys[i]!]=prior[i];}
});
