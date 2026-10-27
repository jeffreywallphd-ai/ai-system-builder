// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, mkdir, readdir, lstat, realpath, rm, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import { deflateSync, inflateSync } from "node:zlib";
import { ImageGenerationFeature } from "../components/ImageGenerationFeature";
import { createDesktopImageGenerationClient } from "../api/desktopImageGenerationClient";
import { createDesktopPreloadApi } from "../../../../preload/exposedApi";
import { NotificationTestHarness } from "../../../../../../../modules/ui/shared/notifications/tests/NotificationTestHarness";
import { GenerateImageUseCase } from "../../../../../../../modules/application/use-cases/image-generation/generate-image.use-case";
import { ImageGenerationTaskAuthorityService } from "../../../../../../../modules/application/services/image/image-generation-task-authority.service";
import { FinalizeImageGenerationService } from "../../../../../../../modules/application/services/image/finalize-image-generation.service";
import { ImageGenerationFinalizationOrchestratorService } from "../../../../../../../modules/application/services/image/image-generation-finalization-orchestrator.service";
import { createFilesystemGeneratedImagePersistenceAdapter } from "../../../../../../../modules/adapters/storage/filesystem/artifact-store/createFilesystemGeneratedImagePersistenceAdapter";
import { createLocalArtifactCatalogPersistenceAdapter } from "../../../../../../../modules/adapters/storage/filesystem/artifact-catalog/createLocalArtifactCatalogAdapter";
import { createLocalArtifactStorageBindingAdapter } from "../../../../../../../modules/adapters/storage/filesystem/artifact-catalog/createLocalArtifactStorageBindingAdapter";
import { createLocalImageAssetRegistryAdapter } from "../../../../../../../modules/adapters/persistence/image/createLocalImageAssetRegistryAdapter";
import { createLocalWorkspaceRepository } from "../../../../../../../modules/adapters/persistence/workspace/createLocalWorkspaceRepository";
import { registerImageGenerationIpc } from "../../../../../../../modules/adapters/transport/ipc-electron/image-generation/registerImageGenerationIpc";
import type { IpcMainHandlePort, IpcMainHandleListener } from "../../../../../../../modules/adapters/transport/ipc-electron/ipcMainHandlePort";
import { DESKTOP_IMAGE_GENERATION_START_REQUEST_CHANNEL, DESKTOP_IMAGE_GENERATION_READ_REQUEST_CHANNEL, DESKTOP_IMAGE_GENERATION_CANCEL_REQUEST_CHANNEL, DESKTOP_IMAGE_GENERATION_FINALIZE_REQUEST_CHANNEL } from "../../../../../../../modules/contracts/ipc";
import type { RuntimeTaskRegistryPort } from "../../../../../../../modules/application/ports/runtime";
import { TaskType, type RuntimeTaskRecord, type StartRuntimeTaskRequest } from "../../../../../../../modules/contracts/runtime";
import { createWorkspaceId } from "../../../../../../../modules/contracts/workspace";

const workspace = createWorkspaceId("workspace.image-ipc-a"), otherWorkspace = createWorkspaceId("workspace.image-ipc-b");
const ASSET = "image.synthetic-ipc-output", NOW = "2026-01-01T00:00:00.000Z";
const PRIVATE = "synthetic-private-image-registration-diagnostic";
const rawPixels = Buffer.concat(Array.from({ length: 64 }, () => Buffer.from([0, ...Array.from({ length: 64 }, () => [255, 0, 0, 255]).flat()])));
function pngChunk(type: string, data: Buffer) {
  const body = Buffer.concat([Buffer.from(type), data]); let crc = 0xffffffff;
  for (const byte of body) { crc ^= byte; for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0); }
  const length = Buffer.alloc(4), checksum = Buffer.alloc(4); length.writeUInt32BE(data.length); checksum.writeUInt32BE((crc ^ 0xffffffff) >>> 0);
  return Buffer.concat([length, body, checksum]);
}
const header = Buffer.alloc(13); header.writeUInt32BE(64, 0); header.writeUInt32BE(64, 4); header[8] = 8; header[9] = 6;
const PNG = Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), pngChunk("IHDR", header), pngChunk("IDAT", deflateSync(rawPixels)), pngChunk("IEND", Buffer.alloc(0))]);

