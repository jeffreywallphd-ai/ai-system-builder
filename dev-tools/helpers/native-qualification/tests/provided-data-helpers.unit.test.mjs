// Model-free source/fixture tests; no packaging, app, browser or Native run.
import assert from 'node:assert/strict';
import test from 'node:test';
import {mkdtemp, mkdir, writeFile, readFile, rm, link, unlink, open, rename, truncate} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';
import * as tools from '../provided-data/package-tree.mjs';
import {selectedHost} from '../provided-data/global-setup.mjs';

const sourceRoot=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../provided-data');
const revision='source.'+'a'.repeat(64);
async function fixture(t) {
  const previous=process.cwd(),root=await mkdtemp(path.join(os.tmpdir(),'provided-'));
  t.after(async()=>{assert.ok(path.isAbsolute(root) && path.basename(root).startsWith('provided-'));
    if (process.cwd()===root || process.cwd().startsWith(root+path.sep)) process.chdir(previous);
    await rm(path.toNamespacedPath(root),{recursive:true,force:false});});
  return root;
}
async function put(file,value) {
  await mkdir(path.toNamespacedPath(path.dirname(file)),{recursive:true});
  const raw=Buffer.isBuffer(value)?value:Buffer.from(JSON.stringify(value)+'\n');
  await writeFile(path.toNamespacedPath(file),raw); return tools.hash(raw);
}
function makeTree(root,dirs=['.']) {
  const tree={schema_version:'fixed-packaged-desktop-tree-v1',root,caps:tools.treeCaps,files:[{path:'file.txt',bytes:1,sha256:'a'.repeat(64)}],directories:dirs,total_bytes:1};
  return {...tree,framed_sha256:tools.hash(Buffer.from(JSON.stringify(tree)))};
}

