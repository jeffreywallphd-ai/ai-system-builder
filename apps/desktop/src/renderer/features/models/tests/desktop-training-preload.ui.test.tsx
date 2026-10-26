// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import { lstat, mkdir, mkdtemp, readFile, readdir, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { TrainModelTab } from "../components/TrainModelTab";
import { useModelTrainingFeature } from "../hooks/useModelTrainingFeature";
import { createDesktopModelsClient } from "../api/desktopModelsClient";
import { createDesktopPreloadApi } from "../../../../preload/exposedApi";
import { TaskObservationProvider } from "../../../../../../../modules/ui/shared/notifications/TaskObservationProvider";
import { NotificationTestHarness, readNotificationMessages } from "../../../../../../../modules/ui/shared/notifications/tests/NotificationTestHarness";
import { registerModelManagementIpc } from "../../../../../../../modules/adapters/transport/ipc-electron/model/registerModelManagementIpc";
import type { IpcMainHandleListener, IpcMainHandlePort } from "../../../../../../../modules/adapters/transport/ipc-electron/ipcMainHandlePort";
import { createLocalModelRegistryAdapter } from "../../../../../../../modules/adapters/persistence/model/createLocalModelRegistryAdapter";
import { createLocalGeneratedModelStorageAdapter } from "../../../../../../../modules/adapters/model/local/createLocalGeneratedModelStorageAdapter";
import { createFilesystemArtifactStorageAdapter } from "../../../../../../../modules/adapters/storage/filesystem/artifact-store/createFilesystemArtifactStorageAdapter";
import { ListModelsUseCase } from "../../../../../../../modules/application/use-cases/model/list-models.use-case";
import { TrainModelUseCase } from "../../../../../../../modules/application/use-cases/model/train-model.use-case";
import type { ModelTrainingRequest } from "../../../../../../../modules/contracts/model";
import { TaskType } from "../../../../../../../modules/contracts/runtime";
import type { RuntimeTaskRegistryPort } from "../../../../../../../modules/application/ports/runtime";
import { createWorkspaceId } from "../../../../../../../modules/contracts/workspace";

vi.mock("../../settings/components/SettingsPanel", () => ({ SettingsPanel: () => null }));

// Real UI/client/preload/handlers/use case and cooperative filesystem/JSON stores.
// Invoke, worker, input artifact ports and passive settings/runtime reads are
// finite fixtures. No physical Electron/sender policy, training, native atomic
// publication, provider, production SQLite or whole-host pass follows.
const workspace = createWorkspaceId("workspace.training-fixture-a"), foreign = createWorkspaceId("workspace.training-fixture-b");
const taskKey = `ai-system-builder.training-task.v1:${workspace}`;
const inputBytes = [Buffer.from('{"text":"reset a password","label":"account"}\n'), Buffer.from('{"text":"find an invoice","label":"billing"}\n')];
const outputBytes = Buffer.from("synthetic adapter bytes; never loaded as a model");
type Identity = { dev: bigint; ino: bigint };
let root: Root | undefined, container: HTMLDivElement | undefined, directory: string | undefined;
let oldApi: PropertyDescriptor | undefined, oldAct: PropertyDescriptor | undefined, oldTask: string | null;
let registry: ReturnType<typeof createLocalModelRegistryAdapter>, useCase: TrainModelUseCase;
let job: { id: string; payload: ModelTrainingRequest; phase: "running" | "succeeded" | "cancelled"; output: string } | undefined;
let allowCancel = false, registrationFailure = false, copies = 0, registrations = 0, runtimeReads = 0;
const owned = new Map<string, Identity>(), calls: { channel: string; payload: unknown }[] = [];

