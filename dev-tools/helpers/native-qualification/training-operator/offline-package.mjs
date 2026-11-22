// Source template. Deployment requires all three reviewed exact JSON bindings.
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {CONFIG_TRAILER,sha,fixedPaths,manifestRows,regularDirectory,readJson,verifiedFile,
  verifyCopiedSources,fixedForgeOptions,assertTargets,packageTree,writeExclusiveJson} from './package-tree.mjs';
const FIXED_CONTEXT = null;
const operatorRelative=FIXED_CONTEXT?`.local-codex/native-training-host-operator/v2/${FIXED_CONTEXT.run_id}/${FIXED_CONTEXT.phase}`:'unbound';
const SOURCE_SHA=FIXED_CONTEXT?.source_manifest_sha256;
const ELECTRON_SHA=FIXED_CONTEXT?.electron_manifest_sha256;
const INPUTS_SHA=FIXED_CONTEXT?.package_inputs_sha256;
const SOURCE_DIGEST=FIXED_CONTEXT?.source_digest;
const need=v=>{if(!v)throw new Error('The fixed offline Desktop package is unavailable.');};

// Forge8 exposes packaging on its exported API instance, not the module namespace.
export function installedPackageOperation(forge) {
  need(forge?.api&&typeof forge.api.package==='function');
  return options=>forge.api.package(options);
}
export async function invokeFixedPackage(runPackage,paths) {
  need(typeof runPackage==='function');
  const targets=await runPackage(fixedForgeOptions(paths));assertTargets(targets,paths);return targets;
}
export async function runPreparedPackage(paths,source,electron,inputs,loadForge=()=>import('@electron-forge/core'),onStage=()=>{}) {
  onStage('fixed-inputs');
  need(inputs?.schema_version==='fixed-offline-training-package-inputs-v1'&&
    Object.keys(inputs).sort().join('|')===['schema_version','run_id','source_digest','source_manifest_sha256','electron_manifest_sha256','config_trailer_sha256','zip'].sort().join('|')&&
    inputs.run_id===path.basename(paths.run)&&inputs.source_digest===SOURCE_DIGEST&&
    inputs.source_manifest_sha256===SOURCE_SHA&&inputs.electron_manifest_sha256===ELECTRON_SHA&&
    inputs.config_trailer_sha256===sha(Buffer.from(CONFIG_TRAILER)));
  manifestRows(source,'source');manifestRows(electron,'electron');need(source.source_digest===SOURCE_DIGEST);
  onStage('candidate-and-offline-zip');
  regularDirectory(paths.phase);regularDirectory(paths.zipDirectory);
  need(fs.readdirSync(paths.zipDirectory).length===1&&fs.readdirSync(paths.zipDirectory)[0]===path.basename(paths.zip));
  verifiedFile(paths.zip,inputs.zip,512*1024**2,{singleLink:true});
  verifyCopiedSources(paths,source,{beforePackage:true});
  for(const name of ['package-tree.json','package-result.json','package-failure.json'])need(!fs.existsSync(path.join(paths.phase,name)));
  // No provided forgeConfig: the normal loader initializes copied hooks/plugins.
  onStage('forge-import');const forge=await loadForge();
  onStage('forge-api-selection');const operation=installedPackageOperation(forge);
  onStage('actual-forge-package');await invokeFixedPackage(operation,paths);
  onStage('actual-package-resources');
  verifyCopiedSources(paths,source);
  const tree=packageTree(paths,source);
  const manifest=writeExclusiveJson(path.join(paths.phase,'package-tree.json'),{
    schema_version:'actual-offline-training-package-tree-v1',...tree,source_digest:SOURCE_DIGEST,
    optional_ocr_qualification:'not-asserted',parent_pass:false});
  const result={schemaVersion:'training-offline-package-v1',status:'packaged-offline',
    sourceDigest:SOURCE_DIGEST,sourceFiles:source.file_count,sourceBytes:source.total_bytes,
    electronVersion:electron.version,electronInputFiles:electron.file_count,
    packageFiles:tree.file_count,packageBytes:tree.total_bytes,manifestSha256:manifest.sha256,
    applicationSha256:tree.application_sha256,workerMainSha256:tree.worker_main_sha256,workerSourceFiles:tree.worker_source_files,
    originalOcrHookRetained:true,optionalOcrBuildFiles:tree.optional_ocr_build_files,
    optionalOcrQualification:'not-asserted',accuracyExecuted:false,applicationExecuted:false,parentPass:false};
  writeExclusiveJson(path.join(paths.phase,'package-result.json'),result,8192);return result;
}
async function main() {
  let stage='admission';
  try {
    const installed=fileURLToPath(import.meta.url),root=path.resolve(path.dirname(installed),'../../../../..');
    need(FIXED_CONTEXT?.phase==='training-package'&&process.env.VISUAL_COMPOSER_TRAINING_INPUT_SHA256===FIXED_CONTEXT.input_manifest_sha256&&process.platform==='win32'&&process.argv.length===2&&
      installed===path.join(root,operatorRelative,'offline-package.mjs'));
    const run=process.env.AISB_LOCAL_TRAINING_UI_RUN;
    need(typeof run==='string'&&/^\.local-codex\/native-training-host-v1\/runs\/[a-f0-9]{32}$/.test(path.relative(root,run).split(path.sep).join('/')));
    const paths=fixedPaths(root,path.basename(run));need(path.basename(run)===FIXED_CONTEXT.run_id&&run===paths.run&&process.cwd()===paths.candidate);
    need(process.env.NODE_OPTIONS===''&&!process.env.NODE_PATH&&
      process.env.PYTHON_RUNTIME_QUALIFICATION_SCENARIO==='training-model-host'&&
      ['HF_HUB_OFFLINE','TRANSFORMERS_OFFLINE','HF_DATASETS_OFFLINE','PIP_NO_INDEX','PIP_REQUIRE_HASHES',
       'PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD','ELECTRON_SKIP_BINARY_DOWNLOAD'].every(k=>process.env[k]==='1'));
    need(!Object.keys(process.env).some(k=>/^(?:FORGE_|ELECTRON_FORGE_|npm_config_)/i.test(k)));
    stage='fixed-inputs';
    const inputs=readJson(path.join(paths.phase,'package-inputs.json'),INPUTS_SHA,8192);
    const source=readJson(path.join(paths.phase,'source-inputs.json'),SOURCE_SHA);
    const electron=readJson(path.join(paths.phase,'electron-inputs.json'),ELECTRON_SHA);
    const result=await runPreparedPackage(paths,source,electron,inputs,undefined,value=>{stage=value;});
    process.stdout.write(JSON.stringify({schemaVersion:result.schemaVersion,status:result.status,applicationExecuted:false,parentPass:false})+'\n');
  } catch(error) {
    process.stderr.write(JSON.stringify({schemaVersion:'training-offline-package-v1',status:'unavailable',stage,
      errorType:['Error','TypeError','SyntaxError','RangeError'].includes(error?.name)?error.name:'UnhandledError',
      accuracyExecuted:false,applicationExecuted:false,parentPass:false})+'\n');
    process.exitCode=1;
  }
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))void main();
