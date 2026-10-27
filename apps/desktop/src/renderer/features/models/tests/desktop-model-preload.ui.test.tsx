// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, readdir, lstat, realpath, rm, writeFile, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { ModelsFeature } from "../components/ModelsFeature";
import { createDesktopModelsClient } from "../api/desktopModelsClient";
import { createDesktopPreloadApi } from "../../../../preload/exposedApi";
import { NotificationTestHarness, readNotificationMessages } from "../../../../../../../modules/ui/shared/notifications/tests/NotificationTestHarness";
import { registerModelManagementIpc } from "../../../../../../../modules/adapters/transport/ipc-electron/model/registerModelManagementIpc";
import type { IpcMainHandlePort, IpcMainHandleListener } from "../../../../../../../modules/adapters/transport/ipc-electron/ipcMainHandlePort";
import { createLocalModelRegistryAdapter } from "../../../../../../../modules/adapters/persistence/model/createLocalModelRegistryAdapter";
import { createLocalModelLocationAuthorityAdapter } from "../../../../../../../modules/adapters/model/local/createLocalModelLocationAuthorityAdapter";
import { BrowseModelsUseCase, GetModelDetailsUseCase, ListModelsUseCase, SaveModelReferenceUseCase, UpdateModelRecordUseCase, DeleteModelRecordUseCase, RevealModelInFolderUseCase } from "../../../../../../../modules/application/use-cases/model";
import { createWorkspaceId } from "../../../../../../../modules/contracts/workspace";
import type { BrowseModelsRequest, GetModelDetailsRequest } from "../../../../../../../modules/contracts/model";
import { DESKTOP_MODEL_RECORD_DELETE_REQUEST_CHANNEL, DESKTOP_MODEL_REFERENCE_SAVE_REQUEST_CHANNEL, DESKTOP_MODEL_LIST_REQUEST_CHANNEL } from "../../../../../../../modules/contracts/ipc";

const PRIVATE = "synthetic-private-desktop-provider-diagnostic";
const support = { provider: "huggingface" as const, modelId: "qualification/support-reference", displayName: "Synthetic support assistant", taskTags: ["text-generation" as const], inferenceMode: "causal" as const };
const alternate = { ...support, modelId: "qualification/search-reference", displayName: "Synthetic search assistant" };
const workspace = createWorkspaceId("workspace.synthetic-ipc-a"), otherWorkspace = createWorkspaceId("workspace.synthetic-ipc-b");

