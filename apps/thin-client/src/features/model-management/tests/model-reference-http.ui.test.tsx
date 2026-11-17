// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import express from "express";
import { createServer, type Server } from "node:http";
import { mkdtemp, readdir, lstat, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { ModelManagementFeature } from "../components/ModelManagementFeature";
import { createApiModelManagementClient } from "../api/apiModelManagementClient";
import { NotificationTestHarness, readNotificationMessages } from "../../../../../../modules/ui/shared/notifications/tests/NotificationTestHarness";
import { registerModelManagementApiRoutes } from "../../../../../../modules/adapters/transport/api-express/model/registerModelManagementApiRoutes";
import { createLocalModelRegistryAdapter } from "../../../../../../modules/adapters/persistence/model/createLocalModelRegistryAdapter";
import { BrowseModelsUseCase, GetModelDetailsUseCase, ListModelsUseCase, SaveModelReferenceUseCase, UpdateModelRecordUseCase, DeleteModelRecordUseCase } from "../../../../../../modules/application/use-cases/model";
import { createWorkspaceId } from "../../../../../../modules/contracts/workspace";
import type { BrowseModelsRequest, GetModelDetailsRequest } from "../../../../../../modules/contracts/model";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const TOKEN_KEY = "ai-system-builder.paired-device-token";
const TOKEN = "synthetic-local-ui-transport-credential-only";
const PRIVATE = "synthetic-private-provider-diagnostic";
const support = { provider: "huggingface" as const, modelId: "qualification/synthetic-reference", displayName: "Synthetic support assistant", taskTags: ["text-generation" as const] };
const workspace = createWorkspaceId("workspace.synthetic-http-a"), otherWorkspace = createWorkspaceId("workspace.synthetic-http-b");

// This joins the real client, HTTP routes, use cases and durable registry.
// The fixed provider and credential middleware are fixtures, not qualification
// of a remote provider, deployed authentication, the full app or model runtime.
describe("model reference UI with real loopback HTTP and durable registry", () => {
  let root: Root | undefined, container: HTMLDivElement | undefined, directory: string | undefined;
  let server: Server | undefined;
  const requests: { path: string; workspaceId?: string; deleteLocalFiles?: boolean; deleteBackingArtifacts?: boolean }[] = [];
  let failure = false, providerCalls = 0;

  async function closeListener() {
    if (!server) return;
    const owned = server;
    await new Promise<void>((resolve, reject) => owned.close(error => error ? reject(error) : resolve()));
    expect(owned.listening).toBe(false); server = undefined;
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
    try { if (root) await act(async () => root!.unmount()); }
    finally {
      root = undefined; container?.remove(); container = undefined;
      try { await closeListener(); await removeOwnedFixture(); }
      finally { localStorage.removeItem(TOKEN_KEY); requests.length = 0; failure = false; providerCalls = 0; vi.restoreAllMocks(); }
    }
  });

  async function openListener() {
    if (!directory) directory = await mkdtemp(path.join(await realpath(tmpdir()), "model-reference-http-ui-"));
    expect(await realpath(directory)).toBe(directory);
    const registry = createLocalModelRegistryAdapter({ filePath: path.join(directory, "models.json"), now: () => "2026-01-01T00:00:00.000Z", discovery: { enabled: false } });
    const app = express(); app.use(express.json({ limit: "32kb", strict: true }));
    app.use((request, response, next) => {
      if (request.headers.authorization !== `Bearer ${TOKEN}`) {
        response.status(401).json({ ok: false, error: { code: "unauthenticated", message: "Synthetic test access denied." } }); return;
      }
      if (requests.length >= 40) { response.status(429).json({ ok: false }); return; }
      requests.push({ path: request.path, workspaceId: request.body?.workspaceId,
        deleteLocalFiles: request.body?.deleteLocalFiles, deleteBackingArtifacts: request.body?.deleteBackingArtifacts });
      next();
    });
    const unavailable = { execute: async (): Promise<never> => { throw new Error("Synthetic operation is intentionally unavailable."); } };
    const provider = {
      browseModels: async (input: BrowseModelsRequest) => { expect(input).toMatchObject({ provider: "huggingface", query: "support" }); providerCalls++; if (failure) throw new Error(PRIVATE); return { models: [support] }; },
      getModelDetails: async (input: GetModelDetailsRequest) => { expect(input).toEqual({ provider: "huggingface", modelId: support.modelId }); return { model: { ...support, description: "Synthetic local support-model reference." } }; },
    };
    registerModelManagementApiRoutes({ app, browseModelsUseCase: new BrowseModelsUseCase({ providers: { huggingface: provider } }),
      getModelDetailsUseCase: new GetModelDetailsUseCase({ providers: { huggingface: provider } }),
      listModelsUseCase: new ListModelsUseCase({ modelRegistry: registry }), saveModelReferenceUseCase: new SaveModelReferenceUseCase({ modelRegistry: registry }),
      updateModelRecordUseCase: new UpdateModelRecordUseCase({ modelRegistry: registry }), deleteModelRecordUseCase: new DeleteModelRecordUseCase({ modelRegistry: registry }),
      downloadModelUseCase: unavailable });
    server = createServer(app);
    await new Promise<void>((resolve, reject) => { server!.once("error", reject); server!.listen(0, "127.0.0.1", resolve); });
    const address = server.address(); if (!address || typeof address === "string") throw new Error("The owned listener did not start.");
    const client = createApiModelManagementClient({ apiBaseUrl: `http://127.0.0.1:${address.port}/api`, requestTimeoutMs: { list: 3000, browse: 3000, details: 3000, save: 3000, delete: 3000 } });
    return { registry, client };
  }
  async function mount(client: ReturnType<typeof createApiModelManagementClient>, workspaceId = workspace) {
    if (!root) { container = document.createElement("div"); document.body.appendChild(container); root = createRoot(container); }
    await act(async () => root!.render(<NotificationTestHarness><ModelManagementFeature client={client} workspaceId={workspaceId} /></NotificationTestHarness>));
  }
  function button(name: string, parent: ParentNode = container!) {
    const found = [...parent.querySelectorAll<HTMLButtonElement>("button")].find(value => value.textContent?.trim() === name);
    expect(Boolean(found)).toBe(true); return found!;
  }
  async function settled(predicate: () => boolean) {
    await vi.waitFor(async () => { await act(async () => { await new Promise(resolve => setTimeout(resolve, 0)); }); expect(predicate()).toBe(true); }, { timeout: 5000, interval: 10 });
  }
  const inventory = () => [...container!.querySelectorAll("section")].find(section => section.querySelector("h3")?.textContent === "Server model inventory")!;
  async function browse() {
    const input = container!.querySelector<HTMLInputElement>("input[placeholder='Search models']")!;
    await act(async () => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, "support"); input.dispatchEvent(new Event("input", { bubbles: true })); });
    await act(async () => button("Browse models").click());
  }

  it("saves a reference, reopens persisted storage, separates workspaces and deletes only the confirmed record", async () => {
    localStorage.setItem(TOKEN_KEY, TOKEN); vi.spyOn(window, "confirm").mockReturnValue(false);
    let host = await openListener(); await mount(host.client);
    await settled(() => requests.some(request => request.path === "/api/model/list"));
    await browse(); await settled(() => container!.textContent!.includes(support.displayName));
    await act(async () => button("Details").click());
    await settled(() => container!.textContent!.includes("Synthetic local support-model reference."));
    await act(async () => button("Save reference").click());
    await settled(() => inventory().textContent!.includes(support.displayName));
    const saved = (await host.registry.listModels({ workspaceId: workspace })).models;
    expect(saved).toHaveLength(1); const id = saved[0]!.modelRecordId;
    expect(saved[0]).toMatchObject({ modelId: support.modelId, displayName: support.displayName, lifecycleStatus: "saved-reference", taskTags: support.taskTags });
    expect(saved[0]!.localPath).toBeUndefined();
    await mount(host.client, otherWorkspace); await settled(() => !inventory().textContent!.includes(support.displayName));
    expect((await host.registry.listModels({ workspaceId: otherWorkspace })).models).toHaveLength(0);
    await act(async () => root!.unmount()); root = undefined; container!.remove(); container = undefined;
    await closeListener(); host = await openListener(); await mount(host.client);
    await settled(() => inventory().textContent!.includes(support.displayName));
    expect((await host.registry.listModels({ workspaceId: workspace })).models.map(model => model.modelRecordId)).toEqual([id]);
    await act(async () => button("Delete record", inventory()).click());
    expect(window.confirm).toHaveBeenCalledWith("Delete this model record?");
    expect(requests.filter(request => request.path === "/api/model/record/delete")).toHaveLength(0);
    expect((await host.registry.listModels({ workspaceId: workspace })).models).toHaveLength(1);
    vi.mocked(window.confirm).mockReturnValue(true);
    await act(async () => button("Delete record", inventory()).click()); await settled(() => !inventory().textContent!.includes(support.displayName));
    expect(requests.filter(request => request.path === "/api/model/record/delete")).toEqual([{ path: "/api/model/record/delete", workspaceId: workspace, deleteLocalFiles: false, deleteBackingArtifacts: undefined }]);
    expect((await host.registry.listModels({ workspaceId: workspace })).models).toHaveLength(0);
    const reopened = createLocalModelRegistryAdapter({ filePath: path.join(directory!, "models.json"), discovery: { enabled: false } });
    expect((await reopened.listModels({ workspaceId: workspace })).models).toHaveLength(0);
    expect(requests.some(request => request.path.includes("download") || request.path.includes("files"))).toBe(false);
  }, 20_000);

  it("retries refused fixture access and a real route provider failure without rendering raw diagnostics", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const host = await openListener(); await mount(host.client); await browse();
    await settled(() => readNotificationMessages(container!).some(message => message.includes("Unable to browse models")));
    expect(providerCalls).toBe(0);
    localStorage.setItem(TOKEN_KEY, TOKEN); failure = true; await browse(); await settled(() => providerCalls === 1);
    await settled(() => button("Browse models").disabled === false);
    expect(container!.textContent).not.toContain(PRIVATE); expect(JSON.stringify(warn.mock.calls)).not.toContain(PRIVATE);
    failure = false; await browse(); await settled(() => container!.textContent!.includes(support.displayName));
    expect(providerCalls).toBe(2); expect((await host.registry.listModels({ workspaceId: workspace })).models).toHaveLength(0);
  }, 15_000);
});
