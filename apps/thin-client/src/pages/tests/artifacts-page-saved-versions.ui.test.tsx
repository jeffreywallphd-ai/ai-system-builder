// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import type { DatasetVersionRecord } from "../../../../../modules/contracts/dataset";
import { NotificationProvider } from "../../../../../modules/ui/shared/notifications/NotificationProvider";
const state=vi.hoisted(()=>({client:{} as any, browser:{} as any, capturedService:undefined as any}));
vi.mock("../../features/artifact-browser/hooks/useArtifactBrowserFeature",()=>({useArtifactBrowserFeature:()=>state.browser}));
vi.mock("../../features/dataset-preparation/api/apiDatasetPreparationClient",()=>({createApiDatasetPreparationClient:()=>state.client}));
vi.mock("../../features/dataset-preparation/components/DatasetPreparationFeature",()=>({DatasetPreparationFeature:()=>null}));
vi.mock("../../features/artifact-upload",()=>({ArtifactIngestionFeature:()=>null}));
vi.mock("../../features/page-dashboard/ThinClientPageDashboard",()=>({ThinClientPageDashboard:()=>null}));
vi.mock("../../features/context-management/api/contextManagementPageClient",()=>({createContextManagementPageClient:()=>({execute:vi.fn(async()=>({action:"source-inspect",readiness:{ready:false}}))})}));
vi.mock("../../../../../modules/ui/shared/dataset-review",()=>({DatasetReviewWorkspace:()=>null}));
import { ArtifactsPage } from "../ArtifactsPage";
import { ArtifactBrowserFeature } from "../../features/artifact-browser/components/ArtifactBrowserFeature";
(globalThis as any).IS_REACT_ACT_ENVIRONMENT=true;
let root:Root|undefined, container:HTMLDivElement;
afterEach(()=>{act(()=>root?.unmount());container?.remove();root=undefined;vi.clearAllMocks();});
const digest = (seed: string) => `sha256:${seed.repeat(64)}` as const;
function version(id: string, rows: number, createdAt: string): DatasetVersionRecord { return { schemaVersion: "1.0", versionId: id as never, datasetId: "support" as never, workspaceId: "workspace-a" as never, versionDigest: digest(id === "v2" ? "2" : "1"), artifacts: [{ role: "dataset", artifactKey: `data/${id}.jsonl`, digest: digest("a"), mediaType: "application/jsonl", sizeBytes: 10, rowCount: rows }], lineage: { sources: [{ sourceArtifactId: "source-1", artifactKey: "source.csv", digest: digest("b"), mediaType: "text/csv" }], recipe: { artifactKey: "recipe.json", digest: digest("c"), implementationId: "prepare", implementationVersion: "1" }, quality: { policyId: "recommended", policyVersion: "1", policyFingerprint: digest("d"), reportFingerprint: digest("e") } }, documentation: { name: "Support data", summary: "Summary", intendedUses: ["Training"], limitations: ["Review"] }, totalRows: rows, createdAt, createdBy: "person-1" }; }


function setup(){
 const item={artifactId:"artifact-2",storageKey:"data/v2.jsonl",artifactFamily:"tabular",originalName:"Saved dataset",mediaType:"application/jsonl",sizeBytes:10};
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
 const list=vi.fn(async()=>[version("v2",14,"2026-07-29T12:00:00.000Z")]);
 const publication=vi.fn(async(input:any)=>({schemaVersion:"1.0",publicationId:"publication-1",workspaceId:input.workspaceId,versionId:input.versionId,provider:"hugging-face",repositoryId:input.repositoryId,revision:"abc1234",visibility:input.visibility,publishedAt:"2026-07-29T12:00:00.000Z",publishedBy:"person-1"}));
 state.client={listVersions:vi.fn(async(...args:any[])=>({versions:await list()})),compareVersions:vi.fn(async()=>({comparison:{fromVersionId:"v1",toVersionId:"v2"}})),readReproduction:vi.fn(async()=>({reproduction:{versionId:"v2"}})),publishVersion:vi.fn(async(input:any)=>({publication:await publication(input)}))};
 container=document.createElement("div");document.body.append(container);root=createRoot(container);
 return {list,publication};
}
async function click(label:string){await act(async()=>{const b=[...document.body.querySelectorAll<HTMLButtonElement>("button")].find(b=>b.textContent===label);if(!b)throw new Error(`Missing ${label}`);b.click();});}
it("mounts the real Browser history through the page's current client adapter and publishes only explicitly",async()=>{
 const {publication}=setup(); await act(async()=>root!.render(<NotificationProvider><ArtifactsPage workspaceId="workspace-a" workspaceName="Test" initialSelectedStorageKey="data/v2.jsonl" /></NotificationProvider>));
 expect(document.body.textContent).toContain("Saved versions");expect(document.body.querySelector('select')||document.body.textContent).toBeTruthy();
 expect(state.client.listVersions).toHaveBeenCalledWith({workspaceId:"workspace-a",datasetId:undefined});
 expect(document.body.textContent).not.toContain("Use this setup again");expect(publication).not.toHaveBeenCalled();
 const field=document.body.querySelector<HTMLInputElement>('input[placeholder="owner/dataset-name"]')!;expect(field).toBeTruthy();
 await act(async()=>{Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,"value")!.set!.call(field,"owner/support");field.dispatchEvent(new Event("input",{bubbles:true}));});
 await click("Publish privately");expect(publication).toHaveBeenCalledExactlyOnceWith({workspaceId:"workspace-a",versionId:"v2",repositoryId:"owner/support",visibility:"private"});
});
it("does not mount saved history for mismatched selected detail",async()=>{
 setup();state.browser.selectedStorageKey="another.jsonl";
 await act(async()=>root!.render(<NotificationProvider><ArtifactBrowserFeature workspaceId="workspace-a" datasetVersionService={{list:vi.fn(),compare:vi.fn(),reproduce:vi.fn(),publish:vi.fn()}}/></NotificationProvider>));
 expect(document.body.textContent).not.toContain("Saved versions");
});
