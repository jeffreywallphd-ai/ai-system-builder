// @vitest-environment jsdom
import { StrictMode, act, useLayoutEffect, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, expect, it } from "vitest";
import { NotificationProvider, useOptionalNotificationCenter } from "../../notifications/NotificationProvider";
import { useDatasetVersionReplayHandoff, useDatasetVersionReplayConsumer, type DatasetVersionReplayHandoff } from "../useDatasetVersionReplayHandoff";
import type { DatasetVersionRecord, DatasetVersionReproduction } from "../../../../contracts/dataset";
// Opaque coordinator sentinels only. Actual saved-settings validation is covered
// by the pure validator and real host journeys, not by these lifecycle fixtures.
function datasetVersionReplayFixture() {
  return { reproduction: { versionId: "v1" } as DatasetVersionReproduction,
    selection: { workspaceId: "workspace-a", datasetArtifactKey: "data/test.jsonl", selectedVersion: { versionId: "v1" } as DatasetVersionRecord } };
}
(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root | undefined, container: HTMLDivElement, handoff!: DatasetVersionReplayHandoff, navigate!: (active: boolean) => void;
let messages: readonly { message: string; workspaceId?: string }[] = [], calls = 0, order: string[] = [];
type Outcome = "yes" | "no" | "throw" | "async";
let finishAsync!: () => void, rejectAsync!: () => void;
function Notices() { messages = useOptionalNotificationCenter()!.state.records; return null; }
function Consumer({ status, outcome, cancelAfterCommit }: { status: "loading" | "ready" | "failed"; outcome: Outcome; cancelAfterCommit?: boolean }) {
  const [value, setValue] = useState("draft");
  const cancel = useDatasetVersionReplayConsumer(handoff, status, (_request, current) => { ++calls; if (outcome === "throw") throw new Error("private fixture detail"); if (outcome === "no") return false;
    if (outcome === "async") return new Promise<boolean>((resolve, reject) => { finishAsync = () => { if (!current()) { resolve(false); return; } setValue("saved"); resolve(true); }; rejectAsync = () => reject(new Error("private fixture detail")); });
    setValue("saved"); return true; });
  useLayoutEffect(() => { order.push(`commit:${value}`); if (value === "saved" && cancelAfterCommit) cancel(); }, [value, cancelAfterCommit]);
  return <div><span>{value}</span><button onClick={() => { cancel(); setValue("later edit"); }}>Edit form</button></div>;
}
function Harness({ workspaceId, consume, status, outcome, cancelAfterCommit }: { workspaceId: string; consume?: boolean; status: "loading" | "ready" | "failed"; outcome: Outcome; cancelAfterCommit?: boolean }) {
  const [active, setActive] = useState(false); navigate = setActive;
  handoff = useDatasetVersionReplayHandoff(workspaceId, active, () => setActive(true));
  return consume && active ? <Consumer status={status} outcome={outcome} cancelAfterCommit={cancelAfterCommit} /> : null;
}
async function render(options: { workspaceId?: string; consume?: boolean; status?: "loading" | "ready" | "failed"; outcome?: Outcome; strict?: boolean; cancelAfterCommit?: boolean } = {}) {
  if (!root) { container = document.createElement("div"); document.body.append(container); root = createRoot(container); }
  const body = <NotificationProvider><Notices /><Harness workspaceId={options.workspaceId ?? "workspace-a"} consume={options.consume} status={options.status ?? "loading"} outcome={options.outcome ?? "yes"} cancelAfterCommit={options.cancelAfterCommit}/></NotificationProvider>;
  await act(async () => root!.render(options.strict ? <StrictMode>{body}</StrictMode> : body));
}
afterEach(async () => { await act(async () => root?.unmount()); root = undefined; container?.remove(); calls = 0; order = []; messages = []; });
async function queue() { const f = datasetVersionReplayFixture(); let promise!: Promise<boolean>; await act(async () => { promise = handoff.enqueue(f.reproduction, f.selection); }); return { promise, request: handoff.request! }; }
it("queue and navigation remain unresolved until the exact consumer acknowledges", async () => {
  await render(); const result = await queue(), token = {}, other = {}; let settled = false; void result.promise.then(() => { settled = true; });
  expect(handoff.request).toBe(result.request); expect(settled).toBe(false); expect(messages).toHaveLength(0);
  expect(handoff.claim(result.request, undefined as unknown as object)).toBe(false);
  await act(async () => handoff.finish(result.request, undefined as unknown as object, true)); expect(settled).toBe(false);
  expect(handoff.claim(result.request, token)).toBe(true); expect(handoff.claim(result.request, other)).toBe(false);
  await act(async () => handoff.finish(result.request, other, true)); expect(settled).toBe(false);
  await act(async () => { handoff.finish(result.request, token, true); handoff.finish(result.request, token, true); });
  expect(await result.promise).toBe(true); expect(messages).toHaveLength(1); expect(messages[0].workspaceId).toBe("workspace-a");
});
it("a new request retires the old promise and old callbacks cannot complete the new request", async () => {
  await render(); const first = await queue(), a = {}; expect(handoff.claim(first.request, a)).toBe(true);
  const second = await queue(), b = {}; expect(await first.promise).toBe(false); expect(second.request.nonce).not.toBe(first.request.nonce);
  expect(handoff.isCurrent(first.request, a)).toBe(false);
  await act(async () => { handoff.finish(first.request, a, true); handoff.cancel(first.request, a); }); expect(handoff.request).toBe(second.request); expect(messages).toHaveLength(0);
  expect(handoff.claim(second.request, b)).toBe(true); await act(async () => handoff.finish(second.request, b, true)); expect(await second.promise).toBe(true); expect(messages).toHaveLength(1);
});
it.each(["workspace", "tab", "page"])("retires pending delivery on %s departure without success", async change => {
  await render(); const result = await queue(), token = {}; expect(handoff.claim(result.request, token)).toBe(true);
  if (change === "workspace") await render({ workspaceId: "workspace-b" });
  if (change === "tab") await act(async () => navigate(false));
  if (change === "page") { await act(async () => root!.unmount()); root = undefined; }
  expect(await result.promise).toBe(false); handoff.finish(result.request, token, true); expect(messages).toHaveLength(0);
});
it.each([false, true])("consumer acknowledgment follows the settings commit, strict=%s", async strict => {
  await render({ consume: true, status: "loading", strict }); const result = await queue(); expect(calls).toBe(0); expect(messages).toHaveLength(0);
  await render({ consume: true, status: "ready", strict }); expect(await result.promise).toBe(true); expect(calls).toBe(1); expect(container.textContent).toContain("saved"); expect(order).toContain("commit:saved"); expect(messages).toHaveLength(1);
});
it("a user edit while waiting retires delivery and later readiness cannot overwrite it", async () => {
  await render({ consume: true }); const result = await queue(); await act(async () => container.querySelector("button")!.click()); expect(await result.promise).toBe(false);
  await render({ consume: true, status: "ready" }); expect(container.textContent).toContain("later edit"); expect(calls).toBe(0); expect(messages).toHaveLength(0);
});
it.each(["failed", "declined", "exception"])("does not announce a %s application", async failure => {
  await render({ consume: true }); const result = await queue(); await render({ consume: true, status: failure === "failed" ? "failed" : "ready", outcome: failure === "exception" ? "throw" : "no" });
  expect(await result.promise).toBe(false); expect(messages).toHaveLength(0); expect(container.textContent).toContain("draft");
});
it("cancellation after application but before acknowledgment makes no success or rollback claim", async () => {
  await render({ consume: true }); const result = await queue(); await render({ consume: true, status: "ready", cancelAfterCommit: true });
  expect(await result.promise).toBe(false); expect(container.textContent).toContain("saved"); expect(messages).toHaveLength(0);
});
it("announces an async restore once only after its actual form commit", async () => {
  await render({ consume: true, status: "ready", outcome: "async" }); const result = await queue();
  expect(calls).toBe(1); expect(messages).toHaveLength(0); expect(container.textContent).toContain("draft");
  await act(async () => finishAsync()); expect(await result.promise).toBe(true); expect(order).toContain("commit:saved"); expect(messages).toHaveLength(1);
});
it.each(["edit", "unmount", "reject"])("retires async %s without a late write or success", async mode => {
  await render({ consume: true, status: "ready", outcome: "async" }); const result = await queue();
  if (mode === "edit") await act(async () => container.querySelector("button")!.click());
  if (mode === "unmount") { await act(async () => root!.unmount()); root = undefined; }
  await act(async () => mode === "reject" ? rejectAsync() : finishAsync());
  expect(await result.promise).toBe(false); expect(messages).toHaveLength(0);
  if (mode === "edit") expect(container.textContent).toContain("later edit");
});

it("captures a frozen request without retaining caller mutations", async () => {
 await render();const f=datasetVersionReplayFixture();let promise!:Promise<boolean>;
 await act(async()=>{promise=handoff.enqueue(f.reproduction,f.selection);});const request=handoff.request!;
 (f.reproduction as {versionId:string}).versionId="changed";f.selection.datasetArtifactKey="changed.jsonl";(f.selection.selectedVersion as {versionId:string}).versionId="changed";
 expect(request.reproduction.versionId).toBe("v1");expect(request.selection.datasetArtifactKey).toBe("data/test.jsonl");expect(request.selection.selectedVersion.versionId).toBe("v1");expect(Object.isFrozen(request.reproduction)).toBe(true);expect(Object.isFrozen(request.selection.selectedVersion)).toBe(true);
 const token={};expect(handoff.claim(request,token)).toBe(true);await act(async()=>handoff.finish(request,token,false));expect(await promise).toBe(false);
});
it.each(["accessor","large","undefined","foreign"])("refuses %s capture without opening a page or retiring an existing valid request",async mode=>{
 await render();const existing=await queue(), f=datasetVersionReplayFixture();let reads=0;
 if(mode==="accessor")Object.defineProperty(f.reproduction,"recipeSnapshot",{enumerable:true,get(){++reads;throw new Error("private");}});
 if(mode==="large")Object.assign(f.reproduction,{recipeSnapshot:{text:"x".repeat(1024*1024+1)}});
 if(mode==="undefined")Object.assign(f.reproduction,{recipeSnapshot:undefined});
 if(mode==="foreign")f.selection.workspaceId="workspace-b";
 expect(await handoff.enqueue(f.reproduction,f.selection)).toBe(false);expect(reads).toBe(0);expect(handoff.request).toBe(existing.request);expect(messages).toHaveLength(0);
 const token={};handoff.claim(existing.request,token);await act(async()=>handoff.cancel(existing.request,token));expect(await existing.promise).toBe(false);
});
