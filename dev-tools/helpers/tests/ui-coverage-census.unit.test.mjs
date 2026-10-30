import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import {tmpdir} from "node:os";
import {createHash} from "node:crypto";
import {CENSUS_LIMITS, REQUIRED_CENSUS_INVENTORIES, censusPath, sourceFacts, literalInventory, validateCensus, repositoryReader} from "../ui_coverage_census.mjs";
const file = "dev-tools/example.unit.test.ts", host = "dev-tools/scripts/qualification/visual-composer/e2e/example.e2e.spec.ts";
const code = Buffer.from('import {test,expect} from "fixture"; test("retains scoped records",()=>{expect(1).toBe(1)});');
const inventoryFile = "modules/contracts/example.ts", inventory = Buffer.from('export const TYPES = ["first", "second"] as const;');
const sha = bytes => createHash("sha256").update(bytes).digest("hex");
function fixture() {
  const scenarios = Array.from({length:39}, (_, index) => ({id:`family-${index}`, hosts:["desktop"], required_behavior:["Preserve exact state."], actual_host_qualification:"pending"}));
  const ledger = {schema_version:"comprehensive-ui-coverage-v1", full_testing_status:"deferred-by-user", scenarios, surface_census:{routes:["home"]}};
  const discovery = {scenarioMatrix:scenarios.map(s => ({id:s.id, hosts:s.hosts, expectedBehavior:s.required_behavior}))};
  const inventoryCode=new Map(), surfaces={routes:["home"]};
  const inventories=REQUIRED_CENSUS_INVENTORIES.map(([source,declaration,property,surface_key],index)=>{
    const values=["first","second"];
    const statement=declaration==="__labels__"?`const labels${index}=[{label:"first"},{label:"second"}];`
      :declaration.endsWith("PageKey")?`type ${declaration}="first"|"second";`
      :property?`const ${declaration}=[{${property}:"first"},{${property}:"second"}];`:`const ${declaration}=["first","second"] as const;`;
    inventoryCode.set(source,(inventoryCode.get(source)??"")+statement+"\n");
    if(surface_key)surfaces[surface_key]=values;
    return {source,declaration,property,values,sha256:"",surface_key};
  });
  for(const item of inventories)item.sha256=sha(inventoryCode.get(item.source));
  ledger.surface_census=surfaces;
  const map = {schema_version:"current-ui-definition-census-v1", roadmap_id:"comprehensive-ui-automation", scope:"definitions-only-no-execution-pass", source_baseline:"a".repeat(40), full_testing_status:"deferred-by-user",
    sources:[file,host].map(p => ({path:p, facts:sourceFacts(p,code), committed_sha256:sha(code)})),
    scenarios:scenarios.map(s => ({id:s.id,hosts:s.hosts,behavior_links:[{behavior_index:0,assertion_sources:[file]}],host_definitions:[host],execution_status:"not-asserted-by-census",pending_feature_checks:[]})),
    surfaces:ledger.surface_census,host_spec_files:[host],inventories};
  const bytes = new Map([[file,code],[host,code],...[...inventoryCode].map(([name,value])=>[name,Buffer.from(value)])]);
  return {map,ledger,discovery,bytes,hostSpecPaths:[host]};
}
const run = f => validateCensus({mapText:JSON.stringify(f.map),ledgerText:JSON.stringify(f.ledger),discoveryText:JSON.stringify(f.discovery),readSource:p=>{assert(f.bytes.has(p));return f.bytes.get(p);},hostSpecPaths:f.hostSpecPaths});
test("maps all approved behaviors and extracts exact assertions without executing inspected code", () => {
  const f=fixture(), result=run(f); assert.equal(result.scenario_count,39); assert.equal(result.behavior_links,39);
  assert.equal(result.executed_tests,0); assert.equal(result.actual_host_pass,false); assert.equal(result.parent_qualification_granted,false);
  assert.equal(result.gaps.length,39); assert(result.gaps.every(g=>g.kind==="actual-host-not-run-by-census"));
  const facts=sourceFacts(file,Buffer.from('throw Error("must not execute"); test.each([1])("row",()=>{assert.equal(1,1)}); test.skip("later",()=>{});'));
  assert.equal(facts.assertionCount,1); assert.equal(facts.cases.length,2); assert.equal(facts.modifiers[0].kind,"skip");
});
test("retains changed source, unimplemented host definitions and unrun outcomes as gaps", () => {
  const f=fixture();f.map.sources[0].committed_sha256="0".repeat(64);f.map.scenarios[0].host_definitions=[];
  const result=run(f); assert(result.gaps.some(g=>g.kind==="unreviewed-source-drift"));assert(result.gaps.some(g=>g.kind==="host-definition-not-mapped"));
  assert.equal(result.executed_tests,0);
});
for (const mutate of [f=>f.map.scenarios.pop(),f=>f.map.scenarios[1].id=f.map.scenarios[0].id,
  f=>f.ledger.scenarios[0].required_behavior=["Changed scope."],f=>f.map.scenarios[0].hosts=["foreign-host"],
  f=>f.map.scenarios[0].behavior_links=[],f=>f.map.scenarios[0].behavior_links[0].assertion_sources=["dev-tools/missing.ts"],
  f=>f.map.sources.push(f.map.sources[0]),f=>f.map.sources[0].facts.assertionCount++,f=>f.map.scenarios[0].execution_status="passed",
  f=>f.map.scenarios[0].host_definitions=[file],
  f=>f.ledger.scenarios[0].actual_host_qualification="passed",f=>f.map.full_testing_status="passed",f=>f.map.unknown=true,
  f=>f.map.inventories[0].values=["stale"],f=>f.map.inventories[0].property=false,f=>f.map.inventories.pop(),
  f=>f.map.inventories[1]=f.map.inventories[0],f=>f.hostSpecPaths.push("dev-tools/scripts/qualification/visual-composer/e2e/new.e2e.spec.ts")]) {
  test(`refuses invalid mapping ${String(mutate).split("=>")[1].slice(0,70)}`,()=>{
    const f=fixture();mutate(f);assert.throws(()=>run(f),/invalid|incomplete/);
  });
}
test("refuses malformed documents, unsafe paths and bounded source overflow",()=>{
  for(const p of ["../outside.ts","docs/../outside.ts","C:/private.ts","/private.ts","docs\\private.ts","docs//file.ts"]) assert.throws(()=>censusPath(p));
  assert.throws(()=>sourceFacts(file,Buffer.alloc(CENSUS_LIMITS.sourceBytes+1)));assert.throws(()=>sourceFacts(file,Buffer.from([255])));
  assert.throws(()=>sourceFacts(file,Buffer.from("const = ;")));assert.throws(()=>literalInventory(inventoryFile,inventory,"missing",null));
  const f=fixture();assert.throws(()=>validateCensus({mapText:"{",ledgerText:JSON.stringify(f.ledger),discoveryText:JSON.stringify(f.discovery)}));
  assert.throws(()=>validateCensus({mapText:" ".repeat(CENSUS_LIMITS.documentBytes+1)}));
  f.map.sources=Array(CENSUS_LIMITS.files+1).fill(f.map.sources[0]);assert.throws(()=>run(f));
});
test("requires assertions, not merely a named test file, and checks surface bindings",()=>{
  const f=fixture(),empty=Buffer.from('test("empty",()=>{});');
  f.bytes.set(file,empty);f.map.sources[0].facts=sourceFacts(file,empty);f.map.sources[0].committed_sha256=sha(empty);
  assert.throws(()=>run(f));const surface=fixture();surface.map.inventories[0].surface_key="routes";assert.throws(()=>run(surface));
});
test("caches and budgets every distinct test and inventory source together",()=>{
  const f=fixture(), calls=new Map();
  const result=validateCensus({mapText:JSON.stringify(f.map),ledgerText:JSON.stringify(f.ledger),discoveryText:JSON.stringify(f.discovery),hostSpecPaths:f.hostSpecPaths,
    readSource:p=>{calls.set(p,(calls.get(p)??0)+1);return f.bytes.get(p);}});
  assert.equal(result.unique_source_inputs,f.bytes.size);assert([...calls.values()].every(count=>count===1));
  for(let index=0;index<CENSUS_LIMITS.files-2;index++) {
    const name=`dev-tools/extra-${index}.ts`;f.map.sources.push({path:name,facts:sourceFacts(name,code),committed_sha256:sha(code)});f.bytes.set(name,code);
  }
  assert.throws(()=>run(f));
});
test("keeps free task text out of the safe summary",()=>{
  const f=fixture();f.map.scenarios[0].pending_feature_checks=["synthetic-private-token"];
  const result=run(f);assert.equal(JSON.stringify(result).includes("synthetic-private-token"),false);
  assert(result.gaps.some(g=>g.kind==="pending-feature-check"&&g.check_index===0&&g.scenario==="family-0"));
});
test("reads only bounded regular owned fixture bytes and refuses links, traversal and oversized files",()=>{
  const parent=fs.realpathSync(tmpdir());assert(fs.statSync(parent).isDirectory());const root=fs.mkdtempSync(path.join(parent,"ui-census-"));
  assert(root.startsWith(parent+path.sep));fs.mkdirSync(path.join(root,"docs"));const target=path.join(root,"docs/test.ts"),link=path.join(root,"docs/link.ts"),large=path.join(root,"docs/large.ts");
  try {
    fs.writeFileSync(target,code,{flag:"wx"});const read=repositoryReader(root);assert.deepEqual(read("docs/test.ts"),code);
    assert.throws(()=>read("docs/../test.ts"));fs.linkSync(target,link);assert.throws(()=>read("docs/test.ts"));assert.throws(()=>read("docs/link.ts"));fs.unlinkSync(link);
    fs.writeFileSync(large,Buffer.alloc(CENSUS_LIMITS.sourceBytes+1),{flag:"wx"});assert.throws(()=>read("docs/large.ts"));
  } finally {
    for(const p of [link,large,target])if(fs.existsSync(p))fs.unlinkSync(p);fs.rmdirSync(path.join(root,"docs"));fs.rmdirSync(root);
  }
});
test("checks the current repository map against original scope and actual source declarations",()=>{
  const read=repositoryReader(process.cwd()), folder="dev-tools/scripts/qualification/visual-composer/e2e/";
  const hostSpecPaths=fs.readdirSync(folder).filter(n=>n.endsWith(".e2e.spec.ts")).map(n=>folder+n).sort();
  const result=validateCensus({mapText:read("docs/operations/comprehensive-ui-automation-current-census.json").toString(),
    ledgerText:read("docs/operations/comprehensive-ui-automation-coverage.json").toString(),
    discoveryText:read("docs/operations/comprehensive-ui-automation-discovery.json").toString(),readSource:read,hostSpecPaths});
  assert.equal(result.scenario_count,39);assert.equal(result.behavior_links,131);assert.equal(result.current_host_spec_files,29);
  assert.equal(result.inventory_groups,16);assert.equal(result.executed_tests,0);assert.equal(result.parent_qualification_granted,false);
  assert(result.gaps.some(g=>g.kind==="pending-feature-check"&&g.scenario==="settings-public-values"));
  const map=JSON.parse(read("docs/operations/comprehensive-ui-automation-current-census.json"));
  const missingFunctional=["settings-public-values","settings-secrets-and-model-defaults","provider-source-acquisition","artifact-backing-publish-delete","models-discover-and-reference"];
  for(const id of missingFunctional){const row=map.scenarios.find(s=>s.id===id);assert.deepEqual(row.host_definitions,[]);assert.equal(row.pending_feature_checks.length,1);assert(result.gaps.some(g=>g.kind==="host-definition-not-mapped"&&g.scenario===id));}
  assert(map.scenarios.find(s=>s.id==="settings-public-values").pending_feature_checks[0].includes("already complete"));
  assert.deepEqual(map.scenarios.find(s=>s.id==="security-status-and-auth-boundaries").host_definitions,["dev-tools/scripts/qualification/visual-composer/e2e/thin-client-operational-ui.e2e.spec.ts"]);
  assert(!map.scenarios.find(s=>s.id==="runtime-status-and-explicit-controls").host_definitions.some(n=>n.includes("thin-client")));
  assert(map.scenarios.find(s=>s.id==="dashboard-counts").host_definitions.some(n=>n.endsWith("packaged-desktop-reference-performance.e2e.spec.ts")));
  assert(map.scenarios.find(s=>s.id==="notifications-all-task-families").host_definitions.some(n=>n.endsWith("packaged-desktop-owned-tasks.e2e.spec.ts")));

  assert.deepEqual(map.scenarios.find(s=>s.id==="contributor-review-site").host_definitions,["dev-tools/scripts/qualification/visual-composer/e2e/thin-client-operational-ui.e2e.spec.ts"]);
  const website="dev-tools/scripts/qualification/visual-composer/e2e/thin-client-ingestion.e2e.spec.ts";
  assert.deepEqual(map.scenarios.find(s=>s.id==="website-acquisition-refresh").host_definitions,[website]);
  const websiteFacts=map.sources.find(s=>s.path===website).facts;
  assert(websiteFacts.cases.some(c=>c.name==="browser acquires an authorized website page and reopens isolated raw and readable artifacts"));
  assert(websiteFacts.modifiers.length>0,"Missing authorized fixture remains a declared conditional execution gap.");
  const training="dev-tools/scripts/qualification/visual-composer/e2e/packaged-desktop-operational-ui.e2e.spec.ts";
  assert.deepEqual(map.scenarios.find(s=>s.id==="desktop-model-training").host_definitions,[training]);
  assert(map.sources.find(s=>s.path===training).facts.cases.some(c=>c.name==="packaged desktop trains one local adapter, reviews privately, saves and reopens it"));
  assert(map.sources.find(s=>s.path===training).facts.modifiers.length>0,"Unready real inputs keep training execution pending.");
  for(const name of [training,website,"dev-tools/scripts/qualification/visual-composer/e2e/thin-client-operational-ui.e2e.spec.ts"]) {
    const source=map.sources.find(s=>s.path===name);
    if(source.facts.sha256!==source.committed_sha256){
      assert.notEqual(name,website,"Unchanged website definitions still bind to their actual committed source.");
      assert(result.gaps.some(g=>g.kind==="unreviewed-source-drift"&&g.source===name),"Changed OP definitions retain their real older Git binding and an explicit drift gap until reviewed source is committed.");
    }
    if(name!==website){
      const text=read(name).toString();
      assert(text.includes('["public-values","secret-defaults"]'));
      assert(text.includes("qualifySettingsHostJourney"));
      assert(text.includes("VISUAL_COMPOSER_SETTINGS_READY"));
    }
  }
  for(const [id,stem] of [["contributor-review-site","review-site"],["website-acquisition-refresh","website-acquisition"],["desktop-model-training","model-training"]]) {
    const source=`dev-tools/scripts/qualification/tests/${stem}-oracles.unit.test.ts`;
    const row=map.sources.find(s=>s.path===source);assert(row&&row.facts.assertionCount>0);assert.equal(row.facts.sha256,row.committed_sha256);
    assert(map.scenarios.find(s=>s.id===id).behavior_links.every(link=>link.assertion_sources.includes(source)));
  }
  for(const id of ["image-generation-create-and-register","image-generation-recovery"]){
    const row=map.scenarios.find(s=>s.id===id);
    assert.deepEqual(row.host_definitions,["dev-tools/scripts/qualification/visual-composer/e2e/packaged-desktop-operational-ui.e2e.spec.ts","dev-tools/scripts/qualification/visual-composer/e2e/thin-client-operational-ui.e2e.spec.ts"]);
    assert(row.behavior_links.every(link=>link.assertion_sources.includes("dev-tools/scripts/qualification/visual-composer/e2e/image-generation-host-journey.ts")));
  }
  const imageJourney=map.sources.find(s=>s.path==="dev-tools/scripts/qualification/visual-composer/e2e/image-generation-host-journey.ts");
  assert(imageJourney.facts.assertionCount>10);assert.equal(imageJourney.facts.sha256,imageJourney.committed_sha256,"Image definitions bind only after their real reviewed source commit.");
  const imageDraft=map.sources.find(s=>s.path==="apps/desktop/src/renderer/features/image-generation/tests/use-image-generation-feature.unit.test.tsx");
  assert(imageDraft.facts.cases.some(c=>c.name==="retains the same owned image form after a page remount without starting a task"));
  assert(imageDraft.facts.cases.some(c=>c.name==="isolates workspace and client drafts and refuses retired form callbacks"));
  for(const name of [imageDraft.path,"apps/desktop/src/renderer/features/image-generation/tests/image-generation-ownership.unit.test.tsx"]) {
    const row=map.sources.find(s=>s.path===name);assert.equal(row.facts.sha256,row.committed_sha256,"Reviewed image assertions bind to their actual commit.");
  }
  const managedStart="modules/hosts/shared/resolveComfyUiAutoInstall.unit.test.ts";
  const managedFacts=map.sources.find(s=>s.path===managedStart);
  assert(managedFacts.facts.cases.some(c=>c.name==="no-install admission reads only the exact managed target, root and official source"));
  assert(managedFacts.facts.cases.some(c=>c.name==="missing, unconfirmed or mismatched managed metadata denies without starting or repairing"));
  assert.equal(managedFacts.facts.sha256,managedFacts.committed_sha256);
  assert(map.scenarios.find(s=>s.id==="image-generation-recovery").behavior_links[2].assertion_sources.includes(managedStart));
  const cleanup=map.sources.find(s=>s.path==="dev-tools/scripts/qualification/tests/desktop-owned-cleanup-failures.unit.test.ts");
  assert(cleanup.facts.cases.some(c=>c.name==="admits a live real-worker shape through its launcher before closing the app"));
  assert(cleanup.facts.cases.some(c=>c.name==="does not downgrade refused live native admission to a PID-absence pass"));
  if(cleanup.facts.sha256!==cleanup.committed_sha256)assert(result.gaps.some(g=>g.kind==="unreviewed-source-drift"&&g.source===cleanup.path),"The extended cleanup assertions retain their actual older checkpoint and explicit source drift until reviewed and committed.");
  assert(cleanup.facts.cases.some(c=>c.name==="refuses an unlisted slot before observing or closing an app"));
  assert(cleanup.facts.cases.some(c=>c.name==="refuses a foreign journey stage before app effects"));
  for(const id of ["settings-public-values","settings-secrets-and-model-defaults"]){
    const row=map.scenarios.find(s=>s.id===id);
    for(const name of ["apps/thin-client/src/pages/tests/settings-recovery.ui.test.tsx","apps/thin-client/src/features/settings/tests/api-application-settings-client.unit.test.ts","modules/ui/shared/settings/tests/SettingField.unit.test.tsx"])assert(row.behavior_links.every(link=>link.assertion_sources.includes(name)));
  }
});
