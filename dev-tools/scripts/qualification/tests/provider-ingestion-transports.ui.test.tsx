// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import express from "express";
import { createServer, type Server } from "node:http";
import { lstat, mkdtemp, readdir, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { GuidedIngestionTaskPanel, type GuidedIngestionTaskClient, type GuidedHuggingFaceBrowserClient } from "../../../../modules/ui/shared/data-management/GuidedIngestionTaskPanel";
import { createDesktopIngestionTaskClient } from "../../../../apps/desktop/src/renderer/features/artifact-upload/api/desktopIngestionTaskClient";
import { createApiIngestionTaskClient } from "../../../../apps/thin-client/src/features/artifact-upload/api/apiIngestionTaskClient";
import { createDesktopArtifactBrowserClient } from "../../../../apps/desktop/src/renderer/features/artifact-browser/api/desktopArtifactBrowserClient";
import { createApiArtifactBrowserClient } from "../../../../apps/thin-client/src/features/artifact-browser/api/apiArtifactBrowserClient";
import { createDesktopPreloadApi } from "../../../../apps/desktop/src/preload/exposedApi";
import { registerIngestionTaskIpc } from "../../../../modules/adapters/transport/ipc-electron/ingestion-task/registerIngestionTaskIpc";
import { registerIngestionTaskApiRoute } from "../../../../modules/adapters/transport/api-express/ingestion-task/registerIngestionTaskApiRoute";
import { registerArtifactBrowserIpc } from "../../../../modules/adapters/transport/ipc-electron/artifact-browser/registerArtifactBrowserIpc";
import { registerArtifactRepoApiRoutes } from "../../../../modules/adapters/transport/api-express/artifact-repo/registerArtifactRepoApiRoutes";
import type { IpcMainHandleListener, IpcMainHandlePort } from "../../../../modules/adapters/transport/ipc-electron/ipcMainHandlePort";
import { GovernedIngestionTaskUseCases } from "../../../../modules/application/use-cases/ingestion-acquisition/governed-ingestion-tasks.use-case";
import { RegisterArtifactFromRepoUseCase } from "../../../../modules/application/use-cases/register-artifact-from-repo.use-case";
import { BrowseHuggingFaceNamespaceDatasetsUseCase } from "../../../../modules/application/use-cases/browse-huggingface-namespace-datasets.use-case";
import { BrowseHuggingFaceDatasetParquetFilesUseCase } from "../../../../modules/application/use-cases/browse-huggingface-dataset-parquet-files.use-case";
import type { HuggingFaceRepoBrowserPort, ArtifactRepoStoragePort } from "../../../../modules/application/ports/storage";
import { createInMemoryStructuredDocumentStore } from "../../../../modules/adapters/persistence/shared";
import { createStructuredIngestionAcquisitionRepository } from "../../../../modules/adapters/persistence/ingestion";
import { createFilesystemArtifactObjectStorageAdapter, createLocalArtifactCatalogPersistenceAdapter, createLocalArtifactStorageBindingAdapter } from "../../../../modules/adapters/storage/filesystem";
import { createFilesystemIngestionCheckpointStorage } from "../../../../modules/adapters/storage/ingestion-checkpoint";
import { createOrganizationId } from "../../../../modules/contracts/organization";
import { createWorkspaceId } from "../../../../modules/contracts/workspace";
import { createHasArtifactInRepoSuccessResult, createRetrieveArtifactRequest, type ArtifactRepoTarget } from "../../../../modules/contracts/storage";
import { normalizeIngestionSourceId, type IngestionTaskTransportCommand } from "../../../../modules/contracts/ingestion";

// Actual shared panel/default clients -> real registered IPC or owned HTTP ->
// browse/registration/task use cases -> JSON catalog/bindings and task repository.
// Provider metadata/existence, sender/access and unavailable credentials are
// finite offline fixtures. Registration saves references, not downloaded bytes.
// No live provider, physical host, process restart, native or model pass.
type Host = "desktop" | "browser";
const workspaceId = createWorkspaceId("workspace.provider-ui"), organizationId = createOrganizationId("organization.provider-ui");
const context = { workspaceId, organizationId, principalId: "principal.synthetic" };
const revision = "a".repeat(40), repositoryName = "Fixture/energy", paths = ["data/train.parquet", "data/test.parquet"];
const now = "2026-10-26T12:00:00.000Z", tokenKey = "ai-system-builder.paired-device-token", token = "synthetic-provider-loopback-only";
let root: Root | undefined, container: HTMLDivElement | undefined, directory: string | undefined, server: Server | undefined;
let identity: { dev: bigint; ino: bigint } | undefined, client: GuidedIngestionTaskClient, browser: GuidedHuggingFaceBrowserClient;
let catalog: ReturnType<typeof createLocalArtifactCatalogPersistenceAdapter>, bindings: ReturnType<typeof createLocalArtifactStorageBindingAdapter>, storage: ReturnType<typeof createFilesystemArtifactObjectStorageAdapter>;
let repository: ReturnType<typeof createStructuredIngestionAcquisitionRepository>;
let priorToken: string | null | undefined, priorApi: PropertyDescriptor | undefined, priorAct: PropertyDescriptor | undefined, priorScroll: PropertyDescriptor | undefined;
let completed = 0, transportCalls = 0, failedBrowse = false, failedPath: string | undefined, gate: Promise<void> | undefined, release: (() => void) | undefined;
const flights = new Set<Promise<unknown>>(), commands: IngestionTaskTransportCommand[] = [], namespaceCalls: string[] = [], fileCalls: string[] = [], checks: ArtifactRepoTarget[] = [];
function track<T>(value: Promise<T>): Promise<T> { flights.add(value); void value.then(() => flights.delete(value), () => flights.delete(value)); return value; }
const disabled = { execute: async () => ({ ok: false as const, error: { code: "unavailable" as const, message: "Synthetic unused operation disabled." } }) };
async function compose(host: Host) {
  priorToken = localStorage.getItem(tokenKey); priorApi = Object.getOwnPropertyDescriptor(window, "desktopApi"); priorAct = Object.getOwnPropertyDescriptor(globalThis, "IS_REACT_ACT_ENVIRONMENT"); priorScroll = Object.getOwnPropertyDescriptor(window, "scrollTo");
  Object.defineProperty(globalThis, "IS_REACT_ACT_ENVIRONMENT", { configurable: true, writable: true, value: true }); Object.defineProperty(window, "scrollTo", { configurable: true, writable: true, value: vi.fn() });
  directory = await mkdtemp(path.join(await realpath(tmpdir()), "provider-ingestion-ui-")); const info = await lstat(directory, { bigint: true }); expect(info.ino).not.toBe(0n); identity = { dev: info.dev, ino: info.ino };
  repository = createStructuredIngestionAcquisitionRepository(createInMemoryStructuredDocumentStore().forOrganization(organizationId));
  catalog = createLocalArtifactCatalogPersistenceAdapter({ rootDirectory: directory }); bindings = createLocalArtifactStorageBindingAdapter({ rootDirectory: directory }); storage = createFilesystemArtifactObjectStorageAdapter({ rootDirectory: directory, artifactCatalogAppend: catalog, now: () => now });
  const logging = { log: async () => {} };
  const provider: HuggingFaceRepoBrowserPort = {
    listNamespaceDatasets: namespace => track((async () => { namespaceCalls.push(namespace); expect(namespaceCalls.length).toBeLessThanOrEqual(4); await gate; if (failedBrowse) return { ok: false as const, error: { code: "unavailable" as const, message: "token=fixture-private C:\\private\\provider" } }; return { ok: true as const, value: { namespace, datasets: [{ namespace, repository: `${namespace}/energy` }] } }; })()),
    listDatasetParquetFiles: input => track((async () => { fileCalls.push(input.repository); expect(fileCalls.length).toBeLessThanOrEqual(4); await gate; return { ok: true as const, value: { repository: input.repository, revision, files: paths.map(path => ({ repository: input.repository, path, revision })) } }; })()),
  };
  const repoStorage: ArtifactRepoStoragePort = {
    hasArtifactInRepo: async request => { checks.push(request.target); expect(checks.length).toBeLessThanOrEqual(6); expect(request.target).toMatchObject({ provider: "huggingface", repository: repositoryName, revision }); expect(paths).toContain(request.target.path); return request.target.path === failedPath ? { ok: false as const, error: { code: "unavailable" as const, message: "Synthetic selected file unavailable." } } : createHasArtifactInRepoSuccessResult(true); },
    retrieveArtifactFromRepo: async () => { throw new Error("Synthetic provider download disabled."); }, storeArtifactInRepo: async () => { throw new Error("Synthetic provider publication disabled."); },
  };
  const register = new RegisterArtifactFromRepoUseCase({ artifactRepoStorage: repoStorage, artifactBindingStorage: bindings, artifactCatalogAppend: catalog, logging, now: () => now });
  const browseNamespace = new BrowseHuggingFaceNamespaceDatasetsUseCase({ repoBrowser: provider, logging, now: () => now }), browseFiles = new BrowseHuggingFaceDatasetParquetFilesUseCase({ repoBrowser: provider, logging, now: () => now });
  const tasks = new GovernedIngestionTaskUseCases({ repository, checkpoints: createFilesystemIngestionCheckpointStorage({ rootDirectory: directory }), streamStorage: storage, artifactCleanup: storage, registerArtifactFromRepo: register, organizationContextProvider: { getCurrentOrganizationContext: () => ({ organizationId, principalId: context.principalId }) }, now: () => now });
  const port = { executeCommand: (...args: Parameters<typeof tasks.executeCommand>) => { commands.push(args[0]); expect(commands.length).toBeLessThanOrEqual(64); return track(tasks.executeCommand(...args)); } };
  const credentials = { getHuggingFaceTokenStatus: () => ({ configured: false }), setHuggingFaceToken: () => { throw new Error("Synthetic credential writes disabled."); }, clearHuggingFaceToken: () => { throw new Error("Synthetic credential writes disabled."); } };
  const providers = { ...credentials, browseHuggingFaceNamespaceDatasetsUseCase: browseNamespace, browseHuggingFaceDatasetParquetFilesUseCase: browseFiles, registerArtifactFromRepoUseCase: register, importHuggingFaceFilesUseCase: disabled, publishArtifactToRepoUseCase: disabled, verifyPublishedArtifactBackingUseCase: disabled, verifyImportedArtifactSourceBackingUseCase: disabled, localizeArtifactFromRepoUseCase: disabled };
  if (host === "desktop") {
    const event = Object.freeze({ syntheticOwnedSender: true }), handlers = new Map<string, IpcMainHandleListener>();
    const ipcMain: IpcMainHandlePort = { handle<TRequest, TResponse>(channel: string, handler: IpcMainHandleListener<TRequest, TResponse>) { expect(handlers.has(channel)).toBe(false); handlers.set(channel, (sender, request) => handler(sender, request as TRequest)); } };
    const senderTrust = { isTrustedSender: (sender: unknown) => sender === event };
    registerIngestionTaskIpc({ ipcMain, ingestionTasks: port, senderTrust });
    registerArtifactBrowserIpc({ ipcMain, senderTrust, ...providers, browseArtifactsUseCase: disabled, browseUnregisteredArtifactsUseCase: disabled, registerUnregisteredArtifactUseCase: disabled, deleteUnregisteredArtifactUseCase: disabled, deleteRegisteredArtifactUseCase: disabled, readArtifactDetailUseCase: disabled, readArtifactContentUseCase: disabled, artifactMediaViewRetrieval: { retrieveArtifactViewerMediaByStorageKey: async () => { throw new Error("Synthetic media disabled."); } } });
    const api = createDesktopPreloadApi({ ipcRenderer: { invoke: (channel, request) => { expect(++transportCalls).toBeLessThanOrEqual(100); const handler = handlers.get(channel); if (!handler) throw new Error("Synthetic optional operation unavailable."); return track(Promise.resolve(handler(event, request))); } } });
    Object.defineProperty(window, "desktopApi", { configurable: true, writable: true, value: api }); client = createDesktopIngestionTaskClient(); browser = createDesktopArtifactBrowserClient();
  } else {
    localStorage.setItem(tokenKey, token); const app = express(); app.use(express.json({ limit: "32kb", strict: true }));
    app.use((request, response, next) => { if (++transportCalls > 100) { response.status(429).json({ ok: false }); return; } if (request.headers.authorization !== `Bearer ${token}`) { response.status(401).json({ ok: false, error: { code: "unauthenticated", message: "Synthetic access denied." } }); return; } next(); });
    registerIngestionTaskApiRoute({ app, ingestionTasks: port }); registerArtifactRepoApiRoutes({ app, ...providers, hasArtifactInRepoUseCase: disabled, storeArtifactInRepoUseCase: disabled });
    server = createServer(app); await new Promise<void>((resolve, reject) => { server!.once("error", reject); server!.listen(0, "127.0.0.1", resolve); }); const address = server.address(); if (!address || typeof address === "string") throw new Error("Owned provider listener unavailable.");
    const base = `http://127.0.0.1:${address.port}/api`; client = createApiIngestionTaskClient(base); browser = createApiArtifactBrowserClient({ apiBaseUrl: base });
  }
  container = document.createElement("div"); document.body.appendChild(container); root = createRoot(container); await mount();
}
async function mount(scope: string = workspaceId) { await act(async () => root!.render(<GuidedIngestionTaskPanel client={client} sourceBrowserClient={browser} workspaceId={scope} onComplete={() => completed++} />)); }
function button(text: string) { const value = [...document.querySelectorAll<HTMLButtonElement>("button")].find(item => item.textContent?.trim() === text); expect(Boolean(value), `Button ${text}`).toBe(true); return value!; }
async function wait(predicate: () => boolean) { for (let i = 0; i < 200 && !predicate(); i++) await act(async () => { await new Promise(resolve => setTimeout(resolve, 10)); }); expect(predicate(), JSON.stringify({ completed, commands: commands.map(value => value.action), namespaceCalls: namespaceCalls.length, fileCalls: fileCalls.length, checkedFiles: checks.length })).toBe(true); }
async function namespace(value = "Fixture") { const input = document.querySelector<HTMLInputElement>('input[placeholder="Hugging Face name"]')!; expect(Boolean(input) && !input.disabled).toBe(true); await act(async () => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, value); input.dispatchEvent(new Event("input", { bubbles: true })); }); }
async function selectProvider() { const input = [...document.querySelectorAll<HTMLInputElement>('input[type="radio"]')].find(item => item.parentElement?.textContent?.trim() === "Hugging Face dataset")!; expect(Boolean(input)).toBe(true); await act(async () => input.click()); await namespace(); }
async function discover() { await selectProvider(); await act(async () => button("Find datasets").click()); await wait(() => Boolean(document.querySelector('fieldset input[type="checkbox"]'))); await act(async () => button("Select all").click()); await act(async () => button("View files from selected datasets").click()); await wait(() => [...document.querySelectorAll("span")].some(item => item.textContent === paths[0])); }
async function catalogRecords() { const reopened = createLocalArtifactCatalogPersistenceAdapter({ rootDirectory: directory! }); const result = await reopened.browseArtifactCatalogRecords({ workspaceId }, context); expect(result.ok).toBe(true); if (!result.ok) throw new Error("Synthetic catalog read failed."); return result.value.records; }
async function onlyTask() { const tasks = await repository.listTasks(workspaceId); expect(tasks).toHaveLength(1); return tasks[0]!; }
function restoreGlobals() {
  for (const [object, key, descriptor] of [[globalThis, "IS_REACT_ACT_ENVIRONMENT", priorAct], [window, "scrollTo", priorScroll], [window, "desktopApi", priorApi]] as const) { if (descriptor) Object.defineProperty(object, key, descriptor); else Reflect.deleteProperty(object, key); }
  if (priorToken === null) localStorage.removeItem(tokenKey); else if (priorToken !== undefined) localStorage.setItem(tokenKey, priorToken);
}
afterEach(async () => {
  try {
    if (root) await act(async () => root!.unmount()); root = undefined; container?.remove(); container = undefined;
    await act(async () => { release?.(); await Promise.allSettled([...flights]); });
    if (server) { const owned = server; await new Promise<void>((resolve, reject) => owned.close(error => error ? reject(error) : resolve())); expect(owned.listening).toBe(false); server = undefined; }
    restoreGlobals();
    if (directory) { const owned = directory, info = await lstat(owned, { bigint: true }); expect({ dev: info.dev, ino: info.ino }).toEqual(identity); expect(info.isDirectory() && !info.isSymbolicLink()).toBe(true); expect(await realpath(owned)).toBe(owned); expect(path.dirname(owned)).toBe(await realpath(tmpdir())); let entries = 0, bytes = 0; async function inspect(parent: string) { for (const name of await readdir(parent)) { const file = path.join(parent, name), value = await lstat(file); expect(++entries).toBeLessThanOrEqual(256); expect(value.isSymbolicLink()).toBe(false); if (value.isDirectory()) await inspect(file); else { expect(value.isFile()).toBe(true); bytes += value.size; expect(bytes).toBeLessThanOrEqual(1024 * 1024); } } } await inspect(owned); await rm(owned, { recursive: true }); }
  } finally { restoreGlobals(); directory = undefined; identity = undefined; gate = undefined; release = undefined; failedPath = undefined; failedBrowse = false; completed = transportCalls = 0; flights.clear(); commands.length = namespaceCalls.length = fileCalls.length = checks.length = 0; vi.restoreAllMocks(); }
});

