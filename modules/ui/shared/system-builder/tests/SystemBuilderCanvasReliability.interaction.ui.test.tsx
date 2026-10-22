// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { AssetInstance, AssetPlacement } from "../../../../contracts/asset";
import { normalizeAssetSlotId } from "../../../../contracts/asset";
import type { SystemBuilderComposerAsset, SystemBuilderRecord, SystemBuilderRevision } from "../../../../contracts/system-builder";
import { createSystemBuilderModelBinding } from "../../../../contracts/system-builder";
import { SystemBuilderWorkspace, type SystemBuilderClient } from "../SystemBuilderWorkspace";
import { NotificationTestHarness, readNotificationMessages } from "../../notifications/tests/NotificationTestHarness";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root | undefined;
let container: HTMLDivElement;
afterEach(() => { act(() => root?.unmount()); container?.remove(); document.body.innerHTML = ""; root = undefined; });

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => { resolve = done; });
  return { promise, resolve };
}
function ref(id: string, kind = "asset-instance", version?: string) { return { id, kind, ...(version ? { version } : {}) } as any; }
function fixture() {
  const definition = (id: string, name: string, slots: string[], layout = false): SystemBuilderComposerAsset => ({
    definitionId: id, definitionRef: ref(id, "asset-definition-version", "3.0.0"), version: "3.0.0", displayName: name,
    description: `${name} definition`, assetType: "ui-component", assetFamily: "structural", lifecycleStatus: "published", builtIn: true,
    ports: [], slots: slots.map(slotId => ({ schemaVersion: "asset-slot-definition.v1", slotId: normalizeAssetSlotId(slotId), displayName: slotId, cardinality: { minItems: 0, maxItems: 100 }, acceptedAssetTypes: ["ui-component"] })),
    compatibility: { status: "compatible" }, implementationAvailability: "trusted-system-foundation", previewAvailability: "trusted-declarative",
    configurationSchema: { schemaId: `${id}.config`, schemaVersion: "1.0.0", fields: [{ fieldId: "title", label: "Title", valueKind: "string" }] },
    ...(layout ? { layoutRole: "application-shell", layoutGeometry: { columnPattern: "single", areas: [["content"]], sourceOrder: ["content"], dimensionsLocked: true } } : {}),
  } as SystemBuilderComposerAsset);
  const definitions = [definition("builtin.system.system", "System root", ["application-shell"]), definition("builtin.layout.application.minimal", "Minimal", ["content"], true), definition("builtin.ui.card", "Card fixture", ["content"])];
  const instances = definitions.map((definition, i) => ({ instanceId: `instance.${i}`, lifecycleStatus: "draft", definitionRef: definition.definitionRef, displayName: definition.displayName, selectedConfiguration: { title: i === 2 ? "Saved card" : definition.displayName }, provenance: { sourceKind: "human-authored" } } as AssetInstance));
  const placements = [
    { schemaVersion: "asset-placement.v1", placementId: "placement.shell", parentInstanceRef: ref("instance.0"), slotId: "application-shell", childInstanceRef: ref("instance.1"), order: 0 },
    { schemaVersion: "asset-placement.v1", placementId: "placement.card", parentInstanceRef: ref("instance.1"), slotId: "content", childInstanceRef: ref("instance.2"), order: 0 },
  ] as AssetPlacement[];
  const revision = { revisionId: "revision.a.1", systemId: "system.a", targetWorkspaceId: "workspace.a", revisionNumber: 1, composition: { compositionId: "composition.a", compositionType: "system", displayName: "System A", version: "0.1.0", lifecycleStatus: "draft", rootInstanceRefs: [ref("instance.0")], instanceRefs: instances.map(i => ref(String(i.instanceId))), bindingRefs: [], placementRefs: placements.map(p => ref(String(p.placementId), "asset-placement")), provenance: { sourceKind: "human-authored" } }, instances, placements, bindings: [], structure: { schemaVersion: "system-builder-structure.v1", profile: "interactive", layoutPresetRef: definitions[1]!.definitionRef }, validationIssues: [], createdAt: "2026-10-21T00:00:00.000Z", createdBy: "actor.a" } as unknown as SystemBuilderRevision;
  const record = { systemId: "system.a", targetWorkspaceId: "workspace.a", name: "System A", status: "validated", revision: 1, currentRevisionId: revision.revisionId, composition: revision.composition, createdAt: revision.createdAt, updatedAt: revision.createdAt, createdBy: "actor.a", updatedBy: "actor.a" } as SystemBuilderRecord;
  const create = vi.fn(async () => ({ ok: true as const, value: { ...record, systemId: "system.b", name: "System B" } }));
  const createFromTemplate = vi.fn(async () => ({ ok: true as const, value: { ...record, systemId: "system.c", name: "System C" } }));
  const client = {
    list: async () => ({ ok: true, value: [record] }), listTemplates: async () => ({ ok: true, value: [{ templateId: "reference.controlled-chatbot", displayName: "Conversation fixture" }] }),
    listComposerAssets: async () => ({ ok: true, value: { items: definitions } }),
    readComposerAsset: async ({ definitionRef }: any) => ({ ok: true, value: definitions.find(d => d.definitionId === String(definitionRef.id)) }),
    readRevision: async () => ({ ok: true, value: revision }), listRevisions: async () => ({ ok: true, value: [revision] }),
    create, createFromTemplate,
    saveRevision: vi.fn(async (input: any) => ({ ok: true, value: { ...revision, ...input, revisionNumber: 2, revisionId: "revision.a.2", validationIssues: [] } })),
    previewLayoutChange: vi.fn(async () => ({ ok: true, value: revision })), archive: vi.fn(), restore: vi.fn(), clone: vi.fn(),
  } as unknown as SystemBuilderClient;
  return { client, record, revision, definitions, create, createFromTemplate };
}
async function mount(client: SystemBuilderClient, loadInitial = true) {
  container = document.createElement("div"); document.body.append(container); root = createRoot(container);
  await act(async () => root!.render(<NotificationTestHarness><SystemBuilderWorkspace workspaceId="workspace.a" client={client} initialSystemId={loadInitial ? "system.a" : undefined} /></NotificationTestHarness>));
}
function button(label: string): HTMLButtonElement {
  const value = Array.from(container.querySelectorAll<HTMLButtonElement>("button")).find(b => b.textContent?.trim() === label);
  if (!value) throw new Error(`Missing ${label}`);
  return value;
}
async function input(element: HTMLInputElement, value: string) {
  await act(async () => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(element, value); element.dispatchEvent(new Event("input", { bubbles: true })); });
}
async function cardTitle() {
  const card = await vi.waitFor(() => {
    const found = Array.from(container.querySelectorAll<HTMLButtonElement>(".system-composer__canvas-node-select")).find(b => b.textContent?.includes("Card fixture"));
    expect(found).toBeDefined(); return found!;
  });
  await act(async () => card.click());
  await act(async () => button("Properties").click());
  return vi.waitFor(() => { const field = container.querySelector<HTMLInputElement>("#title"); expect(field).not.toBeNull(); return field!; });
}

