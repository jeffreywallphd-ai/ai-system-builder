import { act, startTransition, Suspense } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useImageGenerationFeature as useDesktopImages } from "../hooks/useImageGenerationFeature";
import { useImageGenerationFeature as useBrowserImages, resetImageGenerationPersistedStateForTests } from "../../../../../../thin-client/src/features/image-generation/hooks/useImageGenerationFeature";
import { TaskObservationProvider, useTaskObservationManager } from "../../../../../../../modules/ui/shared/notifications/TaskObservationProvider";
import type { TaskObservationManager } from "../../../../../../../modules/ui/shared/notifications/taskObservation";

vi.mock("../../models/api/desktopModelsClient", () => ({ createDesktopModelsClient: () => ({ listModels: async () => [] }) }));
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const roots = new Set<Root>();
const pending = <T,>() => { let resolve!: (value: T) => void; let reject!: (reason: Error) => void; const promise = new Promise<T>((yes,no) => { resolve=yes; reject=no; }); return { promise,resolve,reject }; };
async function flush() { await act(async () => { for(let i=0;i<16;i++) await Promise.resolve(); }); }
afterEach(async () => { await act(async () => { for (const root of roots) root.unmount(); }); roots.clear(); sessionStorage.clear(); resetImageGenerationPersistedStateForTests(); vi.restoreAllMocks(); });