test('checked-in templates refuse without importing production build or launching a host',async()=>{
  assert.throws(()=>tools.getFixedContext(),/compiled reviewed context/);
  await assert.rejects(import(pathToFileURL(path.join(sourceRoot,'offline-package.mjs')).href),/compiled reviewed context/);
  await assert.rejects(import(pathToFileURL(path.join(sourceRoot,'playwright.config.mjs')).href),/compiled reviewed context/);
});
test('strict JSON keeps valid Unicode/escapes and refuses duplicate, nonfinite, malformed and deep input',()=>{
  assert.deepEqual(tools.parseStrictJson(Buffer.from('{"a\\u0062":[1,true,null,"雪\\\""],"x":{}}')),{ab:[1,true,null,'雪"'],x:{}});
  for (const raw of ['{"x":1,"x":2}','{"x":1,"\\u0078":2}','{"x":NaN}','{"x":1e999}','[1,]','{"a":1,}','true false','[','"unterminated','['.repeat(140)+'0'+']'.repeat(140)]) {
    assert.throws(()=>tools.parseStrictJson(Buffer.from(raw)),undefined,raw.slice(0,40));
  }
  assert.throws(()=>tools.parseStrictJson(Buffer.from([0xff])));
  assert.throws(()=>tools.parseStrictJson(Buffer.from('{"x":1}'),2));
});
test('bounded same-snapshot reader distinguishes byte hashes, caps and strict JSON',async t=>{
  const root=await fixture(t), file=path.join(root,'proof.json'), raw=Buffer.from('{"a":1}\n');
  await put(file,raw);
  assert.deepEqual(await tools.fixedRegularDigest(file,64),{bytes:raw.length,sha256:tools.hash(raw)});
  assert.deepEqual(await tools.readJson(file,64,tools.hash(raw)),{a:1});
  await assert.rejects(tools.boundedRead(file,raw.length-1),/bound/);
  await assert.rejects(tools.readJson(file,64,'b'.repeat(64)));
  await put(file,Buffer.from('{"a":1,"a":2}'));
  await assert.rejects(tools.readJson(file,64),/Duplicate/);
  const linked=path.join(root,'linked.json');await link(file,linked);
  await assert.rejects(tools.boundedRead(file,64));await unlink(linked);
});
test('growth, truncation, replacement and read exceptions deny and close the admitted handle',async t=>{
  const root=await fixture(t), file=path.join(root,'proof.json');
  const probe=await open(path.join(root,'probe'),'wx'), prototype=Object.getPrototypeOf(probe), original=prototype.read;
  await probe.close();
  for (const mutation of ['growth','truncation','replacement','error']) {
    await put(file,Buffer.from('1234'));let seen,first=true;
    prototype.read=async function(...args) {
      seen=this;
      if (mutation==='error') throw new Error('synthetic-read-failure');
      const result=await original.apply(this,args);
      if (first) {
        first=false;
        if (mutation==='growth') await writeFile(file,Buffer.from('123456'));
        if (mutation==='truncation') await truncate(file,0);
        if (mutation==='replacement') {const fresh=path.join(root,'replacement');await put(fresh,Buffer.from('1234'));await rename(fresh,file);}
      }
      return result;
    };
    try {await assert.rejects(tools.boundedRead(file,4));assert.ok(seen);assert.equal(seen.fd,-1);}
    finally {prototype.read=original;}
  }
});
test('fresh writes cannot replace evidence and bounded enumeration cannot hide excess members',async t=>{
  const root=await fixture(t), file=path.join(root,'used.json');
  const hash=await tools.writeFresh(file,{first:true});
  assert.equal(hash,tools.hash(await readFile(file)));
  await assert.rejects(tools.writeFresh(file,{second:true}),error=>error.code==='EEXIST');
  assert.deepEqual(await tools.readJson(file),{first:true});
  await assert.rejects(tools.writeFresh(path.join(root,'large.json'),{large:'x'.repeat(50)},8));
  await put(path.join(root,'another.json'),{});
  await assert.rejects(tools.boundedNames(root,1),/count bound/);
  assert.deepEqual(await tools.boundedNames(root,2),['another.json','used.json']);
});
test('full inventory hashes admitted bytes and refuses redirected or linked members',async t=>{
  const root=await fixture(t);await put(path.join(root,'nested/a.txt'),Buffer.from('abc'));await put(path.join(root,'b.txt'),Buffer.from('de'));
  const tree=await tools.inventory(root);
  assert.deepEqual(tree,{files:[{path:'b.txt',bytes:2,sha256:tools.hash(Buffer.from('de'))},{path:'nested/a.txt',bytes:3,sha256:tools.hash(Buffer.from('abc'))}],directories:['.','nested'],total_bytes:5});
  await link(path.join(root,'b.txt'),path.join(root,'alias.txt'));
  await assert.rejects(tools.inventory(root));
});
test('closed original/thin/Desktop tree transitions preserve every file and prior directory',()=>{
  const root=path.resolve('synthetic-package'), original=makeTree(root), thin=makeTree(root,['.',...tools.emptyGpuDirectories].sort());
  assert.equal(tools.compareTrees(original,original,thin).all_files_unchanged,true);
  tools.compareTrees(original,thin,thin);
  assert.notEqual(original.framed_sha256,thin.framed_sha256);
  assert.throws(()=>tools.compareTrees(original,thin,original));
  for (const change of [tree=>tree.files[0].sha256='b'.repeat(64),tree=>tree.directories.push('extra'),tree=>tree.files.push({path:tools.emptyGpuDirectories[1]+'/log.txt',bytes:0,sha256:'b'.repeat(64)}),tree=>tree.directories[2]=tree.directories[2].toLowerCase()]) {
    const after=structuredClone(thin);change(after);after.framed_sha256=tools.hash(Buffer.from(JSON.stringify(Object.fromEntries(Object.entries(after).filter(([key])=>key!=='framed_sha256')))));
    assert.throws(()=>tools.compareTrees(original,thin,after));
  }
});
test('one exact native-issued project is required; aliases and combined host selection refuse',()=>{
  assert.deepEqual(selectedHost(['test','--project=thin-chrome']),{project:'thin-chrome',phase:'ui-thin'});
  assert.deepEqual(selectedHost(['test','--project=packaged-desktop']),{project:'packaged-desktop',phase:'ui-desktop'});
  for (const argv of [[],['--project','thin-chrome'],['--project=other'],['--project=thin-chrome','--project=packaged-desktop'],['--project=thin-chrome','--projectx=hidden']]) assert.throws(()=>selectedHost(argv));
});
test('long Windows evidence keeps canonical identity and hardlink refusal', {skip:process.platform!=='win32'},async t=>{
  const root=await fixture(t), folder=path.join(root,'long','a'.repeat(100),'b'.repeat(100)), file=path.join(folder,'evidence.json');
  assert.ok(file.length>260);await mkdir(path.toNamespacedPath(folder),{recursive:true});
  const hash=await tools.writeFresh(file,{synthetic:true});
  assert.deepEqual(await tools.readJson(file,128,hash),{synthetic:true});
  assert.equal((await tools.inventory(folder)).files[0].path,'evidence.json');
  assert.throws(()=>tools.ioPath(path.toNamespacedPath(file)));
  const alias=path.join(folder,'alias.json');await link(path.toNamespacedPath(file),path.toNamespacedPath(alias));
  await assert.rejects(tools.readJson(file,128));
});

