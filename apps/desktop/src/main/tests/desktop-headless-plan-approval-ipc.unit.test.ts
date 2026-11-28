import assert from "node:assert/strict";
import {createHash, randomUUID} from "node:crypto";
import test from "node:test";
import {registerDesktopHeadlessPlanApprovalIpc} from "../desktopHeadlessPlanApprovalIpc";
import {createDesktopPreloadApi} from "../../preload/exposedApi";
import {createManagedBrowserConsentClient} from "../../../../thin-client/src/features/workspace/api/managedBrowserConsentClient";
import {createWorkspaceId} from "../../../../../modules/contracts/workspace";
import {readModelDownloadSource} from "../../../../../modules/contracts/model";
import {parseHeadlessBuildPlanProposal, type HeadlessHostIncarnationId} from "../../../../../modules/contracts/headless";

const hostIncarnationId = randomUUID() as HeadlessHostIncarnationId, workspaceId = createWorkspaceId("workspace.model-plan-view");
const source = readModelDownloadSource({provider: "huggingface", modelId: "fixture/model", revision: "a".repeat(40),
  format: "transformers-safetensors", license: {kind: "unknown"},
  files: ["config.json", "model.safetensors", "tokenizer.json"].map(name => ({path: name, sizeBytes: 10,
    integrity: {algorithm: name.endsWith("safetensors") ? "sha256" : "git-blob-sha1", digest: "b".repeat(name.endsWith("safetensors") ? 64 : 40)}})),
  totalBytes: 30, excludedFileCount: 0, sourceVerification: "provider-metadata", bytesVerification: "not-checked", runtimeReadiness: "not-checked"},
  {provider: "huggingface", modelId: "fixture/model", revision: "a".repeat(40)});

for (const operation of ["models.download", "models.save-download"] as const) for (const chat of [false, true])
test(`${operation} approval survives trusted ${chat ? "chat" : "popup"} IPC/preload and Managed view codecs`, async () => {
  const sourceManifest = {source, manifestDigest: "sha256:" + createHash("sha256").update(JSON.stringify(source)).digest("hex")};
  const step = {operation, name: "Synthetic model", idempotencyKey: randomUUID(), sourceManifest,
    ...(operation === "models.download" ? {maximumDurationSeconds: 30, allowedOrigins: ["https://huggingface.co"]} : {taskId: randomUUID()})};
  const plan = parseHeadlessBuildPlanProposal({hostIncarnationId, workspaceId, steps: [step]}, hostIncarnationId,
    {allowLocalFileSave: false, allowModelDownload: true, allowModelReferenceSave: true}); assert.ok(plan.ok);
  const fingerprint = createHash("sha256").update(JSON.stringify(plan.preview)).digest("hex");
  const selection = {workspaceId, registeredClientId: randomUUID(), fingerprint};
  const state = {fingerprint, revision: 1, stepCount: 1, expiresAt: Date.now() + 60_000, status: "pending" as const, approvedSteps: 0};
  let usable = true, calls = 0;
  const channels: string[] = [], handlers = new Map<string, (event: unknown, payload: any) => any>();
  const service = {async open(received: unknown, caller: any) {
    calls++; assert.deepEqual(received, selection); assert.equal(caller.isCurrent(), true); channels.push(caller.channel);
    return {ok: true, snapshot: {preview: plan.preview, state}, publishIfCurrent: async (publish: () => boolean) => publish()};
  }};
  const key = {};
  registerDesktopHeadlessPlanApprovalIpc({ipcMain: {handle(channel, listener) {handlers.set(channel, listener as any);}},
    getApprovals: () => service as never, resolveWindow: () => usable ? {key, isUsable: () => usable} : undefined});
  const api = createDesktopPreloadApi({ipcRenderer: {async invoke(channel, payload) {
    const handler = handlers.get(channel); assert.ok(handler); return handler({}, payload);
  }}});
  const view = await (chat ? api.openHeadlessPlanChat(selection) : api.openHeadlessPlanApproval(selection)); assert.ok(view);
  assert.equal(view.preview.steps[0].operation, operation); assert.equal(view.selection.fingerprint, fingerprint);
  assert.deepEqual(channels, [chat ? "authenticated-chat" : "app-popup"]);
  usable = false;
  assert.equal(await (chat ? api.openHeadlessPlanChat(selection) : api.openHeadlessPlanApproval(selection)), undefined);
  assert.equal(calls, 1, "An unavailable trusted window cannot open a review.");

  const document = {hostIncarnationId, workspaceId, windowId: randomUUID(), uiIncarnationId: randomUUID()};
  const tab = {target: document, proof: "a".repeat(43)}, controller = new AbortController();
  const client = createManagedBrowserConsentClient("org.synthetic", async (_url, options) => {
    assert.equal(options?.credentials, "same-origin");
    return Response.json(view);
  });
  const managed = await client.openPlanApproval(tab, selection, controller.signal, chat);
  assert.ok(managed); assert.equal(managed.preview.steps[0].operation, operation);
  const changed = createManagedBrowserConsentClient("org.synthetic", async () => Response.json({...view,
    preview: {...view.preview, steps: []}}));
  assert.equal(await changed.openPlanApproval(tab, selection, controller.signal, chat), undefined);
});
