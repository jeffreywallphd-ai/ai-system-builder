// @vitest-environment jsdom
import { act, startTransition, Suspense, useEffect, useLayoutEffect } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import { mkdtemp, lstat, realpath, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { ArtifactBrowserFeature } from "../../../../apps/desktop/src/renderer/features/artifact-browser/components/ArtifactBrowserFeature";
import { createDesktopArtifactBrowserClient } from "../../../../apps/desktop/src/renderer/features/artifact-browser/api/desktopArtifactBrowserClient";
import { registerArtifactBrowserIpc } from "../../../../modules/adapters/transport/ipc-electron/artifact-browser";
import { createDesktopPreloadApi } from "../../../../apps/desktop/src/preload/exposedApi";
import type { IpcMainHandleListener, IpcMainHandlePort } from "../../../../modules/adapters/transport/ipc-electron/ipcMainHandlePort";
import { createContractError, createFailureResult } from "../../../../modules/contracts/shared";
import { BrowseArtifactsUseCase, ReadArtifactDetailUseCase, ReadArtifactContentUseCase, DeleteRegisteredArtifactUseCase, BrowseUnregisteredArtifactsUseCase, RegisterUnregisteredArtifactUseCase, DeleteUnregisteredArtifactUseCase } from "../../../../modules/application/use-cases";
import { createFilesystemArtifactObjectStorageAdapter, createFilesystemArtifactBrowserReadAdapter, createFilesystemArtifactContentRetrievalAdapter, createLocalArtifactCatalogPersistenceAdapter, createLocalArtifactStorageBindingAdapter } from "../../../../modules/adapters/storage/filesystem";
import { createStoreArtifactRequest, createRetrieveArtifactRequest } from "../../../../modules/contracts/storage";
import { createWorkspaceId } from "../../../../modules/contracts/workspace";
import { NotificationTestHarness, readNotificationMessages } from "../../../../modules/ui/shared/notifications/tests/NotificationTestHarness";

// Actual mounted desktop UI -> default client -> real preload and registered
// handlers -> application use cases -> JSON catalog/bindings/filesystem bytes.
// Sender trust, disabled providers/settings and finite scheduling are fixtures.
// This is not a physical Electron/security, SQLite/restart or provider pass.
const workspaceId = createWorkspaceId("workspace.artifact-ui"), foreign = createWorkspaceId("workspace.artifact-ui-foreign");
const now = "2026-10-26T12:00:00.000Z";
let directory: string | undefined, identity: { dev: bigint; ino: bigint } | undefined;
let root: Root | undefined, container: HTMLDivElement | undefined;
let catalog: ReturnType<typeof createLocalArtifactCatalogPersistenceAdapter>, storage: ReturnType<typeof createFilesystemArtifactObjectStorageAdapter>;
let client: ReturnType<typeof createDesktopArtifactBrowserClient>;
let priorApi: PropertyDescriptor | undefined, priorAct: PropertyDescriptor | undefined;
let gate: Promise<void> | undefined, release: (() => void) | undefined, denyDelete = false, deletes: string[] = [], requests = 0;
let deniedKey: string | undefined;
let readGate: Promise<void> | undefined, releaseRead: (() => void) | undefined, heldDetail: string | undefined, heldMedia: string | undefined, heldReads = 0;
let holdInitialBrowse = false;
const contentRequests: string[] = [];
const flights = new Set<Promise<unknown>>();
const formats = [
  ["notes.txt", "text/plain", "bounded text marker"],
  ["rows.csv", "text/csv", 'name,value\n"marker,first",42\nsecond,43'],
  ["record.json", "application/json", '{"marker":42}'],
  ["records.jsonl", "application/x-ndjson", '{"marker":42}\n{"marker":43}'],
  ["guide.md", "text/markdown", "# marker\n\n<script>window.syntheticExecuted=true</script>\n\n**Safe content**"],
] as const;
async function seed(name: string, mediaType: string, text: string, scope = workspaceId, storageKind = "uploads") {
  const key = `${storageKind}/artifact-ui/${name}`;
  const result = await storage.storeArtifact(createStoreArtifactRequest(new Uint8Array(Buffer.from(text)), { descriptor: { key, mediaType, metadata: { originalFileName: name } } }), { workspaceId: scope });
  expect(result.ok).toBe(true); return key;
}
async function compose() {
  priorAct = Object.getOwnPropertyDescriptor(globalThis, "IS_REACT_ACT_ENVIRONMENT"); priorApi = Object.getOwnPropertyDescriptor(window, "desktopApi");
  Object.defineProperty(globalThis, "IS_REACT_ACT_ENVIRONMENT", { configurable: true, writable: true, value: true });
  directory = await mkdtemp(path.join(await realpath(tmpdir()), "artifact-desktop-ui-")); const info = await lstat(directory, { bigint: true }); expect(info.ino).not.toBe(0n); identity = { dev: info.dev, ino: info.ino };
  catalog = createLocalArtifactCatalogPersistenceAdapter({ rootDirectory: directory });
  const bindings = createLocalArtifactStorageBindingAdapter({ rootDirectory: directory });
  storage = createFilesystemArtifactObjectStorageAdapter({ rootDirectory: directory, artifactCatalogAppend: catalog, now: () => now });
  const read = createFilesystemArtifactBrowserReadAdapter({ rootDirectory: directory, artifactCatalogRead: catalog, artifactCatalogAppend: catalog, artifactBindingRead: bindings, storage });
  const remove = new DeleteRegisteredArtifactUseCase({ artifactCatalogRead: catalog, artifactCatalogDelete: catalog, artifactBindingStorage: bindings, storage });
  const detail = new ReadArtifactDetailUseCase({ artifactBrowserMetadataRead: read }), media = createFilesystemArtifactContentRetrievalAdapter({ storage, artifactCatalogRead: catalog });
  function track<T>(pending: Promise<T>): Promise<T> { flights.add(pending); void pending.then(() => flights.delete(pending), () => flights.delete(pending)); return pending; }
  const event = Object.freeze({ syntheticOwnedArtifactSender: true }), handlers = new Map<string, IpcMainHandleListener>();
  const ipcMain: IpcMainHandlePort = { handle<TRequest, TResponse>(channel: string, handler: IpcMainHandleListener<TRequest, TResponse>) { expect(handlers.has(channel)).toBe(false); handlers.set(channel, (sender, request) => handler(sender, request as TRequest)); } };
  const unavailable = { execute: async () => ({ ok: false as const, error: { code: "unavailable" as const, message: "Synthetic provider disabled." } }) };
  const browse = new BrowseArtifactsUseCase({ artifactBrowserMetadataRead: read }), content = new ReadArtifactContentUseCase({ artifactBrowserContentRead: read });
  registerArtifactBrowserIpc({ ipcMain, senderTrust: { isTrustedSender: sender => sender === event }, getHuggingFaceTokenStatus: () => ({ configured: false }), setHuggingFaceToken: () => { throw new Error("Synthetic credential write disabled."); }, clearHuggingFaceToken: () => { throw new Error("Synthetic credential write disabled."); },
    browseArtifactsUseCase: { execute: (...args: Parameters<typeof browse.execute>) => track((async () => { const result = await browse.execute(...args); if (holdInitialBrowse && !args[0].artifactFamily) { holdInitialBrowse = false; heldReads++; await readGate; } return result; })()) },
    browseUnregisteredArtifactsUseCase: new BrowseUnregisteredArtifactsUseCase({ artifactBrowserUnregistered: read }), registerUnregisteredArtifactUseCase: new RegisterUnregisteredArtifactUseCase({ artifactBrowserUnregistered: read }), deleteUnregisteredArtifactUseCase: new DeleteUnregisteredArtifactUseCase({ artifactBrowserUnregistered: read }),
    readArtifactDetailUseCase: { execute: (...args: Parameters<typeof detail.execute>) => track((async () => { const result = await detail.execute(...args); if (args[0].locator.storageKey === heldDetail) { heldReads++; await readGate; } return result; })()) },
    readArtifactContentUseCase: { execute: (...args: Parameters<typeof content.execute>) => { contentRequests.push(args[0].locator.storageKey); return track(content.execute(...args)); } }, artifactMediaViewRetrieval: { retrieveArtifactViewerMediaByStorageKey: (...args: Parameters<typeof media.retrieveArtifactViewerMediaByStorageKey>) => track((async () => { const result = await media.retrieveArtifactViewerMediaByStorageKey(...args); if (args[0].storageKey === heldMedia) { heldReads++; await readGate; } return result; })()) },
    deleteRegisteredArtifactUseCase: { execute: (...args: Parameters<typeof remove.execute>) => track((async () => { deletes.push(args[0].storageKey); expect(deletes.length).toBeLessThanOrEqual(8); if (denyDelete) return createFailureResult(createContractError("unavailable", "Synthetic delete unavailable.")); await gate; return remove.execute(...args); })()) },
    publishArtifactToRepoUseCase: unavailable, browseHuggingFaceNamespaceDatasetsUseCase: unavailable, browseHuggingFaceDatasetParquetFilesUseCase: unavailable, importHuggingFaceFilesUseCase: unavailable, verifyPublishedArtifactBackingUseCase: unavailable, verifyImportedArtifactSourceBackingUseCase: unavailable, registerArtifactFromRepoUseCase: unavailable, localizeArtifactFromRepoUseCase: unavailable,
  });
  const api = createDesktopPreloadApi({ ipcRenderer: { invoke: (channel, request) => { expect(++requests).toBeLessThanOrEqual(100); const handler = handlers.get(channel); if (!handler) return Promise.reject(new Error("Synthetic optional settings unavailable.")); return track(Promise.resolve(handler(event, request))); } } });
  Object.defineProperty(window, "desktopApi", { configurable: true, writable: true, value: api }); client = createDesktopArtifactBrowserClient();
  container = document.createElement("div"); document.body.appendChild(container); root = createRoot(container);
}
async function mount(scope: string = workspaceId) { await act(async () => root!.render(<NotificationTestHarness><ArtifactBrowserFeature client={client} workspaceId={scope} /></NotificationTestHarness>)); }
function button(text: string) { const found = [...document.querySelectorAll<HTMLButtonElement>("button")].find(value => value.textContent?.trim() === text); expect(Boolean(found), `Button ${text}`).toBe(true); return found!; }
async function wait(predicate: () => boolean) { for (let i = 0; i < 200 && !predicate(); i++) await act(async () => { await new Promise(resolve => setTimeout(resolve, 10)); }); const safe = (value: string) => /[A-Za-z]:\\|token=|authorization|\/Users\//i.test(value) ? "private-text-withheld" : value.slice(0, 200); expect(predicate(), JSON.stringify({ requests, deletes: deletes.length, alerts: document.querySelectorAll('[role="alert"]').length, notifications: readNotificationMessages(document).map(safe), status: [...document.querySelectorAll('[role="status"],p')].slice(0, 5).map(value => safe(value.textContent ?? "")) })).toBe(true); }
async function input(placeholder: string, value: string) { const field = document.querySelector<HTMLInputElement>(`input[placeholder="${placeholder}"]`)!; expect(Boolean(field)).toBe(true); await act(async () => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(field, value); field.dispatchEvent(new Event("input", { bubbles: true })); }); }
function card(name: string) { return [...document.querySelectorAll<HTMLElement>("article")].find(value => value.querySelector("h4")?.textContent === name); }
async function choose(name: string) { await wait(() => Boolean(card(name))); const view = [...card(name)!.querySelectorAll<HTMLButtonElement>("button")].find(value => value.textContent?.trim() === "View Details")!; expect(Boolean(view)).toBe(true); await act(async () => view.click()); await wait(() => document.body.textContent?.includes("Local Object State") === true); }
async function records() { const result = await catalog.browseArtifactCatalogRecords({ workspaceId }, { workspaceId }); expect(result.ok).toBe(true); if (!result.ok) throw new Error("Synthetic catalog read failed."); return result.value.records; }
afterEach(async () => {
  try {
    if (root) await act(async () => root!.unmount()); root = undefined; container?.remove(); container = undefined;
    await act(async () => { release?.(); releaseRead?.(); await Promise.allSettled([...flights]); });
    if (directory) {
      const owned = directory, info = await lstat(owned, { bigint: true }); expect({ dev: info.dev, ino: info.ino }).toEqual(identity); expect(info.isDirectory() && !info.isSymbolicLink()).toBe(true); expect(await realpath(owned)).toBe(owned); expect(path.dirname(owned)).toBe(await realpath(tmpdir()));
      let entries = 0, bytes = 0; async function inspect(parent: string) { for (const name of await readdir(parent)) { const file = path.join(parent, name), entry = await lstat(file); expect(++entries).toBeLessThanOrEqual(256); expect(entry.isSymbolicLink()).toBe(false); if (entry.isDirectory()) await inspect(file); else { expect(entry.isFile()).toBe(true); bytes += entry.size; expect(bytes).toBeLessThanOrEqual(1024 * 1024); } } } await inspect(owned); await rm(owned, { recursive: true });
    }
  } finally {
    if (priorAct) Object.defineProperty(globalThis, "IS_REACT_ACT_ENVIRONMENT", priorAct); else Reflect.deleteProperty(globalThis, "IS_REACT_ACT_ENVIRONMENT");
    if (priorApi) Object.defineProperty(window, "desktopApi", priorApi); else Reflect.deleteProperty(window, "desktopApi");
    directory = undefined; identity = undefined; gate = undefined; release = undefined; readGate = undefined; releaseRead = undefined; heldDetail = heldMedia = deniedKey = undefined; heldReads = 0; holdInitialBrowse = false; contentRequests.length = 0; denyDelete = false; deletes = []; requests = 0; flights.clear(); vi.restoreAllMocks();
  }
});
for (const [name, mediaType, text] of formats) it(`desktop preload: previews exact stored ${name} content without active markup`, async () => {
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
it("desktop preload: exact typed deletion admits one current request", async () => {
  await compose(); const key = await seed("delete.txt", "text/plain", "delete marker"); await mount(); await choose("delete.txt"); await act(async () => button("Delete registered artifact").click()); await input("Delete", "delete"); expect(button("Confirm delete").disabled).toBe(true); await input("Delete", "Delete");
  gate = new Promise(resolve => { release = resolve; }); const confirm = button("Confirm delete"); await act(async () => { confirm.click(); confirm.click(); }); await wait(() => deletes.length > 0); expect(deletes).toEqual([key]);
  await act(async () => { release!(); await Promise.allSettled([...flights]); }); await wait(() => readNotificationMessages(document).includes(`Deleted ${key}.`)); expect(await records()).toEqual([]); expect((await storage.retrieveArtifact(createRetrieveArtifactRequest(key), { workspaceId })).ok).toBe(false); expect(document.querySelector('[role="dialog"]')).toBeNull();
});
for (const reselectDeleted of [false, true]) it(`desktop preload: a completed delete keeps a newer ${reselectDeleted ? "same-key" : "different-key"} selection in the same workspace`, async () => {
  await compose(); const old = await seed("old-delete.txt", "text/plain", "old marker"); const other = await seed("new.txt", "text/plain", "new selection content"); await mount(); await choose("old-delete.txt");
  await act(async () => button("Delete registered artifact").click()); await input("Delete", "Delete"); gate = new Promise(resolve => { release = resolve; }); await act(async () => button("Confirm delete").click()); await wait(() => deletes.length === 1);
  await act(async () => button("Cancel").click()); await act(async () => document.querySelector<HTMLButtonElement>('[aria-label="Close detail and preview"]')!.click()); await choose("new.txt"); await wait(() => document.querySelector('[aria-label="Artifact preview"] pre')?.textContent === "new selection content");
  if (reselectDeleted) { await act(async () => document.querySelector<HTMLButtonElement>('[aria-label="Close detail and preview"]')!.click()); await choose("old-delete.txt"); await wait(() => document.querySelector('[aria-label="Artifact preview"] pre')?.textContent === "old marker"); }
  await act(async () => { release!(); await Promise.allSettled([...flights]); }); await wait(() => readNotificationMessages(document).includes(`Deleted ${old}.`));
  expect(document.querySelector('[aria-label="Artifact preview"] pre')?.textContent).toBe(reselectDeleted ? "old marker" : "new selection content"); expect(document.querySelector('[role="dialog"]')).not.toBeNull(); expect((await storage.retrieveArtifact(createRetrieveArtifactRequest(other), { workspaceId })).ok).toBe(true); expect((await storage.retrieveArtifact(createRetrieveArtifactRequest(old), { workspaceId })).ok).toBe(false);
});
for (const typeFilter of [true, false]) it(`desktop preload: deletion refreshes the current ${typeFilter ? "type" : "storage"} filter`, async () => {
  await compose(); const key = await seed("delete.csv", "text/csv", "name,value\ndelete,1"); await seed("keep.csv", "text/csv", "name,value\nkeep,2"); await seed("output.json", "application/json", '{"value":3}', workspaceId, "generated"); await mount(); await choose("delete.csv");
  await act(async () => button("Delete registered artifact").click()); await input("Delete", "Delete"); gate = new Promise(resolve => { release = resolve; }); await act(async () => button("Confirm delete").click()); await wait(() => deletes.length === 1);
  await act(async () => button("Cancel").click()); await act(async () => document.querySelector<HTMLButtonElement>('[aria-label="Close detail and preview"]')!.click()); await filter(typeFilter ? "tabular" : "uploaded", typeFilter ? "tabular" : "uploaded"); await wait(() => names().length === 2); expect(names()).toEqual(["delete.csv", "keep.csv"]);
  await act(async () => { release!(); await Promise.allSettled([...flights]); }); await wait(() => readNotificationMessages(document).includes(`Deleted ${key}.`)); expect(names()).toEqual(["keep.csv"]); expect((await storage.retrieveArtifact(createRetrieveArtifactRequest(key), { workspaceId })).ok).toBe(false);
});
it("desktop preload: refused deletion keeps exact confirmation for retry", async () => {
  await compose(); const key = await seed("retry.txt", "text/plain", "retry marker"); await mount(); await choose("retry.txt"); await act(async () => button("Delete registered artifact").click()); await input("Delete", "Delete"); denyDelete = true; await act(async () => button("Confirm delete").click()); await wait(() => readNotificationMessages(document).includes("Synthetic delete unavailable."));
  expect(await records()).toHaveLength(1); expect(document.querySelector<HTMLInputElement>('input[placeholder="Delete"]')?.value).toBe("Delete"); denyDelete = false; await act(async () => button("Confirm delete").click()); await wait(() => readNotificationMessages(document).includes(`Deleted ${key}.`)); expect(await records()).toEqual([]);
});
it("desktop preload: changing workspace clears old confirmation and data", async () => {
  await compose(); const key = await seed("current.txt", "text/plain", "current marker"); const otherKey = await seed("foreign.txt", "text/plain", "foreign marker", foreign); await mount(); await choose("current.txt"); await act(async () => button("Delete registered artifact").click()); await input("Delete", "Delete"); await mount(foreign); await wait(() => Boolean(card("foreign.txt")));
  expect(document.querySelector<HTMLInputElement>('input[placeholder="Delete"]')).toBeNull(); expect(document.body.textContent).not.toContain("current marker"); expect(deletes).toHaveLength(0); expect((await storage.retrieveArtifact(createRetrieveArtifactRequest(key), { workspaceId })).ok).toBe(true); expect((await storage.retrieveArtifact(createRetrieveArtifactRequest(otherKey), { workspaceId: foreign })).ok).toBe(true);
});
async function filter(option: string, value: string) { const select = [...document.querySelectorAll<HTMLSelectElement>("select")].find(item => [...item.options].some(item => item.value === option))!; expect(Boolean(select)).toBe(true); await act(async () => { Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value")!.set!.call(select, value); select.dispatchEvent(new Event("change", { bubbles: true })); }); }
function names() { return [...document.querySelectorAll<HTMLElement>("article h4")].map(value => value.textContent).sort(); }
it("desktop preload: actual type/storage filters and refresh retain only public current data", async () => {
  await compose(); const key = await seed("notes.txt", "text/plain", "marker notes"); await seed("rows.csv", "text/csv", "name,value\nmarker,42"); await seed("output.json", "application/json", '{"marker":43}', workspaceId, "generated"); await seed("internal.json", "application/vnd.synthetic+json", '{"private":true}'); await seed("foreign.txt", "text/plain", "foreign marker", foreign);
  await mount(); await wait(() => names().length === 3); expect(names()).toEqual(["notes.txt", "output.json", "rows.csv"]); await expect(client.readArtifactDetail({ storageKey: key }, { workspaceId: foreign })).rejects.toThrow();
  await filter("tabular", "tabular"); await wait(() => names().length === 1); expect(names()).toEqual(["rows.csv"]); await filter("tabular", "all"); await filter("uploaded", "generated"); await wait(() => names().length === 1 && names()[0] === "output.json");
  await filter("uploaded", "uploaded"); await wait(() => names().length === 2); expect(names()).toEqual(["notes.txt", "rows.csv"]); await seed("new.txt", "text/plain", "new marker"); await act(async () => button("Refresh").click()); await wait(() => names().length === 3); expect(names()).toEqual(["new.txt", "notes.txt", "rows.csv"]);
});
it("desktop preload: a delayed list cannot undo the current type filter", async () => {
  await compose(); await seed("notes.txt", "text/plain", "marker notes"); await seed("rows.csv", "text/csv", "name,value\nmarker,42"); holdInitialBrowse = true; readGate = new Promise(resolve => { releaseRead = resolve; }); await mount(); await wait(() => heldReads === 1); await filter("tabular", "tabular"); await wait(() => names().length === 1); expect(names()).toEqual(["rows.csv"]);
  await act(async () => { releaseRead!(); await Promise.allSettled([...flights]); }); expect(names()).toEqual(["rows.csv"]);
});
it("desktop preload: a delayed detail cannot replace the new selection", async () => {
  await compose(); heldDetail = await seed("old.txt", "text/plain", "old marker"); await seed("new.txt", "text/plain", "new marker"); readGate = new Promise(resolve => { releaseRead = resolve; }); await mount(); await wait(() => Boolean(card("old.txt"))); await act(async () => [...card("old.txt")!.querySelectorAll<HTMLButtonElement>("button")].find(value => value.textContent?.trim() === "View Details")!.click()); await wait(() => heldReads === 1); await choose("new.txt"); await wait(() => document.body.textContent?.includes("new marker") === true);
  await act(async () => { releaseRead!(); await Promise.allSettled([...flights]); }); expect(contentRequests).not.toContain(heldDetail); expect(document.querySelector('[aria-label="Artifact preview"]')?.textContent).toContain("new marker"); expect(document.querySelector('[aria-label="Artifact preview"]')?.textContent).not.toContain("old marker");
});
it("desktop preload: a retired workspace reply cannot issue content reads or reopen a popup", async () => {
  await compose(); heldDetail = await seed("old.txt", "text/plain", "old marker"); await seed("foreign.txt", "text/plain", "foreign marker", foreign); readGate = new Promise(resolve => { releaseRead = resolve; }); await mount(); await wait(() => Boolean(card("old.txt"))); await act(async () => [...card("old.txt")!.querySelectorAll<HTMLButtonElement>("button")].find(value => value.textContent?.trim() === "View Details")!.click()); await wait(() => heldReads === 1); await mount(foreign); await wait(() => Boolean(card("foreign.txt")));
  await act(async () => { releaseRead!(); await Promise.allSettled([...flights]); }); expect(contentRequests).not.toContain(heldDetail); expect(document.querySelector('[role="dialog"]')).toBeNull(); expect(document.body.textContent).not.toContain("old marker");
});
it("desktop preload: an accepted old-workspace delete cannot clear or notify the current selection", async () => {
  await compose(); const key = await seed("old-delete.txt", "text/plain", "old marker"); const other = await seed("foreign.txt", "text/plain", "foreign marker", foreign); await mount(); await choose("old-delete.txt"); await act(async () => button("Delete registered artifact").click()); await input("Delete", "Delete"); gate = new Promise(resolve => { release = resolve; }); await act(async () => button("Confirm delete").click()); await wait(() => deletes.length === 1);
  await mount(foreign); await choose("foreign.txt"); await act(async () => { release!(); await Promise.allSettled([...flights]); }); expect(document.querySelector('[aria-label="Artifact preview"]')?.textContent).toContain("foreign marker"); expect(readNotificationMessages(document)).not.toContain(`Deleted ${key}.`); expect((await storage.retrieveArtifact(createRetrieveArtifactRequest(other), { workspaceId: foreign })).ok).toBe(true);
});
it("desktop preload: removal retires a held reply before passive cleanup", async () => {
  await compose(); heldDetail = await seed("retired.txt", "text/plain", "retired marker"); readGate = new Promise(resolve => { releaseRead = resolve; }); let passiveRetired = false;
  function RetirementProbe({ replaced }: { replaced: boolean }) { useEffect(() => () => { passiveRetired = true; }, []); useLayoutEffect(() => { if (!replaced) return; releaseRead!(); const until = performance.now() + 15; while (performance.now() < until) { /* bounded scheduler yield */ } }, [replaced]); return null; }
  await act(async () => root!.render(<><RetirementProbe key="old" replaced={false} /><NotificationTestHarness><ArtifactBrowserFeature client={client} workspaceId={workspaceId} /></NotificationTestHarness></>)); await wait(() => Boolean(card("retired.txt"))); await act(async () => [...card("retired.txt")!.querySelectorAll<HTMLButtonElement>("button")].find(value => value.textContent?.trim() === "View Details")!.click()); await wait(() => heldReads === 1);
  Object.defineProperty(globalThis, "IS_REACT_ACT_ENVIRONMENT", { configurable: true, writable: true, value: false });
  try { root!.render(<RetirementProbe key="new" replaced />); const until = performance.now() + 2000; while (!passiveRetired && performance.now() < until) await new Promise(resolve => setTimeout(resolve, 10)); }
  finally { Object.defineProperty(globalThis, "IS_REACT_ACT_ENVIRONMENT", { configurable: true, writable: true, value: true }); }
  await Promise.allSettled([...flights]); expect(passiveRetired).toBe(true); expect(contentRequests).not.toContain(heldDetail);
});
it("desktop preload: a suspended replacement does not retire the committed workspace", async () => {
  await compose(); heldDetail = await seed("committed.txt", "text/plain", "committed marker"); await seed("foreign.txt", "text/plain", "foreign marker", foreign); readGate = new Promise(resolve => { releaseRead = resolve; }); let attempted = false, resume: (() => void) | undefined; const suspended = new Promise<void>(resolve => { resume = resolve; });
  function Pause({ enabled }: { enabled: boolean }) { if (enabled) { attempted = true; throw suspended; } return null; }
  function Shell({ scope, pause = false }: { scope: string; pause?: boolean }) { return <NotificationTestHarness><Suspense fallback={<p>Replacement pending</p>}><ArtifactBrowserFeature client={client} workspaceId={scope} /><Pause enabled={pause} /></Suspense></NotificationTestHarness>; }
  await act(async () => root!.render(<Shell scope={workspaceId} />)); await wait(() => Boolean(card("committed.txt"))); await act(async () => [...card("committed.txt")!.querySelectorAll<HTMLButtonElement>("button")].find(value => value.textContent?.trim() === "View Details")!.click()); await wait(() => heldReads === 1);
  await act(async () => startTransition(() => root!.render(<Shell scope={foreign} pause />))); expect(attempted).toBe(true); expect(document.body.textContent).not.toContain("Replacement pending"); await act(async () => { releaseRead!(); await Promise.allSettled([...flights]); }); await wait(() => document.querySelector('[aria-label="Artifact preview"]')?.textContent?.includes("committed marker") === true);
  await act(async () => root!.render(<Shell scope={workspaceId} />)); resume!();
});
