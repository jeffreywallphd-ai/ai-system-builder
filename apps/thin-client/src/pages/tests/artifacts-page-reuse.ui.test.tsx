// @vitest-environment jsdom
import { StrictMode, act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import type { DatasetVersionRecord } from "../../../../../modules/contracts/dataset";
import { NotificationProvider, useOptionalNotificationCenter } from "../../../../../modules/ui/shared/notifications/NotificationProvider";
const state=vi.hoisted(()=>({client:{} as any, browser:{} as any, sourceClient:{} as any}));
vi.mock("../../features/artifact-browser/hooks/useArtifactBrowserFeature",()=>({useArtifactBrowserFeature:()=>state.browser}));
vi.mock("../../features/dataset-preparation/api/apiDatasetPreparationClient",()=>({createApiDatasetPreparationClient:()=>state.client}));
vi.mock("../../features/artifact-browser/api/apiArtifactBrowserClient",()=>({createApiArtifactBrowserClient:()=>state.sourceClient}));
vi.mock("../../features/artifact-upload",()=>({ArtifactIngestionFeature:()=>null}));
vi.mock("../../features/page-dashboard/ThinClientPageDashboard",()=>({ThinClientPageDashboard:()=>null}));
vi.mock("../../features/context-management/api/contextManagementPageClient",()=>({createContextManagementPageClient:()=>({execute:vi.fn(async()=>({action:"source-inspect",readiness:{ready:false}}))})}));
vi.mock("../../../../../modules/ui/shared/dataset-review",async importOriginal=>({...(await importOriginal<typeof import("../../../../../modules/ui/shared/dataset-review")>()),DatasetReviewWorkspace:()=>null}));
import { ArtifactsPage } from "../ArtifactsPage";
import { ArtifactBrowserFeature } from "../../features/artifact-browser/components/ArtifactBrowserFeature";
(globalThis as any).IS_REACT_ACT_ENVIRONMENT=true;
let root:Root|undefined, container:HTMLDivElement;
afterEach(()=>{act(()=>root?.unmount());container?.remove();root=undefined;vi.clearAllMocks();localStorage.clear();messages=[];});
import { fixture } from "../../features/dataset-preparation/tests/datasetVersionReplayFixture";
function setup(){
 const f=fixture("llm-classification");f.snapshot.recipe.task.labelSet=["positive","negative"];
 const item={artifactId:"artifact-2",storageKey:"prepared/training.jsonl",artifactFamily:"tabular",originalName:"Saved dataset",mediaType:"application/jsonl",sizeBytes:10};
 const empty={status:"idle"}; const noop=()=>{};
 state.browser={items:[item],uploadedItems:[],generatedItems:[item],otherItems:[],unregisteredItems:[],
 selectedStorageKey:item.storageKey, detail:{locator:{storageKey:item.storageKey},artifactFamily:"tabular",originalName:"Saved dataset",mediaType:"application/jsonl",metadata:{}},
 content:{availability:"available",retrieval:"deferred",locator:{storageKey:item.storageKey}},artifactPreview:{status:"idle"},
 publishState:empty,registerState:empty,localizeState:empty,sourceVerifyState:empty,viewState:empty,
 publishForm:{repository:"",pathInRepo:"",revision:"",mediaType:"",createRepositoryIfMissing:false,repositoryVisibility:"private",showPublishForm:false},
 registerForm:{namespace:"",repository:"",pathInRepo:"",revision:"",mediaType:"",showRegisterForm:false},
 selectedArtifactKeys:[],huggingFaceNamespaceDatasets:[],selectedArtifactFamily:"all",selectedStorageFilter:"all",deleteConfirmationInput:"",bulkDeleteConfirmationInput:"",
 selectArtifact:vi.fn(async()=>{}),refreshArtifacts:vi.fn(async()=>{}),getHuggingFaceDatasetParquetFiles:()=>[],getHuggingFaceDatasetFilesState:()=>empty,
 setSelectedArtifactFamily:noop,setSelectedStorageFilter:noop,setDeleteConfirmationInput:noop,setBulkDeleteConfirmationInput:noop,
 toggleSelectedArtifactKey:noop,toggleAllArtifactKeys:noop,clearSelectedArtifactKeys:noop,readArtifactMedia:vi.fn(),
 setRepository:noop,setPathInRepo:noop,setRevision:noop,setMediaType:noop,setCreateRepositoryIfMissing:noop,setRepositoryVisibility:noop,
 setRegisterRepository:noop,setRegisterNamespace:noop,setRegisterPathInRepo:noop,setRegisterRevision:noop,setRegisterMediaType:noop};

 let resolve!:(rows:any[])=>void,reject!:(error:Error)=>void;
 const sources=new Promise<any[]>((yes,no)=>{resolve=yes;reject=no;});
 const browse=vi.fn().mockReturnValue(sources),lookup=vi.fn(async({storageKey}:any)=>({locator:{storageKey},originalName:f.source.originalName,mediaType:f.source.mediaType}));
 const dispatch=vi.fn(async()=>({requestId:"task-1"})),publication=vi.fn();
 state.sourceClient={browseArtifacts:browse,readArtifactDetail:lookup};
 state.client={listVersions:vi.fn(async()=>({versions:[f.version]})),compareVersions:vi.fn(),readReproduction:vi.fn(async()=>({reproduction:f.reproduction})),publishVersion:publication,start:dispatch,read:vi.fn(async()=>({status:"cancelled"})),cancel:vi.fn()};
 container=document.createElement("div");document.body.append(container);root=createRoot(container);
 return {f,browse,lookup,dispatch,publication,resolve,reject};
}
let messages:readonly {message:string;source?:string;workspaceId?:string}[]=[];
function Notices(){messages=useOptionalNotificationCenter()!.state.records;return null;}
const notices=()=>messages.filter(m=>m.source==="dataset-version-reuse");
async function render(workspaceId="workspace-a",strict=false){const page=<NotificationProvider><Notices/><ArtifactsPage workspaceId={workspaceId} workspaceName="Test" initialSelectedStorageKey="prepared/training.jsonl"/></NotificationProvider>;await act(async()=>root!.render(strict?<StrictMode>{page}</StrictMode>:page));}
async function click(label:string){await act(async()=>{const b=[...container.querySelectorAll<HTMLButtonElement>("button")].find(x=>x.textContent?.trim()===label);if(!b)throw new Error(`Missing ${label}`);b.click();});}
function goal(){return [...container.querySelectorAll<HTMLSelectElement>("select")].find(s=>s.querySelector('option[value="llm-extraction"]'))!;}
function selected(){return [...container.querySelectorAll<HTMLInputElement>('input[type="checkbox"]')].some(x=>x.checked&&x.parentElement?.textContent?.includes("source.csv"));}
async function edit(){await act(async()=>{goal().value="llm-extraction";goal().dispatchEvent(new Event("change",{bubbles:true}));});}
it.each([false,true])("real browser page applies the exact saved form before one success notice, StrictMode=%s",async strict=>{
 const s=setup();await render("workspace-a",strict);expect(container.textContent).toContain("Use this setup again");
 await click("Use this setup again");expect(container.textContent).toContain("Loading source files");expect(notices()).toHaveLength(0);
 await act(async()=>s.resolve([s.f.source]));expect(goal().value).toBe("llm-classification");expect(selected()).toBe(true);expect(notices()).toHaveLength(1);
 expect(s.lookup).toHaveBeenCalledExactlyOnceWith({storageKey:s.f.source.storageKey},{workspaceId:"workspace-a"});
 expect(s.dispatch).not.toHaveBeenCalled();expect(s.publication).not.toHaveBeenCalled();
 await click("Run checks and prepare");expect(s.dispatch).toHaveBeenCalledTimes(1);
 expect(s.dispatch.mock.calls[0][0].command).toMatchObject({sourceArtifactIds:[s.f.source.artifactId],recipe:{task:{taskType:"llm-classification",labelSet:["positive","negative"]}},split:{trainRatio:0.6,validationRatio:0.3,testRatio:0.1,shuffle:true},output:{format:"jsonl",naming:{baseName:"Saved setup"},destinations:{local:{enabled:true}}}});
});
it("an edit while sources load prevents a late restore",async()=>{
 const s=setup();await render();await click("Use this setup again");await edit();await act(async()=>s.resolve([s.f.source]));
 expect(goal().value).toBe("llm-extraction");expect(selected()).toBe(false);expect(notices()).toHaveLength(0);expect(s.dispatch).not.toHaveBeenCalled();
});
it("a failed source read and retry do not secretly restore; a fresh explicit request can succeed",async()=>{
 const s=setup();await render();await click("Use this setup again");await act(async()=>s.reject(new Error("private-source-detail")));
 expect(container.textContent).toContain("Source files could not be loaded");expect(container.textContent).not.toContain("private-source-detail");expect(notices()).toHaveLength(0);
 s.browse.mockResolvedValue([s.f.source]);await click("Retry source files");expect(goal().value).toBe("llm-instruction");expect(selected()).toBe(false);
 await click("Artifact Browser");await click("Use this setup again");expect(goal().value).toBe("llm-classification");expect(notices()).toHaveLength(1);expect(s.dispatch).not.toHaveBeenCalled();
});
it("a saved file beyond the first250 browse results can be restored",async()=>{
 const s=setup();await render();await click("Use this setup again");await act(async()=>s.resolve(Array.from({length:250},(_,i)=>({...s.f.source,artifactId:`uploads/${i}.csv`,storageKey:`uploads/${i}.csv`,originalName:`${i}.csv`}))));
 expect(goal().value).toBe("llm-classification");expect(selected()).toBe(true);expect(notices()).toHaveLength(1);expect(s.dispatch).not.toHaveBeenCalled();
});
it.each(["edit","tab","workspace"])("a deferred detail read cannot apply after %s changes",async mode=>{
 const s=setup();let finish!:(value:any)=>void;s.lookup.mockImplementation(()=>new Promise(resolve=>{finish=resolve;}));
 await render();await click("Use this setup again");await act(async()=>s.resolve([]));expect(s.lookup).toHaveBeenCalledTimes(1);expect(notices()).toHaveLength(0);
 if(mode==="edit")await edit();if(mode==="tab")await click("Artifact Browser");if(mode==="workspace")await render("workspace-b");
 await act(async()=>finish({locator:{storageKey:s.f.source.storageKey},originalName:s.f.source.originalName,mediaType:s.f.source.mediaType}));
 expect(notices()).toHaveLength(0);expect(selected()).toBe(false);if(mode==="edit")expect(goal().value).toBe("llm-extraction");expect(s.dispatch).not.toHaveBeenCalled();expect(s.publication).not.toHaveBeenCalled();
});
it("a foreign returned source key denies the whole form",async()=>{
 const s=setup();s.lookup.mockResolvedValue({locator:{storageKey:"foreign.csv"},originalName:"source.csv",mediaType:"text/csv"});
 await render();await click("Use this setup again");await act(async()=>s.resolve([]));expect(goal().value).toBe("llm-instruction");expect(selected()).toBe(false);expect(notices()).toHaveLength(0);expect(s.dispatch).not.toHaveBeenCalled();
});