async function compiledFixture(t) {
  const originalRoot=await fixture(t), candidate=path.join(originalRoot,'.local-codex/q/1234abcd/c');
  const helpers=path.join(candidate,'.local-codex/native-fixed-host-operator/v1'), run=path.join(candidate,'.local-codex/native-fixed-host-operator/runs','1'.repeat(32));
  const python=path.join(originalRoot,'python/python.exe'), launcher=path.join(originalRoot,'.local-codex/ocr-cached-runtime-v1/venv/Scripts/python.exe');
  const configFile=path.join(originalRoot,'.local-codex/ocr-cached-runtime-v1/venv/pyvenv.cfg'), chrome=path.join(originalRoot,'browser/chrome.exe');
  const zip=path.join(originalRoot,'.local-codex/electron-official-cache','a'.repeat(64),'electron-v1.2.3-win32-x64.zip');
  const runtimePins=[];
  for (const file of [python,path.join(path.dirname(python),'python312.dll'),launcher,configFile]) {
    const raw=Buffer.from('inert-runtime-fixture');await put(file,raw);runtimePins.push({path:file,cap:1024,bytes:raw.length,sha256:tools.hash(raw)});
  }
  for (const file of [chrome,zip]) await put(file,Buffer.from('inert-supplier-fixture'));
  const pin={bytes:Buffer.byteLength('inert-supplier-fixture'),sha256:tools.hash(Buffer.from('inert-supplier-fixture'))};
  const source=Buffer.from('// inert selected source\n');
  const ctx={schema_version:'fixed-provided-host-context-v1',originalRoot,candidate,run,sourceRevision:revision,python,launcher,configFile,runtimePins,chrome,chromePin:pin,zip,zipPin:pin,ocrSourceSha256:tools.hash(source)};
  // An inert config-data fixture, not the installed runner or a package install.
  // Resolving from this candidate stays portable when OS temp is outside repo.
  await put(path.join(candidate,'node_modules/@playwright/test/package.json'),{name:'@playwright/test',version:'0.0.0-fixture',type:'module',exports:'./index.mjs'});
  await put(path.join(candidate,'node_modules/@playwright/test/index.mjs'),Buffer.from("export const devices={'Desktop Chrome':{viewport:{width:1280,height:720},deviceScaleFactor:1,isMobile:false,hasTouch:false}};\n"));
  for (const name of ['package-tree.mjs','global-setup.mjs','playwright.config.mjs']) {
    let raw=await readFile(path.join(sourceRoot,name),'utf8');
    if (name==='package-tree.mjs') {assert.equal(raw.split('const FIXED_CONTEXT = null;').length,2);raw=raw.replace('const FIXED_CONTEXT = null;',`const FIXED_CONTEXT = ${JSON.stringify(ctx)};`);}
    await put(path.join(helpers,name),Buffer.from(raw));
  }
  const lib=await import(pathToFileURL(path.join(helpers,'package-tree.mjs')).href);
  const packageRoot=path.join(candidate,'out/ai-system-builder-win32-x64');
  const selected=path.join(candidate,'modules/adapters/runtime/python/worker'), deployed=path.join(packageRoot,'resources/worker');
  const binary=Buffer.alloc(256);binary.write('MZ');binary.writeUInt32LE(64,0x3c);binary.write('PE\0\0',64);binary.writeUInt16LE(0x8664,68);
  const resource={schema_version:'windows-ocr-resource-v1',provider:'windows',provider_version:'1',architecture:'x64',source_sha256:tools.hash(source),binary_sha256:tools.hash(binary),binary_bytes:binary.length};
  for (const folder of [selected,deployed]) {await put(path.join(folder,'ocr/native/WindowsOcrHelper.cs'),source);await put(path.join(folder,'ocr/native/build/WindowsOcrHelper.exe'),binary);await put(path.join(folder,'ocr/native/build/resource.json'),resource);}
  await put(path.join(packageRoot,'ai-system-builder.exe'),Buffer.from('inert-app; never launched'));
  const tree=await lib.readFixedPackageTree(),worker=await lib.verifyFixedOcrWorkerResources();
  const treeHash=await put(path.join(run,'packaged-tree.json'),tree),workerHash=await put(path.join(run,'packaged-ocr-worker.json'),worker);
  await put(path.join(run,'package-receipt.json'),{schema_version:'offline-production-desktop-package-v2',source_revision:revision,
    packaging_completed:true,real_production_config_and_hooks:true,zip_unchanged:true,packaged_OCR_resource_validated:true,test_pass_claimed:false,app_launched:false,
    only_configuration_override:'packagerConfig.electronZipDir',zip_sha256:pin.sha256,executable:path.join(packageRoot,'ai-system-builder.exe'),
    packaged_tree_file_sha256:treeHash,packaged_tree_framed_sha256:tree.framed_sha256,packaged_worker_identity_sha256:workerHash,packaged_worker_framed_sha256:worker.framed_sha256});
  return {ctx,helpers,run,candidate,packageRoot,lib,tree,worker};
}