describe("Canvas draft integrity and recovery", () => {
  for (const mode of ["empty", "template"] as const) {
    it(`preserves an unsaved system before ${mode} creation`, async () => {
      const f = fixture(); await mount(f.client);
      const title = await cardTitle(); await input(title, "Keep this unsaved request form");
      expect(container.textContent).toContain("Unsaved changes");
      const name = container.querySelector<HTMLInputElement>(mode === "empty" ? 'input[aria-label="New system name"]' : 'input[aria-label="Template system name"]') ??
        container.querySelector<HTMLInputElement>(mode === "empty" ? '.system-builder__entry-option--new input' : 'input[placeholder="Use template name"]');
      expect(name).not.toBeNull(); await input(name!, "Another system");
      if (mode === "template") {
        const selector = container.querySelector<HTMLSelectElement>('[aria-label="System template"]')!;
        await act(async () => { selector.value = "reference.controlled-chatbot"; selector.dispatchEvent(new Event("change", { bubbles: true })); });
      }
      await act(async () => button(mode === "empty" ? "Create system" : "Create from template").click());
      expect(mode === "empty" ? f.create : f.createFromTemplate).not.toHaveBeenCalled();
      expect(readNotificationMessages(container).join(" ")).toContain("Save or discard unsaved changes");
      expect(title.value).toBe("Keep this unsaved request form");
    });
  }
  it("keeps the saved checkpoint independent of the50entry undo limit", async () => {
    const f = fixture(); await mount(f.client); const title = await cardTitle();
    for (let i = 1; i <= 51; i++) await input(title, `Unsaved edit ${i}`);
    for (let i = 0; i < 50; i++) await act(async () => button("Undo").click());
    expect(title.value).toBe("Unsaved edit 1");
    expect(container.textContent).toContain("Unsaved changes");
    expect(button("Save and validate revision").disabled).toBe(false);
  });
  it("renders the current Canvas without waiting for optional revision history", async () => {
    const f = fixture(); const history = deferred<any>();
    await mount({ ...f.client, listRevisions: () => history.promise });
    expect(container.querySelector(".system-composer__canvas-node")).not.toBeNull();
    await act(async () => history.resolve({ ok: true, value: [f.revision] }));
  });
  it("prevents a pending save from silently erasing a later configuration edit", async () => {
    const f = fixture(); const saved = deferred<any>();
    const saveRevision = vi.fn(() => saved.promise);
    await mount({ ...f.client, saveRevision }); const title = await cardTitle();
    await input(title, "Before save");
    await act(async () => button("Save and validate revision").click());
    await vi.waitFor(() => expect(saveRevision).toHaveBeenCalledOnce());
    // A transaction may lock edits or preserve them with generation fencing.
    // This suite requires the selected lock policy to be visibly effective.
    expect(title.matches(":disabled")).toBe(true);
    // Synthetic events also cannot bypass the synchronous mutation fence.
    await input(title, "Must not overwrite the in-flight save");
    await act(async () => saved.resolve({ ok: true, value: { ...f.revision, instances: f.revision.instances.map((i, n) => n === 2 ? { ...i, selectedConfiguration: { title: "Before save" } } : i), revisionNumber: 2 } }));
    expect(title.matches(":disabled")).toBe(false);
    expect(title.value).toBe("Before save");
  });
  it("recovers a rejected current revision with an explicit retry and no raw exception", async () => {
    const f = fixture();
    const readRevision = vi.fn().mockRejectedValueOnce(new Error("synthetic-private-transport")).mockResolvedValue({ ok: true, value: f.revision });
    await mount({ ...f.client, readRevision });
    await vi.waitFor(() => expect(button("Retry loading system")).toBeDefined());
    expect(container.textContent).not.toContain("synthetic-private-transport");
    await act(async () => button("Retry loading system").click());
    await cardTitle();
    expect(readRevision).toHaveBeenCalledTimes(2);
    expect(container.textContent).not.toContain("Unable to load this system revision");
  });
  it("keeps the current Canvas usable after optional history rejects", async () => {
    const f = fixture(); await mount({ ...f.client, listRevisions: async () => { throw new Error("synthetic-private-history"); } });
    await cardTitle();
    expect(container.textContent).toContain("Revision history is unavailable");
    expect(container.textContent).not.toContain("synthetic-private-history");
  });
  it("rejected saves retain the draft, release the lock and permit a deliberate retry", async () => {
    const f = fixture();
    const saveRevision = vi.fn().mockRejectedValueOnce(new Error("synthetic-private-save")).mockImplementation(async (command) => ({ ok: true, value: { ...f.revision, instances: command.instances } }));
    await mount({ ...f.client, saveRevision }); const title = await cardTitle();
    await input(title, "Preserve after failure");
    await act(async () => button("Save and validate revision").click());
    expect(title.matches(":disabled")).toBe(false);
    expect(title.value).toBe("Preserve after failure");
    expect(container.textContent).toContain("Unsaved changes");
    expect(readNotificationMessages(container).join(" ")).toContain("Your draft is preserved");
    expect(readNotificationMessages(container).join(" ")).not.toContain("synthetic-private-save");
    await act(async () => button("Save and validate revision").click());
    expect(saveRevision).toHaveBeenCalledTimes(2);
    expect(container.textContent).not.toContain("Unsaved changes");
  });
  it("rejects a substituted save revision without clearing the real draft", async () => {
    const f = fixture(); await mount({ ...f.client, saveRevision: async () => ({ ok: true, value: { ...f.revision, targetWorkspaceId: "workspace.other" } }) } as any);
    const title = await cardTitle(); await input(title, "Keep owner draft");
    await act(async () => button("Save and validate revision").click());
    expect(title.value).toBe("Keep owner draft");
    expect(container.textContent).toContain("Unsaved changes");
    expect(readNotificationMessages(container).join(" ")).toContain("does not belong to this system");
  });
  it("ignores a late save after moving to a different workspace", async () => {
    const a = fixture(); const saved = deferred<any>();
    const bRevision = { ...a.revision, revisionId: "revision.b.1", systemId: "system.b", targetWorkspaceId: "workspace.b", revisionNumber: 17 };
    const bRecord = { ...a.record, systemId: "system.b", targetWorkspaceId: "workspace.b", currentRevisionId: bRevision.revisionId, name: "System B" };
    const client = {
      ...a.client,
      list: async ({ workspaceId }: any) => ({ ok: true, value: [workspaceId === "workspace.b" ? bRecord : a.record] }),
      readRevision: async ({ workspaceId }: any) => ({ ok: true, value: workspaceId === "workspace.b" ? bRevision : a.revision }),
      listRevisions: async () => ({ ok: true, value: [] }), saveRevision: vi.fn(() => saved.promise),
    } as SystemBuilderClient;
    await mount(client); await input(await cardTitle(), "Old workspace draft");
    await act(async () => button("Save and validate revision").click());
    await act(async () => root!.render(<NotificationTestHarness><SystemBuilderWorkspace workspaceId="workspace.b" initialSystemId="system.b" client={client} /></NotificationTestHarness>));
    const current = await cardTitle();
    await input(current, "New workspace draft");
    await act(async () => saved.resolve({ ok: true, value: a.revision }));
    expect(current.value).toBe("New workspace draft");
    expect(container.textContent).toContain("Revision 17");
    expect(container.textContent).toContain("Unsaved changes");
    expect(current.matches(":disabled")).toBe(false);
  });

  it("discards to the owned saved checkpoint after an external client-response mutation", async () => {
    const f = fixture(); await mount(f.client); await input(await cardTitle(), "Local unsaved edit");
    (f.revision.instances[2]!.selectedConfiguration as any).title = "External caller mutation";
    await act(async () => button("Discard changes").click());
    expect((await cardTitle()).value).toBe("Saved card");
  });
  it("admits only one save when clicks occur before React renders the busy state", async () => {
    const f = fixture(); const pending = deferred<any>(); const saveRevision = vi.fn(() => pending.promise);
    await mount({ ...f.client, saveRevision }); await input(await cardTitle(), "One transaction");
    const save = button("Save and validate revision");
    await act(async () => { save.click(); save.click(); });
    expect(saveRevision).toHaveBeenCalledOnce();
    await act(async () => pending.resolve({ ok: true, value: f.revision }));
  });
  it("preserves the selected model through a delayed layout change and immutable save", async () => {
    const f = fixture();
    const binding = createSystemBuilderModelBinding("model.controlled.fixture");
    const composer = f.definitions[2]!;
    Object.assign(composer, {
      definitionId: "conversation.message-composer",
      definitionRef: ref("conversation.message-composer", "asset-definition-version", "3.0.0"),
      configurationSchema: {
        schemaId: "controlled-composer.config", schemaVersion: "1.0.0", strict: true,
        fields: [
          { fieldId: "title", label: "Title", valueKind: "string" },
          { fieldId: "modelBinding", label: "Text generation model", valueKind: "resource-reference", required: true,
            uiHint: { hintKind: "resource-picker", section: "Model", order: 1 }, metadata: { resourceKind: "model", capabilityKind: "text-generation" } },
        ],
      },
    });
    Object.assign(f.revision.instances[2]!, { definitionRef: composer.definitionRef });
    const alternate = { ...f.definitions[1], definitionId: "builtin.layout.application.split", definitionRef: ref("builtin.layout.application.split", "asset-definition-version", "3.0.0"), displayName: "Split" } as SystemBuilderComposerAsset;
    f.definitions.push(alternate);
    const pending = deferred<any>();
    const previewLayoutChange = vi.fn((_command: any) => pending.promise);
    await mount({ ...f.client, previewLayoutChange, listModelOptions: async () => ({ ok: true, value: { options: [{ binding, displayName: "Controlled model", lifecycleStatus: "validated", taskTags: ["text-generation"] }] } }) } as SystemBuilderClient);
    await cardTitle();
    await act(async () => button("Data").click());
    const picker = await vi.waitFor(() => {
      const value = container.querySelector<HTMLSelectElement>("#modelBinding");
      expect(value?.querySelector('option[value="model.controlled.fixture"]')).not.toBeNull();
      return value!;
    });
    await act(async () => { picker.value = "model.controlled.fixture"; picker.dispatchEvent(new Event("change", { bubbles: true })); });
    await act(async () => container.querySelector<HTMLButtonElement>('button[aria-label="Show layouts"]')!.click());
    const choice = await vi.waitFor(() => { const value = container.querySelector<HTMLInputElement>('input[value="builtin.layout.application.split"]'); expect(value).not.toBeNull(); return value!; });
    await act(async () => choice.click());
    const save = button("Save and validate revision");
    expect(save.disabled).toBe(true);
    await act(async () => save.click());
    expect(f.client.saveRevision).not.toHaveBeenCalled();
    const submitted = previewLayoutChange.mock.calls[0]![0];
    expect(submitted.instances[2].selectedConfiguration.modelBinding).toEqual(binding);
    await act(async () => pending.resolve({ ok: true, value: { instances: submitted.instances, bindings: submitted.bindings, placements: submitted.placements, structure: { ...f.revision.structure, layoutPresetRef: alternate.definitionRef } } }));
    await act(async () => save.click());
    await vi.waitFor(() => expect(f.client.saveRevision).toHaveBeenCalledOnce());
    const saved = vi.mocked(f.client.saveRevision).mock.calls[0]![0];
    expect(saved.instances[2]!.selectedConfiguration?.modelBinding).toEqual(binding);
    expect(saved.structure?.layoutPresetRef).toEqual(alternate.definitionRef);
    expect(container.textContent).not.toContain("Unsaved changes");
    expect(readNotificationMessages(container)).toContain("Revision saved and validated.");
  });

  it("keeps the draft and records the error when configured definition verification fails before save", async () => {
    const f = fixture();
    let failRoot = true;
    const readComposerAsset = vi.fn(async (query: any) => {
      if (String(query.definitionRef.id) === "builtin.system.system" && failRoot) throw new Error("synthetic-private-definition-error");
      return f.client.readComposerAsset!(query);
    });
    const listComposerAssets = async () => ({ ok: true as const, value: { items: f.definitions.map(({ configurationSchema: _schema, ...summary }) => summary) } });
    await mount({ ...f.client, listComposerAssets, readComposerAsset });
    await input(await cardTitle(), "Keep the configured model form");
    await act(async () => button("Save and validate revision").click());
    expect(f.client.saveRevision).not.toHaveBeenCalled();
    expect(container.textContent).toContain("Unsaved changes");
    expect(readNotificationMessages(container).join(" ")).toContain("Unable to verify configured asset properties before saving.");
    expect(readNotificationMessages(container).join(" ")).not.toContain("synthetic-private-definition-error");
    failRoot = false;
    await act(async () => button("Save and validate revision").click());
    await vi.waitFor(() => expect(f.client.saveRevision).toHaveBeenCalledOnce());
    expect(vi.mocked(f.client.saveRevision).mock.calls[0]![0].instances[2]!.selectedConfiguration?.title).toBe("Keep the configured model form");
  });
  for (const rejects of [false, true]) {
    it(`protects the draft during a ${rejects ? "rejected" : "delayed"} layout change`, async () => {
      const f = fixture();
      const alternate = { ...f.definitions[1], definitionId: "builtin.layout.application.split", definitionRef: ref("builtin.layout.application.split", "asset-definition-version", "3.0.0"), displayName: "Split" } as SystemBuilderComposerAsset;
      f.definitions.push(alternate);
      const pending = deferred<any>();
      const previewLayoutChange = vi.fn((_command: any) => rejects ? Promise.reject(new Error("synthetic-private-layout")) : pending.promise);
      await mount({ ...f.client, previewLayoutChange });
      const title = await cardTitle(); await input(title, "Draft before layout");
      await act(async () => container.querySelector<HTMLButtonElement>('button[aria-label="Show layouts"]')!.click());
      const choice = await vi.waitFor(() => { const value = container.querySelector<HTMLInputElement>('input[value="builtin.layout.application.split"]'); expect(value).not.toBeNull(); return value!; });
      await act(async () => choice.click());
      expect(previewLayoutChange).toHaveBeenCalledOnce();
      if (!rejects) {
        expect(title.matches(":disabled")).toBe(true);
        await input(title, "Uncommitted while layout pending");
        const submitted = previewLayoutChange.mock.calls[0]![0] as any;
        await act(async () => pending.resolve({ ok: true, value: { instances: submitted.instances, bindings: submitted.bindings, placements: submitted.placements, structure: { ...f.revision.structure, layoutPresetRef: alternate.definitionRef } } }));
      }
      expect(title.matches(":disabled")).toBe(false);
      expect(title.value).toBe("Draft before layout");
      expect(container.textContent).toContain("Unsaved changes");
      if (rejects) {
        expect(readNotificationMessages(container).join(" ")).toContain("Your draft is preserved");
        expect(readNotificationMessages(container).join(" ")).not.toContain("synthetic-private-layout");
      }
    });
  }

});

