import {expect,type Page,type TestInfo,type Locator} from "@playwright/test";
import {FUNCTIONAL_REFERENCE_MODEL,MODEL_REFERENCE_PHASES,functionalHostIdentity,captureModelReferenceInventory,modelReferenceHostReport,type FunctionalHost} from "../functional-host-oracles";
import {safeQualificationFailureType} from "../qualification-reporting";
import {createFunctionalWorkspace,readFunctionalModelInventory} from "./functional-host-common";

/** The real mounted search and Save controls. Never click Download or inject success. */
export async function qualifyModelReferenceHostJourney(page:Page,info:TestInfo,host:FunctionalHost){
  const run=process.env.VISUAL_COMPOSER_QUALIFICATION_RUN_ID,source=process.env.VISUAL_COMPOSER_QUALIFICATION_SOURCE_REVISION;
  functionalHostIdentity(run,source,host);
  if(info.project.name!==host)throw new Error("The model-reference host does not match its fixed project.");
  const phases:string[]=[];let failed=false,failure:unknown,workspace="",record="";
  const exactModel=/^Qwen\/Qwen2\.5-0\.5B-Instruct$/;
  async function step(phase:string,action:()=>Promise<void>){if(MODEL_REFERENCE_PHASES[phases.length]!==phase)throw new Error("Unexpected model-reference phase.");await action();phases.push(phase);}
  const read=async()=>captureModelReferenceInventory(await readFunctionalModelInventory(page,host,workspace),workspace);
  async function openModels(){await page.getByRole("button",{name:"Models",exact:true}).click();}
  async function inventoryCard(){
    if(host==="packaged-desktop")await page.getByRole("tab",{name:"Manage Models",exact:true}).click();
    const container=host==="packaged-desktop"?page.getByRole("region",{name:"Managed models",exact:true}):page.locator("section").filter({has:page.getByRole("heading",{name:"Server model inventory",exact:true})}).last();
    return container.locator(host==="packaged-desktop"?"article":"li").filter({hasText:FUNCTIONAL_REFERENCE_MODEL});
  }
  async function expectSavedDetails(){
    const card=await inventoryCard();await expect(card).toHaveCount(1);await expect(card).toContainText("saved-reference");
    if(host==="thin-chrome")await expect(card.locator("header>span")).toHaveText("Reference saved");
    await card.getByRole("button",{name:"Details",exact:true}).click();
    const dialog=page.getByRole("dialog",{name:"Model details",exact:true});await expect(dialog).toBeVisible();await expect(dialog).toContainText(FUNCTIONAL_REFERENCE_MODEL);
    await expect(dialog).toContainText("Not available");if(host==="packaged-desktop")await expect(dialog).toContainText(record);
    await dialog.getByRole("button",{name:"Close model details",exact:true}).click();
  }
  try{
    await step("workspace-opened",async()=>{workspace=await createFunctionalWorkspace(page,"Model reference fixture");await openModels();});
    await step("inventory-empty",async()=>{expect(await read()).toEqual([]);});
    let result:Locator|undefined;
    await step("search-complete",async()=>{
      if(host==="packaged-desktop"){
        await page.getByRole("tab",{name:"Find Models",exact:true}).click();await page.getByRole("textbox",{name:/^Query\b/}).fill(FUNCTIONAL_REFERENCE_MODEL);
        await page.getByRole("combobox",{name:/^Results per page\b/}).selectOption("10");await page.getByRole("button",{name:"Search Models",exact:true}).click();
        result=page.getByRole("region",{name:"Model search results",exact:true}).locator("article").filter({has:page.locator("p.models-feature__identifier").filter({hasText:exactModel})});
      }else{
        await page.getByRole("textbox",{name:/^Search\b/}).fill(FUNCTIONAL_REFERENCE_MODEL);await page.getByRole("button",{name:"Browse models",exact:true}).click();
        result=page.locator("li").filter({has:page.locator("header>span").filter({hasText:exactModel})});
      }
      await expect(result!).toHaveCount(1,{timeout:30_000});await expect(result!).toBeVisible();
    });
    await step("metadata-confirmed",async()=>{
      await expect(result!.locator(host==="packaged-desktop"?"p.models-feature__identifier":"header>span")).toHaveText(FUNCTIONAL_REFERENCE_MODEL);
      if(host==="thin-chrome"){
        await result!.getByRole("button",{name:"Details",exact:true}).click();
        const details=page.locator("details").filter({has:page.locator("summary").getByText("Model details",{exact:true})});
        await expect(details).toHaveCount(1);await details.locator("summary").click();await expect(details).toContainText(FUNCTIONAL_REFERENCE_MODEL);
      }
    });
    await step("reference-saved",async()=>{
      await result!.getByRole("button",{name:host==="packaged-desktop"?"Save":"Save reference",exact:true}).click();
      await expect.poll(async()=>(await read()).length).toBe(1);
      const rows=await read();expect(rows).toHaveLength(1);record=rows[0]!.modelRecordId;
    });
    await step("details-confirmed",expectSavedDetails);
    await step("reload-confirmed",async()=>{
      await page.reload();await expect(page.getByLabel("Select current workspace",{exact:true})).toHaveValue(workspace,{timeout:60_000});await openModels();
      const rows=await read();expect(rows).toHaveLength(1);expect(rows[0]!.modelRecordId).toBe(record);await expectSavedDetails();
    });
    await step("isolation-confirmed",async()=>{
      const original=workspace;workspace=await createFunctionalWorkspace(page,"Model isolation fixture");expect(workspace).not.toBe(original);await openModels();expect(await read()).toEqual([]);
      await expect(await inventoryCard()).toHaveCount(0);workspace=original;
    });
    await step("original-workspace-confirmed",async()=>{
      await page.getByLabel("Select current workspace",{exact:true}).selectOption(workspace);await openModels();
      const rows=await read();expect(rows).toHaveLength(1);expect(rows[0]!.modelRecordId).toBe(record);await expectSavedDetails();
    });
  }catch(error){failed=true;failure=error;}
  const report={...modelReferenceHostReport(run,source,host,phases,failed),failureTypes:failed?[safeQualificationFailureType(failure)]:[]};
  try{const body=JSON.stringify(report);if(Buffer.byteLength(body)>8192)throw new Error("Model report exceeded its bound.");await info.attach("model-reference-functional-host",{body,contentType:"application/json"});}
  catch{throw new Error(failed?"Model reference journey and safe evidence attachment failed.":"Model reference safe evidence attachment failed.");}
  if(failed)throw new Error("Model reference functional host journey failed. See its fixed phase report.");
  return report;
}
