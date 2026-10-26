// @vitest-environment jsdom
import { StrictMode, act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import type { DatasetVersionRecord } from "../../../../../../modules/contracts/dataset";
import { NotificationProvider, useOptionalNotificationCenter } from "../../../../../../modules/ui/shared/notifications/NotificationProvider";
const state=vi.hoisted(()=>({client:{} as any, browser:{} as any, capturedService:undefined as any}));
vi.mock("../../features/artifact-browser/hooks/useArtifactBrowserFeature",()=>({useArtifactBrowserFeature:()=>state.browser}));
vi.mock("../../features/dataset-preparation/api/desktopDatasetPreparationClient",()=>({createDesktopDatasetPreparationClient:()=>state.client}));
vi.mock("../../features/artifact-upload/components/ArtifactIngestionFeature",()=>({ArtifactIngestionFeature:()=>null}));
vi.mock("../../features/page-dashboard/DesktopPageDashboard",()=>({DesktopPageDashboard:()=>null}));
vi.mock("../../features/settings",()=>({useApplicationSettings:()=>({valuesByKey:new Map()}),SettingsPanel:()=>null}));
vi.mock("../../features/python-runtime/components/PythonRuntimeFooter",()=>({PythonRuntimeFooter:()=>null}));
vi.mock("../../features/context-management/api/desktopContextManagementClient",()=>({createDesktopContextManagementClient:()=>({execute:vi.fn(async()=>({action:"source-inspect",readiness:{ready:false}}))})}));
vi.mock("../../../../../../modules/ui/shared/dataset-review",async importOriginal=>({...(await importOriginal<typeof import("../../../../../../modules/ui/shared/dataset-review")>()),DatasetReviewWorkspace:()=>null}));
import { ArtifactsPage } from "../ArtifactsPage";
import { ArtifactBrowserFeature } from "../../features/artifact-browser/components/ArtifactBrowserFeature";
(globalThis as any).IS_REACT_ACT_ENVIRONMENT=true;
let root:Root|undefined, container:HTMLDivElement;
afterEach(()=>{act(()=>root?.unmount());container?.remove();root=undefined;resetDatasetPreparationPageStateForTests();localStorage.clear();vi.clearAllMocks();messages=[];});
import { datasetVersionReplayFixture } from "../../features/dataset-preparation/tests/datasetVersionReplayFixture";
import { resetDatasetPreparationPageStateForTests } from "../../features/dataset-preparation/hooks/useDatasetPreparationFeature";
let messages: readonly { message: string; source?: string; workspaceId?: string }[] = [];
function Notices() { messages = useOptionalNotificationCenter()!.state.records; return null; }
const reuseNotices = () => messages.filter(m => m.source === "dataset-version-reuse");
function setup(){
 const fixture=datasetVersionReplayFixture("llm-classification"); fixture.recipe.task.labelSet=["positive","negative"];
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
 const list=vi.fn(async()=>[fixture.version]);
 let resolve!: (rows:any[])=>void, reject!: (error:Error)=>void;
 const sources=new Promise<any[]>((yes,no)=>{resolve=yes;reject=no;});
 const browse=vi.fn().mockReturnValue(sources);
 const publication=vi.fn(), dispatch=vi.fn();
 state.client={listVersions:list,compareVersions:vi.fn(),readReproduction:vi.fn(async()=>fixture.reproduction),publishVersion:publication,browseSourceArtifacts:browse,startPrepareTrainingDataset:dispatch};
 container=document.createElement("div");document.body.append(container);root=createRoot(container);
 return {fixture,list,publication,dispatch,browse,resolve,reject};
}

async function render(workspaceId="workspace-a", strict=false){const page=<NotificationProvider><Notices/><ArtifactsPage workspaceId={workspaceId} workspaceName="Test" initialSelectedStorageKey="prepared/training.jsonl" refreshToken={0} onUploaded={()=>{}}/></NotificationProvider>;await act(async()=>root!.render(strict?<StrictMode>{page}</StrictMode>:page));}
async function click(label:string){await act(async()=>{const buttons=[...document.body.querySelectorAll<HTMLButtonElement>("button")];const button=buttons.find(b=>b.textContent?.trim()===label||b.querySelector(".ui-button__label")?.textContent===label);if(!button)throw new Error(`Missing ${label}`);button.click();});}
function goal(){return [...document.body.querySelectorAll<HTMLSelectElement>("select")].find(s=>s.querySelector('option[value="llm-extraction"]'))!;}
function hasSavedSource(){return [...document.body.querySelectorAll<HTMLInputElement>('input[type="checkbox"]')].some(input=>input.checked&&input.parentElement?.textContent?.includes("examples.csv"));}
it.each([false,true])("real Browser-to-Preparation reuse waits for sources and actual form application, strict=%s",async strict=>{
 const s=setup();await render("workspace-a",strict);expect(document.body.textContent).toContain("Use this setup again");expect(reuseNotices()).toHaveLength(0);
 await click("Use this setup again");expect(document.body.textContent).toContain("Loading source files");expect(reuseNotices()).toHaveLength(0);expect(s.dispatch).not.toHaveBeenCalled();expect(s.publication).not.toHaveBeenCalled();
 await act(async()=>s.resolve([s.fixture.source]));expect(goal().value).toBe("llm-classification");expect(hasSavedSource()).toBe(true);expect(reuseNotices()).toHaveLength(1);expect(reuseNotices()[0].workspaceId).toBe("workspace-a");expect(document.body.textContent).not.toContain("Saved versions");
 await click("Save training settings");const saved=JSON.parse(localStorage.getItem("ai-system-builder.datasetPreparation.trainingSettings.v1")!)[0].settings;
 expect(saved).toMatchObject({taskType:"llm-classification",labelSet:"positive, negative",outputBaseName:"Saved setup",trainRatio:"0.7",validationRatio:"0.2",testRatio:"0.1",seed:"17",shuffle:false,qualityPreset:"strict",huggingFaceDestinationEnabled:false,huggingFaceRepository:"",localDestinationEnabled:true});
 expect(s.dispatch).not.toHaveBeenCalled();expect(s.publication).not.toHaveBeenCalled();
});
it("later goal edits retire a waiting restore and a late source reply cannot overwrite them",async()=>{
 const s=setup();await render();await click("Use this setup again");await act(async()=>{goal().value="llm-extraction";goal().dispatchEvent(new Event("change",{bubbles:true}));});
 await act(async()=>s.resolve([s.fixture.source]));expect(goal().value).toBe("llm-extraction");expect(hasSavedSource()).toBe(false);expect(reuseNotices()).toHaveLength(0);expect(s.dispatch).not.toHaveBeenCalled();
});
it("leaving preparation retires the request and returning does not apply a late reply",async()=>{
 const s=setup();await render();await click("Use this setup again");await click("Artifact Browser");await act(async()=>s.resolve([s.fixture.source]));expect(reuseNotices()).toHaveLength(0);
 await click("Dataset Preparation");expect(goal().value).toBe("llm-instruction");expect(hasSavedSource()).toBe(false);expect(reuseNotices()).toHaveLength(0);
});
it("source failure stays safe, retry does not secretly restore, and a fresh explicit reuse can succeed",async()=>{
 const s=setup();await render();await click("Use this setup again");await act(async()=>s.reject(new Error("private-source-detail")));expect(document.body.textContent).toContain("Source files could not be loaded");expect(document.body.textContent).not.toContain("private-source-detail");expect(reuseNotices()).toHaveLength(0);
 s.browse.mockResolvedValue([s.fixture.source]);await click("Retry source files");expect(goal().value).toBe("llm-instruction");expect(hasSavedSource()).toBe(false);expect(reuseNotices()).toHaveLength(0);
 await click("Artifact Browser");await click("Use this setup again");expect(goal().value).toBe("llm-classification");expect(reuseNotices()).toHaveLength(1);expect(s.dispatch).not.toHaveBeenCalled();
});
it("workspace replacement retires the old delivery and keeps old success out of the new workspace",async()=>{
 const s=setup();await render();await click("Use this setup again");await render("workspace-b");await act(async()=>s.resolve([s.fixture.source]));expect(reuseNotices()).toHaveLength(0);expect(hasSavedSource()).toBe(false);expect(s.dispatch).not.toHaveBeenCalled();expect(s.publication).not.toHaveBeenCalled();
});

it.each(["empty", "wrong-key"])("ready but %s original sources deny the whole restore",async mode=>{
 const s=setup();await render();await click("Use this setup again");
 await act(async()=>s.resolve(mode==="empty"?[]:[{...s.fixture.source,storageKey:"uploads/different.csv"}]));
 expect(goal().value).toBe("llm-instruction");expect(hasSavedSource()).toBe(false);expect(reuseNotices()).toHaveLength(0);expect(s.dispatch).not.toHaveBeenCalled();expect(s.publication).not.toHaveBeenCalled();
});