describe("Demand-driven Canvas definitions", () => {
  it("opens only the exact definitions in use without enumerating an unrelated catalog", async () => {
    const f = fixture();
    const listComposerAssets = vi.fn(async (query: any) => ({ ok: true as const, value: { items: f.definitions.filter(definition => definition.definitionId === query.searchText) } }));
    const readComposerAsset = vi.fn(f.client.readComposerAsset!);
    await mount({ ...f.client, listComposerAssets, readComposerAsset });
    await cardTitle();
    expect(listComposerAssets).toHaveBeenCalledTimes(3);
    expect(listComposerAssets.mock.calls.every(call => f.definitions.some(definition => definition.definitionId === call[0].searchText))).toBe(true);
    const references = readComposerAsset.mock.calls.map(call => call[0].definitionRef);
    expect(references.some(reference => reference.id === f.definitions[2]!.definitionId)).toBe(true);
    expect(references.some(reference => reference.id === f.definitions[1]!.definitionId)).toBe(false);
    expect(references.every(reference => f.revision.instances.some(instance => instance.definitionRef.id === reference.id && instance.definitionRef.version === reference.version))).toBe(true);
  });
  it("creates with Minimal on the first page without reading the unrelated continuation", async () => {
    const f = fixture();
    const listComposerAssets = vi.fn(async (_query: any) => ({ ok: true as const, value: { items: [f.definitions[1]!], nextCursor: "unrelated-never-ending-page" } }));
    await mount({ ...f.client, listComposerAssets }, false);
    const name = container.querySelector<HTMLInputElement>('.system-builder__entry-option--new input')!;
    await input(name, "Bounded creation");
    await act(async () => button("Create system").click());
    expect(f.create).toHaveBeenCalledOnce();
    expect(listComposerAssets.mock.calls.filter(call => call[0].searchText === "builtin.layout.application.minimal")).toHaveLength(1);
    expect(listComposerAssets.mock.calls.every(call => !call[0].cursor)).toBe(true);
  });
});

