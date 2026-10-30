import {expect,type Page,type TestInfo} from "@playwright/test";
import {lstat,mkdir,realpath,writeFile} from "node:fs/promises";
import path from "node:path";
import {artifactKey,artifactWorkspace,ARTIFACT_SAMPLE_NAME,ARTIFACT_SAMPLE_TEXT} from "../functional-artifact-oracles";
import {functionalHostIdentity,type FunctionalHost} from "../functional-host-oracles";
import {FUNCTIONAL_PROVIDER_REPOSITORY,type ProviderSourceFile} from "../functional-provider-plan.mjs";
import {captureProviderBacking,captureProviderBytes,capturePrivatePublicationWitness,providerHostPhases,providerHostReport,type ProviderHostCase} from "../functional-provider-oracles";
import {privateProviderFailureStage} from "../functional-private-provider-fixture";
import {finalizeQualificationEvidence,safeQualificationFailureType} from "../qualification-reporting";
import {readArtifactHostState} from "./artifact-host-browser-reads";

/** Actual controls shared by the two provider cases; no writes through a private bridge. */
export function providerArtifactUi(page:Page,host:FunctionalHost){
  const select=()=>page.getByLabel("Select current workspace",{exact:true});
  const detail=()=>host==="packaged-desktop"?page.getByRole("dialog",{name:"Detail & preview",exact:true}):page.locator("section").filter({has:page.getByRole("heading",{name:"Artifact Browser",exact:true})}).last();
  async function closeDetail(){if(host==="packaged-desktop"&&await detail().count())await detail().getByRole("button",{name:"Close detail and preview",exact:true}).click();}
  async function workspace(name:"Provider source fixture"|"Provider isolation fixture"|"Private publication fixture"){
    await closeDetail();await expect(select()).toBeVisible({timeout:60_000});const previous=await select().inputValue();await page.getByRole("button",{name:"Home",exact:true}).click();await page.getByRole("button",{name:"Create new workspace",exact:true}).click();
    await page.locator('input[name="workspaceName"]').fill(name);await page.getByRole("button",{name:"Create workspace",exact:true}).click();await expect(page.locator(".workspace-create-form")).toHaveCount(0);await expect(select()).toHaveValue(/^workspace\./);await expect(select()).not.toHaveValue(previous);return artifactWorkspace(await select().inputValue());
  }
  async function list(scope:string){const rows=await readArtifactHostState(page,{host,workspaceId:scope,key:"",mode:"list"});if(!Array.isArray(rows))throw new Error("The provider fixture artifact list is unavailable.");return rows;}
  async function ingestion(){await closeDetail();await page.getByRole("button",{name:"Artifacts",exact:true}).click();await page.getByRole("tab",{name:"Artifact Ingestion",exact:true}).click();return page.getByRole("list",{name:"Add data workflow",exact:true});}
  async function notificationCount(message:string){
    const center=page.getByRole("dialog",{name:"Notifications",exact:true});await page.getByRole("button",{name:/^Notifications(?:,|$)/}).click();const count=await center.locator(".ui-notification__item").filter({hasText:message}).count();await center.getByRole("button",{name:"Close notifications",exact:true}).click();return count;
  }
  async function completedNotification(message:string,previous:number){
    const center=page.getByRole("dialog",{name:"Notifications",exact:true});await expect(center).toBeVisible({timeout:90_000});await expect(center.locator(".ui-notification__item").filter({hasText:message})).toHaveCount(previous+1,{timeout:90_000});await center.getByRole("button",{name:"Close notifications",exact:true}).click();
  }
  async function open(scope:string,key:string,name:string){
    await closeDetail();await expect(select()).toHaveValue(scope);await page.getByRole("button",{name:"Artifacts",exact:true}).click();await page.getByRole("tab",{name:"Artifact Browser",exact:true}).click();
    const button=host==="packaged-desktop"?page.getByRole("region",{name:"Uploaded artifacts",exact:true}).locator("article").filter({has:page.getByRole("heading",{name,exact:true,level:4})}).getByRole("button",{name:"View Details",exact:true}):page.getByRole("button",{name,exact:true});
    await expect(button).toHaveCount(1);await button.click();await expect(detail()).toBeVisible();await expect(detail().locator("dt").filter({hasText:/^Selected key/}).locator("xpath=following-sibling::dd[1]")).toHaveText(key);
  }
  async function uploadInventory(scope:string){
    expect(await list(scope)).toEqual([]);const workflow=await ingestion();await workflow.getByRole("radio",{name:"Files",exact:true}).check();const input=workflow.getByLabel("Choose one or more files",{exact:true});await input.setInputFiles([{name:ARTIFACT_SAMPLE_NAME,mimeType:"application/json",buffer:Buffer.from(ARTIFACT_SAMPLE_TEXT)}]);
    const prior=await notificationCount("All files are ready.");await workflow.getByRole("button",{name:"Add data",exact:true}).click();await completedNotification("All files are ready.",prior);await expect(input).toHaveValue("");const rows=await list(scope);expect(rows).toHaveLength(1);expect(rows[0]!.originalName).toBe(ARTIFACT_SAMPLE_NAME);return artifactKey(rows[0]!.storageKey);
  }
  return{select,detail,closeDetail,workspace,list,ingestion,notificationCount,completedNotification,open,uploadInventory,
    async reload(scope:string){await page.reload();await expect(select()).toHaveValue(scope,{timeout:60_000});},
    async switchTo(scope:string){await closeDetail();await select().selectOption(scope);await expect(select()).toHaveValue(scope);},
  };
}