// Actual mounted Desktop UI/client/preload, registered IPC, application/task
// authority, PNG persistence, catalog, bindings and JSON image registry.
// The invoke event/runtime/access/passive inventory/settings/media reads are
// finite fixtures. No physical Electron/sender authorization, ComfyUI/model,
// production SQLite, native file effects or full-app qualification follows.
describe("desktop image UI through preload and durable finalization", () => {
  let root: Root | undefined, container: HTMLDivElement | undefined, directory: string | undefined;
  let previousApiDescriptor: PropertyDescriptor | undefined, previousActDescriptor: PropertyDescriptor | undefined;
  let createBefore: PropertyDescriptor | undefined, revokeBefore: PropertyDescriptor | undefined;
  let identity: { dev: bigint; ino: bigint } | undefined;
  const previousSessions = new Map<string, string | null>();
  const flights = new Set<Promise<unknown>>();
  let held = false, failRegistration = false, registrationCalls = 0, persistedCalls = 0, runtimeReads = 0, cancelCalls = 0, previews = 0;
  const starts: StartRuntimeTaskRequest[] = [], requests: string[] = [], createdUrls: string[] = [], revokedUrls: string[] = [];
  async function unmount() { if (root) await act(async () => root!.unmount()); root = undefined; container?.remove(); container = undefined; }
  async function removeOwnedTree() {
    if (!directory) return; const owned = directory; directory = undefined;
    const info = await lstat(owned, { bigint: true });
    expect({ dev: info.dev, ino: info.ino }).toEqual(identity); expect(info.isDirectory() && !info.isSymbolicLink()).toBe(true);
    expect(path.dirname(owned)).toBe(await realpath(tmpdir())); expect(await realpath(owned)).toBe(owned);
    let count = 0, bytes = 0;
    async function inspect(folder: string) {
      for (const name of await readdir(folder)) { const child = path.join(folder, name), info = await lstat(child);
        expect(++count).toBeLessThanOrEqual(128); expect(info.isSymbolicLink()).toBe(false);
        if (info.isDirectory()) await inspect(child);
        else { expect(info.isFile() && info.nlink === 1).toBe(true); bytes += info.size; expect(bytes).toBeLessThanOrEqual(2 * 1024 * 1024); }
      }
    }
    await inspect(owned); await rm(owned, { recursive: true });
  }
  afterEach(async () => {
    try { await unmount(); }
    finally {
      try {
        for (let count = 0; flights.size && count < 20; count++) await act(async () => { await Promise.allSettled([...flights]); });
        expect(flights.size).toBe(0);
        expect([...revokedUrls].sort()).toEqual([...createdUrls].sort());
        await removeOwnedTree();
      } finally {
        if (previousApiDescriptor) Object.defineProperty(window, "desktopApi", previousApiDescriptor); else Reflect.deleteProperty(window, "desktopApi");
        if (previousActDescriptor) Object.defineProperty(globalThis, "IS_REACT_ACT_ENVIRONMENT", previousActDescriptor); else Reflect.deleteProperty(globalThis, "IS_REACT_ACT_ENVIRONMENT");
        for (const [key, value] of previousSessions) { if (value === null) sessionStorage.removeItem(key); else sessionStorage.setItem(key, value); }
        previousSessions.clear(); identity = undefined;
        if (createBefore) Object.defineProperty(URL, "createObjectURL", createBefore); else Reflect.deleteProperty(URL, "createObjectURL");
        if (revokeBefore) Object.defineProperty(URL, "revokeObjectURL", revokeBefore); else Reflect.deleteProperty(URL, "revokeObjectURL");
        starts.length = 0; requests.length = 0; createdUrls.length = 0; revokedUrls.length = 0;
        held = false; failRegistration = false; registrationCalls = 0; persistedCalls = 0; runtimeReads = 0; cancelCalls = 0; previews = 0; vi.restoreAllMocks();
      }
    }
  });
  async function compose() {
    previousApiDescriptor = Object.getOwnPropertyDescriptor(window, "desktopApi");
    previousActDescriptor = Object.getOwnPropertyDescriptor(globalThis, "IS_REACT_ACT_ENVIRONMENT");
    Object.defineProperty(globalThis, "IS_REACT_ACT_ENVIRONMENT", { configurable: true, writable: true, value: true });
    for (const id of [workspace, otherWorkspace]) { const key = `ai-system-builder.image-task.v1:${id}`; previousSessions.set(key, sessionStorage.getItem(key)); sessionStorage.removeItem(key); }
    createBefore = Object.getOwnPropertyDescriptor(URL, "createObjectURL"); revokeBefore = Object.getOwnPropertyDescriptor(URL, "revokeObjectURL");
    Object.defineProperty(URL, "createObjectURL", { configurable: true, value: () => { const value = `blob:synthetic-desktop-image-ipc-${createdUrls.length}`; createdUrls.push(value); return value; } });
    Object.defineProperty(URL, "revokeObjectURL", { configurable: true, value: (value: string) => { revokedUrls.push(value); } });
    directory = await mkdtemp(path.join(await realpath(tmpdir()), "image-ipc-ui-")); expect(await realpath(directory)).toBe(directory);
    const info = await lstat(directory, { bigint: true }); expect(info.ino).not.toBe(0n); identity = { dev: info.dev, ino: info.ino };
    const outputRoot = path.join(directory, "runtime-output"), storageRoot = path.join(directory, "artifact-storage"), imageFile = path.join(directory, "images.json");
    await mkdir(outputRoot); await mkdir(storageRoot);
    const workspaceRepository = createLocalWorkspaceRepository({ rootDirectory: directory });
    for (const id of [workspace, otherWorkspace]) await workspaceRepository.saveWorkspace({ workspaceId: id, displayName: "Synthetic image workspace", status: "active", createdAt: NOW, updatedAt: NOW });
    const authority = new ImageGenerationTaskAuthorityService({ workspaceRepository, workspaceAuthorization: { authorizeWorkspaceOperation: async input => {
      expect([workspace, otherWorkspace]).toContain(input.workspace.workspaceId); expect(["image-generation.read", "image-generation.write"]).toContain(input.operation);
    } } });
    const catalog = createLocalArtifactCatalogPersistenceAdapter({ rootDirectory: storageRoot }), bindings = createLocalArtifactStorageBindingAdapter({ rootDirectory: storageRoot });
    const registry = createLocalImageAssetRegistryAdapter({ filePath: imageFile, now: () => NOW });
    const persistence = createFilesystemGeneratedImagePersistenceAdapter({ comfyUiOutputRoot: outputRoot, artifactStorageRoot: storageRoot, artifactCatalogAppend: catalog, artifactStorageBinding: bindings, now: () => NOW, maximumGeneratedImageBytes: 32 * 1024 });
    let record: RuntimeTaskRecord | undefined;
    const runtime: RuntimeTaskRegistryPort = {
      startTask: async input => {
        expect(starts.length).toBeLessThan(3); expect(input.taskType).toBe(TaskType.IMAGE_GENERATION); expect(input.workspaceId).toBe(workspace);
        if (!input.requestId) throw new Error("Fixture task identity missing."); starts.push(structuredClone(input));
        await writeFile(path.join(outputRoot, "synthetic-red.png"), PNG, { flag: "wx" });
        record = { requestId: input.requestId, workspaceId: workspace, taskType: TaskType.IMAGE_GENERATION, status: "running", concurrencyClass: "cpu-light", progress: { current: 1, total: 2 },
          metadata: { request: input.payload }, data: { outputs: [{ type: "image", engine: "synthetic-offline-fixture", fileName: "synthetic-red.png", width: 64, height: 64 }] } };
        return { requestId: input.requestId, status: "queued" };
      },
      getTaskStatus: async id => { expect(++runtimeReads).toBeLessThanOrEqual(32); if (!record || record.requestId !== id) throw new Error("Unknown fixture task."); if (!held) record.status = "succeeded"; return structuredClone(record); },
      cancelTask: async id => { expect(record?.requestId).toBe(id); cancelCalls++; return { requestId: id, status: "running", cancelled: false }; },
      listTasks: async () => ({ tasks: record ? [structuredClone(record)] : [] }),
    };
    const finalizeService = new FinalizeImageGenerationService({ imageAssetRegistry: { getImageAsset: registry.getImageAsset, registerImageAsset: async input => {
      registrationCalls++; if (failRegistration) throw new Error(PRIVATE); return registry.registerImageAsset(input);
    } }, generatedImagePersistence: { persistGeneratedImage: async input => { persistedCalls++; return persistence.persistGeneratedImage(input); } }, createAssetId: () => ASSET, now: () => NOW });
    const finalizer = new ImageGenerationFinalizationOrchestratorService({ runtimeTaskRegistry: runtime, taskAuthority: authority, finalizeImageGenerationService: finalizeService });
    const handlers = new Map<string, IpcMainHandleListener>();
    const ipcMain: IpcMainHandlePort = { handle<TRequest, TResponse>(channel: string, listener: IpcMainHandleListener<TRequest, TResponse>) {
      expect(handlers.has(channel)).toBe(false); expect(handlers.size).toBeLessThan(4);
      handlers.set(channel, (event, input) => listener(event, input as TRequest));
    } };
    registerImageGenerationIpc({ ipcMain, generateImageUseCase: new GenerateImageUseCase({ runtimeTaskRegistry: runtime, taskAuthority: authority, createRequestId: () => "image.synthetic-request" }), imageGenerationFinalizationOrchestrator: finalizer });
    expect([...handlers.keys()].sort()).toEqual([DESKTOP_IMAGE_GENERATION_START_REQUEST_CHANNEL.value, DESKTOP_IMAGE_GENERATION_READ_REQUEST_CHANNEL.value, DESKTOP_IMAGE_GENERATION_CANCEL_REQUEST_CHANNEL.value, DESKTOP_IMAGE_GENERATION_FINALIZE_REQUEST_CHANNEL.value].sort());
    const api = createDesktopPreloadApi({ ipcRenderer: { invoke: async (channel, request) => {
      expect(requests.length).toBeLessThan(80);
      const envelope = request as { channel?: unknown; operation?: unknown };
      expect(envelope.channel).toBe(channel); expect(typeof envelope.operation).toBe("string");
      const handler = handlers.get(channel); if (!handler) throw new Error("Unexpected fixture channel.");
      requests.push(channel);
      const flight = Promise.resolve(handler(Object.freeze({ syntheticInProcessEvent: true }), request)); flights.add(flight);
      void flight.then(() => flights.delete(flight), () => flights.delete(flight)); return flight;
    } } });
    const bridge: Pick<NonNullable<typeof window.desktopApi>, "startImageGeneration" | "readImageGeneration" | "cancelImageGeneration" | "finalizeImageGenerationIfCompleted" | "listModels" | "browseArtifacts" | "readArtifactViewerMedia" | "listApplicationSettingDefinitions" | "readApplicationSettings"> = {
      startImageGeneration: api.startImageGeneration, readImageGeneration: api.readImageGeneration,
      cancelImageGeneration: api.cancelImageGeneration, finalizeImageGenerationIfCompleted: api.finalizeImageGenerationIfCompleted,
      // Passive model/artifact/settings/media fixtures are not transport qualification.
      listModels: async input => ({ ok: true, value: { models: input?.workspaceId === workspace ? [{ workspaceId: workspace, modelRecordId: "model.synthetic-image", modelId: "qualification/synthetic-image", displayName: "Synthetic image checkpoint", source: "local", lifecycleStatus: "downloaded", artifactForm: "checkpoint", inferenceMode: "text-to-image", taskTags: ["text-to-image"], createdAt: NOW }] : [] } }),
      browseArtifacts: async input => { expect([workspace, otherWorkspace]).toContain(input?.workspaceId); return { ok: true, value: { items: [] } }; },
      listApplicationSettingDefinitions: async () => ({ ok: true, value: { definitions: [] } }),
      readApplicationSettings: async () => ({ ok: true, value: { values: [] } }),
      readArtifactViewerMedia: async (locator, context) => {
        expect(context?.workspaceId).toBe(workspace);
        const rows = await catalog.browseArtifactCatalogRecords({ workspaceId: workspace, artifactFamily: "image" });
        if (!rows.ok || rows.value.records.length !== 1 || locator.storageKey !== rows.value.records[0]!.storageKey) throw new Error("Unknown fixture preview.");
        const bytes = await readFile(path.join(storageRoot, rows.value.records[0]!.storageKey)); expect(bytes.equals(PNG)).toBe(true);
        previews++; return { ok: true, value: { mediaType: "image/png", bytes: new Uint8Array(bytes) } };
      },
    };
    Object.defineProperty(window, "desktopApi", { configurable: true, writable: true, value: bridge });
    return { registry, catalog, bindings, storageRoot, outputRoot, imageFile };
  }

  async function mount(workspaceId = workspace) {
    if (!root) { container = document.createElement("div"); document.body.appendChild(container); root = createRoot(container); }
    await act(async () => root!.render(<NotificationTestHarness><ImageGenerationFeature workspaceId={workspaceId} /></NotificationTestHarness>));
  }
  function button(name: string) { const found = [...container!.querySelectorAll<HTMLButtonElement>("button")].find(value => value.textContent?.trim() === name); expect(Boolean(found)).toBe(true); return found!; }
  async function settled(predicate: () => boolean) {
    const deadline = Date.now() + 10_000;
    do {
      await act(async () => { await new Promise(resolve => setTimeout(resolve, 10)); });
      if (predicate()) return;
    } while (Date.now() < deadline);
    expect(predicate(), JSON.stringify({ paths: requests, starts: starts.length, registrationCalls, persistedCalls, runtimeReads, cancelCalls, previews,
      syntheticUi: container?.textContent?.slice(-2000) })).toBe(true);
  }
  async function configure() {
    await settled(() => Boolean(container!.textContent?.includes("Synthetic image checkpoint")));
    const model = [...container!.querySelectorAll("select")].find(select => [...select.options].some(option => option.value === "qualification/synthetic-image"))!;
    await act(async () => { Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value")!.set!.call(model, "qualification/synthetic-image"); model.dispatchEvent(new Event("change", { bubbles: true })); });
    for (const [label, value] of [["Prompt", "A red square for a synthetic inventory label"], ["Negative Prompt", "blur"], ["Width", "64"], ["Height", "64"], ["Seed", "0"], ["Steps", "2"], ["CFG", "4"], ["Denoise", "0.8"], ["Sampler", "euler"], ["Scheduler", "normal"], ["Number of Images", "1"]]) {
      const wrapper = [...container!.querySelectorAll("label")].find(node => node.querySelector("span")?.textContent?.trim().startsWith(label))!;
      const input = wrapper.querySelector<HTMLInputElement | HTMLTextAreaElement>("input, textarea")!;
      await act(async () => { Object.getOwnPropertyDescriptor(input instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype, "value")!.set!.call(input, value); input.dispatchEvent(new Event("input", { bubbles: true })); });
    }
  }

  async function persisted(host: Awaited<ReturnType<typeof compose>>) {
    await settled(() => previews >= 1);
    async function inspect() {
    const asset = await host.registry.getImageAsset(workspace, ASSET); expect(asset?.workspaceId).toBe(workspace); expect(asset?.metadata?.requestId).toBe("image.synthetic-request");
    const rows = await host.catalog.browseArtifactCatalogRecords({ workspaceId: workspace, artifactFamily: "image" }); if (!rows.ok) throw new Error("Expected owned image catalog.");
    expect(rows.value.records).toHaveLength(1); const row = rows.value.records[0]!;
    const binding = await host.bindings.readArtifactStorageBindings({ workspaceId: workspace, artifactId: asset!.artifactId }); if (!binding.ok) throw new Error("Expected owned image binding.");
    expect(binding.value.bindings).toHaveLength(1); expect(binding.value.bindings[0]).toMatchObject({ workspaceId: workspace, artifactId: asset!.artifactId, role: "primary", backing: { kind: "artifact-object", locator: row.storageKey } });
    const bytes = await readFile(path.join(host.storageRoot, row.storageKey)); expect(bytes.equals(PNG)).toBe(true);
    expect(bytes.readUInt32BE(16)).toBe(64); expect(bytes.readUInt32BE(20)).toBe(64);
    let offset = 8, decoded: Buffer | undefined;
    while (offset < bytes.length) { const length = bytes.readUInt32BE(offset); if (bytes.toString("ascii", offset + 4, offset + 8) === "IDAT") decoded = inflateSync(bytes.subarray(offset + 8, offset + 8 + length)); offset += length + 12; }
    expect(decoded?.equals(rawPixels)).toBe(true); expect(row.checksum?.value).toBe(createHash("sha256").update(bytes).digest("hex"));
    expect(await readdir(host.outputRoot)).toEqual([]);
    const reopened = createLocalImageAssetRegistryAdapter({ filePath: host.imageFile }); expect(await reopened.getImageAsset(workspace, ASSET)).toEqual(asset);
    expect(await reopened.getImageAsset(otherWorkspace, ASSET)).toBeNull();
    expect(registrationCalls).toBeGreaterThanOrEqual(1); expect(persistedCalls).toBe(1); expect(starts).toHaveLength(1);
    expect(starts[0]!.payload).toEqual({ width: 64, height: 64, seed: 0, steps: 2, cfg: 4, denoise: 0.8, numImages: 1, latentSource: { kind: "empty" }, negativePrompt: "blur", sampler: "euler", scheduler: "normal", model: "qualification/synthetic-image", prompt: "A red square for a synthetic inventory label", engineHints: undefined });
    return { asset, row };
    }
    let result!: Awaited<ReturnType<typeof inspect>>;
    await act(async () => { result = await inspect(); });
    return result;
  }
  it("configures, finalizes and reopens exact image bytes and workspace-owned records", async () => {
    const host = await compose(); await mount(); await configure(); await act(async () => button("Start Generation").click());
    await settled(() => container!.textContent!.includes(ASSET)); await settled(() => previews === 1);
    await settled(() => Boolean(container!.querySelector(`img[alt="Generated image"]`)));
    const saved = await persisted(host); expect(registrationCalls).toBe(1);
    await mount(otherWorkspace); expect(container!.textContent).not.toContain(ASSET);
    await mount(); await settled(() => container!.textContent!.includes(ASSET));
    await act(async () => { expect((await host.registry.getImageAsset(workspace, ASSET))?.artifactId).toBe(saved.asset!.artifactId); });
  }, 20_000);
  it("retries failed registration without copying or registering another image", async () => {
    const host = await compose(); failRegistration = true; await mount(); await configure(); await act(async () => button("Start Generation").click());
    await settled(() => [...container!.querySelectorAll("button")].some(value => value.textContent === "Retry finalization"));
    expect(container!.textContent).not.toContain(ASSET); expect(document.body.textContent).not.toContain(PRIVATE);
    await act(async () => { expect(await host.registry.getImageAsset(workspace, ASSET)).toBeNull(); }); expect(persistedCalls).toBe(1); expect(registrationCalls).toBe(1);
    failRegistration = false; await act(async () => button("Retry finalization").click()); await settled(() => container!.textContent!.includes(ASSET));
    await persisted(host); expect(registrationCalls).toBe(2); expect(document.body.textContent).not.toContain(PRIVATE);
  }, 20_000);
  it("continues observation after refused cancellation and denies foreign task reads", async () => {
    const host = await compose(); held = true; await mount(); await configure(); await act(async () => button("Start Generation").click());
    await settled(() => !button("Cancel").disabled); await act(async () => button("Cancel").click());
    await settled(() => Boolean(container!.textContent?.includes("Cancellation remains unconfirmed. Runtime progress will continue to be checked.")));
    expect(cancelCalls).toBe(1); expect(container!.textContent).not.toContain(ASSET); expect(button("Generating...").disabled).toBe(true);
    // Retire the legitimate UI observer before isolating the foreign-read oracle.
    await unmount(); await settled(() => flights.size === 0); const before = runtimeReads;
    await act(async () => { expect(await createDesktopImageGenerationClient().readImageGeneration({ requestId: "image.synthetic-request", workspaceId: otherWorkspace })).toMatchObject({ ok: false, error: { message: "Image generation request failed." } }); });
    expect(runtimeReads).toBe(before);
    const foreign = createDesktopImageGenerationClient();
    await act(async () => {
      expect(await foreign.cancelImageGeneration({ requestId: "image.synthetic-request", workspaceId: otherWorkspace })).toMatchObject({ ok: false });
      expect(await foreign.finalizeImageGenerationIfCompleted({ requestId: "image.synthetic-request", workspaceId: otherWorkspace })).toMatchObject({ ok: false });
    });
    expect(runtimeReads).toBe(before); expect(cancelCalls).toBe(1); expect(persistedCalls).toBe(0);
    held = false; await mount(); await settled(() => container!.textContent!.includes(ASSET)); await persisted(host);
  }, 20_000);
});
