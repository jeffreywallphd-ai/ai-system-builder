import React, { act } from "react";
import { createRoot as createReactRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  isServerInventoryImageGenerationModel,
  resetImageGenerationPersistedStateForTests,
  useImageGenerationFeature,
} from "../hooks/useImageGenerationFeature";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

const mountedRoots = new Set<Root>();
function createRoot(container: Element | DocumentFragment): Root {
  const root = createReactRoot(container);
  mountedRoots.add(root);
  return root;
}

function model(modelRecordId: string, lifecycleStatus: string, inferenceMode = "text-to-image", artifactForm = "checkpoint") {
  return { modelRecordId, displayName: modelRecordId, modelId: `id/${modelRecordId}`, provider: "hf", source: "huggingface", artifactForm, lifecycleStatus, inferenceMode, taskTags: inferenceMode === "text-to-image" ? ["text-to-image"] : ["chat"] };
}

function flush() { return new Promise((resolve) => setTimeout(resolve, 0)); }

function Harness({ client, modelClient }: { client: any; modelClient: any }) {
  const f = useImageGenerationFeature(client, undefined, modelClient, undefined, "workspace-a");
  return <div><button id="start" onClick={() => void f.start()}>start</button><button id="selectB" onClick={() => f.setSelectedModelRecordId("b")}>b</button><button id="refresh" onClick={() => void f.refreshModelInventory()}>r</button><input id="prompt" value={f.form.prompt} onInput={(e)=>f.setForm((x)=>({...x,prompt:(e.target as HTMLInputElement).value}))}/><span id="validation">{f.validationError ?? ""}</span><span id="downloaded">{f.downloadedImageGenerationModels.map((m)=>m.modelRecordId).join(",")}</span><span id="selected">{f.selectedModelRecordId}</span><span id="result">{f.results[0]?.storageKey ?? ""}</span></div>;
}

