// @vitest-environment jsdom
import { act, Suspense, startTransition } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AssetDerivedCustomizationEditor, type AssetDerivedCustomizationClient } from "../AssetDerivedCustomizationEditor";
import { NotificationTestHarness, readNotificationMessages } from "../../notifications/tests/NotificationTestHarness";
import { ASSET_STUDIO_LIMITS } from "../../../../contracts/asset-studio";

(globalThis as {IS_REACT_ACT_ENVIRONMENT?: boolean}).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root | undefined;
let container: HTMLDivElement;
afterEach(() => {act(() => root?.unmount()); container?.remove(); root = undefined;});
function deferred<T = any>() {let resolve!: (value: T) => void, reject!: (error: Error) => void; const promise = new Promise<T>((yes, no) => {resolve = yes; reject = no;}); return {promise, resolve, reject};}
function target(name: string, workspaceId = "a") {return {workspaceId, displayName: name, description: "Synthetic target", sourceKind: "workspace-imported-asset", definitionRef: {kind: "asset-definition-version", id: `asset.${name}`, version: "1.0.0"}, implementationReleaseId: `implementation-release.${name}`, eligibility: {eligible: true, code: "eligible", message: "Ready"}, resources: {total: 0, editable: 0, frontendStructure: 0, frontendStyle: 0, backendLogic: 0, other: 0}};}
const listed = (...items: any[]) => ({ok: true, value: {items}});
function client(overrides: Record<string, unknown> = {}) {return {listCustomizationTargets: vi.fn().mockResolvedValue(listed()), listDerivedCustomizations: vi.fn().mockResolvedValue(listed()), ...overrides} as unknown as AssetDerivedCustomizationClient;}
async function render(workspaceId: string, source: AssetDerivedCustomizationClient, initialTarget?: {definitionId: string; version: string}) {
  if (!root) {container = document.createElement("div"); document.body.append(container); root = createRoot(container);}
  await act(async () => root!.render(<Suspense fallback={<p>Pending replacement</p>}><NotificationTestHarness><AssetDerivedCustomizationEditor workspaceId={workspaceId} client={source} initialTarget={initialTarget} /></NotificationTestHarness></Suspense>));
}
function searchButton() {return [...container.querySelectorAll("button")].find(button => button.textContent?.trim() === "Search")!;}
async function search(text: string) {
  const input = container.querySelector<HTMLInputElement>('.asset-customizer__search input[type="search"]')!;
  await act(async () => {Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, text); input.dispatchEvent(new Event("input", {bubbles: true}));});
  await act(async () => searchButton().click());
}

describe("customization asynchronous reads", () => {
  it("keeps the user's exact search when the older default list arrives later", async () => {
    const older = deferred();
    const list = vi.fn().mockImplementationOnce(() => older.promise).mockResolvedValueOnce(listed(target("latest")));
    await render("a", client({listCustomizationTargets: list}));
    await search("latest");
    expect(container.querySelector(".asset-customizer__targets")?.textContent).toContain("latest");
    await act(async () => older.resolve(listed(target("older-default"))));
    expect(container.querySelector(".asset-customizer__targets")?.textContent).toContain("latest");
    expect(container.querySelector(".asset-customizer__targets")?.textContent).not.toContain("older-default");
    expect(list.mock.calls[1][0].text).toBe("latest");
    expect(container.textContent).not.toContain("Loading customization targets");
  });

  it("ignores old workspace targets and rejected history without stale feedback", async () => {
    const oldTargets = deferred(), oldHistory = deferred();
    const source = client({
      listCustomizationTargets: vi.fn(({workspaceId}) => workspaceId === "a" ? oldTargets.promise : Promise.resolve(listed(target("current-b", "b")))),
      listDerivedCustomizations: vi.fn(({workspaceId}) => workspaceId === "a" ? oldHistory.promise : Promise.resolve(listed())),
    });
    await render("a", source); await render("b", source);
    await act(async () => {oldTargets.resolve(listed(target("old-a"))); oldHistory.reject(new Error("private transport detail"));});
    expect(container.querySelector(".asset-customizer__targets")?.textContent).toContain("current-b");
    expect(container.textContent).not.toContain("old-a"); expect(readNotificationMessages(container)).toEqual([]);
  });

  it("keeps the latest search loading when an older request rejects", async () => {
    const old = deferred(), latest = deferred();
    const list = vi.fn().mockImplementationOnce(() => old.promise).mockImplementationOnce(() => latest.promise);
    await render("a", client({listCustomizationTargets: list}));
    expect(searchButton().disabled).toBe(false);
    await search("latest");
    await act(async () => old.reject(new Error("private old query detail")));
    expect(container.textContent).toContain("Loading customization targets");
    expect(readNotificationMessages(container)).toEqual([]);
    await act(async () => latest.resolve(listed(target("latest"))));
    expect(container.querySelector(".asset-customizer__targets")?.textContent).toContain("latest");
    expect(container.textContent).not.toContain("Loading customization targets");
  });

  it("recovers from a rejected target query and does not reveal transport detail", async () => {
    const list = vi.fn().mockRejectedValueOnce(new Error("private transport detail")).mockResolvedValueOnce(listed(target("recovered")));
    await render("a", client({listCustomizationTargets: list}));
    expect(container.textContent).not.toContain("Loading customization targets");
    expect(readNotificationMessages(container).join(" ")).toContain("Customization targets are unavailable");
    expect(container.innerHTML).not.toContain("private transport detail");
    await search("recovered"); expect(container.querySelector(".asset-customizer__targets")?.textContent).toContain("recovered");
  });

  it("discards an old workspace detail response and releases the current search controls", async () => {
    const detail = deferred();
    const source = client({listCustomizationTargets: vi.fn(({workspaceId}) => Promise.resolve(listed(target(`choice-${workspaceId}`, workspaceId)))), readCustomizationTarget: vi.fn(() => detail.promise)});
    await render("a", source);
    await act(async () => (container.querySelector(".asset-customizer__target") as HTMLButtonElement).click());
    await render("b", source);
    await act(async () => detail.resolve({ok: true, value: {...target("private-old-a"), backingResources: [], protectedFields: []}}));
    expect(container.textContent).not.toContain("private-old-a"); expect(searchButton().disabled).toBe(false);
    expect(container.querySelector('input[value="asset.private-old-a.custom"]')).toBeNull();
  });
});


