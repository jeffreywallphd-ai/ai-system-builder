// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, expect, it } from "vitest";
import express from "express";
import { createServer, type Server } from "node:http";
import { createHash } from "node:crypto";
import { lstat, mkdtemp, readFile, readdir, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import golden from "./fixtures/dataset-row-review.parquet.json";
import { DatasetReviewWorkspace, type DatasetReviewWorkspaceService } from "../../../../modules/ui/shared/dataset-review";
import { NotificationTestHarness, readNotificationMessages } from "../../../../modules/ui/shared/notifications/tests/NotificationTestHarness";
import { createDesktopDatasetPreparationClient } from "../../../../apps/desktop/src/renderer/features/dataset-preparation/api/desktopDatasetPreparationClient";
import { createApiDatasetPreparationClient } from "../../../../apps/thin-client/src/features/dataset-preparation/api/apiDatasetPreparationClient";
import { createDesktopPreloadApi } from "../../../../apps/desktop/src/preload/exposedApi";
import { composeDesktopArtifactFeature } from "../../../../modules/hosts/desktop/composition/composeDesktopArtifactFeature";
import { composeDesktopDatasetPreparationFeature } from "../../../../modules/hosts/desktop/composition/composeDesktopDatasetPreparationFeature";
import { openLocalSqliteDatabase, type OpenedLocalSqliteDatabase } from "../../../../modules/adapters/persistence/sqlite/sqlite-database";
import { resolveLocalSqliteDatabasePolicy } from "../../../../modules/adapters/persistence/sqlite/local-sqlite-database-policy";
import { createStructuredDatasetVersionRepository } from "../../../../modules/adapters/persistence/dataset-version";
import { registerDatasetVersionIpc } from "../../../../modules/adapters/transport/ipc-electron/dataset-version/registerDatasetVersionIpc";
import { registerDatasetVersionApiRoutes } from "../../../../modules/adapters/transport/api-express/dataset-version/registerDatasetVersionApiRoutes";
import { setExpressAuthContext } from "../../../../modules/adapters/transport/api-express/security/expressAuthContext";
import type { IpcMainHandleListener, IpcMainHandlePort } from "../../../../modules/adapters/transport/ipc-electron/ipcMainHandlePort";
import type { RuntimeTaskRegistryPort } from "../../../../modules/application/ports/runtime";
import { TaskType, type RuntimeTaskStatusRecord } from "../../../../modules/contracts/runtime";
import { createWorkspaceId } from "../../../../modules/contracts/workspace";
import { createDeleteArtifactRequest, createRetrieveArtifactRequest, createStoreArtifactRequest } from "../../../../modules/contracts/storage";
import { createContractError, createFailureResult } from "../../../../modules/contracts/shared";

// Actual shared UI -> real app client/preload/registered IPC or owned HTTP ->
// actual application/SQLite/filesystem and production Parquet staging adapter.
// The registry is finite and returns checked golden codec outcomes. The same
// valid Parquet data has separate real model-free Python codec tests. This is
// not an actual sidecar, app-window, model/OCR/native/final qualification.
type Host = "desktop" | "browser";
type Variant = keyof typeof golden.variants;
const sha = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");
const bytes = (variant: Variant) => new Uint8Array(Buffer.from(golden.variants[variant].base64, "base64"));
const tokenKey = "ai-system-builder.paired-device-token", token = "synthetic-row-review-loopback-only";
let host: Host, serial = 0, workspaceId = createWorkspaceId("workspace.row-review-unmounted"), sourceKey = "unseeded-row-review";
let root: Root | undefined, container: HTMLDivElement | undefined, server: Server | undefined, directory: string | undefined;
let identity: { dev: bigint; ino: bigint } | undefined, database: OpenedLocalSqliteDatabase | undefined;
let artifacts: any, feature: any, client: any, service: DatasetReviewWorkspaceService;
let environment: { act?: PropertyDescriptor; api?: PropertyDescriptor; local: Map<string, string>; session: Map<string, string> } | undefined;
const flights = new Set<Promise<unknown>>(), tasks = new Map<string, RuntimeTaskStatusRecord>(), stages = new Map<string, { dev: bigint; ino: bigint }>();
const operations: { operation: string; variant: Variant; rowIndex: number; rowFingerprint: string; values?: unknown }[] = [];
const commands: { action: string; workspaceId: string }[] = [];
const requests: { action: string; workspaceId: string }[] = [];
let calls = 0, reads = 0, writes = 0, providerCalls = 0, clock = 0;
let mutationGate: Promise<void> | undefined, releaseMutation: (() => void) | undefined;
let replyGate: { action: "list" | "page"; promise: Promise<void> } | undefined, releaseReply: (() => void) | undefined;
const heldResults: any[] = [];
let storeFault: "contract" | "exception" | undefined;
const privateMarker = "synthetic-private-row-storage-detail", applicationFailures: string[] = [];
function track<T>(value: Promise<T>) { flights.add(value); void value.then(() => flights.delete(value), () => flights.delete(value)); return value; }
function uiCall<T>(action: string, scope: string, operation: () => Promise<T>) { expect(requests.length).toBeLessThan(100); requests.push({ action, workspaceId: scope }); return track(operation()); }
const context = () => ({ workspaceId, principalId: "principal.row-review-ui" });
const entries = (storage: Storage) => new Map(Object.keys(storage).map(key => [key, storage.getItem(key)!]));
const now = () => new Date(Date.UTC(2026, 9, 26, 18) + clock++ * 1000).toISOString();
async function compose(selected: Host) {
  host = selected; workspaceId = createWorkspaceId(`workspace.row-review-${++serial}`);
  environment = { act: Object.getOwnPropertyDescriptor(globalThis, "IS_REACT_ACT_ENVIRONMENT"), api: Object.getOwnPropertyDescriptor(window, "desktopApi"), local: entries(localStorage), session: entries(sessionStorage) };
  Object.defineProperty(globalThis, "IS_REACT_ACT_ENVIRONMENT", { configurable: true, writable: true, value: true }); localStorage.setItem(tokenKey, token);
  directory = await mkdtemp(path.join(await realpath(tmpdir()), "dataset-row-review-ui-")); const info = await lstat(directory, { bigint: true }); expect(info.ino !== 0n).toBe(true); identity = { dev: info.dev, ino: info.ino };
  database = await openLocalSqliteDatabase({ policy: resolveLocalSqliteDatabasePolicy({ dataRootDirectory: directory }) }); expect(database.checkHealth().healthy).toBe(true);
  artifacts = composeDesktopArtifactFeature({ storageRootDirectory: directory, documents: database.documents, loggingPort: { log: async () => {} }, workspaceShell: {}, now });
  const store = artifacts.storage.storeArtifact.bind(artifacts.storage);
  artifacts.storage.storeArtifact = (...args: any[]) => { expect(++writes).toBeLessThanOrEqual(40); if (storeFault && args[0].descriptor.metadata?.artifactRole === "edited-dataset") { if (storeFault === "exception") throw new Error(privateMarker); return Promise.resolve(createFailureResult(createContractError("unavailable", privateMarker))); } return store(...args); };
  const registry: RuntimeTaskRegistryPort = {
    async startTask(request) {
      expect(tasks.size).toBeLessThan(60); expect(request.taskType).toBe(TaskType.DATASET_REVIEW); const payload = request.payload as any, id = request.requestId!;
      const stage = await realpath(payload.runtime.runtimeWorkingDirectory), info = await lstat(stage, { bigint: true }); expect(path.dirname(stage)).toBe(await realpath(tmpdir())); expect(info.isDirectory() && !info.isSymbolicLink()).toBe(true); stages.set(stage, { dev: info.dev, ino: info.ino });
      const input = await realpath(payload.inputPath), stat = await lstat(input); expect(path.dirname(input)).toBe(stage); expect(stat.isFile() && !stat.isSymbolicLink() && stat.nlink === 1 && stat.size < 65536).toBe(true); const inputBytes = new Uint8Array(await readFile(input));
      const variant = (Object.keys(golden.variants) as Variant[]).find(key => golden.variants[key].sha256 === sha(inputBytes)); if (!variant) throw new Error("Unknown synthetic codec input refused.");
      const fixture = golden.variants[variant]; expect(Buffer.from(inputBytes).equals(Buffer.from(bytes(variant)))).toBe(true); operations.push({ operation: payload.operation, variant, rowIndex: payload.rowIndex, rowFingerprint: payload.rowFingerprint, ...(payload.replacementRow ? { values: payload.replacementRow } : {}) });
      let data: unknown;
      if (payload.operation === "read") { expect(payload.pageSize).toBe(10); expect(Number.isSafeInteger(payload.page) && payload.page >= 0 && payload.page < fixture.pages.length).toBe(true); data = fixture.pages[payload.page]; }
      else {
        expect(payload.rowIndex).toBe(0); expect(payload.rowFingerprint).toBe(fixture.pages[0]!.rows[0]!.rowFingerprint); let target: Variant;
        if (payload.operation === "replace" && variant === "source") { expect(payload.replacementRow).toEqual(golden.editedRow); target = "edited"; }
        else if (payload.operation === "reject" && (variant === "source" || variant === "edited")) target = variant === "source" ? "rejected" : "edited-rejected";
        else throw new Error("Unknown synthetic codec operation refused.");
        expect(payload.outputHandle).toBe("reviewed.parquet"); await writeFile(path.join(stage, payload.outputHandle), bytes(target), { flag: "wx" }); data = { outputHandle: payload.outputHandle, totalRows: golden.variants[target].rows.length };
      }
      tasks.set(id, { requestId: id, workspaceId, taskType: request.taskType, status: "succeeded", concurrencyClass: "cpu-heavy", startedAt: now(), updatedAt: now(), completedAt: now(), data } as RuntimeTaskStatusRecord); return { requestId: id, status: "queued" };
    },
    async getTaskStatus(id) { expect(++reads).toBeLessThanOrEqual(200); const task = tasks.get(id); if (!task) throw new Error("Unknown synthetic row task refused."); return task; },
    async cancelTask(id) { expect(tasks.has(id)).toBe(true); return { requestId: id, cancelled: true, status: "cancelled" }; },
    async listTasks() { return { tasks: [] }; },
  };
  feature = composeDesktopDatasetPreparationFeature({ artifacts, documents: database.documents, runtime: { runtimeTaskRegistry: registry, taskPowerLifecycle: { startTask: async () => {}, completeTask: async () => {} } }, getArtifactRemoteFeatures: async () => { providerCalls++; throw new Error("Synthetic external action refused."); }, now });
  for (const [key, action] of [["listDatasetReviewTargetsUseCase", "list"], ["readDatasetReviewPageUseCase", "page"], ["rejectDatasetReviewRowUseCase", "reject"], ["editDatasetReviewRowUseCase", "edit"]] as const) {
    const actual = feature[key]; feature[key] = { execute: (input: any, scope: any) => track((async () => { expect(++calls).toBeLessThanOrEqual(100); commands.push({ action, workspaceId: input.workspaceId }); const held = replyGate?.action === action ? replyGate : undefined; if (action === "edit" || action === "reject") await mutationGate; try { const result = await actual.execute(input, scope); if (held) { expect(heldResults.length).toBeLessThan(4); heldResults.push(result); await held.promise; } return result; } catch (error) { expect(applicationFailures.length).toBeLessThan(8); applicationFailures.push(error instanceof Error ? error.message : String(error)); throw error; } })()) };
  }
  if (host === "desktop") {
    const handlers = new Map<string, IpcMainHandleListener>(), ipcMain: IpcMainHandlePort = { handle: (name, handler) => { handlers.set(name, handler as IpcMainHandleListener); } };
    registerDatasetVersionIpc({ ipcMain, ...feature, getAuthoritativeRequestContext: () => ({ principalId: context().principalId }) });
    const api = createDesktopPreloadApi({ ipcRenderer: { invoke: (name, request) => { const handler = handlers.get(name); if (!handler) return Promise.reject(new Error("Synthetic unsupported operation refused.")); return track(Promise.resolve(handler({}, request))); } } }); Object.defineProperty(window, "desktopApi", { configurable: true, value: api }); client = createDesktopDatasetPreparationClient();
    service = { listTargets: scope => uiCall("list", scope, () => client.listReviewTargets(scope)), readPage: input => uiCall("page", input.workspaceId, () => client.readReviewPage(input)), editRow: input => uiCall("edit", input.workspaceId, () => client.editReviewRow(input)), rejectRow: input => uiCall("reject", input.workspaceId, () => client.rejectReviewRow(input)) };
  } else {
    const app = express(); app.use(express.json({ limit: "32kb", strict: true })); app.use((request, response, next) => { if (request.headers.authorization !== `Bearer ${token}`) { response.status(401).json({ ok: false, error: { code: "unauthorized", message: "Synthetic access denied." } }); return; } setExpressAuthContext(request, { authenticated: true, authMethod: "oidc-bearer", principal: { principalId: context().principalId, kind: "user", roles: ["organization-member"], scopes: ["artifact:read", "artifact:write"] } }); next(); }); registerDatasetVersionApiRoutes({ app, ...feature });
    server = createServer(app); await new Promise<void>((resolve, reject) => { server!.once("error", reject); server!.listen(0, "127.0.0.1", resolve); }); const address = server.address(); if (!address || typeof address === "string") throw new Error("Owned listener is unavailable."); client = createApiDatasetPreparationClient(`http://127.0.0.1:${address.port}/api`);
    service = { listTargets: scope => uiCall("list", scope, async () => (await client.listReviewTargets({ workspaceId: scope })).groups), readPage: input => uiCall("page", input.workspaceId, async () => (await client.readReviewPage(input)).page), editRow: input => uiCall("edit", input.workspaceId, () => client.editReviewRow(input)), rejectRow: input => uiCall("reject", input.workspaceId, () => client.rejectReviewRow(input)) };
  }
  const seed = await artifacts.storage.storeArtifact(createStoreArtifactRequest(bytes("source"), { descriptor: { mediaType: "application/vnd.apache.parquet", metadata: { workspaceId, originalFileName: "transit-training.parquet" } } }), context()); expect(seed.ok).toBe(true); if (!seed.ok) throw new Error("Synthetic source could not be stored."); sourceKey = String(seed.value.key);
  container = document.createElement("div"); document.body.appendChild(container); root = createRoot(container);
}
function restore() {
  if (!environment) return; for (const [object, key, descriptor] of [[globalThis, "IS_REACT_ACT_ENVIRONMENT", environment.act], [window, "desktopApi", environment.api]] as const) if (descriptor) Object.defineProperty(object, key, descriptor); else Reflect.deleteProperty(object, key);
  for (const [storage, baseline] of [[localStorage, environment.local], [sessionStorage, environment.session]] as const) { for (const key of Object.keys(storage)) if (!baseline.has(key)) storage.removeItem(key); for (const [key, value] of baseline) storage.setItem(key, value); }
}
afterEach(async () => {
  try {
    if (root) await act(async () => root!.unmount()); root = undefined; container?.remove(); container = undefined; releaseMutation?.(); releaseReply?.(); await Promise.allSettled([...flights]);
    if (server) { const owned = server; await new Promise<void>((resolve, reject) => owned.close(error => error ? reject(error) : resolve())); expect(owned.listening).toBe(false); server = undefined; } database?.close(); database = undefined; restore();
    for (const stage of stages.keys()) { let present = false; try { await lstat(stage); present = true; } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; } expect(present).toBe(false); }
    if (directory) { const owned = directory, info = await lstat(owned, { bigint: true }); expect({ dev: info.dev, ino: info.ino }).toEqual(identity); expect(info.isDirectory() && !info.isSymbolicLink() && await realpath(owned) === owned && path.dirname(owned) === await realpath(tmpdir())).toBe(true); let count = 0, size = 0; async function inspect(parent: string) { for (const name of await readdir(parent)) { const file = path.join(parent, name), info = await lstat(file); expect(++count).toBeLessThanOrEqual(256); expect(info.isSymbolicLink()).toBe(false); if (info.isDirectory()) await inspect(file); else { expect(info.isFile() && info.nlink === 1).toBe(true); size += info.size; expect(size).toBeLessThanOrEqual(4 * 1024 * 1024); } } } await inspect(owned); await rm(owned, { recursive: true }); }
  } finally { restore(); environment = undefined; directory = undefined; identity = undefined; server = undefined; database = undefined; mutationGate = undefined; releaseMutation = undefined; replyGate = undefined; releaseReply = undefined; storeFault = undefined; applicationFailures.length = heldResults.length = 0; calls = reads = writes = providerCalls = clock = 0; flights.clear(); tasks.clear(); stages.clear(); commands.length = operations.length = requests.length = 0; }
});
const tableRows = () => [...container!.querySelectorAll("table.dataset-review__table tbody tr")];
function button(label: string, scope: ParentNode = container!) { const value = [...scope.querySelectorAll<HTMLButtonElement>("button")].find(node => node.textContent?.trim() === label); if (!value) throw new Error(`Missing row-review button: ${label}`); return value; }
async function wait(predicate: () => boolean) { for (let n = 0; n < 400 && !predicate(); n++) await act(async () => { await new Promise(resolve => setTimeout(resolve, 10)); }); expect(predicate(), JSON.stringify({ commands, operationCount: operations.length, notifications: container ? readNotificationMessages(container) : [] })).toBe(true); }
async function renderReview(nextService = service, scope: string = workspaceId) { await act(async () => root!.render(<NotificationTestHarness><DatasetReviewWorkspace workspaceId={scope} service={nextService} /></NotificationTestHarness>)); }
async function mount(nextService = service, scope = workspaceId) { await renderReview(nextService, scope); await wait(() => tableRows().length === 10); }
const formatted = (value: unknown) => typeof value === "string" ? value : JSON.stringify(value, null, 2);
function assertRows(variant: Variant, page = 0) { const expected = golden.variants[variant].rows.slice(page * 10, page * 10 + 10); expect(tableRows().map(row => ({ index: row.querySelector("th")!.textContent, values: [...row.querySelectorAll("td pre")].map(value => value.textContent) }))).toEqual(expected.map((row, index) => ({ index: String(page * 10 + index + 1), values: Object.values(row).map(formatted) }))); }
function change(node: HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement, value: string) { const prototype = node instanceof HTMLSelectElement ? HTMLSelectElement.prototype : node instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype; Object.getOwnPropertyDescriptor(prototype, "value")!.set!.call(node, value); node.dispatchEvent(new Event(node instanceof HTMLSelectElement ? "change" : "input", { bubbles: true })); }
async function editFirst() { await act(async () => button("Edit", tableRows()[0]!).click()); await wait(() => Boolean(document.querySelector('[role="dialog"] .dataset-review__editor'))); await act(async () => { for (const label of document.querySelectorAll<HTMLLabelElement>('[role="dialog"] .dataset-review__editor label')) { const name = label.querySelector("strong")!.textContent as keyof typeof golden.editedRow, value = label.querySelector<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>("input,select,textarea")!; change(value, typeof golden.editedRow[name] === "object" ? JSON.stringify(golden.editedRow[name]) : String(golden.editedRow[name])); } }); }
function editor(name: string) { const label = [...document.querySelectorAll<HTMLLabelElement>('[role="dialog"] .dataset-review__editor label')].find(node => node.querySelector("strong")?.textContent === name); if (!label) throw new Error(`Missing typed row editor: ${name}`); return label.querySelector<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>("input,select,textarea")!; }
async function versions() { return createStructuredDatasetVersionRepository(database!.documents).listVersions(workspaceId); }
async function assertBytes(key: string, variant: Variant) { const result = await artifacts.storage.retrieveArtifact(createRetrieveArtifactRequest(key), context()); expect(result.ok).toBe(true); if (!result.ok) throw new Error("Synthetic saved row bytes unavailable."); expect(Buffer.from(result.value.content).equals(Buffer.from(bytes(variant)))).toBe(true); }
async function assertPersistedLineage(variant: "edited" | "rejected") {
  const saved = await versions(); expect(saved).toHaveLength(2);
  const roots = saved.filter(value => value.lineage.parentVersionId === undefined), children = saved.filter(value => value.lineage.parentVersionId !== undefined);
  expect(roots).toHaveLength(1); expect(children).toHaveLength(1); const parent = roots[0]!, child = children[0]!;
  expect(child.lineage.parentVersionId).toBe(parent.versionId); expect(child.versionId).not.toBe(parent.versionId); expect(child.datasetId).toBe(parent.datasetId);
  const sources = [{ sourceArtifactId: sourceKey, artifactKey: sourceKey, digest: `sha256:${golden.variants.source.sha256}`, mediaType: "application/vnd.apache.parquet" }];
  const originalFingerprint = golden.variants.source.pages[0]!.rows[0]!.rowFingerprint;
  const replacementFingerprint = `sha256:${sha(Buffer.from(JSON.stringify(golden.editedRow)))}`;
  const recipe = { operation: variant === "edited" ? "dataset-row-edit" : "dataset-row-review", parentVersionId: parent.versionId, rowIndex: 0, originalRowFingerprint: originalFingerprint, ...(variant === "edited" ? { replacementFingerprint } : {}) };
  const reportFingerprint = `sha256:${sha(Buffer.from(JSON.stringify({ operation: variant === "edited" ? "edit-row" : "reject-row", parentVersionId: parent.versionId, rowIndex: 0, rowFingerprint: originalFingerprint, ...(variant === "edited" ? { replacementFingerprint } : {}) })))}`;
  expect(child.lineage.quality.reportFingerprint).toBe(reportFingerprint);
  expect(child.lineage.quality).toMatchObject({ policyId: "manual-row-review", policyVersion: "1.0.0", policyFingerprint: parent.lineage.quality.policyFingerprint });
  for (const [record, data, expectedRecipe, implementation] of [[parent, "source", { operation: "imported-dataset-baseline", artifactKey: sourceKey }, "builtin.imported-dataset"], [child, variant, recipe, variant === "edited" ? "builtin.dataset-row-edit" : "builtin.dataset-row-review"]] as const) {
    expect(record.workspaceId).toBe(workspaceId); expect(record.createdBy).toBe(context().principalId); expect(record.datasetId).toBe("transit-training.parquet"); expect(record.totalRows).toBe(golden.variants[data].rows.length); expect(record.lineage.sources).toEqual(sources);
    const dataset = record.artifacts.filter(value => value.role === "dataset"); expect(dataset).toHaveLength(1);
    expect(dataset[0]).toEqual({ role: "dataset", artifactKey: data === "source" ? sourceKey : `dataset-versions/reviews/${golden.variants[data].sha256}.parquet`, digest: `sha256:${golden.variants[data].sha256}`, mediaType: "application/vnd.apache.parquet", sizeBytes: golden.variants[data].sizeBytes, ...(data === "source" ? {} : { rowCount: golden.variants[data].rows.length }) });
    await assertBytes(String(dataset[0]!.artifactKey), data);
    const stored = await artifacts.storage.retrieveArtifact(createRetrieveArtifactRequest(record.lineage.recipe.artifactKey), context()); expect(stored.ok).toBe(true); if (!stored.ok) throw new Error("Synthetic saved mutation recipe unavailable.");
    const raw = Buffer.from(stored.value.content), digest = `sha256:${sha(raw)}`; expect(JSON.parse(raw.toString("utf8"))).toEqual(expectedRecipe);
    expect(record.lineage.recipe).toEqual({ artifactKey: record.artifacts.find(value => value.role === "recipe")!.artifactKey, digest, implementationId: implementation, implementationVersion: "1.0.0" });
    expect(record.artifacts.find(value => value.role === "recipe")).toMatchObject({ digest, sizeBytes: raw.byteLength });
  }
  return saved;
}
for (const selected of ["desktop", "browser"] as const) {
  it(`${selected}: pages every typed record through real transports without changing source bytes`, async () => {
    await compose(selected); await mount(); assertRows("source"); expect(button("Previous page").disabled).toBe(true); expect(button("Next page").disabled).toBe(false); await act(async () => button("Next page").click()); await wait(() => tableRows().length === 2); assertRows("source", 1); expect(button("Next page").disabled).toBe(true); await act(async () => button("Previous page").click()); await wait(() => tableRows().length === 10); assertRows("source"); expect(await versions()).toEqual([]); await assertBytes(sourceKey, "source"); expect(providerCalls).toBe(0);
  }, 20_000);
  it(`${selected}: edits typed row fields into an immutable successor and keeps the original exact bytes`, async () => {
    await compose(selected); await mount(); await editFirst(); await act(async () => button("Approve changes", document.querySelector('[role="dialog"]')!).click()); await wait(() => tableRows()[0]?.textContent?.includes(golden.editedRow.text) === true); assertRows("edited"); const saved = await versions(); expect(saved.length).toBe(2); const updated = saved.find(value => value.lineage.parentVersionId)!; expect(updated).toBeDefined(); expect(updated.totalRows).toBe(12); const key = updated.artifacts.find(value => value.role === "dataset")!.artifactKey; expect(updated.artifacts.find(value => value.role === "dataset")!.digest).toBe(`sha256:${golden.variants.edited.sha256}`); await assertBytes(key, "edited"); await assertBytes(sourceKey, "source"); await assertPersistedLineage("edited"); expect(providerCalls).toBe(0);
  }, 20_000);
  it(`${selected}: rejects the reviewed row into a new version without changing its original`, async () => {
    await compose(selected); await mount(); await act(async () => button("Reject", tableRows()[0]!).click()); await wait(() => container!.textContent?.includes("11 rows") === true && tableRows()[0]?.textContent?.includes(golden.variants.rejected.rows[0]!.text) === true); assertRows("rejected"); const saved = await versions(); expect(saved.length).toBe(2); const updated = saved.find(value => value.lineage.parentVersionId)!; expect(updated.totalRows).toBe(11); await assertBytes(updated.artifacts.find(value => value.role === "dataset")!.artifactKey, "rejected"); await assertBytes(sourceKey, "source"); await assertPersistedLineage("rejected"); expect(providerCalls).toBe(0);
  }, 20_000);
  for (const intent of ["edit-twice", "reject-twice", "reject-two-rows"] as const) it(`${selected}: admits one ${intent} action before busy rendering`, async () => {
    await compose(selected); await mount(); if (intent === "edit-twice") await editFirst(); mutationGate = new Promise<void>(resolve => { releaseMutation = resolve; });
    try {
      await act(async () => { if (intent !== "edit-twice") { const reject = button("Reject", tableRows()[0]!), next = intent === "reject-two-rows" ? button("Reject", tableRows()[1]!) : reject; reject.click(); next.click(); } else { const save = button("Approve changes", document.querySelector('[role="dialog"]')!); save.click(); save.click(); } });
      expect(requests.filter(value => value.action === "edit" || value.action === "reject").map(value => value.action)).toEqual([intent === "edit-twice" ? "edit" : "reject"]); await wait(() => commands.some(value => value.action === "edit" || value.action === "reject")); expect(commands.filter(value => value.action === "edit" || value.action === "reject").map(value => value.action)).toEqual([intent === "edit-twice" ? "edit" : "reject"]); expect(await versions()).toEqual([]);
    } finally { await act(async () => { releaseMutation?.(); await Promise.allSettled([...flights]); }); }
    await wait(() => tableRows()[0]?.textContent?.includes(intent === "edit-twice" ? golden.editedRow.text : golden.variants.rejected.rows[0]!.text) === true); assertRows(intent === "edit-twice" ? "edited" : "rejected"); expect((await versions()).length).toBe(2); await assertBytes(sourceKey, "source");
  }, 20_000);
  for (const invalid of ["blank-number", "broken-json"] as const) it(`${selected}: corrects ${invalid} locally without changing the saved dataset`, async () => {
    await compose(selected); await mount(); await editFirst(); await act(async () => change(editor(invalid === "blank-number" ? "priority" : "tags"), invalid === "blank-number" ? "" : "[invalid-json")); await act(async () => button("Approve changes", document.querySelector('[role="dialog"]')!).click());
    expect(requests.filter(value => value.action === "edit")).toEqual([]); expect(commands.filter(value => value.action === "edit")).toEqual([]); expect(await versions()).toEqual([]); expect(Boolean(document.querySelector('[role="dialog"] .dataset-review__editor'))).toBe(true); await assertBytes(sourceKey, "source");
    await act(async () => change(editor(invalid === "blank-number" ? "priority" : "tags"), invalid === "blank-number" ? "99" : JSON.stringify(golden.editedRow.tags))); await act(async () => button("Approve changes", document.querySelector('[role="dialog"]')!).click()); await wait(() => tableRows()[0]?.textContent?.includes(golden.editedRow.text) === true); assertRows("edited");
  }, 20_000);
  for (const retirement of ["workspace", "client", "unmount"] as const) it(`${selected}: ignores a completed old dataset list after ${retirement}`, async () => {
    await compose(selected); replyGate = { action: "list", promise: new Promise<void>(resolve => { releaseReply = resolve; }) };
    try {
      await renderReview(); await wait(() => heldResults.length === 1); expect(heldResults[0].length).toBe(1); const oldName = heldResults[0][0].name; replyGate = undefined;
      if (retirement === "unmount") { await act(async () => root!.unmount()); root = undefined; }
      else {
        if (retirement === "client") { const removed = await artifacts.storage.deleteArtifact(createDeleteArtifactRequest(sourceKey), context()); expect(removed.ok).toBe(true); await renderReview({ ...service }); }
        else await renderReview(service, "workspace.row-review-new-scope");
        await wait(() => container!.textContent?.includes("No local Parquet datasets are available") === true);
      }
      await act(async () => { releaseReply?.(); await Promise.allSettled([...flights]); }); expect(requests.filter(value => value.action === "page")).toEqual([]); expect(container!.textContent).not.toContain(oldName); expect(tableRows()).toEqual([]); expect(providerCalls).toBe(0);
    } finally { await act(async () => { releaseReply?.(); await Promise.allSettled([...flights]); }); }
  }, 20_000);
  for (const retirement of ["workspace", "client", "unmount"] as const) it(`${selected}: finishes an accepted edit without changing the retired ${retirement} view`, async () => {
    await compose(selected); await mount(); await editFirst(); mutationGate = new Promise<void>(resolve => { releaseMutation = resolve; });
    try {
      await act(async () => button("Approve changes", document.querySelector('[role="dialog"]')!).click()); await wait(() => commands.some(value => value.action === "edit")); mutationGate = undefined;
      if (retirement === "unmount") { await act(async () => root!.unmount()); root = undefined; }
      else if (retirement === "workspace") { await renderReview(service, "workspace.row-review-next"); await wait(() => container!.textContent?.includes("No local Parquet datasets") === true); }
      else { await renderReview({ ...service }); await wait(() => tableRows().length === 10); assertRows("source"); }
      const listCount = requests.filter(value => value.action === "list").length;
      await act(async () => { releaseMutation?.(); await Promise.allSettled([...flights]); }); expect((await versions()).length).toBe(2); expect(requests.filter(value => value.action === "list").length).toBe(listCount); await assertBytes(sourceKey, "source");
      if (retirement === "client") assertRows("source"); else expect(tableRows()).toEqual([]);
      expect(readNotificationMessages(container!).some(value => value.startsWith("Changes approved."))).toBe(false);
    } finally { await act(async () => { releaseMutation?.(); await Promise.allSettled([...flights]); }); }
  }, 20_000);
  it(`${selected}: ignores a delayed next page after the user returns to the first page`, async () => {
    await compose(selected); await mount(); replyGate = { action: "page", promise: new Promise<void>(resolve => { releaseReply = resolve; }) };
    try { await act(async () => button("Next page").click()); await wait(() => heldResults.length === 1); replyGate = undefined; await act(async () => button("View table").click()); await wait(() => tableRows().length === 10); assertRows("source"); await act(async () => { releaseReply?.(); await Promise.allSettled([...flights]); }); assertRows("source"); expect(container!.textContent).toContain("12 rows - Page 1"); }
    finally { await act(async () => { releaseReply?.(); await Promise.allSettled([...flights]); }); }
  }, 20_000);
  it(`${selected}: disables typed fields and local selection while an edit is accepted`, async () => {
    await compose(selected); await mount(); await editFirst(); mutationGate = new Promise<void>(resolve => { releaseMutation = resolve; });
    try { await act(async () => button("Approve changes", document.querySelector('[role="dialog"]')!).click()); await wait(() => commands.some(value => value.action === "edit")); expect([...document.querySelectorAll<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>('[role="dialog"] .dataset-review__editor input,[role="dialog"] .dataset-review__editor select,[role="dialog"] .dataset-review__editor textarea')].every(value => value.disabled)).toBe(true); expect(container!.querySelector<HTMLSelectElement>("select")!.disabled).toBe(true); expect(button("Cancel", document.querySelector('[role="dialog"]')!).disabled).toBe(true); }
    finally { await act(async () => { releaseMutation?.(); await Promise.allSettled([...flights]); }); }
    await wait(() => tableRows()[0]?.textContent?.includes(golden.editedRow.text) === true); assertRows("edited");
  }, 20_000);
  for (const fault of ["contract", "exception"] as const) it(`${selected}: retains the exact draft after a ${fault} storage failure and retries without private text`, async () => {
    await compose(selected); await mount(); await editFirst(); storeFault = fault; await act(async () => button("Approve changes", document.querySelector('[role="dialog"]')!).click()); await wait(() => applicationFailures.length === 1 && !button("Approve changes", document.querySelector('[role="dialog"]')!).disabled);
    expect(applicationFailures.join("\n")).not.toContain(privateMarker); expect(readNotificationMessages(container!).join("\n")).not.toContain(privateMarker); expect(editor("text").value).toBe(golden.editedRow.text); expect(editor("priority").value).toBe("99"); expect(await versions()).toEqual([]); await assertBytes(sourceKey, "source");
    storeFault = undefined; await act(async () => button("Approve changes", document.querySelector('[role="dialog"]')!).click()); await wait(() => tableRows()[0]?.textContent?.includes(golden.editedRow.text) === true); assertRows("edited"); expect((await versions()).length).toBe(2);
  }, 20_000);
  for (const fault of ["foreign-workspace", "missing-version", "invalid-fingerprint"] as const) it(`${selected}: denies ${fault} at the real transport/application boundary before codec or storage mutation`, async () => {
    await compose(selected); await mount(); const before = { tasks: tasks.size, operations: operations.length, writes };
    await expect(service.editRow({ workspaceId: fault === "foreign-workspace" ? "workspace.row-review-foreign" : workspaceId, artifactKey: sourceKey, ...(fault === "missing-version" ? { versionId: "dataset-version.row-review-missing" } : {}), rowIndex: 0, rowFingerprint: fault === "invalid-fingerprint" ? "invalid-fingerprint" as never : golden.variants.source.pages[0]!.rows[0]!.rowFingerprint as never, values: golden.editedRow })).rejects.toThrow();
    expect({ tasks: tasks.size, operations: operations.length, writes }).toEqual(before); expect(await versions()).toEqual([]); assertRows("source"); await assertBytes(sourceKey, "source"); expect(providerCalls).toBe(0);
  }, 20_000);
  it(`${selected}: reopens the immutable edited version and can inspect its unchanged parent`, async () => {
    await compose(selected); await mount(); await editFirst(); await act(async () => button("Approve changes", document.querySelector('[role="dialog"]')!).click()); await wait(() => tableRows()[0]?.textContent?.includes(golden.editedRow.text) === true); const saved = await assertPersistedLineage("edited"), parent = saved.find(value => !value.lineage.parentVersionId)!;
    await act(async () => root!.unmount()); root = createRoot(container!); await mount(); assertRows("edited");
    await act(async () => change(container!.querySelector<HTMLSelectElement>("select")!, String(parent.versionId))); await wait(() => tableRows()[0]?.textContent?.includes(golden.variants.source.rows[0]!.text) === true); assertRows("source"); expect(await assertPersistedLineage("edited")).toEqual(saved); await assertBytes(sourceKey, "source");
    await act(async () => root!.unmount()); root = undefined; await Promise.allSettled([...flights]); database!.close(); database = undefined;
    database = await openLocalSqliteDatabase({ policy: resolveLocalSqliteDatabasePolicy({ dataRootDirectory: directory! }) }); expect(database.checkHealth().healthy).toBe(true); expect(await versions()).toEqual(saved);
  }, 20_000);
}
