import {expect,type Page} from "@playwright/test";
import type {FunctionalHost} from "../functional-host-oracles";

export async function createFunctionalWorkspace(page:Page,name:"Model reference fixture"|"Model isolation fixture"){
  const select=page.getByLabel("Select current workspace",{exact:true});
  await expect(select).toBeVisible({timeout:60_000});const previous=await select.inputValue();
  await page.getByRole("button",{name:"Home",exact:true}).click();
  await page.getByRole("button",{name:"Create new workspace",exact:true}).click();
  await page.locator('input[name="workspaceName"]').fill(name);
  await page.getByRole("button",{name:"Create workspace",exact:true}).click();
  await expect(page.locator(".workspace-create-form")).toHaveCount(0);
  await expect(select).toHaveValue(/^workspace\./);await expect(select).not.toHaveValue(previous);
  const id=await select.inputValue();if(!/^workspace\.[A-Za-z0-9._:-]{1,160}$/.test(id))throw new Error("The new functional workspace is invalid.");
  return id;
}

/** Supplementary real read-only IPC/API oracle. No bridge, sender or result replacement. */
export async function readFunctionalModelInventory(page:Page,host:FunctionalHost,workspaceId:string){
  return page.evaluate(readFunctionalModelInventoryInBrowser,{host,workspaceId});
}
/** Self-contained browser callback, also exercised with finite response fixtures. */
export async function readFunctionalModelInventoryInBrowser({host,workspaceId}:{host:FunctionalHost;workspaceId:string}){
    const input={workspaceId,limit:20,includeDiscovered:false,includeSharedStorage:false};
    let envelope:unknown;
    if(host==="packaged-desktop"){
      const api=(window as unknown as {desktopApi?:{listModels?(input:unknown):Promise<unknown>}}).desktopApi;
      if(!api?.listModels)throw new Error("The model inventory bridge is unavailable.");
      envelope=await api.listModels(input);
    }else{
      const token=localStorage.getItem("ai-system-builder.paired-device-token");
      if(!token||token.length>512)throw new Error("The isolated test credential is unavailable.");
      const response=await fetch("/api/model/list",{method:"POST",headers:{"content-type":"application/json",authorization:`Bearer ${token}`},body:JSON.stringify(input),signal:AbortSignal.timeout(15_000)});
      if(!response.ok||!response.headers.get("content-type")?.includes("application/json"))throw new Error("The model inventory read was refused.");
      const reader=response.body?.getReader();if(!reader)throw new Error("The model inventory read failed.");
      const chunks:Uint8Array[]=[];let bytes=0;
      try{
        for(;;){
          const next=await reader.read();if(next.done)break;
          if(!(next.value instanceof Uint8Array)||next.value.byteLength===0||chunks.length>=4096||next.value.byteLength>262144-bytes)throw new Error("The model inventory exceeded its bound.");
          bytes+=next.value.byteLength;chunks.push(next.value);
        }
      }catch{await reader.cancel().catch(()=>{});throw new Error("The model inventory body was unavailable or exceeded its byte bound.");}
      finally{reader.releaseLock();}
      const body=new Uint8Array(bytes);let offset=0;for(const chunk of chunks){body.set(chunk,offset);offset+=chunk.byteLength;}
      try{envelope=JSON.parse(new TextDecoder("utf-8",{fatal:true}).decode(body));}catch{throw new Error("The model inventory JSON was invalid.");}
    }
    if(!envelope||typeof envelope!=="object"||!("ok" in envelope)||envelope.ok!==true||!("value" in envelope)||!envelope.value||typeof envelope.value!=="object")throw new Error("The model inventory read failed.");
    const result=envelope.value as {models?:unknown;nextCursor?:unknown};
    if(!Array.isArray(result.models)||result.models.length>20||result.nextCursor!==undefined)throw new Error("The model inventory is incomplete.");
    return result.models.map(value=>{
      if(!value||typeof value!=="object")throw new Error("The model inventory is malformed.");
      const m=value as Record<string,unknown>;
      for(const key of ["modelRecordId","modelId","workspaceId","provider","source","lifecycleStatus","artifactForm"]){if(typeof m[key]!=="string"||(m[key] as string).length>192)throw new Error("The model inventory projection is invalid.");}
      // Never send paths, provider descriptions or private payloads out of the browser.
      return {modelRecordId:m.modelRecordId,modelId:m.modelId,workspaceId:m.workspaceId,provider:m.provider,source:m.source,lifecycleStatus:m.lifecycleStatus,artifactForm:m.artifactForm,
        localFilesAvailable:typeof m.localFilesAvailable==="boolean"?m.localFilesAvailable:typeof m.localPath==="string"&&m.localPath.trim().length>0};
    });
}
