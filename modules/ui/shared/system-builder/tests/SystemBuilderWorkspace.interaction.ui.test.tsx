// @vitest-environment jsdom
import { act, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

import { normalizeAssetId, normalizeAssetSlotId, type AssetInstance } from "../../../../contracts/asset";
import { createWorkspaceId } from "../../../../contracts/workspace";
import { normalizeSystemBuilderRevisionId, normalizeSystemBuilderSystemId } from "../../../../contracts/system-builder";
import { readSystemFormAction, SYSTEM_BUILDER_DEFAULT_FORM_METADATA_KEY, systemBuilderSuccess } from "../../../../contracts/system-builder";
import type {
  PublishedSystemForm,
  SystemBuilderRecord,
  SystemBuilderComposerAsset,
  SystemBuilderRevision,
  SystemBuilderTemplateSummary,
  ListSystemBuilderComposerAssetsQuery,
  ReadSystemBuilderComposerAssetQuery,
} from "../../../../contracts/system-builder";
import {
  preferredSystemComposerTarget,
  SystemBuilderWorkspace,
  type SystemBuilderClient,
} from "../SystemBuilderWorkspace";
import { NotificationTestHarness, readNotificationMessages } from "../../notifications/tests/NotificationTestHarness";
import { readFormActionOptions, SystemFormActionEditor } from "../SystemFormActionEditor";
import { SystemFormJourney } from "../SystemFormPreview";
import { SystemManagementWorkspace } from "../SystemManagementWorkspace";
import { SystemPublishedFormDialog } from "../SystemPublishedFormDialog";
import type { SystemPublishedFormClient } from "../SystemPublishedFormClient";

(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | undefined;
let container: HTMLDivElement | undefined;

afterEach(() => {
  act(() => root?.unmount());
  container?.remove();
  document.body.innerHTML = "";
  root = undefined;
  container = undefined;
});

describe("SystemBuilderWorkspace UI preview", () => {
  it("submits a published form only after valid answers and reuses the same request on retry", async () => {
    const form: PublishedSystemForm = {
      id: "survey", title: "Intake survey",
      steps: [{ id: "contact", label: "Contact details", conditions: [], defaultDestinationId: "survey",
        fields: [{ id: "email", label: "Contact", helpText: "", kind: "text", dateKind: "date", required: true, options: [] }] }],
    };
    const close = vi.fn();
    const list = vi.fn(async () => systemBuilderSuccess([form]));
    const submit = vi.fn<SystemPublishedFormClient["submit"]>()
      .mockRejectedValueOnce(new Error("Connection lost"))
      .mockResolvedValueOnce(systemBuilderSuccess({ status: "pending", receiptId: "safe-receipt" }))
      .mockResolvedValueOnce(systemBuilderSuccess({ status: "already-recorded", receiptId: "safe-receipt" }));
    const client = { list, submit };
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    await act(async () => root!.render(<SystemPublishedFormDialog workspaceId="workspace-a" releaseId="release-a" client={client} onClose={close} />));
    const dialog = () => document.querySelector('[role="dialog"]')!;
    const click = (name: string) => act(async () => button(dialog(), name).click());
    expect(list).toHaveBeenCalledWith({ workspaceId: "workspace-a", releaseId: "release-a" });
    await click("Submit form");
    expect(dialog().textContent).toContain("Enter an answer.");
    expect(submit).not.toHaveBeenCalled();
    const input = dialog().querySelector<HTMLInputElement>("input")!;
    expect(document.activeElement).toBe(input);
    await act(async () => setInputValue(input, "Synthetic contact"));
    await click("Submit form");
    expect(dialog().textContent).toContain("The host did not confirm your submission.");
    const first = submit.mock.calls[0]![0];
    expect(first).toEqual({ workspaceId: "workspace-a", releaseId: "release-a", formId: "survey",
      submissionId: expect.any(String), answers: { email: "Synthetic contact" } });
    await click("Retry submission");
    expect(dialog().textContent).toContain("Your submission is still pending.");
    await click("Retry submission");
    expect(submit.mock.calls.map(([request]) => request)).toEqual([first, first, first]);
    expect(dialog().textContent).toContain("Your form was submitted.");
    expect(document.activeElement?.textContent).toBe("Your form was submitted.");
    expect(dialog().textContent).not.toContain("Synthetic contact");
  });

  it("clears a previous release and rejects malformed form data before rendering controls", async () => {
    const older: PublishedSystemForm = {
      id: "old", title: "Previous form",
      steps: [{ id: "start", label: "Page 1", fields: [], conditions: [], defaultDestinationId: "old" }],
    };
    const current: PublishedSystemForm = { ...older, id: "current", title: "Current form",
      steps: [{ id: "start", label: "Page 1", fields: [], conditions: [], defaultDestinationId: "current" }] };
    const close = vi.fn();
    const submit = vi.fn<SystemPublishedFormClient["submit"]>();
    const list = vi.fn<SystemPublishedFormClient["list"]>()
      .mockResolvedValueOnce(systemBuilderSuccess([older]))
      .mockResolvedValueOnce(systemBuilderSuccess([{ ...current, steps: [{ ...current.steps[0]!, fields: [null] }] } as unknown as PublishedSystemForm]))
      .mockResolvedValueOnce(systemBuilderSuccess([{ ...current, steps: [{ ...current.steps[0]!, defaultDestinationId: "start" }] }]))
      .mockResolvedValueOnce(systemBuilderSuccess([{ ...current, steps: [{ ...current.steps[0]!, fields: [
        { id: "score", label: "Score", helpText: "", kind: "number", dateKind: "date", required: true, options: [], min: 10, max: 1 },
      ] }] }]))
      .mockResolvedValueOnce(systemBuilderSuccess([current]));
    const client = { list, submit };
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    const open = (workspaceId: string, releaseId: string) => act(async () => root!.render(
      <SystemPublishedFormDialog workspaceId={workspaceId} releaseId={releaseId} client={client} onClose={close} />,
    ));
    const dialog = () => document.querySelector('[role="dialog"]')!;
    await open("workspace-a", "release-a");
    expect(dialog().textContent).toContain("Previous form");
    await open("workspace-b", "release-b");
    expect(dialog().textContent).not.toContain("Previous form");
    expect(dialog().textContent).toContain("Could not open forms for this published build.");
    expect(dialog().querySelector("form")).toBeNull();
    await act(async () => button(dialog(), "Try again").click());
    expect(dialog().querySelector("form")).toBeNull();
    await act(async () => button(dialog(), "Try again").click());
    expect(dialog().querySelector("form")).toBeNull();
    await act(async () => button(dialog(), "Try again").click());
    expect(dialog().textContent).toContain("Current form");
    await act(async () => dialog().querySelector<HTMLButtonElement>('button[aria-label="Close published forms"]')!.click());
    expect(close).toHaveBeenCalledOnce();
    expect(submit).not.toHaveBeenCalled();
  });

  it("keeps oversized answers editable and allows closing after sending", async () => {
    const form: PublishedSystemForm = { id: "large", title: "Long answers", steps: [{ id: "start", label: "Page 1",
      conditions: [], defaultDestinationId: "large", fields: Array.from({ length: 9 }, (_, index) => ({
        id: `response-${index}`, label: `Answer ${index}`, helpText: "", kind: "text", dateKind: "date",
        required: true, options: [], min: 0, max: 4000,
      })) }] };
    const list = vi.fn(async () => systemBuilderSuccess([form]));
    const submit = vi.fn<SystemPublishedFormClient["submit"]>().mockReturnValue(new Promise(() => {}));
    const close = vi.fn();
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    await act(async () => root!.render(<SystemPublishedFormDialog workspaceId="workspace-a" releaseId="release-a"
      client={{ list, submit }} onClose={close} />));
    const dialog = () => document.querySelector('[role="dialog"]')!;
    const fields = [...dialog().querySelectorAll<HTMLInputElement>("input")];
    await act(async () => fields.forEach((field) => setInputValue(field, "a".repeat(3700))));
    await act(async () => button(dialog(), "Submit form").click());
    expect(dialog().textContent).toContain("Shorten your answers to 32,768 characters total");
    expect(submit).not.toHaveBeenCalled();
    expect(fields[0]?.value.length).toBe(3700);
    await act(async () => setInputValue(fields[0]!, "a".repeat(3168)));
    await act(async () => button(dialog(), "Submit form").click());
    expect(submit).toHaveBeenCalledOnce();
    expect(dialog().textContent).toContain("Closing it does not stop a submission already sent.");
    await act(async () => dialog().querySelector<HTMLButtonElement>('button[aria-label="Close published forms"]')!.click());
    expect(close).toHaveBeenCalledOnce();
  });

  it("keeps radio labels and required-error focus distinct from similar field IDs", async () => {
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    const finish = vi.fn();
    await act(async () => root!.render(<SystemFormJourney finalLabel="Submit answers" onFinish={finish}
      form={{ id: "survey", title: "Survey", steps: [{ id: "step", label: "Choices", conditions: [], defaultDestinationId: "survey", fields: [
        { id: "priority", label: "Priority", helpText: "", kind: "choice", choicePresentation: "radio", required: true,
          dateKind: "date", options: [{ label: "Low", value: "low" }, { label: "High", value: "high" }] },
        { id: "priority-option-1", label: "Explain priority", helpText: "A short reason", kind: "text", required: true,
          dateKind: "date", options: [] },
      ] }] }} />));
    const controls = [...container.querySelectorAll<HTMLInputElement>("input")];
    expect(new Set(controls.map((item) => item.id)).size).toBe(3);
    const first = controls[0]!;
    const second = controls[1]!;
    const explanation = controls[2]!;
    expect(explanation.labels?.[0]?.textContent).toBe("Explain priority (required)");
    const submit = () => act(async () => button(container!, "Submit answers").click());
    await submit();
    expect(document.activeElement).toBe(first);
    await act(async () => second.click());
    await submit();
    expect(document.activeElement).toBe(explanation);
    expect(finish).not.toHaveBeenCalled();
  });

  it("does not offer submission mapping for an ambiguous Create Record setup", async () => {
    const operation = (id: string, entity: string) => ({
      ...instance(id, "builtin.data.create-operation", id, { entity }),
      definitionRef: composerDefinition("builtin.data.create-operation", "Create Record", [], false, "3.0.0").definitionRef,
    });
    const recordField = (name: string) => ({
      ...instance(`fixture.${name}`, "builtin.data.field", name, { name, type: "text" }),
      definitionRef: composerDefinition("builtin.data.field", "Data Field", [], false, "3.0.0").definitionRef,
    });
    expect(readFormActionOptions([recordField("reason"), recordField("constructor")]).recordFields.map((field) => field.name))
      .toEqual(["reason"]);
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    const onSave = vi.fn();
    const render = (instances: readonly AssetInstance[]) => act(async () => root!.render(
      <SystemFormActionEditor formId="fixture.form" fields={[]} instances={instances} onSave={onSave} onRemove={() => {}} />,
    ));
    await render([operation("fixture.valid", "Request"), operation("fixture.malformed", "Invalid / entity")]);
    expect(container.textContent).toContain("Keep one Create Record operation");
    expect(container.querySelector("select")).toBeNull();
    await render([operation("fixture.malformed", "Invalid / entity")]);
    expect(container.textContent).toContain("Configure a valid record entity");
    expect(container.querySelector("select")).toBeNull();
    expect(onSave).not.toHaveBeenCalled();
  });

  it("edits the exact selected form when two forms share a Canvas page", async () => {
    const page = {
      ...composerDefinition("builtin.layout.page.single", "Single content", ["content"], false, "3.0.0"),
      layoutRole: "page-layout" as const,
      assetType: "page" as const,
    };
    const baseShell = layoutDefinition("builtin.layout.application.standard", "Standard", ["content"], "3.0.0");
    const shell = {
      ...baseShell,
      slots: baseShell.slots.map((slot) => ({ ...slot, cardinality: { minItems: 1, maxItems: 8 }, acceptedDefinitionRefs: [page.definitionRef] })),
    };
    const rootDefinition = composerDefinition("builtin.system.system", "System root", ["application-shell"], false, "3.0.0");
    const formContainer = (id: string, name: string, slots = ["fields"]) => {
      const definition = composerDefinition(id, name, slots, true, "3.0.0");
      return { ...definition, slots: definition.slots.map((slot) => ({
        ...slot, cardinality: { minItems: 0, maxItems: 24 },
      })) };
    };
    const form = formContainer("builtin.form.form", "Form", ["fields", "actions", "messages"]);
    const group = formContainer("builtin.form.field-group", "Field Group");
    const resourceBrowser = composerDefinition("builtin.shell.resource-browser", "Resource browser", ["states"], false, "3.0.0");
    const textField = {
      ...composerDefinition("builtin.form.text-field", "Text Field", [], false, "3.0.0"),
      configurationSchema: { fields: [
        { fieldId: "label", valueKind: "string", label: "Label", required: false },
        { fieldId: "required", valueKind: "boolean", label: "Required", required: false },
      ] } as SystemBuilderComposerAsset["configurationSchema"],
    };
    const catalog = [
      rootDefinition, shell, page, form, group, textField, resourceBrowser,
      { ...composerDefinition("builtin.form.submit-action", "Submit button", [], false, "3.0.0"),
        configurationSchema: { fields: [{ fieldId: "label", valueKind: "string", label: "Button label", required: false }] } as SystemBuilderComposerAsset["configurationSchema"] },
      { ...composerDefinition("builtin.form.validation-message", "Validation message", [], false, "3.0.0"),
        configurationSchema: { fields: [{ fieldId: "message", valueKind: "string", label: "Message", required: false }] } as SystemBuilderComposerAsset["configurationSchema"] },
      composerDefinition("builtin.form.radio-group", "Radio buttons", [], false, "3.0.0"),
      composerDefinition("builtin.form.checkbox-field", "Checkbox", [], false, "3.0.0"),
      {
        ...composerDefinition("builtin.form.select-field", "Choice", [], false, "3.0.0"),
        configurationSchema: { fields: [
          { fieldId: "staticOptions", valueKind: "array", label: "Options", required: false },
          { fieldId: "optionsSource", valueKind: "string", label: "Options source", required: false },
        ] } satisfies SystemBuilderComposerAsset["configurationSchema"],
      },
      {
        ...composerDefinition("builtin.form.number-field", "Number Field", [], false, "3.0.0"),
        configurationSchema: { fields: [
          { fieldId: "minimum", valueKind: "number", label: "Minimum", required: false },
          { fieldId: "maximum", valueKind: "number", label: "Maximum", required: false },
        ] } satisfies SystemBuilderComposerAsset["configurationSchema"],
      },
      composerDefinition("builtin.ui.section", "Section", ["content"], false, "3.0.0"),
      { ...composerDefinition("builtin.data.create-operation", "Create Request", [], false, "3.0.0"), assetType: "tool" as const },
      { ...composerDefinition("builtin.data.field", "Data Field", [], false, "3.0.0"), assetType: "schema" as const },
    ];
    const byDefinition = (id: string) => catalog.find((asset) => asset.definitionId === id)!.definitionRef;
    const intake = { ...instance("fixture.intake", form.definitionId, "Intake", { title: "Intake" }), definitionRef: form.definitionRef };
    const questionnaire = { ...instance("fixture.questionnaire", form.definitionId, "Questionnaire", { title: "Questionnaire" }), definitionRef: form.definitionRef };
    const intakeStep = { ...instance("fixture.intake-step", group.definitionId, "First step", { title: "First step" }), definitionRef: group.definitionRef };
    const questionnaireStep = { ...instance("fixture.questionnaire-step", group.definitionId, "First step", { title: "First step" }), definitionRef: group.definitionRef };
    const submit = { ...instance("fixture.submit", "builtin.form.submit-action", "Submit button", { label: "Send" }), definitionRef: byDefinition("builtin.form.submit-action") };
    const message = { ...instance("fixture.message", "builtin.form.validation-message", "Validation message", { message: "Check your answers" }),
      definitionRef: byDefinition("builtin.form.validation-message") };
    const browser = { ...instance("fixture.browser", resourceBrowser.definitionId, "Resource browser", {}), definitionRef: resourceBrowser.definitionRef };
    const section = { ...instance("fixture.state-section", "builtin.ui.section", "State content", {}), definitionRef: byDefinition("builtin.ui.section") };
    const fixture = [
      { ...instance("fixture.root", rootDefinition.definitionId, "Portal", {}), definitionRef: rootDefinition.definitionRef },
      { ...instance("fixture.shell", shell.definitionId, "Standard", {}), definitionRef: shell.definitionRef },
      { ...instance("fixture.page", page.definitionId, "Main page", {}), definitionRef: page.definitionRef },
      { ...instance("fixture.operation", "builtin.data.create-operation", "Create Request", { entity: "Request" }),
        definitionRef: byDefinition("builtin.data.create-operation") },
      { ...instance("fixture.text-record", "builtin.data.field", "Reason", { name: "reason", label: "Reason", type: "text" }),
        definitionRef: byDefinition("builtin.data.field") },
      { ...instance("fixture.number-record", "builtin.data.field", "Count", { name: "count", label: "Count", type: "number" }),
        definitionRef: byDefinition("builtin.data.field") },
      intake, questionnaire, intakeStep, questionnaireStep, browser, section, submit, message,
    ];
    const ref = (item: AssetInstance) => ({ kind: "asset-instance" as const, id: normalizeAssetId(item.instanceId) });
    const place = (parent: AssetInstance, child: AssetInstance, slot: string, order: number) => ({
      schemaVersion: "asset-placement.v1" as const, placementId: `place.${child.instanceId}`, slotId: normalizeAssetSlotId(slot),
      parentInstanceRef: ref(parent), childInstanceRef: ref(child), order,
    });
    const initial: SystemBuilderRevision = {
      revisionId: normalizeSystemBuilderRevisionId("fixture.r1"), systemId: normalizeSystemBuilderSystemId("fixture"),
      targetWorkspaceId: createWorkspaceId("workspace-a"), revisionNumber: 1,
      composition: { compositionId: normalizeAssetId("fixture.composition"), compositionType: "system",
        displayName: "Portal", version: "0.1.0", lifecycleStatus: "draft",
        rootInstanceRefs: [ref(fixture[0]!)], instanceRefs: fixture.map(ref), bindingRefs: [],
        provenance: { sourceKind: "human-authored" } },
      instances: fixture, bindings: [],
      structure: { schemaVersion: "system-builder-structure.v1", profile: "interactive", layoutPresetRef: shell.definitionRef },
      placements: [
        { schemaVersion: "asset-placement.v1", placementId: "place.shell", slotId: normalizeAssetSlotId("application-shell"),
          parentInstanceRef: ref(fixture[0]!), childInstanceRef: ref(fixture[1]!), order: 0 },
        { schemaVersion: "asset-placement.v1", placementId: "place.page", slotId: normalizeAssetSlotId("content"),
          parentInstanceRef: ref(fixture[1]!), childInstanceRef: ref(fixture[2]!), order: 0 },
        place(fixture[2]!, intake, "content", 0),
        place(fixture[2]!, browser, "content", 1),
        place(browser, section, "states", 0),
        place(section, questionnaire, "content", 0),
        place(intake, intakeStep, "fields", 0),
        place(questionnaire, questionnaireStep, "fields", 0),
        place(questionnaire, submit, "actions", 0),
        place(intake, message, "messages", 0),
      ],
      validationIssues: [], createdAt: "2026-07-19T00:00:00.000Z", createdBy: "person-1",
    };
    const record: SystemBuilderRecord = {
      systemId: initial.systemId, targetWorkspaceId: initial.targetWorkspaceId, name: "Portal",
      status: "validated", revision: 1, currentRevisionId: initial.revisionId, composition: initial.composition,
      createdAt: initial.createdAt, updatedAt: initial.createdAt, createdBy: "person-1", updatedBy: "person-1",
    };
    const other = { ...record, systemId: normalizeSystemBuilderSystemId("alternate"), name: "Other portal" };
    let latest = initial;
    const saveRevision = vi.fn(async (input: Parameters<SystemBuilderClient["saveRevision"]>[0]) => {
      latest = { ...initial, revisionNumber: 2, composition: input.composition, instances: input.instances,
        placements: input.placements, bindings: input.bindings };
      return { ok: true as const, value: latest };
    });
    const listComposerAssets = vi.fn(async (input: ListSystemBuilderComposerAssetsQuery) => ({
      ok: true as const,
      value: { items: input.searchText ? catalog.filter((asset) => asset.definitionId === input.searchText) : catalog },
    }));
    const client: SystemBuilderClient = { ...clientFor(record, initial), saveRevision, listComposerAssets,
      list: async () => ({ ok: true, value: [record, other] }),
      readComposerAsset: async ({definitionRef}) => ({
        ok: true, value: catalog.find((item) => item.definitionRef.id === definitionRef.id && item.version === definitionRef.version)!,
      }),
      readRevision: async ({systemId}) => ({ ok: true, value: systemId === other.systemId ? { ...initial, systemId: other.systemId } : latest }) };
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    const mount = () => root!.render(<SystemBuilderWorkspace workspaceId="workspace-a" client={client} initialSystemId={String(record.systemId)} />);
    await act(async () => mount());
    const find = <T extends HTMLElement>(label: string, selector: string) => {
      const group = [...container!.querySelectorAll("label")].find((element) =>
        [...element.childNodes].filter((node) => node.nodeType === Node.TEXT_NODE)
          .map((node) => node.textContent ?? "").join("").trim() === label);
      const control = group?.querySelector<T>(selector);
      if (!control) throw new Error(`Missing ${label}`);
      return control;
    };
    const click = (name: string) => act(async () => button(container!, name).click());
    const fill = (label: string, value: string) => act(async () => setInputValue(find<HTMLInputElement>(label, "input"), value));
    const choose = (label: string, name: string) => act(async () => {
      const select = find<HTMLSelectElement>(label, "select");
      select.value = [...select.options].find((item) => item.text === name)!.value;
      select.dispatchEvent(new Event("change", { bubbles: true }));
    });
    const editButton = (name: string) => container!.querySelector<HTMLButtonElement>(`[aria-label="Edit Form: ${name}"]`)!;
    const expandStates = () => act(async () => container!.querySelector<HTMLButtonElement>('button[aria-expanded="false"][aria-controls$="-states-content"]')?.click());
    const editForm = async (name: string) => {
      if (name === "Questionnaire" && !editButton(name)) await expandStates();
      await act(async () => editButton(name).click());
    };
    await vi.waitFor(() => expect(editButton("Intake")).toBeTruthy());
    expect([...container!.querySelectorAll('[role="tab"]')].some((tab) => tab.textContent === "Form")).toBe(false);
    expect(container!.querySelectorAll("button[data-edit-form-id]")).toHaveLength(1);
    await expandStates();
    expect(container!.querySelectorAll("button[data-edit-form-id]")).toHaveLength(2);
    await editForm("Intake");
    expect(document.activeElement).toBe(button(container!, "Back to Canvas"));
    expect(container!.querySelector("h4")?.textContent).toBe("Intake");
    expect(container!.textContent).toContain("Canvas page Main page");
    await click("Form and control settings");
    await choose("Form asset", "Validation message");
    const messageInput = container!.querySelector<HTMLInputElement>('[aria-label="Form presentation"] input[id="message"]')!;
    expect(messageInput.value).toBe("Check your answers");
    await act(async () => setInputValue(messageInput, "Check the request details"));
    await click("Form and control settings");
    await fill("New form page name", "Details");
    await click("Add form page");
    await choose("Form page", "Details");
    await click("Add field");
    await act(async () => {
      const label = find<HTMLInputElement>("Field label", "input");
      label.focus();
      label.value = "Request reason";
      label.blur();
    });
    await act(async () => find<HTMLInputElement>("Required answer", "input").click());
    expect(listComposerAssets).toHaveBeenCalledWith(expect.objectContaining({
      workspaceId: "workspace-a", slotId: "fields", compatibleOnly: true, searchText: "builtin.form.text-field",
    }));
    await click("Back to Canvas");
    expect(document.activeElement).toBe(editButton("Intake"));
    const canvas = container!.querySelector(".system-composer__canvas")!;
    const pages = [...canvas.querySelectorAll('.system-composer__canvas-node[data-layout-container="true"]')]
      .filter((item) => item.querySelector(":scope > .system-composer__canvas-node-heading small")?.textContent?.includes("builtin.layout.page.single@"));
    expect(pages.map((item) => item.querySelector(":scope > .system-composer__canvas-node-heading strong")?.textContent))
      .toEqual(["Main page"]);
    expect(editButton("Intake").closest("article")?.textContent).toContain("Request reason");
    await expandStates();
    expect(editButton("Questionnaire").closest("article")?.textContent).not.toContain("Request reason");
    await editForm("Intake");
    await choose("Form page", "Details");
    expect(find<HTMLInputElement>("Required answer", "input").checked).toBe(true);
    await click("Undo");
    expect(find<HTMLInputElement>("Required answer", "input").checked).toBe(false);
    await click("Redo");
    expect(find<HTMLInputElement>("Required answer", "input").checked).toBe(true);
    await choose("Form page", "First step");
    await choose("Field type", "Checkbox");
    await click("Add field");
    await act(async () => {
      const label = find<HTMLInputElement>("Field label", "input");
      label.focus();
      label.value = "Fast path";
      label.blur();
    });
    await choose("Answer field", "Fast path");
    await choose("Default route", "Details");
    await choose("Compare with", "Selected");
    await choose("Go to form page", "Finish form");
    await click("Add route rule");
    expect(container!.textContent).toContain("When Fast path is selected, go to Finish form.");
    await act(async () => [...container!.querySelectorAll("summary")].find((item) => item.textContent === "After submission")!.click());
    expect([...find<HTMLSelectElement>("Record action", "select").options].map((item) => item.text))
      .toEqual(["Choose an action", "Create Request (Request)"]);
    await choose("Record action", "Create Request (Request)");
    await choose("Form answer to send", "Request reason");
    expect([...find<HTMLSelectElement>("Destination record field", "select").options].map((item) => item.text))
      .toEqual(["Choose a field", "Reason"]);
    await choose("Destination record field", "Reason");
    await click("Add mapping");
    await click("Set submission action");
    const previewButton = button(container!, "Preview form");
    await act(async () => { previewButton.focus(); previewButton.click(); });
    const preview = document.querySelector('[role="dialog"]')!;
    const press = (name: string) => act(async () => button(preview, name).click());
    await press("Next page");
    const answer = preview.querySelector<HTMLInputElement>('input[type="text"]')!;
    await press("Finish preview");
    expect(answer.getAttribute("aria-invalid")).toBe("true");
    expect(document.activeElement).toBe(answer);
    await act(async () => setInputValue(answer, "Sample answer"));
    await press("Back");
    await act(async () => preview.querySelector<HTMLInputElement>('input[type="checkbox"]')!.click());
    await press("Finish preview");
    expect(preview.textContent).toContain("Answers included: Fast path.");
    expect(preview.textContent).toContain("Configured action: Create Record. Preview did not run the action.");
    expect(preview.textContent).not.toContain("Request reason");
    expect(saveRevision).not.toHaveBeenCalled();
    await act(async () => preview.querySelector<HTMLButtonElement>('[aria-label="Close preview"]')!.click());
    expect(document.activeElement).toBe(previewButton);
    await click("Back to Canvas");
    await editForm("Questionnaire");
    expect(container!.querySelector("h4")?.textContent).toBe("Questionnaire");
    await click("Form and control settings");
    expect([...find<HTMLSelectElement>("Form asset", "select").options].map((option) => option.textContent))
      .toEqual(["Questionnaire", "First step", "Submit button"]);
    await choose("Form asset", "Submit button");
    const controlLabel = container!.querySelector<HTMLInputElement>('[aria-label="Form presentation"] input[id="label"]')!;
    expect(controlLabel.value).toBe("Send");
    await act(async () => setInputValue(controlLabel, "Send questionnaire"));
    await choose("Field type", "Choice");
    await click("Add field");
    await fill("New option label", "Hardware");
    await fill("Submitted value (optional)", "hardware");
    await click("Add option");
    await fill("New option label", "Software");
    await click("Add option");
    await choose("Field type", "Number");
    await click("Add field");
    await choose("Field", "Number Field");
    const fillBound = (label: string, value: string) => act(async () => {
      const bound = find<HTMLInputElement>(label, "input");
      bound.focus(); bound.value = value; bound.blur();
    });
    await fillBound("Minimum value", "1");
    await fillBound("Maximum value", "10");
    await choose("Field type", "Radio buttons");
    await click("Add field");
    await choose("Field", "Radio buttons");
    await fill("New option label", "By email");
    await click("Add option");
    await click("Preview form");
    const questionnairePreview = document.querySelector('[role="dialog"]')!;
    const numberAnswer = questionnairePreview.querySelector<HTMLInputElement>('input[type="number"]')!;
    await act(async () => setInputValue(numberAnswer, "5"));
    // A browser number control can expose empty value with an incomplete native edit.
    Object.defineProperty(numberAnswer, "validity", { configurable: true, value: { badInput: true } });
    await act(async () => setInputValue(numberAnswer, ""));
    await act(async () => button(questionnairePreview, "Finish preview").click());
    expect(numberAnswer.getAttribute("aria-invalid")).toBe("true");
    expect(questionnairePreview.textContent).toContain("Enter a number.");
    Object.defineProperty(numberAnswer, "validity", { configurable: true, value: { badInput: false } });
    await act(async () => setInputValue(numberAnswer, ""));
    const radio = questionnairePreview.querySelector<HTMLInputElement>('input[type="radio"][value="By email"]')!;
    await act(async () => radio.click());
    await act(async () => button(questionnairePreview, "Clear selection").click());
    expect(radio.checked).toBe(false);
    expect(document.activeElement).toBe(radio);
    await act(async () => radio.click());
    await act(async () => button(questionnairePreview, "Finish preview").click());
    expect(questionnairePreview.textContent).toContain("Answers included: Radio buttons.");
    await act(async () => questionnairePreview.querySelector<HTMLButtonElement>('[aria-label="Close preview"]')!.click());
    await click("Save and validate revision");
    await vi.waitFor(() => expect(saveRevision).toHaveBeenCalledTimes(1));
    expect(latest.bindings).toHaveLength(3);
    const action = latest.bindings.map(readSystemFormAction).find(Boolean);
    expect(action?.operationId).toBe("fixture.operation");
    expect(action?.mappings).toEqual([{ fieldId: latest.instances.find((item) => item.displayName === "Request reason")?.instanceId, recordField: "reason" }]);
    expect(latest.instances.find((item) => item.displayName === "Number Field")?.selectedConfiguration)
      .toEqual({ label: "Number Field", minimum: 1, maximum: 10 });
    expect(latest.instances.find((item) => item.instanceId === submit.instanceId)?.selectedConfiguration)
      .toEqual({ label: "Send questionnaire" });
    expect(latest.instances.find((item) => item.instanceId === message.instanceId)?.selectedConfiguration)
      .toEqual({ message: "Check the request details" });
    expect(latest.instances.find((item) => item.displayName === "Choice")?.selectedConfiguration?.staticOptions)
      .toEqual([expect.objectContaining({ label: "Hardware", value: "hardware" }), expect.objectContaining({ label: "Software", value: "Software" })]);
    expect(latest.instances.find((item) => item.displayName === "Request reason")?.selectedConfiguration)
      .toEqual({ label: "Request reason", required: true });
    // Simulate reopening a revision with a direct field placed from Canvas between the steps.
    const details = latest.instances.find((item) => item.displayName === "Details")!;
    const detailsPlacement = latest.placements!.find((edge) => edge.childInstanceRef.id === details.instanceId)!;
    const canvasField = { ...instance("fixture.direct-field", textField.definitionId, "Canvas field", {}),
      definitionRef: textField.definitionRef };
    latest = { ...latest, composition: { ...latest.composition, instanceRefs: [...latest.composition.instanceRefs, ref(canvasField)] },
      instances: [...latest.instances, canvasField], placements: [
        ...latest.placements!.map((edge) => edge === detailsPlacement ? { ...edge, order: 2 } : edge),
        { ...detailsPlacement, placementId: "place.direct-field", order: 1, childInstanceRef: ref(canvasField) },
      ] };
    act(() => root!.unmount());
    root = createRoot(container);
    await act(async () => mount());
    await editForm("Intake");
    await choose("Form page", "Fields outside form pages");
    expect(find<HTMLInputElement>("Field label", "input").value).toBe("Canvas field");
    await choose("Form page", "Details");
    expect(find<HTMLInputElement>("Field label", "input").value).toBe("Request reason");
    expect(container!.textContent).toContain("Request reason → Reason");
    await click("Move form page up");
    expect([...find<HTMLSelectElement>("Form page", "select").options].map((item) => item.text)).toEqual(["Details", "First step", "Fields outside form pages"]);
    await click("Save and validate revision");
    await vi.waitFor(() => expect(saveRevision).toHaveBeenCalledTimes(2));
    expect(latest.placements!.find((edge) => edge.childInstanceRef.id === canvasField.instanceId)?.order).toBe(1);
    expect(latest.placements!.find((edge) => edge.childInstanceRef.id === intake.instanceId)?.parentInstanceRef.id).toBe("fixture.page");
    expect(latest.placements!.find((edge) => edge.childInstanceRef.id === questionnaire.instanceId)?.parentInstanceRef.id).toBe(section.instanceId);
    await click("Back to Canvas");
    await editForm("Questionnaire");
    await choose("Field", "Number Field");
    expect(find<HTMLInputElement>("Maximum value", "input").value).toBe("10");
    await click("Back to Canvas");
    expect(document.activeElement).toBe(editButton("Questionnaire"));
    expect(editButton("Questionnaire").closest('[data-slot-id="states"]')?.getAttribute("data-collapsed")).toBe("false");
    await click("Connections");
    await choose("System", "Other portal");
    await click("Edit system");
    expect(button(container!, "Design").getAttribute("aria-selected")).toBe("true");
  });

  it("reopens the saved empty first form from Manage without adding a field or saving", async () => {
    const rootDefinition = composerDefinition("builtin.system.system", "System root", ["application-shell"], false, "3.0.0");
    const page = { ...composerDefinition("builtin.layout.page.single", "Page", ["content"], false, "3.0.0"),
      layoutRole: "page-layout" as const, assetType: "page" as const };
    const baseShell = layoutDefinition("builtin.layout.application.minimal", "Minimal", ["content"], "3.0.0");
    const shell = { ...baseShell, slots: baseShell.slots.map((slot) => ({ ...slot, acceptedDefinitionRefs: [page.definitionRef] })) };
    const form = composerDefinition("builtin.form.form", "Form", ["fields"], true, "3.0.0");
    const formPage = composerDefinition("builtin.form.field-group", "Field Group", ["fields"], true, "3.0.0");
    const section = composerDefinition("builtin.ui.section", "Section", ["content"], false, "3.0.0");
    const catalog = [rootDefinition, page, shell, form, formPage, section];
    const initialAssets = [rootDefinition, shell, page, section, form, formPage].map((item, index) => ({
      ...instance(`new.instance.${index}`, item.definitionId, index === 4 ? "Survey" : index === 5 ? "Page 1" : item.displayName,
        index === 4 ? { title: "Survey" } : index === 5 ? { title: "Page 1" } : {}), definitionRef: item.definitionRef,
    }));
    const ref = (item: AssetInstance) => ({ kind: "asset-instance" as const, id: normalizeAssetId(item.instanceId) });
    const refs = initialAssets.map(ref);
    const initial: SystemBuilderRevision = {
      revisionId: normalizeSystemBuilderRevisionId("new.r1"), systemId: normalizeSystemBuilderSystemId("new"),
      targetWorkspaceId: createWorkspaceId("workspace-a"), revisionNumber: 1,
      composition: { compositionId: normalizeAssetId("new.composition"), compositionType: "system", displayName: "Survey",
        version: "0.1.0", lifecycleStatus: "draft", rootInstanceRefs: [refs[0]!], instanceRefs: refs, bindingRefs: [],
        provenance: { sourceKind: "human-authored" }, metadata: { [SYSTEM_BUILDER_DEFAULT_FORM_METADATA_KEY]: refs[4]!.id } },
      instances: initialAssets, bindings: [],
      structure: { schemaVersion: "system-builder-structure.v1", profile: "interactive", layoutPresetRef: shell.definitionRef },
      placements: ["application-shell", "content", "content", "content", "fields"].map((slot, index) => ({
        schemaVersion: "asset-placement.v1", placementId: `place.${index}`, slotId: normalizeAssetSlotId(slot),
        parentInstanceRef: refs[index]!, childInstanceRef: refs[index + 1]!, order: 0,
      })),
      validationIssues: [], createdAt: "2026-07-19T00:00:00.000Z", createdBy: "person-1",
    };
    const record: SystemBuilderRecord = {
      systemId: initial.systemId, targetWorkspaceId: initial.targetWorkspaceId, name: "Survey", status: "validated",
      revision: 1, currentRevisionId: initial.revisionId, composition: initial.composition,
      createdAt: initial.createdAt, updatedAt: initial.createdAt, createdBy: "person-1", updatedBy: "person-1",
    };
    let created = false;
    let savedRevision = initial;
    const create = vi.fn(async (_input: Parameters<SystemBuilderClient["create"]>[0]) => {
      created = true;
      return { ok: true as const, value: record };
    });
    const saveRevision = vi.fn(async () => { throw new Error("The empty first form should already be saved."); });
    const client: SystemBuilderClient = { ...clientFor(record, initial), create, saveRevision,
      list: async () => ({ ok: true, value: created ? [record] : [] }),
      readRevision: async () => ({ ok: true, value: savedRevision }),
      listManagement: async () => ({ ok: true, value: {
        items: created ? [{ systemId: record.systemId, name: record.name, designStatus: record.status,
          archived: false, publicationStatus: "unpublished", recordRevision: 1, currentRevisionId: initial.revisionId,
          assetCount: initialAssets.length, releaseCount: 0, createdAt: record.createdAt, updatedAt: record.updatedAt,
          actions: { canPreview: true, canOpenInCompose: true, canDelete: true, canRestore: false, deleteStrategy: "archive" } }] : [],
        totalCount: created ? 1 : 0, query: { view: "active", sort: "updated-desc", limit: 20 },
      } }),
      listComposerAssets: async (query) => ({ ok: true, value: { items: catalog.filter((item) =>
        !query.searchText || item.definitionId === query.searchText)
        .map((item) => ({ ...item, compatibility: { status: "not-evaluated" as const } })) } }),
    };
    function Systems() {
      const [manage, setManage] = useState(false);
      const [systemId, setSystemId] = useState<string>();
      return <NotificationTestHarness>
        <button onClick={() => setManage(true)}>Manage</button>
        {manage ? <SystemManagementWorkspace workspaceId="workspace-a" client={client}
          onOpenInCompose={(id) => { setSystemId(id); setManage(false); }} /> :
          <SystemBuilderWorkspace workspaceId="workspace-a" client={client} initialSystemId={systemId} />}
      </NotificationTestHarness>;
    }
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    await act(async () => root!.render(<Systems />));
    const click = (name: string) => act(async () => button(container!, name).click());
    await act(async () => setInputValue(container!.querySelector<HTMLInputElement>('input[placeholder="Customer portal"]')!, "Survey"));
    await click("Create form system");
    expect(create).toHaveBeenCalledTimes(1);
    expect(create).toHaveBeenCalledWith({ workspaceId: "workspace-a", name: "Survey", profile: "interactive", starter: "form" });
    expect(container.querySelector("h4")?.textContent).toBe("Survey");
    await click("Manage");
    await click("Open in Compose");
    expect(container.querySelector("h4")?.textContent).toBe("Survey");
    expect(container.querySelector('[aria-label="Form pages"] select option:checked')?.textContent).toBe("Page 1");
    expect(container.textContent).toContain("Canvas page Page");
    expect(saveRevision).not.toHaveBeenCalled();
    await click("Back to Canvas");
    expect(container.querySelector<HTMLButtonElement>("button[data-edit-form-id]")?.dataset.editFormId).toBe(refs[4]!.id);
    expect(container.querySelectorAll('[data-instance-id="new.instance.2"]')).toHaveLength(1);
    expect([...container.querySelectorAll('[aria-label="Composer mode"] [role="tab"]')].map((item) => item.textContent)).toEqual(["Design", "Connections"]);

    // With no starter preference (or a stale one), embedded forms stay on Canvas.
    for (const metadata of [undefined, { [SYSTEM_BUILDER_DEFAULT_FORM_METADATA_KEY]: "removed-form" }]) {
      savedRevision = { ...initial, composition: { ...initial.composition, metadata } };
      await click("Manage");
      await click("Open in Compose");
      expect(container.querySelector('[aria-label="Form pages"]')).toBeNull();
      expect(container.querySelector("button[data-edit-form-id]")).not.toBeNull();
    }
    expect(saveRevision).not.toHaveBeenCalled();
  });

  it("defers the layout catalog until Create system is submitted and then shows the loading wheel", async () => {
    const pendingCatalog = new Promise<never>(() => undefined);
    const listComposerAssets = vi.fn(() => pendingCatalog);
    const client = {
      ...clientFor({} as SystemBuilderRecord, {} as SystemBuilderRevision),
      list: async () => ({ ok: true as const, value: [] }),
      listComposerAssets,
    } as SystemBuilderClient;

    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    await act(async () => {
      root?.render(
        <SystemBuilderWorkspace workspaceId="workspace-a" client={client} />,
      );
    });

    expect(listComposerAssets).not.toHaveBeenCalled();
    expect(
      container.querySelector(
        '.ui-loading-spinner[aria-label="Loading application layouts"]',
      ),
    ).toBeNull();

    const nameInput = container.querySelector<HTMLInputElement>(
      '.system-builder__entry-option--new input[placeholder="Customer portal"]',
    );
    expect(nameInput).not.toBeNull();
    await act(async () => {
      if (nameInput) setInputValue(nameInput, "New system");
    });
    await act(async () => button(container!, "Create system").click());

    await vi.waitFor(() => expect(listComposerAssets).toHaveBeenCalledOnce());
    expect(
      container.querySelector(
        '.ui-loading-spinner[aria-label="Loading application layouts"]',
      ),
    ).not.toBeNull();
    expect(container.textContent).toContain("Preparing system...");
  });

  it("requests active systems and defensively omits archived records from Compose", async () => {
    const activeSystem = {
      systemId: "system.active",
      name: "Active system",
      status: "draft",
    } as SystemBuilderRecord;
    const archivedSystem = {
      systemId: "system.archived",
      name: "Archived system",
      status: "archived",
    } as SystemBuilderRecord;
    const list = vi.fn(async () => ({
      ok: true as const,
      value: [archivedSystem, activeSystem],
    }));
    const pendingRead = new Promise<never>(() => undefined);
    const readRevision = vi.fn(() => pendingRead);
    const listRevisions = vi.fn(() => pendingRead);
    const client = {
      ...clientFor(activeSystem, {} as SystemBuilderRevision),
      list,
      readRevision,
      listRevisions,
    } as SystemBuilderClient;

    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    await act(async () => {
      root?.render(
        <SystemBuilderWorkspace workspaceId="workspace-a" client={client} />,
      );
    });

    await vi.waitFor(() =>
      expect(list).toHaveBeenCalledWith({
        workspaceId: "workspace-a",
        includeArchived: false,
      }),
    );
    const systemSelect = container.querySelector<HTMLSelectElement>(
      ".system-builder__entry-option--existing select",
    );
    expect(
      Array.from(systemSelect?.options ?? []).map((option) => option.text),
    ).toEqual(["Choose a system", "Active system"]);
    expect(systemSelect?.value).toBe("");
    const existingOption = container.querySelector(
      ".system-builder__entry-option--existing",
    );
    expect(existingOption).not.toBeNull();
    expect(
      Array.from(
        existingOption?.querySelectorAll<HTMLButtonElement>("button") ?? [],
      ).map((candidate) => candidate.textContent),
    ).toEqual(["Edit system"]);
    expect(container.querySelector(".system-composer__workspace")).toBeNull();
    expect(container.querySelector(".system-builder__status")).toBeNull();
    expect(
      container.querySelector("#system-builder-entry-instructions")
        ?.textContent,
    ).toBe("Choose an option below to interact with the System Composer.");
    expect(
      container.querySelector(
        '.system-builder__entry-option--new select[aria-label="New system layout"]',
      ),
    ).toBeNull();
    const templateButton = button(container, "Create from template");
    expect(templateButton.classList.contains("ui-button--outline")).toBe(false);
    expect(templateButton.disabled).toBe(true);
    expect(
      Array.from(
        container.querySelectorAll<HTMLLegendElement>(
          ".system-builder__entry-options legend",
        ),
      ).map((legend) => legend.textContent),
    ).toEqual([
      "1. Edit an existing system",
      "2. Create a new system",
      "3. Create from a template",
    ]);

    await act(async () => {
      if (!systemSelect) return;
      systemSelect.value = "system.active";
      systemSelect.dispatchEvent(new Event("change", { bubbles: true }));
    });
    expect(readRevision).not.toHaveBeenCalled();
    expect(container.querySelector(".system-composer__workspace")).toBeNull();

    await act(async () => button(existingOption!, "Edit system").click());
    await vi.waitFor(() => expect(readRevision).toHaveBeenCalledOnce());
    expect(button(existingOption!, "Loading system...").disabled).toBe(true);
    expect(container.querySelector(".system-composer__workspace")).toBeNull();
  });

  it("refreshes the active picker after a Manage lifecycle change", async () => {
    const activeSystem = {
      systemId: "system.active",
      name: "Active system",
      status: "draft",
    } as SystemBuilderRecord;
    const list = vi
      .fn()
      .mockResolvedValueOnce({ ok: true as const, value: [activeSystem] })
      .mockResolvedValueOnce({ ok: true as const, value: [] });
    const client = {
      ...clientFor(activeSystem, {} as SystemBuilderRevision),
      list,
    } as SystemBuilderClient;

    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    await act(async () => {
      root?.render(
        <SystemBuilderWorkspace
          workspaceId="workspace-a"
          client={client}
          activeSystemsRevision={0}
        />,
      );
    });

    const systemSelect = await vi.waitFor(() => {
      const select = container?.querySelector<HTMLSelectElement>(
        ".system-builder__entry-option--existing select",
      );
      expect(
        Array.from(select?.options ?? []).map((option) => option.text),
      ).toEqual(["Choose a system", "Active system"]);
      return select!;
    });
    await act(async () => {
      systemSelect.value = "system.active";
      systemSelect.dispatchEvent(new Event("change", { bubbles: true }));
    });

    await act(async () => {
      root?.render(
        <SystemBuilderWorkspace
          workspaceId="workspace-a"
          client={client}
          activeSystemsRevision={1}
        />,
      );
    });

    await vi.waitFor(() =>
      expect(
        Array.from(systemSelect.options).map((option) => option.text),
      ).toEqual(["Choose a system"]),
    );
    expect(systemSelect.value).toBe("");
    expect(list).toHaveBeenCalledTimes(2);
  });

  it("creates a named system with the implicit Minimal layout", async () => {
    const minimal = layoutDefinition(
      "builtin.layout.application.minimal",
      "Minimal",
      ["content"],
    );
    const created = {
      systemId: "system.created",
      name: "New system",
      status: "draft",
    } as SystemBuilderRecord;
    const create = vi.fn(async () => ({ ok: true as const, value: created }));
    const pendingRead = new Promise<never>(() => undefined);
    const client = {
      ...clientFor(created, {} as SystemBuilderRevision),
      list: async () => ({ ok: true as const, value: [] }),
      listComposerAssets: async () => ({
        ok: true as const,
        value: { items: [minimal] },
      }),
      create,
      readRevision: () => pendingRead,
      listRevisions: () => pendingRead,
    } as SystemBuilderClient;

    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    await act(async () => {
      root?.render(
        <SystemBuilderWorkspace workspaceId="workspace-a" client={client} />,
      );
    });

    const nameInput = container.querySelector<HTMLInputElement>(
      '.system-builder__entry-option--new input[placeholder="Customer portal"]',
    );
    await act(async () => {
      if (nameInput) setInputValue(nameInput, "New system");
    });
    await act(async () => button(container!, "Create system").click());

    await vi.waitFor(() =>
      expect(create).toHaveBeenCalledWith({
        workspaceId: "workspace-a",
        name: "New system",
        profile: "interactive",
        layoutPresetRef: minimal.definitionRef,
      }),
    );
  });

  it("requires a name and uses the primary action when creating from a template", async () => {
    const template = {
      templateId: "reference.controlled-chatbot@1.0.0",
      displayName: "Controlled chatbot",
    } as SystemBuilderTemplateSummary;
    const created = {
      systemId: "system.template",
      name: "Support assistant",
      status: "validated",
    } as SystemBuilderRecord;
    const createFromTemplate = vi.fn(async () => ({
      ok: true as const,
      value: created,
    }));
    const pendingRead = new Promise<never>(() => undefined);
    const client = {
      ...clientFor(created, {} as SystemBuilderRevision),
      list: async () => ({ ok: true as const, value: [] }),
      listTemplates: async () => ({ ok: true as const, value: [template] }),
      createFromTemplate,
      readRevision: () => pendingRead,
      listRevisions: () => pendingRead,
    } as SystemBuilderClient;

    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    await act(async () => {
      root?.render(
        <SystemBuilderWorkspace workspaceId="workspace-a" client={client} />,
      );
    });

    const createButton = await vi.waitFor(() =>
      button(container!, "Create from template"),
    );
    expect(createButton.disabled).toBe(true);
    expect(createButton.classList.contains("ui-button--outline")).toBe(false);
    const nameInput = container.querySelector<HTMLInputElement>(
      '.system-builder__entry-option--reference input[placeholder="Use template name"]',
    );
    await act(async () => {
      if (nameInput) setInputValue(nameInput, "Support assistant");
    });
    expect(createButton.disabled).toBe(false);
    await act(async () => createButton.click());

    await vi.waitFor(() =>
      expect(createFromTemplate).toHaveBeenCalledWith({
        workspaceId: "workspace-a",
        templateId: template.templateId,
        name: "Support assistant",
      }),
    );
  });

  it("prefers the nested page content region over an already-full application content region", () => {
    const currentInstance = (
      instanceId: string,
      definitionId: string,
      displayName: string,
    ) =>
      ({
        ...instance(instanceId, definitionId, displayName, {}),
        definitionRef: {
          kind: "asset-definition-version",
          id: definitionId,
          version: "2.0.0",
        },
      }) as AssetInstance;
    const systemRoot = currentInstance(
      "system.root",
      "builtin.system.system",
      "System root",
    );
    const shell = currentInstance(
      "system.shell",
      "builtin.layout.application.standard",
      "Application shell",
    );
    const page = currentInstance(
      "system.page",
      "builtin.layout.page.single",
      "Page",
    );
    const systemDefinition = composerDefinition(
      "builtin.system.system",
      "System root",
      ["application-shell"],
    );
    const shellDefinition = layoutDefinition(
      "builtin.layout.application.standard",
      "Standard",
      ["content"],
    );
    const pageDefinition = {
      ...composerDefinition("builtin.layout.page.single", "Single content", [
        "content",
      ]),
      layoutRole: "page-layout" as const,
    };

    expect(
      preferredSystemComposerTarget({
        instances: [systemRoot, shell, page],
        placements: [
          {
            schemaVersion: "asset-placement.v1",
            placementId: "placement.root-shell",
            parentInstanceRef: {
              kind: "asset-instance",
              id: systemRoot.instanceId,
            },
            slotId: "application-shell",
            childInstanceRef: {
              kind: "asset-instance",
              id: shell.instanceId,
            },
            order: 0,
          },
          {
            schemaVersion: "asset-placement.v1",
            placementId: "placement.shell-page",
            parentInstanceRef: {
              kind: "asset-instance",
              id: shell.instanceId,
            },
            slotId: "content",
            childInstanceRef: {
              kind: "asset-instance",
              id: page.instanceId,
            },
            order: 0,
          },
        ],
        catalog: [systemDefinition, shellDefinition, pageDefinition],
        activeLayoutDefinitionId: shellDefinition.definitionId,
        selectedInstanceId: systemRoot.instanceId,
      }),
    ).toEqual({
      parentInstanceId: page.instanceId,
      slotId: "content",
    });
  });

  it("loads layouts on demand, applies one to the Canvas, exposes unassigned assets in the scoped modal, and undoes", async () => {
    const rootInstance = {
      ...instance("system-1.root", "builtin.system.system", "System root", {}),
      definitionRef: {
        kind: "asset-definition-version",
        id: "builtin.system.system",
        version: "3.0.0",
      },
    } as AssetInstance;
    const shellInstance = {
      ...instance(
        "system-1.shell",
        "builtin.layout.application.standard",
        "Standard shell",
        {},
      ),
      definitionRef: {
        kind: "asset-definition-version",
        id: "builtin.layout.application.standard",
        version: "3.0.0",
      },
    } as AssetInstance;
    const extraInstance = {
      ...instance(
        "system-1.top",
        "builtin.state.empty-state",
        "Preserved top bar",
        {},
      ),
      definitionRef: {
        kind: "asset-definition-version",
        id: "builtin.state.empty-state",
        version: "3.0.0",
      },
    } as AssetInstance;
    const standard = layoutDefinition(
      "builtin.layout.application.standard",
      "Standard",
      ["top-bar", "content"],
      "3.0.0",
    );
    const minimal = layoutDefinition(
      "builtin.layout.application.minimal",
      "Minimal",
      ["content"],
      "3.0.0",
    );
    const structure = {
      schemaVersion: "system-builder-structure.v1",
      profile: "interactive",
      layoutPresetRef: shellInstance.definitionRef,
    } as const;
    const rootShellPlacement = {
      schemaVersion: "asset-placement.v1",
      placementId: "placement.root-shell",
      parentInstanceRef: {
        kind: "asset-instance",
        id: rootInstance.instanceId,
      },
      slotId: "application-shell",
      childInstanceRef: {
        kind: "asset-instance",
        id: shellInstance.instanceId,
      },
      order: 0,
    } as const;
    const topPlacement = {
      schemaVersion: "asset-placement.v1",
      placementId: "placement.shell-top",
      parentInstanceRef: {
        kind: "asset-instance",
        id: shellInstance.instanceId,
      },
      slotId: "top-bar",
      childInstanceRef: {
        kind: "asset-instance",
        id: extraInstance.instanceId,
      },
      order: 0,
    } as const;
    const revision = {
      revisionId: "system-revision-layout-1",
      systemId: "system-1",
      targetWorkspaceId: "workspace-a",
      revisionNumber: 1,
      composition: {
        compositionId: "system-1.composition",
        compositionType: "system",
        displayName: "Portal",
        version: "0.1.0",
        lifecycleStatus: "draft",
        rootInstanceRefs: [
          { kind: "asset-instance", id: rootInstance.instanceId },
        ],
        instanceRefs: [rootInstance, shellInstance, extraInstance].map(
          (item) => ({ kind: "asset-instance", id: item.instanceId }),
        ),
        bindingRefs: [],
        provenance: { sourceKind: "human-authored" },
      },
      instances: [rootInstance, shellInstance, extraInstance],
      bindings: [],
      structure,
      placements: [rootShellPlacement, topPlacement],
      validationIssues: [],
      createdAt: "2026-07-19T00:00:00.000Z",
      createdBy: "person-1",
    } as SystemBuilderRevision;
    const record = {
      systemId: "system-1",
      targetWorkspaceId: "workspace-a",
      name: "Portal",
      status: "validated",
      revision: 1,
      currentRevisionId: revision.revisionId,
      composition: revision.composition,
      createdAt: revision.createdAt,
      updatedAt: revision.createdAt,
      createdBy: "person-1",
      updatedBy: "person-1",
    } as SystemBuilderRecord;
    const targetStructure = {
      ...structure,
      layoutPresetRef: minimal.definitionRef,
    };
    const targetInstances = revision.instances.map((item) =>
      String(item.instanceId) === String(shellInstance.instanceId)
        ? { ...item, definitionRef: minimal.definitionRef }
        : item,
    );
    const previewLayoutChange = vi.fn(async () => ({
      ok: true as const,
      value: {
        sourceLayoutPresetRef: standard.definitionRef,
        targetLayoutPresetRef: minimal.definitionRef,
        composition: revision.composition,
        structure: targetStructure,
        instances: targetInstances,
        bindings: [],
        placements: [rootShellPlacement],
        changes: [
          {
            instanceRef: {
              kind: "asset-instance",
              id: extraInstance.instanceId,
            },
            disposition: "unassigned" as const,
            fromSlotId: "top-bar",
          },
        ],
        unassignedInstanceRefs: [
          { kind: "asset-instance", id: extraInstance.instanceId },
        ],
        validationIssues: [
          {
            severity: "error" as const,
            category: "composition" as const,
            message: "Every non-root instance must have a placement parent.",
          },
        ],
      },
    }));
    const onBuildAndTest = vi.fn();
    const client = {
      ...clientFor(record, revision),
      previewLayoutChange,
      listComposerAssets: async (
        input: ListSystemBuilderComposerAssetsQuery,
      ) => {
        if (input.parentDefinitionRef) {
          return {
            ok: true as const,
            value: {
              items: [
                composerDefinition(
                  "builtin.state.empty-state",
                  "Empty state",
                  [],
                  false,
                  "3.0.0",
                ),
              ],
            },
          };
        }
        if (input.searchText === "builtin.layout.application") {
          return {
            ok: true as const,
            value: { items: [standard, minimal] },
          };
        }
        if (input.cursor === "composer-page-2") {
          return {
            ok: true as const,
            value: {
              items: [
                composerDefinition(
                  "builtin.state.empty-state",
                  "Empty state",
                  [],
                  false,
                  "3.0.0",
                ),
              ],
            },
          };
        }
        return {
          ok: true as const,
          value: {
            items: [
              composerDefinition("builtin.system.system", "System root", [
                "application-shell",
              ], false, "3.0.0"),
            ],
            nextCursor: "composer-page-2",
          },
        };
      },
    } as SystemBuilderClient;

    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    await act(async () => {
      root?.render(
        <SystemBuilderWorkspace
          workspaceId="workspace-a"
          client={client}
          initialSystemId={String(record.systemId)}
          onBuildAndTest={onBuildAndTest}
        />,
      );
    });

    const expandLayout = await vi.waitFor(() => {
      const current = container!.querySelector<HTMLButtonElement>(
        'button[aria-label="Show layouts"]',
      );
      expect(current).not.toBeNull();
      return current!;
    });
    await act(async () => expandLayout.click());

    const minimalChoice = await vi.waitFor(() => {
      const current = container!.querySelector<HTMLInputElement>(
        'input[value="builtin.layout.application.minimal"]',
      );
      expect(current).not.toBeNull();
      return current!;
    });
    expect(
      minimalChoice.closest(".system-composer__layout-bar")?.textContent,
    ).toContain("Layouts");
    const initialCanvas = container!.querySelector<HTMLElement>(
      ".system-composer__panel--canvas",
    )!;
    expect(initialCanvas.getAttribute("data-active-layout")).toBe(
      "builtin.layout.application.standard",
    );
    expect(
      Array.from(
        initialCanvas.querySelectorAll<HTMLElement>("[data-slot-id]"),
      ).map((slot) => slot.dataset.slotId),
    ).toEqual(["top-bar", "content"]);
    await act(async () => minimalChoice.click());
    await vi.waitFor(() => {
      expect(container!.textContent).toContain("Unsaved changes");
      expect(container!.textContent).not.toContain(
        "The Canvas updated automatically",
      );
      expect(container!.textContent).not.toContain(
        "available from Add element on a compatible container",
      );
    });
    await act(async () =>
      container
        .querySelector<HTMLButtonElement>(
          '[data-slot-id="content"] button[aria-label="Add element to Content in Standard shell" i]',
        )!
        .click(),
    );
    const assetDialog = await vi.waitFor(() => {
      const current =
        document.body.querySelector<HTMLElement>('[role="dialog"]');
      expect(current?.textContent).toContain("Preserved top bar");
      return current!;
    });
    expect(assetDialog.textContent).toContain("Unassigned visual assets");
    await act(async () =>
      assetDialog
        .querySelector<HTMLButtonElement>(
          'button[aria-label="Close asset selection"]',
        )!
        .click(),
    );
    const changedCanvas = container!.querySelector<HTMLElement>(
      ".system-composer__panel--canvas",
    )!;
    expect(changedCanvas.getAttribute("data-active-layout")).toBe(
      "builtin.layout.application.minimal",
    );
    expect(changedCanvas.textContent).not.toContain("Unassigned visual assets");
    expect(container!.textContent).not.toContain("Asset Palette");
    expect(previewLayoutChange).toHaveBeenCalledTimes(1);
    await act(async () => button(container, "Undo").click());
    await vi.waitFor(() => {
      expect(container!.textContent).not.toContain(
        "available from Add element on a compatible container",
      );
      expect(minimalChoice.checked).toBe(false);
    });
    await act(async () => button(container, "Build & test").click());
    expect(onBuildAndTest).toHaveBeenCalledWith(
      expect.objectContaining({
        system: expect.objectContaining({ systemId: "system-1" }),
        revision: expect.objectContaining({
          revisionId: "system-revision-layout-1",
        }),
      }),
    );
  });

  it("requires explicit Foundation upgrade before laying out a legacy Controlled Chatbot reference system", async () => {
    const legacyRoot = {
      ...instance(
        "chatbot-system.system",
        "builtin.system.system",
        "Controlled chatbot system",
        { title: "Controlled chatbot" },
      ),
      definitionRef: {
        kind: "asset-definition-version",
        id: "builtin.system.system",
        version: "1.0.0",
      },
      metadata: { referenceSystemKind: "controlled-chatbot" },
    } as AssetInstance;
    const authentication = {
      ...instance(
        "chatbot-system.authentication",
        "builtin.security.authentication-requirement",
        "Authentication required",
        { required: true },
      ),
      definitionRef: {
        kind: "asset-definition-version",
        id: "builtin.security.authentication-requirement",
        version: "1.0.0",
      },
    } as AssetInstance;
    const revision = {
      revisionId: "chatbot-system.r1",
      systemId: "chatbot-system",
      targetWorkspaceId: "workspace-a",
      revisionNumber: 1,
      composition: {
        compositionId: "chatbot-system.composition",
        compositionType: "system",
        displayName: "Controlled chatbot",
        version: "1.0.0",
        lifecycleStatus: "draft",
        rootInstanceRefs: [
          { kind: "asset-instance", id: legacyRoot.instanceId },
        ],
        instanceRefs: [legacyRoot, authentication].map((item) => ({
          kind: "asset-instance" as const,
          id: item.instanceId,
        })),
        bindingRefs: [],
        provenance: {
          sourceKind: "system-generated",
          metadata: {
            templateId: "reference.controlled-chatbot@1.0.0",
          },
        },
      },
      instances: [legacyRoot, authentication],
      bindings: [],
      validationIssues: [],
      createdAt: "2026-07-20T00:00:00.000Z",
      createdBy: "person-1",
    } as SystemBuilderRevision;
    const record = {
      systemId: revision.systemId,
      targetWorkspaceId: revision.targetWorkspaceId,
      name: revision.composition.displayName,
      status: "validated",
      revision: 1,
      currentRevisionId: revision.revisionId,
      composition: revision.composition,
      createdAt: revision.createdAt,
      updatedAt: revision.createdAt,
      createdBy: "person-1",
      updatedBy: "person-1",
    } as SystemBuilderRecord;
    const minimal = layoutDefinition(
      "builtin.layout.application.minimal",
      "Minimal",
      ["content"],
    );
    const currentRoot = {
      ...legacyRoot,
      definitionRef: {
        kind: "asset-definition-version",
        id: "builtin.system.system",
        version: "2.0.0",
      },
    } as AssetInstance;
    const currentAuthentication = {
      ...authentication,
      definitionRef: {
        ...authentication.definitionRef,
        version: "2.0.0",
      },
    } as AssetInstance;
    const shell = {
      ...instance("chatbot-system.shell", minimal.definitionId, "Minimal", {}),
      definitionRef: minimal.definitionRef,
    } as AssetInstance;
    const structure = {
      schemaVersion: "system-builder-structure.v1",
      profile: "interactive",
      layoutPresetRef: minimal.definitionRef,
    } as const;
    const rootShellPlacement = {
      schemaVersion: "asset-placement.v1",
      placementId: "chatbot-system.placement-1",
      parentInstanceRef: {
        kind: "asset-instance",
        id: currentRoot.instanceId,
      },
      slotId: "application-shell",
      childInstanceRef: { kind: "asset-instance", id: shell.instanceId },
      order: 0,
    } as const;
    const previewLayoutChange = vi.fn(async () => ({
      ok: true as const,
      value: {
        targetLayoutPresetRef: minimal.definitionRef,
        composition: {
          ...revision.composition,
          instanceRefs: [currentRoot, shell, currentAuthentication].map(
            (item) => ({
              kind: "asset-instance" as const,
              id: item.instanceId,
            }),
          ),
          placementRefs: [
            {
              kind: "asset-placement" as const,
              id: rootShellPlacement.placementId,
            },
          ],
        },
        structure,
        instances: [currentRoot, shell, currentAuthentication],
        bindings: [],
        placements: [rootShellPlacement],
        changes: [],
        unassignedInstanceRefs: [
          {
            kind: "asset-instance" as const,
            id: currentAuthentication.instanceId,
          },
        ],
        validationIssues: [],
      },
    }));
    const client = {
      ...clientFor(record, revision),
      previewLayoutChange,
      listComposerAssets: async (
        input: ListSystemBuilderComposerAssetsQuery,
      ) => ({
        ok: true as const,
        value: {
          items:
            input.searchText === "builtin.layout.application"
              ? [minimal]
              : [
                  composerDefinition("builtin.system.system", "System root", [
                    "application-shell",
                  ]),
                  {
                    ...composerDefinition(
                      "builtin.security.authentication-requirement",
                      "Authentication required",
                      [],
                    ),
                    assetType: "policy" as const,
                  },
                ],
        },
      }),
    } as SystemBuilderClient;

    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    await act(async () => {
      root?.render(
        <NotificationTestHarness>
          <SystemBuilderWorkspace
            workspaceId="workspace-a"
            client={client}
            initialSystemId={String(record.systemId)}
          />
        </NotificationTestHarness>,
      );
    });

    const upgradeButton = await vi.waitFor(() => {
      const current = button(container!, "Upgrade Foundation");
      expect(current.disabled).toBe(false);
      return current;
    });
    expect(upgradeButton).toBeDefined();
    expect(previewLayoutChange).not.toHaveBeenCalled();
    const canvas = container.querySelector<HTMLElement>(
      ".system-composer__panel--canvas",
    );
    expect(canvas?.getAttribute("data-active-layout")).toBeNull();
    expect(canvas?.querySelector("[data-slot-id]")).toBeNull();
  });

  it("opens and closes a modal for the current safe frontend composition", async () => {
    const visual = instance(
      "system-1.page",
      "builtin.shell.page",
      "Requests page",
      { title: "Configured requests" },
    );
    const policy = instance(
      "system-1.policy",
      "builtin.security.authorization-policy",
      "Read policy",
      {},
    );
    const revision = {
      revisionId: "system-revision-1",
      systemId: "system-1",
      targetWorkspaceId: "workspace-a",
      revisionNumber: 1,
      composition: {
        compositionId: "system-1.composition",
        compositionType: "system",
        displayName: "Requests",
        version: "0.1.0",
        lifecycleStatus: "draft",
        rootInstanceRefs: [{ kind: "asset-instance", id: visual.instanceId }],
        instanceRefs: [
          { kind: "asset-instance", id: visual.instanceId },
          { kind: "asset-instance", id: policy.instanceId },
        ],
        bindingRefs: [],
        provenance: { sourceKind: "human-authored" },
      },
      instances: [visual, policy],
      bindings: [],
      validationIssues: [],
      createdAt: "2026-07-18T00:00:00.000Z",
      createdBy: "person-1",
    } as SystemBuilderRevision;
    const record = {
      systemId: "system-1",
      targetWorkspaceId: "workspace-a",
      name: "Requests",
      status: "validated",
      revision: 1,
      currentRevisionId: revision.revisionId,
      composition: revision.composition,
      createdAt: "2026-07-18T00:00:00.000Z",
      updatedAt: "2026-07-18T00:00:00.000Z",
      createdBy: "person-1",
      updatedBy: "person-1",
    } as SystemBuilderRecord;
    const client = {
      ...clientFor(record, revision),
      listComposerAssets: async () => ({ ok: true as const, value: { items: [
        composerDefinition("builtin.shell.page", "Requests page", [], false, "1.0.0"),
        { ...composerDefinition("builtin.security.authorization-policy", "Read policy", [], false, "1.0.0"), assetType: "policy" as const },
      ] } }),
    };

    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    await act(async () => {
      root?.render(
        <SystemBuilderWorkspace
          workspaceId="workspace-a"
          client={client}
          initialSystemId={String(record.systemId)}
        />,
      );
    });

    const previewButton = await vi.waitFor(() => {
      const button = Array.from(container!.querySelectorAll("button")).find(
        (candidate) => candidate.textContent === "Preview UI",
      );
      expect(button).toBeDefined();
      expect(button?.disabled).toBe(false);
      return button!;
    });
    expect(
      container.querySelector(
        '.system-builder__entry-option--existing button[aria-haspopup="dialog"]',
      ),
    ).toBeNull();
    expect(
      previewButton
        .closest<HTMLElement>('[role="toolbar"]')
        ?.getAttribute("aria-label"),
    ).toBe("Loaded system actions");

    await act(async () => previewButton.click());
    const dialog = await vi.waitFor(() => {
      const current =
        document.body.querySelector<HTMLElement>('[role="dialog"]');
      expect(current).not.toBeNull();
      return current!;
    });
    expect(dialog.getAttribute("aria-modal")).toBe("true");
    expect(dialog.textContent).toContain("Requests UI preview");
    expect(dialog.textContent).toContain("Configured requests");
    expect(dialog.textContent).toContain("1 frontend surface");
    expect(dialog.textContent).toContain("1 unavailable");
    expect(dialog.textContent).toContain("does not execute backend logic");
    expect(dialog.textContent).not.toContain("Denied by default");
    const mobileViewport = Array.from(
      dialog.querySelectorAll<HTMLButtonElement>("button"),
    ).find((button) => button.textContent === "Mobile");
    expect(mobileViewport).toBeDefined();
    await act(async () => mobileViewport!.click());
    expect(dialog.querySelector('[data-viewport="mobile"]')).not.toBeNull();

    const closeButton = dialog.querySelector<HTMLButtonElement>(
      'button[aria-label="Close system UI preview"]',
    );
    expect(closeButton).not.toBeNull();
    await act(async () => closeButton!.click());
    expect(document.body.querySelector('[role="dialog"]')).toBeNull();
  });

  it("previews a v2 Foundation upgrade before explicit confirmation", async () => {
    const rootInstance = {
      ...instance("system-1.root", "builtin.system.system", "System root", {}),
      definitionRef: {
        kind: "asset-definition-version",
        id: "builtin.system.system",
        version: "2.0.0",
      },
    } as AssetInstance;
    const revision = {
      revisionId: "system-1.r1",
      systemId: "system-1",
      targetWorkspaceId: "workspace-a",
      revisionNumber: 1,
      composition: {
        compositionId: "system-1.composition",
        compositionType: "system",
        displayName: "Legacy assistant",
        version: "0.1.0",
        lifecycleStatus: "draft",
        rootInstanceRefs: [
          { kind: "asset-instance", id: rootInstance.instanceId },
        ],
        instanceRefs: [{ kind: "asset-instance", id: rootInstance.instanceId }],
        bindingRefs: [],
        provenance: { sourceKind: "human-authored" },
      },
      instances: [rootInstance],
      bindings: [],
      validationIssues: [],
      createdAt: "2026-07-18T00:00:00.000Z",
      createdBy: "person-1",
    } as SystemBuilderRevision;
    const record = {
      systemId: "system-1",
      targetWorkspaceId: "workspace-a",
      name: "Legacy assistant",
      status: "validated",
      revision: 1,
      currentRevisionId: revision.revisionId,
      composition: revision.composition,
      createdAt: "2026-07-18T00:00:00.000Z",
      updatedAt: "2026-07-18T00:00:00.000Z",
      createdBy: "person-1",
      updatedBy: "person-1",
    } as SystemBuilderRecord;
    const upgradedRoot = {
      ...rootInstance,
      definitionRef: { ...rootInstance.definitionRef, version: "3.0.0" },
    } as AssetInstance;
    const upgradedRevision = {
      ...revision,
      revisionId: "system-1.r2",
      revisionNumber: 2,
      instances: [upgradedRoot],
      createdAt: "2026-07-20T00:00:00.000Z",
    } as SystemBuilderRevision;
    const previewFoundationUpgrade = vi.fn(async () => ({
      ok: true as const,
      value: {
        sourceRevisionId: revision.revisionId,
        sourceVersion: "2.0.0" as const,
        targetVersion: "3.0.0" as const,
        eligible: true,
        mappedInstanceCount: 1,
        mappedConfigurationFieldCount: 0,
        issues: [],
        validationStatus: "valid" as const,
        validationIssues: [],
      },
    }));
    const upgradeFoundation = vi.fn(async () => ({
      ok: true as const,
      value: upgradedRevision,
    }));
    const client = {
      ...clientFor(record, revision),
      previewFoundationUpgrade,
      upgradeFoundation,
    } as SystemBuilderClient;

    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    await act(async () => {
      root?.render(
        <NotificationTestHarness>
          <SystemBuilderWorkspace
            workspaceId="workspace-a"
            client={client}
            initialSystemId={String(record.systemId)}
          />
        </NotificationTestHarness>,
      );
    });

    const upgradeButton = await vi.waitFor(() => {
      const current = button(container!, "Upgrade Foundation");
      expect(current.disabled).toBe(false);
      return current;
    });
    await act(async () => upgradeButton.click());
    expect(previewFoundationUpgrade).toHaveBeenCalledTimes(1);
    expect(upgradeFoundation).not.toHaveBeenCalled();

    const dialog = await vi.waitFor(() => {
      const current =
        document.body.querySelector<HTMLElement>('[role="dialog"]');
      expect(current?.textContent).toContain("Upgrade System Foundation");
      return current!;
    });
    expect(dialog.textContent).toContain(
      "The candidate maps without data loss and passes validation.",
    );
    await act(async () => button(dialog, "Create upgraded revision").click());
    expect(upgradeFoundation).toHaveBeenCalledTimes(1);
    expect(upgradeFoundation.mock.calls[0]?.[0]).toMatchObject({
      workspaceId: "workspace-a",
      systemId: "system-1",
      expectedRecordRevision: 1,
      sourceRevisionId: revision.revisionId,
    });
    await vi.waitFor(() => expect(readNotificationMessages(container!)).toContain("System Foundation upgraded to 3.0.0 in a new immutable revision."));
    expect(container?.textContent).not.toContain("System Foundation upgraded to 3.0.0 in a new immutable revision.");
    expect(document.body.querySelector('[role="dialog"]')).toBeNull();
  });

  it("preserves canonical structure and placements when saving configuration", async () => {
    const rootInstance = {
      ...instance("system-1.root", "builtin.system.system", "System root", {}),
      definitionRef: {
        kind: "asset-definition-version",
        id: "builtin.system.system",
        version: "3.0.0",
      },
      selectedConfiguration: {
        themeColorPrimary: "#2563eb",
        previewValue: "Legacy preview",
      },
    } as AssetInstance;
    const shellInstance = {
      ...instance(
        "system-1.shell",
        "builtin.layout.application.standard",
        "Standard shell",
        {
          title: "Portal",
          sampleUserMessage: "Legacy question",
          sampleAssistantMessage: "Legacy response",
        },
      ),
      definitionRef: {
        kind: "asset-definition-version",
        id: "builtin.layout.application.standard",
        version: "3.0.0",
      },
    } as AssetInstance;
    const inactiveHistoryInstance = {
      ...instance(
        "system-1.history",
        "conversation.chat-history",
        "Conversation history",
        {
          title: "Conversation",
          sampleUserMessage: "Legacy question",
          sampleAssistantMessage: "Legacy response",
        },
      ),
      definitionRef: {
        kind: "asset-definition-version",
        id: "conversation.chat-history",
        version: "1.0.0",
      },
    } as AssetInstance;
    const structure = {
      schemaVersion: "system-builder-structure.v1",
      profile: "interactive",
      layoutPresetRef: shellInstance.definitionRef,
    } as const;
    const placements = [
      {
        schemaVersion: "asset-placement.v1",
        placementId: "placement.root-shell",
        parentInstanceRef: {
          kind: "asset-instance",
          id: rootInstance.instanceId,
        },
        slotId: "application-shell",
        childInstanceRef: {
          kind: "asset-instance",
          id: shellInstance.instanceId,
        },
        order: 0,
      },
    ] as const;
    const revision = {
      revisionId: "system-revision-1",
      systemId: "system-1",
      targetWorkspaceId: "workspace-a",
      revisionNumber: 1,
      composition: {
        compositionId: "system-1.composition",
        compositionType: "system",
        displayName: "Portal",
        version: "0.1.0",
        lifecycleStatus: "draft",
        rootInstanceRefs: [
          { kind: "asset-instance", id: rootInstance.instanceId },
        ],
        instanceRefs: [
          { kind: "asset-instance", id: rootInstance.instanceId },
          { kind: "asset-instance", id: shellInstance.instanceId },
          { kind: "asset-instance", id: inactiveHistoryInstance.instanceId },
        ],
        bindingRefs: [],
        provenance: { sourceKind: "human-authored" },
      },
      instances: [rootInstance, shellInstance, inactiveHistoryInstance],
      bindings: [],
      structure,
      placements,
      validationIssues: [],
      createdAt: "2026-07-18T00:00:00.000Z",
      createdBy: "person-1",
    } as SystemBuilderRevision;
    const record = {
      systemId: "system-1",
      targetWorkspaceId: "workspace-a",
      name: "Portal",
      status: "validated",
      revision: 1,
      currentRevisionId: revision.revisionId,
      composition: revision.composition,
      createdAt: revision.createdAt,
      updatedAt: revision.createdAt,
      createdBy: "person-1",
      updatedBy: "person-1",
    } as SystemBuilderRecord;
    const saveRevision = vi.fn(async (input: any) => ({
      ok: true as const,
      value: {
        ...revision,
        revisionId: "system-revision-2",
        revisionNumber: 2,
        composition: input.composition,
        instances: input.instances,
        bindings: input.bindings,
        structure: input.structure,
        placements: input.placements,
      } as SystemBuilderRevision,
    }));
    const rootDetailBase = composerDefinition(
      "builtin.system.system",
      "System root",
      ["application-shell"],
      false,
      "3.0.0",
      true,
    );
    const rootDetail = {
      ...rootDetailBase,
      configurationSchema: {
        ...rootDetailBase.configurationSchema!,
        strict: true,
      },
    };
    const shellDetailBase = composerDefinition(
      "builtin.layout.application.standard",
      "Standard shell",
      ["content"],
      true,
      "3.0.0",
    );
    const shellDetail = {
      ...shellDetailBase,
      configurationSchema: {
        ...shellDetailBase.configurationSchema!,
        strict: true,
      },
      layoutRole: "application-shell" as const,
      layoutGeometry: {
        columnPattern: "single" as const,
        areas: [["content"]],
        sourceOrder: ["content"],
        dimensionsLocked: true as const,
      },
    };
    const historyDetailBase = composerDefinition(
      "conversation.chat-history",
      "Conversation history",
      [],
      true,
      "1.0.0",
    );
    const historyDetail = {
      ...historyDetailBase,
      configurationSchema: {
        ...historyDetailBase.configurationSchema!,
        strict: true,
      },
    };
    const listComposerAssets = vi.fn(
      async (_input: ListSystemBuilderComposerAssetsQuery) => ({
        ok: true as const,
        value: {
          items: [
            withoutComposerDetail(rootDetail),
            withoutComposerDetail(shellDetail),
            withoutComposerDetail(historyDetail),
          ],
        },
      }),
    );
    const readComposerAsset = vi.fn(
      async (input: ReadSystemBuilderComposerAssetQuery) => ({
        ok: true as const,
        value: new Map([
          [rootDetail.definitionId, rootDetail],
          [shellDetail.definitionId, shellDetail],
          [historyDetail.definitionId, historyDetail],
        ]).get(String(input.definitionRef.id))!,
      }),
    );
    const client = {
      ...clientFor(record, revision),
      saveRevision,
      listComposerAssets,
      readComposerAsset,
    } as SystemBuilderClient;

    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    await act(async () => {
      root?.render(
        <SystemBuilderWorkspace
          workspaceId="workspace-a"
          client={client}
          initialSystemId={String(record.systemId)}
        />,
      );
    });

    await act(async () =>
      (await vi.waitFor(() => button(container!, "Layers"))).click(),
    );
    const shellTreeItem = await vi.waitFor(() => {
      const current = Array.from(
        container!.querySelectorAll<HTMLButtonElement>('[role="treeitem"]'),
      ).find((button) => button.textContent?.includes("Standard shell"));
      expect(current).toBeDefined();
      return current!;
    });
    await act(async () => shellTreeItem.click());
    await vi.waitFor(() =>
      expect(shellTreeItem.getAttribute("aria-selected")).toBe("true"),
    );
    await act(async () => button(container!, "Properties").click());
    expect(container.textContent).toContain("Configure Standard shell");
    const designButton = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent === "Design",
    );
    expect(designButton?.getAttribute("aria-selected")).toBe("true");
    const title = await vi.waitFor(() => {
      const current = container!.querySelector<HTMLInputElement>("#title");
      expect(current).not.toBeNull();
      return current!;
    });
    await vi.waitFor(() =>
      expect(
        readComposerAsset.mock.calls[
          readComposerAsset.mock.calls.length - 1
        ]?.[0].definitionRef,
      ).toEqual(shellInstance.definitionRef),
    );
    expect(
      listComposerAssets.mock.calls.filter(
        ([input]) => input.parentDefinitionRef,
      ),
    ).toHaveLength(0);
    expect(listComposerAssets.mock.calls.map(([input]) => input.searchText).sort()).toEqual(
      [rootDetail.definitionId, shellDetail.definitionId, historyDetail.definitionId].sort(),
    );
    expect(listComposerAssets.mock.calls.every(([input]) => input.limit === 200)).toBe(true);
    expect(
      Array.from(container.querySelectorAll("button")).some((candidate) =>
        ["Clone", "Archive", "Restore"].includes(
          candidate.textContent?.trim() ?? "",
        ),
      ),
    ).toBe(false);
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        "value",
      )?.set;
      setter?.call(title, "Configured portal");
      title.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () => Promise.resolve());
    expect(container.textContent).toContain("Unsaved changes");
    expect(container.textContent).not.toContain(
      "Configuration updated locally. Save the revision to persist it.",
    );
    const detailReadsAfterTitleChange = readComposerAsset.mock.calls.length;
    await act(async () => button(container, "Styling").click());
    const primaryColor = await vi.waitFor(() => {
      const current =
        container!.querySelector<HTMLInputElement>("#themeColorPrimary");
      expect(current?.type).toBe("color");
      return current!;
    });
    await vi.waitFor(() =>
      expect(
        readComposerAsset.mock.calls[
          readComposerAsset.mock.calls.length - 1
        ]?.[0].definitionRef,
      ).toEqual(rootInstance.definitionRef),
    );
    expect(readComposerAsset.mock.calls.length).toBe(
      detailReadsAfterTitleChange + 1,
    );
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        "value",
      )?.set;
      setter?.call(primaryColor, "#123456");
      primaryColor.dispatchEvent(new Event("input", { bubbles: true }));
      primaryColor.dispatchEvent(new Event("change", { bubbles: true }));
    });
    await vi.waitFor(() =>
      expect(
        container!.querySelector<HTMLInputElement>("#themeColorPrimary")?.value,
      ).toBe("#123456"),
    );
    expect(container.textContent).not.toContain(
      "System styling updated locally. Save the revision to persist it.",
    );
    await act(async () => button(container, "Undo").click());
    await vi.waitFor(() =>
      expect(
        container!.querySelector<HTMLInputElement>("#themeColorPrimary")?.value,
      ).toBe("#2563eb"),
    );
    expect(container.textContent).not.toContain(
      "Last composition change undone.",
    );
    await act(async () => button(container, "Redo").click());
    await vi.waitFor(() =>
      expect(
        container!.querySelector<HTMLInputElement>("#themeColorPrimary")?.value,
      ).toBe("#123456"),
    );
    expect(container.textContent).not.toContain(
      "Composition change restored.",
    );
    const saveButton = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent === "Save and validate revision",
    );
    expect(saveButton).toBeDefined();
    await act(async () => saveButton!.click());

    await vi.waitFor(() => expect(saveRevision).toHaveBeenCalledOnce());
    expect(readComposerAsset).toHaveBeenCalledWith({
      workspaceId: "workspace-a",
      definitionRef: inactiveHistoryInstance.definitionRef,
    });
    expect(saveRevision.mock.calls[0]?.[0]).toMatchObject({
      structure,
      placements,
      composition: {
        rootInstanceRefs: revision.composition.rootInstanceRefs,
      },
    });
    expect(saveRevision.mock.calls[0]?.[0].instances).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          instanceId: rootInstance.instanceId,
          selectedConfiguration: expect.objectContaining({
            themeColorPrimary: "#123456",
          }),
        }),
        expect.objectContaining({
          instanceId: shellInstance.instanceId,
          selectedConfiguration: expect.objectContaining({
            title: "Configured portal",
          }),
        }),
      ]),
    );
    expect(
      JSON.stringify(saveRevision.mock.calls[0]?.[0].instances),
    ).not.toMatch(/sampleUserMessage|sampleAssistantMessage|previewValue/);
  });
});

