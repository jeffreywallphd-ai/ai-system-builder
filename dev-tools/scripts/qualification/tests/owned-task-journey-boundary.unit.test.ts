import { afterEach, beforeEach, describe, it, mock } from "node:test";
import assert from "node:assert/strict";
import type { Page } from "@playwright/test";
import { taskOperation } from "../visual-composer/e2e/owned-task-journey";

const PRIVATE = "synthetic-private-provider-diagnostic";
const credential = "synthetic-paired-test-credential-only";
const operations = { start: "startModelDownload", read: "readModelDownload", list: "listModelDownloads", cancel: "cancelModelDownload", complete: "completeModelDownload" } as const;
type Operation = keyof typeof operations;
const originals = new Map<string, PropertyDescriptor | undefined>();
function stubGlobal(name: string, value: unknown) {
  if (!originals.has(name)) originals.set(name, Object.getOwnPropertyDescriptor(globalThis, name));
  Object.defineProperty(globalThis, name, { configurable: true, writable: true, value });
}
const page = () => ({ evaluate: mock.fn(async (operation: (value: unknown) => unknown, value: unknown) => operation(value)) }) as unknown as Page;
const response = (body: unknown, status = 200, contentType = "application/json") => new Response(JSON.stringify(body), { status, headers: { "content-type": contentType } });
const jsonFetch = (body: unknown) => stubGlobal("fetch", mock.fn(async () => response(body)));

beforeEach(() => {
  stubGlobal("window", {});
  stubGlobal("localStorage", { getItem: mock.fn(() => credential) });
});
afterEach(() => {
  for (const [name, descriptor] of originals) {
    if (descriptor) Object.defineProperty(globalThis, name, descriptor); else Reflect.deleteProperty(globalThis, name);
  }
  originals.clear();
});

