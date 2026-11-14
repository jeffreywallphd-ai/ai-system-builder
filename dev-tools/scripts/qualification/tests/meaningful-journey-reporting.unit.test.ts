// @vitest-environment node
import {beforeEach,afterEach,expect,it,vi} from "vitest";
import type {Page} from "@playwright/test";
import {buildMeaningfulSystem,type MeaningfulSystemCase} from "../visual-composer/e2e/meaningful-system-journeys";
import {createHash} from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import {spawnSync} from "node:child_process";
import {pathToFileURL} from "node:url";

const scenario:MeaningfulSystemCase={id:"request-intake",name:"Synthetic system",purpose:"Synthetic setup failure fixture",elements:[]};
async function caught(action:()=>Promise<unknown>){try{await action();return undefined;}catch(error){return error;}}
beforeEach(()=>{vi.stubEnv("VISUAL_COMPOSER_QUALIFICATION_SOURCE_REVISION","source."+"a".repeat(64));});
afterEach(()=>{vi.unstubAllEnvs();});
function page(options:{on?:unknown[];evaluate?:unknown[];off?:unknown[]}={}){
  let bindings=0,unbindings=0,evaluations=0,actions=0;let handler:unknown,removed:unknown;
  const target={on:(_event:string,value:unknown)=>{bindings++;handler=value;if(options.on?.length)throw options.on.shift();},
    off:(_event:string,value:unknown)=>{unbindings++;removed=value;if(options.off?.length)throw options.off.shift();},
    evaluate:async()=>{evaluations++;if(options.evaluate?.length)throw options.evaluate.shift();},
    getByLabel:()=>{actions++;throw new Error("Synthetic first UI action.");}} as unknown as Page;
  return {target,read:()=>({bindings,unbindings,evaluations,actions,handler,removed})};
}
it.each([undefined,null,false,0,""])("initial listener failure %# remains visible and cleanup still runs",async failure=>{
  const fixture=page({on:[failure]}),saved:Record<string,unknown>[]=[];
  const error=await caught(()=>buildMeaningfulSystem(fixture.target,scenario,async()=>undefined,async report=>{saved.push(structuredClone(report));}));
  expect(error).toBeInstanceOf(AggregateError);expect((error as AggregateError).errors).toEqual([failure]);
  const result=fixture.read();expect(result.bindings).toBe(1);expect(result.unbindings).toBe(1);expect(result.actions).toBe(0);
  expect(result.removed).toBe(result.handler);expect(saved).toHaveLength(1);expect(saved[0]!.status).toBe("failed");expect(saved[0]!.totalMs).toBe(0);
});
it("observer setup failure retains the primary error and detaches the owned listener",async()=>{
  const fixture=page({evaluate:[false]}),saved:Record<string,unknown>[]=[];
  const error=await caught(()=>buildMeaningfulSystem(fixture.target,scenario,async()=>undefined,async report=>{saved.push(structuredClone(report));}));
  expect(error).toBeInstanceOf(AggregateError);expect((error as AggregateError).errors).toEqual([false]);
  expect(fixture.read().unbindings).toBe(1);expect(fixture.read().evaluations).toBe(2);expect(fixture.read().actions).toBe(0);
  expect(saved[0]!.status).toBe("failed");expect(Number(saved[0]!.totalMs)).toBeGreaterThanOrEqual(0);
});
it("initial record failure does not reach the UI or hide failed evidence",async()=>{
  const fixture=page(),saved:Record<string,unknown>[]=[];let records=0;
  const error=await caught(()=>buildMeaningfulSystem(fixture.target,scenario,async()=>undefined,async report=>{if(++records===1)throw undefined;saved.push(structuredClone(report));}));
  expect(error).toBeInstanceOf(AggregateError);expect((error as AggregateError).errors).toEqual([undefined]);
  expect(records).toBe(2);expect(fixture.read().actions).toBe(0);expect(fixture.read().unbindings).toBe(1);
  expect(saved[0]!.status).toBe("failed");
});
it("observer/listener cleanup and failed record recovery preserve every error",async()=>{
  const fixture=page({evaluate:[undefined,false],off:[null]});let records=0;
  const error=await caught(()=>buildMeaningfulSystem(fixture.target,scenario,async()=>undefined,async()=>{records++;throw records===1?0:"";}));
  expect(error).toBeInstanceOf(AggregateError);expect((error as AggregateError).errors).toEqual([undefined,false,null,0,""]);
  expect(records).toBe(2);expect(fixture.read().unbindings).toBe(1);
});
it("a first UI failure records running then failed facts without private exception content",async()=>{
  const fixture=page(),saved:Record<string,unknown>[]=[];
  const error=await caught(()=>buildMeaningfulSystem(fixture.target,scenario,async()=>undefined,async report=>{saved.push(structuredClone(report));}));
  expect(error).toBeInstanceOf(AggregateError);expect(saved.map(report=>report.status)).toEqual(["running","failed"]);
  expect(JSON.stringify(saved)).not.toContain("Synthetic first UI action.");expect(fixture.read().unbindings).toBe(1);
  expect(fixture.read().actions).toBe(1);
});

