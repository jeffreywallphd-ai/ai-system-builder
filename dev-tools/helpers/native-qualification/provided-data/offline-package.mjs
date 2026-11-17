// Copy unchanged except the shared package-tree literal during reviewed rendering.
import assert from 'node:assert/strict';
import {lstat} from 'node:fs/promises';
import path from 'node:path';
import {pathToFileURL, fileURLToPath} from 'node:url';
import {assertFixedEnvironment, getPackageRoot, fixedRegularDigest, readFixedPackageTree,
  verifyFixedOcrWorkerResources, writeFresh, readJson, ioPath} from './package-tree.mjs';

const ctx=await assertFixedEnvironment(); // Checked-in source refuses here.
assert.equal(process.argv.length,2);
assert.equal(path.resolve(process.argv[1]),fileURLToPath(import.meta.url));
for (const name of ['out','.vite']) {
  let absent=false;
  try { await lstat(ioPath(path.join(ctx.candidate,name))); }
  catch (error) { if (error.code!=='ENOENT') throw error; absent=true; }
  assert.ok(absent,'Fresh production output required.');
}
const zipBefore=await fixedRegularDigest(ctx.zip,ctx.zipPin.bytes);
assert.deepEqual(zipBefore,ctx.zipPin);
const electron=await readJson(path.join(ctx.originalRoot,'node_modules/electron/package.json'),65536);
assert.match(electron.version,/^[0-9]+\.[0-9]+\.[0-9]+$/);
assert.equal(path.basename(ctx.zip),`electron-v${electron.version}-win32-x64.zip`);

const root=ctx.candidate;
const {readAssetSystemSourceIdentity,assertAssetSystemSourceIdentity}=await import(pathToFileURL(path.join(root,'dev-tools/scripts/qualification/asset-system-source-identity.mjs')).href);
assert.equal(await readAssetSystemSourceIdentity(root),ctx.sourceRevision);
const {default:getConfig}=await import(pathToFileURL(path.join(root,'node_modules/@electron-forge/core/dist/util/forge-config.js')).href);
const {default:packageApp}=await import(pathToFileURL(path.join(root,'node_modules/@electron-forge/core/dist/api/package.js')).href);
const config=await getConfig(root);
assert.equal(config.packagerConfig.electronZipDir,undefined);
const original=Object.entries(config.packagerConfig), originalKeys=Object.keys(config.packagerConfig);
config.packagerConfig.electronZipDir=path.dirname(ctx.zip);
assert.deepEqual(Object.keys(config.packagerConfig),[...originalKeys,'electronZipDir']);
for (const [key,value] of original) assert.strictEqual(config.packagerConfig[key],value);
// Normal production configuration and hooks. No dependency install, hook skip,
// alternate source, compiler, executable, platform or configuration selector.
const outputs=await packageApp({dir:root,forgeConfig:config,platform:'win32',arch:'x64',interactive:false});
const packageRoot=getPackageRoot();
assert.ok(Array.isArray(outputs) && outputs.length===1);
assert.deepEqual(outputs.map(output=>({platform:output.platform,arch:output.arch,packagedPath:path.resolve(output.packagedPath)})),
  [{platform:'win32',arch:'x64',packagedPath:packageRoot}]);
const executable=path.join(packageRoot,'ai-system-builder.exe');
const builtMain=path.join(root,'.vite/build/main.cjs'), packagedMain=path.join(packageRoot,'resources/app/.vite/build/main.cjs');
const main=await fixedRegularDigest(builtMain,128*1024**2);
assert.deepEqual(await fixedRegularDigest(packagedMain,128*1024**2),main);
const worker=await verifyFixedOcrWorkerResources(), tree=await readFixedPackageTree();
const workerFile=path.join(ctx.run,'packaged-ocr-worker.json'), treeFile=path.join(ctx.run,'packaged-tree.json');
const workerHash=await writeFresh(workerFile,worker,2*1024**2), treeHash=await writeFresh(treeFile,tree,2*1024**2);
assert.deepEqual(await fixedRegularDigest(ctx.zip,ctx.zipPin.bytes),zipBefore);
await assertAssetSystemSourceIdentity(root,ctx.sourceRevision);
await writeFresh(path.join(ctx.run,'package-receipt.json'),{
  schema_version:'offline-production-desktop-package-v2',packaging_completed:true,source_revision:ctx.sourceRevision,
  executable,packaged_main:packagedMain,packaged_tree_path:treeFile,packaged_tree_file_sha256:treeHash,
  packaged_tree_framed_sha256:tree.framed_sha256,packaged_files:tree.files.length,packaged_directories:tree.directories.length,
  packaged_total_bytes:tree.total_bytes,zip_sha256:zipBefore.sha256,zip_unchanged:true,
  packaged_worker_identity_path:workerFile,packaged_worker_identity_sha256:workerHash,packaged_worker_framed_sha256:worker.framed_sha256,
  packaged_OCR_resource_validated:true,only_configuration_override:'packagerConfig.electronZipDir',
  real_production_config_and_hooks:true,app_launched:false,test_pass_claimed:false,
});
console.log('Production package bytes and source were verified. App and Native qualification remain separate.');
