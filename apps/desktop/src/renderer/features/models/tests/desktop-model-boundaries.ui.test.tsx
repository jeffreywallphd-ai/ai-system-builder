// @vitest-environment jsdom
import { act, StrictMode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useModelsFeature } from "../hooks/useModelsFeature";
import { BrowseModelsTab } from "../components/BrowseModelsTab";
import { ManageModelsTab } from "../components/ManageModelsTab";
import type { DesktopModelsClient, DesktopManagedModelInventoryRecord } from "../api/desktopModelsClient";
import { NotificationTestHarness, readNotificationMessages } from "../../../../../../../modules/ui/shared/notifications/tests/NotificationTestHarness";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const PRIVATE = "synthetic-private-model-diagnostic";
const saved: DesktopManagedModelInventoryRecord = { modelRecordId: "model.saved-a", modelId: "qualification/support", provider: "huggingface", displayName: "Saved support model",
  source: "huggingface", lifecycleStatus: "saved-reference", artifactForm: "full-model", createdAt: "2026-01-01T00:00:00.000Z" };
const current = { ...saved, modelRecordId: "model.current-b", displayName: "Current workspace model" };
const browseItem = { modelId: saved.modelId!, displayName: saved.displayName, provider: "huggingface" as const };
function deferred<T>() { let resolve!: (value: T) => void, reject!: (error: unknown) => void; const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; }
function fixture(overrides: Partial<DesktopModelsClient> = {}): DesktopModelsClient {
  const unused = vi.fn(async (): Promise<never> => { throw new Error("Synthetic operation is not used by this case."); });
  return { browseModels: vi.fn(async () => ({ models: [browseItem] })), getModelDetails: unused,
    listModels: vi.fn(async () => []), saveModelReference: unused, downloadModel: unused, startModelDownload: unused,
    readModelDownload: unused, completeModelDownload: unused, listModelDownloads: unused, cancelModelDownload: unused,
    updateModelRecord: unused, deleteModelRecord: unused, revealModelInFolder: unused, trainModel: unused,
    readModelTrainingStatus: unused, cancelModelTraining: unused, saveModelTraining: unused, discardModelTraining: unused,
    validateModel: unused, publishModel: unused, ...overrides };
}
function Panels({ client, workspaceId }: { client: DesktopModelsClient; workspaceId: string }) {
  const state = useModelsFeature(client, workspaceId);
  return <><BrowseModelsTab state={state} /><ManageModelsTab state={state} /></>;
}

