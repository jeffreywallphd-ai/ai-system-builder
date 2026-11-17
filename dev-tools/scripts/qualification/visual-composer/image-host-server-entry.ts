import path from "node:path";
import {createServer,createServerListener} from "../../../../apps/server/src/createServer";
import {shutdownServerResources} from "../../../../apps/server/src/shutdownServerResources";
import {createInMemoryStructuredDocumentStore} from "../../../../modules/adapters/persistence/shared";
import {createOrganizationId} from "../../../../modules/contracts/organization";
import {createVisualComposerQualificationRuntimeDatabase} from "./visual-composer-runtime-database";
// @ts-expect-error Existing qualification MJS has no declaration; it performs fixed runtime assertions.
import {createControlledRuntimeEnvironmentPreparer} from "./controlled-runtime-preparation.mjs";
import {imageHostLayout} from "./image-host-launch-plan.mjs";
import {inspectImageInputs,imageFixture} from "./image-host-fixture";
import {seedImageInputRecords} from "./image-host-input-records";
import {installImageHostShutdown} from "./image-host-shutdown.mjs";

let owner:Awaited<ReturnType<typeof createServer>>|undefined,listener:ReturnType<typeof createServerListener>|undefined;
let closing:Promise<void>|undefined;
async function close(){
  closing??=shutdownServerResources({listener:listener?.listening?listener:undefined,
    shutdownBackgroundTasks:async()=>{await owner?.shutdownBackgroundTasks();},closePersistence:async()=>{await owner?.closePersistence();}});
  await closing;
}
async function start(){
  const facts=await inspectImageInputs(process.env),layout=imageHostLayout(process.cwd(),facts.runId);
  if(process.env.SERVER_RUNTIME_ROOT!==layout.serverRuntimeRoot||process.env.SERVER_STORAGE_ROOT!==path.join(layout.runRoot,"thin-storage")||
    process.env.AI_SYSTEM_BUILDER_DEDICATED_ORGANIZATION_ID!=="qualification.local"||process.env.PYTHON_RUNTIME_QUALIFICATION_SCENARIO!=="immediate")throw new Error("Fixed image Server composition is required.");
  const documents=createInMemoryStructuredDocumentStore().forOrganization(createOrganizationId("qualification.local"));
  try{
    owner=await createServer({env:process.env,structuredDocuments:documents,runtimeDatabases:createVisualComposerQualificationRuntimeDatabase(),
      pythonRuntimeEnvironmentPreparer:createControlledRuntimeEnvironmentPreparer({repoRoot:process.cwd(),runRoot:layout.serverRuntimeRoot,environment:process.env})});
    if(owner.config.storageRootDirectory!==path.join(layout.runRoot,"thin-storage"))throw new Error("Fixed image storage root is required.");
    for(const journey of ["create-register","task-recovery"] as const)await seedImageInputRecords({rootDirectory:owner.config.storageRootDirectory,checkpointDirectory:layout.checkpointRoot,documents,fixture:imageFixture(facts,"thin-chrome",journey)});
    listener=createServerListener(owner);const active=listener;
    await new Promise<void>((resolve,reject)=>{active.once("error",reject);active.listen(owner!.config.port,()=>{active.off("error",reject);resolve();});});
  }catch{await close();throw new Error("Image Server startup did not complete.");}
}
const started=start();started.catch(()=>{});
const control=installImageHostShutdown({input:process.stdin,output:process.stdout,runId:process.env.VISUAL_COMPOSER_QUALIFICATION_RUN_ID!,sourceRevision:process.env.VISUAL_COMPOSER_QUALIFICATION_SOURCE_REVISION!,
  shutdown:async()=>{try{await started;}catch{/* Preserve failed startup, then try the existing owner fence. */process.exitCode=1;}await close();},
  onSettled:passed=>{if(!passed)process.exitCode=1;}});
process.once("SIGINT",()=>{void control.stop();});process.once("SIGTERM",()=>{void control.stop();});
void started.catch(()=>{process.exitCode=1;void control.stop();});
