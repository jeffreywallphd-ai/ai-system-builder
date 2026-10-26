// @vitest-environment jsdom
import { act, useEffect, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import { lstat, mkdir, mkdtemp, readFile, readdir, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { ModelsFeature } from "../components/ModelsFeature";
import { createDesktopModelsClient } from "../api/desktopModelsClient";
import { createDesktopPreloadApi } from "../../../../preload/exposedApi";
import { NotificationBell, NotificationViewport } from "../../../../../../../modules/ui/shared/notifications/NotificationCenter";
import { NotificationProvider, useNotificationCenter } from "../../../../../../../modules/ui/shared/notifications/NotificationProvider";
import { ModelDownloadNotificationBridge } from "../../../../../../../modules/ui/shared/notifications/ModelDownloadNotificationBridge";
import { useTaskObservationManager } from "../../../../../../../modules/ui/shared/notifications/TaskObservationProvider";
import type { TaskObservationManager } from "../../../../../../../modules/ui/shared/notifications/taskObservation";
import { registerModelManagementIpc } from "../../../../../../../modules/adapters/transport/ipc-electron/model/registerModelManagementIpc";
import type { IpcMainHandleListener, IpcMainHandlePort } from "../../../../../../../modules/adapters/transport/ipc-electron/ipcMainHandlePort";
import { createLocalModelRegistryAdapter } from "../../../../../../../modules/adapters/persistence/model/createLocalModelRegistryAdapter";
import { BrowseModelsUseCase } from "../../../../../../../modules/application/use-cases/model/browse-models.use-case";
import { ListModelsUseCase } from "../../../../../../../modules/application/use-cases/model/list-models.use-case";
import { ModelDownloadTasksUseCase } from "../../../../../../../modules/application/use-cases/model/model-download-tasks.use-case";
import type { RuntimeTaskRegistryPort } from "../../../../../../../modules/application/ports/runtime";
import { TaskType, type RuntimeTaskRecord } from "../../../../../../../modules/contracts/runtime";
import { createWorkspaceId } from "../../../../../../../modules/contracts/workspace";

vi.mock("../../settings/components/SettingsPanel", () => ({ SettingsPanel: () => null }));
const workspace = createWorkspaceId("workspace.download-fixture-a"), foreign = createWorkspaceId("workspace.download-fixture-b");
const model = { provider: "huggingface" as const, modelId: "synthetic/support-download", displayName: "Synthetic support download", inferenceMode: "causal" as const, taskTags: ["text-generation" as const] };
const PRIVATE = "synthetic-private-worker-diagnostic";
const bytes = Buffer.from("synthetic download fixture; never loaded as a model\n");

// Real feature/client/preload/handlers/task use case/notifications/JSON registry.
// In-process invoke and finite offline worker/completion are fixtures. These
// tests grant no physical IPC, provider/model, native-effect or host qualification.
let root: Root | undefined, container: HTMLDivElement | undefined, directory: string | undefined;
let oldApi: PropertyDescriptor | undefined, oldAct: PropertyDescriptor | undefined;
let directoryIdentity: { dev: bigint; ino: bigint } | undefined;
let registry: ReturnType<typeof createLocalModelRegistryAdapter>, client: ReturnType<typeof createDesktopModelsClient>, observer: TaskObservationManager;
let taskReads = 0, completions = 0;
let startGate: Promise<void> | undefined, releaseStart: (() => void) | undefined;
const tasks = new Map<string, RuntimeTaskRecord>(), calls: { channel: string; payload: unknown }[] = [];

async function unmount() { if (root) await act(async () => root!.unmount()); root = undefined; container?.remove(); container = undefined; }
afterEach(async () => {
  try { await act(async () => releaseStart?.()); await unmount(); }
  finally {
    if (oldApi) Object.defineProperty(window, "desktopApi", oldApi); else Reflect.deleteProperty(window, "desktopApi");
    if (oldAct) Object.defineProperty(globalThis, "IS_REACT_ACT_ENVIRONMENT", oldAct); else Reflect.deleteProperty(globalThis, "IS_REACT_ACT_ENVIRONMENT");
    if (directory) {
      const owned = directory, info = await lstat(owned, { bigint: true });
      expect({ dev: info.dev, ino: info.ino }).toEqual(directoryIdentity); expect(info.isDirectory()).toBe(true); expect(info.isSymbolicLink()).toBe(false);
      expect(await realpath(owned)).toBe(owned); expect(path.dirname(owned)).toBe(await realpath(tmpdir()));
      let count = 0, size = 0;
      async function inspect(parent: string) {
        for (const name of await readdir(parent)) {
          const child = path.join(parent, name), current = await lstat(child);
          expect(++count).toBeLessThanOrEqual(64); expect(current.isSymbolicLink()).toBe(false);
          if (current.isDirectory()) await inspect(child);
          else { expect(current.isFile()).toBe(true); size += current.size; expect(size).toBeLessThanOrEqual(1024 * 1024); }
        }
      }
      await inspect(owned); await rm(owned, { recursive: true });
    }
    directory = undefined; directoryIdentity = undefined; tasks.clear(); calls.length = 0; taskReads = completions = 0; startGate = undefined; releaseStart = undefined; vi.restoreAllMocks();
  }
});

async function compose() {
  oldApi = Object.getOwnPropertyDescriptor(window, "desktopApi"); oldAct = Object.getOwnPropertyDescriptor(globalThis, "IS_REACT_ACT_ENVIRONMENT");
  Object.defineProperty(globalThis, "IS_REACT_ACT_ENVIRONMENT", { configurable: true, writable: true, value: true });
  directory = await mkdtemp(path.join(await realpath(tmpdir()), "model-download-ui-"));
  const info = await lstat(directory, { bigint: true }); expect(info.ino).not.toBe(0n); directoryIdentity = { dev: info.dev, ino: info.ino };
  const output = path.join(directory, "download"); await mkdir(output); await writeFile(path.join(output, "fixture.txt"), bytes, { flag: "wx" });
  registry = createLocalModelRegistryAdapter({ filePath: path.join(directory, "models.json"), discovery: { enabled: false } });
  const runtime: RuntimeTaskRegistryPort = {
    startTask: async request => {
      expect(tasks.size).toBeLessThan(4); expect(request).toMatchObject({ workspaceId: workspace, taskType: TaskType.MODEL_DOWNLOAD, concurrencyClass: "io", payload: { provider: "transformers", modelId: model.modelId } });
      const id = `download-${tasks.size + 1}`; tasks.set(id, { requestId: id, workspaceId: workspace, taskType: TaskType.MODEL_DOWNLOAD, concurrencyClass: "io", status: "running", progress: { current: 25, total: 100, unit: "bytes", message: PRIVATE }, updatedAt: "2026-01-01T00:00:00.000Z" });
      await startGate; return { requestId: id, status: "running" };
    },
    getTaskStatus: async id => { taskReads++; expect(tasks.has(id)).toBe(true); return structuredClone(tasks.get(id)!); },
    listTasks: async request => { expect(request).toMatchObject({ workspaceId: workspace, includeCompleted: true, limit: 100 }); return { tasks: [...tasks.values()].map(value => structuredClone(value)) }; },
    cancelTask: async id => { const task = tasks.get(id)!; task.status = "cancelled"; return { requestId: id, cancelled: true, status: "cancelled" }; },
  };
  const useCase = new ModelDownloadTasksUseCase({ runtimeTaskRegistry: runtime, modelRegistry: registry, modelDownloadCompletion: { readCompletedModelDownload: async id => {
    expect(tasks.get(id)?.status).toBe("succeeded"); completions++;
    return { provider: "transformers", modelId: model.modelId, downloaded: true, fromCache: false, localPath: output };
  } } });
  const handlers = new Map<string, IpcMainHandleListener>();
  const ipcMain: IpcMainHandlePort = { handle<TRequest, TResponse>(channel: string, listener: IpcMainHandleListener<TRequest, TResponse>) { expect(handlers.has(channel)).toBe(false); expect(handlers.size).toBeLessThan(40); handlers.set(channel, (event, input) => listener(event, input as TRequest)); } };
  const unavailable = async (): Promise<never> => { throw new Error("Unused fixture operation."); };
  registerModelManagementIpc({ ipcMain, modelDownloadTasksUseCase: useCase, browseModelsUseCase: new BrowseModelsUseCase({ providers: { huggingface: { browseModels: async request => { expect(request).toMatchObject({ provider: "huggingface", limit: 25 }); return { models: [model] }; } } } }),
    listModelsUseCase: new ListModelsUseCase({ modelRegistry: registry }), getModelDetailsUseCase: { execute: unavailable }, saveModelReferenceUseCase: { execute: unavailable }, downloadModelUseCase: { execute: unavailable }, updateModelRecordUseCase: { execute: unavailable }, deleteModelRecordUseCase: { execute: unavailable }, revealModelInFolderUseCase: { execute: unavailable }, trainModelUseCase: { execute: unavailable, read: unavailable, cancel: unavailable, save: unavailable, discard: unavailable }, validateModelUseCase: { execute: unavailable }, publishModelUseCase: { execute: unavailable } });
  const api = createDesktopPreloadApi({ ipcRenderer: { invoke: async (channel, request) => {
    expect(calls.length).toBeLessThan(200); const envelope = request as { channel?: unknown; payload?: unknown };
    expect(envelope.channel).toBe(channel); const handler = handlers.get(channel); expect(Boolean(handler)).toBe(true);
    calls.push({ channel, payload: structuredClone(envelope.payload) }); return handler!(Object.freeze({ syntheticInProcessEvent: true }), request);
  } } });
  const bridge: Pick<NonNullable<typeof window.desktopApi>, "browseModels" | "listModels" | "startModelDownload" | "readModelDownload" | "completeModelDownload" | "listModelDownloads" | "cancelModelDownload"> = { browseModels: api.browseModels, listModels: api.listModels, startModelDownload: api.startModelDownload, readModelDownload: api.readModelDownload, completeModelDownload: api.completeModelDownload, listModelDownloads: api.listModelDownloads, cancelModelDownload: api.cancelModelDownload };
  Object.defineProperty(window, "desktopApi", { configurable: true, writable: true, value: bridge }); client = createDesktopModelsClient();
  return vi.spyOn(registry, "registerDownloadedModel");
}
function Surface({ workspaceId }: { workspaceId: string }) {
  const notifications = useNotificationCenter(); observer = useTaskObservationManager(); const [show, setShow] = useState(true);
  useEffect(() => notifications.setActiveWorkspaceId(workspaceId), [notifications.setActiveWorkspaceId, workspaceId]);
  return <><button onClick={() => setShow(!show)}>{show ? "Leave Models" : "Return to Models"}</button><NotificationBell /><NotificationViewport /><ModelDownloadNotificationBridge client={client} workspaceId={workspaceId} />{show ? <ModelsFeature client={client} workspaceId={workspaceId} /> : <p>Another feature</p>}</>;
}
async function mount(workspaceId = workspace) {
  if (!root) { container = document.createElement("div"); document.body.appendChild(container); root = createRoot(container); }
  await act(async () => root!.render(<NotificationProvider><Surface workspaceId={workspaceId} /></NotificationProvider>));
}
function button(name: string) { const found = [...document.querySelectorAll<HTMLButtonElement>("button")].find(value => value.textContent?.trim() === name || value.getAttribute("aria-label") === name); expect(Boolean(found)).toBe(true); return found!; }
async function settled(predicate: () => boolean) { await vi.waitFor(async () => { await act(async () => { await new Promise(resolve => setTimeout(resolve, 0)); }); expect(predicate()).toBe(true); }, { timeout: 2000, interval: 10 }); }
async function search() { await act(async () => button("Search Models").click()); await settled(() => Boolean(container!.querySelector('section[aria-label="Model search results"] article'))); }
async function poll(predicate: () => boolean) { await act(async () => observer.invalidate({ workspaceId: workspace, family: "model-download" })); await settled(predicate); }
const messages = () => document.querySelector(".ui-notification__list")?.textContent ?? "";
async function rows() {
  let result!: Awaited<ReturnType<typeof registry.listModels>>;
  await act(async () => { result = await registry.listModels({ workspaceId: workspace }); });
  return result.models;
}

it("admits one immediate download and keeps real progress through navigation, workspace return and durable registration", async () => {
  const registrations = await compose(); await mount(); await search();
  startGate = new Promise(resolve => { releaseStart = resolve; });
  await act(async () => { button("Download").click(); button("Download").click(); });
  await settled(() => tasks.size > 0); expect(tasks.size).toBe(1);
  expect(button("Download").disabled).toBe(true);
  await act(async () => releaseStart!()); await settled(() => !button("Download").disabled);
  await act(async () => button("Notifications").click()); await settled(() => messages().includes("Downloading model."));
  expect(document.querySelector("progress")?.value).toBe(25); expect(document.body.textContent).not.toContain(PRIVATE);
  expect(await rows()).toHaveLength(0); expect(registrations).not.toHaveBeenCalled();
  await act(async () => button("Leave Models").click()); expect(container!.textContent).toContain("Another feature");
  tasks.get("download-1")!.progress = { current: 90, total: 100, unit: "bytes", message: PRIVATE };
  await poll(() => document.querySelector("progress")?.value === 90);
  await mount(foreign);
  await act(async () => document.querySelector<HTMLButtonElement>('button[title="Notifications"]')!.click());
  expect(document.querySelector('[role="dialog"][aria-labelledby="application-notification-heading"]')).not.toBeNull();
  expect(document.querySelector(".ui-notification__empty")?.textContent).toBe("No notifications yet.");
  expect(document.querySelector(".ui-notification__panel")?.textContent).not.toContain(model.displayName);
  expect(document.querySelector(".ui-notification__panel progress")).toBeNull();
  tasks.get("download-1")!.status = "succeeded"; tasks.get("download-1")!.progress = undefined;
  expect(registrations).not.toHaveBeenCalled(); await mount();
  // Workspace switching closes the notification panel. Reopen it as a user
  // would; a missing panel is not evidence that the activity was lost.
  if (!document.querySelector(".ui-notification__list")) await act(async () => document.querySelector<HTMLButtonElement>('button[title="Notifications"]')!.click());
  await settled(() => messages().includes("Model download completed."));
  expect(registrations).toHaveBeenCalledTimes(1); expect(completions).toBe(1);
  const saved = await rows(); expect(saved).toHaveLength(1); expect(saved[0]).toMatchObject({ workspaceId: workspace, modelId: model.modelId, lifecycleStatus: "downloaded", inferenceMode: "causal" });
  await act(async () => { await Promise.all([client.completeModelDownload({ workspaceId: workspace, requestId: "download-1" }), client.completeModelDownload({ workspaceId: workspace, requestId: "download-1" })]); });
  expect(registrations).toHaveBeenCalledTimes(1); expect(completions).toBe(1); expect(document.body.textContent).not.toContain(directory!);
  await act(async () => button("Return to Models").click()); await act(async () => button("Manage Models").click());
  await settled(() => Boolean(container!.querySelector('section[aria-label="Managed models"]')?.textContent?.includes(model.displayName)));
  await unmount(); registry = createLocalModelRegistryAdapter({ filePath: path.join(directory!, "models.json"), discovery: { enabled: false } });
  expect((await rows()).map(value => value.modelRecordId)).toEqual([saved[0]!.modelRecordId]); expect((await registry.listModels({ workspaceId: foreign })).models).toHaveLength(0);
  expect(await readFile(path.join(directory!, "download/fixture.txt"))).toEqual(bytes);
});

it("keeps a failed task out of inventory and safely completes a separately requested retry", async () => {
  const registrations = await compose(); await mount(); await search(); await act(async () => button("Download").click()); await settled(() => tasks.size === 1);
  await act(async () => button("Notifications").click()); await settled(() => messages().includes("Downloading model."));
  tasks.get("download-1")!.status = "failed"; tasks.get("download-1")!.error = { code: "synthetic_failure", message: `${PRIVATE} C:\\private-fixture\\model token=synthetic`, retryable: true };
  await poll(() => messages().includes("Model download failed. Open Models to review the download and retry."));
  expect(await rows()).toHaveLength(0); expect(registrations).not.toHaveBeenCalled(); expect(completions).toBe(0); expect(document.body.textContent).not.toContain(PRIVATE);
  await act(async () => button("Download").click()); await settled(() => tasks.size === 2); await poll(() => messages().includes("Downloading model."));
  tasks.get("download-2")!.status = "succeeded"; tasks.get("download-2")!.progress = undefined;
  await poll(() => messages().includes("Model download completed.")); expect(registrations).toHaveBeenCalledTimes(1); expect(await rows()).toHaveLength(1); expect(completions).toBe(1);
});

it("refuses foreign completion before runtime reads and reports confirmed cancellation without registering", async () => {
  const registrations = await compose(); await mount(); await search(); await act(async () => button("Download").click()); await settled(() => tasks.size === 1);
  await unmount(); const before = taskReads;
  await expect(client.completeModelDownload({ workspaceId: foreign, requestId: "download-1" })).rejects.toThrow("Model management request failed.");
  expect(taskReads).toBe(before); expect(completions).toBe(0); expect(registrations).not.toHaveBeenCalled();
  expect((await client.cancelModelDownload({ workspaceId: workspace, requestId: "download-1" })).cancelled).toBe(true);
  expect((await client.readModelDownload({ workspaceId: workspace, requestId: "download-1" })).activity.status).toBe("cancelled");
  expect(await rows()).toHaveLength(0); expect(completions).toBe(0);
});
