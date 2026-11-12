import assert from "node:assert/strict";
import test from "node:test";
import { createIpcSuccessResponse, DESKTOP_SYSTEM_BUILDER_PUBLISHED_FORM_CHANNELS } from "../../../../../modules/contracts/ipc";
import { createDesktopPreloadApi } from "../exposedApi";
import { createDesktopSystemPublishedFormClient } from "../../renderer/features/system-builder/api/desktopSystemPublishedFormClient";

const list = DESKTOP_SYSTEM_BUILDER_PUBLISHED_FORM_CHANNELS.listPublishedForms;
const submit = DESKTOP_SYSTEM_BUILDER_PUBLISHED_FORM_CHANNELS.submitPublishedForm;
const selection = { workspaceId: "workspace-a", releaseId: `system-release:${"a".repeat(64)}` };

test("Desktop sends only the selected release and form answers through their own IPC channels", async () => {
  const calls: { channel: string; request: unknown }[] = [];
  const api = createDesktopPreloadApi({
    ipcRenderer: {
      async invoke(channel, request) {
        calls.push({ channel, request });
        return channel === list.request.value
          ? createIpcSuccessResponse(list.response, [])
          : createIpcSuccessResponse(submit.response, { status: "denied" });
      },
    },
  });
  const spoofed = { ...selection, actorId: "ignored", roles: ["owner"] };
  const answers = { reason: "Synthetic request" };
  const submission = { formId: "form-a", submissionId: "74b6d19f-18df-487f-89a6-91089d46d487", answers };
  assert.equal((await api.listPublishedSystemForms(spoofed)).ok, true);
  assert.equal((await api.submitPublishedSystemForm({ ...spoofed, ...submission })).ok, true);
  assert.deepEqual(calls.map(({channel, request}) => ({
    channel, payload: (request as { readonly payload: unknown }).payload,
  })), [
    { channel: list.request.value, payload: selection },
    { channel: submit.request.value, payload: { ...selection, ...submission } },
  ]);
});

test("Desktop does not return a published form result from the wrong channel", async () => {
  const api = createDesktopPreloadApi({
    ipcRenderer: { invoke: async () => createIpcSuccessResponse(submit.response, { status: "completed" }) },
  });
  await assert.rejects(api.listPublishedSystemForms(selection), /invalid published form response/i);
});

test("Desktop client returns a safe error when the bridge is absent or rejects the request", async () => {
  const prior = Object.getOwnPropertyDescriptor(globalThis, "window");
  const failure = { ok: false, error: { code: "system-form.unavailable", message: "Published forms are unavailable." } };
  try {
    Object.defineProperty(globalThis, "window", { configurable: true, value: {} });
    const client = createDesktopSystemPublishedFormClient();
    assert.deepEqual(await client.list(selection), failure);
    Object.defineProperty(globalThis, "window", { configurable: true, value: {
      desktopApi: { submitPublishedSystemForm: async () => { throw new Error("Untrusted transport detail"); } },
    } });
    assert.deepEqual(await client.submit({ ...selection, formId: "form-a", submissionId: "test", answers: {} }), failure);
  } finally {
    if (prior) Object.defineProperty(globalThis, "window", prior);
    else Reflect.deleteProperty(globalThis, "window");
  }
});