function detail(displayName: string) {return {...target("same"), displayName, description: displayName, backingResources: [{path: "frontend/example.css", role: "frontend-style", mediaType: "text/css", content: `/* ${displayName} */`, editable: true, sizeCharacters: 10}], protectedFields: []};}
function draft(name: string, status = "draft", revision = 1): any {
  const at = "2026-10-27T00:00:00Z", actor = "fixture-agent";
  const base = { definitionRef: target("same").definitionRef, implementationReleaseId: target("same").implementationReleaseId,
    sourceSnapshotId: "snapshot.base-same", sourceArtifact: { artifactId: "artifact.base-same", kind: "source", digest: `sha256:${"1".repeat(64)}`, mediaType: "application/json", sizeBytes: 12 } };
  const derivedDefinitionRef = { kind: "asset-definition-version", id: "asset.same.custom", version: "1.0.0" };
  const review = { implementationDraftId: "implementation-draft.custom", sourceSnapshotId: "snapshot.custom", sourceArtifact: { ...base.sourceArtifact, artifactId: "artifact.custom", digest: `sha256:${"2".repeat(64)}` },
    semanticPatchDigest: `sha256:${"3".repeat(64)}`, materializedFromRevision: status === "published" ? revision - 1 : revision, materializedAt: at, materializedBy: actor };
  return { workspaceId: "a", customizationId: `customization.${name}`, base, derivedDefinitionRef, semanticPatch: { "display-name": name }, status, revision,
    provenance: { kind: "layered-derived-customization", sourceKind: "workspace-imported-asset", baseDefinitionRef: base.definitionRef, baseImplementationReleaseId: base.implementationReleaseId, baseSourceSnapshotId: base.sourceSnapshotId, derivedAt: at, derivedBy: actor },
    createdAt: at, updatedAt: at, createdBy: actor,
    ...(["reviewed", "published"].includes(status) ? { review } : {}),
    ...(status === "published" ? { publication: { definitionRef: derivedDefinitionRef, implementationDraftId: review.implementationDraftId, sourceSnapshotId: review.sourceSnapshotId, publishedAt: at, publishedBy: actor } } : {}) };
}
const preferred = {definitionId: "asset.same", version: "1.0.0"};
function selectedClient(displayName: string, overrides: Record<string, unknown> = {}) {return client({listCustomizationTargets: vi.fn().mockResolvedValue(listed(target("same"))), readCustomizationTarget: vi.fn().mockResolvedValue({ok: true, value: detail(displayName)}), ...overrides});}
function button(text: string) {const found = [...document.querySelectorAll("button")].find(item => item.textContent?.trim() === text); expect(found).toBeDefined(); return found!;}
async function click(text: string) {await act(async () => button(text).click());}
function displayNameInput() {return [...container.querySelectorAll("label")].find(label => label.firstChild?.textContent?.trim() === "Display name")?.querySelector("input");}