async function remember(folder: string) {
  const info = await lstat(folder, { bigint: true });
  expect(info.isDirectory()).toBe(true); expect(info.isSymbolicLink()).toBe(false); expect(info.ino).not.toBe(0n);
  expect(await realpath(folder)).toBe(folder); owned.set(folder, { dev: info.dev, ino: info.ino });
}
async function removeOwned(folder: string, identity: Identity) {
  const info = await lstat(folder, { bigint: true }).catch(error => { if (error.code === "ENOENT") return undefined; throw error; });
  if (!info) return;
  expect(info.dev).toBe(identity.dev); expect(info.ino).toBe(identity.ino); expect(info.isDirectory()).toBe(true); expect(info.isSymbolicLink()).toBe(false);
  expect(await realpath(folder)).toBe(folder); expect(path.dirname(folder)).toBe(await realpath(tmpdir()));
  let entries = 0, bytes = 0;
  async function inspect(parent: string) {
    for (const name of await readdir(parent)) {
      const child = path.join(parent, name), current = await lstat(child);
      expect(++entries).toBeLessThanOrEqual(128); expect(current.isSymbolicLink()).toBe(false);
      if (current.isDirectory()) await inspect(child);
      else { expect(current.isFile()).toBe(true); bytes += current.size; expect(bytes).toBeLessThanOrEqual(2 * 1024 * 1024); }
    }
  }
  await inspect(folder); await rm(folder, { recursive: true });
}
async function unmount() { if (root) await act(async () => root!.unmount()); root = undefined; container?.remove(); container = undefined; }
afterEach(async () => {
  try {
    await unmount();
    if (job) { allowCancel = true; const result = await useCase.read(job.id, workspace); if (result.reviewPending) await useCase.discard(job.id, workspace); else if (result.status === "queued" || result.status === "running") await useCase.cancel(job.id, workspace); }
  } finally {
    if (oldApi) Object.defineProperty(window, "desktopApi", oldApi); else Reflect.deleteProperty(window, "desktopApi");
    if (oldAct) Object.defineProperty(globalThis, "IS_REACT_ACT_ENVIRONMENT", oldAct); else Reflect.deleteProperty(globalThis, "IS_REACT_ACT_ENVIRONMENT");
    if (oldTask === null) sessionStorage.removeItem(taskKey); else if (oldTask !== undefined) sessionStorage.setItem(taskKey, oldTask);
    for (const [folder, identity] of owned) await removeOwned(folder, identity);
    owned.clear(); calls.length = 0; directory = undefined; job = undefined; copies = 0; registrations = 0; runtimeReads = 0; allowCancel = false; registrationFailure = false;
    vi.restoreAllMocks();
  }
});