// This reporting guard is intentionally outside the census's source inventory.
// Definitions and Git witnesses are data; importing the validator runs no hosts.
interface CensusMap {
  source_baseline:string;
  sources:Array<{path:string;facts:Record<string,unknown>;committed_sha256:string}>;
  scenarios:Array<{execution_status:string;[key:string]:unknown}>;
  [key:string]:unknown;
}
interface CensusResult {
  scenario_count:number;behavior_links:number;source_files:number;current_host_spec_files:number;inventory_groups:number;
  definition_map_valid:boolean;executed_tests:number;actual_host_pass:boolean;parent_qualification_granted:boolean;full_testing_status:string;
  gaps:Array<{kind:string;source?:string}>;
}
interface CensusApi {
  repositoryReader(root:string):(name:string)=>Buffer;
  sourceFacts(name:string,bytes:Uint8Array):Record<string,unknown>;
  validateCensus(input:{mapText:string;ledgerText:string;discoveryText:string;readSource:(name:string)=>Buffer;hostSpecPaths:string[]}):CensusResult;
}
interface CensusHistory {
  schema_version:string;scope:string;roadmap_id:string;prior_commit:string;prior_census_path:string;
  prior_census_git_sha256:string;prior_census_working_sha256:string;prior_source_baseline:string;source_baseline:string;
  old_archive:{path:string;sha256:string;bytes:number};reason:string;preserved_fields_sha256:string;
  prior_history?:{path:string;sha256:string;bytes:number};
  preserved_histories?:Array<{path:string;sha256:string;bytes:number}>;
  qualification_effect:{executed_tests:number;actual_host_pass:boolean;parent_qualification_granted:boolean;full_testing_status:string};
  sources:Array<{path:string;prior_row_sha256:string;prior_row:CensusMap["sources"][number];current_row_sha256:string}>;
}
const root=path.resolve(__dirname,"../../../.."),censusPath="docs/operations/comprehensive-ui-automation-current-census.json";
const navigationHistoryPath="docs/operations/comprehensive-ui-automation-navigation-census-history.json";
const notificationReferenceHistoryPath="docs/operations/comprehensive-ui-automation-notification-reference-census-history.json";
const historyPath="docs/operations/comprehensive-ui-automation-operational-census-history.json";
const oldHistoryPath="docs/operations/comprehensive-ui-automation-census-source-history.json";
const diagnosticHistoryPath="docs/operations/comprehensive-ui-automation-contrast-diagnostics-census-history.json";
const diagnosticBaseline="1e5fd6b76e30025b4571787573b09a3f8b413103";
const contrastV2HistoryPath="docs/operations/comprehensive-ui-automation-contrast-v2-census-history.json";
const contrastV2Baseline="abdc24509d7cec4aa7013fe5ec369fecb5cf95f0";
const contrastRegionsHistoryPath="docs/operations/comprehensive-ui-automation-contrast-regions-census-history.json";
const contrastRegionsBaseline="6d0e47cdf158622844df28dc9583fe610c6ab096";
const shellOverlapHistoryPath="docs/operations/comprehensive-ui-automation-shell-overlap-census-history.json";
const shellOverlapBaseline="51d299494bd217ac90c110a4fccc089cf8b945d8";
const shellOverlapHistoricalMap="3e9873fb30238eb3446bc685c423005a4db09117";
const responsiveHistoryPath="docs/operations/comprehensive-ui-automation-responsive-journey-census-history.json";
const responsivePriorCommit="608679a6095ef5617921e504bf208858df6a7c49";
const disclosureHistoryPath="docs/operations/comprehensive-ui-automation-disclosure-census-history.json";
const disclosurePriorCommit="5698219870d571c9747807c25e480c9941d936f8";
const startupHistoryPath="docs/operations/comprehensive-ui-automation-startup-diagnostics-census-history.json";
const startupPriorCommit="fe875ca050a47cc74bdec086f54105327b136d30";
const modelStartupReportHistoryPath="docs/operations/comprehensive-ui-automation-model-startup-report-census-history.json";
const modelStartupReportPriorCommit="59545794f97ec030f2ef3484c7d07dda501bdd97";
const privateProviderPrivacyHistoryPath="docs/operations/comprehensive-ui-automation-private-test-privacy-census-history.json";
const privateProviderPrivacyPriorCommit="26000fe16c1eab3b1f071960493c40b30a264fc4";
const workspaceSwitchHistoryPath="docs/operations/comprehensive-ui-automation-workspace-switch-census-history.json";
const workspaceSwitchPriorCommit="f62aa7176eccfb065eab27ea56edf6bbb1bc0dbc";
const workspaceSwitchCompletedCommit="75efdd2456f67757fd07b749dd398128af969e03";
const originalDefinitionBaseline="be0a48e241ca94d1ad18fda89ffa8f095d98e56c";
const publishedFormHostCommit="b79a006a51358cb03cc7f5a289e2769869ed3d34";
const publishedFormHostSources=new Set([
  "dev-tools/scripts/qualification/visual-composer/e2e/managed-reference-form-composer.e2e.spec.ts",
  "dev-tools/scripts/qualification/visual-composer/e2e/packaged-desktop-form-composer.e2e.spec.ts",
]);
const packagedHeadlessSource="dev-tools/scripts/qualification/visual-composer/e2e/packaged-desktop-headless.e2e.spec.ts";
const packagedHeadlessOriginalCommit="6ce8b3255a935f3a02e65f902a2989b31a417bf6";
const packagedHeadlessLatestBaseline="a1894a3a13a013bfb25d12ddae1c074923216b34";
const reviewReferenceSources=[
  "dev-tools/scripts/testing/control-plane-guard.unit.test.mjs",
  "dev-tools/scripts/qualification/visual-composer/e2e/review-site-journey.ts",
  "dev-tools/scripts/qualification/visual-composer/review-site-oracles.ts",
  "dev-tools/scripts/qualification/tests/review-site-oracles.unit.test.ts",
];
const workspaceSwitchSources=[
  "dev-tools/scripts/qualification/visual-composer/e2e/provider-source-host-journey.ts",
  "dev-tools/scripts/qualification/visual-composer/e2e/artifact-lifecycle-host-journey.ts",
  "dev-tools/scripts/qualification/visual-composer/e2e/model-reference-host-journey.ts",
];
const privateProviderPrivacySources=[
  "dev-tools/scripts/qualification/visual-composer/e2e/packaged-desktop-operational-ui.e2e.spec.ts",
  "dev-tools/scripts/qualification/visual-composer/e2e/thin-client-operational-ui.e2e.spec.ts",
];
const modelStartupReportSources=[
  "apps/desktop/src/renderer/features/models/tests/desktop-model-download-preload.ui.test.tsx",
  "apps/desktop/src/renderer/features/python-runtime/tests/desktop-python-runtime-client.unit.test.ts",
  "apps/desktop/src/renderer/features/python-runtime/tests/python-runtime-controls.recovery.ui.test.tsx",
  "dev-tools/scripts/qualification/tests/native-data-context-admission.unit.test.ts",
];
const responsiveSources=["apps/desktop/src/renderer/features/models/tests/desktop-training-preload.ui.test.tsx",
  "dev-tools/scripts/qualification/tests/critical-surface-accessibility.unit.test.ts",
  "dev-tools/scripts/qualification/visual-composer/e2e/packaged-desktop-dataset-versions.e2e.spec.ts",
  "dev-tools/scripts/qualification/visual-composer/e2e/thin-client-dataset-versions.e2e.spec.ts"];
const diagnosticSources=["dev-tools/scripts/qualification/tests/critical-surface-accessibility.unit.test.ts",
  "dev-tools/scripts/qualification/tests/technical-accessibility-observation.unit.test.ts",
  "dev-tools/scripts/qualification/visual-composer/e2e/technical-accessibility.ts"];