describe("desktop model panels current-result and acknowledgement boundaries", () => {
  let root: Root | undefined, container: HTMLDivElement | undefined;
  afterEach(async () => { if (root) await act(async () => root!.unmount()); root = undefined; container?.remove(); container = undefined; vi.restoreAllMocks(); });
  async function mount(client: DesktopModelsClient, workspaceId = "workspace-a") {
    if (!root) { container = document.createElement("div"); document.body.appendChild(container); root = createRoot(container); }
    await act(async () => root!.render(<NotificationTestHarness><Panels client={client} workspaceId={workspaceId} /></NotificationTestHarness>));
  }
  function button(label: string, parent: ParentNode = document) { const found = [...parent.querySelectorAll<HTMLButtonElement>("button")].find(value => value.textContent?.trim() === label); expect(Boolean(found)).toBe(true); return found!; }
  const inventory = () => container!.querySelector<HTMLElement>('section[aria-label="Managed models"]')!;
  async function setInput(input: HTMLInputElement, value: string) {
    await act(async () => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, value); input.dispatchEvent(new Event("input", { bubbles: true })); });
  }
  async function confirmDelete() {
    await act(async () => button("Delete Record").click());
    await setInput(document.querySelector<HTMLInputElement>('input[placeholder="Delete"]')!, "Delete");
  }
  for (const replacement of ["workspace", "client"] as const) {
    it(`ignores an old inventory response after ${replacement} replacement`, async () => {
      const old = deferred<DesktopManagedModelInventoryRecord[]>();
      const client = fixture({ listModels: vi.fn(async input => input?.workspaceId === "workspace-b" ? [current] : old.promise) });
      await mount(client);
      const next = replacement === "client" ? fixture({ listModels: vi.fn(async () => [current]) }) : client;
      await mount(next, replacement === "workspace" ? "workspace-b" : "workspace-a");
      expect(inventory().textContent).toContain(current.displayName);
      await act(async () => old.resolve([saved]));
      expect(inventory().textContent).toContain(current.displayName); expect(inventory().textContent).not.toContain(saved.displayName);
    });
  }
  it("ignores a retired inventory error and does not disclose raw current errors", async () => {
    const old = deferred<DesktopManagedModelInventoryRecord[]>();
    const client = fixture({ listModels: vi.fn(async input => input?.workspaceId === "workspace-b" ? [current] : old.promise) });
    await mount(client); await mount(client, "workspace-b"); await act(async () => old.reject(new Error(PRIVATE)));
    expect(container!.textContent).not.toContain(PRIVATE); expect(inventory().textContent).toContain(current.displayName);
    await mount(fixture({ listModels: vi.fn(async () => { throw new Error(PRIVATE); }) }), "workspace-b");
    expect(container!.textContent).not.toContain(PRIVATE);
    expect(readNotificationMessages(container!)).toContain("Failed to list model records. Try refreshing the inventory.");
  });
  it("retains the latest inventory when two refreshes finish in reverse order", async () => {
    const first = deferred<DesktopManagedModelInventoryRecord[]>(), second = deferred<DesktopManagedModelInventoryRecord[]>(); let reads = 0;
    const client = fixture({ listModels: vi.fn(async () => ++reads === 1 ? [] : reads === 2 ? first.promise : second.promise) });
    await mount(client); await act(async () => { button("Refresh Models").click(); button("Refresh Models").click(); });
    await act(async () => second.resolve([current])); await act(async () => first.resolve([saved]));
    expect(inventory().textContent).toContain(current.displayName); expect(inventory().textContent).not.toContain(saved.displayName);
  });
  it("clears old details and destructive confirmation before the next workspace can act", async () => {
    const client = fixture({ listModels: vi.fn(async input => input?.workspaceId === "workspace-b" ? [current] : [saved]) });
    await mount(client); await act(async () => button("Details").click()); await confirmDelete();
    await mount(client, "workspace-b");
    expect(document.querySelector('input[placeholder="Delete"]')).toBeNull(); expect(document.querySelector('.models-feature__details-dialog')).toBeNull();
    expect(inventory().textContent).toContain(current.displayName); expect(client.deleteModelRecord).not.toHaveBeenCalled();
  });
  for (const outcome of ["foreign-record", "not-deleted", "unrequested-files", "unrequested-backing"] as const) {
    it(`retains confirmation for an uncertain deletion: ${outcome}`, async () => {
      const result = { deletedModelRecordId: outcome === "foreign-record" ? "model.other" : saved.modelRecordId,
        deletedRegistryRecord: outcome !== "not-deleted", deletedLocalFiles: outcome === "unrequested-files",
        deletedBackingArtifactIds: outcome === "unrequested-backing" ? ["artifact.other"] : [] };
      const client = fixture({ listModels: vi.fn(async () => [saved]), deleteModelRecord: vi.fn(async () => result) });
      await mount(client); await confirmDelete(); await act(async () => button("Delete model").click());
      expect(document.querySelector<HTMLInputElement>('input[placeholder="Delete"]')?.value).toBe("Delete");
      expect(client.listModels).toHaveBeenCalledTimes(1); expect(inventory().textContent).toContain(saved.displayName);
      expect(readNotificationMessages(container!)).not.toContain("Model record deleted.");
    });
  }
  it("admits one exact record-only deletion and refreshes after its acknowledgement", async () => {
    const pending = deferred<Awaited<ReturnType<DesktopModelsClient["deleteModelRecord"]>>>(); let deleted = false;
    const client = fixture({ listModels: vi.fn(async () => deleted ? [] : [saved]), deleteModelRecord: vi.fn(async () => pending.promise) });
    await mount(client); await confirmDelete(); await act(async () => { const confirm = button("Delete model"); confirm.click(); confirm.click(); });
    expect(client.deleteModelRecord).toHaveBeenCalledTimes(1);
    expect(client.deleteModelRecord).toHaveBeenCalledWith({ workspaceId: "workspace-a", modelRecordId: saved.modelRecordId, deleteBackingArtifacts: false, deleteLocalFiles: false });
    deleted = true; await act(async () => pending.resolve({ deletedModelRecordId: saved.modelRecordId, deletedRegistryRecord: true, deletedLocalFiles: false, deletedBackingArtifactIds: [] }));
    expect(document.querySelector('input[placeholder="Delete"]')).toBeNull(); expect(inventory().textContent).not.toContain(saved.displayName);
  });
  it("retains confirmation when requested file removal is not acknowledged", async () => {
    const client = fixture({ listModels: vi.fn(async () => [saved]), deleteModelRecord: vi.fn(async () => ({ deletedModelRecordId: saved.modelRecordId, deletedRegistryRecord: true, deletedLocalFiles: false, deletedBackingArtifactIds: [] })) });
    await mount(client); await confirmDelete();
    await act(async () => document.querySelector<HTMLInputElement>('input[type="checkbox"]')!.click());
    await act(async () => button("Delete model").click());
    expect(client.deleteModelRecord).toHaveBeenCalledWith({ workspaceId: "workspace-a", modelRecordId: saved.modelRecordId, deleteBackingArtifacts: false, deleteLocalFiles: true });
    expect(document.querySelector<HTMLInputElement>('input[placeholder="Delete"]')?.value).toBe("Delete");
    expect(client.listModels).toHaveBeenCalledTimes(1);
  });
  for (const target of [saved, current]) {
    it(`does not let a prior deletion clear a newly opened confirmation for ${target.modelRecordId}`, async () => {
      const pending = deferred<Awaited<ReturnType<DesktopModelsClient["deleteModelRecord"]>>>(); let calls = 0;
      const client = fixture({ listModels: vi.fn(async () => [saved, current]), deleteModelRecord: vi.fn(async input => {
        if (++calls === 1) return pending.promise;
        return { deletedModelRecordId: input.modelRecordId, deletedRegistryRecord: true, deletedLocalFiles: false, deletedBackingArtifactIds: [] };
      }) });
      await mount(client); await confirmDelete(); await act(async () => button("Delete model").click());
      await act(async () => button("Cancel").click());
      const card = [...inventory().querySelectorAll("article")].find(card => card.querySelector("strong")?.textContent === target.displayName)!;
      await act(async () => button("Delete Record", card).click());
      await setInput(document.querySelector<HTMLInputElement>('input[placeholder="Delete"]')!, "Delete");
      await act(async () => pending.resolve({ deletedModelRecordId: saved.modelRecordId, deletedRegistryRecord: true, deletedLocalFiles: false, deletedBackingArtifactIds: [] }));
      expect(document.querySelector<HTMLInputElement>('input[placeholder="Delete"]')?.value).toBe("Delete");
      expect(readNotificationMessages(container!)).not.toContain("Model record deleted.");
      await act(async () => button("Delete model").click()); expect(client.deleteModelRecord).toHaveBeenCalledTimes(2);
      expect(vi.mocked(client.deleteModelRecord).mock.calls[1]![0].modelRecordId).toBe(target.modelRecordId);
    });
  }
  it("does not publish deletion success into a confirmation opened during refresh", async () => {
    const refresh = deferred<DesktopManagedModelInventoryRecord[]>(); let reads = 0;
    const client = fixture({ listModels: vi.fn(async () => ++reads === 1 ? [saved, current] : refresh.promise),
      deleteModelRecord: vi.fn(async () => ({ deletedModelRecordId: saved.modelRecordId, deletedRegistryRecord: true, deletedLocalFiles: false, deletedBackingArtifactIds: [] })) });
    await mount(client); await confirmDelete(); await act(async () => button("Delete model").click());
    const card = [...inventory().querySelectorAll("article")].find(card => card.querySelector("strong")?.textContent === current.displayName)!;
    await act(async () => button("Delete Record", card).click());
    await setInput(document.querySelector<HTMLInputElement>('input[placeholder="Delete"]')!, "Delete");
    await act(async () => refresh.resolve([current]));
    expect(document.querySelector<HTMLInputElement>('input[placeholder="Delete"]')?.value).toBe("Delete");
    expect(readNotificationMessages(container!)).not.toContain("Model record deleted.");
  });
  it("does not report an earlier deletion failure over a replacement confirmation", async () => {
    const pending = deferred<Awaited<ReturnType<DesktopModelsClient["deleteModelRecord"]>>>();
    const client = fixture({ listModels: vi.fn(async () => [saved, current]), deleteModelRecord: vi.fn(async () => pending.promise) });
    await mount(client); await confirmDelete(); await act(async () => button("Delete model").click());
    await act(async () => button("Cancel").click()); await confirmDelete();
    await act(async () => pending.reject(new Error(PRIVATE)));
    expect(document.querySelector<HTMLInputElement>('input[placeholder="Delete"]')?.value).toBe("Delete");
    expect(readNotificationMessages(container!)).not.toContain("Model deletion was not confirmed. Refresh the inventory before retrying.");
    expect(container!.textContent).not.toContain(PRIVATE);
  });
  it("does not use earlier confirmation text before the changed input commits", async () => {
    const client = fixture({ listModels: vi.fn(async () => [saved]), deleteModelRecord: vi.fn(async () => ({ deletedModelRecordId: saved.modelRecordId, deletedRegistryRecord: true, deletedLocalFiles: false, deletedBackingArtifactIds: [] })) });
    await mount(client); await confirmDelete();
    await act(async () => {
      const input = document.querySelector<HTMLInputElement>('input[placeholder="Delete"]')!;
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, "delete");
      input.dispatchEvent(new Event("input", { bubbles: true })); button("Delete model").click();
    });
    expect(client.deleteModelRecord).not.toHaveBeenCalled();
  });
  it("does not let retired deletion completion refresh the old workspace or report new success", async () => {
    const pending = deferred<Awaited<ReturnType<DesktopModelsClient["deleteModelRecord"]>>>();
    const client = fixture({ listModels: vi.fn(async input => input?.workspaceId === "workspace-b" ? [current] : [saved]), deleteModelRecord: vi.fn(async () => pending.promise) });
    await mount(client); await confirmDelete(); await act(async () => button("Delete model").click()); await mount(client, "workspace-b");
    await act(async () => pending.resolve({ deletedModelRecordId: saved.modelRecordId, deletedRegistryRecord: true, deletedLocalFiles: false, deletedBackingArtifactIds: [] }));
    expect(client.listModels).toHaveBeenCalledTimes(2); expect(inventory().textContent).toContain(current.displayName);
  });
  it("does not publish a retired save outcome or refresh inventory in the old workspace", async () => {
    const pending = deferred<Awaited<ReturnType<DesktopModelsClient["saveModelReference"]>>>();
    const client = fixture({ saveModelReference: vi.fn(async () => pending.promise) });
    await mount(client); await act(async () => button("Search Models").click()); await act(async () => button("Save").click());
    await mount(client, "workspace-b"); await act(async () => pending.resolve(saved));
    expect(client.listModels).toHaveBeenCalledTimes(2); expect(readNotificationMessages(container!)).not.toContain("Model reference saved.");
  });
  it("does not revive the first inventory read during Strict Mode effect replay", async () => {
    const old = deferred<DesktopManagedModelInventoryRecord[]>(); let reads = 0;
    const client = fixture({ listModels: vi.fn(async () => ++reads === 1 ? old.promise : [current]) });
    container = document.createElement("div"); document.body.appendChild(container); root = createRoot(container);
    await act(async () => root!.render(<StrictMode><NotificationTestHarness><Panels client={client} workspaceId="workspace-a" /></NotificationTestHarness></StrictMode>));
    await act(async () => old.resolve([saved]));
    expect(inventory().textContent).toContain(current.displayName); expect(inventory().textContent).not.toContain(saved.displayName);
  });
  it("keeps the latest search when old provider results arrive late", async () => {
    const old = deferred<Awaited<ReturnType<DesktopModelsClient["browseModels"]>>>(); let searches = 0;
    const client = fixture({ browseModels: vi.fn(async () => ++searches === 1 ? old.promise : { models: [{ ...browseItem, modelId: "qualification/current", displayName: current.displayName }] }) });
    await mount(client); await act(async () => { button("Search Models").click(); button("Search Models").click(); });
    await act(async () => old.resolve({ models: [browseItem] }));
    const results = container!.querySelector('section[aria-label="Model search results"]')!;
    expect(results.textContent).toContain(current.displayName); expect(results.textContent).not.toContain(saved.displayName);
  });
  it("does not refresh after a save finishes following unmount", async () => {
    const pending = deferred<Awaited<ReturnType<DesktopModelsClient["saveModelReference"]>>>();
    const client = fixture({ saveModelReference: vi.fn(async () => pending.promise) });
    await mount(client); await act(async () => button("Search Models").click()); await act(async () => button("Save").click());
    await act(async () => root!.unmount()); root = undefined; await act(async () => pending.resolve(saved));
    expect(client.listModels).toHaveBeenCalledTimes(1);
  });
  it("preserves a failed inventory refresh after a confirmed deletion", async () => {
    let reads = 0;
    const client = fixture({ listModels: vi.fn(async () => { if (++reads > 1) throw new Error(PRIVATE); return [saved]; }),
      deleteModelRecord: vi.fn(async () => ({ deletedModelRecordId: saved.modelRecordId, deletedRegistryRecord: true, deletedLocalFiles: false, deletedBackingArtifactIds: [] })) });
    await mount(client); await confirmDelete(); await act(async () => button("Delete model").click());
    expect(document.querySelector('input[placeholder="Delete"]')).toBeNull();
    expect(readNotificationMessages(container!)).toContain("Failed to list model records. Try refreshing the inventory.");
    expect(readNotificationMessages(container!)).not.toContain("Model record deleted."); expect(container!.textContent).not.toContain(PRIVATE);
  });
  for (const operation of ["browse", "save", "download", "delete", "reveal", "validate", "publish"] as const) {
    it(`does not render private ${operation} exceptions`, async () => {
      const failed = vi.fn(async (): Promise<never> => { throw new Error(PRIVATE); });
      const methods = { browse: "browseModels", save: "saveModelReference", download: "startModelDownload", delete: "deleteModelRecord", reveal: "revealModelInFolder", validate: "validateModel", publish: "publishModel" } as const;
      const client = fixture({ listModels: vi.fn(async () => [{ ...saved, localFilesAvailable: true, validationStatus: "valid" as const }]), [methods[operation]]: failed });
      await mount(client);
      if (operation === "browse" || operation === "save" || operation === "download") {
        await act(async () => button("Search Models").click());
        if (operation !== "browse") await act(async () => button(operation === "save" ? "Save" : "Download").click());
      } else if (operation === "delete") { await confirmDelete(); await act(async () => button("Delete model").click()); }
      else {
        await act(async () => button("Details").click());
        if (operation === "publish") await setInput(document.querySelector<HTMLInputElement>('input[placeholder="owner/model-name"]')!, "qualification/synthetic-model");
        await act(async () => button(operation === "reveal" ? "Open in folder" : operation === "validate" ? "Validate" : "Publish").click());
      }
      expect(failed).toHaveBeenCalledTimes(1); expect(container!.textContent).not.toContain(PRIVATE);
      expect(readNotificationMessages(container!).join(" ")).not.toContain(PRIVATE);
    });
  }
});