/** Exclusive bounded evidence, with every parent checked before creating a child. */
export async function publishProviderHostEvidence(info:TestInfo,host:FunctionalHost,purpose:ProviderHostCase,localize:boolean,phases:string[],failed:boolean,failure:unknown,witness?:ReturnType<typeof capturePrivatePublicationWitness>){
  const run=process.env.VISUAL_COMPOSER_QUALIFICATION_RUN_ID,source=process.env.VISUAL_COMPOSER_QUALIFICATION_SOURCE_REVISION;
  if(purpose==="provider-publication"&&!failed&&!witness)throw new Error("The private publication witness is missing.");
  const report={...providerHostReport(run,source,host,purpose,localize,phases,failed),failureTypes:failed?[safeQualificationFailureType(failure)]:[],providerFailureStage:failed?privateProviderFailureStage(failure):null,remoteWitness:witness?capturePrivatePublicationWitness(witness):null};
  const serialize=()=>{const body=JSON.stringify(report)+"\n";if(Buffer.byteLength(body)>8192)throw new Error("The provider report exceeded its bound.");return body;};
  await finalizeQualificationEvidence(report,failed?[new Error("The provider UI journey failed. See its fixed phase report.")]:[],async()=>{
    let folder=process.cwd();if(await realpath(folder)!==folder)throw new Error("Provider evidence requires the physical repository.");
    for(const part of ["artifacts","qualification","visual-composer","runs",report.runId,"provider-host",host,purpose]){
      folder=path.join(folder,part);let stat=await lstat(folder).catch(error=>{if(error.code==="ENOENT")return undefined;throw error;});if(!stat){await mkdir(folder);stat=await lstat(folder);}if(!stat.isDirectory()||stat.isSymbolicLink()||await realpath(folder)!==folder)throw new Error("Provider evidence parent is unavailable.");
    }
    await writeFile(path.join(folder,"journey.json"),serialize(),{flag:"wx"});
  },()=>info.attach("functional-provider-host",{body:serialize(),contentType:"application/json"}));
  return report;
}

