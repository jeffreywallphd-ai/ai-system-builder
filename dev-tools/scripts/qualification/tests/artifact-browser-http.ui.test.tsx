// @vitest-environment jsdom
import { act, startTransition, Suspense, useEffect, useLayoutEffect } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import express from "express";
import { createServer, type Server } from "node:http";
import { mkdtemp, lstat, realpath, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { ArtifactBrowserFeature } from "../../../../apps/thin-client/src/features/artifact-browser/components/ArtifactBrowserFeature";
import { createApiArtifactBrowserClient } from "../../../../apps/thin-client/src/features/artifact-browser/api/apiArtifactBrowserClient";
import { registerArtifactBrowserApiRoutes } from "../../../../modules/adapters/transport/api-express/artifact-browser";
import { BrowseArtifactsUseCase, ReadArtifactDetailUseCase, ReadArtifactContentUseCase, DeleteRegisteredArtifactUseCase } from "../../../../modules/application/use-cases";
import { createFilesystemArtifactObjectStorageAdapter, createFilesystemArtifactBrowserReadAdapter, createFilesystemArtifactContentRetrievalAdapter, createLocalArtifactCatalogPersistenceAdapter, createLocalArtifactStorageBindingAdapter } from "../../../../modules/adapters/storage/filesystem";
import { createStoreArtifactRequest, createRetrieveArtifactRequest } from "../../../../modules/contracts/storage";
import { createWorkspaceId } from "../../../../modules/contracts/workspace";
import { useArtifactBrowserFeature } from "../../../../apps/thin-client/src/features/artifact-browser/hooks/useArtifactBrowserFeature";
import { NotificationTestHarness, readNotificationMessages } from "../../../../modules/ui/shared/notifications/tests/NotificationTestHarness";

// Actual mounted browser UI -> default secure client -> owned HTTP routes ->
// application use cases -> local JSON catalog/bindings and filesystem bytes.
// Synthetic access admission and finite scheduling faults are fixtures. This is
// not a physical-browser, production-authentication, SQLite or provider test.
const workspaceId = createWorkspaceId("workspace.artifact-ui"), foreign = createWorkspaceId("workspace.artifact-ui-foreign");
const tokenKey = "ai-system-builder.paired-device-token", token = "synthetic-artifact-http-only";
const now = "2026-10-26T12:00:00.000Z";
let directory: string | undefined, identity: { dev: bigint; ino: bigint } | undefined;
let root: Root | undefined, container: HTMLDivElement | undefined, server: Server | undefined;
let catalog: ReturnType<typeof createLocalArtifactCatalogPersistenceAdapter>, storage: ReturnType<typeof createFilesystemArtifactObjectStorageAdapter>;
let client: ReturnType<typeof createApiArtifactBrowserClient>;
let priorToken: string | null | undefined, priorAct: PropertyDescriptor | undefined;
let gate: Promise<void> | undefined, release: (() => void) | undefined, denyDelete = false, deletes: string[] = [], requests = 0;
let deniedKey: string | undefined;
let readGate: Promise<void> | undefined, releaseRead: (() => void) | undefined, heldDetail: string | undefined, heldMedia: string | undefined, heldReads = 0;
const flights = new Set<Promise<unknown>>();
const formats = [
  ["notes.txt", "text/plain", "bounded text marker"],
  ["rows.csv", "text/csv", 'name,value\n"marker,first",42\nsecond,43'],
  ["record.json", "application/json", '{"marker":42}'],
  ["records.jsonl", "application/x-ndjson", '{"marker":42}\n{"marker":43}'],
  ["guide.md", "text/markdown", "# marker\n\n<script>window.syntheticExecuted=true</script>\n\n**Safe content**"],
] as const;
async function seed(name: string, mediaType: string, text: string, scope = workspaceId) {
  const key = `uploads/artifact-ui/${name}`;
  const result = await storage.storeArtifact(createStoreArtifactRequest(new Uint8Array(Buffer.from(text)), { descriptor: { key, mediaType, metadata: { originalFileName: name } } }), { workspaceId: scope });
  expect(result.ok).toBe(true); return key;
}
async function compose() {
  priorAct = Object.getOwnPropertyDescriptor(globalThis, "IS_REACT_ACT_ENVIRONMENT"); priorToken = localStorage.getItem(tokenKey);
  Object.defineProperty(globalThis, "IS_REACT_ACT_ENVIRONMENT", { configurable: true, writable: true, value: true }); localStorage.setItem(tokenKey, token);
  directory = await mkdtemp(path.join(await realpath(tmpdir()), "artifact-http-ui-")); const info = await lstat(directory, { bigint: true }); expect(info.ino).not.toBe(0n); identity = { dev: info.dev, ino: info.ino };
  catalog = createLocalArtifactCatalogPersistenceAdapter({ rootDirectory: directory });
  const bindings = createLocalArtifactStorageBindingAdapter({ rootDirectory: directory });
  storage = createFilesystemArtifactObjectStorageAdapter({ rootDirectory: directory, artifactCatalogAppend: catalog, now: () => now });
  const read = createFilesystemArtifactBrowserReadAdapter({ rootDirectory: directory, artifactCatalogRead: catalog, artifactCatalogAppend: catalog, artifactBindingRead: bindings, storage });
  const remove = new DeleteRegisteredArtifactUseCase({ artifactCatalogRead: catalog, artifactCatalogDelete: catalog, artifactBindingStorage: bindings, storage });
  const app = express(); app.use(express.json({ limit: "16kb", strict: true }));
  app.use((request, response, next) => {
    expect(++requests).toBeLessThanOrEqual(100);
    if (request.headers.authorization !== `Bearer ${token}`) { response.status(401).json({ ok: false, error: { code: "unauthenticated", message: "Synthetic access denied." } }); return; }
    if (request.path === "/api/artifact/delete") {
      deletes.push(request.body.locator?.storageKey); expect(deletes.length).toBeLessThanOrEqual(8);
      if (denyDelete || request.body.locator?.storageKey === deniedKey) { response.status(503).json({ ok: false, error: { code: "unavailable", message: "Synthetic delete unavailable." } }); return; }
    }
    next();
  });
  const detail = new ReadArtifactDetailUseCase({ artifactBrowserMetadataRead: read }), media = createFilesystemArtifactContentRetrievalAdapter({ storage, artifactCatalogRead: catalog });
  function track<T>(pending: Promise<T>): Promise<T> { flights.add(pending); void pending.then(() => flights.delete(pending), () => flights.delete(pending)); return pending; }
  registerArtifactBrowserApiRoutes({ app, browseArtifactsUseCase: new BrowseArtifactsUseCase({ artifactBrowserMetadataRead: read }), readArtifactDetailUseCase: { execute: (...args: Parameters<typeof detail.execute>) => track((async () => { const result = await detail.execute(...args); if (args[0].locator.storageKey === heldDetail) { heldReads++; await readGate; } return result; })()) }, readArtifactContentUseCase: new ReadArtifactContentUseCase({ artifactBrowserContentRead: read }), artifactMediaViewRetrieval: { retrieveArtifactViewerMediaByStorageKey: (...args: Parameters<typeof media.retrieveArtifactViewerMediaByStorageKey>) => track((async () => { const result = await media.retrieveArtifactViewerMediaByStorageKey(...args); if (args[0].storageKey === heldMedia) { heldReads++; await readGate; } return result; })()) }, deleteRegisteredArtifactUseCase: {
    execute: (...args: Parameters<typeof remove.execute>) => {
      const pending = (async () => { await gate; return remove.execute(...args); })(); flights.add(pending); void pending.then(() => flights.delete(pending), () => flights.delete(pending)); return pending;
    },
  } });
  server = createServer(app); await new Promise<void>((resolve, reject) => { server!.once("error", reject); server!.listen(0, "127.0.0.1", resolve); }); const address = server.address(); if (!address || typeof address === "string") throw new Error("Owned artifact listener unavailable.");
  client = createApiArtifactBrowserClient({ apiBaseUrl: `http://127.0.0.1:${address.port}/api` });
  container = document.createElement("div"); document.body.appendChild(container); root = createRoot(container);
}
async function mount(scope: string = workspaceId) { await act(async () => root!.render(<NotificationTestHarness><ArtifactBrowserFeature client={client} workspaceId={scope} /></NotificationTestHarness>)); }
function button(text: string) { const found = [...document.querySelectorAll<HTMLButtonElement>("button")].find(value => value.textContent?.trim() === text); expect(Boolean(found), `Button ${text}`).toBe(true); return found!; }
async function wait(predicate: () => boolean) { for (let i = 0; i < 200 && !predicate(); i++) await act(async () => { await new Promise(resolve => setTimeout(resolve, 10)); }); const safe = (value: string) => /[A-Za-z]:\\|token=|authorization|\/Users\//i.test(value) ? "private-text-withheld" : value.slice(0, 200); expect(predicate(), JSON.stringify({ requests, deletes: deletes.length, alerts: document.querySelectorAll('[role="alert"]').length, notifications: readNotificationMessages(document).map(safe), status: [...document.querySelectorAll('[role="status"],p')].slice(0, 5).map(value => safe(value.textContent ?? "")) })).toBe(true); }
async function input(placeholder: string, value: string) { const field = document.querySelector<HTMLInputElement>(`input[placeholder="${placeholder}"]`)!; expect(Boolean(field)).toBe(true); await act(async () => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(field, value); field.dispatchEvent(new Event("input", { bubbles: true })); }); }
async function choose(name: string) { await wait(() => [...document.querySelectorAll("button")].some(value => value.textContent?.trim() === name)); await act(async () => button(name).click()); await wait(() => document.body.textContent?.includes("Local Object State") === true); }
async function records() { const result = await catalog.browseArtifactCatalogRecords({ workspaceId }, { workspaceId }); expect(result.ok).toBe(true); if (!result.ok) throw new Error("Synthetic catalog read failed."); return result.value.records; }
afterEach(async () => {
  try {
    if (root) await act(async () => root!.unmount()); root = undefined; container?.remove(); container = undefined;
    await act(async () => { release?.(); releaseRead?.(); await Promise.allSettled([...flights]); });
    if (server) { const owned = server; await new Promise<void>((resolve, reject) => owned.close(error => error ? reject(error) : resolve())); expect(owned.listening).toBe(false); server = undefined; }
    if (directory) {
      const owned = directory, info = await lstat(owned, { bigint: true }); expect({ dev: info.dev, ino: info.ino }).toEqual(identity); expect(info.isDirectory() && !info.isSymbolicLink()).toBe(true); expect(await realpath(owned)).toBe(owned); expect(path.dirname(owned)).toBe(await realpath(tmpdir()));
      let entries = 0, bytes = 0; async function inspect(parent: string) { for (const name of await readdir(parent)) { const file = path.join(parent, name), entry = await lstat(file); expect(++entries).toBeLessThanOrEqual(256); expect(entry.isSymbolicLink()).toBe(false); if (entry.isDirectory()) await inspect(file); else { expect(entry.isFile()).toBe(true); bytes += entry.size; expect(bytes).toBeLessThanOrEqual(1024 * 1024); } } } await inspect(owned); await rm(owned, { recursive: true });
    }
  } finally {
    if (priorAct) Object.defineProperty(globalThis, "IS_REACT_ACT_ENVIRONMENT", priorAct); else Reflect.deleteProperty(globalThis, "IS_REACT_ACT_ENVIRONMENT");
    if (priorToken === null) localStorage.removeItem(tokenKey); else if (priorToken !== undefined) localStorage.setItem(tokenKey, priorToken);
    directory = undefined; identity = undefined; gate = undefined; release = undefined; readGate = undefined; releaseRead = undefined; heldDetail = heldMedia = deniedKey = undefined; heldReads = 0; denyDelete = false; deletes = []; requests = 0; flights.clear(); vi.restoreAllMocks();
  }
});
for (const [name, mediaType, text] of formats) it(`browser HTTP: previews exact stored ${name} content without active markup`, async () => {
  await compose(); const key = await seed(name, mediaType, text); await mount(); await choose(name); await wait(() => Boolean(document.querySelector('section[aria-label="Artifact preview"] pre, section[aria-label="Artifact preview"] table, section[aria-label="Artifact preview"] h1')));
  const preview = document.querySelector<HTMLElement>('section[aria-label="Artifact preview"]')!;
  if (name === "notes.txt") expect(preview.querySelector("pre")?.textContent).toBe("bounded text marker");
  if (name === "rows.csv") {
    expect([...preview.querySelectorAll("thead th")].map(value => value.textContent)).toEqual(["name", "value"]);
    expect([...preview.querySelectorAll("tbody tr")].map(row => [...row.querySelectorAll("td")].map(value => value.textContent))).toEqual([["marker,first", "42"], ["second", "43"]]);
  }
  if (name === "record.json") { const rendered = preview.querySelector("pre")?.textContent; expect(rendered).toBe('{\n  "marker": 42\n}'); expect(JSON.parse(rendered!)).toEqual({ marker: 42 }); }
  if (name === "records.jsonl") expect(preview.querySelector("pre")?.textContent).toBe('{\n  "marker": 42\n}\n{\n  "marker": 43\n}');
  if (name === "guide.md") { expect(preview.querySelector("h1")?.textContent).toBe("marker"); expect(preview.querySelector("strong")?.textContent).toBe("Safe content"); expect(preview.textContent).toContain("<script>window.syntheticExecuted=true</script>"); }
  expect(preview.querySelector("script,iframe,object,embed,[onerror],[onclick]")).toBeNull(); expect(Reflect.get(window, "syntheticExecuted")).toBeUndefined();
  const reopened = createFilesystemArtifactObjectStorageAdapter({ rootDirectory: directory! }); const result = await reopened.retrieveArtifact(createRetrieveArtifactRequest(key), { workspaceId }); expect(result.ok).toBe(true); if (!result.ok) throw new Error("Synthetic content did not reopen."); expect(Buffer.from(result.value.content)).toEqual(Buffer.from(text));
  expect(document.body.textContent).not.toContain(directory!);
});
it("browser HTTP: refresh hides internal +json metadata and preserves foreign workspace data", async () => {
  await compose(); const key = await seed("current.txt", "text/plain", "marker current"); await seed("private.txt", "text/plain", "foreign marker", foreign); await seed("internal.json", "application/vnd.synthetic+json", '{"hidden":true}');
  await mount(); await choose("current.txt"); expect(document.body.textContent).not.toContain("private.txt"); expect([...document.querySelectorAll("button")].some(value => value.textContent?.trim() === "internal.json")).toBe(false);
  await expect(client.readArtifactDetail({ storageKey: key }, { workspaceId: foreign })).rejects.toThrow();
  await seed("second.txt", "text/plain", "second marker"); await act(async () => button("Refresh").click()); await wait(() => [...document.querySelectorAll("button")].some(value => value.textContent?.trim() === "second.txt")); expect(document.body.textContent).toContain(key);
});
it("browser HTTP: exact typed single deletion admits one request before settlement", async () => {
  await compose(); const key = await seed("delete.txt", "text/plain", "delete marker"); await mount(); await choose("delete.txt"); await act(async () => button("Delete artifact").click());
  await input("Delete", "delete"); expect(button("Confirm delete").disabled).toBe(true); expect(deletes).toHaveLength(0); await input("Delete", "Delete");
  gate = new Promise(resolve => { release = resolve; }); await act(async () => { button("Confirm delete").click(); button("Confirm delete").click(); }); await wait(() => deletes.length > 0); expect(deletes).toEqual([key]);
  await act(async () => { release!(); await Promise.allSettled([...flights]); }); await wait(() => !document.querySelector('[role="dialog"]')); expect(await records()).toEqual([]); expect((await storage.retrieveArtifact(createRetrieveArtifactRequest(key), { workspaceId })).ok).toBe(false);
});
it("browser HTTP: a denied delete retains bytes and confirmation for an explicit successful retry", async () => {
  await compose(); const key = await seed("retry.txt", "text/plain", "retry marker"); await mount(); await choose("retry.txt"); await act(async () => button("Delete artifact").click()); await input("Delete", "Delete"); denyDelete = true; await act(async () => button("Confirm delete").click()); await wait(() => readNotificationMessages(document).includes("Synthetic delete unavailable."));
  expect(await records()).toHaveLength(1); expect((await storage.retrieveArtifact(createRetrieveArtifactRequest(key), { workspaceId })).ok).toBe(true); expect(document.querySelector<HTMLInputElement>('input[placeholder="Delete"]')?.value).toBe("Delete");
  denyDelete = false; await act(async () => button("Confirm delete").click()); await wait(() => !document.querySelector('[role="dialog"]')); expect(deletes).toEqual([key, key]); expect(await records()).toEqual([]);
});
it("browser HTTP: bulk deletion admits each selected artifact once before settlement", async () => {
  await compose(); const keys = [await seed("bulk-a.txt", "text/plain", "marker a"), await seed("bulk-b.txt", "text/plain", "marker b")]; await mount(); await wait(() => [...document.querySelectorAll("button")].some(value => value.textContent?.trim() === "bulk-b.txt"));
  const all = [...document.querySelectorAll<HTMLInputElement>('input[type="checkbox"]')].find(value => value.parentElement?.textContent?.includes("Select all artifacts"))!; expect(Boolean(all)).toBe(true); await act(async () => all.click()); await input("Delete All", "Delete All");
  gate = new Promise(resolve => { release = resolve; }); await act(async () => { button("Delete Selected (2)").click(); button("Delete Selected (2)").click(); }); await wait(() => deletes.length >= 2); expect([...deletes].sort()).toEqual([...keys].sort());
  await act(async () => { release!(); await Promise.allSettled([...flights]); }); await wait(() => readNotificationMessages(document).includes("Deleted 2 artifact(s).")); expect(await records()).toEqual([]);
});
it("browser HTTP: workspace replacement retires old typed deletion and selection", async () => {
  await compose(); const key = await seed("shared.txt", "text/plain", "current marker"); const foreignKey = await seed("foreign.txt", "text/plain", "foreign marker", foreign); await mount(); await choose("shared.txt");
  const all = [...document.querySelectorAll<HTMLInputElement>('input[type="checkbox"]')].find(value => value.parentElement?.textContent?.includes("Select all artifacts"))!; await act(async () => all.click()); await input("Delete All", "Delete All"); await act(async () => button("Delete artifact").click()); await input("Delete", "Delete");
  await mount(foreign); await wait(() => [...document.querySelectorAll("button")].some(value => value.textContent?.trim() === "foreign.txt"));
  expect(document.querySelector('[role="dialog"]')).toBeNull(); expect(document.querySelector<HTMLInputElement>('input[placeholder="Delete All"]')?.value).toBe(""); expect(document.body.textContent).not.toContain("Local Object State"); expect(deletes).toHaveLength(0);
  expect((await storage.retrieveArtifact(createRetrieveArtifactRequest(key), { workspaceId })).ok).toBe(true); expect((await storage.retrieveArtifact(createRetrieveArtifactRequest(foreignKey), { workspaceId: foreign })).ok).toBe(true);
});
it("browser HTTP: an older detail reply cannot replace a newer selection", async () => {
  await compose(); heldDetail = await seed("old.txt", "text/plain", "old marker"); await seed("new.txt", "text/plain", "new marker"); readGate = new Promise(resolve => { releaseRead = resolve; }); await mount(); await wait(() => [...document.querySelectorAll("button")].some(value => value.textContent?.trim() === "old.txt")); await act(async () => button("old.txt").click()); await wait(() => heldReads === 1);
  await choose("new.txt"); await wait(() => document.body.textContent?.includes("new marker") === true); await act(async () => { releaseRead!(); await Promise.allSettled([...flights]); }); await wait(() => flights.size === 0); expect(document.body.textContent).toContain("new marker"); expect(document.body.textContent).not.toContain("old marker");
});
it("browser HTTP: an old workspace detail reply cannot reopen its preview", async () => {
  await compose(); heldDetail = await seed("old.txt", "text/plain", "old marker"); await seed("foreign.txt", "text/plain", "foreign marker", foreign); readGate = new Promise(resolve => { releaseRead = resolve; }); await mount(); await wait(() => [...document.querySelectorAll("button")].some(value => value.textContent?.trim() === "old.txt")); await act(async () => button("old.txt").click()); await wait(() => heldReads === 1);
  await mount(foreign); await wait(() => [...document.querySelectorAll("button")].some(value => value.textContent?.trim() === "foreign.txt")); await act(async () => { releaseRead!(); await Promise.allSettled([...flights]); }); expect(document.body.textContent).not.toContain("Local Object State"); expect(document.body.textContent).not.toContain("old marker");
});
it("browser HTTP: delayed preview bytes cannot hide a delete failure", async () => {
  await compose(); heldMedia = await seed("held.txt", "text/plain", "held marker"); readGate = new Promise(resolve => { releaseRead = resolve; }); await mount(); await choose("held.txt"); await wait(() => heldReads === 1); await act(async () => button("Delete artifact").click()); await input("Delete", "Delete"); denyDelete = true; await act(async () => button("Confirm delete").click()); await wait(() => readNotificationMessages(document).includes("Synthetic delete unavailable."));
  await act(async () => { releaseRead!(); await Promise.allSettled([...flights]); }); expect(readNotificationMessages(document)).toContain("Synthetic delete unavailable."); expect(document.querySelector<HTMLInputElement>('input[placeholder="Delete"]')?.value).toBe("Delete"); expect(button("Confirm delete").disabled).toBe(false); expect(await records()).toHaveLength(1);
});
it("browser HTTP: an accepted old-workspace delete cannot refresh or notify the new workspace", async () => {
  await compose(); const key = await seed("old-delete.txt", "text/plain", "old marker"); const otherKey = await seed("foreign.txt", "text/plain", "foreign marker", foreign); await mount(); await choose("old-delete.txt"); await act(async () => button("Delete artifact").click()); await input("Delete", "Delete"); gate = new Promise(resolve => { release = resolve; }); await act(async () => button("Confirm delete").click()); await wait(() => deletes.length === 1);
  await mount(foreign); await wait(() => [...document.querySelectorAll("button")].some(value => value.textContent?.trim() === "foreign.txt")); await act(async () => { release!(); await Promise.allSettled([...flights]); }); expect(readNotificationMessages(document)).not.toContain(`Deleted ${key}.`); expect(document.body.textContent).not.toContain("old-delete.txt"); expect((await storage.retrieveArtifact(createRetrieveArtifactRequest(otherKey), { workspaceId: foreign })).ok).toBe(true);
});
it("browser HTTP: partial bulk failure waits for every request and retries only the failed artifact", async () => {
  await compose(); const first = await seed("partial-a.txt", "text/plain", "marker a"); deniedKey = await seed("partial-b.txt", "text/plain", "marker b"); const second = deniedKey; await mount(); await choose("partial-a.txt");
  const all = [...document.querySelectorAll<HTMLInputElement>('input[type="checkbox"]')].find(value => value.parentElement?.textContent?.includes("Select all artifacts"))!; await act(async () => all.click()); await input("Delete All", "Delete All");
  gate = new Promise(resolve => { release = resolve; }); await act(async () => button("Delete Selected (2)").click()); await wait(() => deletes.length === 2); expect(button("Delete Selected (2)").disabled).toBe(true); await act(async () => button("Delete Selected (2)").click()); expect(deletes).toHaveLength(2);
  await act(async () => { release!(); await Promise.allSettled([...flights]); }); await wait(() => readNotificationMessages(document).includes("Synthetic delete unavailable.")); expect((await records()).map(value => value.storageKey)).toEqual([second]); expect(document.body.textContent).not.toContain("Local Object State"); expect(button("Delete Selected (1)").disabled).toBe(false);
  deniedKey = undefined; gate = undefined; await act(async () => button("Delete Selected (1)").click()); await wait(() => readNotificationMessages(document).includes("Deleted 1 artifact(s).")); expect(deletes.filter(value => value === first)).toHaveLength(1); expect(deletes.filter(value => value === second)).toHaveLength(2); expect(await records()).toEqual([]);
});
it("browser lifecycle: layout retirement prevents a held detail from issuing another content request", async () => {
  await compose(); const key = await seed("retired.txt", "text/plain", "retired marker"); const snapshot = await client.readArtifactDetail({ storageKey: key }, { workspaceId });
  const held = new Promise<typeof snapshot>(resolve => { releaseRead = () => resolve(snapshot); }); client = { ...client, readArtifactDetail: () => held }; const content = vi.spyOn(client, "readArtifactContent");
  let feature: ReturnType<typeof useArtifactBrowserFeature> | undefined, passiveRetired = false;
  function FeatureProbe() { const value = useArtifactBrowserFeature(client, workspaceId); useLayoutEffect(() => { feature = value; }); return null; }
  function RetirementProbe({ replaced }: { replaced: boolean }) { useEffect(() => () => { passiveRetired = true; }, []); useLayoutEffect(() => { if (!replaced) return; releaseRead!(); const deadline = performance.now() + 15; while (performance.now() < deadline) { /* bounded scheduler yield */ } }, [replaced]); return null; }
  await act(async () => root!.render(<><RetirementProbe key="old" replaced={false} /><FeatureProbe /></>)); const pending = feature!.selectArtifact(key); flights.add(pending); expect(content).not.toHaveBeenCalled();
  Object.defineProperty(globalThis, "IS_REACT_ACT_ENVIRONMENT", { configurable: true, writable: true, value: false });
  try { root!.render(<RetirementProbe key="new" replaced />); const deadline = performance.now() + 2000; while (!passiveRetired && performance.now() < deadline) await new Promise(resolve => setTimeout(resolve, 10)); }
  finally { Object.defineProperty(globalThis, "IS_REACT_ACT_ENVIRONMENT", { configurable: true, writable: true, value: true }); }
  await pending; flights.delete(pending); expect(passiveRetired).toBe(true); expect(content).not.toHaveBeenCalled();
});
it("browser lifecycle: a suspended replacement keeps the committed workspace usable", async () => {
  await compose(); heldDetail = await seed("committed.txt", "text/plain", "committed marker"); await seed("foreign.txt", "text/plain", "foreign marker", foreign); readGate = new Promise(resolve => { releaseRead = resolve; });
  let attempted = false, resume: (() => void) | undefined; const suspended = new Promise<void>(resolve => { resume = resolve; });
  function Pause({ enabled }: { enabled: boolean }) { if (enabled) { attempted = true; throw suspended; } return null; }
  function Shell({ scope, pause = false }: { scope: string; pause?: boolean }) { return <NotificationTestHarness><Suspense fallback={<p>Replacement pending</p>}><ArtifactBrowserFeature client={client} workspaceId={scope} /><Pause enabled={pause} /></Suspense></NotificationTestHarness>; }
  await act(async () => root!.render(<Shell scope={workspaceId} />)); await wait(() => [...document.querySelectorAll("button")].some(value => value.textContent?.trim() === "committed.txt")); await act(async () => button("committed.txt").click()); await wait(() => heldReads === 1);
  await act(async () => startTransition(() => root!.render(<Shell scope={foreign} pause />))); expect(attempted).toBe(true); expect(document.body.textContent).not.toContain("Replacement pending"); await act(async () => { releaseRead!(); await Promise.allSettled([...flights]); }); await wait(() => document.body.textContent?.includes("committed marker") === true);
  await act(async () => root!.render(<Shell scope={workspaceId} />)); resume!();
});
