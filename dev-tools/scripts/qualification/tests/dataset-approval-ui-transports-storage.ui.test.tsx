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
import { DatasetPreparationFeature as DesktopPreparation } from "../../../../apps/desktop/src/renderer/features/dataset-preparation/components/DatasetPreparationFeature";
import { DatasetPreparationFeature as BrowserPreparation } from "../../../../apps/thin-client/src/features/dataset-preparation/components/DatasetPreparationFeature";
import { createDesktopDatasetPreparationClient } from "../../../../apps/desktop/src/renderer/features/dataset-preparation/api/desktopDatasetPreparationClient";
import { createApiDatasetPreparationClient } from "../../../../apps/thin-client/src/features/dataset-preparation/api/apiDatasetPreparationClient";
import { createApiArtifactBrowserClient } from "../../../../apps/thin-client/src/features/artifact-browser/api/apiArtifactBrowserClient";
import { createDesktopPreloadApi } from "../../../../apps/desktop/src/preload/exposedApi";
import { NotificationTestHarness } from "../../../../modules/ui/shared/notifications/tests/NotificationTestHarness";
import { DatasetVersionPanel, type DatasetVersionPanelService } from "../../../../modules/ui/shared/dataset-version";
import { composeDesktopArtifactFeature } from "../../../../modules/hosts/desktop/composition/composeDesktopArtifactFeature";
import { composeDesktopDatasetPreparationFeature } from "../../../../modules/hosts/desktop/composition/composeDesktopDatasetPreparationFeature";
import { openLocalSqliteDatabase, type OpenedLocalSqliteDatabase } from "../../../../modules/adapters/persistence/sqlite/sqlite-database";
import { resolveLocalSqliteDatabasePolicy } from "../../../../modules/adapters/persistence/sqlite/local-sqlite-database-policy";
import { createStructuredDatasetVersionRepository } from "../../../../modules/adapters/persistence/dataset-version";
import { registerDatasetPreparationIpc } from "../../../../modules/adapters/transport/ipc-electron/dataset-preparation/registerDatasetPreparationIpc";
import { registerDatasetVersionIpc } from "../../../../modules/adapters/transport/ipc-electron/dataset-version/registerDatasetVersionIpc";
import { registerArtifactBrowserIpc } from "../../../../modules/adapters/transport/ipc-electron/artifact-browser";
import { registerDatasetPreparationApiRoutes } from "../../../../modules/adapters/transport/api-express/dataset-preparation/registerDatasetPreparationApiRoutes";
import { registerDatasetVersionApiRoutes } from "../../../../modules/adapters/transport/api-express/dataset-version/registerDatasetVersionApiRoutes";
import { registerArtifactBrowserApiRoutes } from "../../../../modules/adapters/transport/api-express/artifact-browser";
import { setExpressAuthContext } from "../../../../modules/adapters/transport/api-express/security/expressAuthContext";
import type { IpcMainHandleListener, IpcMainHandlePort } from "../../../../modules/adapters/transport/ipc-electron/ipcMainHandlePort";
import type { RuntimeTaskRegistryPort } from "../../../../modules/application/ports/runtime";
import type { PrepareTrainingDatasetFromArtifactsUseCase } from "../../../../modules/application/use-cases/prepare-training-dataset-from-artifacts.use-case";
import { TaskType, type PrepareTrainingDatasetRequest, type RuntimeTaskStatusRecord } from "../../../../modules/contracts/runtime";
import { createWorkspaceId } from "../../../../modules/contracts/workspace";
import { createRetrieveArtifactRequest } from "../../../../modules/contracts/storage";
import { createContractError, createFailureResult } from "../../../../modules/contracts/shared";

