import assert from "node:assert/strict";
import test from "node:test";
import type { Request } from "express";
import { DESKTOP_SYSTEM_BUILDER_PUBLISHED_FORM_CHANNELS } from "../../../../../contracts/ipc";
import type { PublishedSystemFormSubmitInput, PublishedSystemFormsInput } from "../../../../../contracts/system-builder";
import { registerSystemBuilderIpc } from "../../../ipc-electron/system-builder/registerSystemBuilderIpc";
import type { IpcMainHandlePort } from "../../../ipc-electron/ipcMainHandlePort";
import type { PublishedFormsTransport } from "../../../system-builder/publishedFormTransport";
import { API_ROUTE_POLICIES } from "../../security/apiRouteSecurityPolicy";
import { setExpressAuthContext } from "../../security/expressAuthContext";
import { registerSystemBuilderApiRoutes, type RegisterSystemBuilderApiRoutesDependencies, type SystemBuilderExpressPort } from "../registerSystemBuilderApiRoutes";

const selection = { workspaceId: "workspace-form", releaseId: `system-release:${"a".repeat(64)}` };
const input = { ...selection, formId: "form.intake", submissionId: "9a37938e-de87-4a3d-b9ac-97828b96290f", answers: { reason: "sample answer" } };
const form = { id: "form.intake", title: "Intake", steps: [] };
const receipt = { status: "already-recorded" as const, receiptId: "form-receipt" };

function fixture(configured = true, deny = false) {
  type ApiHandler = Parameters<SystemBuilderExpressPort["get"]>[1];
  type IpcResult = { ok: boolean; value?: unknown };
  type IpcHandler = (event: unknown, payload: unknown) => Promise<IpcResult>;
  const get = new Map<string, ApiHandler>();
  const post = new Map<string, ApiHandler>();
  const ipc = new Map<string, IpcHandler>();
  const calls: { kind: "list" | "submit"; input: PublishedSystemFormsInput | PublishedSystemFormSubmitInput; actor?: string }[] = [];
  const publishedForms: PublishedFormsTransport = {
    list: async (input, actor) => { calls.push({ kind: "list", input, actor }); return { ok: true, value: [form] }; },
    submit: async (input, actor) => {
      calls.push({ kind: "submit", input, actor });
      return deny ? { ok: false, error: { code: "system-form.forbidden", message: "synthetic private detail" } } : { ok: true, value: receipt };
    },
  };
  // Existing System Builder operations are not invoked by this feature fixture.
  const existing = {} as Omit<RegisterSystemBuilderApiRoutesDependencies, "app" | "publishedForms">;
  const dependencies = { ...existing, ...(configured ? { publishedForms } : {}) };
  registerSystemBuilderApiRoutes({ ...dependencies, app: { get: (path, handler) => get.set(path, handler), post: (path, handler) => post.set(path, handler) } });
  const ipcMain: IpcMainHandlePort = { handle(channel, handler) {
    ipc.set(channel, async (event, payload) => await handler(event, payload as Parameters<typeof handler>[1]) as IpcResult);
  } };
  registerSystemBuilderIpc({ ...dependencies, ipcMain });
  return { get, post, ipc, calls };
}

function request(source: { query?: Record<string, unknown>; body?: unknown }) {
  setExpressAuthContext(source as Request, { authenticated: true, authMethod: "oidc-bearer", principal: {
    principalId: "actor-verified", kind: "user", roles: ["owner"], scopes: ["asset:read", "asset:write"],
  } });
  return source;
}

function response() {
  const outcome: { status: number; json?: unknown } = { status: 0 };
  const handler = {
    status: (code: number) => { outcome.status = code; return handler; },
    json: (json: unknown) => { outcome.json = json; },
  };
  return { outcome, handler };
}

test("form API and IPC project the same results and only managed auth supplies expected actor", async () => {
  const env = fixture();
  const read = response();
  await env.get.get("/api/systems/published-forms")!(request({ query: selection }), read.handler);
  const api = response();
  await env.post.get("/api/systems/published-forms/submit")!(request({ body: input }), api.handler);
  const list = await env.ipc.get(DESKTOP_SYSTEM_BUILDER_PUBLISHED_FORM_CHANNELS.listPublishedForms.request.value)!({}, { payload: selection });
  const submit = await env.ipc.get(DESKTOP_SYSTEM_BUILDER_PUBLISHED_FORM_CHANNELS.submitPublishedForm.request.value)!({}, { payload: input });
  assert.equal(read.outcome.status, 200);
  assert.equal(api.outcome.status, 200);
  assert.deepEqual((read.outcome.json as { value: unknown }).value, list.value);
  assert.deepEqual((api.outcome.json as { value: unknown }).value, submit.value);
  assert.deepEqual(submit.value, receipt);
  assert.deepEqual(env.calls.map(({ kind, actor }) => [kind, actor]), [
    ["list", "actor-verified"], ["submit", "actor-verified"], ["list", undefined], ["submit", undefined],
  ]);
  const accepted = env.calls[1]!.input as PublishedSystemFormSubmitInput;
  assert.deepEqual({ ...accepted.answers }, input.answers);
  assert.doesNotMatch(JSON.stringify({ api: api.outcome, submit }), /sample answer/);
});

test("form transports deny authority supplied by the client and remain absent without host wiring", async () => {
  const env = fixture();
  const api = response();
  await env.post.get("/api/systems/published-forms/submit")!(request({ body: { ...input, actorId: "caller-choice" } }), api.handler);
  assert.equal(api.outcome.status, 400);
  const auth = response();
  await env.get.get("/api/systems/published-forms")!({ query: selection }, auth.handler);
  assert.equal(auth.outcome.status, 403);
  const ipc = await env.ipc.get(DESKTOP_SYSTEM_BUILDER_PUBLISHED_FORM_CHANNELS.submitPublishedForm.request.value)!({}, {
    payload: { ...input, answers: { reason: "x".repeat(4001) } },
    requestId: { fixture: "private caller metadata" },
    correlationId: "private caller metadata",
  });
  assert.equal(ipc.ok, false);
  assert.doesNotMatch(JSON.stringify(ipc), /private caller metadata/);
  assert.equal(env.calls.length, 0);
  const absent = fixture(false);
  assert.equal(absent.get.has("/api/systems/published-forms"), false);
  assert.equal(absent.post.has("/api/systems/published-forms/submit"), false);
  assert.equal(absent.ipc.has(DESKTOP_SYSTEM_BUILDER_PUBLISHED_FORM_CHANNELS.listPublishedForms.request.value), false);
  assert.deepEqual(API_ROUTE_POLICIES.get("GET /api/systems/published-forms"), { public: false, scopes: ["asset:read"] });
  assert.deepEqual(API_ROUTE_POLICIES.get("POST /api/systems/published-forms/submit"), { public: false, scopes: ["asset:write"] });
});

test("form transport failures redact gateway details", async () => {
  const env = fixture(true, true);
  const api = response();
  await env.post.get("/api/systems/published-forms/submit")!(request({ body: input }), api.handler);
  assert.equal(api.outcome.status, 403);
  const ipc = await env.ipc.get(DESKTOP_SYSTEM_BUILDER_PUBLISHED_FORM_CHANNELS.submitPublishedForm.request.value)!({}, { payload: input });
  assert.equal(ipc.ok, false);
  assert.doesNotMatch(JSON.stringify({ api: api.outcome, ipc }), /synthetic private detail|sample answer/);
});
