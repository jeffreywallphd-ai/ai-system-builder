// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import express from "express";
import { createServer, type Server } from "node:http";
import { mkdtemp, mkdir, readdir, lstat, realpath, rm, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import { deflateSync, inflateSync } from "node:zlib";
import { ImageGenerationFeature } from "../components/ImageGenerationFeature";
import { resetImageGenerationPersistedStateForTests } from "../hooks/useImageGenerationFeature";
import { createApiImageGenerationClient } from "../api/apiImageGenerationClient";
import { NotificationTestHarness, readNotificationMessages } from "../../../../../../modules/ui/shared/notifications/tests/NotificationTestHarness";
import { GenerateImageUseCase } from "../../../../../../modules/application/use-cases/image-generation/generate-image.use-case";
import { ImageGenerationTaskAuthorityService } from "../../../../../../modules/application/services/image/image-generation-task-authority.service";
import { FinalizeImageGenerationService } from "../../../../../../modules/application/services/image/finalize-image-generation.service";
import { ImageGenerationFinalizationOrchestratorService } from "../../../../../../modules/application/services/image/image-generation-finalization-orchestrator.service";
import { createFilesystemGeneratedImagePersistenceAdapter } from "../../../../../../modules/adapters/storage/filesystem/artifact-store/createFilesystemGeneratedImagePersistenceAdapter";
import { createLocalArtifactCatalogPersistenceAdapter } from "../../../../../../modules/adapters/storage/filesystem/artifact-catalog/createLocalArtifactCatalogAdapter";
import { createLocalArtifactStorageBindingAdapter } from "../../../../../../modules/adapters/storage/filesystem/artifact-catalog/createLocalArtifactStorageBindingAdapter";
import { createLocalImageAssetRegistryAdapter } from "../../../../../../modules/adapters/persistence/image/createLocalImageAssetRegistryAdapter";
import { createLocalWorkspaceRepository } from "../../../../../../modules/adapters/persistence/workspace/createLocalWorkspaceRepository";
import { registerImageGenerationApiRoutes } from "../../../../../../modules/adapters/transport/api-express/image-generation/registerImageGenerationApiRoutes";
import type { RuntimeTaskRegistryPort } from "../../../../../../modules/application/ports/runtime";
import { TaskType, type RuntimeTaskRecord, type StartRuntimeTaskRequest } from "../../../../../../modules/contracts/runtime";
import { createWorkspaceId } from "../../../../../../modules/contracts/workspace";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const TOKEN_KEY = "ai-system-builder.paired-device-token", TOKEN = "synthetic-image-http-test-credential";
const workspace = createWorkspaceId("workspace.image-http-a"), otherWorkspace = createWorkspaceId("workspace.image-http-b");
const ASSET = "image.synthetic-http-output", NOW = "2026-01-01T00:00:00.000Z";
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

// Actual mounted UI/client, loopback HTTP/routes, ownership/use cases and
// filesystem/JSON finalization are composed here. The task engine, HTTP access
// policy, passive model/artifact reads and preview URL facility are fixtures.
// No ComfyUI, model, browser pixel decoder, production auth/SQLite or whole app
// is qualified by this tier.
describe("image UI with real HTTP and durable finalization", () => {
  let root: Root | undefined, container: HTMLDivElement | undefined, directory: string | undefined, server: Server | undefined;
  let fetchBefore: typeof fetch, tokenBefore: string | null, createBefore: PropertyDescriptor | undefined, revokeBefore: PropertyDescriptor | undefined;
  let held = false, failRegistration = false, registrationCalls = 0, persistedCalls = 0, runtimeReads = 0, cancelCalls = 0, previews = 0, pendingFetches = 0;
  const starts: StartRuntimeTaskRequest[] = [], requests: string[] = [], createdUrls: string[] = [], revokedUrls: string[] = [];
  async function unmount() { if (root) await act(async () => root!.unmount()); root = undefined; container?.remove(); container = undefined; }
  async function removeOwnedTree() {
    if (!directory) return; const owned = directory; directory = undefined;
    expect(path.dirname(owned)).toBe(await realpath(tmpdir())); expect(await realpath(owned)).toBe(owned);
    let count = 0, bytes = 0;
    async function inspect(folder: string) {
      for (const name of await readdir(folder)) { const child = path.join(folder, name), info = await lstat(child);
        expect(++count).toBeLessThanOrEqual(128); expect(info.isSymbolicLink()).toBe(false);
        if (info.isDirectory()) await inspect(child);
        else { expect(info.isFile()).toBe(true); bytes += info.size; expect(bytes).toBeLessThanOrEqual(2 * 1024 * 1024); }
      }
    }
    await inspect(owned); await rm(owned, { recursive: true });
  }
  afterEach(async () => {
    try { await unmount(); }
    finally {
      try {
        if (server) { const owned = server; await new Promise<void>((resolve, reject) => owned.close(error => error ? reject(error) : resolve())); expect(owned.listening).toBe(false); server = undefined; }
        expect(pendingFetches).toBe(0);
        expect([...revokedUrls].sort()).toEqual([...createdUrls].sort());
        await removeOwnedTree();
      } finally {
        if (fetchBefore) globalThis.fetch = fetchBefore;
        if (tokenBefore === null) localStorage.removeItem(TOKEN_KEY); else if (tokenBefore !== undefined) localStorage.setItem(TOKEN_KEY, tokenBefore);
        if (createBefore) Object.defineProperty(URL, "createObjectURL", createBefore); else Reflect.deleteProperty(URL, "createObjectURL");
        if (revokeBefore) Object.defineProperty(URL, "revokeObjectURL", revokeBefore); else Reflect.deleteProperty(URL, "revokeObjectURL");
        resetImageGenerationPersistedStateForTests(); starts.length = 0; requests.length = 0; createdUrls.length = 0; revokedUrls.length = 0;
        held = false; failRegistration = false; registrationCalls = 0; persistedCalls = 0; runtimeReads = 0; cancelCalls = 0; previews = 0; vi.restoreAllMocks();
      }
    }
  });
  async function compose() {
    fetchBefore = globalThis.fetch; tokenBefore = localStorage.getItem(TOKEN_KEY); localStorage.setItem(TOKEN_KEY, TOKEN);
    createBefore = Object.getOwnPropertyDescriptor(URL, "createObjectURL"); revokeBefore = Object.getOwnPropertyDescriptor(URL, "revokeObjectURL");
    Object.defineProperty(URL, "createObjectURL", { configurable: true, value: () => { const value = `blob:synthetic-image-http-${createdUrls.length}`; createdUrls.push(value); return value; } });
    Object.defineProperty(URL, "revokeObjectURL", { configurable: true, value: (value: string) => { revokedUrls.push(value); } });
    resetImageGenerationPersistedStateForTests();
    directory = await mkdtemp(path.join(await realpath(tmpdir()), "image-http-ui-")); expect(await realpath(directory)).toBe(directory);
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
    const app = express(); app.use(express.json({ limit: "32kb", strict: true }));
    app.use((request, response, next) => {
      if (request.headers.authorization !== `Bearer ${TOKEN}`) { response.status(401).json({ ok: false, error: { code: "unauthenticated", message: "Synthetic access denied." } }); return; }
      if (requests.length >= 80) { response.status(429).json({ ok: false }); return; }
      requests.push(request.path); next();
    });
    registerImageGenerationApiRoutes({ app, generateImageUseCase: new GenerateImageUseCase({ runtimeTaskRegistry: runtime, taskAuthority: authority, createRequestId: () => "image.synthetic-request" }),
      imageGenerationFinalizationOrchestrator: finalizer, imageGenerationRuntimeControl: { unloadModel: async () => { throw new Error("Not part of this fixture."); }, readRuntimeResources: async () => ({ memoryUsagePercent: 10, cpuUsagePercent: 5, gpuUsagePercent: 0 }) } });
    // Passive reads and media delivery are fixture routes, not production route qualification.
    app.post("/api/model/list", (request, response) => response.json({ ok: true, value: { models: request.body.workspaceId === workspace ? [{ workspaceId: workspace, modelRecordId: "model.synthetic-image", modelId: "qualification/synthetic-image", displayName: "Synthetic image checkpoint", source: "local", lifecycleStatus: "downloaded", artifactForm: "checkpoint", inferenceMode: "text-to-image", taskTags: ["text-to-image"], createdAt: NOW }] : [] } }));
    app.post("/api/artifact/browse", (_request, response) => response.json({ ok: true, value: { items: [] } }));
    app.get("/api/artifact/media/view", async (request, response) => {
      const rows = await catalog.browseArtifactCatalogRecords({ workspaceId: workspace, artifactFamily: "image" });
      if (!rows.ok || rows.value.records.length !== 1 || request.query.workspaceId !== workspace || request.query.storageKey !== rows.value.records[0]!.storageKey) { response.status(404).end(); return; }
      previews++; response.type("image/png").send(await readFile(path.join(storageRoot, rows.value.records[0]!.storageKey)));
    });
    server = createServer(app); await new Promise<void>((resolve, reject) => { server!.once("error", reject); server!.listen(0, "127.0.0.1", resolve); });
    const address = server.address(); if (!address || typeof address === "string") throw new Error("Owned listener unavailable.");
    const baseUrl = `http://127.0.0.1:${address.port}`;
    globalThis.fetch = (input, init) => {
      if (typeof input !== "string" || !input.startsWith("/api/")) throw new Error("Fixture refused a nonlocal or unexpected fetch.");
      pendingFetches++;
      return fetchBefore(`${baseUrl}${input}`, init).finally(() => { pendingFetches--; });
    };
    return { registry, catalog, bindings, storageRoot, outputRoot, imageFile, baseUrl };
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
    for (const [field, value] of [["prompt", "A red square for a synthetic inventory label"], ["negativePrompt", ""], ["width", "64"], ["height", "64"], ["seed", "0"], ["steps", "2"]]) {
      const input = container!.querySelector<HTMLInputElement | HTMLTextAreaElement>(`#image-generation-${field}`)!;
      await act(async () => { Object.getOwnPropertyDescriptor(input instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype, "value")!.set!.call(input, value); input.dispatchEvent(new Event("input", { bubbles: true })); });
    }
  }
  async function persisted(host: Awaited<ReturnType<typeof compose>>) {
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
    expect(starts[0]!.payload).toMatchObject({ width: 64, height: 64, seed: 0, steps: 2, model: "model.synthetic-image", prompt: "A red square for a synthetic inventory label" });
    return { asset, row };
    }
    let result!: Awaited<ReturnType<typeof inspect>>;
    await act(async () => { result = await inspect(); });
    return result;
  }
  it("configures, finalizes and reopens exact image bytes and workspace-owned records", async () => {
    const host = await compose(); await mount(); await configure(); await act(async () => button("Generate").click());
    await settled(() => container!.textContent!.includes(ASSET)); await settled(() => previews === 1);
    await settled(() => Boolean(container!.querySelector(`img[alt="Generated image ${ASSET}"]`)));
    const saved = await persisted(host); expect(registrationCalls).toBe(1);
    await mount(otherWorkspace); expect(container!.textContent).not.toContain(ASSET);
    await mount(); await settled(() => container!.textContent!.includes(ASSET));
    await act(async () => { expect((await host.registry.getImageAsset(workspace, ASSET))?.artifactId).toBe(saved.asset!.artifactId); });
  }, 20_000);
  it("retries failed registration without copying or registering another image", async () => {
    const host = await compose(); failRegistration = true; await mount(); await configure(); await act(async () => button("Generate").click());
    await settled(() => [...container!.querySelectorAll("button")].some(value => value.textContent === "Retry finalization"));
    expect(container!.textContent).not.toContain(ASSET); expect(document.body.textContent).not.toContain(PRIVATE);
    await act(async () => { expect(await host.registry.getImageAsset(workspace, ASSET)).toBeNull(); }); expect(persistedCalls).toBe(1); expect(registrationCalls).toBe(1);
    failRegistration = false; await act(async () => button("Retry finalization").click()); await settled(() => container!.textContent!.includes(ASSET));
    await persisted(host); expect(registrationCalls).toBe(2); expect(document.body.textContent).not.toContain(PRIVATE);
  }, 20_000);
  it("continues observation after refused cancellation and denies foreign task reads", async () => {
    const host = await compose(); held = true; await mount(); await configure(); await act(async () => button("Generate").click());
    await settled(() => !button("Cancel").disabled); await act(async () => button("Cancel").click());
    await settled(() => readNotificationMessages(container!).includes("Cancellation remains pending. Runtime progress will continue to be checked."));
    expect(cancelCalls).toBe(1); expect(container!.textContent).not.toContain(ASSET); expect(button("Generating...").disabled).toBe(true);
    // Retire the legitimate UI observer before isolating the foreign-read oracle.
    await unmount(); await settled(() => pendingFetches === 0); const before = runtimeReads;
    await act(async () => { await expect(createApiImageGenerationClient().readImageGeneration({ requestId: "image.synthetic-request", workspaceId: otherWorkspace })).rejects.toThrow(); });
    expect(runtimeReads).toBe(before);
    held = false; await mount(); await settled(() => container!.textContent!.includes(ASSET)); await persisted(host);
  }, 20_000);
});