const sha=(value:Buffer|string)=>createHash("sha256").update(value).digest("hex");
const jsonSha=(value:unknown)=>sha(JSON.stringify(value));
const gitCache=new Map<string,Buffer>();
function primeGitSources(commit:string,names:string[]) {
  if(!/^[a-f0-9]{40}$/.test(commit)||names.length>192||new Set(names).size!==names.length||names.some(name=>name.length>240||!/^(apps|modules|dev-tools|docs)\/[A-Za-z0-9_./-]+$/.test(name)||name.split("/").some(part=>!part||part === "."||part === "..")))throw new Error("Invalid UI definition Git witness.");
  const pending=names.map(name=>commit+":"+name).filter(key=>!gitCache.has(key));if(!pending.length)return;
  const env={...process.env};for(const key of Object.keys(env))if(key.toUpperCase().startsWith("GIT_"))delete env[key];
  Object.assign(env,{GIT_CONFIG_NOSYSTEM:"1",GIT_NO_REPLACE_OBJECTS:"1",GIT_OPTIONAL_LOCKS:"0"});
  // One read-only Git process avoids per-file startup cost on lightweight PCs.
  // Parse exact blob lengths; source bytes can contain newlines or header text.
  const maximum=32*1024*1024+192*256;
  const result=spawnSync("git",["cat-file","--batch"],{cwd:root,env,windowsHide:true,timeout:20_000,maxBuffer:maximum,input:pending.join("\n")+"\n"});
  if(result.error||result.status!==0||!Buffer.isBuffer(result.stdout)||result.stdout.length>maximum)throw new Error("UI definition Git witness is unavailable.");
  const copies=new Map<string,Buffer>();let offset=0,total=0;
  for(const key of pending) {
    const end=result.stdout.indexOf(10,offset);
    if(end<offset||end-offset>200)throw new Error("UI definition Git witness is unavailable.");
    const header=/^[a-f0-9]{40,64} blob (0|[1-9][0-9]*)$/.exec(result.stdout.subarray(offset,end).toString("ascii")),size=header?Number(header[1]):NaN;
    if(!Number.isSafeInteger(size)||size<0||size>512*1024||total+size>32*1024*1024||end+1+size>=result.stdout.length||result.stdout[end+1+size]!==10)throw new Error("UI definition Git witness is unavailable.");
    copies.set(key,Buffer.from(result.stdout.subarray(end+1,end+1+size)));total+=size;offset=end+size+2;
  }
  if(offset!==result.stdout.length||copies.size!==pending.length)throw new Error("UI definition Git witness is unavailable.");
  for(const[key,bytes]of copies)gitCache.set(key,bytes);
}
function gitSource(commit:string,name:string):Buffer {
  primeGitSources(commit,[name]);return gitCache.get(commit+":"+name)!;
}
async function censusBundle() {
  const api=await import(pathToFileURL(path.join(root,"dev-tools/helpers/ui_coverage_census.mjs")).href) as CensusApi;
  const read=api.repositoryReader(root),map=JSON.parse(read(censusPath).toString("utf8")) as CensusMap;
  const folder="dev-tools/scripts/qualification/visual-composer/e2e/";
  return {api,read,map,ledgerText:read("docs/operations/comprehensive-ui-automation-coverage.json").toString("utf8"),
    discoveryText:read("docs/operations/comprehensive-ui-automation-discovery.json").toString("utf8"),
    hostSpecPaths:fs.readdirSync(path.join(root,folder)).filter(name=>name.endsWith(".e2e.spec.ts")).map(name=>folder+name).sort()};
}
type CensusBundle=Awaited<ReturnType<typeof censusBundle>>;
function originalCensusRows(bundle:CensusBundle,map:CensusMap) {
  // These two host definitions arrived after the retained baseline. Authenticate
  // their exact later source while keeping their baseline drift visible.
  return map.sources.filter(row=>{
    if(map.source_baseline===originalDefinitionBaseline && row.path===packagedHeadlessSource) {
      const original=bundle.api.sourceFacts(row.path,gitSource(packagedHeadlessOriginalCommit,row.path));
      const historical=JSON.parse(gitSource(packagedHeadlessLatestBaseline,censusPath).toString("utf8")) as CensusMap;
      const prior=historical.sources.find(source=>source.path===row.path);
      if(prior?.committed_sha256!==original.sha256||row.committed_sha256!==original.sha256||
          !["4af822bfed55376be4f7f81dd3924dd1ecc848726842ac8ce1ef0aa8582f8c93",
            "205d01b56f5e64bfecd6d77f0efb5b8a5d4cea232522a3e587dfdd43de7d4ae9",
            "e0bf28e6f84706bcf55d47457174fdc31946f415e5938ad852143556b38658de"].includes(jsonSha(row.facts))) {
        throw new Error("UI definition Git pin does not match its reviewed Headless source version.");
      }
      return false;
    }
    if(map.source_baseline!==originalDefinitionBaseline||!publishedFormHostSources.has(row.path))return true;
    if(row.committed_sha256!=="0".repeat(64)||
        jsonSha(row.facts)!==jsonSha(bundle.api.sourceFacts(row.path,gitSource(publishedFormHostCommit,row.path)))) {
      throw new Error("UI definition Git pin does not match its published Form source version.");
    }
    return false;
  });
}
function checkedCensus(bundle:CensusBundle,map:CensusMap) {
  const result=bundle.api.validateCensus({mapText:JSON.stringify(map),ledgerText:bundle.ledgerText,discoveryText:bundle.discoveryText,readSource:bundle.read,hostSpecPaths:bundle.hostSpecPaths});
  // Canonical mismatch is deliberately a drift result. Authenticate the Git
  // pin separately so a forged pin cannot inherit a source-only validity flag.
  const originalRows=originalCensusRows(bundle,map);
  primeGitSources(map.source_baseline,originalRows.map(row=>row.path));
  for(const row of originalRows) {
    const text=new TextDecoder("utf-8",{fatal:true}).decode(gitSource(map.source_baseline,row.path)).replace(/\r\n/g,"\n");
    if(row.committed_sha256!==sha(text))throw new Error("UI definition Git pin does not match its source version.");
  }
  return result;
}
function invariantFields(map:CensusMap) {const value:Record<string,unknown>={...map};delete value.sources;delete value.source_baseline;return value;}
function checkedHistory(bundle:CensusBundle,map:CensusMap,history:CensusHistory,changedCount=10) {
  expect(history.schema_version).toBe("historical-ui-census-update-v1");expect(history.scope).toBe("historical-source-update-only-no-execution");
  expect(history.roadmap_id).toBe("comprehensive-ui-automation");expect(history.prior_census_path).toBe(censusPath);
  const previousBytes=gitSource(history.prior_commit,censusPath),previous=JSON.parse(previousBytes.toString("utf8")) as CensusMap;
  expect(history.prior_census_git_sha256).toBe(sha(previousBytes));expect(history.prior_census_working_sha256).toBe(sha(previousBytes));
  expect(history.prior_source_baseline).toBe(previous.source_baseline);expect(history.source_baseline).toBe(map.source_baseline);
  expect(invariantFields(map)).toEqual(invariantFields(previous));expect(history.preserved_fields_sha256).toBe(jsonSha(invariantFields(previous)));
  expect(history.old_archive).toEqual({path:oldHistoryPath,sha256:sha(bundle.read(oldHistoryPath)),bytes:bundle.read(oldHistoryPath).length});
  expect(history.qualification_effect).toEqual({executed_tests:0,actual_host_pass:false,parent_qualification_granted:false,full_testing_status:"deferred-by-user"});
  expect(history.reason.length).toBeGreaterThan(0);expect(Buffer.byteLength(JSON.stringify(history))).toBeLessThanOrEqual(512*1024);
  expect(map.sources.map(row=>row.path)).toEqual(previous.sources.map(row=>row.path));
  const changed=previous.sources.filter((row,index)=>JSON.stringify(row)!==JSON.stringify(map.sources[index]));
  expect(changed).toHaveLength(changedCount);expect(history.sources.map(row=>row.path)).toEqual(changed.map(row=>row.path));
  for(const entry of history.sources) {
    expect(entry.prior_row).toEqual(previous.sources.find(row=>row.path === entry.path));
    expect(entry.prior_row_sha256).toBe(jsonSha(entry.prior_row));expect(entry.current_row_sha256).toBe(jsonSha(map.sources.find(row=>row.path === entry.path)));
  }
}
function historicalOperationalMap() {return JSON.parse(gitSource(diagnosticBaseline,censusPath).toString("utf8")) as CensusMap;}
function checkedDiagnosticHistory(bundle:CensusBundle,map:CensusMap,history:CensusHistory) {
  expect(Object.keys(history).sort()).toEqual(["schema_version","scope","roadmap_id","prior_commit","prior_census_path",
    "prior_census_git_sha256","prior_census_working_sha256","prior_source_baseline","source_baseline","old_archive","prior_history",
    "reason","preserved_fields_sha256","qualification_effect","sources"].sort());
  expect(history.prior_commit).toBe(diagnosticBaseline);expect(history.source_baseline).toBe(diagnosticBaseline);
  checkedHistory(bundle,map,history,3);expect(history.sources.map(row=>row.path)).toEqual(diagnosticSources);
  const prior=bundle.read(historyPath),committed=gitSource(diagnosticBaseline,historyPath);
  expect(prior).toEqual(committed);expect(history.prior_history).toEqual({path:historyPath,sha256:sha(prior),bytes:prior.length});
  for(const name of diagnosticSources) {const row=map.sources.find(row=>row.path===name)!;expect(row.facts.sha256).not.toBe(row.committed_sha256);}
}
function historicalDiagnosticMap() {return JSON.parse(gitSource(contrastV2Baseline,censusPath).toString("utf8")) as CensusMap;}
function checkedContrastV2History(bundle:CensusBundle,map:CensusMap,history:CensusHistory) {
  expect(Object.keys(history).sort()).toEqual(["schema_version","scope","roadmap_id","prior_commit","prior_census_path",
    "prior_census_git_sha256","prior_census_working_sha256","prior_source_baseline","source_baseline","old_archive","prior_history",
    "reason","preserved_fields_sha256","qualification_effect","sources"].sort());
  expect(history.prior_commit).toBe(contrastV2Baseline);expect(history.source_baseline).toBe(contrastV2Baseline);
  checkedHistory(bundle,map,history,3);expect(history.sources.map(row=>row.path)).toEqual(diagnosticSources);
  const prior=bundle.read(diagnosticHistoryPath),committed=gitSource(contrastV2Baseline,diagnosticHistoryPath);
  expect(prior).toEqual(committed);expect(history.prior_history).toEqual({path:diagnosticHistoryPath,sha256:sha(prior),bytes:prior.length});
  for(const name of [oldHistoryPath,historyPath])expect(bundle.read(name)).toEqual(gitSource(contrastV2Baseline,name));
  for(const name of diagnosticSources) {const row=map.sources.find(row=>row.path===name)!;expect(row.facts.sha256).not.toBe(row.committed_sha256);}
}
function historicalContrastV2Map() {
  return JSON.parse(gitSource(contrastRegionsBaseline,censusPath).toString("utf8")) as CensusMap;
}
function checkedRegionHistory(bundle:CensusBundle,map:CensusMap,history:CensusHistory,baseline:string,priorPath:string) {
  expect(Object.keys(history).sort()).toEqual(["schema_version","scope","roadmap_id","prior_commit","prior_census_path",
    "prior_census_git_sha256","prior_census_working_sha256","prior_source_baseline","source_baseline","old_archive","prior_history",
    "reason","preserved_fields_sha256","qualification_effect","sources"].sort());
  expect(history.prior_commit).toBe(baseline);expect(history.source_baseline).toBe(baseline);
  checkedHistory(bundle,map,history,3);expect(history.sources.map(row=>row.path)).toEqual(diagnosticSources);
  const prior=bundle.read(priorPath);
  expect(history.prior_history).toEqual({path:priorPath,sha256:sha(prior),bytes:prior.length});
  for(const name of new Set([oldHistoryPath,historyPath,diagnosticHistoryPath,contrastV2HistoryPath,priorPath])) {
    expect(bundle.read(name)).toEqual(gitSource(baseline,name));
  }
  for(const name of diagnosticSources) {
    const row=map.sources.find(row=>row.path===name)!;
    expect(row.facts.sha256).not.toBe(row.committed_sha256);
  }
}
function historicalContrastRegionsMap() {
  return JSON.parse(gitSource(shellOverlapBaseline,censusPath).toString("utf8")) as CensusMap;
}
function historicalShellOverlapMap() {
  return JSON.parse(gitSource(shellOverlapHistoricalMap,censusPath).toString("utf8")) as CensusMap;
}
function checkedResponsiveHistory(bundle:CensusBundle,map:CensusMap,history:CensusHistory) {
  expect(Object.keys(history).sort()).toEqual(["schema_version","scope","roadmap_id","prior_commit","prior_census_path",
    "prior_census_git_sha256","prior_census_working_sha256","prior_source_baseline","source_baseline","old_archive","prior_history",
    "preserved_histories","reason","preserved_fields_sha256","qualification_effect","sources"].sort());
  expect(history.prior_commit).toBe(responsivePriorCommit);
  // The prior map retained two later pins under its older declared baseline.
  // Current pins all bind to actual608 blobs; preserve the original map as history.
  expect(history.source_baseline).toBe(responsivePriorCommit);
  expect(history.prior_source_baseline).toBe(shellOverlapBaseline);
  checkedHistory(bundle,map,history,6);
  expect(history.sources.map(row=>row.path)).toEqual([...new Set([...responsiveSources,...diagnosticSources])].sort());
  const paths=[oldHistoryPath,historyPath,diagnosticHistoryPath,contrastV2HistoryPath,contrastRegionsHistoryPath,shellOverlapHistoryPath];
  const preserved=paths.map(name=>{
    const bytes=bundle.read(name);expect(bytes).toEqual(gitSource(responsivePriorCommit,name));
    return {path:name,sha256:sha(bytes),bytes:bytes.length};
  });
  expect(history.preserved_histories).toEqual(preserved);
  expect(history.prior_history).toEqual(preserved.at(-1));
}
function historicalResponsiveMap() {return JSON.parse(gitSource(disclosurePriorCommit,censusPath).toString("utf8")) as CensusMap;}
function checkedDisclosureHistory(bundle:CensusBundle,map:CensusMap,history:CensusHistory) {
  expect(Object.keys(history).sort()).toEqual(["schema_version","scope","roadmap_id","prior_commit","prior_census_path",
    "prior_census_git_sha256","prior_census_working_sha256","prior_source_baseline","source_baseline","old_archive","prior_history",
    "reason","preserved_fields_sha256","qualification_effect","sources"].sort());
  expect(history.prior_commit).toBe(disclosurePriorCommit);expect(history.source_baseline).toBe(responsivePriorCommit);
  checkedHistory(bundle,map,history,1);
  expect(history.sources.map(row=>row.path)).toEqual(["dev-tools/scripts/qualification/tests/critical-surface-accessibility.unit.test.ts"]);
  const prior=bundle.read(responsiveHistoryPath);expect(prior).toEqual(gitSource(disclosurePriorCommit,responsiveHistoryPath));
  expect(history.prior_history).toEqual({path:responsiveHistoryPath,sha256:sha(prior),bytes:prior.length});
  const preceding=historicalResponsiveMap();
  for(const [index,row] of map.sources.entries())expect(row.committed_sha256).toBe(preceding.sources[index]!.committed_sha256);
}
function historicalDisclosureMap() {return JSON.parse(gitSource(startupPriorCommit,censusPath).toString("utf8")) as CensusMap;}
function checkedStartupHistory(bundle:CensusBundle,map:CensusMap,history:CensusHistory) {
  expect(Object.keys(history).sort()).toEqual(["schema_version","scope","roadmap_id","prior_commit","prior_census_path",
    "prior_census_git_sha256","prior_census_working_sha256","prior_source_baseline","source_baseline","old_archive","prior_history",
    "reason","preserved_fields_sha256","qualification_effect","sources"].sort());
  expect(history.prior_commit).toBe(startupPriorCommit);expect(history.source_baseline).toBe(responsivePriorCommit);
  checkedHistory(bundle,map,history,1);
  expect(history.sources.map(row=>row.path)).toEqual(["dev-tools/scripts/qualification/tests/critical-surface-accessibility.unit.test.ts"]);
  const prior=bundle.read(disclosureHistoryPath);expect(prior).toEqual(gitSource(startupPriorCommit,disclosureHistoryPath));
  expect(history.prior_history).toEqual({path:disclosureHistoryPath,sha256:sha(prior),bytes:prior.length});
  const preceding=historicalDisclosureMap();
  for(const[index,row]of map.sources.entries())expect(row.committed_sha256).toBe(preceding.sources[index]!.committed_sha256);
}
function historicalStartupMap() {return JSON.parse(gitSource(modelStartupReportPriorCommit,censusPath).toString("utf8")) as CensusMap;}
function checkedModelStartupReportHistory(bundle:CensusBundle,map:CensusMap,history:CensusHistory) {
  expect(Object.keys(history).sort()).toEqual(["schema_version","scope","roadmap_id","prior_commit","prior_census_path",
    "prior_census_git_sha256","prior_census_working_sha256","prior_source_baseline","source_baseline","old_archive","prior_history",
    "reason","preserved_fields_sha256","qualification_effect","sources"].sort());
  expect(history.prior_commit).toBe(modelStartupReportPriorCommit);expect(history.source_baseline).toBe(responsivePriorCommit);
  checkedHistory(bundle,map,history,4);
  expect(history.sources.map(row=>row.path)).toEqual(modelStartupReportSources);
  const prior=bundle.read(startupHistoryPath);expect(prior).toEqual(gitSource(modelStartupReportPriorCommit,startupHistoryPath));
  expect(history.prior_history).toEqual({path:startupHistoryPath,sha256:sha(prior),bytes:prior.length});
  const preceding=historicalStartupMap();
  expect(map.sources).toHaveLength(180);
  for(const[index,row]of map.sources.entries())expect(row.committed_sha256).toBe(preceding.sources[index]!.committed_sha256);
}
function historicalModelStartupReportMap() {return JSON.parse(gitSource(privateProviderPrivacyPriorCommit,censusPath).toString("utf8")) as CensusMap;}
function historicalPrivateProviderPrivacyMap() {return JSON.parse(gitSource(workspaceSwitchPriorCommit,censusPath).toString("utf8")) as CensusMap;}
function checkedPrivateProviderPrivacyHistory(bundle:CensusBundle,map:CensusMap,history:CensusHistory) {
  expect(Object.keys(history).sort()).toEqual(["schema_version","scope","roadmap_id","prior_commit","prior_census_path",
    "prior_census_git_sha256","prior_census_working_sha256","prior_source_baseline","source_baseline","old_archive","prior_history",
    "reason","preserved_fields_sha256","qualification_effect","sources"].sort());
  expect(history.prior_commit).toBe(privateProviderPrivacyPriorCommit);expect(history.source_baseline).toBe(responsivePriorCommit);
  checkedHistory(bundle,map,history,2);expect(history.sources.map(row=>row.path)).toEqual(privateProviderPrivacySources);
  const prior=bundle.read(modelStartupReportHistoryPath);expect(prior).toEqual(gitSource(privateProviderPrivacyPriorCommit,modelStartupReportHistoryPath));
  expect(history.prior_history).toEqual({path:modelStartupReportHistoryPath,sha256:sha(prior),bytes:prior.length});
  const preceding=historicalModelStartupReportMap();expect(map.sources).toHaveLength(180);
  for(const[index,row]of map.sources.entries())expect(row.committed_sha256).toBe(preceding.sources[index]!.committed_sha256);
  for(const name of privateProviderPrivacySources)expect(map.sources.find(row=>row.path===name)!.facts).toEqual(bundle.api.sourceFacts(name,gitSource(workspaceSwitchPriorCommit,name)));
}
function checkedWorkspaceSwitchHistory(bundle:CensusBundle,map:CensusMap,history:CensusHistory) {
  expect(Object.keys(history).sort()).toEqual(["schema_version","scope","roadmap_id","prior_commit","prior_census_path",
    "prior_census_git_sha256","prior_census_working_sha256","prior_source_baseline","source_baseline","old_archive","prior_history",
    "reason","preserved_fields_sha256","qualification_effect","sources"].sort());
  expect(history.prior_commit).toBe(workspaceSwitchPriorCommit);expect(history.source_baseline).toBe(responsivePriorCommit);
  checkedHistory(bundle,map,history,3);expect(history.sources.map(row=>row.path)).toEqual(workspaceSwitchSources);
  const prior=bundle.read(privateProviderPrivacyHistoryPath);expect(prior).toEqual(gitSource(workspaceSwitchPriorCommit,privateProviderPrivacyHistoryPath));
  expect(history.prior_history).toEqual({path:privateProviderPrivacyHistoryPath,sha256:sha(prior),bytes:prior.length});
  const preceding=historicalPrivateProviderPrivacyMap();expect(map.sources).toHaveLength(180);
  for(const[index,row]of map.sources.entries())expect(row.committed_sha256).toBe(preceding.sources[index]!.committed_sha256);
  for(const name of workspaceSwitchSources)expect(map.sources.find(row=>row.path===name)!.facts).toEqual(bundle.api.sourceFacts(name,gitSource(workspaceSwitchCompletedCommit,name)));
}
function expectedWorkingDrift(bundle:CensusBundle,map:CensusMap) {
  // Derive the expectation from authenticated Git bytes, independently of the
  // validator's stored hash comparison. Working edits remain explicit gaps.
  const originalRows=new Set(originalCensusRows(bundle,map));
  primeGitSources(map.source_baseline,[...originalRows].map(row=>row.path));
  return map.sources.filter(row=>!originalRows.has(row)||bundle.read(row.path).toString("utf8").replace(/\r\n/g,"\n") !==
    gitSource(map.source_baseline,row.path).toString("utf8").replace(/\r\n/g,"\n"))
    .map(row=>({kind:"unreviewed-source-drift",source:row.path}));
}
const workingCreationCommits=new Map<string,string>();
function workingHistoryBundle(bundle:CensusBundle,recordPath:string):CensusBundle {
  if(recordPath!==navigationHistoryPath&&recordPath!==notificationReferenceHistoryPath)throw new Error("Unknown UI history creation witness.");
  let creationCommit=workingCreationCommits.get(recordPath);
  if(creationCommit === undefined) {
    const env={...process.env};for(const key of Object.keys(env))if(key.toUpperCase().startsWith("GIT_"))delete env[key];
    Object.assign(env,{GIT_CONFIG_NOSYSTEM:"1",GIT_CONFIG_GLOBAL:process.platform === "win32" ? "NUL" : "/dev/null",GIT_NO_REPLACE_OBJECTS:"1",GIT_OPTIONAL_LOCKS:"0"});
    const result=spawnSync("git",["--no-pager","-c","log.showSignature=false","log","--no-show-signature","--format=%H","--diff-filter=A","--max-count=16","--",recordPath],{cwd:root,env,windowsHide:true,timeout:20_000,maxBuffer:1024});
    if(result.error||result.status!==0||!Buffer.isBuffer(result.stdout)||result.stderr.length)throw new Error("UI history creation witness is unavailable.");
    const commits=result.stdout.toString("ascii").trim().split(/\r?\n/).filter(Boolean);
    if(commits.length>1||commits.some(value=>!/^[a-f0-9]{40}$/.test(value)))throw new Error("UI history creation witness is ambiguous.");
    creationCommit=commits[0] ?? "";workingCreationCommits.set(recordPath,creationCommit);if(workingCreationCommits.size>2)throw new Error("UI history witness bound exceeded.");
  }
  // Before its first checkpoint this record describes the reviewed working
  // candidate. Once committed, its original Git tree supplies the source view.
  const commit=creationCommit;if(!commit)return bundle;
  const map=JSON.parse(gitSource(commit,censusPath).toString("utf8")) as CensusMap;
  primeGitSources(commit,map.sources.map(row=>row.path));
  return {...bundle,map,read:(name:string)=>gitSource(commit,name)};
}
function navigationHistoryBundle(bundle:CensusBundle):CensusBundle{return workingHistoryBundle(bundle,navigationHistoryPath);}
function notificationReferenceHistoryBundle(bundle:CensusBundle):CensusBundle{return workingHistoryBundle(bundle,notificationReferenceHistoryPath);}
function checkedWorkingHistory(bundle:CensusBundle,map:CensusMap,history:Record<string,unknown>,priorCommit:string) {
  expect(Object.keys(history).sort()).toEqual(["schema_version","scope","roadmap_id","prior_commit","prior_census_path","prior_census_git_sha256",
    "prior_census_working_sha256","source_baseline","preserved_fields_sha256","qualification_effect","sources","unreviewed_source_drift","reason"].sort());
  expect(history.schema_version).toBe("working-ui-census-update-v1");expect(history.scope).toBe("working-source-facts-only-no-execution");
  expect(history.roadmap_id).toBe("comprehensive-ui-automation");expect(history.prior_commit).toBe(priorCommit);expect(history.prior_census_path).toBe(censusPath);
  const bytes=gitSource(history.prior_commit as string,censusPath),previous=JSON.parse(bytes.toString("utf8")) as CensusMap;
  expect(history.prior_census_git_sha256).toBe(sha(bytes));expect(history.prior_census_working_sha256).toBe(sha(bytes));
  expect(map.source_baseline).toBe(previous.source_baseline);expect(history.source_baseline).toBe(previous.source_baseline);
  expect(invariantFields(map)).toEqual(invariantFields(previous));expect(history.preserved_fields_sha256).toBe(jsonSha(invariantFields(previous)));
  expect(map.sources.map(row=>row.path)).toEqual(previous.sources.map(row=>row.path));
  const changed=previous.sources.filter((row,index)=>JSON.stringify(row)!==JSON.stringify(map.sources[index]));expect(changed.map(row=>row.path)).toEqual(diagnosticSources);
  expect(history.sources).toEqual(changed.map(row=>({path:row.path,prior_row_sha256:jsonSha(row),current_row_sha256:jsonSha(map.sources.find(item=>item.path===row.path))})));
  for(const row of changed){const current=map.sources.find(item=>item.path===row.path)!;expect(current.facts).toEqual(bundle.api.sourceFacts(current.path,bundle.read(current.path)));}
  for(const[index,row]of map.sources.entries())expect(row.committed_sha256).toBe(previous.sources[index]!.committed_sha256);
  expect(history.unreviewed_source_drift).toEqual(expectedWorkingDrift(bundle,map).map(row=>row.source));
  expect(history.qualification_effect).toEqual({executed_tests:0,actual_host_pass:false,parent_qualification_granted:false,full_testing_status:"deferred-by-user"});
  expect(typeof history.reason).toBe("string");expect((history.reason as string).length).toBeGreaterThan(0);
}
function checkedNavigationHistory(bundle:CensusBundle,map:CensusMap,history:Record<string,unknown>){checkedWorkingHistory(bundle,map,history,"a35834b49a9e056d49973a1377b10f819fbaa8b9");}
function checkedNotificationReferenceHistory(bundle:CensusBundle,map:CensusMap,history:Record<string,unknown>){checkedWorkingHistory(bundle,map,history,"6c785c91f117d816829a899428433e162accfde2");}
function historicalWorkspaceSwitchMap() {
  return JSON.parse(gitSource(workspaceSwitchCompletedCommit,censusPath).toString("utf8")) as CensusMap;
}
it("keeps current coverage definitions bound to real source and preserves unrun qualification",async()=>{
  const bundle=await censusBundle(),result=checkedCensus(bundle,bundle.map);
  expect(result).toMatchObject({scenario_count:39,behavior_links:131,source_files:184,current_host_spec_files:32,inventory_groups:16,
    definition_map_valid:true,executed_tests:0,actual_host_pass:false,parent_qualification_granted:false,full_testing_status:"deferred-by-user"});
  expect(result.gaps.filter(gap=>gap.kind === "actual-host-not-run-by-census")).toHaveLength(39);
  expect(result.gaps.some(gap=>gap.kind === "declared-test-modifier")).toBe(true);
  expect(bundle.map.sources.some(row=>row.path === "dev-tools/scripts/qualification/tests/meaningful-journey-reporting.unit.test.ts")).toBe(false);
  expect(result.gaps.filter(gap=>gap.kind === "unreviewed-source-drift")).toEqual(expectedWorkingDrift(bundle,bundle.map));
  const navigation=navigationHistoryBundle(bundle);
  checkedNavigationHistory(navigation,navigation.map,JSON.parse(bundle.read(navigationHistoryPath).toString("utf8")) as Record<string,unknown>);
  const notification=notificationReferenceHistoryBundle(bundle);
  checkedNotificationReferenceHistory(notification,notification.map,JSON.parse(bundle.read(notificationReferenceHistoryPath).toString("utf8")) as Record<string,unknown>);
  checkedHistory(bundle,historicalOperationalMap(),JSON.parse(bundle.read(historyPath).toString("utf8")) as CensusHistory);
  checkedDiagnosticHistory(bundle,historicalDiagnosticMap(),JSON.parse(bundle.read(diagnosticHistoryPath).toString("utf8")) as CensusHistory);
  checkedContrastV2History(bundle,historicalContrastV2Map(),JSON.parse(bundle.read(contrastV2HistoryPath).toString("utf8")) as CensusHistory);
  checkedRegionHistory(bundle,historicalContrastRegionsMap(),JSON.parse(bundle.read(contrastRegionsHistoryPath).toString("utf8")) as CensusHistory,
    contrastRegionsBaseline,contrastV2HistoryPath);
  checkedRegionHistory(bundle,historicalShellOverlapMap(),JSON.parse(bundle.read(shellOverlapHistoryPath).toString("utf8")) as CensusHistory,
    shellOverlapBaseline,contrastRegionsHistoryPath);
  checkedResponsiveHistory(bundle,historicalResponsiveMap(),JSON.parse(bundle.read(responsiveHistoryPath).toString("utf8")) as CensusHistory);
  checkedDisclosureHistory(bundle,historicalDisclosureMap(),JSON.parse(bundle.read(disclosureHistoryPath).toString("utf8")) as CensusHistory);
  checkedStartupHistory(bundle,historicalStartupMap(),JSON.parse(bundle.read(startupHistoryPath).toString("utf8")) as CensusHistory);
  checkedModelStartupReportHistory(bundle,historicalModelStartupReportMap(),JSON.parse(bundle.read(modelStartupReportHistoryPath).toString("utf8")) as CensusHistory);
  checkedPrivateProviderPrivacyHistory(bundle,historicalPrivateProviderPrivacyMap(),JSON.parse(bundle.read(privateProviderPrivacyHistoryPath).toString("utf8")) as CensusHistory);
  checkedWorkspaceSwitchHistory(bundle,historicalWorkspaceSwitchMap(),JSON.parse(bundle.read(workspaceSwitchHistoryPath).toString("utf8")) as CensusHistory);
// This source-only check authenticates multiple historical Git snapshots on a
// cold filesystem. Its bounded allowance is independent of product/UI targets.
},15_000);
it("preserves the exact earlier17-source drift inventory without treating it as current",async()=>{
  const bundle=await censusBundle(),commit="be0a48e241ca94d1ad18fda89ffa8f095d98e56c",map=JSON.parse(gitSource(commit,censusPath).toString("utf8")) as CensusMap;
  primeGitSources(commit,[censusPath,...map.sources.map(row=>row.path),"docs/operations/comprehensive-ui-automation-coverage.json","docs/operations/comprehensive-ui-automation-discovery.json"]);
  const historical={...bundle,read:(name:string)=>gitSource(commit,name),map,
    ledgerText:gitSource(commit,"docs/operations/comprehensive-ui-automation-coverage.json").toString("utf8"),
    discoveryText:gitSource(commit,"docs/operations/comprehensive-ui-automation-discovery.json").toString("utf8"),hostSpecPaths:map.host_spec_files as string[]};
  const result=checkedCensus(historical,map);
  expect(result.gaps.filter(gap=>gap.kind === "unreviewed-source-drift").map(gap=>gap.source).sort()).toEqual([...responsiveSources,...modelStartupReportSources,...privateProviderPrivacySources,...workspaceSwitchSources,...reviewReferenceSources].sort());
  expect(result).toMatchObject({source_files:181,executed_tests:0,actual_host_pass:false,parent_qualification_granted:false});
// Source-only cold Git reads use the same finite budget as the main history
// check. This does not change any app, model, native or UI performance target.
},15_000);
it.each(["prior-commit","prior-map","row-hash","missing-row","duplicate-row","committed-pin","scope","qualification","hidden-drift","extra"])("refuses forged navigation working-census history %s",async variant=>{
  const current=await censusBundle();checkedCensus(current,current.map);const bundle=navigationHistoryBundle(current),map=structuredClone(bundle.map),history=JSON.parse(current.read(navigationHistoryPath).toString("utf8"));
  checkedNavigationHistory(bundle,map,history);
  if(variant === "prior-commit")history.prior_commit="0".repeat(40);
  if(variant === "prior-map")history.prior_census_git_sha256="0".repeat(64);
  if(variant === "row-hash")history.sources[0].current_row_sha256="0".repeat(64);
  if(variant === "missing-row")history.sources.pop();
  if(variant === "duplicate-row")history.sources.push(structuredClone(history.sources[0]));
  if(variant === "committed-pin")map.sources.find(row=>row.path===diagnosticSources[0])!.committed_sha256="0".repeat(64);
  if(variant === "scope")history.scope="execution-pass";
  if(variant === "qualification")history.qualification_effect.parent_qualification_granted=true;
  if(variant === "hidden-drift")history.unreviewed_source_drift=[];
  if(variant === "extra")history.extra="forged";
  expect(()=>checkedNavigationHistory(bundle,map,history)).toThrow();
});