describe("customization owner and mutation recovery", () => {
  it.each([false, true])("keeps the chosen target when a manual search includes the initial preference=%s", async includePreferred => {
    const initial = target("preferred"), chosen = target("chosen");
    const listing = vi.fn().mockResolvedValueOnce(listed(initial, chosen)).mockResolvedValueOnce(listed(...(includePreferred ? [initial, chosen] : [chosen])));
    const read = vi.fn(({definitionRef}: any) => Promise.resolve({ok: true, value: {...(definitionRef.id === initial.definitionRef.id ? initial : chosen), backingResources: [], protectedFields: []}}));
    await render("a", client({listCustomizationTargets: listing, readCustomizationTarget: read}), {definitionId: String(initial.definitionRef.id), version: "1.0.0"});
    expect(displayNameInput()?.value).toBe("preferred (Custom)");
    await act(async () => ([...container.querySelectorAll<HTMLButtonElement>(".asset-customizer__target")].find(item => item.textContent?.includes("chosen"))!).click());
    await click("Change asset");
    expect(displayNameInput()?.value).toBe("chosen (Custom)");
    await search("chosen");
    expect(displayNameInput()?.value).toBe("chosen (Custom)");
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    expect(read).toHaveBeenCalledTimes(2);
    expect(readNotificationMessages(container).join(" ")).not.toContain("does not currently have an exact implementation");
    expect(container.querySelector(".asset-customizer__targets")?.textContent).toContain("chosen");
  });

  it.each([false, true])("replaces preferred detail on a new client, denied=%s", async denied => {
    await render("a", selectedClient("Old owner detail"), preferred);
    expect(displayNameInput()?.value).toContain("Old owner detail");
    const listing = deferred();
    const next = selectedClient("New owner detail", {listCustomizationTargets: vi.fn(() => listing.promise)});
    await render("a", next, preferred);
    expect(displayNameInput()).toBeUndefined();
    const summary = target("same"); if (denied) summary.eligibility = {eligible: false, code: "unavailable", message: "No longer eligible"};
    await act(async () => listing.resolve(listed(summary)));
    expect(next.readCustomizationTarget).toHaveBeenCalledTimes(denied ? 0 : 1);
    expect(displayNameInput()?.value).toBe(denied ? undefined : "New owner detail (Custom)");
    expect(container.textContent).not.toContain("Old owner detail");
    expect(container.querySelector("textarea")?.value ?? "").not.toContain("Old owner detail");
  });

  it.each(["resolve", "reject"])("ignores an old owner's save %s without releasing the new owner's save", async settlement => {
    const older = deferred(), newer = deferred();
    const createOld = vi.fn(() => older.promise), createNew = vi.fn(() => newer.promise);
    await render("a", selectedClient("Old", {createDerivedCustomization: createOld}), preferred);
    await act(async () => {button("Create customization draft").click(); button("Create customization draft").click();});
    expect(createOld).toHaveBeenCalledTimes(1);
    await render("a", selectedClient("New", {createDerivedCustomization: createNew}), preferred);
    await click("Create customization draft");
    await act(async () => settlement === "resolve" ? older.resolve({ok: true, value: draft("old-private")}) : older.reject(new Error("private old transport")));
    expect(searchButton().disabled).toBe(true);
    expect(container.textContent).not.toContain("old-private"); expect(readNotificationMessages(container).join(" ")).not.toContain("private old transport");
    await act(async () => newer.resolve({ok: true, value: draft("new-current")}));
    expect(searchButton().disabled).toBe(false); expect(button("Save changes").disabled).toBe(false);
    expect(container.querySelector(".asset-customizer__history")?.textContent).toContain("new-current");
    expect(container.querySelector(".asset-customizer__history")?.textContent).not.toContain("old-private");
  });

  it("releases rejected review controls, keeps safe feedback and retries the same exact revision", async () => {
    const review = vi.fn().mockRejectedValueOnce(new Error("private review transport")).mockResolvedValueOnce({ok: true, value: draft("current", "reviewed", 2)});
    await render("a", selectedClient("Current", {createDerivedCustomization: vi.fn().mockResolvedValue({ok: true, value: draft("current")}), reviewDerivedCustomization: review}), preferred);
    await click("Create customization draft"); await click("Materialize review snapshot");
    expect(button("Materialize review snapshot").disabled).toBe(false);
    expect(readNotificationMessages(container).join(" ")).toContain("could not be reviewed");
    expect(container.innerHTML).not.toContain("private review transport");
    await click("Materialize review snapshot");
    expect(review.mock.calls).toEqual([[{workspaceId: "a", customizationId: "customization.current", expectedRevision: 1}], [{workspaceId: "a", customizationId: "customization.current", expectedRevision: 1}]]);
    expect(button("Publish customized copy").disabled).toBe(false);
  });

  it("releases rejected abandon controls and preserves the draft history", async () => {
    const abandon = vi.fn().mockRejectedValue(new Error("private abandon transport"));
    await render("a", client({listDerivedCustomizations: vi.fn().mockResolvedValue(listed(draft("retained"))), abandonDerivedCustomization: abandon}));
    await click("Abandon"); await click("Abandon customization");
    expect(button("Abandon").disabled).toBe(false); expect(searchButton().disabled).toBe(false);
    expect(container.querySelector(".asset-customizer__history")?.textContent).toContain("retained");
    expect(readNotificationMessages(container).join(" ")).toContain("could not be abandoned"); expect(container.innerHTML).not.toContain("private abandon transport");
  });
});

