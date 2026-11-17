// @vitest-environment jsdom
import { act, useEffect } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { DatasetVersionRecord } from "../../../../contracts/dataset";
import { NotificationProvider, useNotificationCenter } from "../../notifications/NotificationProvider";
import { DatasetVersionPanel, type DatasetVersionPanelService } from "../DatasetVersionPanel";
(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root | undefined;
let container: HTMLDivElement;
afterEach(() => { act(() => root?.unmount()); container?.remove(); root = undefined; });
const digest = (seed: string) => `sha256:${seed.repeat(64)}` as const;
function version(id: string, rows: number, createdAt: string): DatasetVersionRecord { return { schemaVersion: "1.0", versionId: id as never, datasetId: "support" as never, workspaceId: "workspace-a" as never, versionDigest: digest(id === "v2" ? "2" : "1"), artifacts: [{ role: "dataset", artifactKey: `data/${id}.jsonl`, digest: digest("a"), mediaType: "application/jsonl", sizeBytes: 10, rowCount: rows }], lineage: { sources: [{ sourceArtifactId: "source-1", artifactKey: "source.csv", digest: digest("b"), mediaType: "text/csv" }], recipe: { artifactKey: "recipe.json", digest: digest("c"), implementationId: "prepare", implementationVersion: "1" }, quality: { policyId: "recommended", policyVersion: "1", policyFingerprint: digest("d"), reportFingerprint: digest("e") } }, documentation: { name: "Support data", summary: "Summary", intendedUses: ["Training"], limitations: ["Review"] }, totalRows: rows, createdAt, createdBy: "person-1" }; }

function button(label: string) { const found = [...container.querySelectorAll<HTMLButtonElement>("button")].find(item => item.textContent === label); if (!found) throw new Error(`Missing ${label}`); return found; }
function input(value: string) { const field = container.querySelector<HTMLInputElement>('input[placeholder="owner/dataset-name"]')!; Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(field, value); field.dispatchEvent(new Event("input", { bubbles: true })); }
function choose(index: number, value: string) { const field = container.querySelectorAll<HTMLSelectElement>("select")[index]; field.value = value; field.dispatchEvent(new Event("change", { bubbles: true })); }
function notifications() { const center = useNotificationCenter(); useEffect(() => center.setActiveWorkspaceId("workspace-a"), [center.setActiveWorkspaceId]); return <output data-testid="notifications">{center.records.map(r => r.message).join("\n")}</output>; }
const Notifications = notifications;
const v1 = () => version("v1", 10, "2026-07-28T12:00:00.000Z");
const v2 = () => version("v2", 14, "2026-07-29T12:00:00.000Z");
function deferred<T>() { let resolve!: (value:T)=>void; let reject!: (error:Error)=>void; const promise=new Promise<T>((yes,no)=>{resolve=yes;reject=no;}); return {promise,resolve,reject}; }
function service(): DatasetVersionPanelService {
 return { list:vi.fn(async()=>[v2(),v1()]), compare:vi.fn(async()=>({fromVersionId:"v1",toVersionId:"v2",identical:false,rowDelta:4,sources:{added:0,removed:0,changed:1},changedArtifactRoles:["dataset"],recipeChanged:false,qualityPolicyChanged:false,documentationChanged:false} as any)),
 reproduce:vi.fn(async()=>({versionId:"v2",sourceArtifactIds:["source-1"],recipeSnapshot:{split:{seed:42}},lineage:v2().lineage} as any)),
 publish:vi.fn(async input=>({schemaVersion:"1.0",publicationId:"publication-1",versionId:input.versionId,workspaceId:input.workspaceId,provider:"hugging-face",repositoryId:input.repositoryId,revision:"abc1234",visibility:input.visibility,publishedAt:"2026-07-29T12:00:00.000Z",publishedBy:"person-1"} as any)) };
}
async function render(api:DatasetVersionPanelService, extra:Partial<React.ComponentProps<typeof DatasetVersionPanel>>={}) {
 if (!root) { container=document.createElement("div");document.body.append(container);root=createRoot(container); }
 await act(async()=>root!.render(<NotificationProvider><DatasetVersionPanel workspaceId="workspace-a" datasetArtifactKey="data/v2.jsonl" service={api} {...extra}/><Notifications/></NotificationProvider>));
}
const notices=()=>container.querySelector('[data-testid="notifications"]')!.textContent!;

describe("exact saved dataset history",()=>{
 it("selects the exact older file rather than newest and exposes plain comparisons with private default",async()=>{
  const api=service(); await render(api,{datasetArtifactKey:"data/v1.jsonl"});
  expect(container.querySelector("select")!.value).toBe("v1"); expect(container.textContent).toContain("10");
  expect(api.compare).not.toHaveBeenCalled(); expect(container.querySelectorAll("select")[1].value).toBe("private");
  expect(container.textContent).not.toContain("Use this setup again");
  await act(async()=>choose(0,"v2")); expect(container.textContent).toContain("4 more rows"); expect(container.textContent).toContain("1 source change");
 });
 it("keeps load failure visible and recovers through retry, empty refresh and successful refresh",async()=>{
  const api=service(); vi.mocked(api.list).mockRejectedValueOnce(new Error("secret-path")).mockResolvedValueOnce([]);
  await render(api); expect(container.textContent).toContain("Version history could not be loaded"); expect(container.textContent).not.toContain("secret-path");
  await act(async()=>button("Retry version history").click()); expect(container.textContent).toContain("No saved dataset version matches this file");
  await act(async()=>button("Refresh versions").click()); expect(container.querySelector("select")!.value).toBe("v2");
 });
 it.each(["foreign","duplicate","ambiguous","malformed","current-conflict","wrong-role","unrelated"])("denies %s association without guessing",async kind=>{
  const api=service(); let items:any[]=[v2(),v1()];
  if(kind==="foreign") items[0]={...v2(),workspaceId:"workspace-b"};
  if(kind==="duplicate") items=[v2(),v2()];
  if(kind==="ambiguous") items[1]={...v1(),artifacts:v2().artifacts};
  if(kind==="malformed") items[0]={...v2(),versionDigest:"bad"};
  if(kind==="wrong-role") items=[{...v2(),artifacts:[{...v2().artifacts[0],role:"train"},{...v2().artifacts[0],artifactKey:"another.jsonl"}]}];
  vi.mocked(api.list).mockResolvedValue(items);
  await render(api,kind==="current-conflict"?{currentVersionId:"v1"}:kind==="unrelated"?{datasetArtifactKey:"unknown.jsonl"}:{});
  expect(container.querySelector("select")).toBeNull(); expect(api.publish).not.toHaveBeenCalled();
 });
 it("ignores a late old workspace list and reloads the new scope",async()=>{
  const api=service(), late=deferred<readonly DatasetVersionRecord[]>(); vi.mocked(api.list).mockReturnValueOnce(late.promise).mockResolvedValue([]);
  await render(api); expect(container.textContent).toContain("Loading saved versions");
  await render(api,{workspaceId:"workspace-b"}); await act(async()=>late.resolve([v2()]));
  expect(container.querySelector("select")).toBeNull(); expect(api.list).toHaveBeenLastCalledWith("workspace-b",undefined);
 });
 it("rejects a mismatched comparison and permits retry without stale comparison text",async()=>{
  const api=service(); vi.mocked(api.compare).mockResolvedValueOnce({...await api.compare("a","b","c"),toVersionId:"foreign"} as any);
  await render(api); expect(container.textContent).toContain("Versions could not be compared");
  await act(async()=>button("Retry comparison").click()); expect(container.textContent).toContain("4 more rows");
  const late=deferred<any>(); vi.mocked(api.compare).mockReturnValueOnce(late.promise);
  await act(async()=>button("Refresh versions").click()); await act(async()=>choose(0,"v1"));
  await act(async()=>late.resolve({fromVersionId:"v1",toVersionId:"v2",identical:true})); expect(container.textContent).not.toContain("No data or setup changes");
 });
 it("gives each mounted history heading a unique accessible target",async()=>{
  const api=service(); await render(api); await act(async()=>root!.render(<><DatasetVersionPanel workspaceId="workspace-a" datasetArtifactKey="data/v2.jsonl" service={api}/><DatasetVersionPanel workspaceId="workspace-a" datasetArtifactKey="data/v1.jsonl" service={api}/></>));
  const sections=[...container.querySelectorAll("section")]; expect(sections).toHaveLength(2);
  const ids=sections.map(s=>s.getAttribute("aria-labelledby")); expect(new Set(ids).size).toBe(2); ids.forEach(id=>expect(document.getElementById(id!)?.textContent).toBe("Saved versions"));
 });
 it("retires previous-service reads even within the same workspace and artifact",async()=>{
  const api=service(), late=deferred<readonly DatasetVersionRecord[]>(); vi.mocked(api.list).mockReturnValue(late.promise);
  await render(api); const next=service();vi.mocked(next.list).mockResolvedValue([]);await render(next);
  await act(async()=>late.resolve([v2()]));expect(container.querySelector("select")).toBeNull();expect(container.textContent).toContain("No saved dataset version");
 });
});

describe("explicit version publication",()=>{
 it("publishes only on explicit action and defaults to exact private destination",async()=>{
  const api=service(); await render(api); expect(api.publish).not.toHaveBeenCalled();
  await act(async()=>input("owner/support")); await act(async()=>button("Publish privately").click());
  expect(api.publish).toHaveBeenCalledExactlyOnceWith({workspaceId:"workspace-a",versionId:"v2",repositoryId:"owner/support",visibility:"private"}); expect(notices()).toContain("Dataset published privately to owner/support");
 });
 it.each(["repository","version","creation","visibility"])("requires fresh public confirmation after changing %s",async field=>{
  const api=service(); await render(api); await act(async()=>{input("owner/support");choose(1,"public");});
  await act(async()=>container.querySelectorAll<HTMLInputElement>('input[type="checkbox"]')[1].click());
  await act(async()=>{
   if(field==="repository") input("owner/other");
   if(field==="version") choose(0,"v1");
   if(field==="creation") container.querySelectorAll<HTMLInputElement>('input[type="checkbox"]')[0].click();
   if(field==="visibility") choose(1,"private");
  });
  if(field==="visibility") await act(async()=>choose(1,"public"));
  await act(async()=>button("Publish publicly").click()); expect(api.publish).not.toHaveBeenCalled(); expect(notices()).toContain("Confirm that this dataset");
 });
 it("binds creation and public confirmation to one dispatch and refuses duplicate synchronous clicks",async()=>{
  const api=service(), late=deferred<any>(); vi.mocked(api.publish).mockReturnValue(late.promise); await render(api);
  await act(async()=>{input("owner/support");choose(1,"public");});
  await act(async()=>container.querySelectorAll<HTMLInputElement>('input[type="checkbox"]')[0].click());
  await act(async()=>container.querySelectorAll<HTMLInputElement>('input[type="checkbox"]')[1].click());
  await act(async()=>{const b=button("Publish publicly");b.click();b.click();});
  expect(api.publish).toHaveBeenCalledExactlyOnceWith({workspaceId:"workspace-a",versionId:"v2",repositoryId:"owner/support",visibility:"public",createRepository:true,publicAccessConfirmed:true});
  await act(async()=>late.reject(new Error("private-token /secret/path"))); expect(notices()).toContain("Publication could not be confirmed"); expect(notices()).not.toContain("private-token");
  expect(container.querySelectorAll<HTMLInputElement>('input[type="checkbox"]')[1].checked).toBe(false);
 });
 it.each(["workspaceId","versionId","repositoryId","visibility"])("does not confirm a mismatched %s response",async field=>{
  const api=service(), original=api.publish; vi.mocked(api.publish).mockImplementation(async request=>({...await originalResult(request),[field]:"foreign"}) as any);
  async function originalResult(request:any) {return service().publish(request);}
  await render(api); await act(async()=>input("owner/support")); await act(async()=>button("Publish privately").click());
  expect(notices()).toContain("Publication could not be confirmed"); expect(notices()).not.toContain("Dataset published"); void original;
 });
 it("ignores late publication completion after scope change and unmount",async()=>{
  const api=service(), late=deferred<any>(); vi.mocked(api.publish).mockReturnValue(late.promise); await render(api);
  await act(async()=>input("owner/support")); await act(async()=>button("Publish privately").click());
  await render(api,{datasetArtifactKey:"data/v1.jsonl"}); await act(async()=>late.resolve(await service().publish({workspaceId:"workspace-a",versionId:"v2",repositoryId:"owner/support",visibility:"private"})));
  expect(notices()).not.toContain("Dataset published");
  const second=deferred<any>(); vi.mocked(api.publish).mockReturnValue(second.promise); await act(async()=>input("owner/support")); await act(async()=>button("Publish privately").click());
  await act(async()=>root!.unmount()); root=undefined; await act(async()=>second.reject(new Error("secret")));
 });
 it("does not confirm an old request after publication inputs change during flight",async()=>{
  const api=service(),late=deferred<any>();vi.mocked(api.publish).mockReturnValue(late.promise);await render(api);
  await act(async()=>input("owner/support"));await act(async()=>button("Publish privately").click());
  await act(async()=>input("owner/other"));await act(async()=>late.resolve(await service().publish({workspaceId:"workspace-a",versionId:"v2",repositoryId:"owner/support",visibility:"private"})));
  expect(notices()).not.toContain("Dataset published");expect(button("Publish privately").disabled).toBe(false);
 });
 it("only reports reuse after explicit applied acknowledgment and refuses mismatched reproduction",async()=>{
  const api=service(), reuse=vi.fn(async()=>false); await render(api,{onReuse:reuse}); await act(async()=>button("Use this setup again").click());
  expect(notices()).toContain("Saved setup was not applied"); expect(notices()).not.toContain("Saved setup loaded");
  expect(reuse).toHaveBeenCalledWith(expect.objectContaining({versionId:"v2"}),expect.objectContaining({workspaceId:"workspace-a",datasetArtifactKey:"data/v2.jsonl",selectedVersion:expect.objectContaining({versionId:"v2"})}));
  reuse.mockResolvedValue(true); await act(async()=>button("Use this setup again").click()); expect(notices()).toContain("Saved setup loaded");
  reuse.mockClear(); vi.mocked(api.reproduce).mockResolvedValue({versionId:"foreign"} as any); await act(async()=>button("Use this setup again").click()); expect(reuse).not.toHaveBeenCalled();
 });
});