// The invoke port is an in-process fixture. UI, client, preload contracts,
// registered handlers, use cases and the JSON registry adapter are real.
// This is not physical Electron IPC, sender authorization, production SQLite,
// a model/provider, a native file-effect or a full application qualification.
describe("desktop model UI through preload, registered handlers and durable registry", () => {
  let root: Root | undefined, container: HTMLDivElement | undefined, directory: string | undefined;
  let previousApiDescriptor: PropertyDescriptor | undefined, providerFailure = false;
  let previousActDescriptor: PropertyDescriptor | undefined;
  let identity: { dev: bigint; ino: bigint } | undefined;
  let saveGate: Promise<void> | undefined, releaseSave: (() => void) | undefined, saveFailure = false;
  const flights = new Set<Promise<unknown>>();
  const calls: { channel: string; payload: unknown }[] = [];

  async function unmount() {
    if (root) await act(async () => root!.unmount());
    root = undefined; container?.remove(); container = undefined;
  }
  async function removeOwnedFixture() {
    if (!directory) return;
    const owned = directory; directory = undefined;
    const info = await lstat(owned, { bigint: true });
    expect({ dev: info.dev, ino: info.ino }).toEqual(identity); expect(info.isDirectory() && !info.isSymbolicLink()).toBe(true);
    expect(path.dirname(owned)).toBe(await realpath(tmpdir())); expect(await realpath(owned)).toBe(owned);
    let count = 0, bytes = 0;
    async function inspect(folder: string) {
      for (const name of await readdir(folder)) {
        const child = path.join(folder, name), info = await lstat(child);
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
      if (previousApiDescriptor) Object.defineProperty(window, "desktopApi", previousApiDescriptor);
      else Reflect.deleteProperty(window, "desktopApi");
      try {
        releaseSave?.();
        for (let count = 0; flights.size && count < 20; count++) await act(async () => { await Promise.allSettled([...flights]); });
        expect(flights.size).toBe(0); await removeOwnedFixture();
      }
      finally {
        if (previousActDescriptor) Object.defineProperty(globalThis, "IS_REACT_ACT_ENVIRONMENT", previousActDescriptor); else Reflect.deleteProperty(globalThis, "IS_REACT_ACT_ENVIRONMENT");
        calls.length = 0; providerFailure = saveFailure = false; saveGate = undefined; releaseSave = undefined; identity = undefined; previousActDescriptor = undefined; flights.clear(); vi.restoreAllMocks();
      }
    }
  });
  async function compose() {
    if (!directory) {
      previousApiDescriptor = Object.getOwnPropertyDescriptor(window, "desktopApi");
      previousActDescriptor = Object.getOwnPropertyDescriptor(globalThis, "IS_REACT_ACT_ENVIRONMENT");
      Object.defineProperty(globalThis, "IS_REACT_ACT_ENVIRONMENT", { configurable: true, writable: true, value: true });
      directory = await mkdtemp(path.join(await realpath(tmpdir()), "desktop-model-ipc-ui-"));
      const info = await lstat(directory, { bigint: true }); expect(info.ino).not.toBe(0n); identity = { dev: info.dev, ino: info.ino };
    }
    expect(await realpath(directory)).toBe(directory);
    const registry = createLocalModelRegistryAdapter({ filePath: path.join(directory, "models.json"), now: () => "2026-01-01T00:00:00.000Z", discovery: { enabled: false } });
    const location = createLocalModelLocationAuthorityAdapter({ rootDirectory: directory, approvedRoots: [] });
    const handlers = new Map<string, IpcMainHandleListener>();
    const ipcMain: IpcMainHandlePort = { handle<TRequest, TResponse>(channel: string, listener: IpcMainHandleListener<TRequest, TResponse>) {
      expect(handlers.has(channel)).toBe(false); expect(handlers.size).toBeLessThan(24);
      handlers.set(channel, (event, input) => listener(event, input as TRequest));
    } };
    const unavailable = async (): Promise<never> => { throw new Error("Synthetic operation is intentionally unavailable."); };
    const provider = {
      browseModels: async (input: BrowseModelsRequest) => {
        expect(input).toMatchObject({ provider: "huggingface", query: "support", limit: 25 });
        if (providerFailure) throw new Error(PRIVATE);
        expect([undefined, "page-two"]).toContain(input.cursor);
        return input.cursor ? { models: [alternate] } : { models: [support], nextCursor: "page-two" };
      },
      getModelDetails: async (input: GetModelDetailsRequest) => { expect(input.modelId).toBe(support.modelId); return { model: support }; },
    };
    const saveReference = new SaveModelReferenceUseCase({ modelRegistry: registry });
    registerModelManagementIpc({ ipcMain, browseModelsUseCase: new BrowseModelsUseCase({ providers: { huggingface: provider } }),
      getModelDetailsUseCase: new GetModelDetailsUseCase({ providers: { huggingface: provider } }),
      listModelsUseCase: new ListModelsUseCase({ modelRegistry: registry }), saveModelReferenceUseCase: { execute: async input => { await saveGate; if (saveFailure) throw new Error(PRIVATE); return saveReference.execute(input); } },
      updateModelRecordUseCase: new UpdateModelRecordUseCase({ modelRegistry: registry }),
      deleteModelRecordUseCase: new DeleteModelRecordUseCase({ modelRegistry: registry, modelLocalFilesDeletePort: location }),
      revealModelInFolderUseCase: new RevealModelInFolderUseCase({ modelRegistry: registry, modelLocationRevealer: location }),
      downloadModelUseCase: { execute: unavailable }, trainModelUseCase: { execute: unavailable, read: unavailable, cancel: unavailable, save: unavailable, discard: unavailable },
      validateModelUseCase: { execute: unavailable }, publishModelUseCase: { execute: unavailable } });
    const api = createDesktopPreloadApi({ ipcRenderer: { invoke: async (channel, request) => {
      expect(calls.length).toBeLessThan(60);
      const envelope = request as { operation?: unknown; channel?: unknown; payload?: unknown };
      expect(envelope.channel).toBe(channel); expect(typeof envelope.operation).toBe("string");
      const handler = handlers.get(channel); if (!handler) throw new Error("Unexpected fixture channel.");
      calls.push({ channel, payload: JSON.parse(JSON.stringify(envelope.payload)) });
      const flight = Promise.resolve(handler(Object.freeze({ syntheticInProcessEvent: true }), request)); flights.add(flight);
      void flight.then(() => flights.delete(flight), () => flights.delete(flight)); return flight;
    } } });
    // The fixture exposes only the real model functions it exercises. Type-check
    // those functions against the renderer bridge without claiming compatibility
    // of unrelated required capabilities or the physical contextBridge boundary.
    const bridge: Pick<NonNullable<typeof window.desktopApi>, "browseModels" | "getModelDetails" | "listModels" | "saveModelReference" | "deleteModelRecord" | "revealModelInFolder"> = {
      browseModels: api.browseModels, getModelDetails: api.getModelDetails, listModels: api.listModels,
      saveModelReference: api.saveModelReference, deleteModelRecord: api.deleteModelRecord, revealModelInFolder: api.revealModelInFolder,
    };
    Object.defineProperty(window, "desktopApi", { configurable: true, writable: true, value: bridge });
    return registry;
  }
  async function mount(workspaceId = workspace, client?: ReturnType<typeof createDesktopModelsClient>) {
    if (!root) { container = document.createElement("div"); document.body.appendChild(container); root = createRoot(container); }
    await act(async () => root!.render(<NotificationTestHarness><ModelsFeature workspaceId={workspaceId} client={client} /></NotificationTestHarness>));
  }
  function button(name: string, parent: ParentNode = document) {
    const found = [...parent.querySelectorAll<HTMLButtonElement>("button")].find(value => value.textContent?.trim() === name || value.getAttribute("aria-label") === name);
    expect(Boolean(found)).toBe(true); return found!;
  }
  async function settled(predicate: () => boolean) {
    await vi.waitFor(async () => { await act(async () => { await new Promise(resolve => setTimeout(resolve, 0)); }); expect(predicate()).toBe(true); }, { timeout: 5000, interval: 10 });
  }
  async function setInput(input: HTMLInputElement, value: string) {
    await act(async () => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, value); input.dispatchEvent(new Event("input", { bubbles: true })); });
  }
  const inventory = () => container!.querySelector<HTMLElement>('section[aria-label="Managed models"]')!;
  const searchResults = () => container!.querySelector<HTMLElement>('section[aria-label="Model search results"]')!;
  async function modelRows(registry: ReturnType<typeof createLocalModelRegistryAdapter>, workspaceId = workspace) {
    let result!: Awaited<ReturnType<typeof registry.listModels>>;
    await act(async () => { result = await registry.listModels({ workspaceId }); });
    return result.models;
  }
  async function browse() {
    await setInput(container!.querySelector<HTMLInputElement>('input[placeholder="Model name or organization"]')!, "support");
    await act(async () => button("Search Models").click());
    await settled(() => !button("Search Models").disabled);
  }

  it("paginates, saves, reopens, separates workspaces and deletes the exact confirmed reference", async () => {
    let registry = await compose(); await mount(); await browse();
    expect(searchResults().textContent).toContain(support.displayName); expect(button("Previous").disabled).toBe(true);
    await act(async () => button("Next").click()); await settled(() => searchResults().textContent!.includes(alternate.displayName));
    expect(button("Next").disabled).toBe(true); expect(searchResults().textContent).not.toContain(support.displayName);
    await act(async () => button("Previous").click()); await settled(() => searchResults().textContent!.includes(support.displayName));
    await act(async () => button("Save").click()); await settled(() => readNotificationMessages(container!).includes("Model reference saved."));
    const saved = await modelRows(registry);
    expect(saved).toHaveLength(1); const id = saved[0]!.modelRecordId;
    expect(saved[0]).toMatchObject({ modelId: support.modelId, lifecycleStatus: "saved-reference", taskTags: support.taskTags, inferenceMode: "causal" });
    expect(saved[0]!.localPath).toBeUndefined();
    await act(async () => button("Manage Models").click()); await settled(() => inventory().textContent!.includes(support.displayName));
    await act(async () => button("Details").click()); expect(document.querySelector('[role="dialog"]')!.textContent).toContain(id);
    expect(button("Open in folder").disabled).toBe(true); await act(async () => button("Close model details").click());
    await mount(otherWorkspace); await settled(() => !inventory().textContent!.includes(support.displayName));
    expect(await modelRows(registry, otherWorkspace)).toHaveLength(0);
    await unmount(); registry = await compose(); await mount(); await act(async () => button("Manage Models").click());
    await settled(() => inventory().textContent!.includes(support.displayName));
    expect((await modelRows(registry)).map(model => model.modelRecordId)).toEqual([id]);
    const deleteCalls = () => calls.filter(value => value.channel === DESKTOP_MODEL_RECORD_DELETE_REQUEST_CHANNEL.value);
    await act(async () => button("Delete Record").click());
    await setInput(document.querySelector<HTMLInputElement>('input[placeholder="Delete"]')!, "delete");
    expect(button("Delete model").disabled).toBe(true); await act(async () => button("Cancel").click());
    expect(deleteCalls()).toHaveLength(0); expect(await modelRows(registry)).toHaveLength(1);
    await act(async () => button("Delete Record").click());
    await setInput(document.querySelector<HTMLInputElement>('input[placeholder="Delete"]')!, "Delete");
    await act(async () => button("Delete model").click()); await settled(() => !inventory().textContent!.includes(support.displayName));
    expect(deleteCalls().map(value => value.payload)).toEqual([{ workspaceId: workspace, modelRecordId: id, deleteLocalFiles: false, deleteBackingArtifacts: false }]);
    await unmount(); registry = await compose(); expect(await modelRows(registry)).toHaveLength(0);
    expect(calls.some(value => /download|train|runtime|publish|folder/.test(value.channel))).toBe(false);
  });

  it("keeps native file denial non-successful and preserves the record and test-owned bytes", async () => {
    const registry = await compose(), marker = path.join(directory!, "synthetic-marker.txt");
    await writeFile(marker, "synthetic fixture only\n", { flag: "wx" });
    const saved = await registry.registerDownloadedModel({ workspaceId: workspace, source: "local", provider: "huggingface", displayName: "Synthetic local fixture", modelId: support.modelId, localPath: marker, artifactForm: "full-model" });
    await mount(); await act(async () => button("Manage Models").click()); await settled(() => inventory().textContent!.includes(saved.model.displayName));
    let safe!: Awaited<ReturnType<ReturnType<typeof createDesktopModelsClient>["listModels"]>>;
    await act(async () => { safe = await createDesktopModelsClient().listModels({ workspaceId: workspace }); });
    expect(safe[0]).toMatchObject({ localFilesAvailable: true }); expect(safe[0]).not.toHaveProperty("localPath");
    await act(async () => button("Details").click()); await act(async () => button("Open in folder").click());
    await settled(() => readNotificationMessages(container!).includes("Model files could not be opened. Refresh the inventory and try again."));
    expect(readNotificationMessages(container!)).toContain("Model files could not be opened. Refresh the inventory and try again.");
    expect(document.body.textContent).not.toContain(directory!); await act(async () => button("Close model details").click());
    await act(async () => button("Delete Record").click()); await act(async () => document.querySelector<HTMLInputElement>('input[type="checkbox"]')!.click());
    await setInput(document.querySelector<HTMLInputElement>('input[placeholder="Delete"]')!, "Delete");
    await act(async () => button("Delete model").click());
    await settled(() => readNotificationMessages(container!).includes("Model deletion was not confirmed. Refresh the inventory before retrying."));
    expect(readNotificationMessages(container!)).toContain("Model deletion was not confirmed. Refresh the inventory before retrying.");
    expect(document.querySelector<HTMLInputElement>('input[placeholder="Delete"]')!.value).toBe("Delete");
    expect((await modelRows(registry)).map(model => model.modelRecordId)).toEqual([saved.model.modelRecordId]);
    expect(await readFile(marker, "utf8")).toBe("synthetic fixture only\n");
    expect(readNotificationMessages(container!)).not.toContain("Model record deleted.");
  });

  it("retries a real handler provider failure without disclosing raw errors or writing a record", async () => {
    const registry = await compose(); await mount(); providerFailure = true; await browse();
    expect(container!.textContent).toContain("Failed to browse models. Try again."); expect(container!.textContent).not.toContain(PRIVATE);
    expect(await modelRows(registry)).toHaveLength(0);
    providerFailure = false; await browse(); expect(searchResults().textContent).toContain(support.displayName);
    expect(await modelRows(registry)).toHaveLength(0);
  });

  const saves = () => calls.filter(value => value.channel === DESKTOP_MODEL_REFERENCE_SAVE_REQUEST_CHANNEL.value);
  function assertReference(record: Awaited<ReturnType<typeof modelRows>>[number]) {
    expect(record).toMatchObject({ workspaceId: workspace, modelId: support.modelId, displayName: support.displayName, provider: "huggingface", source: "huggingface", lifecycleStatus: "saved-reference", artifactForm: "full-model", inferenceMode: "causal", taskTags: ["text-generation"], storageScope: "workspace" });
    expect(record.localPath).toBeUndefined();
  }
  it("admits one real reference save before busy rendering and preserves the exact stored reference", async () => {
    const registry = await compose(); await mount(); await browse(); saveGate = new Promise<void>(resolve => { releaseSave = resolve; });
    try {
      await act(async () => { const save = button("Save"); save.click(); save.click(); });
      expect(saves()).toHaveLength(1); expect(button("Save").disabled).toBe(true); expect(await modelRows(registry)).toEqual([]);
    } finally { await act(async () => { releaseSave?.(); await Promise.allSettled([...flights]); }); }
    await settled(() => readNotificationMessages(container!).includes("Model reference saved.")); const saved = await modelRows(registry); expect(saved).toHaveLength(1); assertReference(saved[0]!); expect(saves()).toHaveLength(1);
  });
  it("releases a refused reference save for an explicit safe retry", async () => {
    const registry = await compose(); await mount(); await browse(); saveFailure = true;
    await act(async () => button("Save").click()); await settled(() => readNotificationMessages(container!).includes("Failed to save model reference. Try again.")); expect(await modelRows(registry)).toEqual([]); expect(document.body.textContent).not.toContain(PRIVATE);
    saveFailure = false; await act(async () => button("Save").click()); await settled(() => readNotificationMessages(container!).includes("Model reference saved.")); expect(saves()).toHaveLength(2); const saved = await modelRows(registry); expect(saved).toHaveLength(1); assertReference(saved[0]!);
  });
  for (const retirement of ["workspace", "client", "unmount"] as const) it(`finishes the original reference save without updating the retired ${retirement} view`, async () => {
    const registry = await compose(); await mount(); await browse(); saveGate = new Promise<void>(resolve => { releaseSave = resolve; });
    try {
      await act(async () => button("Save").click()); expect(saves()).toHaveLength(1);
      if (retirement === "unmount") await unmount();
      else { await mount(retirement === "workspace" ? otherWorkspace : workspace, retirement === "client" ? createDesktopModelsClient() : undefined); await settled(() => !searchResults().textContent?.includes(support.displayName)); }
      const lists = calls.filter(value => value.channel === DESKTOP_MODEL_LIST_REQUEST_CHANNEL.value).length;
      await act(async () => { releaseSave?.(); await Promise.allSettled([...flights]); });
      const saved = await modelRows(registry); expect(saved).toHaveLength(1); assertReference(saved[0]!); expect(await modelRows(registry, otherWorkspace)).toEqual([]); expect(calls.filter(value => value.channel === DESKTOP_MODEL_LIST_REQUEST_CHANNEL.value)).toHaveLength(lists);
      expect(document.body.textContent).not.toContain("Model reference saved.");
    } finally { await act(async () => { releaseSave?.(); await Promise.allSettled([...flights]); }); }
  });
});
