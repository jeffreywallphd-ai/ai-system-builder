// @vitest-environment jsdom
import { act, useEffect, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import express from "express";
import { createServer, type Server } from "node:http";
import { lstat, mkdir, mkdtemp, readFile, readdir, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { ModelManagementFeature } from "../components/ModelManagementFeature";
import { createApiModelManagementClient } from "../api/apiModelManagementClient";
import { NotificationBell, NotificationViewport } from "../../../../../../modules/ui/shared/notifications/NotificationCenter";
import { NotificationProvider, useNotificationCenter } from "../../../../../../modules/ui/shared/notifications/NotificationProvider";
import { ModelDownloadNotificationBridge, type ModelDownloadNotificationClient } from "../../../../../../modules/ui/shared/notifications/ModelDownloadNotificationBridge";
import { useTaskObservationManager } from "../../../../../../modules/ui/shared/notifications/TaskObservationProvider";
import type { TaskObservationManager } from "../../../../../../modules/ui/shared/notifications/taskObservation";
import { registerModelManagementApiRoutes } from "../../../../../../modules/adapters/transport/api-express/model/registerModelManagementApiRoutes";
import { createLocalModelRegistryAdapter } from "../../../../../../modules/adapters/persistence/model/createLocalModelRegistryAdapter";
import { BrowseModelsUseCase } from "../../../../../../modules/application/use-cases/model/browse-models.use-case";
import { ListModelsUseCase } from "../../../../../../modules/application/use-cases/model/list-models.use-case";
import { ModelDownloadTasksUseCase } from "../../../../../../modules/application/use-cases/model/model-download-tasks.use-case";
import type { RuntimeTaskRegistryPort } from "../../../../../../modules/application/ports/runtime";
import { TaskType, type RuntimeTaskRecord } from "../../../../../../modules/contracts/runtime";
import { createWorkspaceId } from "../../../../../../modules/contracts/workspace";

const workspace = createWorkspaceId("workspace.http-download-a"), foreign = createWorkspaceId("workspace.http-download-b");
const model = { provider: "huggingface" as const, modelId: "synthetic/support-download", displayName: "Synthetic browser download", inferenceMode: "causal" as const, taskTags: ["text-generation" as const] };
const TOKEN_KEY = "ai-system-builder.paired-device-token", TOKEN = "synthetic-owned-loopback-download-only";
const PRIVATE = "synthetic-private-worker-diagnostic";
const bytes = Buffer.from("synthetic downloaded bytes; never loaded as a model\n");

// Actual mounted feature/client/HTTP routes/use case/notification center/JSON
// registry. Access middleware and finite offline worker/completion are fixtures.
// No actual provider/model, production auth/SQLite, physical browser or native pass.
let root: Root | undefined, container: HTMLDivElement | undefined, directory: string | undefined, server: Server | undefined;
let oldAct: PropertyDescriptor | undefined, oldToken: string | null;
let identity: { dev: bigint; ino: bigint } | undefined;
let registry: ReturnType<typeof createLocalModelRegistryAdapter>, client: ReturnType<typeof createApiModelManagementClient>, observer: TaskObservationManager;
let notificationClient: ModelDownloadNotificationClient;
let taskReads = 0, completions = 0, deniedRequests = 0;
const tasks = new Map<string, RuntimeTaskRecord>(), requests: { path: string; workspaceId?: unknown; requestId?: unknown }[] = [];
const deniedPaths: string[] = [];

async function unmount() { if (root) await act(async () => root!.unmount()); root = undefined; container?.remove(); container = undefined; }
afterEach(async () => {
  try { await unmount(); }
  finally {
    try {
      if (server) { const owned = server; await new Promise<void>((resolve, reject) => owned.close(error => error ? reject(error) : resolve())); expect(owned.listening).toBe(false); server = undefined; }
      if (directory) {
        const owned = directory, info = await lstat(owned, { bigint: true });
        expect({ dev: info.dev, ino: info.ino }).toEqual(identity); expect(info.isDirectory()).toBe(true); expect(info.isSymbolicLink()).toBe(false);
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
    } finally {
      if (oldAct) Object.defineProperty(globalThis, "IS_REACT_ACT_ENVIRONMENT", oldAct); else Reflect.deleteProperty(globalThis, "IS_REACT_ACT_ENVIRONMENT");
      if (oldToken === null) localStorage.removeItem(TOKEN_KEY); else if (oldToken !== undefined) localStorage.setItem(TOKEN_KEY, oldToken);
      directory = undefined; identity = undefined; tasks.clear(); requests.length = 0; deniedPaths.length = 0; taskReads = completions = deniedRequests = 0; vi.restoreAllMocks();
    }
  }
});

async function compose() {
  oldAct = Object.getOwnPropertyDescriptor(globalThis, "IS_REACT_ACT_ENVIRONMENT"); oldToken = localStorage.getItem(TOKEN_KEY);
  Object.defineProperty(globalThis, "IS_REACT_ACT_ENVIRONMENT", { configurable: true, writable: true, value: true }); localStorage.setItem(TOKEN_KEY, TOKEN);
  directory = await mkdtemp(path.join(await realpath(tmpdir()), "model-download-http-ui-")); const info = await lstat(directory, { bigint: true }); expect(info.ino).not.toBe(0n); identity = { dev: info.dev, ino: info.ino };
  const output = path.join(directory, "download"); await mkdir(output); await writeFile(path.join(output, "fixture.txt"), bytes, { flag: "wx" });
  registry = createLocalModelRegistryAdapter({ filePath: path.join(directory, "models.json"), discovery: { enabled: false } });
  const runtime: RuntimeTaskRegistryPort = {
    startTask: async request => {
      expect(tasks.size).toBeLessThan(4); expect(request).toMatchObject({ workspaceId: workspace, taskType: TaskType.MODEL_DOWNLOAD, concurrencyClass: "io", payload: { provider: "transformers", modelId: model.modelId } });
      const id = `download-${tasks.size + 1}`; tasks.set(id, { requestId: id, workspaceId: workspace, taskType: TaskType.MODEL_DOWNLOAD, concurrencyClass: "io", status: "running", progress: { current: 20, total: 100, unit: "bytes", message: PRIVATE } }); return { requestId: id, status: "running" };
    },
    getTaskStatus: async id => { taskReads++; expect(tasks.has(id)).toBe(true); return structuredClone(tasks.get(id)!); },
    listTasks: async request => { expect(request).toMatchObject({ workspaceId: workspace, includeCompleted: true, limit: 100 }); return { tasks: [...tasks.values()].map(value => structuredClone(value)) }; },
    cancelTask: async id => { tasks.get(id)!.status = "cancelled"; return { requestId: id, status: "cancelled", cancelled: true }; },
  };
  const downloads = new ModelDownloadTasksUseCase({ runtimeTaskRegistry: runtime, modelRegistry: registry, modelDownloadCompletion: { readCompletedModelDownload: async id => { expect(tasks.get(id)?.status).toBe("succeeded"); completions++; return { provider: "transformers", modelId: model.modelId, downloaded: true, fromCache: false, localPath: output }; } } });
  const app = express(); app.use(express.json({ limit: "32kb", strict: true }));
  app.use((request, response, next) => {
    if (requests.length + deniedRequests >= 200) { response.status(429).json({ ok: false }); return; }
    if (request.headers.authorization !== `Bearer ${TOKEN}`) { deniedRequests++; deniedPaths.push(request.path); response.status(401).json({ ok: false, error: { code: "unauthenticated", message: "Synthetic test access denied." } }); return; }
    requests.push({ path: request.path, workspaceId: request.body?.workspaceId, requestId: request.body?.requestId }); next();
  });
  const unavailable = { execute: async (): Promise<never> => { throw new Error("Unused fixture operation."); } };
  const browse = new BrowseModelsUseCase({
    providers: { huggingface: { browseModels: async request => {
      expect(request).toMatchObject({ provider: "huggingface", query: "support" });
      return { models: [model] };
    } } },
  });
  registerModelManagementApiRoutes({ app, modelDownloadTasksUseCase: downloads, browseModelsUseCase: browse,
    listModelsUseCase: new ListModelsUseCase({ modelRegistry: registry }), getModelDetailsUseCase: unavailable,
    saveModelReferenceUseCase: unavailable, downloadModelUseCase: unavailable,
    updateModelRecordUseCase: unavailable, deleteModelRecordUseCase: unavailable });
  server = createServer(app); await new Promise<void>((resolve, reject) => { server!.once("error", reject); server!.listen(0, "127.0.0.1", resolve); });
  const address = server.address(); if (!address || typeof address === "string") throw new Error("Owned listener did not start.");
  client = createApiModelManagementClient({ apiBaseUrl: `http://127.0.0.1:${address.port}/api`, requestTimeoutMs: { list: 2000, browse: 2000, "download-start": 2000, "download-list": 2000, "download-complete": 2000, "download-read": 2000, "download-cancel": 2000 } });
  if (!client.listModelDownloads || !client.completeModelDownload) throw new Error("Actual download client methods are required.");
  notificationClient = { listModelDownloads: client.listModelDownloads, completeModelDownload: client.completeModelDownload };
  return vi.spyOn(registry, "registerDownloadedModel");
}
function Surface({ workspaceId }: { workspaceId: string }) {
  const notifications = useNotificationCenter(); observer = useTaskObservationManager(); const [show, setShow] = useState(true);
  useEffect(() => notifications.setActiveWorkspaceId(workspaceId), [notifications.setActiveWorkspaceId, workspaceId]);
  return <><button onClick={() => setShow(!show)}>{show ? "Leave Models" : "Return to Models"}</button><NotificationBell /><NotificationViewport /><ModelDownloadNotificationBridge client={notificationClient} workspaceId={workspaceId} />{show ? <ModelManagementFeature client={client} workspaceId={workspaceId} /> : <p>Another feature</p>}</>;
}
async function mount(workspaceId = workspace) { if (!root) { container = document.createElement("div"); document.body.appendChild(container); root = createRoot(container); } await act(async () => root!.render(<NotificationProvider><Surface workspaceId={workspaceId} /></NotificationProvider>)); }
function button(name: string) { const found = [...document.querySelectorAll<HTMLButtonElement>("button")].find(value => value.textContent?.trim() === name || value.getAttribute("aria-label") === name); expect(Boolean(found)).toBe(true); return found!; }
async function settled(predicate: () => boolean) { await vi.waitFor(async () => { await act(async () => { await new Promise(resolve => setTimeout(resolve, 0)); }); expect(predicate()).toBe(true); }, { timeout: 2500, interval: 10 }); }
async function search() {
  await settled(() => !button("Refresh").disabled);
  const input = container!.querySelector<HTMLInputElement>('input[placeholder="Search models"]')!;
  await act(async () => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, "support"); input.dispatchEvent(new Event("input", { bubbles: true })); });
  await act(async () => button("Browse models").click()); await settled(() => Boolean(container!.querySelector('section li strong')?.textContent?.includes(model.displayName)));
}
async function openNotifications() { if (!document.querySelector('[role="dialog"][aria-labelledby="application-notification-heading"]')) await act(async () => document.querySelector<HTMLButtonElement>('button[title="Notifications"]')!.click()); }
const messages = () => document.querySelector(".ui-notification__panel")?.textContent ?? "";
async function poll(predicate: () => boolean) { await act(async () => observer.invalidate({ workspaceId: workspace, family: "model-download" })); await settled(predicate); }
async function rows() { let result!: Awaited<ReturnType<typeof registry.listModels>>; await act(async () => { result = await registry.listModels({ workspaceId: workspace }); }); return result.models; }

it("keeps real HTTP download progress through navigation and registers/reopens the exact model once", async () => {
  const registrations = await compose(); await mount(); await search();
  await act(async () => { const download = button("Download"); download.click(); download.click(); });
  await settled(() => tasks.size === 1); expect(requests.filter(value => value.path === "/api/model/download/start")).toHaveLength(1);
  await openNotifications(); await settled(() => messages().includes("Downloading model.")); expect(document.querySelector("progress")?.value).toBe(20);
  expect(await rows()).toHaveLength(0); expect(registrations).not.toHaveBeenCalled(); expect(document.body.textContent).not.toContain(PRIVATE);
  await act(async () => button("Leave Models").click()); tasks.get("download-1")!.progress = { current: 80, total: 100, unit: "bytes" }; await poll(() => document.querySelector("progress")?.value === 80);
  await mount(foreign); await openNotifications(); expect(messages()).toContain("No notifications yet."); expect(messages()).not.toContain(model.displayName); expect(document.querySelector(".ui-notification__panel progress")).toBeNull();
  tasks.get("download-1")!.status = "succeeded"; tasks.get("download-1")!.progress = undefined; await mount(); await openNotifications(); await settled(() => messages().includes("Model download completed."));
  expect(registrations).toHaveBeenCalledTimes(1); expect(completions).toBe(1); const saved = await rows(); expect(saved).toHaveLength(1); expect(saved[0]).toMatchObject({ modelId: model.modelId, lifecycleStatus: "downloaded", workspaceId: workspace });
  await act(async () => { await Promise.all([client.completeModelDownload!({ workspaceId: workspace, requestId: "download-1" }), client.completeModelDownload!({ workspaceId: workspace, requestId: "download-1" })]); }); expect(registrations).toHaveBeenCalledTimes(1); expect(completions).toBe(1);
  await act(async () => button("Return to Models").click()); await settled(() => Boolean([...container!.querySelectorAll("section")].find(value => value.querySelector("h3")?.textContent === "Server model inventory")?.textContent?.includes(model.displayName)));
  expect(document.body.textContent).not.toContain(directory!); await unmount(); registry = createLocalModelRegistryAdapter({ filePath: path.join(directory!, "models.json"), discovery: { enabled: false } }); expect((await rows()).map(value => value.modelRecordId)).toEqual([saved[0]!.modelRecordId]); expect((await registry.listModels({ workspaceId: foreign })).models).toHaveLength(0); expect(await readFile(path.join(directory!, "download/fixture.txt"))).toEqual(bytes);
});

it("refuses an unauthenticated start without worker admission and permits an explicit authorized retry", async () => {
  const registrations = await compose(); await mount(); await search(); localStorage.removeItem(TOKEN_KEY);
  await act(async () => button("Download").click()); await openNotifications(); await settled(() => messages().includes("Unable to start this model download. Check Notifications and try again."));
  expect(deniedRequests).toBeGreaterThan(0); expect(deniedPaths).toContain("/api/model/download/start"); expect(tasks.size).toBe(0); expect(registrations).not.toHaveBeenCalled(); expect(await rows()).toHaveLength(0); expect(document.body.textContent).not.toContain(TOKEN);
  localStorage.setItem(TOKEN_KEY, TOKEN); await act(async () => button("Download").click()); await settled(() => tasks.size === 1); await poll(() => messages().includes("Downloading model."));
  tasks.get("download-1")!.status = "succeeded"; tasks.get("download-1")!.progress = undefined; await poll(() => messages().includes("Model download completed.")); expect(registrations).toHaveBeenCalledTimes(1); expect(await rows()).toHaveLength(1);
});

it("refuses foreign HTTP completion before worker reads and preserves cancelled non-registration", async () => {
  const registrations = await compose(); await mount(); await search(); await act(async () => button("Download").click()); await settled(() => tasks.size === 1); await unmount(); const before = taskReads;
  await expect(client.completeModelDownload!({ workspaceId: foreign, requestId: "download-1" })).rejects.toMatchObject({ code: "internal", status: 500, message: "Model management request failed." }); expect(taskReads).toBe(before); expect(completions).toBe(0);
  expect((await client.cancelModelDownload!({ workspaceId: workspace, requestId: "download-1" })).cancelled).toBe(true); expect((await client.readModelDownload!({ workspaceId: workspace, requestId: "download-1" })).activity.status).toBe("cancelled"); expect(registrations).not.toHaveBeenCalled(); expect(await rows()).toHaveLength(0);
});
