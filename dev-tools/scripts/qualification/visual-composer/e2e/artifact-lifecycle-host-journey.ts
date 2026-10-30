import {expect,type Page,type TestInfo} from "@playwright/test";
import {createHash} from "node:crypto";
import {functionalHostIdentity,type FunctionalHost} from "../functional-host-oracles";
import {ARTIFACT_SAMPLE_NAME,ARTIFACT_SAMPLE_TEXT,ARTIFACT_SAMPLE_BYTES,ARTIFACT_SAMPLE_SHA256,artifactWorkspace,artifactKey,captureLocalArtifactState,artifactHostPhases,artifactHostReport,type ArtifactHostCase} from "../functional-artifact-oracles";
import {safeQualificationFailureType} from "../qualification-reporting";
import {readArtifactHostState} from "./artifact-host-browser-reads";

/** Real local UI, task, public reads and one genuine LAN permission refusal. */
export async function qualifyArtifactLifecycleHostJourney(page:Page,info:TestInfo,host:FunctionalHost,scenario:ArtifactHostCase){
  const run=process.env.VISUAL_COMPOSER_QUALIFICATION_RUN_ID,source=process.env.VISUAL_COMPOSER_QUALIFICATION_SOURCE_REVISION;
  functionalHostIdentity(run,source,host);if(info.project.name!==host)throw new Error("The artifact host does not match its fixed project.");
  const expected=artifactHostPhases(host,scenario),phases:string[]=[];let workspace="",key="",other="",otherKey="",failed=false,failure:unknown;
  const select=()=>page.getByLabel("Select current workspace",{exact:true});
  const detail=()=>host==="packaged-desktop"?page.getByRole("dialog",{name:"Detail & preview",exact:true})
    :page.locator("section").filter({has:page.getByRole("heading",{name:"Artifact Browser",exact:true})}).last();
  const selectedKey=()=>detail().locator("dt").filter({hasText:/^Selected key/}).locator("xpath=following-sibling::dd[1]");
  const sample=()=>host==="packaged-desktop"?page.getByRole("region",{name:"Uploaded artifacts",exact:true}).locator("article").filter({has:page.getByRole("heading",{name:ARTIFACT_SAMPLE_NAME,exact:true,level:4})}).getByRole("button",{name:"View Details",exact:true})
    :page.getByRole("button",{name:ARTIFACT_SAMPLE_NAME,exact:true});
  async function step(phase:string,action:()=>Promise<void>){if(expected[phases.length]!==phase)throw new Error("Unexpected artifact phase.");await action();phases.push(phase);}
  async function makeWorkspace(name:"Artifact lifecycle fixture"|"Artifact isolation fixture"|"Artifact route denial fixture"){
    await expect(select()).toBeVisible({timeout:60_000});const previous=await select().inputValue();
    await page.getByRole("button",{name:"Home",exact:true}).click();await page.getByRole("button",{name:"Create new workspace",exact:true}).click();
    await page.locator('input[name="workspaceName"]').fill(name);await page.getByRole("button",{name:"Create workspace",exact:true}).click();
    await expect(page.locator(".workspace-create-form")).toHaveCount(0);await expect(select()).toHaveValue(/^workspace\./);await expect(select()).not.toHaveValue(previous);
    return artifactWorkspace(await select().inputValue());
  }
  async function list(scope:string){
    const rows=await readArtifactHostState(page,{host,workspaceId:scope,key:"",mode:"list"});if(!Array.isArray(rows))throw new Error("The artifact list did not complete.");return rows;
  }
  async function inspect(scope:string,selected:string){return captureLocalArtifactState(await readArtifactHostState(page,{host,workspaceId:scope,key:selected,mode:"inspect"}),scope,selected);}
  async function openBrowser(){await page.getByRole("button",{name:"Artifacts",exact:true}).click();await page.getByRole("tab",{name:"Artifact Browser",exact:true}).click();}
  async function closeDetail(){if(host==="packaged-desktop"&&await detail().count())await detail().getByRole("button",{name:"Close detail and preview",exact:true}).click();}
  async function openExact(scope:string,selected:string){
    await expect(select()).toHaveValue(scope);await openBrowser();await expect(sample()).toHaveCount(1);await sample().click();await expect(detail()).toBeVisible();
    await expect(selectedKey()).toHaveText(selected);
    await expect(detail().getByRole("region",{name:"Artifact preview",exact:true})).toContainText("solar lantern");
    await expect(detail().getByRole("region",{name:"Artifact preview",exact:true})).toContainText("water filter");
    await expect(detail().locator("dt").filter({hasText:/^Local object availability/}).locator("xpath=following-sibling::dd[1]")).toHaveText("available");
    await inspect(scope,selected);
  }
  async function upload(scope:string){
    expect(await list(scope)).toEqual([]);await page.getByRole("button",{name:"Artifacts",exact:true}).click();await page.getByRole("tab",{name:"Artifact Ingestion",exact:true}).click();
    const workflow=page.getByRole("list",{name:"Add data workflow",exact:true}),input=workflow.getByLabel("Choose one or more files",{exact:true});
    await workflow.getByRole("radio",{name:"Files",exact:true}).check();await input.setInputFiles([{name:ARTIFACT_SAMPLE_NAME,mimeType:"application/json",buffer:Buffer.from(ARTIFACT_SAMPLE_TEXT)}]);
    const center=page.getByRole("dialog",{name:"Notifications",exact:true});await page.getByRole("button",{name:/^Notifications(?:,|$)/}).click();
    const prior=await center.locator(".ui-notification__item").filter({hasText:"All files are ready."}).count();await center.getByRole("button",{name:"Close notifications",exact:true}).click();
    await workflow.getByRole("button",{name:"Add data",exact:true}).click();await expect(center).toBeVisible({timeout:90_000});
    await expect(center.locator(".ui-notification__item").filter({hasText:"All files are ready."})).toHaveCount(prior+1,{timeout:90_000});
    await center.getByRole("button",{name:"Close notifications",exact:true}).click();await expect(input).toHaveValue("");await expect(workflow.getByRole("alert")).toHaveCount(0);
    const rows=await list(scope);expect(rows).toHaveLength(1);expect(rows[0]!.originalName).toBe(ARTIFACT_SAMPLE_NAME);return artifactKey(rows[0]!.storageKey);
  }
  async function reload(scope:string){await page.reload();await expect(select()).toHaveValue(scope,{timeout:60_000});}
  async function switchTo(scope:string){await closeDetail();await select().selectOption(scope);await expect(select()).toHaveValue(scope);}
  try{
    await step("owned-artifact-imported",async()=>{workspace=await makeWorkspace(scenario==="publication-denial"?"Artifact route denial fixture":"Artifact lifecycle fixture");key=await upload(workspace);});
    if(scenario==="publication-denial"){
      const bearer=process.env.VISUAL_COMPOSER_FUNCTIONAL_ARTIFACT_READ_BEARER;
      if(typeof bearer!=="string"||!/^[A-Za-z0-9_-]{43}$/.test(bearer))throw new Error("The isolated artifact read identity is unavailable.");
      await step("readonly-authenticated",async()=>{expect(await readArtifactHostState(page,{host,workspaceId:workspace,key,mode:"readonly-control",bearer})).toEqual({authenticatedReadSucceeded:true,storageKey:key});});
      await step("publication-forbidden",async()=>{
        const rows=await list(workspace);expect(rows).toHaveLength(1);expect(rows[0]!.storageKey).toBe(key);const artifactId=artifactKey(rows[0]!.artifactId);
        expect(await readArtifactHostState(page,{host,workspaceId:workspace,key,mode:"deny-publication",bearer,artifactId})).toEqual({authenticatedRouteDenied:true,status:403,permission:"artifact:write"});
      });
      await step("local-artifact-unchanged",async()=>{await openExact(workspace,key);});
      await step("reload-keeps-artifact",async()=>{await reload(workspace);await openExact(workspace,key);});
    }else{
      await step("local-readback-confirmed",async()=>{await openExact(workspace,key);});
      await step("reload-confirmed",async()=>{await reload(workspace);await openExact(workspace,key);});
      if(host==="packaged-desktop")await step("export-bytes-confirmed",async()=>{
        const pending=page.waitForEvent("download");await detail().getByRole("button",{name:"Download artifact",exact:true}).click();const download=await pending;
        expect(download.suggestedFilename()).toBe(ARTIFACT_SAMPLE_NAME);const stream=await download.createReadStream();if(!stream)throw new Error("The synthetic artifact download is unavailable.");
        const hash=createHash("sha256");let bytes=0;
        try{for await(const chunk of stream){if(!Buffer.isBuffer(chunk)||chunk.length>4096-bytes)throw new Error("The synthetic artifact export exceeded its byte bound.");bytes+=chunk.length;hash.update(chunk);}}
        catch{stream.destroy();await download.cancel();throw new Error("The synthetic artifact export did not complete.");}
        expect(bytes).toBe(ARTIFACT_SAMPLE_BYTES);expect(hash.digest("hex")).toBe(ARTIFACT_SAMPLE_SHA256);
      });
      await step("second-workspace-owned",async()=>{await closeDetail();other=await makeWorkspace("Artifact isolation fixture");expect(other).not.toBe(workspace);expect(await list(other)).toEqual([]);});
      await step("cross-workspace-read-denied",async()=>{expect(await readArtifactHostState(page,{host,workspaceId:other,key,mode:"isolated"})).toEqual({requestedWorkspaceId:other,storageKey:key,absent:false,isolated:true});});
      await step("second-artifact-imported",async()=>{otherKey=await upload(other);await openExact(other,otherKey);await switchTo(workspace);await openExact(workspace,key);});
      const requestDelete=()=>detail().getByRole("button",{name:host==="packaged-desktop"?"Delete registered artifact":"Delete artifact",exact:true}).click();
      const confirmation=()=>page.getByRole("dialog",{name:"Delete artifact",exact:true});
      await step("cancel-preserves-artifact",async()=>{await requestDelete();await expect(confirmation()).toContainText(key);await confirmation().getByRole("button",{name:"Cancel",exact:true}).click();await expect(confirmation()).toHaveCount(0);await inspect(workspace,key);await expect(selectedKey()).toHaveText(key);});
      await step("typed-confirmation-required",async()=>{await requestDelete();await confirmation().getByRole("textbox",{name:/^Confirmation\b/}).fill("delete");await expect(confirmation().getByRole("button",{name:"Confirm delete",exact:true})).toBeDisabled();await inspect(workspace,key);});
      await step("local-deletion-confirmed",async()=>{
        await confirmation().getByRole("textbox",{name:/^Confirmation\b/}).fill("Delete");await confirmation().getByRole("button",{name:"Confirm delete",exact:true}).click();await expect(confirmation()).toHaveCount(0);await expect(selectedKey()).toHaveCount(0);
        if(host==="packaged-desktop")await expect(detail()).toHaveCount(0);
        else await expect(detail().getByRole("region",{name:"Artifact preview",exact:true})).toHaveCount(0);
        expect(await list(workspace)).toEqual([]);expect(await readArtifactHostState(page,{host,workspaceId:workspace,key,mode:"gone"})).toEqual({requestedWorkspaceId:workspace,storageKey:key,absent:true,isolated:false});
      });
      await step("reload-keeps-deletion",async()=>{await reload(workspace);await openBrowser();expect(await list(workspace)).toEqual([]);await expect(sample()).toHaveCount(0);});
      await step("second-workspace-retained",async()=>{await switchTo(other);await openExact(other,otherKey);});
    }
  }catch(error){failed=true;failure=error;}
  const report={...artifactHostReport(run,source,host,scenario,phases,failed),failureTypes:failed?[safeQualificationFailureType(failure)]:[]};
  try{const body=JSON.stringify(report);if(Buffer.byteLength(body)>8192)throw new Error("Artifact report bound.");await info.attach("functional-local-artifact-host",{body,contentType:"application/json"});}
  catch{throw new Error(failed?"Artifact journey and safe evidence attachment failed.":"Artifact safe evidence attachment failed.");}
  if(failed)throw new Error("The artifact host journey failed. See its fixed phase report.");return report;
}