async function compose() {
  oldApi = Object.getOwnPropertyDescriptor(window, "desktopApi"); oldAct = Object.getOwnPropertyDescriptor(globalThis, "IS_REACT_ACT_ENVIRONMENT"); oldTask = sessionStorage.getItem(taskKey);
  Object.defineProperty(globalThis, "IS_REACT_ACT_ENVIRONMENT", { configurable: true, writable: true, value: true }); sessionStorage.removeItem(taskKey);
  directory = await mkdtemp(path.join(await realpath(tmpdir()), "training-preload-ui-")); await remember(directory);
  const baseDirectory = path.join(directory, "base"); await mkdir(baseDirectory); await writeFile(path.join(baseDirectory, "config.json"), '{"fixture":true}');
  registry = createLocalModelRegistryAdapter({ filePath: path.join(directory, "models.json"), discovery: { enabled: false }, now: () => "2026-01-01T00:00:00.000Z" });
  const base = await registry.registerDownloadedModel({ workspaceId: workspace, source: "local", displayName: "Synthetic support base", provider: "huggingface", modelId: "synthetic/support", localPath: baseDirectory, artifactForm: "full-model", inferenceMode: "causal" });
  const outputStore = createLocalGeneratedModelStorageAdapter({ env: { HF_HUB_CACHE: path.join(directory, "generated") }, maximumSourceBytes: 64 * 1024, maximumSourceFiles: 16 });
  const inputStore = createFilesystemArtifactStorageAdapter({ rootDirectory: path.join(directory, "inputs") });
  for (const [index, id] of ["dataset-train", "dataset-validation"].entries()) {
    const stored = await inputStore.storeArtifact({ descriptor: { key: `datasets/${id}.jsonl`, mediaType: "application/x-ndjson" }, content: new Uint8Array(inputBytes[index]) }, { workspaceId: workspace });
    expect(stored.ok).toBe(true);
  }
  const runtime: RuntimeTaskRegistryPort = {
    startTask: async request => {
      expect(job).toBeUndefined(); expect(request.taskType).toBe(TaskType.MODEL_TRAINING); expect(request.workspaceId).toBe(workspace);
      const payload = request.payload as ModelTrainingRequest;
      expect(payload.baseModel.modelRecordId).toBe(base.model.modelRecordId); expect(payload.baseModel.localPath).toBe(baseDirectory);
      expect(payload.datasets.map(value => [value.artifactId, value.splitRole, value.format])).toEqual([["dataset-train", "train", "jsonl"], ["dataset-validation", "validation", "jsonl"]]);
      for (const [index, dataset] of payload.datasets.entries()) {
        expect(typeof dataset.path).toBe("string"); const folder = path.dirname(dataset.path!);
        expect(path.dirname(folder)).toBe(await realpath(tmpdir())); expect(path.basename(folder)).toMatch(/^ai-system-builder-training-datasets-/);
        if (!owned.has(folder)) await remember(folder);
        expect(await readFile(dataset.path!)).toEqual(inputBytes[index]);
      }
      const output = path.join(directory!, "worker-output"); await mkdir(output); await writeFile(path.join(output, "adapter_model.safetensors"), outputBytes); await writeFile(path.join(output, "adapter_config.json"), '{"fixture":true}');
      job = { id: "training-fixture-run", payload, phase: "running", output };
      return { requestId: job.id, accepted: true, status: "queued" };
    },
    getTaskStatus: async id => {
      expect(++runtimeReads).toBeLessThanOrEqual(30); expect(id).toBe(job?.id);
      return { requestId: id, taskType: TaskType.MODEL_TRAINING, workspaceId: workspace, status: job!.phase, concurrencyClass: "unknown", progress: { details: { epoch: 0, totalEpochs: 1, batch: 1, totalBatches: 2 } },
        ...(job!.phase === "succeeded" ? { data: { runId: id, status: "succeeded", outputModelName: "support-adapter", generatedModelCandidate: { displayName: "Support adapter", localPath: job!.output, artifactForm: "adapter", inferenceMode: "causal", serializationFormat: "safetensors" } } } : {}) };
    },
    cancelTask: async id => { expect(id).toBe(job?.id); if (allowCancel) job!.phase = "cancelled"; return { requestId: id, cancelled: allowCancel, status: job!.phase }; },
    listTasks: async () => ({ tasks: [] }),
  };
  useCase = new TrainModelUseCase({ runtimeTaskRegistry: runtime, modelRegistry: { ...registry, registerGeneratedModel: async input => { registrations++; if (registrationFailure) { registrationFailure = false; throw new Error("synthetic-private-registration-failure"); } return registry.registerGeneratedModel(input); } },
    generatedModelStorage: { storeGeneratedModel: async input => { copies++; return outputStore.storeGeneratedModel(input); } },
    storageBindings: { readArtifactStorageBindings: async input => { expect(input.workspaceId).toBe(workspace); expect(["dataset-train", "dataset-validation"]).toContain(input.artifactId); return { ok: true, value: { bindings: [{ artifactId: input.artifactId, workspaceId: workspace, role: "primary", backing: { kind: "artifact-object", provider: "local-filesystem", locator: `datasets/${input.artifactId}.jsonl` } }] } }; } },
    storage: inputStore,
    taskPowerLifecycle: { startTask: async () => undefined, completeTask: async () => undefined },
  });
  const handlers = new Map<string, IpcMainHandleListener>();
  const ipcMain: IpcMainHandlePort = { handle<TRequest, TResponse>(channel: string, listener: IpcMainHandleListener<TRequest, TResponse>) { expect(handlers.has(channel)).toBe(false); expect(handlers.size).toBeLessThan(24); handlers.set(channel, (event, request) => listener(event, request as TRequest)); } };
  const unavailable = async (): Promise<never> => { throw new Error("Synthetic unused capability."); };
  registerModelManagementIpc({ ipcMain, listModelsUseCase: new ListModelsUseCase({ modelRegistry: registry }), trainModelUseCase: useCase,
    browseModelsUseCase: { execute: unavailable }, getModelDetailsUseCase: { execute: unavailable }, saveModelReferenceUseCase: { execute: unavailable }, downloadModelUseCase: { execute: unavailable }, updateModelRecordUseCase: { execute: unavailable }, deleteModelRecordUseCase: { execute: unavailable }, revealModelInFolderUseCase: { execute: unavailable }, validateModelUseCase: { execute: unavailable }, publishModelUseCase: { execute: unavailable } });
  const api = createDesktopPreloadApi({ ipcRenderer: { invoke: async (channel, request) => { expect(calls.length).toBeLessThan(80); const envelope = request as { channel: string; payload: unknown }; expect(envelope.channel).toBe(channel); const handler = handlers.get(channel); if (!handler) throw new Error("Unexpected fixture IPC channel."); calls.push({ channel, payload: JSON.parse(JSON.stringify(envelope.payload)) }); return handler(Object.freeze({ inProcessFixture: true }), request); } } });
  const modelMethods: Pick<NonNullable<typeof window.desktopApi>, "listModels" | "trainModel" | "readModelTrainingStatus" | "cancelModelTraining" | "saveModelTraining" | "discardModelTraining"> = { listModels: api.listModels, trainModel: api.trainModel, readModelTrainingStatus: api.readModelTrainingStatus, cancelModelTraining: api.cancelModelTraining, saveModelTraining: api.saveModelTraining, discardModelTraining: api.discardModelTraining };
  Object.defineProperty(window, "desktopApi", { configurable: true, writable: true, value: { ...modelMethods,
    readApplicationSettings: async () => ({ ok: true, value: { values: [] } }), readPythonRuntimeStatus: async () => ({ ok: true, value: { healthy: true, activeTaskCount: 0 } }),
    browseArtifacts: async (input: { workspaceId: string }) => ({ ok: true, value: input.workspaceId === workspace ? ["dataset-train", "dataset-validation"].map(artifactId => ({ artifactId, storageKey: `datasets/${artifactId}.jsonl`, originalName: `${artifactId}.jsonl`, artifactFamily: "dataset", mediaType: "application/x-ndjson" })) : [] }),
  } });
  return base.model.modelRecordId;
}
function TrainingView({ workspaceId }: { workspaceId: string }) { const state = useModelTrainingFeature(undefined, workspaceId); return <TrainModelTab state={state}/>; }
async function mount(workspaceId = workspace) { container = document.createElement("div"); document.body.appendChild(container); root = createRoot(container); await act(async () => root!.render(<TaskObservationProvider><NotificationTestHarness><TrainingView workspaceId={workspaceId}/></NotificationTestHarness></TaskObservationProvider>)); }
function button(label: string) { const found = [...container!.querySelectorAll<HTMLButtonElement>("button")].find(value => value.textContent?.trim() === label); expect(Boolean(found)).toBe(true); return found!; }
async function settled(predicate: () => boolean) { const end = Date.now() + 10000; while (Date.now() < end) { await act(async () => { await new Promise(done => setTimeout(done, 10)); }); if (predicate()) return; } expect(predicate()).toBe(true); }
async function start() { await settled(() => container!.querySelectorAll('input[name="training-dataset"]').length === 2); await act(async () => { container!.querySelectorAll<HTMLInputElement>('input[name="training-dataset"]').forEach(input => input.click()); }); expect(button("Start Training").disabled).toBe(false); await act(async () => button("Start Training").click()); await settled(() => Boolean(job)); }
const savedModels = async () => (await registry.listModels({ workspaceId: workspace })).models.filter(model => model.source === "generated");
async function review() { job!.phase = "succeeded"; await settled(() => Boolean([...container!.querySelectorAll("button")].find(value => value.textContent === "Save model"))); expect(await savedModels()).toHaveLength(0); expect(copies).toBe(0); }

