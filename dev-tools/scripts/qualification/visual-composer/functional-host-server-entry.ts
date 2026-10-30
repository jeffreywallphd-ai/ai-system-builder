import path from "node:path";
import {createServer,createServerListener} from "../../../../apps/server/src/createServer";
import {shutdownServerResources} from "../../../../apps/server/src/shutdownServerResources";
import {createInMemoryStructuredDocumentStore} from "../../../../modules/adapters/persistence/shared";
import {createOrganizationId} from "../../../../modules/contracts/organization";
import {createVisualComposerQualificationRuntimeDatabase} from "./visual-composer-runtime-database";
// @ts-expect-error Existing fixed MJS fixture has no TypeScript declaration.
import {createControlledRuntimeEnvironmentPreparer} from "./controlled-runtime-preparation.mjs";
import {functionalHostLayout} from "./functional-host-launch-plan.mjs";
import {installOwnedHostShutdown} from "./owned-host-shutdown.mjs";

let owner:Awaited<ReturnType<typeof createServer>>|undefined,listener:ReturnType<typeof createServerListener>|undefined,closing:Promise<void>|undefined;
async function close(){
  closing??=shutdownServerResources({listener:listener?.listening?listener:undefined,
    shutdownBackgroundTasks:async()=>{await owner?.shutdownBackgroundTasks();},closePersistence:async()=>{await owner?.closePersistence();}});
  await closing;
}
async function start(){
  const layout=functionalHostLayout(process.cwd(),process.env.VISUAL_COMPOSER_QUALIFICATION_RUN_ID!,process.env.VISUAL_COMPOSER_QUALIFICATION_SOURCE_REVISION!);
  if(process.env.SERVER_RUNTIME_ROOT!==layout.serverRuntimeRoot||process.env.SERVER_STORAGE_ROOT!==layout.serverStorageRoot||
    process.env.AI_SYSTEM_BUILDER_DEDICATED_ORGANIZATION_ID!=="qualification.local"||process.env.PYTHON_RUNTIME_QUALIFICATION_SCENARIO!=="immediate"||
    Object.keys(process.env).some(key=>/^(?:HF_TOKEN|HUGGING_FACE_TOKEN|AI_SYSTEM_BUILDER_PROVIDER_CREDENTIAL_MIGRATION_ORGANIZATION_ID)$/i.test(key)))throw new Error("Fixed isolated Functional composition is required.");
  const documents=createInMemoryStructuredDocumentStore().forOrganization(createOrganizationId("qualification.local"));
  try{
    owner=await createServer({env:process.env,structuredDocuments:documents,runtimeDatabases:createVisualComposerQualificationRuntimeDatabase(),
      pythonRuntimeEnvironmentPreparer:createControlledRuntimeEnvironmentPreparer({repoRoot:process.cwd(),runRoot:layout.serverRuntimeRoot,environment:process.env})});
    if(owner.config.storageRootDirectory!==path.resolve(layout.serverStorageRoot))throw new Error("Fixed Functional storage root is required.");
    listener=createServerListener(owner);const active=listener;
    await new Promise<void>((resolve,reject)=>{active.once("error",reject);active.listen(owner!.config.port,()=>{active.off("error",reject);resolve();});});
  }catch{await close();throw new Error("Functional Server startup did not complete.");}
}
const started=start();started.catch(()=>{});
const control=installOwnedHostShutdown("functional-data",{input:process.stdin,output:process.stdout,runId:process.env.VISUAL_COMPOSER_QUALIFICATION_RUN_ID!,sourceRevision:process.env.VISUAL_COMPOSER_QUALIFICATION_SOURCE_REVISION!,
  shutdown:async()=>{try{await started;}catch{process.exitCode=1;}await close();},onSettled:passed=>{if(!passed)process.exitCode=1;}});
process.once("SIGINT",()=>{void control.stop();});process.once("SIGTERM",()=>{void control.stop();});
void started.catch(()=>{process.exitCode=1;void control.stop();});