it.each(["prior-commit","prior-map","row-hash","missing-row","duplicate-row","committed-pin","scope","qualification","hidden-drift","extra"])("refuses forged notification reference census history %s",async variant=>{
  const current=await censusBundle();checkedCensus(current,current.map);const bundle=notificationReferenceHistoryBundle(current),map=structuredClone(bundle.map),history=JSON.parse(current.read(notificationReferenceHistoryPath).toString("utf8"));
  checkedNotificationReferenceHistory(bundle,map,history);
  if(variant==="prior-commit")history.prior_commit="0".repeat(40);
  if(variant==="prior-map")history.prior_census_git_sha256="0".repeat(64);
  if(variant==="row-hash")history.sources[0].current_row_sha256="0".repeat(64);
  if(variant==="missing-row")history.sources.pop();
  if(variant==="duplicate-row")history.sources.push(structuredClone(history.sources[0]));
  if(variant==="committed-pin")map.sources.find(row=>row.path===diagnosticSources[0])!.committed_sha256="0".repeat(64);
  if(variant==="scope")history.scope="passed";
  if(variant==="qualification")history.qualification_effect.executed_tests=1;
  if(variant==="hidden-drift")history.unreviewed_source_drift.pop();
  if(variant==="extra")history.extra="forged";
  expect(()=>checkedNotificationReferenceHistory(bundle,map,history)).toThrow();
});
it("keeps workspace history authentic when current review definitions change",async()=>{
  const bundle=await censusBundle(),history=JSON.parse(bundle.read(workspaceSwitchHistoryPath).toString("utf8")) as CensusHistory;
  checkedCensus(bundle,bundle.map);
  checkedWorkspaceSwitchHistory(bundle,historicalWorkspaceSwitchMap(),history);
  expect(()=>checkedWorkspaceSwitchHistory(bundle,bundle.map,history)).toThrow();
});
it.each(["row-hash","current-row","missing-row","duplicate-row","prior-history","prior-map","committed-pin","scope","qualification","extra"] as const)("refuses forged model startup report census history %s",async variant=>{
  const bundle=await censusBundle();checkedCensus(bundle,bundle.map);
  const map=historicalModelStartupReportMap(),history=JSON.parse(bundle.read(modelStartupReportHistoryPath).toString("utf8")) as CensusHistory;
  checkedModelStartupReportHistory(bundle,map,history);
  if(variant === "row-hash")history.sources[0]!.prior_row_sha256="0".repeat(64);
  if(variant === "current-row")history.sources[0]!.current_row_sha256="0".repeat(64);
  if(variant === "missing-row")history.sources.pop();
  if(variant === "duplicate-row")history.sources.push(structuredClone(history.sources[0]!));
  if(variant === "prior-history")history.prior_history!.sha256="0".repeat(64);
  if(variant === "prior-map")history.prior_census_git_sha256="0".repeat(64);
  if(variant === "committed-pin")map.sources.find(row=>row.path === modelStartupReportSources[0])!.committed_sha256="0".repeat(64);
  if(variant === "scope")history.scope="execution-pass";
  if(variant === "qualification")history.qualification_effect.parent_qualification_granted=true;
  if(variant === "extra")Object.assign(history,{extra:"forged"});
  expect(()=>checkedModelStartupReportHistory(bundle,map,history)).toThrow();
});
it.each(["row-hash","current-row","missing-row","duplicate-row","prior-history","prior-map","committed-pin","scope","qualification","extra","source-facts-and-hash","unrelated-field"] as const)("refuses forged private-provider privacy census history %s",async variant=>{
  const bundle=await censusBundle();checkedCensus(bundle,bundle.map);
  const map=historicalPrivateProviderPrivacyMap(),history=JSON.parse(bundle.read(privateProviderPrivacyHistoryPath).toString("utf8")) as CensusHistory;
  checkedPrivateProviderPrivacyHistory(bundle,map,history);
  if(variant === "row-hash")history.sources[0]!.prior_row_sha256="0".repeat(64);
  if(variant === "current-row")history.sources[0]!.current_row_sha256="0".repeat(64);
  if(variant === "missing-row")history.sources.pop();
  if(variant === "duplicate-row")history.sources.push(structuredClone(history.sources[0]!));
  if(variant === "prior-history")history.prior_history!.sha256="0".repeat(64);
  if(variant === "prior-map")history.prior_census_git_sha256="0".repeat(64);
  if(variant === "committed-pin")map.sources.find(row=>row.path === privateProviderPrivacySources[0])!.committed_sha256="0".repeat(64);
  if(variant === "scope")history.scope="execution-pass";
  if(variant === "qualification")history.qualification_effect.parent_qualification_granted=true;
  if(variant === "extra")Object.assign(history,{extra:"forged"});
  if(variant === "source-facts-and-hash"){
    const row=map.sources.find(value=>value.path === privateProviderPrivacySources[0])!;row.facts.sha256="0".repeat(64);
    history.sources.find(value=>value.path===row.path)!.current_row_sha256=jsonSha(row);
  }
  if(variant === "unrelated-field")map.scenarios[0]!.execution_status="passed";
  expect(()=>checkedPrivateProviderPrivacyHistory(bundle,map,history)).toThrow();
});
it.each(["row-hash","current-row","missing-row","duplicate-row","prior-history","prior-map","committed-pin","scope","qualification","extra","source-facts-and-hash","unrelated-field"] as const)("refuses forged workspace-confirmation census history %s",async variant=>{
  const bundle=await censusBundle();checkedCensus(bundle,bundle.map);
  const map=historicalWorkspaceSwitchMap(),history=JSON.parse(bundle.read(workspaceSwitchHistoryPath).toString("utf8")) as CensusHistory;
  checkedWorkspaceSwitchHistory(bundle,map,history);
  if(variant === "row-hash")history.sources[0]!.prior_row_sha256="0".repeat(64);
  if(variant === "current-row")history.sources[0]!.current_row_sha256="0".repeat(64);
  if(variant === "missing-row")history.sources.pop();
  if(variant === "duplicate-row")history.sources.push(structuredClone(history.sources[0]!));
  if(variant === "prior-history")history.prior_history!.sha256="0".repeat(64);
  if(variant === "prior-map")history.prior_census_git_sha256="0".repeat(64);
  if(variant === "committed-pin")map.sources.find(row=>row.path === workspaceSwitchSources[0])!.committed_sha256="0".repeat(64);
  if(variant === "scope")history.scope="execution-pass";
  if(variant === "qualification")history.qualification_effect.parent_qualification_granted=true;
  if(variant === "extra")Object.assign(history,{extra:"forged"});
  if(variant === "source-facts-and-hash"){
    const row=map.sources.find(value=>value.path === workspaceSwitchSources[0])!;row.facts.sha256="0".repeat(64);
    history.sources.find(value=>value.path===row.path)!.current_row_sha256=jsonSha(row);
  }
  if(variant === "unrelated-field")map.scenarios[0]!.execution_status="passed";
  expect(()=>checkedWorkspaceSwitchHistory(bundle,map,history)).toThrow();
});
it.each(["facts","execution-status","committed-pin","missing-version","form-host-pin"] as const)("refuses forged census %s without a host or execution claim",async variant=>{
  const bundle=await censusBundle();checkedCensus(bundle,bundle.map);const map=structuredClone(bundle.map);
  if(variant === "facts")map.sources[0]!.facts.sha256="0".repeat(64);
  if(variant === "execution-status")map.scenarios[0]!.execution_status="passed";
  if(variant === "committed-pin")map.sources[0]!.committed_sha256="0".repeat(64);
  if(variant === "missing-version")map.source_baseline="0".repeat(40);
  if(variant === "form-host-pin")map.sources.find(row=>publishedFormHostSources.has(row.path))!.committed_sha256="f".repeat(64);
  expect(()=>checkedCensus(bundle,map)).toThrow(/^(UI coverage census input|UI definition Git)/);
});
it.each(["row-hash","current-row","missing-row","old-archive","prior-map","working-map","qualification"] as const)("refuses forged census history %s",async variant=>{
  const bundle=await censusBundle();checkedCensus(bundle,bundle.map);
  const map=historicalOperationalMap(),history=JSON.parse(bundle.read(historyPath).toString("utf8")) as CensusHistory;checkedHistory(bundle,map,history);
  if(variant === "row-hash")history.sources[0]!.prior_row_sha256="0".repeat(64);
  if(variant === "current-row")history.sources[0]!.current_row_sha256="0".repeat(64);
  if(variant === "missing-row")history.sources.pop();
  if(variant === "old-archive")history.old_archive.sha256="0".repeat(64);
  if(variant === "prior-map")history.prior_census_git_sha256="0".repeat(64);
  if(variant === "working-map")history.prior_census_working_sha256="0".repeat(64);
  if(variant === "qualification")history.qualification_effect.actual_host_pass=true;
  expect(()=>checkedHistory(bundle,map,history)).toThrow();
});
it.each(["row-hash","current-row","missing-row","duplicate-row","prior-history","prior-map","committed-working","qualification","extra"] as const)("refuses forged diagnostic census lineage %s",async variant=>{
  const bundle=await censusBundle();checkedCensus(bundle,bundle.map);
  const history=JSON.parse(bundle.read(diagnosticHistoryPath).toString("utf8")) as CensusHistory;
  const map=historicalDiagnosticMap();checkedDiagnosticHistory(bundle,map,history);
  if(variant === "row-hash")history.sources[0]!.prior_row_sha256="0".repeat(64);
  if(variant === "current-row")history.sources[0]!.current_row_sha256="0".repeat(64);
  if(variant === "missing-row")history.sources.pop();
  if(variant === "duplicate-row")history.sources.push(structuredClone(history.sources[0]!));
  if(variant === "prior-history")history.prior_history!.sha256="0".repeat(64);
  if(variant === "prior-map")history.prior_commit="0".repeat(40);
  if(variant === "committed-working")map.sources.find(row=>row.path===diagnosticSources[0])!.committed_sha256=map.sources.find(row=>row.path===diagnosticSources[0])!.facts.sha256 as string;
  if(variant === "qualification")history.qualification_effect.parent_qualification_granted=true;
  if(variant === "extra")(history as unknown as Record<string,unknown>).extra="forged";
  expect(()=>checkedDiagnosticHistory(bundle,map,history)).toThrow();
});
it.each(["row-hash","current-row","missing-row","duplicate-row","prior-history","prior-map","working-map","source-baseline","committed-working","qualification","extra"] as const)("refuses forged v2 contrast census lineage %s",async variant=>{
  const bundle=await censusBundle();checkedCensus(bundle,bundle.map);
  const history=JSON.parse(bundle.read(contrastV2HistoryPath).toString("utf8")) as CensusHistory;
  const map=historicalContrastV2Map();checkedContrastV2History(bundle,map,history);
  if(variant === "row-hash")history.sources[0]!.prior_row_sha256="0".repeat(64);
  if(variant === "current-row")history.sources[0]!.current_row_sha256="0".repeat(64);
  if(variant === "missing-row")history.sources.pop();
  if(variant === "duplicate-row")history.sources.push(structuredClone(history.sources[0]!));
  if(variant === "prior-history")history.prior_history!.sha256="0".repeat(64);
  if(variant === "prior-map")history.prior_commit="0".repeat(40);
  if(variant === "working-map")history.prior_census_working_sha256="0".repeat(64);
  if(variant === "source-baseline")map.source_baseline=diagnosticBaseline;
  if(variant === "committed-working")map.sources.find(row=>row.path===diagnosticSources[0])!.committed_sha256=map.sources.find(row=>row.path===diagnosticSources[0])!.facts.sha256 as string;
  if(variant === "qualification")history.qualification_effect.parent_qualification_granted=true;
  if(variant === "extra")(history as unknown as Record<string,unknown>).extra="forged";
  expect(()=>checkedContrastV2History(bundle,map,history)).toThrow();
});