it("stages two real input files, waits for review, saves exact output bytes and reopens the registry", async () => {
  const baseId = await compose(); await mount(); await start();
  const staged = job!.payload.datasets.map(input => input.path!); expect(sessionStorage.getItem(taskKey)).toBe(job!.id);
  expect(calls.some(call => JSON.stringify(call.payload).includes(baseId))).toBe(true);
  await review(); for (const file of staged) expect(await lstat(file).catch(() => undefined)).toBeUndefined();
  await act(async () => button("Save model").click()); await settled(() => container!.textContent!.includes("Trained model saved."));
  const [saved] = await savedModels(); expect(saved.generatedFromRunId).toBe(job!.id); expect(saved.artifactForm).toBe("adapter"); expect(copies).toBe(1); expect(registrations).toBe(1);
  expect(await readFile(path.join(saved.localPath!, "adapter_model.safetensors"))).toEqual(outputBytes); expect(await lstat(job!.output).catch(() => undefined)).toBeUndefined();
  expect(container!.textContent).not.toContain(directory!);
  const reopened = createLocalModelRegistryAdapter({ filePath: path.join(directory!, "models.json"), discovery: { enabled: false } });
  expect(await reopened.getModelRecord(workspace, saved.modelRecordId)).toMatchObject({ generatedFromRunId: job!.id, localPath: saved.localPath }); expect(await reopened.getModelRecord(foreign, saved.modelRecordId)).toBeUndefined();
  await unmount(); await mount(); await settled(() => container!.textContent!.includes("Training completed.")); expect(copies).toBe(1); expect(registrations).toBe(1);
}, 20000);

