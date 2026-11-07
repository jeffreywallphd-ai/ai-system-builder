import assert from 'node:assert/strict';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {assertFixedEnvironment, getPackageRoot, boundedRead, readJson, writeFresh, boundedNames,
  ordinary, hash, validateTree, compareTrees, readFixedPackageTree, verifyFixedOcrWorkerResources} from './package-tree.mjs';

export function selectedHost(argv) {
  assert.ok(Array.isArray(argv));
  const selectors=argv.filter(value=>typeof value==='string' && value.startsWith('--project'));
  assert.equal(selectors.length,1);
  assert.ok(['--project=thin-chrome','--project=packaged-desktop'].includes(selectors[0]));
  const project=selectors[0].slice('--project='.length);
  return {project,phase:project==='thin-chrome'?'ui-thin':'ui-desktop'};
}

async function inventory(cache,host,phase) {
  await ordinary(cache,true);
  const names=await boundedNames(cache,256);
  assert.ok(!names.some(name=>name.startsWith('qualification-provided-failure-')));
  const ids=names.filter(name=>/^qualification-worker-identity-[1-9][0-9]{0,9}\.json$/.test(name));
  assert.ok(ids.length>0 && ids.length<=4);
  const workers=[];
  for (const name of ids) {
    const raw=await boundedRead(path.join(cache,name),1024), value=await parseIdentity(raw,name);
    // A non-destructive supplemental probe of this fresh source-written ID.
    // The enclosing Native observer must separately prove original retirement.
    let alive;
    try { process.kill(value.pid,0); alive=true; }
    catch (error) { if (error.code!=='ESRCH') throw error; alive=false; }
    assert.equal(alive,false);
    workers.push({identity_file:name,identity_sha256:hash(raw),identity:value,observed_alive:false});
  }
  assert.deepEqual(await boundedNames(cache,256),names);
  return {host,phase,cache,workers,failure_journals:0,outer_native_retirement_still_required:true};
}
async function parseIdentity(raw,name) {
  const {parseStrictJson}=await import('./package-tree.mjs');
  const value=parseStrictJson(raw,1024);
  assert.deepEqual(Object.keys(value).sort(),['parentPid','pid','scenario']);
  for (const key of ['pid','parentPid']) assert.ok(Number.isSafeInteger(value[key]) && value[key]>0 && value[key]<=0xffffffff);
  assert.equal(value.scenario,'dataset-profile'); assert.equal(name,`qualification-worker-identity-${value.pid}.json`);
  return value;
}