describe('Independent late result sequences',()=>{
 it('retains newly saved history when the initial optional history resolves late',async()=>{
  const f=fixture(),history=deferred<any>();await mount({...f.client,listRevisions:()=>history.promise});
  await input(await cardTitle(),'New checkpoint');
  await act(async()=>button('Save and validate revision').click());
  const historyText=()=>container.querySelector('.system-builder__footer > div')?.textContent;
  expect(historyText()).toContain('r2');
  await act(async()=>history.resolve({ok:true,value:[f.revision]}));
  expect(container.textContent).toContain('Revision 2');
  expect(historyText()).toContain('r2');
 });
 it('releases an obsolete operation lock when initialSystemId changes within the same workspace',async()=>{
  const f=fixture(),pending=deferred<any>();
  const bRevision={...f.revision,systemId:'system.b',revisionId:'revision.b.1',revisionNumber:17};
  const bRecord={...f.record,systemId:'system.b',currentRevisionId:bRevision.revisionId,name:'System B'};
  const createFromTemplate=vi.fn(()=>pending.promise);
  const client={...f.client,list:async()=>({ok:true,value:[f.record,bRecord]}),readRevision:async({systemId}:any)=>({ok:true,value:systemId==='system.b'?bRevision:f.revision}),listRevisions:async()=>({ok:true,value:[]}),createFromTemplate} as SystemBuilderClient;
  await mount(client);await cardTitle();
  await input(container.querySelector<HTMLInputElement>('input[placeholder="Use template name"]')!,'Pending other creation');
  const selector=container.querySelector<HTMLSelectElement>('[aria-label="System template"]')!;
  await act(async()=>{selector.value='reference.controlled-chatbot';selector.dispatchEvent(new Event('change',{bubbles:true}));});
  await act(async()=>button('Create from template').click());expect(createFromTemplate).toHaveBeenCalledOnce();
  await act(async()=>root!.render(<NotificationTestHarness><SystemBuilderWorkspace workspaceId="workspace.a" initialSystemId="system.b" client={client}/></NotificationTestHarness>));
  const title=await cardTitle();expect(container.textContent).toContain('Revision 17');
  expect(title.matches(':disabled')).toBe(false);
  await input(title, 'Current B draft');
  await act(async()=>pending.resolve({ok:true,value:f.record}));
  expect(title.value).toBe('Current B draft');
  expect(container.textContent).toContain('Revision 17');
 });
});