it.each(["region-row","history-witness","qualification"] as const)("refuses forged region census %s",async variant=>{
  const bundle=await censusBundle(),history=JSON.parse(bundle.read(shellOverlapHistoryPath).toString("utf8")) as CensusHistory;
  const map=historicalShellOverlapMap();checkedRegionHistory(bundle,map,history,shellOverlapBaseline,contrastRegionsHistoryPath);
  if(variant==="region-row")history.sources[0]!.current_row_sha256="0".repeat(64);
  if(variant==="history-witness")history.prior_history!.sha256="0".repeat(64);
  if(variant==="qualification")history.qualification_effect.actual_host_pass=true;
  expect(()=>checkedRegionHistory(bundle,map,history,shellOverlapBaseline,contrastRegionsHistoryPath)).toThrow();
});

it.each(["prior-row","row-hash","current-row","missing-row","duplicate-row","old-archive","prior-map","working-map",
  "source-baseline","qualification","executed","full-testing","preserved-history","mapping","committed-working","extra"] as const)("refuses forged responsive journey history %s",async variant=>{
  const bundle=await censusBundle(),map=historicalResponsiveMap();
  const history=JSON.parse(bundle.read(responsiveHistoryPath).toString("utf8")) as CensusHistory;
  checkedResponsiveHistory(bundle,map,history);
  if(variant==="prior-row")history.sources[0]!.prior_row.facts.assertionCount=0;
  if(variant==="row-hash")history.sources[0]!.prior_row_sha256="0".repeat(64);
  if(variant==="current-row")history.sources[0]!.current_row_sha256="0".repeat(64);
  if(variant==="missing-row")history.sources.pop();
  if(variant==="duplicate-row")history.sources.push(structuredClone(history.sources[0]!));
  if(variant==="old-archive")history.old_archive.sha256="0".repeat(64);
  if(variant==="prior-map")history.prior_commit="0".repeat(40);
  if(variant==="working-map")history.prior_census_working_sha256="0".repeat(64);
  if(variant==="source-baseline")map.source_baseline=shellOverlapBaseline;
  if(variant==="qualification")history.qualification_effect.actual_host_pass=true;
  if(variant==="executed")history.qualification_effect.executed_tests=1;
  if(variant==="full-testing")history.qualification_effect.full_testing_status="complete";
  if(variant==="preserved-history")history.preserved_histories![0]!.sha256="0".repeat(64);
  if(variant==="mapping")map.scenarios[0]!.execution_status="passed";
  if(variant==="committed-working")map.sources.find(row=>row.path===responsiveSources[0])!.committed_sha256=map.sources.find(row=>row.path===responsiveSources[0])!.facts.sha256 as string;
  if(variant==="extra")(history as unknown as Record<string,unknown>).extra="forged";
  expect(()=>checkedResponsiveHistory(bundle,map,history)).toThrow();
});