function editField(label: string, value: string) {
  const input = [...container.querySelectorAll<HTMLLabelElement>("label")].find(item => item.firstChild?.textContent?.trim() === label)?.querySelector<HTMLInputElement | HTMLTextAreaElement>("input,textarea");
  expect(input).toBeDefined();
  Object.getOwnPropertyDescriptor(input instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype, "value")!.set!.call(input, value);
  input!.dispatchEvent(new Event("input", { bubbles: true }));
  return input!;
}
function editSource(value: string) {
  const input = container.querySelector<HTMLTextAreaElement>('textarea[aria-label="Content for frontend/example.css"]')!;
  expect(input).not.toBeNull();
  Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!.call(input, value);
  input.dispatchEvent(new Event("input", { bubbles: true }));
}
function editingClient(overrides: Record<string, unknown> = {}) {
  let saved = draft("working");
  return selectedClient("Useful card", {
    createDerivedCustomization: vi.fn(async (input: any) => ({ ok: true, value: saved = { ...draft("working"), semanticPatch: input.semanticPatch } })),
    updateDerivedCustomization: vi.fn(async (input: any) => ({ ok: true, value: saved = { ...draft("working", "draft", input.expectedRevision + 1), semanticPatch: input.semanticPatch } })),
    reviewDerivedCustomization: vi.fn(async (input: any) => ({ ok: true, value: saved = { ...draft("working", "reviewed", input.expectedRevision + 1), semanticPatch: saved.semanticPatch } })),
    publishDerivedCustomization: vi.fn(async (input: any) => ({ ok: true, value: saved = { ...draft("working", "published", input.expectedRevision + 1), semanticPatch: saved.semanticPatch } })),
    ...overrides,
  });
}