function instance(
  instanceId: string,
  definitionId: string,
  displayName: string,
  selectedConfiguration: Record<string, unknown>,
): AssetInstance {
  return {
    instanceId,
    definitionRef: {
      kind: "asset-definition-version",
      id: definitionId,
      version: "1.0.0",
    },
    displayName,
    lifecycleStatus: "draft",
    selectedConfiguration,
    provenance: { sourceKind: "human-authored" },
  } as AssetInstance;
}

function composerDefinition(
  definitionId: string,
  displayName: string,
  slotIds: readonly string[],
  configurable = false,
  version = "2.0.0",
  styling = false,
): SystemBuilderComposerAsset {
  return {
    definitionRef: {
      kind: "asset-definition-version",
      id: definitionId,
      version,
    },
    definitionId,
    version,
    displayName,
    description: `${displayName} test definition.`,
    assetType: "ui-component",
    assetFamily: "structural",
    lifecycleStatus: "published",
    builtIn: true,
    ...(configurable || styling
      ? {
          configurationSchema: {
            fields: [
              ...(configurable
                ? [
                    {
                      fieldId: "title",
                      valueKind: "string" as const,
                      label: "Title",
                      required: true,
                    },
                  ]
                : []),
              ...(styling
                ? [
                    {
                      fieldId: "themeColorPrimary",
                      valueKind: "string" as const,
                      label: "Primary color",
                      defaultValue: "#2563eb",
                      uiHint: {
                        hintKind: "color" as const,
                        section: "Theme colors",
                        metadata: {
                          editorScope: "styling",
                          semanticStyleField: true,
                        },
                      },
                    },
                  ]
                : []),
            ],
          },
        }
      : {}),
    ports: [],
    slots: slotIds.map((slotId) => ({
      schemaVersion: "asset-slot-definition.v1",
      slotId,
      displayName: slotId,
      cardinality: { minItems: 0, maxItems: 1 },
      acceptedAssetTypes: ["ui-component"],
    })),
    compatibility: { status: "compatible" },
    implementationAvailability: "trusted-system-foundation",
    previewAvailability: "trusted-declarative",
  } as SystemBuilderComposerAsset;
}