for (const host of ["desktop", "browser"] as const) describe(`${host} image request ownership`, () => {
  const envelope = <T,>(value:T) => host === "desktop" ? {ok:true,value} : value;
  function client() {
    return { startImageGeneration: vi.fn(async (_input:unknown) => envelope({requestId:"owned-image"})),
      readImageGeneration: vi.fn(async ({requestId}:{requestId:string}) => envelope({requestId,status:"cancelled",taskType:"image-generation",concurrencyClass:"image-generation"})),
      finalizeImageGenerationIfCompleted: vi.fn(async () => envelope({finalized:true,assets:[{assetId:"image-asset",artifactId:"image-artifact",storageKey:"generated/images/synthetic.png",mediaType:"image/png"}]})),
      cancelImageGeneration: vi.fn(async () => envelope({cancelled:false})),
      createArtifactMediaViewUrl: () => "/api/artifact/media/view?storageKey=synthetic", unloadModel:vi.fn(async()=>({unloaded:true})),
      readComfyUiInstallStatus:vi.fn(async()=>({ok:true,value:{status:"installed"}})), repairComfyUiInstall:vi.fn(async()=>({ok:true,value:{status:"installed"}})) };
  }
  const models={listModels:vi.fn(async()=>({models:[]}))};
  const artifacts={browseArtifacts:vi.fn(async()=>[]),createArtifactMediaViewUrl:vi.fn(async()=>"blob:owned-image")};
  beforeEach(()=>{models.listModels.mockReset().mockResolvedValue({models:[]});artifacts.browseArtifacts.mockReset().mockResolvedValue([]);});
  type Feature = ReturnType<typeof useDesktopImages> | ReturnType<typeof useBrowserImages>;
  let feature:Feature;
  type ProbeProps = {value:ReturnType<typeof client>;workspace:string;callback?: (assets: {assetId:string}[]) => void;suspend?: Promise<void>};
  let manager:TaskObservationManager;
  function Capture() { manager=useTaskObservationManager(); return null; }
  function Shell(props:ProbeProps) { return <TaskObservationProvider><Capture/><Suspense fallback={<span>Replacement pending</span>}><Probe {...props}/></Suspense></TaskObservationProvider>; }
  function DesktopProbe({value,workspace}:{value:ReturnType<typeof client>;workspace:string}) { feature=useDesktopImages(value as never,undefined,artifacts as never,workspace); return <Controls/>; }
  function BrowserProbe({value,workspace,callback,suspend}:ProbeProps) { feature=useBrowserImages(value as never,callback,models as never,artifacts as never,workspace); if(suspend) throw suspend; return <Controls/>; }
  function Controls() { return <><button onClick={()=>void feature.start()}>Generate</button><button onClick={()=>void feature.cancel()}>Cancel</button><span>{feature.status}</span></>; }
  const Probe=host==="desktop"?DesktopProbe:BrowserProbe;
  async function mount(value:ReturnType<typeof client>,callback?: ProbeProps["callback"]) { const container=document.createElement("div"); const root=createRoot(container);roots.add(root);await act(async()=>root.render(<Shell value={value} workspace="image-workspace" callback={callback}/>));await act(async()=>feature.setForm(form=>({...form,prompt:"A synthetic reference scene",seed:"0"}))); return {root,container}; }
  const assets = () => "results" in feature ? feature.results : feature.finalizedAssets;

  it("admits one Start before a render or host acceptance",async()=>{
    const value=client();const start=pending<ReturnType<typeof envelope<{requestId:string}>>>();value.startImageGeneration.mockReturnValue(start.promise);
    const {container}=await mount(value);await act(async()=>{container.querySelector<HTMLButtonElement>("button")!.click();container.querySelector<HTMLButtonElement>("button")!.click();});
    expect(value.startImageGeneration).toHaveBeenCalledTimes(1);start.resolve(envelope({requestId:"owned-image"}));await flush();
  });

  it("does not overwrite a replacement client's recovery identity",async()=>{
    const old=client();const late=pending<ReturnType<typeof envelope<{requestId:string}>>>();old.startImageGeneration.mockReturnValue(late.promise);
    const {root}=await mount(old);await act(async()=>{void feature.start();});
    const current=client();current.startImageGeneration.mockResolvedValue(envelope({requestId:"current-image"}));
    await act(async()=>root.render(<Shell value={current} workspace="image-workspace"/>));
    if (host === "desktop") {
      expect(feature.form.prompt).toBe("");
      await act(async()=>feature.setForm(form=>({...form,prompt:"A synthetic current-client scene",seed:"0"})));
    }
    await act(async()=>{void feature.start();});await flush();
    if (host === "desktop") {
      expect(current.startImageGeneration).toHaveBeenCalledTimes(1);
      expect(current.startImageGeneration.mock.calls[0]?.[0]).toMatchObject({workspaceId:"image-workspace",prompt:"A synthetic current-client scene",seed:0});
    }
    late.resolve(envelope({requestId:"retired-image"}));await flush();
    const key=host==="desktop"?"ai-system-builder.image-task.v1:image-workspace":"ai-system-builder.thin-image-task.v1:image-workspace";
    expect(sessionStorage.getItem(key)).toBe("current-image");expect(feature.requestId).toBe("current-image");expect(old.readImageGeneration).not.toHaveBeenCalled();
  });

  it("does not finalize or release a task after a foreign terminal reply",async()=>{
    const value=client();value.readImageGeneration.mockResolvedValue(envelope({requestId:"foreign-image",status:"succeeded",taskType:"image-generation",concurrencyClass:"image-generation"}));
    await mount(value);await act(async()=>{void feature.start();});await flush();
    expect(value.finalizeImageGenerationIfCompleted).not.toHaveBeenCalled();expect(feature.requestId).toBe("owned-image");
    expect(["queued","running","unknown"]).toContain(feature.status);expect(assets()).toEqual([]);
    await act(async()=>{void feature.start();});expect(value.startImageGeneration).toHaveBeenCalledTimes(1);
  });

  it("retains unknown task ownership and refuses a second start",async()=>{
    const value=client();value.readImageGeneration.mockResolvedValue(envelope({requestId:"owned-image",status:"unknown",taskType:"image-generation",concurrencyClass:"image-generation"}));
    await mount(value);await act(async()=>{void feature.start();});await flush();await act(async()=>{void feature.start();});
    expect(value.startImageGeneration).toHaveBeenCalledTimes(1);await act(async()=>{await feature.cancel();});expect(value.cancelImageGeneration).toHaveBeenCalledTimes(1);expect(feature.requestId).toBe("owned-image");
  });

  it("retains retry after incomplete registered image output",async()=>{
    const value=client();value.readImageGeneration.mockResolvedValue(envelope({requestId:"owned-image",status:"succeeded",taskType:"image-generation",concurrencyClass:"image-generation"}));
    value.finalizeImageGenerationIfCompleted.mockResolvedValue(envelope({finalized:true,assets:[{assetId:"",artifactId:"",storageKey:"",mediaType:"image/png"}]}));
    await mount(value);await act(async()=>{void feature.start();});await flush();expect(feature.status).toBe("failed");expect(feature.canRetryFinalization).toBe(true);expect(assets()).toEqual([]);
  });

  it("catches an unexpected start rejection with fixed public text",async()=>{
    const value=client();value.startImageGeneration.mockRejectedValue(new Error("synthetic-private-provider-detail"));await mount(value);
    let rejected=false;await act(async()=>{try { await feature.start(); }catch { rejected=true; }});expect(rejected).toBe(false);expect(feature.status).toBe("failed");expect(feature.error).toBeTruthy();expect(feature.error).not.toContain("synthetic-private-provider-detail");
  });

  it.each(["accepted","rejected"] as const)("keeps a finalized result when an older cancellation is %s",async(outcome)=>{
    const value=client();value.readImageGeneration.mockResolvedValue(envelope({requestId:"owned-image",status:"running",taskType:"image-generation",concurrencyClass:"image-generation"}));
    const cancel=pending<ReturnType<typeof envelope<{cancelled:boolean}>>>();value.cancelImageGeneration.mockReturnValue(cancel.promise);
    await mount(value);await act(async()=>{void feature.start();});await flush();
    await act(async()=>{void feature.cancel();void feature.cancel();});expect(value.cancelImageGeneration).toHaveBeenCalledTimes(1);
    value.readImageGeneration.mockResolvedValue(envelope({requestId:"owned-image",status:"succeeded",taskType:"image-generation",concurrencyClass:"image-generation"}));
    await act(async()=>manager.invalidate({workspaceId:"image-workspace",family:"image-generation",requestId:"owned-image"}));await flush();
    expect(assets()[0]?.assetId).toBe("image-asset");const terminal=feature.status;
    if(outcome==="accepted")cancel.resolve(envelope({cancelled:true}));else cancel.reject(new Error("synthetic-private-cancel-detail"));await flush();
    expect(feature.status).toBe(terminal);expect(assets()[0]?.artifactId).toBe("image-artifact");expect(feature.error).toBeUndefined();
  });

  it("admits only one pending finalization retry for the accepted request",async()=>{
    const value=client();value.readImageGeneration.mockResolvedValue(envelope({requestId:"owned-image",status:"succeeded",taskType:"image-generation",concurrencyClass:"image-generation"}));
    const finish=pending<ReturnType<typeof envelope<{finalized:boolean;assets:{assetId:string;artifactId:string;storageKey:string;mediaType:string}[]}>>>();
    value.finalizeImageGenerationIfCompleted.mockRejectedValueOnce(new Error("synthetic-transient")).mockReturnValue(finish.promise);
    await mount(value);await act(async()=>{void feature.start();});await flush();expect(feature.canRetryFinalization).toBe(true);
    await act(async()=>{feature.retryFinalization();feature.retryFinalization();});await flush();expect(value.finalizeImageGenerationIfCompleted).toHaveBeenCalledTimes(2);
    finish.resolve(envelope({finalized:true,assets:[{assetId:"retry-asset",artifactId:"retry-artifact",storageKey:"generated/retry.png",mediaType:"image/png"}]}));await flush();expect(assets()[0]?.artifactId).toBe("retry-artifact");expect(value.startImageGeneration).toHaveBeenCalledTimes(1);
  });

  it("clears workspace-specific form values without relying on a keyed remount",async()=>{
    const value=client();const {root}=await mount(value);
    await act(async()=>feature.setForm(form=>({...form,prompt:"Synthetic workspace A draft",model:"workspace-A-model",latentSourceArtifactId:"workspace-A-image"})));
    await act(async()=>root.render(<Shell value={value} workspace="workspace-B"/>));
    expect(feature.form.prompt).not.toContain("workspace A draft");expect(feature.form.model).toBe("");expect(feature.form.latentSourceArtifactId).toBe("");expect(assets()).toEqual([]);expect(value.startImageGeneration).not.toHaveBeenCalled();
  });

  if (host === "browser") {
    it.each(["models","artifacts"] as const)("ignores a retired %s Refresh before it can affect the new load",async(kind)=>{
      const first=client();const {root}=await mount(first);
      if (!("refreshModelInventory" in feature)) throw new Error("Expected browser image controls.");
      const retired=kind==="models"?feature.refreshModelInventory:feature.refreshImageArtifacts;
      const modelList=pending<{models:never[]}>();const artifactList=pending<never[]>();
      if(kind==="models")models.listModels.mockReturnValueOnce(modelList.promise);else artifacts.browseArtifacts.mockReturnValueOnce(artifactList.promise);
      await act(async()=>root.render(<Shell value={client()} workspace="image-workspace"/>));
      const calls=kind==="models"?models.listModels.mock.calls.length:artifacts.browseArtifacts.mock.calls.length;
      await act(async()=>{await retired();});if(kind==="models")modelList.resolve({models:[]});else artifactList.resolve([]);await flush();
      expect(kind==="models"?models.listModels.mock.calls.length:artifacts.browseArtifacts.mock.calls.length).toBe(calls);
      if (!("modelInventoryLoading" in feature)) throw new Error("Expected browser image controls.");
      expect(kind==="models"?feature.modelInventoryLoading:feature.imageArtifactsLoading).toBe(false);
    });
    it("uses the committed callback while a replacement render remains suspended",async()=>{
      const value=client();const read=pending<ReturnType<typeof envelope<{requestId:string;status:string;taskType:string;concurrencyClass:string}>>>();
      value.readImageGeneration.mockReturnValue(read.promise);const accepted=vi.fn();const replacement=vi.fn();const suspend=pending<void>();
      const {root,container}=await mount(value,accepted);await act(async()=>{void feature.start();});await flush();
      await act(async()=>startTransition(()=>root.render(<Shell value={value} workspace="image-workspace" callback={replacement} suspend={suspend.promise}/>)));
      expect(container.textContent).not.toContain("Replacement pending");
      read.resolve(envelope({requestId:"owned-image",status:"succeeded",taskType:"image-generation",concurrencyClass:"image-generation"}));await flush();
      expect(accepted).toHaveBeenCalledTimes(1);expect(replacement).not.toHaveBeenCalled();
    });
    it("keeps confirmed output when a consumer refresh callback throws",async()=>{
      const value=client();value.readImageGeneration.mockResolvedValue(envelope({requestId:"owned-image",status:"succeeded",taskType:"image-generation",concurrencyClass:"image-generation"}));
      const refresh=vi.fn(()=>{throw new Error("synthetic-consumer-refresh-failure");});await mount(value,refresh);await act(async()=>{void feature.start();});await flush();
      expect(feature.status).toBe("finalized");expect(assets()[0]?.artifactId).toBe("image-artifact");expect(feature.error).toBeUndefined();expect(refresh).toHaveBeenCalledTimes(1);
    });
    it("does not report success for an unconfirmed model unload",async()=>{
      const value=client();value.unloadModel.mockResolvedValue({unloaded:false});await mount(value);
      if (!("unloadModel" in feature)) throw new Error("Expected browser image controls.");
      await act(async()=>{if("unloadModel" in feature) await feature.unloadModel();});
      if (!("unloadModelState" in feature)) throw new Error("Expected browser image controls.");
      expect(feature.unloadModelState.status).toBe("error");
    });
  } else {
    it("releases retired session previews when the client changes",async()=>{
      const old=Object.getOwnPropertyDescriptor(URL,"revokeObjectURL");const revoke=vi.fn();Object.defineProperty(URL,"revokeObjectURL",{configurable:true,value:revoke});
      try {
        const value=client();value.readImageGeneration.mockResolvedValue(envelope({requestId:"owned-image",status:"succeeded",taskType:"image-generation",concurrencyClass:"image-generation"}));
        const {root}=await mount(value);await act(async()=>{void feature.start();});await flush();expect(assets()[0]?.assetId).toBe("image-asset");
        await act(async()=>root.render(<Shell value={client()} workspace="image-workspace"/>));expect(revoke).toHaveBeenCalledWith("blob:owned-image");
      } finally { if(old)Object.defineProperty(URL,"revokeObjectURL",old);else Reflect.deleteProperty(URL,"revokeObjectURL"); }
    });
  }

  it.each([{width:"63"},{width:"1024.5"},{steps:"201"},{numImages:"9"},{cfg:"51"},{seed:"9007199254740992"},{faceIdEnabled:true,faceIdArtifactId1:""},{faceIdEnabled:true,faceIdArtifactId1:"face-artifact",faceIdNoise:"NaN"}])("refuses invalid settings before host dispatch: %j",async(settings)=>{
    const value=client();await mount(value);await act(async()=>feature.setForm(form=>({...form,...settings})));await act(async()=>{void feature.start();});expect(value.startImageGeneration).not.toHaveBeenCalled();
  });

  it("keeps seed zero, latent source, three FaceID references and explicit parameters",async()=>{
    const value=client();await mount(value);await act(async()=>feature.setForm(form=>({...form,width:"768",height:"512",steps:"24",numImages:"2",cfg:"6.5",denoise:"0.6",sampler:"euler",scheduler:"normal",model:"synthetic-checkpoint",latentSourceArtifactId:"latent-artifact",faceIdEnabled:true,faceIdArtifactId1:"face-1",faceIdArtifactId2:"face-2",faceIdArtifactId3:"face-3",faceIdIdentityStrength:"0.8",faceIdStructureStrength:"0.4",faceIdNoise:"0"})));await act(async()=>{void feature.start();});await flush();
    expect(value.startImageGeneration.mock.calls[0]?.[0]).toEqual(expect.objectContaining({workspaceId:"image-workspace",seed:0,width:768,height:512,steps:24,numImages:2,cfg:6.5,denoise:0.6,model:"synthetic-checkpoint",latentSource:{kind:"artifact",artifactId:"latent-artifact"},faceId:{enabled:true,references:[{artifactId:"face-1"},{artifactId:"face-2"},{artifactId:"face-3"}],identityStrength:0.8,structureStrength:0.4,noise:0}}));
  });
});