for (const host of ["desktop", "browser"] as const) {
  it(`${host}: registers one selected file and leaves the other file untouched`, async () => {
    await compose(host); await discover(); const selected = [...document.querySelectorAll("label")].find(item => item.querySelector("span")?.textContent === paths[0])!.querySelector<HTMLInputElement>('input[type="checkbox"]')!; await act(async () => selected.click()); await act(async () => button("Add data").click()); await wait(() => completed === 1); expect(checks).toEqual([{ provider: "huggingface", repository: repositoryName, path: paths[0], revision }]); expect((await onlyTask()).files).toHaveLength(1); expect(await catalogRecords()).toHaveLength(1);
  });
  it(`${host}: registers exactly the selected pinned dataset references through actual host code`, async () => {
    await compose(host); await discover(); expect(button("Add data").disabled).toBe(true); await act(async () => button("Select all files").click()); const start = button("Add data"); await act(async () => { start.click(); start.click(); }); await wait(() => completed === 1);
    expect(commands.filter(value => value.action === "create-hugging-face")).toHaveLength(1); expect(checks).toEqual(paths.map(path => ({ provider: "huggingface", repository: repositoryName, path, revision })));
    const task = await onlyTask(); expect(task).toMatchObject({ workspaceId, organizationId, kind: "hugging-face", status: "succeeded", progress: { completedItems: 2, totalItems: 2, percent: 100 } }); expect(await catalogRecords()).toHaveLength(2);
    const reopened = createLocalArtifactStorageBindingAdapter({ rootDirectory: directory! });
    for (const [index, file] of task.files.entries()) { const saved = await reopened.readArtifactStorageBindings({ artifactId: file.output!.key, workspaceId }, context); expect(saved.ok).toBe(true); if (!saved.ok) throw new Error("Synthetic bindings did not reopen."); expect(saved.value.bindings).toHaveLength(1); expect(saved.value.bindings[0]).toMatchObject({ workspaceId, artifactId: file.output!.key, role: "imported-source", backing: { kind: "artifact-repo", target: checks[index], revision } }); const snapshots = await repository.listSourceSnapshots(workspaceId, normalizeIngestionSourceId(file.output!.sourceId!)); expect(snapshots).toHaveLength(1); expect(snapshots[0]).toMatchObject({ workspaceId, organizationId, providerRevision: revision, locator: { kind: "hugging-face", repository: repositoryName, path: paths[index], revision } }); expect((await storage.retrieveArtifact(createRetrieveArtifactRequest(file.output!.key), context)).ok).toBe(false); }
    expect(document.body.textContent).not.toContain(directory!);
  });
  it(`${host}: retries only the unavailable selected file without duplicating completed registration`, async () => {
    await compose(host); await discover(); await act(async () => button("Select all files").click()); failedPath = paths[1]; await act(async () => button("Add data").click()); await wait(() => [...document.querySelectorAll("button")].some(item => item.textContent?.trim() === "Try again")); expect(await catalogRecords()).toHaveLength(1); expect(completed).toBe(0); failedPath = undefined; await act(async () => button("Try again").click()); await wait(() => completed === 1); expect(checks.map(value => value.path)).toEqual([paths[0], paths[1], paths[1]]); expect(await catalogRecords()).toHaveLength(2); expect((await onlyTask()).status).toBe("succeeded");
  });
  it(`${host}: changing the namespace clears the previous selected files`, async () => {
    await compose(host); await discover(); await act(async () => button("Select all files").click()); expect(button("Add data").disabled).toBe(false); await namespace("OtherFixture"); expect(button("Add data").disabled).toBe(true); expect(document.body.textContent).not.toContain(paths[0]); expect(commands).toHaveLength(0);
  });
  it(`${host}: removing the selected dataset clears its previous file selection`, async () => {
    await compose(host); await discover(); await act(async () => button("Select all files").click()); await act(async () => button("Deselect all").click()); expect(button("Add data").disabled).toBe(true); expect(document.body.textContent).not.toContain(paths[0]); expect(commands).toHaveLength(0);
  });
  it(`${host}: a provider browse refusal stays safe and can be retried`, async () => {
    await compose(host); await selectProvider(); failedBrowse = true; await act(async () => button("Find datasets").click()); await wait(() => Boolean(document.querySelector('[role="alert"]'))); expect(document.body.textContent).not.toContain("fixture-private"); expect(document.body.textContent).not.toContain("C:\\private"); expect(button("Add data").disabled).toBe(true); expect(commands).toHaveLength(0); failedBrowse = false; await act(async () => button("Find datasets").click()); await wait(() => Boolean(document.querySelector('fieldset input[type="checkbox"]'))); expect(document.querySelector('[role="alert"]')).toBeNull(); expect(namespaceCalls).toEqual(["Fixture", "Fixture"]);
  });
  for (const change of ["namespace", "dataset", "files"] as const) it(`${host}: a ${change} change refuses a stale Add data click before its next render`, async () => {
    await compose(host); await discover(); await act(async () => button("Select all files").click()); const start = button("Add data");
    if (change === "files") gate = new Promise(resolve => { release = resolve; });
    await act(async () => {
      if (change === "namespace") { const input = document.querySelector<HTMLInputElement>('input[placeholder="Hugging Face name"]')!; Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, "OtherFixture"); input.dispatchEvent(new Event("input", { bubbles: true })); }
      else button(change === "dataset" ? "Deselect all" : "View files from selected datasets").click();
      start.click();
    });
    expect(completed).toBe(0); expect([...document.querySelectorAll("button")].some(item => item.textContent?.trim() === "Cancel")).toBe(false); expect(commands).toHaveLength(0); expect(await catalogRecords()).toHaveLength(0);
    if (change === "files") await act(async () => { release!(); await Promise.allSettled([...flights]); });
  });
  it(`${host}: a retired provider browse cannot populate another workspace`, async () => {
    await compose(host); await selectProvider(); gate = new Promise(resolve => { release = resolve; }); await act(async () => button("Find datasets").click()); await wait(() => namespaceCalls.length === 1); await mount("workspace.provider-ui-other"); await act(async () => { release!(); await Promise.allSettled([...flights]); }); expect(document.body.textContent).not.toContain(repositoryName); expect(commands).toHaveLength(0); expect(await catalogRecords()).toHaveLength(0); expect(completed).toBe(0);
  });
  for (const files of [false, true]) it(`${host}: admits one ${files ? "file-list" : "namespace"} browse before the busy render`, async () => {
    await compose(host); if (files) { await selectProvider(); await act(async () => button("Find datasets").click()); await wait(() => Boolean(document.querySelector('fieldset input[type="checkbox"]'))); await act(async () => button("Select all").click()); } else await selectProvider();
    gate = new Promise(resolve => { release = resolve; }); const find = button(files ? "View files from selected datasets" : "Find datasets"); await act(async () => { find.click(); find.click(); }); await wait(() => (files ? fileCalls : namespaceCalls).length > 0); expect(files ? fileCalls : namespaceCalls).toHaveLength(1); await act(async () => { release!(); await Promise.allSettled([...flights]); });
  });
}
