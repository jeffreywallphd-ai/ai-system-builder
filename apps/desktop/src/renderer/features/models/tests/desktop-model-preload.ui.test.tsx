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
import { DESKTOP_MODEL_RECORD_DELETE_REQUEST_CHANNEL } from "../../../../../../../modules/contracts/ipc";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
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
  const calls: { channel: string; payload: unknown }[] = [];

  async function unmount() {
    if (root) await act(async () => root!.unmount());
    root = undefined; container?.remove(); container = undefined;
  }
  async function removeOwnedFixture() {
    if (!directory) return;
    const owned = directory; directory = undefined;
    expect(path.dirname(owned)).toBe(await realpath(tmpdir())); expect(await realpath(owned)).toBe(owned);
    let count = 0, bytes = 0;
    async function inspect(folder: string) {
      for (const name of await readdir(folder)) {
        const child = path.join(folder, name), info = await lstat(child);
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
      if (previousApiDescriptor) Object.defineProperty(window, "desktopApi", previousApiDescriptor);
      else Reflect.deleteProperty(window, "desktopApi");
      try { await removeOwnedFixture(); }
      finally { calls.length = 0; providerFailure = false; vi.restoreAllMocks(); }
    }
  });
  async function compose() {
    if (!directory) {
      previousApiDescriptor = Object.getOwnPropertyDescriptor(window, "desktopApi");
      directory = await mkdtemp(path.join(await realpath(tmpdir()), "desktop-model-ipc-ui-"));
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
    registerModelManagementIpc({ ipcMain, browseModelsUseCase: new BrowseModelsUseCase({ providers: { huggingface: provider } }),
      getModelDetailsUseCase: new GetModelDetailsUseCase({ providers: { huggingface: provider } }),
      listModelsUseCase: new ListModelsUseCase({ modelRegistry: registry }), saveModelReferenceUseCase: new SaveModelReferenceUseCase({ modelRegistry: registry }),
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
      return handler(Object.freeze({ syntheticInProcessEvent: true }), request);
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
  async function mount(workspaceId = workspace) {
    if (!root) { container = document.createElement("div"); document.body.appendChild(container); root = createRoot(container); }
    await act(async () => root!.render(<NotificationTestHarness><ModelsFeature workspaceId={workspaceId} /></NotificationTestHarness>));
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
});