describe("customization saved edit admission", () => {
  it("locks content before publication dispatch and releases it after a failed publication", async () => {
    const pending = deferred(); const source = editingClient({ publishDerivedCustomization: vi.fn(() => pending.promise) });
    await render("a", source, preferred); await click("Create customization draft"); await click("Materialize review snapshot");
    const beforeName = displayNameInput()!.value;
    await act(async () => {
      button("Publish customized copy").click();
      editField("Display name", "Unadmitted late publication edit");
      editSource(".unadmitted-late-publication-edit {}");
    });
    expect(displayNameInput()?.disabled).toBe(true);
    expect(displayNameInput()?.value).toBe(beforeName);
    expect(container.querySelector<HTMLTextAreaElement>('textarea[aria-label="Content for frontend/example.css"]')?.value).toBe("/* Useful card */");
    await act(async () => pending.reject(new Error("synthetic-private-publication-detail")));
    expect(displayNameInput()?.disabled).toBe(false);
    expect(button("Publish customized copy").disabled).toBe(false);
    expect(readNotificationMessages(container).join(" ")).not.toContain("synthetic-private-publication-detail");
    await act(async () => editField("Display name", "Admitted after publication failure"));
    expect(button("Publish customized copy").disabled).toBe(true);
  });

  for (const settlement of ["resolve", "reject"] as const) it(`keeps a new owner's publication edit lock when an older publication ${settlement}s`, async () => {
    const older = deferred(), newer = deferred();
    const oldClient = editingClient({ publishDerivedCustomization: vi.fn(() => older.promise) });
    await render("a", oldClient, preferred); await click("Create customization draft"); await click("Materialize review snapshot"); await click("Publish customized copy");
    const next = editingClient({ publishDerivedCustomization: vi.fn(() => newer.promise) });
    await render("a", next, preferred); await click("Create customization draft"); await click("Materialize review snapshot"); await click("Publish customized copy");
    await act(async () => settlement === "resolve" ? older.resolve({ ok: true, value: draft("old-private", "published", 3) }) : older.reject(new Error("synthetic-private-retired-publication")));
    expect(displayNameInput()?.disabled).toBe(true);
    expect(readNotificationMessages(container).join(" ")).not.toContain("synthetic-private-retired-publication");
    expect(container.querySelector(".asset-customizer__history")?.textContent).not.toContain("old-private");
    await act(async () => newer.resolve({ ok: true, value: draft("working", "published", 3) }));
    expect(container.querySelector(".asset-customizer__history")?.textContent).toContain("published - revision 3");
  });

  it("keeps preparation errors in fixed notification copy", async () => {
    const source = editingClient(); await render("a", source, preferred);
    await act(async () => editField("Derived definition ID", "../synthetic-private-identity"));
    await click("Create customization draft");
    expect(source.createDerivedCustomization).not.toHaveBeenCalled();
    const messages = readNotificationMessages(container).join(" ");
    expect(messages).toContain("Check the identity and JSON fields");
    expect(messages).not.toContain("synthetic-private-identity");
    expect(button("Create customization draft").disabled).toBe(false);
  });

  for (const status of ["published", "abandoned"] as const) it(`shows ${status} customization fields as read only`, async () => {
    const source = editingClient({ abandonDerivedCustomization: vi.fn().mockResolvedValue({ ok: true, value: draft("working", "abandoned", 2) }) });
    await render("a", source, preferred); await click("Create customization draft");
    if (status === "published") { await click("Materialize review snapshot"); await click("Publish customized copy"); }
    else { await click("Abandon"); await click("Abandon customization"); }
    expect(displayNameInput()?.disabled).toBe(true);
    expect(container.querySelector<HTMLTextAreaElement>('textarea[aria-label="Content for frontend/example.css"]')?.disabled).toBe(true);
    expect(button("Save changes").disabled).toBe(true);
    expect(searchButton().disabled).toBe(false);
  });

  it("saves a useful semantic and source copy before review and explicit publication", async () => {
    const original = detail("Useful card"), originalBytes = JSON.stringify(original);
    const source = editingClient({ readCustomizationTarget: vi.fn().mockResolvedValue({ ok: true, value: original }) });
    await render("a", source, preferred);
    await act(async () => { editField("Display name", "Incident intake card"); editField("Description", "Show incident severity to the operations team."); editSource(".incident-card { border: 2px solid orange; }"); });
    await click("Create customization draft");
    expect(source.createDerivedCustomization).toHaveBeenCalledWith(expect.objectContaining({ workspaceId: "a", baseDefinitionRef: target("same").definitionRef,
      baseImplementationReleaseId: target("same").implementationReleaseId, derivedDefinitionRef: { kind: "asset-definition-version", id: "asset.same.custom", version: "1.0.0" },
      semanticPatch: expect.objectContaining({ "display-name": "Incident intake card", description: "Show incident severity to the operations team." }),
      sourceChanges: [{ operation: "upsert", path: "frontend/example.css", role: "frontend-style", mediaType: "text/css", content: ".incident-card { border: 2px solid orange; }" }] }));
    expect(button("Materialize review snapshot").disabled).toBe(false);
    expect(button("Publish customized copy").disabled).toBe(true);
    await click("Materialize review snapshot");
    expect(source.reviewDerivedCustomization).toHaveBeenCalledWith({ workspaceId: "a", customizationId: "customization.working", expectedRevision: 1 });
    expect(source.publishDerivedCustomization).not.toHaveBeenCalled();
    await click("Publish customized copy");
    expect(source.publishDerivedCustomization).toHaveBeenCalledWith({ workspaceId: "a", customizationId: "customization.working", expectedRevision: 2 });
    expect(container.querySelector(".asset-customizer__history")?.textContent).toContain("published - revision 3");
    expect(JSON.stringify(original)).toBe(originalBytes);
  });

  for (const kind of ["semantic", "source"] as const) it(`requires saving ${kind} edits before review and publication`, async () => {
    const source = editingClient(); await render("a", source, preferred);
    await click("Create customization draft"); await click("Materialize review snapshot");
    await act(async () => {
      if (kind === "semantic") editField("Display name", "New unsaved card"); else editSource(".new-unsaved-card {}");
      // Try dispatch in the same turn, before disabled state is painted.
      button("Publish customized copy").click(); button("Materialize review snapshot").click();
    });
    expect(source.publishDerivedCustomization).not.toHaveBeenCalled();
    expect(source.reviewDerivedCustomization).toHaveBeenCalledTimes(1);
    expect(button("Publish customized copy").disabled).toBe(true);
    expect(button("Materialize review snapshot").disabled).toBe(true);
    expect(container.textContent).toContain("Save your changes before review or publication.");
    await click("Save changes"); expect(button("Publish customized copy").disabled).toBe(true);
    await click("Materialize review snapshot"); await click("Publish customized copy");
    expect(source.updateDerivedCustomization).toHaveBeenCalledWith(expect.objectContaining({ expectedRevision: 2 }));
    expect(source.publishDerivedCustomization).toHaveBeenCalledWith({ workspaceId: "a", customizationId: "customization.working", expectedRevision: 4 });
  });

  for (const kind of ["create", "update"] as const) it(`retains newer edits when the earlier ${kind} is acknowledged`, async () => {
    const pending = deferred();
    const source = editingClient(kind === "create" ? { createDerivedCustomization: vi.fn(() => pending.promise) } : { updateDerivedCustomization: vi.fn(() => pending.promise) });
    await render("a", source, preferred);
    if (kind === "update") { await click("Create customization draft"); await act(async () => editField("Display name", "First update")); }
    await click(kind === "create" ? "Create customization draft" : "Save changes");
    await act(async () => { editField("Display name", "Newer retained value"); editSource(".newer-retained-value {}"); });
    await act(async () => pending.resolve({ ok: true, value: draft("working", "draft", kind === "create" ? 1 : 2) }));
    expect(displayNameInput()?.value).toBe("Newer retained value");
    expect(container.querySelector<HTMLTextAreaElement>('textarea[aria-label="Content for frontend/example.css"]')?.value).toBe(".newer-retained-value {}");
    expect(button("Materialize review snapshot").disabled).toBe(true);
    expect(readNotificationMessages(container).join(" ")).toContain("Save your newer changes");
    await click("Materialize review snapshot"); expect(source.reviewDerivedCustomization).not.toHaveBeenCalled();
  });

  it("keeps unsaved edits after a failed save and permits explicit retry", async () => {
    const update = vi.fn().mockRejectedValueOnce(new Error("synthetic-private-save-detail")).mockResolvedValueOnce({ ok: true, value: draft("working", "draft", 2) });
    const source = editingClient({ updateDerivedCustomization: update }); await render("a", source, preferred);
    await click("Create customization draft"); await act(async () => editField("Display name", "Retry this value"));
    await click("Save changes");
    expect(displayNameInput()?.value).toBe("Retry this value"); expect(button("Save changes").disabled).toBe(false);
    expect(button("Materialize review snapshot").disabled).toBe(true);
    expect(readNotificationMessages(container).join(" ")).not.toContain("synthetic-private-save-detail");
    await click("Save changes"); expect(update).toHaveBeenCalledTimes(2); expect(button("Materialize review snapshot").disabled).toBe(false);
  });

  it("keeps new edits unsaved when a prior review finishes", async () => {
    const pending = deferred(); const source = editingClient({ reviewDerivedCustomization: vi.fn(() => pending.promise) });
    await render("a", source, preferred); await click("Create customization draft"); await click("Materialize review snapshot");
    await act(async () => editSource(".edited-during-review {}"));
    await act(async () => pending.resolve({ ok: true, value: draft("working", "reviewed", 2) }));
    expect(button("Publish customized copy").disabled).toBe(true); await click("Publish customized copy");
    expect(source.publishDerivedCustomization).not.toHaveBeenCalled();
  });

  it("locks the distinct derived identity after creation while keeping semantic edits available", async () => {
    const source = editingClient(); await render("a", source, preferred); await click("Create customization draft");
    for (const label of ["Derived definition ID", "Derived version"]) {
      const input = [...container.querySelectorAll("label")].find(item => item.firstChild?.textContent?.trim() === label)?.querySelector("input");
      expect(input?.disabled).toBe(true);
    }
    expect(displayNameInput()?.disabled).toBe(false);
  });
});