function layoutDefinition(
  definitionId: string,
  displayName: string,
  slotIds: readonly string[],
  version = "2.0.0",
): SystemBuilderComposerAsset {
  return {
    ...composerDefinition(definitionId, displayName, slotIds, false, version),
    layoutRole: "application-shell",
    layoutGeometry: {
      columnPattern: "single",
      areas: slotIds.map((slotId) => [slotId]),
      sourceOrder: slotIds,
      dimensionsLocked: true,
    },
  };
}

function withoutComposerDetail(
  asset: SystemBuilderComposerAsset,
): SystemBuilderComposerAsset {
  const {
    configurationSchema: _configurationSchema,
    defaultConfiguration: _defaultConfiguration,
    ...summary
  } = asset;
  return summary;
}

function button(rootElement: ParentNode, label: string): HTMLButtonElement {
  const result = Array.from(
    rootElement.querySelectorAll<HTMLButtonElement>("button"),
  ).find((candidate) => candidate.textContent === label);
  if (!result) throw new Error(`Missing ${label} button.`);
  return result;
}
function setInputValue(input: HTMLInputElement, value: string): void {
  Object.getOwnPropertyDescriptor(
    window.HTMLInputElement.prototype,
    "value",
  )?.set?.call(input, value);
  input.dispatchEvent(new Event("input", { bubbles: true }));
}
function clientFor(
  record: SystemBuilderRecord,
  revision: SystemBuilderRevision,
): SystemBuilderClient {
  const notUsed = vi.fn(async () => {
    throw new Error("Unexpected mutation in preview test.");
  });
  return {
    list: async () => ({ ok: true, value: [record] }),
    listTemplates: async () => ({ ok: true, value: [] }),
    listComposerAssets: async () => ({ ok: true, value: { items: [] } }),
    previewLayoutChange: notUsed,
    readRevision: async () => ({ ok: true, value: revision }),
    listRevisions: async () => ({ ok: true, value: [revision] }),
    createFromTemplate: notUsed,
    create: notUsed,
    saveRevision: notUsed,
    archive: notUsed,
    restore: notUsed,
    clone: notUsed,
  } as unknown as SystemBuilderClient;
}
