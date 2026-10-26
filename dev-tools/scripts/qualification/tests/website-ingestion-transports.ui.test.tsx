// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import express from "express";
import { createServer, type Server } from "node:http";
import { createHash } from "node:crypto";
import { lstat, mkdtemp, readdir, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { GuidedIngestionTaskPanel, type GuidedIngestionTaskClient } from "../../../../modules/ui/shared/data-management/GuidedIngestionTaskPanel";
import { createDesktopIngestionTaskClient } from "../../../../apps/desktop/src/renderer/features/artifact-upload/api/desktopIngestionTaskClient";
import { createApiIngestionTaskClient } from "../../../../apps/thin-client/src/features/artifact-upload/api/apiIngestionTaskClient";
import { createDesktopPreloadApi } from "../../../../apps/desktop/src/preload/exposedApi";
import { registerIngestionTaskIpc } from "../../../../modules/adapters/transport/ipc-electron/ingestion-task/registerIngestionTaskIpc";
import { registerIngestionTaskApiRoute } from "../../../../modules/adapters/transport/api-express/ingestion-task/registerIngestionTaskApiRoute";
import type { IpcMainHandleListener, IpcMainHandlePort } from "../../../../modules/adapters/transport/ipc-electron/ipcMainHandlePort";
import { GovernedIngestionTaskUseCases } from "../../../../modules/application/use-cases/ingestion-acquisition/governed-ingestion-tasks.use-case";
import { GovernedWebsiteIngestionUseCases } from "../../../../modules/application/use-cases/ingestion-acquisition/governed-website-ingestion.use-case";
import type { GovernedWebsiteCapturePort, GovernedWebsitePageCapture } from "../../../../modules/application/ports/ingestion";
import { createInMemoryStructuredDocumentStore } from "../../../../modules/adapters/persistence/shared";
import { createStructuredIngestionAcquisitionRepository } from "../../../../modules/adapters/persistence/ingestion";
import { createFilesystemArtifactObjectStorageAdapter, createLocalArtifactCatalogPersistenceAdapter } from "../../../../modules/adapters/storage/filesystem";
import { createFilesystemIngestionCheckpointStorage } from "../../../../modules/adapters/storage/ingestion-checkpoint";
import { createOrganizationId } from "../../../../modules/contracts/organization";
import { createWorkspaceId } from "../../../../modules/contracts/workspace";
import { createRetrieveArtifactRequest } from "../../../../modules/contracts/storage";
import { normalizeIngestionSourceId, type GovernedWebsiteScopeRequest, type IngestionTaskTransportCommand } from "../../../../modules/contracts/ingestion";

// Mounted production panel/default host clients, real registered transport and
// application/repository/storage implementations. Capture and access policy are
// finite offline fixtures; no provider, egress, native or physical-host pass.
type Host = "desktop" | "browser";
const workspaceId = createWorkspaceId("workspace.website-ui"), organizationId = createOrganizationId("organization.website-ui");
const now = "2026-10-26T12:00:00.000Z", tokenKey = "ai-system-builder.paired-device-token", token = "synthetic-website-loopback-only";
const urls = ["https://example.com/energy", "https://example.com/storage"];
const privateError = "token=synthetic-private C:\\private\\capture";
const context = { workspaceId, organizationId, principalId: "principal.synthetic" };
let root: Root | undefined, container: HTMLDivElement | undefined, directory: string | undefined, server: Server | undefined;
let identity: { dev: bigint; ino: bigint } | undefined, client: GuidedIngestionTaskClient;
let repository: ReturnType<typeof createStructuredIngestionAcquisitionRepository>, storage: ReturnType<typeof createFilesystemArtifactObjectStorageAdapter>;
let catalog: ReturnType<typeof createLocalArtifactCatalogPersistenceAdapter>;
let priorToken: string | null, priorApi: PropertyDescriptor | undefined, priorAct: PropertyDescriptor | undefined, priorScroll: PropertyDescriptor | undefined;
let completed = 0, captureCalls = 0, transportCalls = 0, failure = false, gate: Promise<void> | undefined, release: (() => void) | undefined;
const flights = new Set<Promise<unknown>>(), commands: IngestionTaskTransportCommand[] = [], scopes: GovernedWebsiteScopeRequest[] = [];
const digest = (bytes: Uint8Array) => `sha256:${createHash("sha256").update(bytes).digest("hex")}` as const;
function bytes(url: string) { const index = urls.indexOf(url); expect(index).toBeGreaterThanOrEqual(0); const text = index === 0 ? "Solar panels generate electricity." : "Batteries store electrical energy."; return { raw: new Uint8Array(Buffer.from(`<main>${text}</main>`)), text: new Uint8Array(Buffer.from(text)) }; }
function newStorage() { return createFilesystemArtifactObjectStorageAdapter({ rootDirectory: directory!, now: () => now, artifactCatalogAppend: catalog }); }
async function compose(host: Host) {
  priorToken = localStorage.getItem(tokenKey); priorApi = Object.getOwnPropertyDescriptor(window, "desktopApi"); priorAct = Object.getOwnPropertyDescriptor(globalThis, "IS_REACT_ACT_ENVIRONMENT"); priorScroll = Object.getOwnPropertyDescriptor(window, "scrollTo");
  Object.defineProperty(globalThis, "IS_REACT_ACT_ENVIRONMENT", { configurable: true, writable: true, value: true }); Object.defineProperty(window, "scrollTo", { configurable: true, writable: true, value: vi.fn() });
  directory = await mkdtemp(path.join(await realpath(tmpdir()), "website-ingestion-ui-")); const info = await lstat(directory, { bigint: true }); expect(info.ino).not.toBe(0n); identity = { dev: info.dev, ino: info.ino };
  const documents = createInMemoryStructuredDocumentStore().forOrganization(organizationId);
  repository = createStructuredIngestionAcquisitionRepository(documents); catalog = createLocalArtifactCatalogPersistenceAdapter({ rootDirectory: directory, documents }); storage = newStorage();
  const capture: GovernedWebsiteCapturePort = {
    resolveScope: async value => { scopes.push(value); expect(scopes.length).toBeLessThanOrEqual(2); return value.kind === "sitemap" ? urls : value.urls; },
    capturePage: async url => { expect(++captureCalls).toBeLessThanOrEqual(4); await gate; if (failure) throw new Error(privateError); const value = bytes(url); return { outcome: "captured", requestedUrl: url, canonicalUrl: url, rawBytes: value.raw, derivedTextBytes: value.text, contentDigest: digest(value.raw), mediaType: "text/html", httpStatus: 200, robots: { decision: "allowed", policyUrl: "https://example.com/robots.txt", checkedAt: now } } satisfies GovernedWebsitePageCapture; },
  };
  const website = new GovernedWebsiteIngestionUseCases({ repository, capture, streamStorage: storage, artifactCleanup: storage, artifactCatalogCleanup: catalog, now: () => now });
  const tasks = new GovernedIngestionTaskUseCases({ repository, checkpoints: createFilesystemIngestionCheckpointStorage({ rootDirectory: directory }), streamStorage: storage, artifactCleanup: storage, website, organizationContextProvider: { getCurrentOrganizationContext: () => ({ organizationId, principalId: context.principalId }) }, now: () => now });
  const port = { executeCommand: (...args: Parameters<typeof tasks.executeCommand>) => { commands.push(args[0]); expect(commands.length).toBeLessThanOrEqual(64); const flight = tasks.executeCommand(...args); flights.add(flight); void flight.then(() => flights.delete(flight), () => flights.delete(flight)); return flight; } };
  if (host === "desktop") {
    const event = Object.freeze({ syntheticOwnedSender: true }), handlers = new Map<string, IpcMainHandleListener>();
    const ipcMain: IpcMainHandlePort = { handle<TRequest, TResponse>(channel: string, handler: IpcMainHandleListener<TRequest, TResponse>) { expect(handlers.has(channel)).toBe(false); handlers.set(channel, (sender, request) => handler(sender, request as TRequest)); } };
    registerIngestionTaskIpc({ ipcMain, ingestionTasks: port, senderTrust: { isTrustedSender: sender => sender === event } });
    const api = createDesktopPreloadApi({ ipcRenderer: { invoke: async (channel, request) => { expect(++transportCalls).toBeLessThanOrEqual(64); const handler = handlers.get(channel); expect(Boolean(handler)).toBe(true); return handler!(event, request); } } });
    Object.defineProperty(window, "desktopApi", { configurable: true, writable: true, value: { executeIngestionTask: api.executeIngestionTask } }); client = createDesktopIngestionTaskClient();
  } else {
    localStorage.setItem(tokenKey, token); const app = express(); app.use(express.json({ limit: "32kb", strict: true }));
    app.use((request, response, next) => { if (++transportCalls > 64) { response.status(429).json({ ok: false }); return; } if (request.headers.authorization !== `Bearer ${token}`) { response.status(401).json({ ok: false, error: { code: "unauthenticated", message: "Synthetic access denied." } }); return; } next(); });
    registerIngestionTaskApiRoute({ app, ingestionTasks: port }); server = createServer(app); await new Promise<void>((resolve, reject) => { server!.once("error", reject); server!.listen(0, "127.0.0.1", resolve); }); const address = server.address(); if (!address || typeof address === "string") throw new Error("Owned website listener did not start."); client = createApiIngestionTaskClient(`http://127.0.0.1:${address.port}/api`);
  }
  container = document.createElement("div"); document.body.appendChild(container); root = createRoot(container); await act(async () => root!.render(<GuidedIngestionTaskPanel client={client} workspaceId={workspaceId} onComplete={() => { completed++; }} />));
}
afterEach(async () => {
  try { if (root) await act(async () => root!.unmount()); root = undefined; container?.remove(); container = undefined; await act(async () => { release?.(); await Promise.allSettled([...flights]); }); if (server) { const owned = server; await new Promise<void>((resolve, reject) => owned.close(error => error ? reject(error) : resolve())); expect(owned.listening).toBe(false); server = undefined; }
    if (directory) { const owned = directory, info = await lstat(owned, { bigint: true }); expect({ dev: info.dev, ino: info.ino }).toEqual(identity); expect(info.isDirectory() && !info.isSymbolicLink()).toBe(true); expect(await realpath(owned)).toBe(owned); expect(path.dirname(owned)).toBe(await realpath(tmpdir())); let count = 0, size = 0; async function inspect(parent: string) { for (const name of await readdir(parent)) { const file = path.join(parent, name), entry = await lstat(file); expect(++count).toBeLessThanOrEqual(256); expect(entry.isSymbolicLink()).toBe(false); if (entry.isDirectory()) await inspect(file); else { expect(entry.isFile()).toBe(true); size += entry.size; expect(size).toBeLessThanOrEqual(1024 * 1024); } } } await inspect(owned); await rm(owned, { recursive: true }); }
  } finally { for (const [object, name, descriptor] of [[globalThis, "IS_REACT_ACT_ENVIRONMENT", priorAct], [window, "scrollTo", priorScroll], [window, "desktopApi", priorApi]] as const) { if (descriptor) Object.defineProperty(object, name, descriptor); else Reflect.deleteProperty(object, name); } if (priorToken === null) localStorage.removeItem(tokenKey); else if (priorToken !== undefined) localStorage.setItem(tokenKey, priorToken); directory = undefined; identity = undefined; gate = undefined; release = undefined; completed = captureCalls = transportCalls = 0; failure = false; flights.clear(); commands.length = scopes.length = 0; vi.restoreAllMocks(); }
});
function button(text: string) { const value = [...document.querySelectorAll<HTMLButtonElement>("button")].find(item => item.textContent?.trim() === text); expect(Boolean(value)).toBe(true); return value!; }
async function wait(predicate: () => boolean) { for (let attempt = 0; attempt < 200 && !predicate(); attempt++) await act(async () => { await new Promise(resolve => setTimeout(resolve, 10)); }); const alerts = [...document.querySelectorAll('[role="alert"]')].map(value => value.textContent ?? ""); const safe = alerts.map(value => /[A-Za-z]:\\|token=|authorization|\/Users\//i.test(value) ? "private-text-withheld" : value.slice(0, 240)); expect(predicate(), JSON.stringify({ completed, captureCalls, actions: commands.map(value => value.action), scopes: scopes.length, alerts: safe, fixtureBinaryCompatible: bytes(urls[0]!).raw instanceof Uint8Array, textareaPresent: Boolean(document.querySelector("textarea")) })).toBe(true); }
async function selectWebsite(sitemap = false) { const choice = [...document.querySelectorAll<HTMLInputElement>('input[type="radio"]')].find(item => item.parentElement?.textContent?.trim() === "Website pages")!; expect(Boolean(choice)).toBe(true); await act(async () => choice.click()); if (sitemap) { const scope = [...document.querySelectorAll<HTMLInputElement>('input[type="radio"]')].find(item => item.parentElement?.textContent?.trim() === "One sitemap")!; await act(async () => scope.click()); } const input = document.querySelector("textarea")!; await act(async () => { Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!.call(input, sitemap ? "https://example.com/sitemap.xml" : urls.join("\n")); input.dispatchEvent(new Event("input", { bubbles: true })); }); }
async function onlyTask() { const values = await repository.listTasks(workspaceId); expect(values).toHaveLength(1); return values[0]!; }

for (const host of ["desktop", "browser"] as const) {
  for (const sitemap of [false, true]) it(`${host}: captures two ${sitemap ? "sitemap" : "explicit"} pages through real transport and reopens exact raw/readable bytes`, async () => {
    await compose(host); await selectWebsite(sitemap); await act(async () => button("Add data").click()); await wait(() => completed === 1);
    expect(scopes).toEqual([{ kind: sitemap ? "sitemap" : "pages", urls: sitemap ? ["https://example.com/sitemap.xml"] : urls, maximumPages: 10 }]); expect(captureCalls).toBe(2); const task = await onlyTask(); expect(task).toMatchObject({ workspaceId, organizationId, kind: "website", status: "succeeded", progress: { completedItems: 2, totalItems: 2, percent: 100 } });
    const reopened = newStorage();
    for (const [index, file] of task.files.entries()) { const output = file.output!; const snapshots = await repository.listSourceSnapshots(workspaceId, normalizeIngestionSourceId(output.sourceId!)); expect(snapshots).toHaveLength(1); expect(snapshots[0]).toMatchObject({ workspaceId, organizationId, rawArtifactKey: output.key, contentDigest: digest(bytes(urls[index]!).raw), locator: { kind: "website", requestedUrl: urls[index], canonicalUrl: urls[index] }, robots: { decision: "allowed" }, capturedAt: now });
      for (const [key, expected] of [[output.key, bytes(urls[index]!).raw], [output.derivedArtifactKeys![0]!, bytes(urls[index]!).text]] as const) { const result = await reopened.retrieveArtifact(createRetrieveArtifactRequest(key), context); expect(result.ok).toBe(true); if (!result.ok) throw new Error("Synthetic captured bytes did not reopen."); expect(Buffer.from(result.value.content)).toEqual(Buffer.from(expected)); }
    }
    const visible = await catalog.browseArtifactCatalogRecords({ workspaceId }, context); expect(visible.ok).toBe(true); if (!visible.ok) throw new Error("Synthetic catalog read failed."); expect(visible.value.records.map(value => value.storageKey).sort()).toEqual(task.files.flatMap(file => [file.output!.key, ...file.output!.derivedArtifactKeys!]).sort());
    expect(document.body.textContent).toContain("0 files selected"); expect(document.querySelector<HTMLInputElement>('input[type="radio"]:checked')?.parentElement?.textContent?.trim()).toBe("Files"); expect(document.body.textContent).not.toContain(directory!);
    const before = captureCalls; await expect(client.execute({ workspaceId: "workspace.foreign", command: { action: "run-website", taskId: task.taskId } })).rejects.toThrow(); expect(captureCalls).toBe(before); expect((await onlyTask()).status).toBe("succeeded");
  });
  it(`${host}: retains failed source choice and explicitly retries the same task without exposing capture diagnostics`, async () => {
    await compose(host); await selectWebsite(); failure = true; await act(async () => button("Add data").click()); await wait(() => Boolean(document.querySelector('[role="alert"]'))); expect(document.body.textContent).not.toContain(privateError); expect(document.querySelector("textarea")?.value).toBe(urls.join("\n")); expect(completed).toBe(0); const failed = await onlyTask(); expect(failed.status).toBe("failed"); expect(failed.files[0]?.error?.retryable).toBe(true);
    failure = false; await act(async () => button("Try again").click()); await wait(() => completed === 1); expect((await onlyTask()).taskId).toBe(failed.taskId); expect((await onlyTask()).status).toBe("succeeded"); expect(commands.filter(value => value.action === "create-website")).toHaveLength(1); expect(commands.some(value => value.action === "resume")).toBe(true);
  });
  it(`${host}: confirms cancellation while capture is held and late content cannot commit a snapshot`, async () => {
    await compose(host); await selectWebsite(); gate = new Promise(resolve => { release = resolve; }); await act(async () => button("Add data").click()); await wait(() => captureCalls === 1); const task = await onlyTask(); expect(task.status).toBe("transferring"); expect(document.querySelector("textarea")?.disabled).toBe(true);
    await act(async () => button("Cancel").click()); await wait(() => document.body.textContent?.includes("Cancelled.") === true); expect((await onlyTask()).status).toBe("cancelled"); await act(async () => { release!(); await Promise.allSettled([...flights]); }); await wait(() => ![...flights].length); expect(completed).toBe(0); expect((await onlyTask()).status).toBe("cancelled");
    for (const file of task.files) expect(await repository.listSourceSnapshots(workspaceId, normalizeIngestionSourceId(`source.${task.taskId}.${file.fileId}`))).toEqual([]);
    const visible = await catalog.browseArtifactCatalogRecords({ workspaceId }, context); expect(visible.ok).toBe(true); if (!visible.ok) throw new Error("Synthetic catalog read failed."); expect(visible.value.records).toEqual([]);
  });
}