describe("customization committed lease and acknowledgement", () => {
  it("keeps the visible owner's save when a replacement render has not committed", async () => {
    const save = deferred(), suspended = deferred(); const source = editingClient({ createDerivedCustomization: vi.fn(() => save.promise) });
    await render("a", source, preferred); await click("Create customization draft");
    const replacement = editingClient();
    function Uncommitted(): never { throw suspended.promise; }
    await act(async () => startTransition(() => root!.render(<Suspense fallback={<p>Pending replacement</p>}><NotificationTestHarness><AssetDerivedCustomizationEditor workspaceId="b" client={replacement} initialTarget={preferred}/><Uncommitted/></NotificationTestHarness></Suspense>)));
    expect(container.textContent).not.toContain("Pending replacement");
    await act(async () => save.resolve({ ok: true, value: draft("working") }));
    expect(button("Save changes").disabled).toBe(false);
    expect(source.createDerivedCustomization).toHaveBeenCalledTimes(1);
    expect(replacement.listCustomizationTargets).not.toHaveBeenCalled();
    await render("a", source, preferred);
  });

  it("locks edits while an abandon is pending and restores them after failure", async () => {
    const pending = deferred(); const source = editingClient({ abandonDerivedCustomization: vi.fn(() => pending.promise) });
    await render("a", source, preferred); await click("Create customization draft"); await click("Abandon"); await click("Abandon customization");
    const before = displayNameInput()!.value;
    await act(async () => { editField("Display name", "Unadmitted terminal edit"); editSource(".unadmitted-terminal-edit {}"); });
    expect(displayNameInput()?.disabled).toBe(true); expect(displayNameInput()?.value).toBe(before);
    await act(async () => pending.reject(new Error("synthetic-private-abandon-detail")));
    expect(displayNameInput()?.disabled).toBe(false); expect(button("Save changes").disabled).toBe(false);
    expect(readNotificationMessages(container).join(" ")).not.toContain("synthetic-private-abandon-detail");
  });

  const methods = { create: "createDerivedCustomization", update: "updateDerivedCustomization", review: "reviewDerivedCustomization", publish: "publishDerivedCustomization", abandon: "abandonDerivedCustomization" } as const;
  for (const operation of Object.keys(methods) as (keyof typeof methods)[]) for (const fault of ["workspace", "customization", "derived", "base", "release", "revision", "status", "missing"] as const) it(`refuses ${operation} ${fault} acknowledgement and retries without redirecting authority`, async () => {
    let calls = 0;
    const status = operation === "review" ? "reviewed" : operation === "publish" ? "published" : operation === "abandon" ? "abandoned" : "draft";
    const revision = operation === "create" ? 1 : operation === "publish" ? 3 : 2;
    const perform = vi.fn(async () => {
      const record = draft("working", status, revision);
      if (++calls > 1) return { ok: true, value: record };
      if (fault === "workspace") record.workspaceId = "workspace.foreign";
      if (fault === "customization") record.customizationId = operation === "create" ? "../synthetic-private-id" : "customization.other";
      if (fault === "derived") { record.derivedDefinitionRef = { ...record.derivedDefinitionRef, id: "asset.other.custom" }; if (record.publication) record.publication.definitionRef = record.derivedDefinitionRef; }
      if (fault === "base") { record.base.definitionRef = { ...record.base.definitionRef, id: "asset.other" }; record.provenance.baseDefinitionRef = record.base.definitionRef; }
      if (fault === "release") { record.base.implementationReleaseId = "implementation-release.other"; record.provenance.baseImplementationReleaseId = record.base.implementationReleaseId; }
      if (fault === "revision") { record.revision = 99; if (record.review) record.review.materializedFromRevision = status === "published" ? 98 : 99; }
      if (fault === "status") record.status = "invalid";
      return { ok: true, value: fault === "missing" ? undefined : record };
    });
    const source = editingClient({ [methods[operation]]: perform }); await render("a", source, preferred);
    if (operation !== "create") await click("Create customization draft");
    if (operation === "update") await act(async () => editField("Display name", "Pending saved value"));
    if (operation === "publish") await click("Materialize review snapshot");
    async function actOnce() {
      if (operation === "abandon") { await click("Abandon"); await click("Abandon customization"); }
      else await click(operation === "create" ? "Create customization draft" : operation === "update" ? "Save changes" : operation === "review" ? "Materialize review snapshot" : "Publish customized copy");
    }
    await actOnce(); expect(calls).toBe(1);
    expect(readNotificationMessages(container).join(" ")).toContain("could not");
    expect(readNotificationMessages(container).join(" ")).not.toContain("synthetic-private-id");
    expect(container.querySelector(".asset-customizer__history")?.textContent).not.toContain("asset.other");
    expect(searchButton().disabled).toBe(false);
    await actOnce(); expect(calls).toBe(2);
    if (operation === "create") { await click("Materialize review snapshot"); expect(source.reviewDerivedCustomization).toHaveBeenCalledWith({ workspaceId: "a", customizationId: "customization.working", expectedRevision: 1 }); }
  });

  it("accepts a fresh canonical server-assigned customization identity", async () => {
    const source = editingClient({ createDerivedCustomization: vi.fn().mockResolvedValue({ ok: true, value: draft("fresh-identity") }),
      reviewDerivedCustomization: vi.fn().mockResolvedValue({ ok: true, value: draft("fresh-identity", "reviewed", 2) }) });
    await render("a", source, preferred); await click("Create customization draft"); await click("Materialize review snapshot");
    expect(source.reviewDerivedCustomization).toHaveBeenCalledWith({ workspaceId: "a", customizationId: "customization.fresh-identity", expectedRevision: 1 });
    expect(button("Publish customized copy").disabled).toBe(false);
  });

  for (const fault of ["workspace", "definition", "release", "eligibility", "resources"] as const) it(`refuses a current target detail with wrong ${fault} and retries explicitly`, async () => {
    let calls = 0;
    const read = vi.fn(async () => {
      const value: any = detail("Useful card");
      if (++calls > 1) return { ok: true, value };
      if (fault === "workspace") value.workspaceId = "workspace.foreign";
      if (fault === "definition") value.definitionRef = { ...value.definitionRef, id: "asset.other" };
      if (fault === "release") value.implementationReleaseId = "implementation-release.other";
      if (fault === "eligibility") value.eligibility.eligible = false;
      if (fault === "resources") value.backingResources = undefined;
      return { ok: true, value };
    });
    const source = editingClient({ readCustomizationTarget: read }); await render("a", source, preferred);
    expect(displayNameInput()).toBeUndefined(); expect(readNotificationMessages(container).join(" ")).toContain("unavailable");
    await act(async () => container.querySelector<HTMLButtonElement>(".asset-customizer__target")!.click());
    expect(displayNameInput()?.value).toBe("Useful card (Custom)"); expect(calls).toBe(2);
  });
});

