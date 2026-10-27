// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, expect, it } from "vitest";
import express from "express";
import { createServer, type Server } from "node:http";
import { createHash, randomUUID } from "node:crypto";
import { lstat, mkdtemp, readdir, realpath, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { ContextStudio, type ContextManagementClient } from "../../../../modules/ui/shared/context-management/ContextStudio";
import { NotificationTestHarness } from "../../../../modules/ui/shared/notifications/tests/NotificationTestHarness";
import { createDesktopContextManagementClient } from "../../../../apps/desktop/src/renderer/features/context-management/api/desktopContextManagementClient";
import { createApiContextManagementClient } from "../../../../apps/thin-client/src/features/context-management/api/apiContextManagementClient";
import { createApiArtifactBrowserClient } from "../../../../apps/thin-client/src/features/artifact-browser/api/apiArtifactBrowserClient";
import { createDesktopPreloadApi } from "../../../../apps/desktop/src/preload/exposedApi";
import { composeDesktopArtifactFeature } from "../../../../modules/hosts/desktop/composition/composeDesktopArtifactFeature";
import { composeDesktopContextManagementFeature } from "../../../../modules/hosts/desktop/composition/composeDesktopContextManagementFeature";
import { registerContextManagementIpc } from "../../../../modules/adapters/transport/ipc-electron/context-management/registerContextManagementIpc";
import { registerContextManagementApiRoutes } from "../../../../modules/adapters/transport/api-express/context-management/registerContextManagementApiRoutes";
import { registerArtifactBrowserIpc } from "../../../../modules/adapters/transport/ipc-electron/artifact-browser";
import { registerArtifactBrowserApiRoutes } from "../../../../modules/adapters/transport/api-express/artifact-browser";
import { setExpressAuthContext } from "../../../../modules/adapters/transport/api-express/security/expressAuthContext";
import type { IpcMainHandleListener, IpcMainHandlePort } from "../../../../modules/adapters/transport/ipc-electron/ipcMainHandlePort";
import type { RuntimeTaskRegistryPort } from "../../../../modules/application/ports/runtime";
import { TaskType, type ContextGenerationTaskRequest, type RuntimeTaskStatusRecord, type ContextGenerationTaskResult } from "../../../../modules/contracts/runtime";
import { CONTEXT_MARKDOWN_PACK_MEDIA_TYPE, CONTEXT_RAG_DATABASE_MEDIA_TYPE, evaluateContextSourceCapability, type ContextArtifactManifest, type ContextManagementTransportCommand } from "../../../../modules/contracts/context-management";
import { createWorkspaceId } from "../../../../modules/contracts/workspace";
import { createStoreArtifactRequest, createRetrieveArtifactRequest } from "../../../../modules/contracts/storage";
import { createLocalArtifactCatalogPersistenceAdapter, createLocalArtifactStorageBindingAdapter, createFilesystemArtifactObjectStorageAdapter } from "../../../../modules/adapters/storage/filesystem";

// Real shared UI -> actual clients/IPC or owned HTTP -> existing host composition
// -> application lifecycle/runtime adapter -> new filesystem catalog/bindings/bytes.
// Actor admission, task registry and archive inspection are finite test fixtures.
// No Python/model/OCR/provider/process/native/archive-parser qualification follows.
type Host = "desktop" | "browser";
const workspaceId = createWorkspaceId("workspace.context-ui"), foreign = createWorkspaceId("workspace.context-ui-foreign");
const context = { workspaceId, principalId: "principal.context-ui" };
const now = "2026-10-26T12:00:00.000Z", tokenKey = "ai-system-builder.paired-device-token", token = "synthetic-context-loopback-only";
const manual = "# Harbor Transit\n\nLine A leaves Harbor Station at 08:00. Bring a café pass.\n\n## Assistance\n\nAsk the station desk for step-free access.";
const sourceText = "# Harbor Transit source\n\nLine A connects Harbor Station and the Museum.\n\nA valid day pass covers both stops.";
let root: Root | undefined, container: HTMLDivElement | undefined, server: Server | undefined;
let directory: string | undefined, identity: { dev: bigint; ino: bigint } | undefined;
let client: ContextManagementClient, artifacts: ReturnType<typeof composeDesktopArtifactFeature>, feature: ReturnType<typeof composeDesktopContextManagementFeature>;
let environment: { act?: PropertyDescriptor; api?: PropertyDescriptor; token: string | null; sessions: Map<string, string | null> } | undefined;
let calls = 0, runtimeCalls = 0, runtimeReads = 0, outputMismatch = false, gate: Promise<void> | undefined, release: (() => void) | undefined;
let queryFault: "none" | "cuda" | "runtime-malformed" = "none", queryAckFault: "none" | "foreign" | "malformed" | "missing-citation" | "oversized" | "excess" = "none";
const queryInputs: any[] = [];
const excerpt = "Line A connects Harbor Station and the Museum.";
let generationStartFault: (() => void) | undefined, runtimeStartFault = false;
const privateStartMarker = "synthetic-private-context-start-marker";
const flights = new Set<Promise<unknown>>(), commands: ContextManagementTransportCommand[] = [];
const wireResponses: any[] = [];
const scopes: { action: string; workspaceId: string }[] = [];
const tasks = new Map<string, RuntimeTaskStatusRecord>(), results = new Map<string, { bytes: Uint8Array; result: ContextGenerationTaskResult; stage: string }>();
const stages = new Map<string, { dev: bigint; ino: bigint }>();
const requestIds: string[] = [], powerStarts: string[] = [], powerEnds: string[] = [];
const sessionKey = (scope: string) => `ai-system-builder.context-task.v1:${scope}`;
const digest = (bytes: Uint8Array) => `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
function track<T>(pending: Promise<T>) { flights.add(pending); void pending.then(() => flights.delete(pending), () => flights.delete(pending)); return pending; }
async function rememberStage(value: string) {
  const owned = await realpath(value); expect(path.dirname(owned) === await realpath(tmpdir())).toBe(true);
  const info = await lstat(owned, { bigint: true }); expect(info.isDirectory() && !info.isSymbolicLink() && info.ino !== 0n).toBe(true);
  const existing = stages.get(owned); if (existing) expect({ dev: info.dev, ino: info.ino }).toEqual(existing);
  else stages.set(owned, { dev: info.dev, ino: info.ino });
}
// Small stored ZIP fixture, not a substitute production parser or generator.
function zip(entries: Record<string, string>) {
  const locals: Buffer[] = [], centrals: Buffer[] = []; let offset = 0;
  expect(Object.keys(entries).length).toBeLessThanOrEqual(4);
  for (const [name, text] of Object.entries(entries)) {
    expect(["manifest.json", "README.md", "context.md", "sources.md", "topics.md", "chunks.jsonl"]).toContain(name);
    const data = Buffer.from(text), label = Buffer.from(name); expect(data.length).toBeLessThanOrEqual(32_768);
    let crc = 0xffffffff; for (const byte of data) { crc ^= byte; for (let n = 0; n < 8; n++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0); } crc = (crc ^ 0xffffffff) >>> 0;
    const local = Buffer.alloc(30); local.writeUInt32LE(0x04034b50); local.writeUInt16LE(20, 4); local.writeUInt32LE(crc, 14); local.writeUInt32LE(data.length, 18); local.writeUInt32LE(data.length, 22); local.writeUInt16LE(label.length, 26);
    const central = Buffer.alloc(46); central.writeUInt32LE(0x02014b50); central.writeUInt16LE(20, 4); central.writeUInt16LE(20, 6); central.writeUInt32LE(crc, 16); central.writeUInt32LE(data.length, 20); central.writeUInt32LE(data.length, 24); central.writeUInt16LE(label.length, 28); central.writeUInt32LE(offset, 42);
    locals.push(local, label, data); centrals.push(central, label); offset += local.length + label.length + data.length;
  }
  const central = Buffer.concat(centrals), end = Buffer.alloc(22), count = Object.keys(entries).length;
  end.writeUInt32LE(0x06054b50); end.writeUInt16LE(count, 8); end.writeUInt16LE(count, 10); end.writeUInt32LE(central.length, 12); end.writeUInt32LE(offset, 16);
  const bytes = new Uint8Array(Buffer.concat([...locals, central, end])); expect(bytes.length).toBeLessThanOrEqual(128 * 1024); return bytes;
}
async function compose(host: Host) {
  environment = { act: Object.getOwnPropertyDescriptor(globalThis, "IS_REACT_ACT_ENVIRONMENT"), api: Object.getOwnPropertyDescriptor(window, "desktopApi"), token: localStorage.getItem(tokenKey), sessions: new Map([workspaceId, foreign].map(value => [sessionKey(value), sessionStorage.getItem(sessionKey(value))])) };
  Object.defineProperty(globalThis, "IS_REACT_ACT_ENVIRONMENT", { configurable: true, writable: true, value: true }); localStorage.setItem(tokenKey, token);
  for (const key of environment.sessions.keys()) sessionStorage.removeItem(key);
  directory = await mkdtemp(path.join(await realpath(tmpdir()), "context-composed-ui-")); const info = await lstat(directory, { bigint: true }); identity = { dev: info.dev, ino: info.ino }; expect(info.ino !== 0n).toBe(true);
  artifacts = composeDesktopArtifactFeature({ storageRootDirectory: directory, loggingPort: { log: async () => {} }, workspaceShell: {}, now: () => now });
  const registry: RuntimeTaskRegistryPort = {
    async startTask(request) {
      expect(++runtimeCalls).toBeLessThanOrEqual(20); const requestId = request.requestId ?? randomUUID(); expect(typeof requestId === "string" && requestId.length > 0).toBe(true);
      const payload = request.payload as any; await rememberStage(payload.runtime.runtimeWorkingDirectory);
      if (request.taskType === TaskType.CONTEXT_GENERATION && runtimeStartFault) throw new Error(`${privateStartMarker} ${payload.runtime.runtimeWorkingDirectory}`);
      let data: any;
      if (request.taskType === TaskType.CONTEXT_GENERATION) {
        const value = payload as ContextGenerationTaskRequest; expect(["markdown-context-pack", "rag-database"]).toContain(value.kind); const rag = value.kind === "rag-database"; requestIds.push(requestId); expect(requestIds.length).toBeLessThanOrEqual(3);
        const inspections = await Promise.all(value.sources.map(async source => { const bytes = await readFile(source.localPath); expect(digest(bytes)).toBe(source.sourceDigest); return { artifactId: source.artifactId, digest: source.sourceDigest, mediaType: source.mediaType, originalName: source.originalName, sizeBytes: bytes.length, ready: true, sourceKind: "document" as const, format: "markdown", textFields: [], alreadyChunked: false, chunkCount: 1 }; }));
        const manifest: ContextArtifactManifest = { schemaVersion: "1", kind: value.kind, name: value.name, mediaType: rag ? CONTEXT_RAG_DATABASE_MEDIA_TYPE : CONTEXT_MARKDOWN_PACK_MEDIA_TYPE, createdAt: now, sources: inspections.map(source => ({ artifactId: source.artifactId, digest: source.digest as `sha256:${string}`, mediaType: source.mediaType, originalName: source.originalName, sizeBytes: source.sizeBytes, chunkCount: 1, chunkingMode: "extracted" })), manualEntries: value.manualEntries.map(entry => ({ id: entry.id, title: entry.title, digest: digest(new Uint8Array(Buffer.from(entry.content))) as `sha256:${string}` })), chunking: value.chunking, ...(rag ? { embedding: { provider: "transformers", modelId: value.embedding!.modelId, dimensions: 384 }, sourceChecks: value.sourceChecks } : { contextPack: value.contextPack }) };
        const content = value.manualEntries[0]?.content ?? sourceText;
        const entries: Record<string, string> = rag ? { "manifest.json": JSON.stringify(manifest), "README.md": "# Finite RAG package fixture; not a LanceDB engine", "chunks.jsonl": JSON.stringify({ id: "harbor-chunk-0", text: sourceText, citation: { sourceArtifactId: inspections[0]!.artifactId, sourceDigest: inspections[0]!.digest, chunkIndex: 0 } })+"\n" } : value.manualEntries.length ? { "manifest.json": JSON.stringify(manifest), "README.md": "# Synthetic Harbor Transit context pack", "context.md": content } : { "manifest.json": JSON.stringify(manifest), "README.md": "# Synthetic Harbor Transit source pack", "sources.md": sourceText, "topics.md": content };
        const bytes = zip(entries); await writeFile(path.join(value.runtime.runtimeWorkingDirectory, "harbor-transit.zip"), bytes, { flag: "wx" });
        const result: ContextGenerationTaskResult = { output: { name: "harbor-transit.zip", outputHandle: "harbor-transit.zip", mediaType: manifest.mediaType, sizeBytes: bytes.length, digest: (outputMismatch ? `sha256:${"0".repeat(64)}` : digest(bytes)) as `sha256:${string}` }, sourceInspections: inspections, preview: { kind: value.kind, name: value.name, sourceCount: value.sources.length, manualEntryCount: value.manualEntries.length, chunkCount: 1, items: [{ id: "context-section-0", kind: rag ? "chunk" : value.manualEntries.length ? "manual" : "topic", title: "Harbor Transit", text: content, citations: inspections.map(source => ({ sourceArtifactId: source.artifactId, chunkIndex: 0 })) }] }, manifest };
        results.set(requestId, { bytes, result, stage: value.runtime.runtimeWorkingDirectory }); data = result;
      } else {
        expect(request.taskType).toBe(TaskType.CONTEXT_RETRIEVAL);
        const content = await readFile(payload.localPath); expect(digest(content)).toBe(payload.digest);
        if (payload.operation === "inspect-source") data = { operation: payload.operation, inspection: { artifactId: payload.artifactId, digest: payload.digest, mediaType: payload.mediaType, originalName: payload.originalName, sizeBytes: content.length, ready: true, sourceKind: "document", format: "markdown", textFields: [], alreadyChunked: false, chunkCount: 1 } };
        else {
          const known = [...results.values()].find(value => digest(value.bytes) === payload.digest); expect(Boolean(known)).toBe(true); expect(content.equals(Buffer.from(known!.bytes))).toBe(true);
          if (payload.operation === "query") {
            expect(queryInputs.length).toBeLessThan(8); queryInputs.push(structuredClone(payload));
            expect(payload.workspaceId).toBe(workspaceId); expect(payload.query).toBe("Where does Line A go?"); expect(payload.maximumResults).toBe(5);
            if (queryFault === "cuda" && payload.embeddingDevice === "cuda") throw new Error(privateStartMarker);
            const source = known!.result.manifest.sources[0]!;
            data = { operation: "query", matches: [{ id: "harbor-chunk-0", excerpt, score: 0.875, citation: { sourceArtifactId: source.artifactId, sourceDigest: queryFault === "runtime-malformed" ? "invalid-digest" : source.digest, chunkIndex: 0 } }] };
          } else {
            expect(payload.operation).toBe("inspect-artifact");
            data = { operation: payload.operation, inspection: { manifest: known!.result.manifest, chunkCount: 1, packageEntries: known!.result.manifest.kind === "rag-database" ? ["manifest.json", "README.md", "chunks.jsonl"] : known!.result.manifest.manualEntries.length ? ["manifest.json", "README.md", "context.md"] : ["manifest.json", "README.md", "sources.md", "topics.md"], topics: [] } };
          }
        }
      }
      tasks.set(requestId, { requestId, workspaceId: request.workspaceId!, taskType: request.taskType, status: "succeeded", concurrencyClass: "cpu-heavy", startedAt: now, updatedAt: now, completedAt: now, data } as RuntimeTaskStatusRecord);
      return { requestId, status: "queued" };
    },
    async getTaskStatus(requestId) { expect(++runtimeReads).toBeLessThanOrEqual(40); const value = tasks.get(requestId); if (!value) throw new Error("Synthetic unknown task refused."); return value; },
    async cancelTask(requestId) { expect(tasks.has(requestId)).toBe(true); return { requestId, cancelled: true, status: "cancelled" }; },
    async listTasks() { return { tasks: [] }; },
  };
  feature = composeDesktopContextManagementFeature({ artifacts, runtime: { runtimeTaskRegistry: registry, taskPowerLifecycle: { startTask: async (id: string) => { powerStarts.push(id); }, completeTask: async (id: string) => { powerEnds.push(id); } } }, now: () => now });
  const facade = { executeCommand: (command: ContextManagementTransportCommand, requestContext: any) => track((async () => { expect(++calls).toBeLessThanOrEqual(100); commands.push(command); scopes.push({ action: command.action, workspaceId: requestContext.workspaceId }); if (command.action === "generation-save") await gate; if (command.action === "generation-start") generationStartFault?.(); const result = await feature.contextManagement.executeCommand(command, requestContext);
    // Declared post-application acknowledgement fault: production task output
    // validation is tested separately by runtime-malformed. This seam exercises
    // renderer admission of a malformed/foreign transport response.
    if (command.action === "browser-query" && result.ok && queryAckFault !== "none") {
      if (queryAckFault === "foreign") return { ...result, value: { ...result.value, result: { ...result.value.result, artifactId: "foreign-context-artifact" } } };
      const original = result.value.result.matches[0];
      const matches = queryAckFault === "excess"
        ? Array.from({ length: 6 }, (_, index) => ({ ...original, id: `excess-${index}`, excerpt: privateStartMarker }))
        : [{ ...original, excerpt: queryAckFault === "oversized" ? privateStartMarker.repeat(100) : privateStartMarker,
             ...(queryAckFault === "malformed" ? { score: "not-a-score" } : {}),
             ...(queryAckFault === "missing-citation" ? { citation: { ...original.citation, sourceDigest: undefined } } : {}) }];
      return { ...result, value: { ...result.value, result: { ...result.value.result, matches } } };
    }
    return result; })()) };
  if (host === "desktop") {
    const handlers = new Map<string, IpcMainHandleListener>(); const ipcMain: IpcMainHandlePort = { handle: (channel, handler) => { handlers.set(channel, handler as IpcMainHandleListener); } };
    registerContextManagementIpc({ ipcMain, senderTrust: { isTrustedSender: () => true }, contextManagement: facade, getAuthoritativeRequestContext: () => ({ principalId: context.principalId }) });
    registerArtifactBrowserIpc({ ipcMain, senderTrust: { isTrustedSender: () => true }, ...artifacts });
    const api = createDesktopPreloadApi({ ipcRenderer: { invoke: (channel, request) => { const handler = handlers.get(channel); if (!handler) return Promise.reject(new Error("Synthetic optional model operation unavailable.")); return track(Promise.resolve(handler({}, request)).then(response => { wireResponses.push(response); return response; })); } } });
    Object.defineProperty(window, "desktopApi", { configurable: true, value: api }); client = createDesktopContextManagementClient();
  } else {
    const app = express(); app.use(express.json({ limit: "32kb", strict: true }));
    app.use((_request, response, next) => { const send = response.json.bind(response); response.json = body => { wireResponses.push(body); return send(body); }; next(); });
    app.use((request, response, next) => { if (request.headers.authorization !== `Bearer ${token}`) { response.status(401).json({ ok: false, error: { code: "unauthorized", message: "Synthetic access denied." } }); return; } setExpressAuthContext(request, { authenticated: true, authMethod: "oidc-bearer", principal: { principalId: context.principalId, kind: "user", roles: ["organization-member"], scopes: ["artifact:read", "artifact:write"] } }); next(); });
    registerContextManagementApiRoutes({ app, contextManagement: facade }); registerArtifactBrowserApiRoutes({ app, ...artifacts, artifactMediaViewRetrieval: artifacts.artifactMediaViewRetrieval });
    server = createServer(app); await new Promise<void>((resolve, reject) => { server!.once("error", reject); server!.listen(0, "127.0.0.1", resolve); }); const address = server.address(); if (!address || typeof address === "string") throw new Error("Synthetic owned listener unavailable."); const base = `http://127.0.0.1:${address.port}/api`;
    const transport = createApiContextManagementClient(base), source = createApiArtifactBrowserClient({ apiBaseUrl: base });
    client = { execute: transport.execute, listSourceArtifacts: async ({ workspaceId }) => (await source.browseArtifacts({ workspaceId })).flatMap(value => evaluateContextSourceCapability({ fileName: value.originalName ?? value.storageKey, mediaType: value.mediaType }).ready ? [{ artifactId: value.storageKey, label: value.originalName ?? value.storageKey, mediaType: value.mediaType, sourceKind: value.sourceKind }] : []), listLocalTextModels: async () => [] };
  }
  container = document.createElement("div"); document.body.appendChild(container); root = createRoot(container);
}
function button(label: string) { const node = [...document.querySelectorAll<HTMLButtonElement>("button")].find(value => value.textContent?.trim() === label && !value.closest("[hidden]")); if (!node) throw new Error(`Missing visible button: ${label}`); return node; }
const hasButton = (label: string) => [...document.querySelectorAll("button")].some(value => value.textContent?.trim() === label && !value.closest("[hidden]"));
async function wait(predicate: () => boolean) { for (let i = 0; i < 400 && !predicate(); i++) await act(async () => { await new Promise(resolve => setTimeout(resolve, 10)); }); expect(predicate(), JSON.stringify({ calls, runtimeCalls, actions: commands.map(value => value.action) })).toBe(true); }
async function mount(scope: string = workspaceId) { await act(async () => root!.render(<NotificationTestHarness><ContextStudio workspaceId={scope} client={client} /></NotificationTestHarness>)); await wait(() => commands.some(value => value.action === "browser-list")); }
function setValue(node: HTMLInputElement | HTMLTextAreaElement, value: string) { const prototype = node instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype; Object.getOwnPropertyDescriptor(prototype, "value")!.set!.call(node, value); node.dispatchEvent(new Event("input", { bubbles: true })); }
const preparationSettled = () => hasButton("Save context pack") || Boolean(container?.querySelector('[role="alert"]')) || (wireResponses.some(value => value?.ok === false) && Boolean(container?.querySelector(".context-studio__message")?.textContent) && hasButton("Prepare context pack") && !button("Prepare context pack").disabled);
async function prepareManual() {
  await mount(); await act(async () => button("Context Packs").click()); const mode = [...document.querySelectorAll<HTMLButtonElement>("button")].find(value => value.textContent?.includes("Manual entry"))!; expect(Boolean(mode)).toBe(true); await act(async () => mode.click());
  const panel = container!.querySelector<HTMLElement>("[role='tabpanel']:not([hidden])")!;
  await act(async () => { setValue(panel.querySelector<HTMLInputElement>('input[placeholder="product-support-context"]')!, "Harbor Transit"); setValue(panel.querySelector<HTMLTextAreaElement>("textarea")!, manual); });
  await act(async () => button("Prepare context pack").click());
  await wait(preparationSettled);
}
async function records(scope = workspaceId) { const reopened = createLocalArtifactCatalogPersistenceAdapter({ rootDirectory: directory! }); const result = await reopened.browseArtifactCatalogRecords({ workspaceId: scope }, { ...context, workspaceId: scope }); expect(result.ok).toBe(true); if (!result.ok) throw new Error("Synthetic catalog read failed."); return result.value.records; }
async function saved() { const rows = (await records()).filter((row: any) => row.mediaType === CONTEXT_MARKDOWN_PACK_MEDIA_TYPE); expect(rows.length).toBe(1); return rows[0]!; }
async function saveAndOpenDetail() {
  await act(async () => button("Save context pack").click());
  await wait(() => hasButton("Rebuild") && hasButton("Delete"));
  return saved();
}
async function seedSource() {
  const key = "uploads/context-ui/harbor-transit.md";
  const result = await artifacts.storage.storeArtifact(createStoreArtifactRequest(new Uint8Array(Buffer.from(sourceText)), { descriptor: { key, mediaType: "text/markdown", metadata: { originalFileName: "harbor-transit.md", sourceKind: "upload" } } }), context);
  expect(result.ok).toBe(true); return key;
}
async function prepareSourcePack() {
  const source = await seedSource(); await mount(); await act(async () => button("Context Packs").click());
  const mode = [...document.querySelectorAll<HTMLButtonElement>("button")].find(value => value.textContent?.includes("From source materials"))!; expect(Boolean(mode)).toBe(true); await act(async () => mode.click());
  await wait(() => [...container!.querySelectorAll("label")].some(value => value.textContent?.includes("harbor-transit.md")));
  const choose = [...container!.querySelectorAll("label")].find(value => value.textContent?.includes("harbor-transit.md"))!.querySelector<HTMLInputElement>("input")!;
  await act(async () => choose.click());
  const panel = container!.querySelector<HTMLElement>("[role='tabpanel']:not([hidden])")!;
  await act(async () => setValue(panel.querySelector<HTMLInputElement>('input[placeholder="product-support-context"]')!, "Harbor Transit"));
  await act(async () => button("Prepare context pack").click());
  await wait(preparationSettled);
  return source;
}
async function prepareRag() {
  const source = await seedSource(); await mount();
  await wait(() => [...container!.querySelectorAll("label")].some(value => value.textContent?.includes("harbor-transit.md")));
  await act(async () => [...container!.querySelectorAll("label")].find(value => value.textContent?.includes("harbor-transit.md"))!.querySelector<HTMLInputElement>("input")!.click());
  await act(async () => setValue(container!.querySelector<HTMLInputElement>('input[placeholder="product-support-rag"]')!, "Harbor Transit retrieval"));
  const device = [...container!.querySelectorAll("label")].find(value => value.textContent?.trim().startsWith("Embedding device"))!.querySelector("select")!;
  await act(async () => { device.value = "auto"; device.dispatchEvent(new Event("change", { bubbles: true })); });
  await act(async () => button("Prepare RAG database").click()); await wait(() => hasButton("Approve and save RAG database"));
  expect((await records()).map(value => value.storageKey)).toEqual([source]);
  await act(async () => button("Review preview chunks").click());
  expect(document.querySelector('[role="dialog"]')?.textContent).toContain(sourceText);
  await act(async () => button("Approve chunk").click());
  await act(async () => document.querySelector<HTMLButtonElement>('[role="dialog"] [aria-label="Close dialog"]')!.click());
  expect(commands.some(value => value.action === "generation-save")).toBe(false);
  return source;
}
async function saveRag() {
  await act(async () => button("Approve and save RAG database").click()); await wait(() => hasButton("Run test query") && hasButton("Rebuild"));
  const rows = (await records()).filter(row => row.mediaType === CONTEXT_RAG_DATABASE_MEDIA_TYPE); expect(rows.length).toBe(1); return rows[0]!;
}
async function exactSavedBytes(row: Awaited<ReturnType<typeof saved>>) {
  const storage = createFilesystemArtifactObjectStorageAdapter({ rootDirectory: directory! });
  const value = await storage.retrieveArtifact(createRetrieveArtifactRequest(row.storageKey), context); expect(value.ok).toBe(true); if (!value.ok) throw new Error("Saved fixture bytes unavailable.");
  expect(digest(value.value.content).slice(7)).toBe(row.checksum?.value);
  const binding = await createLocalArtifactStorageBindingAdapter({ rootDirectory: directory! }).readArtifactStorageBindings({ workspaceId, artifactId: row.storageKey }, context);
  if (row.mediaType === CONTEXT_RAG_DATABASE_MEDIA_TYPE || row.mediaType === CONTEXT_MARKDOWN_PACK_MEDIA_TYPE) {
    expect(binding).toMatchObject({ ok: true, value: { bindings: [{ workspaceId, artifactId: row.storageKey, role: "primary", backing: { kind: "artifact-object", locator: row.storageKey } }] } });
  } else expect(binding).toMatchObject({ ok: true, value: { bindings: [] } }); // Existing upload fixture uses direct catalog/object backing.

  return Buffer.from(value.value.content);
}
async function queryRag(device: "cpu" | "cuda" | "auto") {
  const dialog = document.querySelector('[role="dialog"]')!;
  const select = [...dialog.querySelectorAll("label")].find(value => value.textContent?.trim().startsWith("Retrieval embedding device"))!.querySelector("select")!;
  const input = [...dialog.querySelectorAll("label")].find(value => value.textContent?.trim() === "Query")!.querySelector<HTMLInputElement>("input")!;
  await act(async () => { select.value = device; select.dispatchEvent(new Event("change", { bubbles: true })); setValue(input, "Where does Line A go?"); });
  const before = commands.filter(value => value.action === "browser-query").length;
  await act(async () => button("Run test query").click());
  await wait(() => commands.filter(value => value.action === "browser-query").length === before + 1 && !button("Run test query").disabled);
}
async function rebuildAndPreserve(row: Awaited<ReturnType<typeof saved>>, kind: "rag" | "pack") {
  const original = await exactSavedBytes(row), source = await exactSavedBytes((await records()).find(value => value.storageKey === "uploads/context-ui/harbor-transit.md")!);
  await act(async () => button("Rebuild").click()); const save = kind === "rag" ? "Approve and save RAG database" : "Save context pack";
  await wait(() => hasButton(save)); expect(document.querySelector(".artifact-browser__detail-dialog")).toBeNull(); expect((await records()).filter(value => value.mediaType === row.mediaType).length).toBe(1);
  expect((await exactSavedBytes(row)).equals(original)).toBe(true);
  await act(async () => button(save).click()); await wait(() => hasButton("Rebuild"));
  const rows = (await records()).filter(value => value.mediaType === row.mediaType); expect(rows.length).toBe(2); expect(new Set(rows.map(value => value.storageKey)).size).toBe(2);
  expect(rows.find(value => value.storageKey === row.storageKey)).toEqual(row); expect((await exactSavedBytes(row)).equals(original)).toBe(true);
  const successor = rows.find(value => value.storageKey !== row.storageKey)!; const output = results.get(requestIds[1]!)!;
  expect((await exactSavedBytes(successor)).equals(Buffer.from(output.bytes))).toBe(true);
  expect((await exactSavedBytes((await records()).find(value => value.storageKey === "uploads/context-ui/harbor-transit.md")!)).equals(source)).toBe(true);
  expect(output.result.manifest.sources[0]).toMatchObject({ artifactId: "uploads/context-ui/harbor-transit.md", digest: digest(source), chunkCount: 1, chunkingMode: "extracted" });
}
async function replaceOwnedOutput(output: { bytes: Uint8Array; stage: string }, bytes: Uint8Array) {
  const stage = await realpath(output.stage), info = await lstat(stage, { bigint: true }); expect({ dev: info.dev, ino: info.ino }).toEqual(stages.get(stage));
  const file = path.join(stage, "harbor-transit.zip"), stat = await lstat(file); expect(stat.isFile() && !stat.isSymbolicLink() && stat.nlink === 1 && path.dirname(await realpath(file)) === stage).toBe(true); expect(bytes.length).toBeLessThanOrEqual(128 * 1024);
  await writeFile(file, bytes, { flag: "r+" });
}
async function expectObjectAbsent(key: string) {
  const reopened = createFilesystemArtifactObjectStorageAdapter({ rootDirectory: directory! });
  expect(await reopened.retrieveArtifact(createRetrieveArtifactRequest(key), context)).toMatchObject({ ok: false, error: { code: "not-found" } });
}
function expectSafeFailure(message: string, privateValues: string[], code = "internal") {
  const failures = wireResponses.filter(value => value?.ok === false);
  expect(failures.length).toBeGreaterThan(0);
  expect(failures[failures.length - 1]).toMatchObject({ ok: false, error: { code, message } });
  for (const value of privateValues) { expect(JSON.stringify(wireResponses)).not.toContain(value); expect(document.body.textContent).not.toContain(value); }
}
function restoreEnvironment() { if (!environment) return; for (const [object, key, descriptor] of [[globalThis, "IS_REACT_ACT_ENVIRONMENT", environment.act], [window, "desktopApi", environment.api]] as const) { if (descriptor) Object.defineProperty(object, key, descriptor); else Reflect.deleteProperty(object, key); } if (environment.token === null) localStorage.removeItem(tokenKey); else localStorage.setItem(tokenKey, environment.token); for (const [key, value] of environment.sessions) if (value === null) sessionStorage.removeItem(key); else sessionStorage.setItem(key, value); }
afterEach(async () => {
  try {
    if (root) await act(async () => root!.unmount()); root = undefined; container?.remove(); container = undefined;
    await act(async () => { release?.(); await Promise.allSettled([...flights]); });
    for (const id of requestIds) await feature.generation.discard(id, context);
    if (server) { const owned = server; await new Promise<void>((resolve, reject) => owned.close(error => error ? reject(error) : resolve())); expect(owned.listening).toBe(false); server = undefined; }
    restoreEnvironment();
    for (const owned of stages.keys()) { let present = false; try { await lstat(owned); present = true; } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; } expect(present).toBe(false); }
    if (directory) { const owned = directory, info = await lstat(owned, { bigint: true }); expect({ dev: info.dev, ino: info.ino }).toEqual(identity); expect(info.isDirectory() && !info.isSymbolicLink() && await realpath(owned) === owned && path.dirname(owned) === await realpath(tmpdir())).toBe(true); let entries = 0, bytes = 0; async function inspect(parent: string) { for (const name of await readdir(parent)) { const file = path.join(parent, name), value = await lstat(file); expect(++entries).toBeLessThanOrEqual(256); expect(value.isSymbolicLink()).toBe(false); if (value.isDirectory()) await inspect(file); else { expect(value.isFile() && value.nlink === 1).toBe(true); bytes += value.size; expect(bytes).toBeLessThanOrEqual(1024 * 1024); } } } await inspect(owned); await rm(owned, { recursive: true }); }
  } finally { restoreEnvironment(); environment = undefined; directory = undefined; identity = undefined; gate = undefined; release = undefined; generationStartFault = undefined; runtimeStartFault = false; queryFault = queryAckFault = "none"; queryInputs.length = 0; calls = runtimeCalls = runtimeReads = 0; outputMismatch = false; commands.length = scopes.length = requestIds.length = powerStarts.length = powerEnds.length = wireResponses.length = 0; tasks.clear(); results.clear(); stages.clear(); flights.clear(); }
});
for (const host of ["desktop", "browser"] as const) {
  it(`${host}: reviews manual context privately then saves exact bytes and reopens durable records`, async () => {
    await compose(host); await prepareManual(); expect((await records()).length).toBe(0); expect(requestIds.length).toBe(1);
    await act(async () => button("Review prepared Markdown").click()); expect(document.querySelector('[role="dialog"]')?.textContent).toContain("Harbor Transit");
    // Closing a review is not consent to save.
    const close = document.querySelector<HTMLButtonElement>('[role="dialog"] [aria-label="Close dialog"]'); expect(Boolean(close)).toBe(true); await act(async () => close!.click());
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    const row = await saveAndOpenDetail(), output = results.get(requestIds[0]!)!; expect(row.checksum?.value).toBe(digest(output.bytes).slice(7));
    const reopened = createFilesystemArtifactObjectStorageAdapter({ rootDirectory: directory! }); const bytes = await reopened.retrieveArtifact(createRetrieveArtifactRequest(row.storageKey), context); expect(bytes.ok).toBe(true); if (!bytes.ok) throw new Error("Synthetic saved bytes unavailable."); expect(Buffer.from(bytes.value.content).equals(Buffer.from(output.bytes))).toBe(true);
    const binding = await createLocalArtifactStorageBindingAdapter({ rootDirectory: directory! }).readArtifactStorageBindings({ workspaceId, artifactId: row.storageKey }, context); expect(binding.ok).toBe(true);
    if (binding.ok) expect(binding.value.bindings).toEqual([{ workspaceId, artifactId: row.storageKey, backing: { kind: "artifact-object", provider: "local-filesystem", locator: row.storageKey }, role: "primary", createdAt: now }]);
    expect(JSON.stringify(row)).not.toContain(manual); expect((await records(foreign)).length).toBe(0);
    expect(commands.some(value => value.action === "browser-detail" && value.artifactId === row.storageKey)).toBe(true);
    expect(button("Rebuild").disabled).toBe(true);
    expect(document.querySelector('[role="dialog"]')?.textContent).toContain("Re-enter the manual context");
    const beforeDetails = commands.filter(value => value.action === "browser-detail").length;
    await act(async () => root!.unmount()); root = undefined;
    root = createRoot(container!); await mount(); await act(async () => button("Context Browser").click()); await wait(() => hasButton("View Details"));
    await act(async () => button("View Details").click()); await wait(() => hasButton("Rebuild"));
    expect(commands.filter(value => value.action === "browser-detail").length).toBeGreaterThan(beforeDetails);
    expect(commands[commands.length - 1]).toMatchObject({ action: "browser-detail", artifactId: row.storageKey });
    expect((await saved()).checksum?.value).toBe(row.checksum?.value);
  }, 15_000);
  it(`${host}: discards private reviewed context without publishing a catalog record`, async () => {
    await compose(host); await prepareManual(); await act(async () => button("Discard context pack").click()); await wait(() => hasButton("Prepare context pack"));
    expect((await records()).length).toBe(0); expect(commands.filter(value => value.action === "generation-save").length).toBe(0); expect(powerEnds).toContain(requestIds[0]!);
  }, 15_000);
  it(`${host}: rejects mismatched runtime output before save and permits a fresh corrected preparation`, async () => {
    await compose(host); outputMismatch = true; await prepareManual(); expect(hasButton("Save context pack")).toBe(false); expect((await records()).length).toBe(0);
    outputMismatch = false; await act(async () => button("Prepare context pack").click()); await wait(() => hasButton("Save context pack"));
    expect(requestIds.length).toBe(2); await act(async () => button("Discard context pack").click()); await wait(() => hasButton("Prepare context pack")); expect((await records()).length).toBe(0);
  }, 15_000);
  it(`${host}: admits one explicit save before the busy render`, async () => {
    await compose(host); await prepareManual(); gate = new Promise<void>(resolve => { release = resolve; });
    try {
      await act(async () => { const save = button("Save context pack"); save.click(); save.click(); });
      await wait(() => commands.some(value => value.action === "generation-save"));
      expect(commands.filter(value => value.action === "generation-save").length).toBe(1); expect((await records()).length).toBe(0);
    } finally { await act(async () => release?.()); }
    await wait(() => hasButton("Delete")); expect((await records()).length).toBe(1);
  }, 15_000);
  it(`${host}: refuses bytes changed after review and saves only after exact correction`, async () => {
    await compose(host); await prepareManual(); const output = results.get(requestIds[0]!)!;
    const changed = new Uint8Array(output.bytes); changed[changed.length - 1] ^= 1; await replaceOwnedOutput(output, changed);
    await act(async () => button("Save context pack").click()); await wait(() => hasButton("Save context pack") && !button("Save context pack").disabled);
    expect((await records()).length).toBe(0); expect(hasButton("Delete")).toBe(false);
    await replaceOwnedOutput(output, output.bytes); const row = await saveAndOpenDetail(); expect(row.checksum?.value).toBe(digest(output.bytes).slice(7));
  }, 15_000);
  it(`${host}: cancel and exact confirmation delete only the saved context artifact`, async () => {
    await compose(host); const unrelated = await seedSource(); await prepareManual(); const row = await saveAndOpenDetail();
    await act(async () => button("Delete").click()); expect(button("Confirm delete").disabled).toBe(true);
    await act(async () => setValue(document.querySelector<HTMLInputElement>('input[placeholder="Delete"]')!, "delete")); expect(button("Confirm delete").disabled).toBe(true);
    await act(async () => button("Cancel").click()); expect((await records()).length).toBe(2); expect(commands.filter(value => value.action === "browser-delete").length).toBe(0);
    await act(async () => button("Delete").click()); await act(async () => setValue(document.querySelector<HTMLInputElement>('input[placeholder="Delete"]')!, "Delete"));
    await act(async () => button("Confirm delete").click()); await wait(() => commands.some(value => value.action === "browser-delete") && document.querySelectorAll('[role="dialog"]').length === 0);
    expect((await records()).map(value => value.storageKey)).toEqual([unrelated]);
    const gone = await artifacts.storage.retrieveArtifact(createRetrieveArtifactRequest(row.storageKey), context); expect(gone.ok).toBe(false);
    const retained = await artifacts.storage.retrieveArtifact(createRetrieveArtifactRequest(unrelated), context); expect(retained.ok).toBe(true); if (retained.ok) expect(Buffer.from(retained.value.content).equals(Buffer.from(sourceText))).toBe(true);
  }, 15_000);
  it(`${host}: saves a no-summary source pack with exact staged source lineage`, async () => {
    await compose(host); const source = await seedSource(); await mount(); await act(async () => button("Context Packs").click());
    const mode = [...document.querySelectorAll<HTMLButtonElement>("button")].find(value => value.textContent?.includes("From source materials"))!; expect(Boolean(mode)).toBe(true); await act(async () => mode.click());
    await wait(() => [...container!.querySelectorAll("label")].some(value => value.textContent?.includes("harbor-transit.md")));
    const choose = [...container!.querySelectorAll("label")].find(value => value.textContent?.includes("harbor-transit.md"))!.querySelector<HTMLInputElement>("input")!;
    await act(async () => choose.click());
    const panel = container!.querySelector<HTMLElement>("[role='tabpanel']:not([hidden])")!;
    await act(async () => setValue(panel.querySelector<HTMLInputElement>('input[placeholder="product-support-context"]')!, "Harbor Transit"));
    await act(async () => button("Prepare context pack").click()); await wait(() => hasButton("Save context pack"));
    expect((await records()).map(value => value.storageKey)).toEqual([source]);
    const output = results.get(requestIds[0]!)!; expect(output.result.manifest.sources).toMatchObject([{ artifactId: source, digest: digest(new Uint8Array(Buffer.from(sourceText))), sizeBytes: Buffer.byteLength(sourceText), chunkCount: 1 }]);
    expect(output.result.manifest.manualEntries.length).toBe(0); expect(output.result.manifest.contextPack).toMatchObject({ inputMode: "source-materials", method: "none", cleaningPreset: "standard" });
    const row = await saveAndOpenDetail(); expect(button("Rebuild").disabled).toBe(false); expect((await records()).length).toBe(2);
    expect(row.checksum?.value).toBe(digest(output.bytes).slice(7));
  }, 15_000);
  it(`${host}: RAG review/save/query/rebuild preserves exact source, chunks, device and original bytes`, async () => {
    await compose(host); const source = await prepareRag(), prepared = results.get(requestIds[0]!)!;
    expect(prepared.result.manifest).toMatchObject({ kind: "rag-database", embedding: { provider: "transformers", modelId: "sentence-transformers/all-MiniLM-L6-v2", dimensions: 384 }, sources: [{ artifactId: source, digest: digest(new Uint8Array(Buffer.from(sourceText))), chunkCount: 1 }] });
    expect(prepared.result.manifest.embedding).not.toHaveProperty("device");
    expect(commands.find(value => value.action === "generation-start")).toMatchObject({ command: { kind: "rag-database", embedding: { modelId: "sentence-transformers/all-MiniLM-L6-v2", device: "auto" } } });
    const row = await saveRag(); expect((await exactSavedBytes(row)).equals(Buffer.from(prepared.bytes))).toBe(true); expect((await records(foreign)).length).toBe(0);
    await queryRag("auto"); const dialog = document.querySelector('[role="dialog"]')!;
    expect(dialog.textContent).toContain(excerpt); expect(dialog.textContent).toContain(`Score 0.875 · ${source} · chunk 1`);
    expect(queryInputs).toHaveLength(1); expect(queryInputs[0]).toMatchObject({ artifactId: row.storageKey, embeddingDevice: "auto", query: "Where does Line A go?", maximumResults: 5, digest: digest(prepared.bytes) });
    const queryResponses = wireResponses.filter(value => value?.ok && value.value?.action === "browser-query"); const response = queryResponses[queryResponses.length - 1];
    expect(response.value.result).toEqual({ artifactId: row.storageKey, matches: [{ id: "harbor-chunk-0", excerpt, score: 0.875, citation: { sourceArtifactId: source, sourceDigest: digest(new Uint8Array(Buffer.from(sourceText))), chunkIndex: 0 } }] });
    expect(JSON.stringify(response)).not.toContain('"vector"'); expect(JSON.stringify(response)).not.toContain('"embedding"');
    await rebuildAndPreserve(row, "rag");
  }, 20_000);
  it(`${host}: source-pack Rebuild refuses an unavailable source then permits explicit restored-source retry`, async () => {
    await compose(host); const source = await prepareSourcePack(), row = await saveAndOpenDetail(), original = await exactSavedBytes(row);
    const retrieve = artifacts.storage.retrieveArtifact.bind(artifacts.storage);
    artifacts.storage.retrieveArtifact = (request: any, scope: any) => request.key === source ? Promise.resolve({ ok: false, error: { code: "not-found", message: "Synthetic source is unavailable." } }) : retrieve(request, scope);
    try {
      await act(async () => button("Rebuild").click()); await wait(() => commands.some(value => value.action === "browser-rebuild") && !button("Rebuild").disabled);
      expect(requestIds).toHaveLength(1); expect((await records()).length).toBe(2); expect((await exactSavedBytes(row)).equals(original)).toBe(true);
      expect(container!.querySelector(".context-studio__message")?.textContent).toBe("This context artifact could not be rebuilt.");
    } finally { artifacts.storage.retrieveArtifact = retrieve; }
    await rebuildAndPreserve(row, "pack");
  }, 20_000);
  for (const mode of ["manual", "source-materials"] as const) it(`${host}: a fresh session preserves ${mode} pack rebuild rules and original bytes`, async () => {
    await compose(host);
    if (mode === "manual") await prepareManual(); else await prepareSourcePack();
    const row = await saveAndOpenDetail(), original = await exactSavedBytes(row), before = await records();
    // Destroy the renderer only: the same real clients, application, storage and
    // saved catalog survive, but no input mode is carried into the new session.
    await act(async () => root!.unmount()); root = createRoot(container!);
    await mount(); await act(async () => button("Context Browser").click());
    await wait(() => hasButton("View Details"));
    await act(async () => button("View Details").click()); await wait(() => hasButton("Rebuild"));
    expect(await records()).toEqual(before); expect((await exactSavedBytes(row)).equals(original)).toBe(true);
    if (mode === "manual") {
      expect(button("Rebuild").disabled).toBe(true);
      expect(document.querySelector(".artifact-browser__detail-dialog")?.textContent).toContain("Re-enter the manual context before rebuilding this pack.");
      await act(async () => button("Rebuild").click());
      expect(commands.some(value => value.action === "browser-rebuild")).toBe(false);
      expect(requestIds).toHaveLength(1); expect(await records()).toEqual(before);
      expect((await exactSavedBytes(row)).equals(original)).toBe(true);
      return;
    }
    const savedCalls = commands.filter(value => value.action === "generation-save").length;
    await act(async () => button("Rebuild").click()); await wait(() => hasButton("Save context pack"));
    expect(document.querySelector(".artifact-browser__detail-dialog")).toBeNull();
    const visible = container!.querySelector<HTMLElement>("[role='tabpanel']:not([hidden])")!;
    const modeControl = [...visible.querySelectorAll("button")].find(value => value.textContent?.includes("From source materials"))!;
    expect(modeControl.getAttribute("aria-pressed")).toBe("true");
    expect(commands.filter(value => value.action === "generation-save")).toHaveLength(savedCalls);
    expect(await records()).toEqual(before);
    await act(async () => button("Review prepared Markdown").click());
    expect(document.querySelector(".dataset-review__modal")?.textContent).toContain("A valid day pass covers both stops.");
    await act(async () => button("Approve section").click());
    await act(async () => document.querySelector<HTMLButtonElement>(".dataset-review__modal [aria-label='Close dialog']")!.click());
    await act(async () => button("Save context pack").click()); await wait(() => hasButton("Rebuild"));
    const after = await records(), packs = after.filter(value => value.mediaType === CONTEXT_MARKDOWN_PACK_MEDIA_TYPE);
    expect(packs).toHaveLength(2); expect(after).toHaveLength(before.length + 1);
    for (const prior of before) { expect(after.find(value => value.storageKey === prior.storageKey)).toEqual(prior); }
    expect((await exactSavedBytes(row)).equals(original)).toBe(true);
    const successor = packs.find(value => value.storageKey !== row.storageKey)!;
    expect(successor.storageKey).not.toBe(row.storageKey);
    const output = results.get(requestIds[1]!)!;
    expect((await exactSavedBytes(successor)).equals(Buffer.from(output.bytes))).toBe(true);
    expect(output.result.manifest.contextPack?.inputMode).toBe(mode);
    expect(output.result.manifest.sources).toEqual(results.get(requestIds[0]!)!.result.manifest.sources);
    expect(output.result.manifest.manualEntries).toEqual(results.get(requestIds[0]!)!.result.manifest.manualEntries);
    expect((await exactSavedBytes(before.find(value => value.storageKey === "uploads/context-ui/harbor-transit.md")!)).toString()).toBe(sourceText);
  }, 20_000);
  for (const failure of ["cuda", "runtime-malformed"] as const) it(`${host}: rejects ${failure} query output without fallback and allows explicit CPU correction`, async () => {
    await compose(host); await prepareRag(); const row = await saveRag(), before = await exactSavedBytes(row); queryFault = failure;
    await queryRag("cuda"); expect(queryInputs).toHaveLength(1); expect(queryInputs[0].embeddingDevice).toBe("cuda");
    expect(document.querySelector('[role="dialog"]')?.textContent).not.toContain(excerpt); expect(document.body.textContent).not.toContain(privateStartMarker);
    expect(container!.querySelector(".context-studio__message")?.textContent).toBe("The RAG test query could not be completed.");
    const failures = wireResponses.filter(value => value?.ok === false);
    expect(failures[failures.length - 1]).toMatchObject({ error: { code: "unavailable", message: "Context retrieval could not be completed. Verify the local model and selected embedding device, or choose CPU and retry." } });
    expect(JSON.stringify(wireResponses)).not.toContain(privateStartMarker);
    for (const stage of stages.keys()) expect(JSON.stringify(wireResponses)).not.toContain(stage);
    expect((await exactSavedBytes(row)).equals(before)).toBe(true);
    queryFault = "none"; await queryRag("cpu"); expect(queryInputs).toHaveLength(2); expect(queryInputs[1].embeddingDevice).toBeUndefined();
    expect(document.querySelector('[role="dialog"]')?.textContent).toContain(excerpt); expect((await exactSavedBytes(row)).equals(before)).toBe(true);
  }, 20_000);
  for (const failure of ["foreign", "malformed", "missing-citation", "oversized", "excess"] as const) it(`${host}: rejects ${failure} query acknowledgement before public rendering`, async () => {
    await compose(host); await prepareRag(); await saveRag();
    await queryRag("cpu"); expect(document.querySelector('[role="dialog"]')?.textContent).toContain(excerpt);
    queryAckFault = failure;
    await queryRag("cpu"); expect(document.querySelector('[role="dialog"]')?.textContent).not.toContain(excerpt); expect(document.body.textContent).not.toContain(privateStartMarker);
    expect(container!.querySelector(".context-studio__message")?.textContent).toMatch(/Context response|RAG test query/);
    queryAckFault = "none"; await queryRag("cpu"); expect(document.querySelector('[role="dialog"]')?.textContent).toContain(excerpt);
  }, 20_000);
  it(`${host}: compensates a late catalog refusal and retries without an orphan`, async () => {
    await compose(host); await prepareManual();
    const original = artifacts.artifactCatalog.appendArtifactCatalogRecord.bind(artifacts.artifactCatalog); let generatedAppends = 0, fail = true, failedKey = "";
    artifacts.artifactCatalog.appendArtifactCatalogRecord = async (input: any, requestContext: any) => {
      if (input.record.storageKey.startsWith("generated/context/")) { generatedAppends++; if (fail && generatedAppends === 2) { failedKey = input.record.storageKey; return { ok: false, error: { code: "unavailable", message: "Synthetic late catalog refusal." } }; } }
      return original(input, requestContext);
    };
    await act(async () => button("Save context pack").click()); await wait(() => generatedAppends === 2 && hasButton("Save context pack") && !button("Save context pack").disabled);
    expect((await records()).length).toBe(0); expect(failedKey.startsWith("generated/context/")).toBe(true); await expectObjectAbsent(failedKey); fail = false;
    await saveAndOpenDetail(); expect((await records()).length).toBe(1); await expectObjectAbsent(failedKey);
  }, 15_000);
  it(`${host}: keeps an actual staged read failure private in the transport and permits correction`, async () => {
    await compose(host); await prepareManual(); const output = results.get(requestIds[0]!)!, stage = await realpath(output.stage), file = path.join(stage, "harbor-transit.zip");
    const info = await lstat(stage, { bigint: true }); expect({ dev: info.dev, ino: info.ino }).toEqual(stages.get(stage));
    const stat = await lstat(file); expect(stat.isFile() && !stat.isSymbolicLink() && stat.nlink === 1 && path.dirname(await realpath(file)) === stage).toBe(true);
    await rm(file);
    try {
      await act(async () => button("Save context pack").click()); await wait(() => hasButton("Save context pack") && !button("Save context pack").disabled);
      expectSafeFailure("Context artifact could not be saved.", [stage, file, "ENOENT"]); expect((await records()).length).toBe(0); expect(hasButton("Delete")).toBe(false);
    } finally { await writeFile(file, output.bytes, { flag: "wx" }); }
    const row = await saveAndOpenDetail(); expect(row.checksum?.value).toBe(digest(output.bytes).slice(7));
  }, 15_000);
  for (const fault of ["exception", "contract"] as const) it(`${host}: redacts private ${fault} storage errors before the registered transport responds`, async () => {
    await compose(host); await prepareManual(); const store = artifacts.storage.storeArtifact.bind(artifacts.storage), marker = "synthetic-private-save-marker", stage = results.get(requestIds[0]!)!.stage;
    artifacts.storage.storeArtifact = async () => { const message = `${marker} ${stage}`; if (fault === "exception") throw new Error(message); return { ok: false, error: { code: "internal", message } }; };
    try {
      await act(async () => button("Save context pack").click()); await wait(() => hasButton("Save context pack") && !button("Save context pack").disabled);
      expectSafeFailure(fault === "exception" ? "Context artifact could not be saved." : "Context artifact could not be stored.", [marker, stage]); expect((await records()).length).toBe(0); expect(hasButton("Delete")).toBe(false);
    } finally { artifacts.storage.storeArtifact = store; }
    await saveAndOpenDetail(); expect((await records()).length).toBe(1);
  }, 15_000);
  it(`${host}: redacts refused runtime start details and retries the same manual input`, async () => {
    await compose(host); runtimeStartFault = true;
    try {
      await prepareManual(); await wait(() => container!.querySelector(".context-studio__message")?.textContent === "Context generation could not start."); expectSafeFailure("Context generation could not be started.", [privateStartMarker, ...stages.keys()]);
      expect(requestIds.length).toBe(0); expect(powerStarts.length).toBe(0); expect((await records()).length).toBe(0); expect(hasButton("Save context pack")).toBe(false);
      expect(container!.querySelector<HTMLTextAreaElement>("textarea")?.value).toBe(manual);
    } finally { runtimeStartFault = false; }
    await act(async () => button("Prepare context pack").click()); await wait(() => hasButton("Save context pack")); expect(requestIds.length).toBe(1);
    await act(async () => button("Discard context pack").click()); await wait(() => hasButton("Prepare context pack")); expect((await records()).length).toBe(0);
  }, 15_000);
  for (const port of ["binding", "storage"] as const) for (const fault of ["exception", "contract"] as const) it(`${host}: redacts ${port} ${fault} staging details and retains source retry`, async () => {
    await compose(host); const readBinding = artifacts.artifactBindings.readArtifactStorageBindings.bind(artifacts.artifactBindings), retrieve = artifacts.storage.retrieveArtifact.bind(artifacts.storage), marker = "synthetic-private-context-staging-marker";
    generationStartFault = () => {
      const refusal = async () => { const message = `${marker} ${directory}`; if (fault === "exception") throw new Error(message); return { ok: false, error: { code: "unavailable", message } }; };
      if (port === "binding") artifacts.artifactBindings.readArtifactStorageBindings = refusal;
      else artifacts.storage.retrieveArtifact = refusal;
    };
    let source = "";
    try {
      source = await prepareSourcePack();
      await wait(() => container!.querySelector(".context-studio__message")?.textContent === "Context generation could not start.");
      const message = fault === "exception" ? "Context sources could not be staged." : port === "binding" ? "Context source bindings could not be read. Retry when storage is available." : "Context source bytes could not be read. Check that the selected source is available.";
      expectSafeFailure(message, [marker, directory!], fault === "contract" ? "unavailable" : "internal");
      expect(requestIds.length).toBe(0); expect(powerStarts.length).toBe(0); expect(hasButton("Save context pack")).toBe(false); expect((await records()).map(value => value.storageKey)).toEqual([source]);
    } finally { generationStartFault = undefined; artifacts.artifactBindings.readArtifactStorageBindings = readBinding; artifacts.storage.retrieveArtifact = retrieve; }
    const retained = await artifacts.storage.retrieveArtifact(createRetrieveArtifactRequest(source), context); expect(retained.ok).toBe(true); if (retained.ok) expect(Buffer.from(retained.value.content).equals(Buffer.from(sourceText))).toBe(true);
    await act(async () => button("Prepare context pack").click()); await wait(() => hasButton("Save context pack")); expect(requestIds.length).toBe(1);
    const row = await saveAndOpenDetail(); expect(row.checksum?.value).toBe(digest(results.get(requestIds[0]!)!.bytes).slice(7));
  }, 15_000);
  it(`${host}: refuses an occupied catalog identity before storing or removing any bytes`, async () => {
    await compose(host); await prepareManual(); let writes = 0, deletes = 0;
    const read = artifacts.artifactCatalog.readArtifactCatalogRecord.bind(artifacts.artifactCatalog);
    artifacts.artifactCatalog.readArtifactCatalogRecord = async (input: any, requestContext: any) => input.storageKey.startsWith("generated/context/")
      ? { ok: true, value: { record: { workspaceId, storageKey: input.storageKey, artifactFamily: "binary", mediaType: CONTEXT_MARKDOWN_PACK_MEDIA_TYPE, sizeBytes: 1, sourceKind: "upload" } } }
      : read(input, requestContext);
    artifacts.storage.storeArtifact = async () => { writes++; throw new Error("Synthetic occupied identity must not be written."); };
    artifacts.storage.deleteArtifact = async () => { deletes++; throw new Error("Synthetic occupied identity must not be removed."); };
    await act(async () => button("Save context pack").click()); await wait(() => hasButton("Save context pack") && !button("Save context pack").disabled);
    expect(writes).toBe(0); expect(deletes).toBe(0); expect((await records()).length).toBe(0); expect(hasButton("Delete")).toBe(false);
  }, 15_000);
  it(`${host}: does not delete an object after storage refuses to acknowledge its write`, async () => {
    await compose(host); await prepareManual(); let deletes = 0;
    artifacts.storage.storeArtifact = async () => ({ ok: false, error: { code: "unavailable", message: "Synthetic write was not acknowledged." } });
    artifacts.storage.deleteArtifact = async () => { deletes++; throw new Error("Synthetic unacknowledged object must not be removed."); };
    await act(async () => button("Save context pack").click()); await wait(() => hasButton("Save context pack") && !button("Save context pack").disabled);
    expect(deletes).toBe(0); expect((await records()).length).toBe(0); expect(hasButton("Delete")).toBe(false);
  }, 15_000);
  it(`${host}: refuses foreign-workspace recovery before reading the private runtime result`, async () => {
    await compose(host); await prepareManual(); const beforeReads = runtimeReads;
    sessionStorage.setItem(sessionKey(foreign), requestIds[0]!); await mount(foreign);
    await wait(() => scopes.some(value => value.action === "generation-read" && value.workspaceId === foreign));
    expect(runtimeReads).toBe(beforeReads); expect(hasButton("Save context pack")).toBe(false); expect(container!.textContent).not.toContain(manual);
    expect((await records(foreign)).length).toBe(0); expect((await records()).length).toBe(0);
  }, 15_000);
  for (const fault of ["catalog", "object"] as const) it(`${host}: retains exact failed-save cleanup across ${fault} outage and retries before a new write`, async () => {
    await compose(host); await prepareManual();
    const append = artifacts.artifactCatalog.appendArtifactCatalogRecord.bind(artifacts.artifactCatalog), removeCatalog = artifacts.artifactCatalog.deleteArtifactCatalogRecord.bind(artifacts.artifactCatalog), removeObject = artifacts.storage.deleteArtifact.bind(artifacts.storage), store = artifacts.storage.storeArtifact.bind(artifacts.storage);
    let appends = 0, writes = 0, unavailable = true, failedKey = "";
    artifacts.storage.storeArtifact = async (...args: any[]) => { writes++; const result = await store(...args); if (writes === 1 && result.ok) failedKey = result.value.key; return result; };
    artifacts.artifactCatalog.appendArtifactCatalogRecord = async (...args: any[]) => { appends++; return appends === 2 ? { ok: false, error: { code: "unavailable", message: "Synthetic late catalog refusal." } } : append(...args); };
    artifacts.artifactCatalog.deleteArtifactCatalogRecord = async (...args: any[]) => fault === "catalog" && unavailable ? { ok: false, error: { code: "unavailable", message: "Synthetic catalog cleanup unavailable." } } : removeCatalog(...args);
    artifacts.storage.deleteArtifact = async (...args: any[]) => fault === "object" && unavailable ? { ok: false, error: { code: "unavailable", message: "Synthetic object cleanup unavailable." } } : removeObject(...args);
    try {
      await act(async () => button("Save context pack").click()); await wait(() => appends === 2 && hasButton("Save context pack") && !button("Save context pack").disabled);
      expect(writes).toBe(1); expect((await records()).length).toBe(fault === "catalog" ? 1 : 0);
      await act(async () => button("Save context pack").click()); await wait(() => !button("Save context pack").disabled);
      expect(writes).toBe(1); expect(hasButton("Delete")).toBe(false);
      unavailable = false; await saveAndOpenDetail(); expect(writes).toBe(2); expect((await records()).length).toBe(1); expect(failedKey.startsWith("generated/context/")).toBe(true); await expectObjectAbsent(failedKey);
    } finally { unavailable = false; }
  }, 15_000);
}