describe("useImageGenerationFeature", () => {
  afterEach(async () => {
    await act(async () => {
      for (const root of mountedRoots) root.unmount();
    });
    mountedRoots.clear();
    resetImageGenerationPersistedStateForTests();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("sends latest selected model record id and selection does not reload inventory", async () => {
    const client = { createArtifactMediaViewUrl: vi.fn(), startImageGeneration: vi.fn().mockResolvedValue({ requestId: "r1" }), readImageGeneration: vi.fn().mockResolvedValue({ requestId: "r1", status: "failed" }), finalizeImageGenerationIfCompleted: vi.fn(), cancelImageGeneration: vi.fn() };
    const modelClient = { listModels: vi.fn().mockResolvedValue({ models: [model("a", "downloaded"), model("b", "downloaded")] }) };
    const c = document.createElement("div"); const root = createRoot(c);
    await act(async () => { root.render(<Harness client={client} modelClient={modelClient} />); });
    expect(modelClient.listModels).toHaveBeenCalledTimes(1);
    await act(async () => { (c.querySelector("#selectB") as HTMLButtonElement).click(); });
    expect(modelClient.listModels).toHaveBeenCalledTimes(1);
    await act(async () => { (c.querySelector("#prompt") as HTMLInputElement).value = "cat"; (c.querySelector("#prompt") as HTMLInputElement).dispatchEvent(new Event("input", { bubbles: true })); (c.querySelector("#start") as HTMLButtonElement).click(); });
    expect(client.startImageGeneration).toHaveBeenCalledWith(expect.objectContaining({ model: "b", engineHints: { runtimeDeviceMode: "auto" } }));
  });

  it("manual model fallback applies only when no selected record", async () => {
    const client = { createArtifactMediaViewUrl: vi.fn(), startImageGeneration: vi.fn().mockResolvedValue({ requestId: "r1" }), readImageGeneration: vi.fn().mockResolvedValue({ requestId: "r1", status: "failed" }), finalizeImageGenerationIfCompleted: vi.fn(), cancelImageGeneration: vi.fn() };
    const modelClient = { listModels: vi.fn().mockResolvedValue({ models: [] }) };
    function H() { const f = useImageGenerationFeature(client, undefined, modelClient, undefined, "workspace-a"); return <div><button id="start" onClick={()=>void f.start()}>s</button><button id="manual" onClick={()=>f.setForm((x)=>({...x,prompt:"cat",model:"manual.ckpt"}))}>m</button></div>; }
    const c = document.createElement("div"); const root = createRoot(c);
    await act(async()=>{root.render(<H/>);});
    await act(async()=>{(c.querySelector("#manual") as HTMLButtonElement).click();});
    await act(async()=>{(c.querySelector("#start") as HTMLButtonElement).click();});
    expect(client.startImageGeneration).toHaveBeenCalledWith(expect.objectContaining({ model: "manual.ckpt" }));
  });

  it("auto-selects downloaded image model records across server inventory model forms", async () => {
    const client = { createArtifactMediaViewUrl: vi.fn(), startImageGeneration: vi.fn(), readImageGeneration: vi.fn(), finalizeImageGenerationIfCompleted: vi.fn(), cancelImageGeneration: vi.fn() };
    const modelClient1 = { listModels: vi.fn().mockResolvedValue({ models: [model("txt", "downloaded", "chat"), model("full", "downloaded", "text-to-image", "full-model"), model("img", "downloaded", "text-to-image")] }) };
    const c = document.createElement("div"); const root = createRoot(c);
    await act(async()=>{root.render(<Harness client={client} modelClient={modelClient1} />);});
    expect((c.querySelector("#downloaded") as HTMLElement).textContent).toBe("img,full");
    expect((c.querySelector("#selected") as HTMLElement).textContent).toBe("img");

    const modelClient2 = { listModels: vi.fn().mockResolvedValue({ models: [model("txt", "downloaded", "chat"), model("ref", "saved-reference", "text-to-image")] }) };
    await act(async()=>{root.render(<Harness client={client} modelClient={modelClient2} />);});
    expect((c.querySelector("#selected") as HTMLElement).textContent).toBe("");
    expect((c.querySelector("#downloaded") as HTMLElement).textContent).toBe("");
  });



  it("treats validated checkpoint image models as generation-ready inventory", async () => {
    const client = { createArtifactMediaViewUrl: vi.fn(), startImageGeneration: vi.fn(), readImageGeneration: vi.fn(), finalizeImageGenerationIfCompleted: vi.fn(), cancelImageGeneration: vi.fn() };
    const modelClient = { listModels: vi.fn().mockResolvedValue({ models: [model("validated", "validated", "text-to-image")] }) };
    const c = document.createElement("div"); const root = createRoot(c);
    await act(async()=>{root.render(<Harness client={client} modelClient={modelClient} />);});
    expect((c.querySelector("#downloaded") as HTMLElement).textContent).toBe("validated");
    expect((c.querySelector("#selected") as HTMLElement).textContent).toBe("validated");
  });

  it("classifies image models across supported server inventory artifact forms", () => {
    expect(isServerInventoryImageGenerationModel(model("openelm", "downloaded", "chat", "full-model") as any)).toBe(false);
    expect(isServerInventoryImageGenerationModel(model("sdxl", "downloaded", "text-to-image", "checkpoint") as any)).toBe(true);
    expect(isServerInventoryImageGenerationModel(model("sdxl-full", "downloaded", "text-to-image", "full-model") as any)).toBe(true);
    expect(isServerInventoryImageGenerationModel({ ...model("stable-diffusion-xl-base-1.0", "downloaded", undefined as any, "full-model"), inferenceMode: undefined, taskTags: undefined } as any)).toBe(true);
  });

  it("does not submit a selected reference-only checkpoint image model", async () => {
    const client = { createArtifactMediaViewUrl: vi.fn(), startImageGeneration: vi.fn(), readImageGeneration: vi.fn(), finalizeImageGenerationIfCompleted: vi.fn(), cancelImageGeneration: vi.fn() };
    const modelClient = { listModels: vi.fn().mockResolvedValue({ models: [model("ref", "saved-reference", "text-to-image")] }) };
    function H() {
      const f = useImageGenerationFeature(client, undefined, modelClient, undefined, "workspace-a");
      return <div><button id="select" onClick={() => f.setSelectedModelRecordId("ref")}>select</button><button id="prompt" onClick={() => f.setForm((x) => ({ ...x, prompt: "cat" }))}>prompt</button><button id="start" onClick={() => void f.start()}>start</button><span id="error">{f.error ?? ""}</span></div>;
    }
    const c = document.createElement("div"); const root = createRoot(c);
    await act(async()=>{root.render(<H />);});
    await act(async()=>{(c.querySelector("#select") as HTMLButtonElement).click(); (c.querySelector("#prompt") as HTMLButtonElement).click();});
    await act(async()=>{(c.querySelector("#start") as HTMLButtonElement).click();});
    expect(client.startImageGeneration).not.toHaveBeenCalled();
    expect((c.querySelector("#error") as HTMLElement).textContent).toContain("saved reference only");
  });

  it("keeps the default model inventory client stable across state renders", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      status: 200,
      headers: { get: () => "application/json" },
      json: async () => ({ ok: true, value: { models: [] } }),
    });
    vi.stubGlobal("fetch", fetchMock);
    function H() {
      const f = useImageGenerationFeature(undefined, undefined, undefined, undefined, "workspace-a");
      return <button id="prompt" onClick={() => f.setForm((x) => ({ ...x, prompt: "cat" }))}>{f.modelInventoryLoading ? "loading" : "ready"}</button>;
    }
    const c = document.createElement("div"); const root = createRoot(c);
    await act(async()=>{root.render(<H />); await flush(); await flush();});
    expect(
      fetchMock.mock.calls.filter(([url]) => String(url).includes("/model/list")),
    ).toHaveLength(1);
    await act(async()=>{(c.querySelector("#prompt") as HTMLButtonElement).click(); await flush();});
    expect(
      fetchMock.mock.calls.filter(([url]) => String(url).includes("/model/list")),
    ).toHaveLength(1);
  });

  it("does not show prompt validation until generate attempt", async () => {
    const client = { createArtifactMediaViewUrl: vi.fn(), startImageGeneration: vi.fn(), readImageGeneration: vi.fn(), finalizeImageGenerationIfCompleted: vi.fn(), cancelImageGeneration: vi.fn() };
    const modelClient = { listModels: vi.fn().mockResolvedValue({ models: [] }) };
    const c = document.createElement("div"); const root = createRoot(c);
    await act(async()=>{root.render(<Harness client={client} modelClient={modelClient} />);});
    await act(async()=>{(c.querySelector("#prompt") as HTMLInputElement).value = ""; (c.querySelector("#prompt") as HTMLInputElement).dispatchEvent(new Event("input", { bubbles: true }));});
    expect((c.querySelector("#validation") as HTMLElement).textContent).toBe("");
    await act(async()=>{(c.querySelector("#start") as HTMLButtonElement).click();});
    expect((c.querySelector("#validation") as HTMLElement).textContent).toContain("Prompt is required");
  });

  it("initializes server generation defaults", async () => {
    const client = { createArtifactMediaViewUrl: vi.fn(), startImageGeneration: vi.fn(), readImageGeneration: vi.fn(), finalizeImageGenerationIfCompleted: vi.fn(), cancelImageGeneration: vi.fn() };
    const modelClient = { listModels: vi.fn().mockResolvedValue({ models: [] }) };
    function H() {
      const f = useImageGenerationFeature(client, undefined, modelClient, undefined, "workspace-a");
      return <div><span id="defaults">{[f.form.prompt, f.form.negativePrompt, f.form.width, f.form.height, f.form.sampler, f.form.scheduler].join("|")}</span></div>;
    }
    const c = document.createElement("div"); const root = createRoot(c);
    await act(async () => { root.render(<H />); });
    expect((c.querySelector("#defaults") as HTMLElement).textContent).toBe("raw photo quality image; 35mm camera quality image; a dog in the park|anime; cartoon; melty; blurry|1024|1024|dpmpp_2m|karras");
  });

  it('loads model inventory without invalid list source metadata', async () => {
    const client = { createArtifactMediaViewUrl: vi.fn(), startImageGeneration: vi.fn(), readImageGeneration: vi.fn(), finalizeImageGenerationIfCompleted: vi.fn(), cancelImageGeneration: vi.fn() };
    const listModels = vi.fn().mockResolvedValue({ models: [model('img', 'downloaded', 'text-to-image')] });
    const c = document.createElement('div'); const root = createRoot(c);
    await act(async()=>{root.render(<Harness client={client} modelClient={{ listModels }} />);});
    expect(listModels).toHaveBeenCalledWith({ workspaceId: "workspace-a" });
    expect((c.querySelector('#selected') as HTMLElement).textContent).toBe('img');
  });


  it("auto-finalizes on success and assigns random seed when omitted", async () => {
    const client = { createArtifactMediaViewUrl: vi.fn(), startImageGeneration: vi.fn().mockResolvedValue({ requestId: "r1" }), readImageGeneration: vi.fn().mockResolvedValue({ requestId: "r1", status: "succeeded" }), finalizeImageGenerationIfCompleted: vi.fn().mockResolvedValue({ finalized: true, assets: [{ assetId: "a1", artifactId: "artifact-1", storageKey: "generated/images/a.png", mediaType: "image/png" }] }), cancelImageGeneration: vi.fn() };
    const modelClient = { listModels: vi.fn().mockResolvedValue({ models: [] }) };
    function H() { const f = useImageGenerationFeature(client, undefined, modelClient, undefined, "workspace-a"); return <div><button id="start" onClick={()=>void f.start()}>s</button><button id="prompt" onClick={()=>f.setForm((x)=>({...x,prompt:"cat",seed:""}))}>p</button><span id="result">{f.results[0]?.storageKey ?? ""}</span></div>; }
    const c = document.createElement("div"); const root = createRoot(c);
    await act(async()=>{root.render(<H/>);});
    await act(async()=>{(c.querySelector("#prompt") as HTMLButtonElement).click(); (c.querySelector("#start") as HTMLButtonElement).click(); await flush();});
    expect(client.finalizeImageGenerationIfCompleted).toHaveBeenCalledWith({ requestId: "r1", workspaceId: "workspace-a" });
    expect(client.startImageGeneration).toHaveBeenCalledWith(expect.objectContaining({ seed: expect.any(Number) }));
    expect((c.querySelector("#result") as HTMLElement).textContent).toBe("generated/images/a.png");
  });

  it("strict mode still loads model inventory", async () => {
    const client = { createArtifactMediaViewUrl: vi.fn(), startImageGeneration: vi.fn(), readImageGeneration: vi.fn(), finalizeImageGenerationIfCompleted: vi.fn(), cancelImageGeneration: vi.fn() };
    const listModels = vi.fn().mockResolvedValue({ models: [model("img", "downloaded", "text-to-image")] });
    const c = document.createElement("div"); const root = createRoot(c);
    await act(async()=>{root.render(<React.StrictMode><Harness client={client} modelClient={{ listModels }} /></React.StrictMode>);});
    expect(listModels).toHaveBeenCalled();
    expect((c.querySelector('#selected') as HTMLElement).textContent).toBe('img');
  });

  it("includes faceId payload when enabled with up to three references", async () => {
    const client = { createArtifactMediaViewUrl: vi.fn(), startImageGeneration: vi.fn().mockResolvedValue({ requestId: "r1" }), readImageGeneration: vi.fn().mockResolvedValue({ requestId: "r1", status: "failed" }), finalizeImageGenerationIfCompleted: vi.fn(), cancelImageGeneration: vi.fn(), readRuntimeResources: vi.fn().mockResolvedValue({ memoryUsagePercent: 1, cpuUsagePercent: 2, gpuUsagePercent: 3 }) };
    const modelClient = { listModels: vi.fn().mockResolvedValue({ models: [] }) };
    function H() { const f = useImageGenerationFeature(client, undefined, modelClient, undefined, "workspace-a"); return <div><button id="setup" onClick={() => f.setForm((x) => ({ ...x, prompt: "face", faceIdEnabled: true, faceIdArtifactId1: "a1", faceIdArtifactId2: "a1", faceIdArtifactId3: "a2" }))}>set</button><button id="start" onClick={() => void f.start()}>s</button></div>; }
    const c = document.createElement("div"); const root = createRoot(c);
    await act(async()=>{root.render(<H />);});
    await act(async()=>{(c.querySelector("#setup") as HTMLButtonElement).click(); (c.querySelector("#start") as HTMLButtonElement).click();});
    expect(client.startImageGeneration).toHaveBeenCalledWith(expect.objectContaining({ faceId: { enabled: true, references: [{ artifactId: "a1" }, { artifactId: "a1" }, { artifactId: "a2" }], identityStrength: 0.85, structureStrength: 0.75, noise: 0.35 } }));
  });

  it("shows artifact-backed results after automatic finalization", async () => {
    const client = {
      createArtifactMediaViewUrl: vi.fn(),
      startImageGeneration: vi.fn().mockResolvedValue({ requestId: "r1" }),
      readImageGeneration: vi.fn().mockResolvedValue({
        requestId: "r1",
        status: "succeeded",
        data: { outputs: [{ fileName: "x.png", contentBase64: "YWJj", mediaType: "image/png" }] },
      }),
      finalizeImageGenerationIfCompleted: vi.fn().mockResolvedValue({ finalized: true, assets: [{ assetId: "a1", artifactId: "artifact-1", storageKey: "generated/images/x.png", mediaType: "image/png" }] }),
      cancelImageGeneration: vi.fn(),
      readRuntimeResources: vi.fn().mockResolvedValue({ memoryUsagePercent: 1, cpuUsagePercent: 2, gpuUsagePercent: 3 }),
      unloadModel: vi.fn(),
    };
    const modelClient = { listModels: vi.fn().mockResolvedValue({ models: [] }) };
    const c = document.createElement("div"); const root = createRoot(c);
    await act(async()=>{root.render(<Harness client={client} modelClient={modelClient} />);});
    await act(async()=>{(c.querySelector("#prompt") as HTMLInputElement).value = "cat"; (c.querySelector("#prompt") as HTMLInputElement).dispatchEvent(new Event("input", { bubbles: true })); (c.querySelector("#start") as HTMLButtonElement).click(); await flush();});
    expect((c.querySelector("#result") as HTMLElement).textContent).toBe("generated/images/x.png");
    expect(client.finalizeImageGenerationIfCompleted).toHaveBeenCalledWith({ requestId: "r1", workspaceId: "workspace-a" });
    expect(client.finalizeImageGenerationIfCompleted).toHaveBeenCalledTimes(1);
  });

  it("reports a failure when automatic finalization registers no image artifacts", async () => {
    const client = {
      createArtifactMediaViewUrl: vi.fn(),
      startImageGeneration: vi.fn().mockResolvedValue({ requestId: "r-empty" }),
      readImageGeneration: vi.fn().mockResolvedValue({ requestId: "r-empty", status: "succeeded", data: { outputs: [{ fileName: "x.png" }] } }),
      finalizeImageGenerationIfCompleted: vi.fn().mockResolvedValue({ finalized: true, assets: [] }),
      cancelImageGeneration: vi.fn(),
      readRuntimeResources: vi.fn().mockResolvedValue({ memoryUsagePercent: 1, cpuUsagePercent: 2, gpuUsagePercent: 3 }),
      unloadModel: vi.fn(),
    };
    const modelClient = { listModels: vi.fn().mockResolvedValue({ models: [] }) };
    function H() { const f = useImageGenerationFeature(client, undefined, modelClient, undefined, "workspace-a"); return <div><button id="start" onClick={() => void f.start()}>s</button><button id="prompt" onClick={() => f.setForm((x) => ({ ...x, prompt: "cat" }))}>p</button><span id="status">{f.status}</span><span id="error">{f.error ?? ""}</span></div>; }
    const c = document.createElement("div"); const root = createRoot(c);
    await act(async()=>{root.render(<H />);});
    await act(async()=>{(c.querySelector("#prompt") as HTMLButtonElement).click();});
    await act(async()=>{(c.querySelector("#start") as HTMLButtonElement).click(); await flush();});
    expect((c.querySelector("#status") as HTMLElement).textContent).toBe("failed");
    expect((c.querySelector("#error") as HTMLElement).textContent).toContain("did not register");
  });
});
