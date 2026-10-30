import {expect,type Page,type TestInfo,type Locator} from "@playwright/test";
import {settingsHostIdentity,settingsHostNamespace,settingsHostPhases,settingsHostReport,isSettingsPanelReadBody,SETTINGS_PASSIVE_MODEL,type SettingsHost,type SettingsHostCase} from "../settings-host-oracles";
import {safeQualificationFailureType} from "../qualification-reporting";

/** Real mounted Settings and production IPC/HTTP. No successful response is injected. */
export async function qualifySettingsHostJourney(page:Page,info:TestInfo,host:SettingsHost,scenario:SettingsHostCase){
  const run=process.env.VISUAL_COMPOSER_QUALIFICATION_RUN_ID,source=process.env.VISUAL_COMPOSER_QUALIFICATION_SOURCE_REVISION;
  settingsHostIdentity(run,source,host,scenario);
  if(info.project.name!==host)throw new Error("Settings host does not match its fixed project.");
  const expected=settingsHostPhases(host,scenario),phases:string[]=[];
  async function step(phase:string,action:()=>Promise<void>){if(expected[phases.length]!==phase)throw new Error("Unexpected Settings phase.");await action();phases.push(phase);}
  const field=(label:string)=>host==="thin-chrome"?page.getByRole("region",{name:label,exact:true})
    :page.locator("section.settings-panel__field").filter({has:page.getByRole("heading",{name:label,exact:true,level:4})});
  async function open(){
    await page.getByRole("button",{name:"Settings",exact:true}).click();
    await expect(page.getByRole("heading",{name:"Settings",exact:true,level:1})).toBeVisible();
  }
  let workspace:Locator|undefined,workspaceId:string|undefined;
  async function reload(){
    await page.reload();
    await expect(workspace!).toBeVisible({timeout:60_000});await expect(workspace!).toHaveValue(workspaceId!);
    // Desktop restores its shell before a page is selected. Explicit navigation
    // also works for Thin Client's retained /settings route.
    await open();
  }
  const namespace=()=>field("Default Hugging Face namespace"),secret=()=>field("Hugging Face access token"),model=()=>field("Global default model");
  async function expectSecret(configured:boolean){
    await expect(secret().locator("input[type=password]")).toHaveValue("");
    await expect(secret().locator(".settings-secret__state")).toHaveText(configured?/^Hugging Face access token: \*{4,32}$/:"Hugging Face access token: Not configured");
    if(configured)await expect(secret().getByRole("button",{name:"Clear",exact:true})).toBeEnabled();
    else await expect(secret().getByRole("button",{name:"Clear",exact:true})).toBeDisabled();
  }
  async function expectModel(value:typeof SETTINGS_PASSIVE_MODEL|{provider:string;modelId:string;inferenceMode:string;device:string;torchDtype:string}){
    for(const [label,v] of [["Provider",value.provider],["Model ID",value.modelId],["Inference mode",value.inferenceMode],["Device",value.device],["Torch dtype",value.torchDtype]])
      await expect(model().getByLabel(label!,{exact:true})).toHaveValue(v!);
  }
  const save=(area:Locator)=>area.getByRole("button",{name:"Save",exact:true}),clear=(area:Locator)=>area.getByRole("button",{name:"Clear",exact:true});
  const saveModel=()=>model().getByRole("button",{name:"Save model default",exact:true});
  let failure:unknown,failed=false;
  try{
    await step("settings-opened",async()=>{
      workspace=page.getByLabel("Select current workspace",{exact:true});
      workspaceId=await workspace.inputValue();
      if(typeof workspaceId!=="string"||!/^workspace\.[A-Za-z0-9._:-]+$/.test(workspaceId))throw new Error("Settings requires its selected test workspace.");
      await open();
    });
    if(scenario==="public-values"){
      const value=settingsHostNamespace(run,source,host),input=()=>namespace().getByLabel("Default Hugging Face namespace",{exact:true});
      await step("fresh-value-confirmed",async()=>{await expect(input()).toBeEnabled();await expect(input()).toHaveValue("");await expect(clear(namespace())).toBeDisabled();});
      await input().fill(value);
      if(host==="thin-chrome"){
        const readUrl=new URL("/api/application-settings/read",page.url()).href;
        let denied=0;
        const fault:Parameters<Page["route"]>[1]=async route=>{
          if(route.request().method()!=="POST"||!isSettingsPanelReadBody(route.request().postData())||denied!==0)return route.continue();
          denied++;await route.fulfill({status:503,contentType:"application/json",body:JSON.stringify({ok:false,error:{code:"unavailable",message:"synthetic-settings-private-detail"}})});
        };
        await page.route(readUrl,fault);
        try{
          await save(namespace()).click();
          await step("failed-read-denies-write",async()=>{
            await expect(page.getByText("Refresh settings before making another change.",{exact:true})).toBeVisible();
            expect(denied).toBe(1);await expect(save(namespace())).toBeDisabled();await expect(clear(namespace())).toBeDisabled();
            await expect(page.locator("body")).not.toContainText("synthetic-settings-private-detail");
          });
        }finally{await page.unroute(readUrl,fault);}
        await step("explicit-refresh-recovers",async()=>{
          const response=page.waitForResponse(r=>r.url()===readUrl&&r.request().method()==="POST"&&isSettingsPanelReadBody(r.request().postData()));
          await page.getByRole("button",{name:"Refresh settings",exact:true}).click();
          expect((await response).ok()).toBe(true);await expect(input()).toBeEnabled();await expect(input()).toHaveValue(value);
        });
      }else await save(namespace()).click();
      await step("public-save-confirmed",async()=>{await expect(save(namespace())).toBeEnabled();await expect(clear(namespace())).toBeEnabled();await expect(input()).toHaveValue(value);});
      await step("public-reload-confirmed",async()=>{await reload();await expect(input()).toBeEnabled();await expect(input()).toHaveValue(value);await expect(clear(namespace())).toBeEnabled();});
      await step("public-clear-confirmed",async()=>{await clear(namespace()).click();await expect(input()).toBeEnabled();await expect(input()).toHaveValue("");await expect(clear(namespace())).toBeDisabled();});
      await step("clear-reload-confirmed",async()=>{await reload();await expect(input()).toBeEnabled();await expect(input()).toHaveValue("");await expect(clear(namespace())).toBeDisabled();});
    }else{
      // Public synthetic fixture only; never use or inspect the saved user token.
      const synthetic="qualification-only-not-a-provider-token";
      const builtin={provider:"transformers",modelId:"google/flan-t5-base",inferenceMode:"auto",device:"auto",torchDtype:"auto"};
      await step("fresh-values-confirmed",async()=>{await expect(secret().locator("input[type=password]")).toBeEnabled();await expectSecret(false);await expectModel(builtin);await expect(clear(model())).toBeDisabled();});
      await step("secret-save-confirmed",async()=>{await secret().locator("input[type=password]").fill(synthetic);await secret().getByRole("button",{name:"Save secret",exact:true}).click();await expectSecret(true);await expect(secret()).not.toContainText(synthetic);});
      await step("secret-reload-masked",async()=>{await reload();await expect(secret().locator("input[type=password]")).toBeEnabled();await expectSecret(true);await expect(secret()).not.toContainText(synthetic);});
      await step("model-default-save-confirmed",async()=>{
        await model().getByLabel("Model ID",{exact:true}).fill(SETTINGS_PASSIVE_MODEL.modelId);
        await model().getByLabel("Inference mode",{exact:true}).selectOption(SETTINGS_PASSIVE_MODEL.inferenceMode);
        await model().getByLabel("Device",{exact:true}).selectOption(SETTINGS_PASSIVE_MODEL.device);
        await model().getByLabel("Torch dtype",{exact:true}).selectOption(SETTINGS_PASSIVE_MODEL.torchDtype);
        await saveModel().click();await expect(saveModel()).toBeEnabled();await expect(clear(model())).toBeEnabled();await expectModel(SETTINGS_PASSIVE_MODEL);
      });
      await step("model-default-reload-confirmed",async()=>{await reload();await expect(clear(model())).toBeEnabled();await expectModel(SETTINGS_PASSIVE_MODEL);await expectSecret(true);});
      await step("secret-clear-confirmed",async()=>{await clear(secret()).click();await expect(secret().locator("input[type=password]")).toBeEnabled();await expectSecret(false);});
      await step("model-default-clear-confirmed",async()=>{await clear(model()).click();await expect(saveModel()).toBeEnabled();await expect(clear(model())).toBeDisabled();await expectModel(builtin);});
      await step("clear-reload-confirmed",async()=>{await reload();await expect(saveModel()).toBeEnabled();await expect(clear(model())).toBeDisabled();await expectModel(builtin);await expectSecret(false);});
    }
  }catch(error){failed=true;failure=error;}
  const report={...settingsHostReport(run,source,host,scenario,phases,failed),failureTypes:failed?[safeQualificationFailureType(failure)]:[]};
  try{
    const body=JSON.stringify(report);if(Buffer.byteLength(body)>8192)throw new Error("Settings report exceeded its bound.");
    await info.attach("settings-functional-host-journey",{body,contentType:"application/json"});
  }catch{throw new Error(failed?"Settings journey and safe evidence attachment failed.":"Settings safe evidence attachment failed.");}
  if(failed)throw new Error("Settings functional host journey failed. See its fixed phase report.");
  return report;
}