describe("customization target resource admission", () => {
  for (const fault of ["readonly-content", "editable-content", "path", "media-type", "role", "editable-flag", "size", "duplicate", "file-count", "file-content-limit", "aggregate-limit", "nul-content"] as const) it(`refuses ${fault} resource data before rendering and retries explicitly`, async () => {
    let calls = 0;
    const read = vi.fn(async () => {
      const value: any = detail("Useful card");
      if (++calls > 1) return { ok: true, value };
      const file = value.backingResources[0];
      if (fault === "readonly-content") { file.editable = false; file.content = { diagnostic: "synthetic-private-resource-detail" }; }
      if (fault === "editable-content") file.content = {};
      if (fault === "path") file.path = {};
      if (fault === "media-type") file.mediaType = {};
      if (fault === "role") file.role = "unknown";
      if (fault === "editable-flag") file.editable = {};
      if (fault === "size") file.sizeCharacters = -1;
      if (fault === "duplicate") value.backingResources.push({ ...file, path: file.path.toUpperCase() });
      if (fault === "file-count") value.backingResources = Array.from({ length: ASSET_STUDIO_LIMITS.maxFiles + 1 }, (_, i) => ({ ...file, path: `frontend/file-${i}.css` }));
      if (fault === "file-content-limit") file.content = "x".repeat(ASSET_STUDIO_LIMITS.maxFileCharacters + 1);
      if (fault === "aggregate-limit") value.backingResources = Array.from({ length: Math.floor(ASSET_STUDIO_LIMITS.maxTotalSourceCharacters / ASSET_STUDIO_LIMITS.maxFileCharacters) + 1 }, (_, i) => ({ ...file, path: `frontend/part-${i}.css`, content: "x".repeat(ASSET_STUDIO_LIMITS.maxFileCharacters) }));
      if (fault === "nul-content") file.content = "invalid\0content";
      return { ok: true, value };
    });
    const source = editingClient({ readCustomizationTarget: read }); await render("a", source, preferred);
    expect(displayNameInput()).toBeUndefined();
    expect(readNotificationMessages(container).join(" ")).toContain("unavailable");
    expect(readNotificationMessages(container).join(" ")).not.toContain("synthetic-private-resource-detail");
    expect(container.innerHTML).not.toContain("synthetic-private-resource-detail");
    await act(async () => container.querySelector<HTMLButtonElement>(".asset-customizer__target")!.click());
    expect(displayNameInput()?.value).toBe("Useful card (Custom)"); expect(calls).toBe(2);
  });

  it("preserves valid read-only HTML as displayed text alongside editable CSS", async () => {
    const value: any = detail("Useful card"); const text = "<p>Static reference help</p>";
    value.backingResources.push({ path: "other/reference.html", role: "other", mediaType: "text/html", content: text, editable: false, sizeCharacters: text.length });
    const original = JSON.stringify(value);
    await render("a", editingClient({ readCustomizationTarget: vi.fn().mockResolvedValue({ ok: true, value }) }), preferred);
    expect(container.querySelector(".asset-customizer__readonly-source code")?.textContent).toBe(text);
    expect(container.querySelector(".asset-customizer__readonly-source p")).toBeNull();
    expect(container.querySelector('textarea[aria-label="Content for frontend/example.css"]')).not.toBeNull();
    expect(JSON.stringify(value)).toBe(original); expect(readNotificationMessages(container)).toEqual([]);
  });

  it("retains the accepted base snapshot when a client later mutates its reply alias", async () => {
    const value: any = detail("Useful card"); value.definition = { displayName: "Original base", description: "Useful card" };
    const source = editingClient({ readCustomizationTarget: vi.fn().mockResolvedValue({ ok: true, value }) });
    await render("a", source, preferred);
    await act(async () => editField("Display name", "Explicit new name"));
    value.definition.displayName = "Explicit new name";
    await click("Create customization draft");
    expect(source.createDerivedCustomization).toHaveBeenCalledWith(expect.objectContaining({ semanticPatch: expect.objectContaining({ "display-name": "Explicit new name" }) }));
    expect(button("Materialize review snapshot").disabled).toBe(false);
  });
});
