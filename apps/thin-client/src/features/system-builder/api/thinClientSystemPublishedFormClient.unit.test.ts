import assert from "node:assert/strict";
import test from "node:test";
import { createThinClientSystemPublishedFormClient } from "./thinClientSystemPublishedFormClient";

const selection = { workspaceId: "workspace-a", releaseId: `system-release:${"a".repeat(64)}` };
const submission = { ...selection, formId: "form-a", submissionId: "74b6d19f-18df-487f-89a6-91089d46d487",
  answers: { reason: "Synthetic answer" } };

test("browser lists the exact release and only sends answers in the authorized POST body", async () => {
  const originalFetch = globalThis.fetch;
  const originalLocalStorage = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
  const calls: { input: string; init?: RequestInit }[] = [];
  try {
    Object.defineProperty(globalThis, "localStorage", { configurable: true, value: { getItem: () => null } });
    globalThis.fetch = async (input, init) => {
      calls.push({ input: String(input), init });
      return new Response(JSON.stringify({ ok: true, value: init?.method === "POST" ? { status: "denied" } : [] }));
    };
    const client = createThinClientSystemPublishedFormClient("/api/");
    const listIntent = { ...selection, actorId: "ignored", roles: ["owner"] };
    assert.deepEqual(await client.list(listIntent), { ok: true, value: [] });
    assert.deepEqual(await client.submit({ ...submission, ...listIntent }), { ok: true, value: { status: "denied" } });
    assert.equal(calls[0]?.input, `/api/systems/published-forms?workspaceId=workspace-a&releaseId=${encodeURIComponent(selection.releaseId)}`);
    assert.equal(calls[1]?.input, "/api/systems/published-forms/submit");
    assert.equal(calls[1]?.init?.method, "POST");
    assert.deepEqual(JSON.parse(String(calls[1]?.init?.body)), submission);
    globalThis.fetch = async () => new Response(JSON.stringify({ ok: false, error: { message: "Untrusted reply detail" } }), { status: 500 });
    assert.deepEqual(await client.list(selection), {
      ok: false, error: { code: "system-form.unavailable", message: "Published forms are unavailable." },
    });
  } finally {
    globalThis.fetch = originalFetch;
    if (originalLocalStorage) Object.defineProperty(globalThis, "localStorage", originalLocalStorage);
    else Reflect.deleteProperty(globalThis, "localStorage");
  }
});