test('compiled passive inputs preserve worker bytes, PE/resource identity and exact context',async t=>{
  const f=await compiledFixture(t);
  assert.equal(f.lib.getFixedContext().candidate,f.candidate);
  assert.throws(()=>f.lib.getFixedContext().runtimePins.push({}));
  assert.throws(()=>{f.lib.getFixedContext().chromePin.sha256='b'.repeat(64);});
  assert.deepEqual(await f.lib.verifyFixedOcrWorkerResources(),f.worker);
  await put(path.join(f.packageRoot,'resources/worker/ocr/native/build/resource.json'),Buffer.from('{"provider":"windows","provider":"windows"}'));
  await assert.rejects(f.lib.verifyFixedOcrWorkerResources());
});

async function environment(t,f,project) {
  const previous={...process.env},argv=[...process.argv],cwd=process.cwd();
  t.after(()=>{process.chdir(cwd);process.argv=argv;for(const key of Object.keys(process.env))if(!Object.hasOwn(previous,key))delete process.env[key];Object.assign(process.env,previous);});
  process.chdir(f.candidate);process.argv=[process.execPath,'fixed-cli.js','test','--project='+project];
  Object.assign(process.env,{AISB_LOCAL_DESKTOP_UI_RUN:f.run,PYTHON_RUNTIME_QUALIFICATION_SCENARIO:'dataset-profile',PYTHON:f.ctx.python,PYTHON_RUNTIME_COMMAND:f.ctx.python,__PYVENV_LAUNCHER__:f.ctx.launcher,PYTHONNOUSERSITE:'1',NODE_OPTIONS:'',PIP_NO_INDEX:'1',HF_HUB_OFFLINE:'1',TRANSFORMERS_OFFLINE:'1',PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD:'1'});
}

