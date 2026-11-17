import fs from "node:fs";
import path from "node:path";
import {fileURLToPath} from "node:url";
import {syncBuiltinESMExports} from "node:module";
import {functionalHostLayout} from "../../visual-composer/functional-host-launch-plan.mjs";
import {FUNCTIONAL_PROVIDER_REPOSITORY,providerFixtureIdentity,providerFixturePlan,safeProviderFixturePlan} from "../../visual-composer/functional-provider-plan.mjs";

/** Inert setup/worker composition proof. Never opens or seeds a provider fixture. */
export default async function syntheticLoaderSetup(config){
  const root=process.env.AISB_PRIVATE_PROVIDER_FAILURE_PROBE_ROOT;
  if(process.env.AISB_PRIVATE_PROVIDER_LOADER_PROBE!=="1"||!["control","protected"].includes(process.env.AISB_PRIVATE_PROVIDER_FAILURE_PROBE)||process.env.VISUAL_COMPOSER_FUNCTIONAL_HOST==="1"||process.env.VISUAL_COMPOSER_FUNCTIONAL_PROVIDER_CONFIG!==undefined||!root||!path.isAbsolute(root)||fs.realpathSync(root)!==root||!fs.lstatSync(root).isDirectory()||!path.basename(root).startsWith("private-provider-privacy-")||config.projects.length!==1||config.projects[0].name!=="thin-chrome")throw Error("The inert provider loader was not admitted.");
  const originalFetch=globalThis.fetch;let networkCalls=0;
  globalThis.fetch=async()=>{networkCalls++;throw Error("Network is not permitted in the inert loader proof.");};
  try{
    const setup=await import("../../visual-composer/functional-host-global-setup.mjs");
    const helper=await setup.loadFunctionalPrivateProviderFixture();
    if(typeof helper.beginProviderFixtureAdmission!=="function"||networkCalls!==0)throw Error("The inert provider definitions did not load.");
    fs.writeFileSync(path.join(root,"loader-observation.json"),JSON.stringify({schema_version:"private-provider-inert-loader-v1",actual_mjs_ts_loader_returned:true,definition_exports_available:true,executing_fixture_opened:false,network_calls:networkCalls})+"\n",{flag:"wx"});
  }finally{globalThis.fetch=originalFetch;}
  return async()=>{};
}

/** Fixed synthetic loader proof. This entry cannot select an operator credential. */
async function main(){
  if(process.argv.length!==4||!["execute","inactive","plan"].includes(process.argv[3]))throw Error("Invalid proof invocation.");
  const root=path.resolve(process.argv[2]),mode=process.argv[3],base=path.resolve(process.env.TEMP??"");
  if(path.dirname(root)!==base||!path.basename(root).startsWith("provider-loader-")||fs.realpathSync(root)!==root||fs.readdirSync(root).length)throw Error("An empty owned proof root is required.");
  const run="provider-loader-unit-run-00001",source=`source.${"a".repeat(64)}`,identity=providerFixtureIdentity(run,source,"packaged-desktop","provider-source");
  const ref=".local-codex/test-input/manifest.json",input=path.join(root,".local-codex/test-input/credential.json"),canary="synthetic-only-loader-canary";
  const manifest={schema_version:"functional-private-provider-v1",repository:FUNCTIONAL_PROVIDER_REPOSITORY,credential_file:".local-codex/test-input/credential.json",source_file:{path:"data/test.parquet",revision:"b".repeat(40),size_bytes:1024,sha256:"c".repeat(64),localize:false}};
  fs.mkdirSync(path.dirname(input),{recursive:true});fs.writeFileSync(input,JSON.stringify({token:canary}));fs.writeFileSync(path.join(root,...ref.split("/")),JSON.stringify(manifest));const before=fs.readFileSync(input);
  let credentialReads=0,networkCalls=0;const original=fs.openSync,originalFetch=globalThis.fetch;
  fs.openSync=function(name,flags,...args){if(typeof name==="string"&&path.resolve(name)===input&&flags==="r")credentialReads++;return Reflect.apply(original,this,[name,flags,...args]);};syncBuiltinESMExports();
  globalThis.fetch=async()=>{networkCalls++;throw Error("Network is not permitted in the loader proof.");};
  let productionFormatVerified=false,retired=false;
  try{
    const setup=await import("../../visual-composer/functional-host-global-setup.mjs");
    if(mode==="inactive"){
      process.env.VISUAL_COMPOSER_FUNCTIONAL_HOST="0";process.env.VISUAL_COMPOSER_FUNCTIONAL_PROVIDER_SOURCE="1";process.env.VISUAL_COMPOSER_FUNCTIONAL_PROVIDER_CONFIG=ref;
      const teardown=await setup.default({projects:[{name:"packaged-desktop"}]});await teardown();
    }else if(mode==="plan"){
      const summary=safeProviderFixturePlan(providerFixturePlan(manifest,identity));if(summary.credentialRead||summary.networkRun||summary.qualificationGranted)throw Error("A declaration cannot assert execution.");
    }else{
      const helper=await setup.loadFunctionalPrivateProviderFixture();if(typeof helper.beginProviderFixtureAdmission!=="function")throw Error("The fixed TS entry did not load.");
      const admission=helper.beginProviderFixtureAdmission(root,identity),caseRoot=path.join(functionalHostLayout(root,run,source).desktopDataRoot,"functional-provider-source");fs.mkdirSync(caseRoot,{recursive:true});
      const capsule=helper.openExecutingProviderFixture({repoRoot:root,manifestRef:ref,identity,executing:true}),credential=capsule.seedCredential(admission),target=path.join(caseRoot,"artifacts/config/hugging-face-token.json");
      productionFormatVerified=JSON.parse(fs.readFileSync(target,"utf8")).token===canary;if(!productionFormatVerified)throw Error("Production fixture format did not match.");
      credential.retireBeforeLaunch();retired=!fs.existsSync(target);
    }
  }finally{fs.openSync=original;syncBuiltinESMExports();globalThis.fetch=originalFetch;}
  if(networkCalls||mode!=="execute"&&credentialReads!==0||mode==="execute"&&(!productionFormatVerified||!retired||credentialReads<1)||!fs.readFileSync(input).equals(before))throw Error("The fixed loader proof did not complete.");
  process.stdout.write(JSON.stringify({schemaVersion:"functional-provider-loader-proof-v1",mode,loader:"actual-functional-MJS-tsImport",productionFormatVerified,credentialReads,networkCalls,inputUnchanged:true,fixtureFileRetired:retired})+"\n");
}
if(path.resolve(process.argv[1]??"")===fileURLToPath(import.meta.url)){
  try{await main();}catch{process.stderr.write("The fixed synthetic provider loader proof failed.\n");process.exitCode=1;}
}