export async function qualifyProviderSourceHostJourney(page:Page,info:TestInfo,host:FunctionalHost,file:ProviderSourceFile){
  functionalHostIdentity(process.env.VISUAL_COMPOSER_QUALIFICATION_RUN_ID,process.env.VISUAL_COMPOSER_QUALIFICATION_SOURCE_REVISION,host);if(info.project.name!==host)throw new Error("The provider host does not match its fixed project.");
  const ui=providerArtifactUi(page,host),phases:string[]=[],expected=providerHostPhases(host,"provider-source",file.localize);let workspace="",key="",failed=false,failure:unknown;
  async function step(name:string,action:()=>Promise<void>){if(expected[phases.length]!==name)throw new Error("Unexpected provider phase.");await action();phases.push(name);}
  async function check(local:boolean){captureProviderBacking(await readArtifactHostState(page,{host,workspaceId:workspace,key,mode:"backing"}),workspace,key,file,local);}
  try{
    await step("fresh-provider-workspace",async()=>{workspace=await ui.workspace("Provider source fixture");expect(await ui.list(workspace)).toEqual([]);});
    await step("exact-provider-file-selected",async()=>{
      const workflow=await ui.ingestion();await workflow.getByRole("radio",{name:"Hugging Face dataset",exact:true}).check();await workflow.getByRole("textbox",{name:"User or organization",exact:true}).fill("OpenFinAL");await workflow.getByRole("button",{name:"Find datasets",exact:true}).click();
      const datasets=workflow.getByRole("group",{name:"Select datasets",exact:true});await datasets.getByRole("checkbox",{name:FUNCTIONAL_PROVIDER_REPOSITORY,exact:true}).check();await expect(datasets.locator('input[type="checkbox"]:checked')).toHaveCount(1);await workflow.getByRole("button",{name:"View files from selected datasets",exact:true}).click();
      const files=workflow.getByRole("group",{name:`Select files from ${FUNCTIONAL_PROVIDER_REPOSITORY}`,exact:true});await files.getByRole("checkbox",{name:file.path,exact:true}).check();await expect(files.locator('input[type="checkbox"]:checked')).toHaveCount(1);
    });
    await step("reference-task-completed",async()=>{const prior=await ui.notificationCount("All provider files are ready.");await page.getByRole("list",{name:"Add data workflow",exact:true}).getByRole("button",{name:"Add data",exact:true}).click();await ui.completedNotification("All provider files are ready.",prior);const rows=await ui.list(workspace);expect(rows).toHaveLength(1);expect(rows[0]!.originalName).toBe(file.path);key=artifactKey(rows[0]!.storageKey);});
    await step("remote-reference-confirmed",async()=>{await ui.open(workspace,key,file.path);await check(false);});
    await step("reload-keeps-reference",async()=>{await ui.reload(workspace);await ui.open(workspace,key,file.path);await check(false);});
    if(file.localize){
      await step("explicit-localization-completed",async()=>{await ui.detail().getByRole("button",{name:"Localize artifact",exact:true}).click();await expect(ui.detail().locator("dt").filter({hasText:/^Local object availability/}).locator("xpath=following-sibling::dd[1]")).toHaveText("available",{timeout:90_000});await check(true);});
      await step("localized-bytes-confirmed",async()=>{captureProviderBytes(await readArtifactHostState(page,{host,workspaceId:workspace,key,mode:"bytes"}),workspace,key,file);});
      await step("reload-keeps-localized-reference",async()=>{await ui.reload(workspace);await ui.open(workspace,key,file.path);await check(true);captureProviderBytes(await readArtifactHostState(page,{host,workspaceId:workspace,key,mode:"bytes"}),workspace,key,file);});
    }
    await step("second-workspace-empty",async()=>{const other=await ui.workspace("Provider isolation fixture");expect(other).not.toBe(workspace);expect(await ui.list(other)).toEqual([]);});
    await step("cross-workspace-reference-denied",async()=>{const other=artifactWorkspace(await ui.select().inputValue());expect(await readArtifactHostState(page,{host,workspaceId:other,key,mode:"isolated"})).toEqual({requestedWorkspaceId:other,storageKey:key,absent:false,isolated:true});});
    await step("original-reference-retained",async()=>{await ui.switchTo(workspace);await ui.open(workspace,key,file.path);await check(file.localize);});
  }catch(error){failed=true;failure=error;}
  return publishProviderHostEvidence(info,host,"provider-source",file.localize,phases,failed,failure);
}
