import assert from "node:assert/strict";
import test from "node:test";
import type { IpcMainHandlePort } from "../../../../../modules/adapters/transport/ipc-electron/ipcMainHandlePort";
import { DESKTOP_HEADLESS_LOCAL_FILE_SELECTION_CHANNEL, HEADLESS_CONTRACT_VERSION, isHeadlessHostIncarnationId,
  type AppHeadlessLocalFileSelectionRequest } from "../../../../../modules/contracts/headless";
import { normalizeIngestionTaskFileId, normalizeIngestionTaskId } from "../../../../../modules/contracts/ingestion";
import { createWorkspaceId } from "../../../../../modules/contracts/workspace";
import { createDesktopPreloadApi } from "../../preload/exposedApi";
import { registerDesktopHeadlessLocalFileSelectionIpc } from "../desktopHeadlessLocalFileSelectionIpc";

const hostIncarnationId = "632cfa6b-c323-419a-b2bd-5880b1f34858";
assert.ok(isHeadlessHostIncarnationId(hostIncarnationId));
const workspaceId = createWorkspaceId("workspace.synthetic");
const taskId = normalizeIngestionTaskId("ingestion.sample");
const fileId = normalizeIngestionTaskFileId("file.sample");
const raw: AppHeadlessLocalFileSelectionRequest = { version: HEADLESS_CONTRACT_VERSION, operation: "data.select-local-file",
  input: { hostIncarnationId, workspaceId, taskId, fileId, taskRevision: 7, expectedSelectionRevision: 2,
    registeredClientId: "34012ffc-feed-411f-b86b-1b80f5d0ba2f" } };
const { hostIncarnationId: _, ...appInput } = raw.input;
const exact = { workspaceId, taskId, fileId, taskRevision: 7, selectionRevision: 3 };
const unavailable = { ok: false, code: "headless.unavailable" };

test("main IPC admits only a current trusted app frame and returns only the exact selection", async () => {
  const owned = {};
  const invalid = { ok: false, code: "headless.invalid-request" };
  const handlers = new Map<string, (event: unknown, request: unknown) => Promise<unknown>>();
  const ipcMain: IpcMainHandlePort = { handle(channel, listener) {
    assert.equal(channel, DESKTOP_HEADLESS_LOCAL_FILE_SELECTION_CHANNEL);
    handlers.set(channel, (event, request) => listener(event, request as never));
  } };
  let admitted = 0;
  let current = true;
  let retire = false;
  let registrationCurrent = true;
  let retireRegistrationDuringHandoff = false;
  let observed = exact;
  const selection = { hostIncarnationId, async select(request: unknown, isCurrent: () => boolean) {
    assert.deepEqual(request, raw);
    assert.equal(isCurrent(), true);
    admitted++;
    if (retire) current = false;
    if (retireRegistrationDuringHandoff) queueMicrotask(() => { registrationCurrent = false; });
    return { ok: true, value: observed, receiptIsCurrent: () => registrationCurrent } as const;
  } };
  registerDesktopHeadlessLocalFileSelectionIpc({
    ipcMain, getSelection: () => selection,
    resolveWindow: event => event === owned ? { isUsable: () => current } : undefined,
  });
  const handler = handlers.get(DESKTOP_HEADLESS_LOCAL_FILE_SELECTION_CHANNEL);
  assert.ok(handler);
  assert.deepEqual(await handler({}, appInput), unavailable);
  assert.deepEqual(await handler(owned, { ...appInput, path: "unexpected" }), invalid);
  assert.deepEqual(await handler(owned, { ...appInput, hostIncarnationId }), invalid);
  assert.deepEqual(await handler(owned, { ...appInput, operation: "data.prepare-local-file" }), invalid);
  assert.equal(admitted, 0);
  assert.deepEqual(await handler(owned, appInput), { ok: true, value: exact });
  observed = { ...exact, fileId: normalizeIngestionTaskFileId("file.other") };
  assert.deepEqual(await handler(owned, appInput), unavailable);
  observed = exact;
  retireRegistrationDuringHandoff = true;
  assert.deepEqual(await handler(owned, appInput), unavailable);
  assert.equal(current, true);
  retireRegistrationDuringHandoff = false;
  registrationCurrent = true;
  retire = true;
  assert.deepEqual(await handler(owned, appInput), unavailable);
  assert.equal(admitted, 4);
});

test("preload uses one selection channel and withholds unexpected receipt fields or failures", async () => {
  let reply: unknown = { ok: true, value: exact };
  const api = createDesktopPreloadApi({ ipcRenderer: {
    async invoke(channel, ...inputs) {
      assert.equal(channel, DESKTOP_HEADLESS_LOCAL_FILE_SELECTION_CHANNEL);
      assert.deepEqual(inputs, [appInput]);
      return reply;
    },
  } });
  assert.deepEqual(await api.selectHeadlessLocalFile(appInput), exact);
  reply = { ok: true, value: { ...exact, fileId: "file.other" } };
  assert.equal(await api.selectHeadlessLocalFile(appInput), undefined);
  reply = { ok: true, value: { ...exact, path: "unrequested" } };
  assert.equal(await api.selectHeadlessLocalFile(appInput), undefined);
  reply = { ok: true, value: exact, path: "unrequested" };
  assert.equal(await api.selectHeadlessLocalFile(appInput), undefined);
  reply = unavailable;
  assert.equal(await api.selectHeadlessLocalFile(appInput), undefined);
});