test('rendered Playwright settings retain both current specs, serial worker, no retries and fixed deadlines',async t=>{
  const f=await compiledFixture(t);await environment(t,f,'thin-chrome');
  const {default:config}=await import(pathToFileURL(path.join(f.helpers,'playwright.config.mjs')).href);
  assert.equal(config.workers,1);assert.equal(config.retries,0);assert.equal(config.fullyParallel,false);
  assert.equal(config.timeout,300000);assert.equal(config.globalTimeout,360000);
  assert.deepEqual(config.testMatch,['**/thin-client-dataset-versions.e2e.spec.ts','**/packaged-desktop-dataset-versions.e2e.spec.ts']);
  assert.deepEqual(config.projects.map(project=>project.name),['thin-chrome','packaged-desktop']);
  assert.deepEqual(config.use,{actionTimeout:8000,navigationTimeout:15000,screenshot:'off',trace:'off',video:'off'});
});

async function compositionFixtures(f,t) {
  const key='providedFixture'+path.basename(f.ctx.originalRoot).replaceAll('-','');
  const state={calls:[],failCleanup:false,failStart:false,drift:false};globalThis[key]=state;t.after(()=>delete globalThis[key]);
  const moduleRoot=path.join(f.candidate,'dev-tools/scripts/qualification'),visual=path.join(moduleRoot,'visual-composer');
  const common=`import assert from 'node:assert/strict';const ctx=${JSON.stringify(f.ctx)},state=globalThis[${JSON.stringify(key)}];`;
  await put(path.join(moduleRoot,'asset-system-source-identity.mjs'),Buffer.from(common+`
    export async function readAssetSystemSourceIdentity(){return ctx.sourceRevision;}
    export async function assertAssetSystemSourceIdentity(root,source){assert.equal(root,ctx.candidate);assert.equal(source,ctx.sourceRevision);if(state.drift)throw new Error('synthetic-source-drift');}`));
  await put(path.join(visual,'provided-dataset-host-launch-plan.mjs'),Buffer.from(common+`
    export function createProvidedDatasetHostLaunchPlan(){
      const host=process.argv.includes('--project=thin-chrome')?'thin':'desktop',runId='qualification-'+host+'-fixture-0001';
      const env={PYTHON:ctx.python,PYTHON_RUNTIME_COMMAND:ctx.python,__PYVENV_LAUNCHER__:ctx.launcher,PYTHONNOUSERSITE:'1',PYTHON_RUNTIME_QUALIFICATION_SCENARIO:'dataset-profile',PYTHON_RUNTIME_WORKER_DIR:ctx.candidate+'/out/ai-system-builder-win32-x64/resources/worker',PYTHON_RUNTIME_ARGS:'-I -B ../../../../dev-tools/scripts/qualification/visual-composer/provided-dataset-qualification-worker.py',VISUAL_COMPOSER_QUALIFICATION_SOURCE_REVISION:ctx.sourceRevision,NODE_OPTIONS:'--max-old-space-size=256'};
      for(const name of ['PYTHON_RUNTIME_WORKER_DIR'])env[name]=env[name].replaceAll('/',process.platform==='win32'?'\\\\':'/');
      return {repoRoot:ctx.candidate,runId,server:{env:{...env}},thinClient:{env:{NODE_OPTIONS:env.NODE_OPTIONS}},desktop:{env:{...env},seed:{env:{...env}}},paths:state.paths[host]};}`));
  const resolved=`({VISUAL_COMPOSER_QUALIFICATION_RUN_ID:plan.runId,VISUAL_COMPOSER_QUALIFICATION_SOURCE_REVISION:ctx.sourceRevision,VISUAL_COMPOSER_DESKTOP_EXECUTABLE:ctx.candidate+${JSON.stringify(path.sep+'out'+path.sep+'ai-system-builder-win32-x64'+path.sep+'ai-system-builder.exe')}})`;
  await put(path.join(visual,'visual-composer-qualification-environment.mjs'),Buffer.from(common+`export function resolveVisualComposerQualificationEnvironment(plan){return ${resolved};}`));
  await put(path.join(visual,'visual-composer-global-setup.mjs'),Buffer.from(common+`
    export async function startVisualComposerQualification(config,plan){state.calls.push(['start-thin',config.projects.map(p=>p.name)]);if(state.failStart)throw new Error('synthetic-start-failure');Object.assign(process.env,${resolved});return async()=>{state.calls.push(['stop-thin']);if(state.failCleanup)throw new Error('synthetic-cleanup-failure');};}
    export function preparePackagedDesktopQualificationIdentity(){state.calls.push(['desktop-identity']);}`));
  state.paths={};
  for (const host of ['thin','desktop']) {
    const id='qualification-'+host+'-fixture-0001',base=path.join(f.candidate,'artifacts/qualification/visual-composer/d',tools.hash(Buffer.from(id)).slice(0,16));
    state.paths[host]={thinRuntimeRoot:path.join(base,'thin-runtime'),desktopDataRoot:path.join(base,'desktop')};
  }
  return state;
}
async function workerCaches(state,host) {
  const base=state.paths[host];
  const paths=host==='thin'?[path.join(base.thinRuntimeRoot,'provided-server-cache-1'),path.join(base.thinRuntimeRoot,'provided-server-cache-2')]:
    [path.join(base.desktopDataRoot,'dataset/provided-cache-before-restart'),path.join(base.desktopDataRoot,'dataset/provided-cache-after-restart'),path.join(base.desktopDataRoot,'dataset-native400/provided-cache-before-restart')];
  for (let index=0;index<paths.length;index++) await put(path.join(paths[index],`qualification-worker-identity-${1000+index}.json`),{pid:1000+index,parentPid:2000+index,scenario:'dataset-profile'});
}
test('single-host setup starts only thin services, then preserves its accepted package for Desktop and inventories all five caches',async t=>{
  const f=await compiledFixture(t), state=await compositionFixtures(f,t);await environment(t,f,'thin-chrome');
  const {default:setup}=await import(pathToFileURL(path.join(f.helpers,'global-setup.mjs')).href);
  const config={projects:[{name:'thin-chrome'},{name:'packaged-desktop'}]};
  for (const phase of ['ui-thin','ui-desktop']) await mkdir(path.join(f.run,phase));
  const oldKill=process.kill;
  process.kill=(pid,signal)=>{assert.ok(pid>=1000&&pid<=1002&&signal===0);throw Object.assign(new Error('synthetic-exited'),{code:'ESRCH'});};
  try {
    const thinTeardown=await setup(config);
    assert.deepEqual(state.calls,[['start-thin',['thin-chrome']]]);assert.equal(process.env.NODE_OPTIONS,'');
    await workerCaches(state,'thin');
    for (const dir of tools.emptyGpuDirectories) await mkdir(path.join(f.packageRoot,dir),{recursive:true});
    await thinTeardown();
    const thinInventory=await tools.readJson(path.join(f.run,'ui-thin/worker-evidence-inventory.json'));
    assert.equal(thinInventory.inventories.length,2);
    const after=await tools.readJson(path.join(f.run,'ui-thin/packaged-tree-actual-after-ui.json'));
    assert.notEqual(after.framed_sha256,f.tree.framed_sha256);
    process.argv=[process.execPath,'fixed-cli.js','test','--project=packaged-desktop'];
    const priorFile=path.join(f.run,'ui-thin/packaged-tree-after-ui.json'), prior=await tools.readJson(priorFile);
    await put(priorFile,{...prior,existing_teardown_passed:false});
    await assert.rejects(setup(config));
    assert.deepEqual(state.calls,[['start-thin',['thin-chrome']],['stop-thin']]);
    await put(priorFile,prior);
    const desktopTeardown=await setup(config);
    assert.deepEqual(state.calls,[['start-thin',['thin-chrome']],['stop-thin'],['desktop-identity']]);
    const before=await tools.readJson(path.join(f.run,'ui-desktop/packaged-tree-actual-before-ui.json'));
    assert.deepEqual(before,after);
    await workerCaches(state,'desktop');await desktopTeardown();
    const desktopInventory=await tools.readJson(path.join(f.run,'ui-desktop/worker-evidence-inventory.json'));
    assert.deepEqual(desktopInventory.inventories.map(row=>row.phase),['before-restart','after-restart','native400']);
    assert.ok(desktopInventory.inventories.every(row=>row.workers.length===1 && row.outer_native_retirement_still_required===true));
  } finally {process.kill=oldKill;}
});
test('teardown failure remains a failure even when its complete package and cache evidence can be written',async t=>{
  const f=await compiledFixture(t),state=await compositionFixtures(f,t);await environment(t,f,'thin-chrome');
  await mkdir(path.join(f.run,'ui-thin'));
  const {default:setup}=await import(pathToFileURL(path.join(f.helpers,'global-setup.mjs')).href);
  const teardown=await setup({projects:[{name:'thin-chrome'}]});await workerCaches(state,'thin');state.failCleanup=true;
  const oldKill=process.kill;process.kill=()=>{throw Object.assign(new Error('synthetic-exited'),{code:'ESRCH'});};
  try {await assert.rejects(teardown(),/synthetic-cleanup-failure/);} finally {process.kill=oldKill;}
  const summary=await tools.readJson(path.join(f.run,'ui-thin/packaged-tree-after-ui.json'));
  assert.equal(summary.existing_teardown_passed,false);
});
test('setup failure restores root Node options and writes an explicit failure without a setup pass',async t=>{
  const f=await compiledFixture(t),state=await compositionFixtures(f,t);await environment(t,f,'thin-chrome');
  await mkdir(path.join(f.run,'ui-thin'));state.failStart=true;
  const {default:setup}=await import(pathToFileURL(path.join(f.helpers,'global-setup.mjs')).href);
  await assert.rejects(setup({projects:[{name:'thin-chrome'}]}),/synthetic-start-failure/);
  assert.equal(process.env.NODE_OPTIONS,'');
  const failure=await tools.readJson(path.join(f.run,'ui-thin/setup-failure.json'));
  assert.deepEqual(failure,{setup_failed:true,root_node_options_restored:true,teardown_available:false,teardown_passed:false,qualification_supplied:false});
  await assert.rejects(readFile(path.join(f.run,'ui-thin/setup-receipt.json')),error=>error.code==='ENOENT');
});
test('a fresh worker failure journal prevents a successful teardown inventory',async t=>{
  const f=await compiledFixture(t),state=await compositionFixtures(f,t);await environment(t,f,'thin-chrome');
  await mkdir(path.join(f.run,'ui-thin'));
  const {default:setup}=await import(pathToFileURL(path.join(f.helpers,'global-setup.mjs')).href);
  const teardown=await setup({projects:[{name:'thin-chrome'}]});await workerCaches(state,'thin');
  await put(path.join(state.paths.thin.thinRuntimeRoot,'provided-server-cache-1/qualification-provided-failure-1000.json'),{type:'synthetic-failure'});
  await assert.rejects(teardown());
  await assert.rejects(readFile(path.join(f.run,'ui-thin/worker-evidence-inventory.json')),error=>error.code==='ENOENT');
  await assert.rejects(readFile(path.join(f.run,'ui-thin/packaged-tree-after-ui.json')),error=>error.code==='ENOENT');
});
test('the passive literal cannot add command, deadline, profile or cache-path selectors',async t=>{
  const f=await compiledFixture(t), source=await readFile(path.join(sourceRoot,'package-tree.mjs'),'utf8');
  for (const [key,value] of [['argv',['cmd.exe']],['timeout',9000],['profile','ocr-documents'],['cache','existing-old-slot']]) {
    const altered={...f.ctx,[key]:value}, file=path.join(f.helpers,'package-tree.mjs');
    await put(file,Buffer.from(source.replace('const FIXED_CONTEXT = null;',`const FIXED_CONTEXT = ${JSON.stringify(altered)};`)));
    const module=await import(pathToFileURL(file).href+'?invalid='+key);
    assert.throws(()=>module.getFixedContext(),/Invalid fixed object/);
  }
});