export default async function setup(config) {
  const ctx=await assertFixedEnvironment(), root=ctx.candidate, run=ctx.run;
  const {project,phase}=selectedHost(process.argv.slice(2)), output=path.join(run,phase);
  await ordinary(output,true);
  assert.ok(Array.isArray(config.projects) && config.projects.some(value=>value.name===project));
  assert.ok(config.projects.every(value=>['thin-chrome','packaged-desktop'].includes(value.name)));
  const receiptRaw=await boundedRead(path.join(run,'package-receipt.json'),65536);
  const {parseStrictJson}=await import('./package-tree.mjs');
  const receipt=parseStrictJson(receiptRaw,65536);
  assert.equal(receipt.schema_version,'offline-production-desktop-package-v2');
  assert.equal(receipt.source_revision,ctx.sourceRevision);
  for (const key of ['packaging_completed','real_production_config_and_hooks','zip_unchanged','packaged_OCR_resource_validated']) assert.equal(receipt[key],true);
  assert.equal(receipt.test_pass_claimed,false); assert.equal(receipt.app_launched,false);
  assert.equal(receipt.only_configuration_override,'packagerConfig.electronZipDir'); assert.equal(receipt.zip_sha256,ctx.zipPin.sha256);
  assert.equal(receipt.executable,path.join(getPackageRoot(),'ai-system-builder.exe'));
  const tree=validateTree(await readJson(path.join(run,'packaged-tree.json'),2*1024**2,receipt.packaged_tree_file_sha256),getPackageRoot());
  assert.equal(tree.framed_sha256,receipt.packaged_tree_framed_sha256);
  const actualBefore=await readFixedPackageTree(), beforeComparison=compareTrees(tree,tree,actualBefore);
  let predecessorAfterHash=null;
  if (project==='thin-chrome') assert.deepEqual(actualBefore,tree);
  else {
    const prior=path.join(run,'ui-thin'), priorSetup=await readJson(path.join(prior,'setup-receipt.json'),65536);
    assert.equal(priorSetup.schema_version,'fixed-provided-dataset-single-host-setup-v1');
    assert.equal(priorSetup.project,'thin-chrome'); assert.equal(priorSetup.phase,'ui-thin');
    assert.equal(priorSetup.source_revision,ctx.sourceRevision); assert.equal(priorSetup.package_receipt_sha256,hash(receiptRaw));
    const priorSummary=await readJson(path.join(prior,'packaged-tree-after-ui.json'),65536);
    assert.equal(priorSummary.schema_version,'fixed-provided-package-after-ui-v1');
    assert.equal(priorSummary.original_packaged_tree_framed_sha256,tree.framed_sha256);
    assert.equal(priorSummary.packaged_worker_framed_sha256,receipt.packaged_worker_framed_sha256);
    for (const key of ['all_packaged_files_unchanged','all_original_packaged_directories_preserved','existing_teardown_passed','source_identity_unchanged']) assert.equal(priorSummary[key],true);
    const priorRaw=await boundedRead(path.join(prior,'packaged-tree-actual-after-ui.json'),2*1024**2,priorSummary.actual_after_tree_file_sha256);
    predecessorAfterHash=hash(priorRaw);
    const priorAfter=validateTree(parseStrictJson(priorRaw),getPackageRoot()), comparison=compareTrees(tree,tree,priorAfter);
    assert.equal(priorAfter.framed_sha256,priorSummary.actual_after_packaged_tree_framed_sha256);
    assert.deepEqual(priorSummary.added_empty_directories,comparison.added_empty_directories);
    assert.deepEqual(actualBefore,priorAfter);
  }
  const worker=await readJson(path.join(run,'packaged-ocr-worker.json'),2*1024**2,receipt.packaged_worker_identity_sha256);
  assert.deepEqual(await verifyFixedOcrWorkerResources(),worker);
  const {readAssetSystemSourceIdentity,assertAssetSystemSourceIdentity}=await import(pathToFileURL(path.join(root,'dev-tools/scripts/qualification/asset-system-source-identity.mjs')).href);
  assert.equal(await readAssetSystemSourceIdentity(root),ctx.sourceRevision);
  const {startVisualComposerQualification,preparePackagedDesktopQualificationIdentity}=await import(pathToFileURL(path.join(root,'dev-tools/scripts/qualification/visual-composer/visual-composer-global-setup.mjs')).href);
  const {createProvidedDatasetHostLaunchPlan}=await import(pathToFileURL(path.join(root,'dev-tools/scripts/qualification/visual-composer/provided-dataset-host-launch-plan.mjs')).href);
  const {resolveVisualComposerQualificationEnvironment}=await import(pathToFileURL(path.join(root,'dev-tools/scripts/qualification/visual-composer/visual-composer-qualification-environment.mjs')).href);
  let plan,teardown,restored=false;
  try {
    try {
      process.env.NODE_OPTIONS='--max-old-space-size=256';
      plan=createProvidedDatasetHostLaunchPlan({pythonExecutable:ctx.python,sourceRevision:ctx.sourceRevision});
      assert.equal(plan.repoRoot,root);
      for (const env of [plan.server.env,plan.desktop.env,plan.desktop.seed.env]) {
        assert.equal(env.PYTHON,ctx.python); assert.equal(env.PYTHON_RUNTIME_COMMAND,ctx.python);
        assert.equal(env.__PYVENV_LAUNCHER__,ctx.launcher); assert.equal(env.PYTHONNOUSERSITE,'1');
        assert.equal(env.PYTHON_RUNTIME_QUALIFICATION_SCENARIO,'dataset-profile'); assert.equal(env.PYTHON_RUNTIME_WORKER_DIR,worker.deployed_root);
        assert.equal(env.PYTHON_RUNTIME_ARGS,'-I -B ../../../../dev-tools/scripts/qualification/visual-composer/provided-dataset-qualification-worker.py');
        assert.equal(env.VISUAL_COMPOSER_QUALIFICATION_SOURCE_REVISION,ctx.sourceRevision);
      }
      assert.equal(plan.server.env.NODE_OPTIONS,'--max-old-space-size=256');
      assert.equal(plan.thinClient.env.NODE_OPTIONS,'--max-old-space-size=256');
      if (project==='thin-chrome') {
        teardown=await startVisualComposerQualification({...config,projects:config.projects.filter(value=>value.name===project)},plan);
      } else {
        Object.assign(process.env,resolveVisualComposerQualificationEnvironment(plan,ctx.sourceRevision));
        preparePackagedDesktopQualificationIdentity(plan);
        teardown=async()=>assertAssetSystemSourceIdentity(root,ctx.sourceRevision);
      }
      assert.equal(typeof teardown,'function');
    } finally { process.env.NODE_OPTIONS=''; restored=process.env.NODE_OPTIONS===''; }
    assert.equal(process.env.VISUAL_COMPOSER_QUALIFICATION_SOURCE_REVISION,ctx.sourceRevision);
    assert.equal(process.env.VISUAL_COMPOSER_DESKTOP_EXECUTABLE,receipt.executable);
    const beforeFile=path.join(output,'packaged-tree-actual-before-ui.json');
    const beforeHash=await writeFresh(beforeFile,actualBefore,2*1024**2);
    await writeFresh(path.join(output,'packaged-tree-before-ui.json'),{
      schema_version:'fixed-provided-package-before-ui-v1',project,phase,source_revision:ctx.sourceRevision,
      package_receipt_sha256:hash(receiptRaw),original_packaged_tree_framed_sha256:tree.framed_sha256,
      actual_before_tree_file_sha256:beforeHash,actual_before_packaged_tree_framed_sha256:actualBefore.framed_sha256,
      predecessor_after_tree_file_sha256:predecessorAfterHash,added_empty_directories:beforeComparison.added_empty_directories,
      all_packaged_files_unchanged:true,all_original_packaged_directories_preserved:true,native_retirement_proven_by_this_record:false,
    });
    await writeFresh(path.join(output,'setup-receipt.json'),{
      schema_version:'fixed-provided-dataset-single-host-setup-v1',project,phase,source_revision:ctx.sourceRevision,
      actual_before_tree_file_sha256:beforeHash,qualification_run_id:plan.runId,package_receipt_sha256:hash(receiptRaw),
      actual_provided_launch_plan:true,scenario:'dataset-profile',thin_host_started:project==='thin-chrome',desktop_identity_prepared:project==='packaged-desktop',
      runtime_forwarding_verified:true,root_node_options_restored:restored,redundant_package_invoked:false,model_generation:false,ocr_executed:false,
      child_node_old_space_bytes:256*1024**2,old_space_is_total_memory_guarantee:false,
    });
  } catch (error) {
    let cleanupError;
    try { if (teardown) await teardown(); } catch (failure) { cleanupError=failure; }
    await writeFresh(path.join(output,'setup-failure.json'),{setup_failed:true,root_node_options_restored:restored,
      teardown_available:typeof teardown==='function',teardown_passed:typeof teardown==='function' && !cleanupError,qualification_supplied:false});
    if (cleanupError) throw new AggregateError([error,cleanupError],'Provided-data setup and cleanup failed.');
    throw error;
  }
  return async()=>{
    let cleanupError;
    try { await teardown(); } catch (error) { cleanupError=error; }
    try {
      await assertAssetSystemSourceIdentity(root,ctx.sourceRevision);
      const after=await readFixedPackageTree(), comparison=compareTrees(tree,actualBefore,after);
      assert.deepEqual(await verifyFixedOcrWorkerResources(),worker);
      const afterHash=await writeFresh(path.join(output,'packaged-tree-actual-after-ui.json'),after,2*1024**2);
      const inventories=project==='thin-chrome' ? [
        await inventory(path.join(plan.paths.thinRuntimeRoot,'provided-server-cache-1'),'thin','before-restart'),
        await inventory(path.join(plan.paths.thinRuntimeRoot,'provided-server-cache-2'),'thin','after-restart'),
      ] : [
        await inventory(path.join(plan.paths.desktopDataRoot,'dataset/provided-cache-before-restart'),'desktop','before-restart'),
        await inventory(path.join(plan.paths.desktopDataRoot,'dataset/provided-cache-after-restart'),'desktop','after-restart'),
        await inventory(path.join(plan.paths.desktopDataRoot,'dataset-native400/provided-cache-before-restart'),'desktop','native400'),
      ];
      await writeFresh(path.join(output,'worker-evidence-inventory.json'),{schema_version:'actual-provided-single-host-worker-inventory-v1',project,phase,
        source_revision:ctx.sourceRevision,inventories,native_or_parent_pass_claimed:false});
      await writeFresh(path.join(output,'packaged-tree-after-ui.json'),{
        schema_version:'fixed-provided-package-after-ui-v1',original_packaged_tree_framed_sha256:tree.framed_sha256,
        actual_after_packaged_tree_framed_sha256:after.framed_sha256,actual_after_tree_file_sha256:afterHash,
        added_empty_directories:comparison.added_empty_directories,all_packaged_files_unchanged:true,all_original_packaged_directories_preserved:true,
        packaged_worker_framed_sha256:worker.framed_sha256,existing_teardown_passed:!cleanupError,source_identity_unchanged:true,
      });
    } catch (error) {
      if (cleanupError) throw new AggregateError([cleanupError,error],'Provided-data teardown and evidence failed.');
      throw error;
    }
    if (cleanupError) throw cleanupError;
  };
}