test("Desktop Publish opens and submits the selected release through the actual renderer and preload", async () => {
  const { JSDOM } = await import("jsdom");
  const dom = new JSDOM("<!doctype html><div id='root'></div>", { url: "http://localhost", pretendToBeVisual: true });
  const globals = {
    window: dom.window, document: dom.window.document, navigator: dom.window.navigator,
    HTMLElement: dom.window.HTMLElement, Element: dom.window.Element, Node: dom.window.Node,
    Event: dom.window.Event, MutationObserver: dom.window.MutationObserver,
    getComputedStyle: dom.window.getComputedStyle.bind(dom.window), IS_REACT_ACT_ENVIRONMENT: true,
  };
  const prior = new Map(Object.keys(globals).map((key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  for (const [key, value] of Object.entries(globals)) Object.defineProperty(globalThis, key, { configurable: true, value });
  let unmount: (() => Promise<void>) | undefined;
  try {
    const { createElement, act } = await import("react");
    const { createRoot } = await import("react-dom/client");
    const { SystemBuilderPage } = await import("../../renderer/pages/SystemBuilderPage");
    const calls: { channel: string; payload: unknown }[] = [];
    const bridge = createDesktopPreloadApi({ ipcRenderer: {
      async invoke(channel, request) {
        calls.push({ channel, payload: (request as { payload: unknown }).payload });
        return channel === list.request.value
          ? createIpcSuccessResponse(list.response, [{ id: "form-a", title: "Intake", steps: [
            { id: "first", label: "Page 1", defaultDestinationId: "form-a", conditions: [],
              fields: [{ id: "confirm", label: "Confirm", helpText: "", kind: "checkbox", dateKind: "date", required: true, options: [] }] },
          ] }])
          : createIpcSuccessResponse(submit.response, { status: "completed", receiptId: "fixture-form-receipt" });
      },
    } });
    Object.defineProperty(dom.window, "desktopApi", { configurable: true, value: {
      listSystemBuilderSystems: async () => ({ ok: true, value: [] }),
      listSystemBuilderTemplates: async () => ({ ok: true, value: [] }),
      listSystemPublicationWorkspace: async () => ({ ok: true, value: { systems: [{
        systemId: "system-a", name: "Intake system", builds: [{ buildId: "build-a", systemRevisionId: "revision-a",
          releaseId: selection.releaseId, publishedAt: "2026-11-12T00:00:00.000Z", versionNumber: 1, status: "succeeded",
          publicationStatus: "published", statusMessage: "Published", outputCount: 1, evidenceCount: 1, diagnosticCount: 0 }],
      }] } }),
      readPublishedSystemLifecycle: async () => ({ ok: true, value: { releaseId: selection.releaseId, schemaVersion: "1.0",
        state: "not-installed", revision: "lifecycle-a", eligibleActions: [], health: "unknown", diagnostics: [] } }),
      listPublishedSystemForms: bridge.listPublishedSystemForms, submitPublishedSystemForm: bridge.submitPublishedSystemForm,
    } });
    const root = createRoot(dom.window.document.getElementById("root")!);
    unmount = () => act(async () => root.unmount());
    await act(async () => root.render(createElement(SystemBuilderPage, { workspaceId: selection.workspaceId, workspaceName: "Fixture workspace" })));
    const button = (label: string) => [...dom.window.document.querySelectorAll<HTMLButtonElement>("button")]
      .find((item) => item.textContent?.trim() === label)!;
    await act(async () => button("Publish").click());
    assert.equal(calls.length, 0);
    await act(async () => button("Open forms").click());
    assert.deepEqual(calls, [{ channel: list.request.value, payload: selection }]);
    assert.ok(dom.window.document.querySelector('[role="dialog"]')?.textContent?.includes("Intake"));
    await act(async () => dom.window.document.querySelector<HTMLInputElement>('input[type="checkbox"]')!.click());
    await act(async () => button("Submit form").click());
    assert.equal(calls[1]?.channel, submit.request.value);
    const payload = calls[1]?.payload as { workspaceId: string; releaseId: string; formId: string; submissionId: string; answers: unknown };
    assert.equal(payload.workspaceId, selection.workspaceId);
    assert.equal(payload.releaseId, selection.releaseId);
    assert.equal(payload.formId, "form-a");
    assert.match(payload.submissionId, /^[a-f0-9-]{36}$/);
    assert.deepEqual(payload.answers, { confirm: true });
    assert.ok(dom.window.document.body.textContent?.includes("Your form was submitted."));
  } finally {
    try { await unmount?.(); } finally {
      dom.window.close();
      for (const [key, descriptor] of prior) {
        if (descriptor) Object.defineProperty(globalThis, key, descriptor);
        else Reflect.deleteProperty(globalThis, key);
      }
    }
  }
});