// Existing mounted forms -> real clients/registered transports -> existing
// application/host composition -> actual Node SQLite and filesystem bytes.
// Only worker outputs/quality computation, access and readiness are fixtures.
// No worker/model/parser/OCR/provider/native/installed-host qualification follows.
type Host = "desktop" | "browser";
const now = "2026-10-26T12:00:00.000Z", tokenKey = "ai-system-builder.paired-device-token", token = "synthetic-dataset-loopback-only";
let sourceKey = "unseeded-dataset-approval-source";
const readyRows = [
  { text: "How can I renew my monthly transit pass?", label: "billing" },
  { text: "The ticket application cannot scan my code.", label: "technical" },
  { text: "Where do I get a refund for a canceled trip?", label: "billing" },
  { text: "I cannot sign in after resetting my password.", label: "technical" },
];
const badRow = { text: "This supplied training example has no required label." };
const jsonl = (rows: unknown[]) => new Uint8Array(Buffer.from(rows.map(row => JSON.stringify(row)).join("\n") + "\n"));
const sourceBytes = new Uint8Array(Buffer.from("text,label\n" + [...readyRows.map(row => [row.text, row.label]), [badRow.text, ""]].map(row => row.map(value => `"${value.replaceAll('"', '""')}"`).join(",")).join("\n") + "\n")), sha = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");
let root: Root | undefined, container: HTMLDivElement | undefined, server: Server | undefined;
let directory: string | undefined, identity: { dev: bigint; ino: bigint } | undefined, database: OpenedLocalSqliteDatabase | undefined;
let workspaceId = createWorkspaceId("workspace.dataset-approval-unmounted"), sequence = 0, host: Host;
let artifacts: any, feature: any, client: any, sourceClient: any, versionService: DatasetVersionPanelService;
let environment: { act?: PropertyDescriptor; api?: PropertyDescriptor; local: Map<string, string>; session: Map<string, string> } | undefined;
let calls = 0, runtimeCalls = 0, runtimeReads = 0, providerCalls = 0, approveGate: Promise<void> | undefined, release: (() => void) | undefined;
let approval: any, preparedKeys: string[] = [];
let failTrainWrite = false, corruptReview = false;
const privateFailure = "synthetic-private-storage-marker";
const storedKeys = new Map<string, string>(), rawReplies: string[] = [];
const flights = new Set<Promise<unknown>>(), stages = new Map<string, { dev: bigint; ino: bigint }>();
const tasks = new Map<string, RuntimeTaskStatusRecord>(), outputs = new Map<string, Record<string, Uint8Array>>(), owners = new Map<string, any>();
const actions: { action: string; workspaceId: string }[] = [];
const refusals: { action: string; code: string; message: string }[] = [], storeRoles: string[] = [];
const finalRoles = ["dataset", "train", "validation", "test"];
function track<T>(value: Promise<T>) { flights.add(value); void value.then(() => flights.delete(value), () => flights.delete(value)); return value; }
const context = () => ({ workspaceId, principalId: "principal.dataset-approval-ui" });
const storageEntries = (storage: Storage) => new Map(Object.keys(storage).map(key => [key, storage.getItem(key)!]));
async function closeListener() { if (server) { const owned = server; await new Promise<void>((resolve, reject) => owned.close(error => error ? reject(error) : resolve())); expect(owned.listening).toBe(false); server = undefined; } }
async function composeConnections() {
  database = await openLocalSqliteDatabase({ policy: resolveLocalSqliteDatabasePolicy({ dataRootDirectory: directory! }) }); expect(database.checkHealth().healthy).toBe(true);
  artifacts = composeDesktopArtifactFeature({ storageRootDirectory: directory!, documents: database.documents, loggingPort: { log: async () => {} }, workspaceShell: {}, now: () => now });
  const store = artifacts.storage.storeArtifact.bind(artifacts.storage);
  artifacts.storage.storeArtifact = async (...args: any[]) => {
    expect(storeRoles.length).toBeLessThan(20); const role = args[0].descriptor.metadata?.runtimeRole ?? "source"; storeRoles.push(role);
    if (failTrainWrite && role === "train") return createFailureResult(createContractError("unavailable", `${privateFailure}: ${directory}`));
    const result = await store(...args); if (result.ok) storedKeys.set(String(result.value.key), role); return result;
  };
  const retrieve = artifacts.storage.retrieveArtifact.bind(artifacts.storage);
  artifacts.storage.retrieveArtifact = async (...args: any[]) => { const result = await retrieve(...args); return corruptReview && storedKeys.get(String(args[0].key)) === "review" && result.ok ? { ...result, value: { ...result.value, content: new Uint8Array(Buffer.from("{broken-review-json\n")) } } : result; };
  const registry: RuntimeTaskRegistryPort = {
    async startTask(request) {
      expect(++runtimeCalls).toBeLessThanOrEqual(3); expect(request.taskType).toBe(TaskType.DATASET_PREPARATION); const payload = request.payload as PrepareTrainingDatasetRequest, id = request.requestId ?? randomUUID();
      expect(payload.recipe.task).toMatchObject({ taskType: "llm-classification", textInputMode: "provided" }); expect(payload.recipe.generation).toBeUndefined(); expect(payload.advanced?.content?.ocrEnabled).not.toBe(true); expect(payload.output.format).toBe("jsonl"); expect(payload.sourceInputs.length).toBe(1);
      const runtimeDirectory = payload.runtime?.runtimeWorkingDirectory; if (typeof runtimeDirectory !== "string") throw new Error("Synthetic expected runtime staging is missing.");
      const stage = await realpath(runtimeDirectory), info = await lstat(stage, { bigint: true }); expect(path.dirname(stage)).toBe(await realpath(tmpdir())); expect(info.isDirectory() && !info.isSymbolicLink() && info.ino !== 0n).toBe(true); stages.set(stage, { dev: info.dev, ino: info.ino }); owners.set(id, feature.prepareTrainingDatasetUseCase);
      const input = payload.sourceInputs[0]!, sourceFile = await realpath(input.localPath), stat = await lstat(sourceFile); expect(path.dirname(sourceFile)).toBe(stage); expect(stat.isFile() && !stat.isSymbolicLink() && stat.nlink === 1 && stat.size < 16_384).toBe(true); expect(Buffer.from(await readFile(sourceFile)).equals(Buffer.from(sourceBytes))).toBe(true);
      const fingerprint = sha(new Uint8Array(Buffer.from(JSON.stringify({ source: sha(sourceBytes), policy: payload.quality?.effectivePolicy, rows: readyRows }))));
      const report = { schemaVersion: "1", status: "needs-attention", reportFingerprint: fingerprint, policy: payload.quality!.effectivePolicy, mapping: { taskType: "llm-classification", status: "complete", mappedFields: ["text", "label"], missingRequiredFields: [] }, fields: [], distributions: { sources: [{ label: sourceKey, count: 5 }] }, counts: { inputRows: 5, acceptedRows: 4, quarantinedRows: 1 }, reasonCounts: { "schema-invalid": 1 }, samples: [{ sourceArtifactId: sourceKey, sourceRowIndex: 4, reasonCodes: ["schema-invalid"], fieldNames: ["label"], summary: "A required label was missing." }], reviewRequired: true, approvalAllowed: true };
      const files = { dataset: jsonl(readyRows), train: jsonl(readyRows.slice(0, 2)), validation: jsonl(readyRows.slice(2, 3)), test: jsonl(readyRows.slice(3)), report: new Uint8Array(Buffer.from(JSON.stringify(report))), review: jsonl(readyRows.map((row, index) => ({ ...row, sourceArtifactId: sourceKey, sourceRowIndex: index }))), quarantine: jsonl([{ sourceArtifactId: sourceKey, sourceRowIndex: 4, reasonCodes: ["schema-invalid"], row: badRow }]) };
      let bytes = 0; for (const [role, content] of Object.entries(files)) { bytes += content.length; expect(bytes).toBeLessThanOrEqual(32_768); await writeFile(path.join(stage, `${role}.${role === "report" ? "json" : "jsonl"}`), content, { flag: "wx" }); }
      outputs.set(id, files);
      const data = { outputs: Object.entries(files).map(([role, content]) => ({ name: `transit-tickets${role === "dataset" ? "" : `-${role}`}`, role, outputHandle: `${role}.${role === "report" ? "json" : "jsonl"}`, mediaType: role === "report" ? "application/json" : "application/x-ndjson", metadata: { ...(role !== "report" ? { rowCount: role === "dataset" || role === "review" ? 4 : role === "train" ? 2 : 1 } : {}), ...(role === "review" ? { reportFingerprint: fingerprint } : {}) } })), summary: { sourceDocumentCount: 1, normalizedDocumentCount: 1, skippedDocumentCount: 0, chunkCount: 5, generatedExampleCount: 0, datasetRowCount: 4, trainRowCount: 2, validationRowCount: 1, testRowCount: 1, acceptedRowCount: 4, quarantinedRowCount: 1 }, qualityReport: report };
      tasks.set(id, { requestId: id, workspaceId, taskType: request.taskType, status: "succeeded", concurrencyClass: "cpu-heavy", startedAt: now, updatedAt: now, completedAt: now, data } as RuntimeTaskStatusRecord); return { requestId: id, status: "queued" };
    },
    async getTaskStatus(id) { expect(++runtimeReads).toBeLessThanOrEqual(40); const value = tasks.get(id); if (!value) throw new Error("Synthetic unknown dataset task refused."); return value; },
    async cancelTask(id) { expect(tasks.has(id)).toBe(true); return { requestId: id, cancelled: true, status: "cancelled" }; },
    async listTasks() { return { tasks: [] }; },
  };
  feature = composeDesktopDatasetPreparationFeature({ artifacts, documents: database.documents, runtime: { runtimeTaskRegistry: registry, taskPowerLifecycle: { startTask: async () => {}, completeTask: async () => {} } }, getArtifactRemoteFeatures: async () => { providerCalls++; throw new Error("Synthetic provider action unavailable."); }, now: () => now });
  const actual: PrepareTrainingDatasetFromArtifactsUseCase = feature.prepareTrainingDatasetUseCase;
  const call = <T,>(action: string, scope: any, operation: () => Promise<T>) => track((async () => { expect(++calls).toBeLessThanOrEqual(100); actions.push({ action, workspaceId: scope.workspaceId }); const result = await operation(); if (result && typeof result === "object" && "ok" in result && !result.ok) { const error = (result as any).error; rawReplies.push(JSON.stringify(result)); refusals.push({ action, code: String(error?.code).slice(0, 64), message: String(error?.message).replace(/[A-Za-z]:[\\/][^\r\n]*/g, "<local-path>").slice(0, 300) }); } return result; })());
  const facade = { startPrepareTrainingDataset: (command: any, scope: any) => call("start", scope, () => actual.startPrepareTrainingDataset(command, scope)), readPrepareTrainingDataset: (id: string, scope: any) => call("read", scope, () => actual.readPrepareTrainingDataset(id, scope)), cancelPrepareTrainingDataset: (id: string, scope: any) => call("cancel", scope, () => actual.cancelPrepareTrainingDataset(id, scope)), approvePreparedTrainingDataset: (input: any, scope: any) => call("approve", scope, async () => { await approveGate; const result = await actual.approvePreparedTrainingDataset(input, scope); if (result.ok) approval = result.value; return result; }), readPreparedDatasetQualityReviewPage: (input: any, scope: any) => call("review-page", scope, () => actual.readPreparedDatasetQualityReviewPage(input, scope)) };
  if (host === "desktop") {
    const handlers = new Map<string, IpcMainHandleListener>(), ipcMain: IpcMainHandlePort = { handle: (channel, handler) => { handlers.set(channel, handler as IpcMainHandleListener); } };
    registerArtifactBrowserIpc({ ipcMain, senderTrust: { isTrustedSender: () => true }, ...artifacts }); registerDatasetPreparationIpc({ ipcMain, prepareTrainingDatasetUseCase: facade, getAuthoritativeRequestContext: () => ({ principalId: context().principalId }) }); registerDatasetVersionIpc({ ipcMain, ...feature, getAuthoritativeRequestContext: () => ({ principalId: context().principalId }) });
    const api = createDesktopPreloadApi({ ipcRenderer: { invoke: (channel, request) => { const handler = handlers.get(channel); if (!handler) return Promise.reject(new Error("Synthetic optional app operation unavailable.")); return track(Promise.resolve(handler({}, request))); } } }); Object.defineProperty(window, "desktopApi", { configurable: true, value: api });
    client = createDesktopDatasetPreparationClient(); versionService = { list: client.listVersions, compare: client.compareVersions, reproduce: client.readReproduction, publish: client.publishVersion };
  } else {
    const app = express(); app.use(express.json({ limit: "32kb", strict: true })); app.use((request, response, next) => { if (request.headers.authorization !== `Bearer ${token}`) { response.status(401).json({ ok: false, error: { code: "unauthorized", message: "Synthetic access denied." } }); return; } setExpressAuthContext(request, { authenticated: true, authMethod: "oidc-bearer", principal: { principalId: context().principalId, kind: "user", roles: ["organization-member"], scopes: ["artifact:read", "artifact:write"] } }); next(); });
    registerArtifactBrowserApiRoutes({ app, ...artifacts, artifactMediaViewRetrieval: artifacts.artifactMediaViewRetrieval }); registerDatasetPreparationApiRoutes({ app, prepareTrainingDatasetUseCase: facade }); registerDatasetVersionApiRoutes({ app, ...feature });
    server = createServer(app); await new Promise<void>((resolve, reject) => { server!.once("error", reject); server!.listen(0, "127.0.0.1", resolve); }); const address = server.address(); if (!address || typeof address === "string") throw new Error("Synthetic owned listener unavailable."); const base = `http://127.0.0.1:${address.port}/api`;
    client = createApiDatasetPreparationClient(base); sourceClient = createApiArtifactBrowserClient({ apiBaseUrl: base }); versionService = { list: async (scope, id) => (await client.listVersions({ workspaceId: scope, datasetId: id })).versions, compare: async (scope, from, to) => (await client.compareVersions({ workspaceId: scope, fromVersionId: from, toVersionId: to })).comparison, reproduce: async (scope, id) => (await client.readReproduction({ workspaceId: scope, versionId: id })).reproduction, publish: async input => (await client.publishVersion(input)).publication };
  }
}
async function compose(selected: Host) {
  host = selected; workspaceId = createWorkspaceId(`workspace.dataset-approval-${++sequence}`);
  environment = { act: Object.getOwnPropertyDescriptor(globalThis, "IS_REACT_ACT_ENVIRONMENT"), api: Object.getOwnPropertyDescriptor(window, "desktopApi"), local: storageEntries(localStorage), session: storageEntries(sessionStorage) }; Object.defineProperty(globalThis, "IS_REACT_ACT_ENVIRONMENT", { configurable: true, writable: true, value: true }); localStorage.setItem(tokenKey, token);
  directory = await mkdtemp(path.join(await realpath(tmpdir()), "dataset-approval-ui-")); const info = await lstat(directory, { bigint: true }); expect(info.ino !== 0n).toBe(true); identity = { dev: info.dev, ino: info.ino };
  await composeConnections(); const result = await artifacts.storeArtifactUploadUseCase.execute({ fileName: "transit-tickets.csv", mediaType: "text/csv", bytes: sourceBytes }, { source: "dataset-ui-fixture", workspaceId }, context()); expect(result.ok, result.ok ? "" : `${result.error.code}: ${String(result.error.message).replace(/[A-Za-z]:[\\/][^\r\n]*/g, "<local-path>").slice(0, 300)}`).toBe(true); if (!result.ok) throw new Error("Synthetic source upload failed."); sourceKey = String(result.value.storage.key);
  const binding = await artifacts.artifactBindings.readArtifactStorageBindings({ workspaceId, artifactId: sourceKey }, context()); expect(binding).toMatchObject({ ok: true, value: { bindings: [{ workspaceId, artifactId: sourceKey, role: "primary", backing: { kind: "artifact-object", provider: "local-filesystem", locator: sourceKey } }] } });
  container = document.createElement("div"); document.body.appendChild(container); root = createRoot(container);
}
const visible = (node: Element) => !node.closest("[hidden],details:not([open])");
function button(label: string) { const node = [...document.querySelectorAll<HTMLButtonElement>("button")].find(value => value.textContent?.trim() === label && visible(value)); if (!node) throw new Error(`Missing visible button: ${label}`); return node; }
const hasButton = (label: string) => [...document.querySelectorAll("button")].some(value => value.textContent?.trim() === label && visible(value));
async function wait(predicate: () => boolean) { for (let n = 0; n < 400 && !predicate(); n++) await act(async () => { await new Promise(resolve => setTimeout(resolve, 10)); }); expect(predicate(), JSON.stringify({ actions, runtimeCalls, runtimeReads, refusals })).toBe(true); }
function control(label: string, selector = "input,select,textarea") { const candidates = [...container!.querySelectorAll<HTMLLabelElement>("label")].filter(value => value.textContent?.includes(label)); const candidate = candidates.find(value => value.querySelector(selector) || value.htmlFor); const value = candidate?.querySelector(selector) ?? (candidate?.htmlFor ? document.getElementById(candidate.htmlFor) : undefined) ?? container!.querySelector(`[aria-label='${label}']`); if (!value || !visible(value)) throw new Error(`Missing visible control: ${label}`); return value as HTMLInputElement & HTMLSelectElement & HTMLTextAreaElement; }
function change(node: HTMLInputElement | HTMLSelectElement, value: string) { const prototype = node instanceof HTMLSelectElement ? HTMLSelectElement.prototype : HTMLInputElement.prototype; Object.getOwnPropertyDescriptor(prototype, "value")!.set!.call(node, value); node.dispatchEvent(new Event(node instanceof HTMLSelectElement ? "change" : "input", { bubbles: true })); }
async function reveal() { for (let n = 0; n < 24; n++) { const toggle = [...container!.querySelectorAll<HTMLButtonElement>("button.ui-panel__toggle[aria-expanded='false']")].find(visible), summary = [...container!.querySelectorAll<HTMLElement>("details:not([open]) > summary")].find(node => visible(node.parentElement!.parentElement!)); if (toggle) await act(async () => toggle.click()); else if (summary) await act(async () => summary.click()); else return; } throw new Error("Synthetic panel reveal bound exceeded."); }
async function renderPreparation(preparationClient = client) {
  const refused = async () => { throw new Error("Synthetic model/runtime action unavailable."); }, settings = { readSettings: async () => ({ values: [] }), resolveModelDefault: refused, listDefinitions: refused, updateSetting: refused, clearSetting: refused } as any;
  await act(async () => root!.render(<NotificationTestHarness>{host === "desktop" ? <DesktopPreparation workspaceId={workspaceId} client={preparationClient} settingsClient={settings} modelsClient={{ listModels: async () => [], downloadModel: refused } as any} runtimeStatusClient={{ readStatus: refused, controlRuntime: refused }} onPrepared={key => preparedKeys.push(key)} /> : <BrowserPreparation workspaceId={workspaceId} artifactClient={sourceClient} preparationClient={preparationClient} onPrepared={key => preparedKeys.push(key)} />}</NotificationTestHarness>));
}
async function mountPreparation() {
  await renderPreparation();
  await wait(() => [...container!.querySelectorAll("label")].some(value => value.textContent?.includes("transit-tickets.csv"))); await reveal(); await act(async () => change(control(host === "desktop" ? "Training task" : "Training goal", "select"), "llm-classification")); await reveal(); await act(async () => control("transit-tickets.csv", "input[type='checkbox']").click()); await reveal();
  await act(async () => { change(control("Allowed labels"), "billing, technical"); change(control(host === "desktop" ? "Output format" : "Saved file format", "select"), "jsonl"); }); await reveal(); expect(button("Run checks and prepare").disabled).toBe(false);
}
async function prepare() { await mountPreparation(); await act(async () => button("Run checks and prepare").click()); await wait(() => hasButton("Approve and save dataset") || refusals.length > 0); expect(hasButton("Approve and save dataset"), JSON.stringify(refusals)).toBe(true); expect(tasks.size).toBe(1); }
function reviewValues() {
  const dialog = document.querySelector('[role="dialog"]'); expect(Boolean(dialog)).toBe(true);
  const values = [...dialog!.querySelectorAll("dl.dataset-review__values > div")].map(node => [node.querySelector("dt")!.textContent!, node.querySelector("dd pre")!.textContent!] as const);
  expect(new Set(values.map(([name]) => name)).size).toBe(values.length);
  return Object.fromEntries(values);
}
async function versions() { return createStructuredDatasetVersionRepository(database!.documents).listVersions(workspaceId); }
async function assertSavedBytes() {
  expect(approval?.result).toBeDefined();
  const local = approval.result.outputs.local, expected = outputs.values().next().value!, saved = await versions();
  expect(saved.length).toBe(1);
  for (const role of ["dataset", "train", "validation", "test"] as const) {
    expect(local[role]).toBeDefined();
    const key = local[role].storage.key, result = await artifacts.storage.retrieveArtifact(createRetrieveArtifactRequest(key), context());
    expect(result.ok).toBe(true); if (!result.ok) throw new Error("Synthetic approved output unavailable.");
    expect(Buffer.from(result.value.content).equals(Buffer.from(expected[role]!))).toBe(true);
    expect(saved[0]!.artifacts.find(value => value.role === role)).toMatchObject({ artifactKey: key, digest: `sha256:${sha(result.value.content)}`, sizeBytes: expected[role]!.length, rowCount: role === "dataset" ? 4 : role === "train" ? 2 : 1 });
  }
  return local.dataset.storage.key as string;
}
function restoreEnvironment() { if (!environment) return; for (const [object, key, descriptor] of [[globalThis, "IS_REACT_ACT_ENVIRONMENT", environment.act], [window, "desktopApi", environment.api]] as const) if (descriptor) Object.defineProperty(object, key, descriptor); else Reflect.deleteProperty(object, key); for (const [storage, baseline] of [[localStorage, environment.local], [sessionStorage, environment.session]] as const) { for (const key of Object.keys(storage)) if (!baseline.has(key)) storage.removeItem(key); for (const [key, value] of baseline) storage.setItem(key, value); } }
afterEach(async () => {
  try {
    if (root) await act(async () => root!.unmount()); root = undefined; container?.remove(); container = undefined; await act(async () => { release?.(); await Promise.allSettled([...flights]); });
    for (const [id, owner] of owners) await owner.cancelPrepareTrainingDataset(id, context()); await closeListener(); database?.close(); database = undefined; restoreEnvironment();
    for (const stage of stages.keys()) { let exists = false; try { await lstat(stage); exists = true; } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; } expect(exists).toBe(false); }
    if (directory) { const owned = directory, info = await lstat(owned, { bigint: true }); expect({ dev: info.dev, ino: info.ino }).toEqual(identity); expect(info.isDirectory() && !info.isSymbolicLink() && await realpath(owned) === owned && path.dirname(owned) === await realpath(tmpdir())).toBe(true); let count = 0, bytes = 0; async function inspect(parent: string) { for (const name of await readdir(parent)) { const file = path.join(parent, name), info = await lstat(file); expect(++count).toBeLessThanOrEqual(256); expect(info.isSymbolicLink()).toBe(false); if (info.isDirectory()) await inspect(file); else { expect(info.isFile() && info.nlink === 1).toBe(true); bytes += info.size; expect(bytes).toBeLessThanOrEqual(4 * 1024 * 1024); } } } await inspect(owned); await rm(owned, { recursive: true }); }
  } finally { restoreEnvironment(); environment = undefined; directory = undefined; identity = undefined; database = undefined; approveGate = undefined; release = undefined; approval = undefined; preparedKeys = []; calls = runtimeCalls = runtimeReads = providerCalls = 0; failTrainWrite = corruptReview = false; storedKeys.clear(); rawReplies.length = 0; tasks.clear(); outputs.clear(); owners.clear(); stages.clear(); flights.clear(); actions.length = refusals.length = storeRoles.length = 0; }
});
for (const selected of ["desktop", "browser"] as const) {
  it(`${selected}: reviews real ready and set-aside rows before explicit approval saves exact splits and version lineage`, async () => {
    await compose(selected); await prepare(); expect(await versions()).toEqual([]); expect(preparedKeys).toEqual([]); expect(actions.filter(value => value.action === "approve")).toEqual([]); expect(storeRoles.filter(value => finalRoles.includes(value))).toEqual([]);
    const ready = [...container!.querySelectorAll<HTMLButtonElement>("button.dataset-review__report-line")].find(value => value.textContent?.includes("Open ready examples"))!; expect(Boolean(ready)).toBe(true); await act(async () => ready.click()); await wait(() => Boolean(document.querySelector('[role="dialog"]')?.textContent?.includes(readyRows[0]!.text)));
    const observed: { text: string; label: string }[] = [];
    for (const [index, expected] of readyRows.entries()) {
      const values = reviewValues(); expect(values).toEqual({ ...expected, sourceArtifactId: sourceKey, sourceRowIndex: String(index) }); observed.push({ text: values.text!, label: values.label! });
      expect(document.querySelector('[role="dialog"] .dataset-review__progress strong')?.textContent).toBe(`${index + 1} of ${readyRows.length}`);
      expect(document.querySelector('[role="dialog"] h3')?.textContent).toBe(`Ready record ${index + 1}`); expect(button("Previous").disabled).toBe(index === 0); expect(button("Next").disabled).toBe(index === readyRows.length - 1);
      if (index < readyRows.length - 1) await act(async () => button("Next").click());
    }
    expect(observed).toEqual(readyRows); expect(new Set(observed.map(row => row.text)).size).toBe(readyRows.length);
    await act(async () => button("Previous").click()); expect(reviewValues()).toEqual({ ...readyRows[2], sourceArtifactId: sourceKey, sourceRowIndex: "2" });
    const close = document.querySelector<HTMLButtonElement>('[role="dialog"] [aria-label="Close dialog"]'); expect(Boolean(close)).toBe(true); await act(async () => close!.click()); expect(await versions()).toEqual([]);
    const aside = [...container!.querySelectorAll<HTMLButtonElement>("button.dataset-review__report-line")].find(value => value.textContent?.includes("Open set-aside examples"))!; expect(Boolean(aside)).toBe(true); await act(async () => aside.click()); await wait(() => Boolean(document.querySelector('[role="dialog"]')?.textContent?.includes(badRow.text)));
    expect(reviewValues()).toEqual({ ...badRow, sourceArtifactId: sourceKey, sourceRowIndex: "4", reasonCodes: JSON.stringify(["schema-invalid"], null, 2) }); expect(document.querySelector('[role="dialog"] .dataset-review__progress strong')?.textContent).toBe("1 of 1"); expect(button("Previous").disabled).toBe(true); expect(button("Next").disabled).toBe(true);
    await act(async () => document.querySelector<HTMLButtonElement>('[role="dialog"] [aria-label="Close dialog"]')!.click());
    await act(async () => change(control("Dataset save name (optional)"), "transit-support")); await act(async () => button("Approve and save dataset").click()); await wait(() => preparedKeys.length === 1);
    const key = await assertSavedBytes(); expect(preparedKeys).toEqual([key]); const saved = await versions(); expect(saved.length).toBe(1); expect(saved[0]!.lineage.sources).toMatchObject([{ sourceArtifactId: sourceKey, artifactKey: sourceKey, digest: `sha256:${sha(sourceBytes)}` }]); expect(providerCalls).toBe(0);
  }, 20_000);
  it(`${selected}: discards reviewed output without saving a final dataset or version`, async () => {
    await compose(selected); await prepare(); await act(async () => button("Discard dataset").click()); await wait(() => hasButton("Run checks and prepare") && !button("Run checks and prepare").disabled); expect(await versions()).toEqual([]); expect(preparedKeys).toEqual([]); expect(actions.filter(value => value.action === "approve")).toEqual([]); expect(storeRoles.filter(value => finalRoles.includes(value))).toEqual([]); expect(providerCalls).toBe(0);
  }, 20_000);
  it(`${selected}: admits one approval before busy rendering and reopens its exact version after adapter restart`, async () => {
    await compose(selected); await prepare(); approveGate = new Promise<void>(resolve => { release = resolve; });
    try { await act(async () => { const save = button("Approve and save dataset"); save.click(); save.click(); }); await wait(() => actions.some(value => value.action === "approve")); expect(actions.filter(value => value.action === "approve").length).toBe(1); expect(await versions()).toEqual([]); } finally { await act(async () => release?.()); }
    await wait(() => preparedKeys.length === 1); const key = await assertSavedBytes(), before = await versions(); await act(async () => root!.unmount()); root = undefined; await Promise.allSettled([...flights]); await closeListener(); database!.close(); database = undefined; await composeConnections(); expect(await versions()).toEqual(before); await assertSavedBytes();
    root = createRoot(container!); await act(async () => root!.render(<NotificationTestHarness><DatasetVersionPanel workspaceId={workspaceId} datasetArtifactKey={key} service={versionService} /></NotificationTestHarness>)); await wait(() => hasButton("Refresh versions") && !button("Refresh versions").disabled); expect(container!.textContent).toContain("Saved versions"); expect(container!.textContent).not.toContain("No saved dataset version matches this file."); expect(control("Version", "select").options.length).toBe(1); expect(control("Version", "select").value).toBe(before[0]!.versionId); expect(providerCalls).toBe(0);
  }, 20_000);
  it(`${selected}: keeps Save and Discard mutually exclusive before the busy render`, async () => {
    await compose(selected); await prepare(); approveGate = new Promise<void>(resolve => { release = resolve; });
    try { await act(async () => { const save = button("Approve and save dataset"), discard = button("Discard dataset"); save.click(); discard.click(); }); await wait(() => actions.some(value => value.action === "approve")); expect(actions.filter(value => value.action === "approve").length).toBe(1); expect(actions.filter(value => value.action === "cancel")).toEqual([]); } finally { await act(async () => release?.()); }
    await wait(() => preparedKeys.length === 1); await assertSavedBytes();
  }, 20_000);
  it(`${selected}: admits one Discard and prevents a same-render Save`, async () => {
    await compose(selected); await prepare(); await act(async () => { const discard = button("Discard dataset"), save = button("Approve and save dataset"); discard.click(); discard.click(); save.click(); });
    await wait(() => hasButton("Run checks and prepare") && !button("Run checks and prepare").disabled); expect(actions.filter(value => value.action === "cancel").length).toBe(1); expect(actions.filter(value => value.action === "approve")).toEqual([]); expect(await versions()).toEqual([]); expect(preparedKeys).toEqual([]);
  }, 20_000);
  it(`${selected}: does not notify a retired page when its accepted save finishes`, async () => {
    await compose(selected); await prepare(); approveGate = new Promise<void>(resolve => { release = resolve; });
    try { await act(async () => button("Approve and save dataset").click()); await wait(() => actions.some(value => value.action === "approve")); await act(async () => root!.unmount()); root = undefined; } finally { await act(async () => { release?.(); await Promise.allSettled([...flights]); }); }
    expect(preparedKeys).toEqual([]); await assertSavedBytes();
  }, 20_000);
  for (const fault of ["task", "fingerprint", "workspace"] as const) it(`${selected}: real transport denies a ${fault} mismatch and the original UI review remains saveable`, async () => {
    await compose(selected); await prepare(); const task = [...tasks.values()][0]!; if (!("data" in task)) throw new Error("Synthetic completed task data is missing."); const input = { requestId: fault === "task" ? "unknown-synthetic-task" : task.requestId, reportFingerprint: fault === "fingerprint" ? "0".repeat(64) : (task.data as any).qualityReport.reportFingerprint, workspaceId: fault === "workspace" ? "workspace.dataset-approval-foreign" : workspaceId };
    if (host === "desktop") { const denied = await client.approvePreparedTrainingDataset(input.requestId, input.reportFingerprint, input.workspaceId); expect(denied.ok).toBe(false); } else await expect(client.approve(input)).rejects.toThrow();
    expect(await versions()).toEqual([]); expect(storeRoles.filter(value => finalRoles.includes(value))).toEqual([]); expect(preparedKeys).toEqual([]); expect(hasButton("Approve and save dataset")).toBe(true);
    await act(async () => button("Approve and save dataset").click()); await wait(() => preparedKeys.length === 1); await assertSavedBytes();
  }, 20_000);
  it(`${selected}: refuses altered review-page bytes and reads the same review after the storage read is corrected`, async () => {
    await compose(selected); await prepare(); corruptReview = true;
    const ready = () => [...container!.querySelectorAll<HTMLButtonElement>("button.dataset-review__report-line")].find(value => value.textContent?.includes("Open ready examples"))!;
    await act(async () => ready().click()); await wait(() => refusals.some(value => value.action === "review-page")); expect(document.querySelector('[role="dialog"]')?.textContent).not.toContain(readyRows[0]!.text); expect(await versions()).toEqual([]);
    await act(async () => document.querySelector<HTMLButtonElement>('[role="dialog"] [aria-label="Close dialog"]')!.click()); corruptReview = false; await act(async () => ready().click()); await wait(() => Boolean(document.querySelector('[role="dialog"]')?.textContent?.includes(readyRows[0]!.text))); await act(async () => document.querySelector<HTMLButtonElement>('[role="dialog"] [aria-label="Close dialog"]')!.click());
    await act(async () => button("Approve and save dataset").click()); await wait(() => preparedKeys.length === 1); await assertSavedBytes();
  }, 20_000);
  it(`${selected}: keeps a failed partial save private and retries the original review after storage recovers`, async () => {
    await compose(selected); await prepare(); failTrainWrite = true; await act(async () => button("Approve and save dataset").click()); await wait(() => refusals.some(value => value.action === "approve") && !button("Approve and save dataset").disabled);
    expect(rawReplies.join("\n")).not.toContain(privateFailure); expect(container!.textContent).not.toContain(privateFailure); expect(await versions()).toEqual([]); expect(preparedKeys).toEqual([]);
    for (const [key, role] of storedKeys) if (finalRoles.includes(role)) expect((await artifacts.storage.retrieveArtifact(createRetrieveArtifactRequest(key), context())).ok).toBe(false);
    failTrainWrite = false; await act(async () => button("Approve and save dataset").click()); await wait(() => preparedKeys.length === 1); await assertSavedBytes(); expect(runtimeCalls).toBe(1);
  }, 20_000);
  it(`${selected}: refuses malformed staged output and saves after the exact owned fixture is corrected`, async () => {
    await compose(selected); await prepare(); const stage = stages.keys().next().value!, original = outputs.values().next().value!.dataset!; await writeFile(path.join(stage, "dataset.jsonl"), "{broken-dataset-json\n");
    await act(async () => button("Approve and save dataset").click()); await wait(() => refusals.some(value => value.action === "approve") && !button("Approve and save dataset").disabled); expect(await versions()).toEqual([]); expect(preparedKeys).toEqual([]); expect(storeRoles.filter(value => finalRoles.includes(value))).toEqual([]);
    await writeFile(path.join(stage, "dataset.jsonl"), original); await act(async () => button("Approve and save dataset").click()); await wait(() => preparedKeys.length === 1); await assertSavedBytes(); expect(runtimeCalls).toBe(1);
  }, 20_000);
}
it("desktop: a retired client's completion cannot notify or unlock its replacement's pending approval", async () => {
  await compose("desktop"); await prepare(); approveGate = new Promise<void>(resolve => { release = resolve; }); const releaseOld = release!;
  try {
    await act(async () => button("Approve and save dataset").click()); await wait(() => actions.filter(value => value.action === "approve").length === 1);
    approveGate = new Promise<void>(resolve => { release = resolve; }); await renderPreparation({ ...client }); expect(button("Approve and save dataset").disabled).toBe(false);
    await act(async () => button("Approve and save dataset").click()); await wait(() => actions.filter(value => value.action === "approve").length === 2); await act(async () => releaseOld()); await wait(() => Boolean(approval));
    expect(preparedKeys).toEqual([]); expect(button("Saving...").disabled).toBe(true); await act(async () => button("Saving...").click()); expect(actions.filter(value => value.action === "approve").length).toBe(2);
  } finally { await act(async () => { releaseOld(); release?.(); }); }
  await wait(() => preparedKeys.length === 1); await assertSavedBytes();
}, 20_000);
