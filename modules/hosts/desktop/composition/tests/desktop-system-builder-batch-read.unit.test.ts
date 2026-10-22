import {mkdtemp, rm} from "node:fs/promises";
import {tmpdir} from "node:os";
import path from "node:path";
import {expect, it, vi} from "vitest";
import {createInMemoryStructuredDocumentStore} from "../../../../adapters/persistence/shared";
import {composeDesktopHost} from "../composeDesktopHost";

const fixture=vi.hoisted(()=>({options:undefined as any,load:vi.fn(),readBatch:vi.fn(),readSingle:vi.fn()}));
vi.mock("../../../shared/composition/composeSystemBuilder",()=>({composeSystemBuilder:(options:unknown)=>{
  fixture.options=options;return {useCases:{},modelAuthority:{}};
}}));
vi.mock("../composeDesktopArtifactFeature",()=>({composeDesktopArtifactFeature:()=>({})}));
vi.mock("../composeDesktopAssetFeature",()=>({composeDesktopAssetFeature:async()=>{
  fixture.load();return {assetRegistryRead:{listDefinitionCards:vi.fn(),readDefinitionDetail:fixture.readSingle,readDefinitionDetails:fixture.readBatch}};
}}));

it("preserves the lazy authorized batch through actual desktop System Builder composition",async()=>{
  const root=await mkdtemp(path.join(tmpdir(),"desktop-composer-batch-"));
  const host=composeDesktopHost({persistence:{documents:createInMemoryStructuredDocumentStore()},runtimeDataRootDirectory:root});
  try {
    host.registerDesktopIpc({ipcMain:{handle:vi.fn()},senderTrust:{isTrustedSender:()=>true},storageRootDirectory:root,runtimeRootDirectory:path.join(root,"runtime")});
    expect(fixture.load).not.toHaveBeenCalled();
    const reader=fixture.options.assetRegistryRead;
    expect(typeof reader.readDefinitionDetails).toBe("function");
    const references=Array.from({length:48},(_,index)=>({kind:"asset-definition-version",id:`synthetic.component.${index}`,version:"1.0.0"}));
    const options={workspaceId:"workspace.synthetic",includeMetadata:true};
    const details=references.map((ref,index)=>index===7?undefined:{definition:{definitionId:ref.id,version:ref.version}});
    fixture.readBatch.mockResolvedValueOnce(details);
    expect(await reader.readDefinitionDetails(references,options)).toBe(details);
    expect(fixture.load).toHaveBeenCalledTimes(1);
    expect(fixture.readBatch).toHaveBeenCalledExactlyOnceWith(references,options);
    expect(fixture.readSingle).not.toHaveBeenCalled();
    fixture.readBatch.mockRejectedValueOnce(new Error("Scoped source unavailable"));
    await expect(reader.readDefinitionDetails(references,options)).rejects.toThrow("Scoped source unavailable");
    expect(fixture.readSingle).not.toHaveBeenCalled();
    expect(fixture.load).toHaveBeenCalledTimes(1);
  }finally{
    await host.shutdownBackgroundTasks();
    await rm(root,{recursive:true,force:true});
  }
});
