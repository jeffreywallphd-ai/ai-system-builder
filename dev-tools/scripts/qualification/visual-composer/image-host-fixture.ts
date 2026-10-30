import path from "node:path";
import {spawnSync} from "node:child_process";
import {lstatSync,mkdirSync,realpathSync} from "node:fs";
import {createGitRuntimeInstallerAdapter} from "../../../../modules/adapters/runtime/installer/git";
import {DEFAULT_COMFYUI_REPOSITORY_URL} from "../../../../modules/adapters/runtime/installer/comfyui/createComfyUiRuntimeInstaller";
import {requireManagedComfyUiInstall} from "../../../../modules/hosts/shared/resolveComfyUiAutoInstall";
import {openLocalSqliteDatabase,resolveLocalSqliteDatabasePolicy} from "../../../../modules/adapters/persistence/sqlite";
import {readLocalIdentityProfile} from "../../../../modules/adapters/security/local-identity";
import {inspectImageHostInputBytes} from "./image-host-inputs.mjs";
import {captureImageInspection,createImageCaseEnvironment,imageHostLayout,type ImageHostInspection} from "./image-host-launch-plan.mjs";
import {captureImageHostFixture,imageHostWorkspace,imageHostModelRecord,type ImageHost,type ImageJourney,type ImageHostFixture} from "./image-generation-host-oracles";
import {seedImageInputRecords} from "./image-host-input-records";
const deny=()=>{throw new Error("The fixed local image prerequisites are unavailable.");};
const repoRoot=path.resolve(__dirname,"../../../..");
export async function inspectImageInputs(environment:NodeJS.ProcessEnv):Promise<Readonly<ImageHostInspection>>{
  const run=environment.VISUAL_COMPOSER_QUALIFICATION_RUN_ID??"",source=environment.VISUAL_COMPOSER_QUALIFICATION_SOURCE_REVISION??"";
  if(!/^source\.[a-f0-9]{64}$/.test(source))return deny();
  const layout=imageHostLayout(repoRoot,run),input=await inspectImageHostInputBytes(repoRoot,run);
  const installer=createGitRuntimeInstallerAdapter({execFile:async()=>deny()});
  await requireManagedComfyUiInstall(installer,layout.providerRoot,input.comfyCommitSha);
  const status=await installer.getInstallStatus({targetId:"comfyui",installRoot:layout.providerRoot,source:{type:"git",repositoryUrl:DEFAULT_COMFYUI_REPOSITORY_URL,ref:input.comfyCommitSha}});
  if(status.commitSha!==input.comfyCommitSha)return deny();
  // Read-only source confirmation. No fetch, checkout, installer or Python probe.
  const git=(args:string[])=>spawnSync("git",["--no-optional-locks","-c","core.fsmonitor=false",...args],{cwd:layout.providerRoot,env:{...environment,GIT_CONFIG_NOSYSTEM:"1",GIT_CONFIG_GLOBAL:process.platform==="win32"?"NUL":"/dev/null"},windowsHide:true,encoding:"utf8",timeout:15_000,maxBuffer:8192});
  const revision=git(["rev-parse","--verify","HEAD"]),clean=git(["diff","--quiet","HEAD","--"]);
  if(revision.error||revision.status!==0||revision.stdout.trim()!==input.comfyCommitSha||clean.error||clean.status!==0)return deny();
  const python=environment.COMFYUI_PYTHON_COMMAND??"",stat=lstatSync(python);
  if(python!==path.join(layout.providerRoot,".venv",process.platform==="win32"?"Scripts/python.exe":"bin/python")||!stat.isFile()||stat.isSymbolicLink()||stat.nlink!==1||realpathSync(python)!==python)return deny();
  return captureImageInspection(JSON.stringify({schemaVersion:"image-host-local-inputs-v1",status:"input-identity-verified",runId:run,sourceRevision:source,
    checkpointFileName:input.checkpointFileName,checkpointSha256:input.checkpointSha256,checkpointBytes:input.checkpointBytes,comfyCommitSha:input.comfyCommitSha,
    managedSourceConfirmed:true,runtimeDependenciesQualified:false,hostLaunched:false,modelAccuracyExecuted:false}),run,source);
}
export function imageFixture(inspection:ImageHostInspection,host:ImageHost,journey:ImageJourney):ImageHostFixture{
  const facts=captureImageInspection(JSON.stringify(inspection),inspection.runId,inspection.sourceRevision);
  return captureImageHostFixture(JSON.stringify({schemaVersion:"image-host-fixture-v1",runId:facts.runId,sourceRevision:facts.sourceRevision,host,journey,
    workspaceId:imageHostWorkspace(facts.runId,host,journey),modelRecordId:imageHostModelRecord(facts.runId,host,journey),checkpointFileName:facts.checkpointFileName,checkpointSha256:facts.checkpointSha256}),facts.runId,facts.sourceRevision,host,journey)!;
}
export async function seedDesktopImageInputs(environment:NodeJS.ProcessEnv):Promise<string>{
  const facts=await inspectImageInputs(environment),journey=environment.VISUAL_COMPOSER_IMAGE_CASE;
  if(journey!=="create-register"&&journey!=="task-recovery")return deny();
  const expected=createImageCaseEnvironment(environment,repoRoot,facts.runId,"packaged-desktop",journey,facts),root=environment.VISUAL_COMPOSER_DESKTOP_DATA_ROOT;
  if(root!==expected.VISUAL_COMPOSER_DESKTOP_DATA_ROOT)return deny();
  const parts=path.relative(repoRoot,root!).split(path.sep);
  for(let i=0;i<=parts.length;i++){const current=path.join(repoRoot,...parts.slice(0,i)),stat=lstatSync(current);if(!stat.isDirectory()||stat.isSymbolicLink()||realpathSync(current)!==current)return deny();}
  for(const leaf of ["image-temp","controlled-model-cache"])mkdirSync(path.join(root!,leaf),{recursive:true});
  const database=await openLocalSqliteDatabase({policy:resolveLocalSqliteDatabasePolicy({dataRootDirectory:root!})});
  try{const identity=await readLocalIdentityProfile(database.documents);if(!identity)return deny();
    return await seedImageInputRecords({rootDirectory:root!,checkpointDirectory:imageHostLayout(repoRoot,facts.runId).checkpointRoot,documents:database.documents.forOrganization(identity.organizationId),fixture:imageFixture(facts,"packaged-desktop",journey)});
  }finally{database.close();}
}
async function main(){
  if(process.platform!=="win32"||process.argv.length!==3)return deny();
  if(process.argv[2]==="--inspect-inputs")process.stdout.write(JSON.stringify(await inspectImageInputs(process.env))+"\n");
  else if(process.argv[2]==="--seed-inputs")process.stdout.write(await seedDesktopImageInputs(process.env)+"\n");else return deny();
}
if(process.argv[1]&&path.resolve(process.argv[1])===path.join(__dirname,"image-host-fixture.ts"))void main().catch(()=>{
  process.stderr.write('{"schemaVersion":"image-host-prerequisites-v1","status":"pending","reason":"fixed-local-image-inputs"}\n');process.exitCode=1;
});