describe("real owned task journey transport boundary", () => {
  for (const operation of Object.keys(operations) as Operation[]) {
  it(`preserves exact Desktop ${operation} dispatch and value`, async () => {
    const input = { workspaceId: "workspace.synthetic", requestId: "owned-task" };
    const value = { activity: { requestId: "owned-task", status: "running" } };
    const invoke = mock.fn(async () => ({ ok: true, value }));
    stubGlobal("window", { desktopApi: { [operations[operation]]: invoke } });
    const fetch = mock.fn(); stubGlobal("fetch", fetch);
    assert.deepEqual(await taskOperation(page(), operation, input), value);
    assert.deepEqual(invoke.mock.calls.map(call => call.arguments), [[input]]); assert.equal(fetch.mock.callCount(), 0);
  });
  }
  for (const operation of Object.keys(operations) as Operation[]) {
  it(`preserves same-origin browser ${operation} with redirects refused`, async () => {
    const input = { workspaceId: "workspace.synthetic", requestId: "owned-task" };
    const value = { activity: { requestId: "owned-task", status: "running" } };
    const fetch = mock.fn(async () => response({ ok: true, value })); stubGlobal("fetch", fetch);
    assert.deepEqual(await taskOperation(page(), operation, input), value);
    assert.equal(fetch.mock.callCount(), 1);
    const [url, options] = fetch.mock.calls[0]!.arguments as unknown as [string, RequestInit];
    assert.equal(url, `/api/model/download/${operation}`); assert.equal(options.method, "POST");
    assert.equal(options.redirect, "error"); assert.deepEqual(JSON.parse(options.body as string), input);
    assert.equal((options.headers as Record<string, string>).authorization, `Bearer ${credential}`);
  });
  }
  it("does not send a request without a saved pairing credential", async () => {
    stubGlobal("localStorage", { getItem: () => null }); const fetch = mock.fn(); stubGlobal("fetch", fetch);
    await assert.rejects(taskOperation(page(), "read", {}), /Owned read failed\./); assert.equal(fetch.mock.callCount(), 0);
  });
  it("does not put untrusted provider codes in failure output", async () => {
    jsonFetch({ ok: false, error: { code: PRIVATE, message: PRIVATE, details: { payload: PRIVATE } } });
    await assert.rejects(taskOperation(page(), "read", {}), error => {
      assert.ok(error instanceof Error); assert.match(error.message, /Owned read failed\./);
      assert.equal(error.message.includes(PRIVATE), false); assert.equal(error.message.includes(credential), false); return true;
    });
  });
  it("does not return a successful envelope from a refused HTTP request", async () => {
    stubGlobal("fetch", mock.fn(async () => response({ ok: true, value: { unexpected: true } }, 403)));
    await assert.rejects(taskOperation(page(), "read", {}), /Owned read failed\./);
  });
  it("refuses a non-JSON response without exposing its content", async () => {
    stubGlobal("fetch", mock.fn(async () => response({ ok: true, value: { body: PRIVATE } }, 200, "text/html")));
    await assert.rejects(taskOperation(page(), "read", {}), /Owned read failed\./);
  });
  for (const value of [null, [], false, "not-a-task-value"]) {
  it(`rejects invalid success value ${JSON.stringify(value)}`, async () => {
    jsonFetch({ ok: true, value }); await assert.rejects(taskOperation(page(), "read", {}), /Owned read failed\./);
  });
  }
  it("bounds an HTTP body and cancels the remaining stream", async () => {
    const cancel = mock.fn(); let sent = false;
    const body = new ReadableStream<Uint8Array>({ pull(controller) { if (!sent) { sent = true; controller.enqueue(new TextEncoder().encode(JSON.stringify({ ok: true, value: { content: "x".repeat(262_144) } }))); } else controller.close(); }, cancel }, { highWaterMark: 0 });
    stubGlobal("fetch", mock.fn(async () => new Response(body, { headers: { "content-type": "application/json" } })));
    await assert.rejects(taskOperation(page(), "read", {}), /Owned read failed\./);
    assert.equal(cancel.mock.callCount(), 1); assert.equal(body.locked, false);
  });
  it("refuses malformed UTF-8 instead of silently replacing it", async () => {
    const prefix = new TextEncoder().encode('{"ok":true,"value":{"content":"'); const suffix = new TextEncoder().encode('"}}');
    const bytes = new Uint8Array(prefix.length + 1 + suffix.length); bytes.set(prefix); bytes[prefix.length] = 0xff; bytes.set(suffix, prefix.length + 1);
    stubGlobal("fetch", mock.fn(async () => new Response(bytes, { headers: { "content-type": "application/json" } })));
    await assert.rejects(taskOperation(page(), "read", {}), /Owned read failed\./);
  });
  it("uses fixed diagnostics for a failing response stream", async () => {
    const body = new ReadableStream({ start(controller) { controller.error(new Error(PRIVATE)); } });
    stubGlobal("fetch", mock.fn(async () => new Response(body, { headers: { "content-type": "application/json" } })));
    await assert.rejects(taskOperation(page(), "read", {}), /Owned read failed\./);
  });
  it("uses fixed diagnostics for an IPC rejection", async () => {
    stubGlobal("window", { desktopApi: { readModelDownload: async () => { throw new Error(PRIVATE); } } });
    await assert.rejects(taskOperation(page(), "read", {}), /Owned read failed\./);
  });
  it("rejects an oversized Desktop value before it enters assertion results", async () => {
    stubGlobal("window", { desktopApi: { readModelDownload: async () => ({ ok: true, value: { text: "x".repeat(262_144) } }) } });
    await assert.rejects(taskOperation(page(), "read", {}), /Owned read failed\./);
  });
  it("refuses an unsupported operation before page execution", async () => {
    const target = page(); await assert.rejects(taskOperation(target, "unknown" as Operation, {}), /Unsupported owned task operation\./);
    assert.equal((target.evaluate as unknown as { mock: { callCount(): number } }).mock.callCount(), 0);
  });
});