it("retains explicit review after registration failure and retries without recopying model bytes", async () => {
  await compose(); await mount(); await start(); await review(); registrationFailure = true;
  await act(async () => button("Save model").click()); await settled(() => readNotificationMessages(container!).some(value => value.includes("Save could not be confirmed")));
  expect(await savedModels()).toHaveLength(0); expect(copies).toBe(1); expect(registrations).toBe(1); expect(button("Save model").disabled).toBe(false); expect(container!.textContent).not.toContain("synthetic-private-registration-failure");
  expect((await lstat(job!.output)).isDirectory()).toBe(true); expect(container!.textContent).not.toContain(directory!);
  await act(async () => button("Save model").click()); await settled(() => container!.textContent!.includes("Trained model saved."));
  const [saved] = await savedModels(); expect(copies).toBe(1); expect(registrations).toBe(2); expect(await readFile(path.join(saved.localPath!, "adapter_model.safetensors"))).toEqual(outputBytes);
  expect(await readdir(path.dirname(saved.localPath!))).toEqual([job!.id]); expect(await lstat(job!.output).catch(() => undefined)).toBeUndefined();
}, 20000);

it("preserves a refused stop, refuses foreign review, and discards without registering", async () => {
  await compose(); await mount(); await start(); await settled(() => Boolean([...container!.querySelectorAll("button")].find(value => value.textContent === "Stop training")));
  await act(async () => button("Stop training").click()); expect(button("Start Training").disabled).toBe(true); expect(button("Stop training")).toBeTruthy();
  await review(); await unmount(); const before = runtimeReads;
  const response = await window.desktopApi!.saveModelTraining!({ runId: job!.id, workspaceId: foreign });
  expect(response).toMatchObject({ ok: false }); expect(runtimeReads).toBe(before); expect(registrations).toBe(0); expect(copies).toBe(0);
  await mount(); await settled(() => Boolean([...container!.querySelectorAll("button")].find(value => value.textContent === "Discard model")));
  await act(async () => button("Discard model").click()); await settled(() => container!.textContent!.includes("Trained model discarded."));
  expect(await savedModels()).toHaveLength(0); expect(copies).toBe(0); expect(registrations).toBe(0); expect(await lstat(job!.output).catch(() => undefined)).toBeUndefined();
}, 20000);

it("rejects a malformed read workspace before entering the preload bridge", async () => {
  await compose(); const entered = vi.spyOn(window.desktopApi!, "readModelTrainingStatus");
  const client = createDesktopModelsClient(), before = calls.length;
  await expect(client.readModelTrainingStatus({ runId: "training-fixture-run", workspaceId: " " })).rejects.toThrow();
  expect(entered).not.toHaveBeenCalled(); expect(calls).toHaveLength(before); expect(runtimeReads).toBe(0);
});