test("managed browser Publish opens and submits only its selected release through secure fetch", async () => {
  const { JSDOM } = await import("jsdom");
  const dom = new JSDOM("<!doctype html><div id='root'></div>", { url: "http://localhost", pretendToBeVisual: true });
  const globals = {
    window: dom.window, document: dom.window.document, navigator: dom.window.navigator, localStorage: dom.window.localStorage,
    HTMLElement: dom.window.HTMLElement, Element: dom.window.Element, Node: dom.window.Node,
    Event: dom.window.Event, MutationObserver: dom.window.MutationObserver,
    getComputedStyle: dom.window.getComputedStyle.bind(dom.window), IS_REACT_ACT_ENVIRONMENT: true,
  };
  const previous = new Map(Object.keys(globals).map((key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  const originalFetch = globalThis.fetch;
  for (const [key, value] of Object.entries(globals)) Object.defineProperty(globalThis, key, { configurable: true, value });
  let unmount: (() => Promise<void>) | undefined;
  let closeLoader: (() => Promise<void>) | undefined;
  const calls: { url: URL; init?: RequestInit }[] = [];
  const fixtureToken = "synthetic-device-token";
  dom.window.localStorage.setItem("ai-system-builder.paired-device-token", fixtureToken);
  globalThis.fetch = async (input, init) => {
    const url = new URL(String(input), dom.window.location.origin);
    const ok = (value: unknown) => Response.json({ ok: true, value });
    if (url.pathname === "/api/systems/publication") return ok({ systems: [{
      systemId: "system-a", name: "Intake system", builds: [{ buildId: "build-a", systemRevisionId: "revision-a",
        releaseId: selection.releaseId, publishedAt: "2026-11-12T00:00:00.000Z", versionNumber: 1, status: "succeeded",
        publicationStatus: "published", statusMessage: "Published", outputCount: 1, evidenceCount: 1, diagnosticCount: 0 }],
    }] });
    if (url.pathname.startsWith("/api/systems/published-forms")) {
      calls.push({ url, init });
      return url.pathname.endsWith("/submit") ? ok({ status: "completed", receiptId: "fixture-browser-receipt" }) : ok([
        { id: "form-a", title: "Browser intake", steps: [{
          id: "first", label: "Page 1", defaultDestinationId: "form-a", conditions: [],
          fields: [{ id: "confirm", label: "Confirm", helpText: "", kind: "checkbox", dateKind: "date", required: true, options: [] }],
        }] },
      ]);
    }
    if (url.pathname === "/api/systems" || url.pathname === "/api/systems/templates") return ok([]);
    return Response.json({ ok: false, error: { code: "unavailable", message: "Fixture operation unavailable." } }, { status: 404 });
  };
  try {
    const { act, createElement } = await import("react");
    const { createRoot } = await import("react-dom/client");
    // The thin client is an ES module and consumes repository TypeScript from
    // outside its package. Load the page with Vite's module resolver, as the app does.
    const { createServer } = await import("vite");
    const loader = await createServer({
      configFile: false, envFile: false, envPrefix: [], appType: "custom",
      optimizeDeps: { noDiscovery: true, include: [] },
      server: { middlewareMode: true, ws: false, watch: null },
    });
    closeLoader = () => loader.close();
    const { SystemBuilderPage } = await loader.ssrLoadModule("/apps/thin-client/src/pages/SystemBuilderPage.tsx");
    const root = createRoot(dom.window.document.getElementById("root")!);
    unmount = () => act(async () => root.unmount());
    await act(async () => root.render(createElement(SystemBuilderPage, { workspaceId: selection.workspaceId, workspaceName: "Fixture workspace" })));
    const button = (label: string) => [...dom.window.document.querySelectorAll<HTMLButtonElement>("button")]
      .find((item) => item.textContent?.trim() === label)!;
    await act(async () => button("Publish").click());
    assert.equal(calls.length, 0);
    await act(async () => button("Open forms").click());
    assert.equal(calls[0]?.url.searchParams.get("workspaceId"), selection.workspaceId);
    assert.equal(calls[0]?.url.searchParams.get("releaseId"), selection.releaseId);
    assert.ok(dom.window.document.querySelector('[role="dialog"]')?.textContent?.includes("Browser intake"));
    await act(async () => dom.window.document.querySelector<HTMLInputElement>('input[type="checkbox"]')!.click());
    await act(async () => button("Submit form").click());
    assert.equal(calls[1]?.url.pathname, "/api/systems/published-forms/submit");
    assert.equal(calls[1]?.url.search, "");
    assert.equal(calls[1]?.init?.method, "POST");
    assert.ok(new Headers(calls[1]?.init?.headers).get("authorization") === "Bearer " + fixtureToken);
    const payload = JSON.parse(String(calls[1]?.init?.body));
    assert.equal(payload.workspaceId, selection.workspaceId);
    assert.equal(payload.releaseId, selection.releaseId);
    assert.equal(payload.formId, "form-a");
    assert.deepEqual(payload.answers, { confirm: true });
    assert.ok(dom.window.document.body.textContent?.includes("Your form was submitted."));
  } finally {
    try { await unmount?.(); } finally {
      try { await closeLoader?.(); } finally {
        globalThis.fetch = originalFetch;
        dom.window.close();
        for (const [key, descriptor] of previous) {
          if (descriptor) Object.defineProperty(globalThis, key, descriptor);
          else Reflect.deleteProperty(globalThis, key);
        }
      }
    }
  }
});