it.each(["prior-row","row-hash","current-row","missing-row","duplicate-row","old-archive","prior-map","working-map",
  "source-baseline","qualification","executed","full-testing","prior-history","mapping","committed-pin","extra"] as const)("refuses forged disclosure history %s",async variant=>{
  const bundle=await censusBundle(),map=structuredClone(historicalDisclosureMap());
  const history=JSON.parse(bundle.read(disclosureHistoryPath).toString("utf8")) as CensusHistory;
  checkedDisclosureHistory(bundle,map,history);
  if(variant==="prior-row")history.sources[0]!.prior_row.facts.assertionCount=0;
  if(variant==="row-hash")history.sources[0]!.prior_row_sha256="0".repeat(64);
  if(variant==="current-row")history.sources[0]!.current_row_sha256="0".repeat(64);
  if(variant==="missing-row")history.sources.pop();
  if(variant==="duplicate-row")history.sources.push(structuredClone(history.sources[0]!));
  if(variant==="old-archive")history.old_archive.sha256="0".repeat(64);
  if(variant==="prior-map")history.prior_commit="0".repeat(40);
  if(variant==="working-map")history.prior_census_working_sha256="0".repeat(64);
  if(variant==="source-baseline")map.source_baseline=shellOverlapBaseline;
  if(variant==="qualification")history.qualification_effect.actual_host_pass=true;
  if(variant==="executed")history.qualification_effect.executed_tests=1;
  if(variant==="full-testing")history.qualification_effect.full_testing_status="complete";
  if(variant==="prior-history")history.prior_history.sha256="0".repeat(64);
  if(variant==="mapping")map.scenarios[0]!.execution_status="passed";
  if(variant==="committed-pin") {
    const row=map.sources.find(row=>row.path===history.sources[0]!.path)!;
    row.committed_sha256=row.facts.sha256 as string;history.sources[0]!.current_row_sha256=jsonSha(row);
  }
  if(variant==="extra")(history as unknown as Record<string,unknown>).extra="forged";
  expect(()=>checkedDisclosureHistory(bundle,map,history)).toThrow();
});

