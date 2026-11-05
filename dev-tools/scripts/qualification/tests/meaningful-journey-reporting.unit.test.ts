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
  validateCensus(input:{mapText:string;ledgerText:string;discoveryText:string;readSource:(name:string)=>Buffer;hostSpecPaths:string[]}):CensusResult;
}
interface CensusHistory {
  schema_version:string;scope:string;roadmap_id:string;prior_commit:string;prior_census_path:string;
  prior_census_git_sha256:string;prior_census_working_sha256:string;prior_source_baseline:string;source_baseline:string;
  old_archive:{path:string;sha256:string;bytes:number};reason:string;preserved_fields_sha256:string;
  qualification_effect:{executed_tests:number;actual_host_pass:boolean;parent_qualification_granted:boolean;full_testing_status:string};
  sources:Array<{path:string;prior_row_sha256:string;prior_row:CensusMap["sources"][number];current_row_sha256:string}>;
}
const root=path.resolve(__dirname,"../../../.."),censusPath="docs/operations/comprehensive-ui-automation-current-census.json";
const historyPath="docs/operations/comprehensive-ui-automation-operational-census-history.json";
const oldHistoryPath="docs/operations/comprehensive-ui-automation-census-source-history.json";
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
function checkedCensus(bundle:CensusBundle,map:CensusMap) {
  const result=bundle.api.validateCensus({mapText:JSON.stringify(map),ledgerText:bundle.ledgerText,discoveryText:bundle.discoveryText,readSource:bundle.read,hostSpecPaths:bundle.hostSpecPaths});
  // Canonical mismatch is deliberately a drift result. Authenticate the Git
  // pin separately so a forged pin cannot inherit a source-only validity flag.
  primeGitSources(map.source_baseline,map.sources.map(row=>row.path));
  for(const row of map.sources) {
    const text=new TextDecoder("utf-8",{fatal:true}).decode(gitSource(map.source_baseline,row.path)).replace(/\r\n/g,"\n");
    if(row.committed_sha256!==sha(text))throw new Error("UI definition Git pin does not match its source version.");
  }
  return result;
}
function invariantFields(map:CensusMap) {const value:Record<string,unknown>={...map};delete value.sources;delete value.source_baseline;return value;}
function checkedHistory(bundle:CensusBundle,map:CensusMap,history:CensusHistory) {
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
  expect(changed).toHaveLength(10);expect(history.sources.map(row=>row.path)).toEqual(changed.map(row=>row.path));
  for(const entry of history.sources) {
    expect(entry.prior_row).toEqual(previous.sources.find(row=>row.path === entry.path));
    expect(entry.prior_row_sha256).toBe(jsonSha(entry.prior_row));expect(entry.current_row_sha256).toBe(jsonSha(map.sources.find(row=>row.path === entry.path)));
  }
}
it("keeps current coverage definitions bound to real source and preserves unrun qualification",async()=>{
  const bundle=await censusBundle(),result=checkedCensus(bundle,bundle.map);
  expect(result).toMatchObject({scenario_count:39,behavior_links:131,source_files:180,current_host_spec_files:29,inventory_groups:16,
    definition_map_valid:true,executed_tests:0,actual_host_pass:false,parent_qualification_granted:false,full_testing_status:"deferred-by-user"});
  expect(result.gaps.filter(gap=>gap.kind === "actual-host-not-run-by-census")).toHaveLength(39);
  expect(result.gaps.some(gap=>gap.kind === "declared-test-modifier")).toBe(true);
  expect(bundle.map.sources.some(row=>row.path === "dev-tools/scripts/qualification/tests/meaningful-journey-reporting.unit.test.ts")).toBe(false);
  checkedHistory(bundle,bundle.map,JSON.parse(bundle.read(historyPath).toString("utf8")) as CensusHistory);
});
it.each(["facts","execution-status","committed-pin","missing-version"] as const)("refuses forged census %s without a host or execution claim",async variant=>{
  const bundle=await censusBundle();checkedCensus(bundle,bundle.map);const map=structuredClone(bundle.map);
  if(variant === "facts")map.sources[0]!.facts.sha256="0".repeat(64);
  if(variant === "execution-status")map.scenarios[0]!.execution_status="passed";
  if(variant === "committed-pin")map.sources[0]!.committed_sha256="0".repeat(64);
  if(variant === "missing-version")map.source_baseline="0".repeat(40);
  expect(()=>checkedCensus(bundle,map)).toThrow(/^(UI coverage census input|UI definition Git)/);
});
it.each(["row-hash","current-row","missing-row","old-archive","prior-map","working-map","qualification"] as const)("refuses forged census history %s",async variant=>{
  const bundle=await censusBundle();checkedCensus(bundle,bundle.map);
  const history=JSON.parse(bundle.read(historyPath).toString("utf8")) as CensusHistory;checkedHistory(bundle,bundle.map,history);
  if(variant === "row-hash")history.sources[0]!.prior_row_sha256="0".repeat(64);
  if(variant === "current-row")history.sources[0]!.current_row_sha256="0".repeat(64);
  if(variant === "missing-row")history.sources.pop();
  if(variant === "old-archive")history.old_archive.sha256="0".repeat(64);
  if(variant === "prior-map")history.prior_census_git_sha256="0".repeat(64);
  if(variant === "working-map")history.prior_census_working_sha256="0".repeat(64);
  if(variant === "qualification")history.qualification_effect.actual_host_pass=true;
  expect(()=>checkedHistory(bundle,bundle.map,history)).toThrow();
});