it.each(["prior-row","row-hash","current-row","missing-row","duplicate-row","old-archive","prior-map","working-map",
  "source-baseline","qualification","executed","full-testing","prior-history","mapping","committed-pin","extra"] as const)("refuses forged startup diagnostic history %s",async variant=>{
  const bundle=await censusBundle(),map=historicalStartupMap();
  const history=JSON.parse(bundle.read(startupHistoryPath).toString("utf8")) as CensusHistory;
  checkedStartupHistory(bundle,map,history);
  if(variant==="prior-row")history.sources[0]!.prior_row.facts.assertionCount=0;
  if(variant==="row-hash")history.sources[0]!.prior_row_sha256="0".repeat(64);
  if(variant==="current-row")history.sources[0]!.current_row_sha256="0".repeat(64);
  if(variant==="missing-row")history.sources.pop();
  if(variant==="duplicate-row")history.sources.push(structuredClone(history.sources[0]!));
  if(variant==="old-archive")history.old_archive.sha256="0".repeat(64);
  if(variant==="prior-map")history.prior_commit="0".repeat(40);
  if(variant==="working-map")history.prior_census_working_sha256="0".repeat(64);
  if(variant==="source-baseline")map.source_baseline=shellOverlapBaseline;
  if(variant==="qualification")history.qualification_effect.actual_host_pass=true;
  if(variant==="executed")history.qualification_effect.executed_tests=1;
  if(variant==="full-testing")history.qualification_effect.full_testing_status="complete";
  if(variant==="prior-history")history.prior_history.sha256="0".repeat(64);
  if(variant==="mapping")map.scenarios[0]!.execution_status="passed";
  if(variant==="committed-pin") {
    const row=map.sources.find(row=>row.path===history.sources[0]!.path)!;
    row.committed_sha256=row.facts.sha256 as string;history.sources[0]!.current_row_sha256=jsonSha(row);
  }
  if(variant==="extra")(history as unknown as Record<string,unknown>).extra="forged";
  expect(()=>checkedStartupHistory(bundle,map,history)).toThrow();
});
