import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtemp, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import type { IpcMainHandlePort } from "../../../../../modules/adapters/transport/ipc-electron/ipcMainHandlePort";
import { openLocalSqliteDatabase, resolveLocalSqliteDatabasePolicy } from "../../../../../modules/adapters/persistence/sqlite";
import { createStructuredOrganizationRepositories } from "../../../../../modules/adapters/persistence/organization";
import { createLocalWorkspaceRepository } from "../../../../../modules/adapters/persistence/workspace";
import { DESKTOP_UI_CONTROL_CHANNELS, UI_CONTROL_VERSION, isHeadlessHostIncarnationId, readUiControlObservation } from "../../../../../modules/contracts/headless";
import { createOrganizationId } from "../../../../../modules/contracts/organization";
import { createWorkspaceId } from "../../../../../modules/contracts/workspace";
import { composeDesktopUiControl, type DesktopUiControlOwner } from "../../../../../modules/hosts/desktop/composition/composeDesktopUiControl";
import { createUiControlAuthority } from "../../../../../modules/application/services/ui-control/ui-control-authority.service";
import { registerDesktopUiControlIpc } from "../desktopUiControlIpc";

const id = "e38b2781-e605-4de3-83e1-000000000001";
const hostIncarnationId = (() => {
  assert.ok(isHeadlessHostIncarnationId(id));
  return id;
})();

test("only the exact current interactive sender can register a workspace, and a held read cannot restore it after retirement", async () => {
  const handlers = new Map<string, (event: unknown, input: unknown) => Promise<unknown>>();
  const ipcMain: IpcMainHandlePort = { handle(channel, listener) {
    handlers.set(channel, (event, input) => listener(event, input as never));
  } };
  const frame = {};
  const window = {};
  const authorizedEvent = {};
  const authorizationCalls: string[] = [];
  let finish!: (value: boolean) => void;
  let held = true;
  const auth = createUiControlAuthority({ hostIncarnationId, now: () => 100,
    issueId: () => id, authorize: async () => true,
  });
  const owner: DesktopUiControlOwner = {
    hostIncarnationId,
    identity: {
      organizationId: createOrganizationId("fixture"), principalId: "fixture-user",
      principalDisplayName: "Fixture user", createdAt: "2026-11-14T00:00:00Z", updatedAt: "2026-11-14T00:00:00Z",
    },
    authority: auth,
    canObserve(workspaceId: string) {
      authorizationCalls.push(workspaceId);
      return held ? new Promise<boolean>(resolve => { finish = resolve; }) : Promise.resolve(true);
    },
  };
  const lifecycle = registerDesktopUiControlIpc({ ipcMain, getOwner: () => owner, resolve: event =>
    event === authorizedEvent ? { window, frame, isCurrent: () => true } : undefined,
  });
  const observe = handlers.get(DESKTOP_UI_CONTROL_CHANNELS.observe)!;
  assert.deepEqual(await observe({}, "fixture-workspace"), { status: "unavailable" });
  assert.deepEqual(await observe(authorizedEvent, { workspaceId: "fixture-workspace" }), { status: "unavailable" });
  const read = observe(authorizedEvent, "fixture-workspace");
  assert.deepEqual(readUiControlObservation(await observe(authorizedEvent, "fixture-workspace")), { status: "busy" });
  assert.deepEqual(authorizationCalls, ["fixture-workspace"]);
  lifecycle.retire(window);
  finish(true);
  assert.deepEqual(await read, { status: "unavailable" });
  held = false;
  assert.deepEqual(readUiControlObservation(await observe(authorizedEvent, "another-workspace")), { status: "ready" });
  assert.deepEqual(authorizationCalls, ["fixture-workspace", "another-workspace"]);
  assert.equal(await handlers.get(DESKTOP_UI_CONTROL_CHANNELS.revoke)!({}, null), false);
  assert.equal(readUiControlObservation({ status: "busy", request: null }), undefined);
  assert.equal(readUiControlObservation({ status: "ready", request: {} }), undefined);
});

test("a committed workspace or membership change denies the composed owner, and revoke before IPC egress discards the grant", async () => {
  const directory = await realpath(await mkdtemp(join(await realpath(tmpdir()), "desktop-window-control-")));
  const database = await openLocalSqliteDatabase({ policy: resolveLocalSqliteDatabasePolicy({ dataRootDirectory: directory }) });
  try {
    const organizationId = createOrganizationId("fixture-owner");
    const workspaceId = createWorkspaceId("window-workspace");
    const at = "2026-11-14T00:00:00Z";
    const identity = { organizationId, principalId: "user", principalDisplayName: "Fixture", createdAt: at, updatedAt: at };
    const organization = createStructuredOrganizationRepositories(database.documents);
    const membership = { organizationId, principalId: identity.principalId, role: "owner" as const, status: "active" as const, createdAt: at, updatedAt: at };
    await organization.organizations.saveOrganization({ organizationId, status: "active", displayName: "Fixture", createdAt: at, updatedAt: at });
    await organization.memberships.saveMembership(membership);
    const workspaces = createLocalWorkspaceRepository({ rootDirectory: directory, documents: database.documents.forOrganization(organizationId) });
    const workspace = { organizationId, workspaceId, status: "active" as const, displayName: "Fixture", createdAt: at, updatedAt: at };
    await workspaces.saveWorkspace(workspace);
    const composed = composeDesktopUiControl({ identity, hostIncarnationId, documents: database.documents, rootDirectory: directory, isOpen: () => true });
    const window = {};
    const frame = {};
    const trustedEvent = {};
    const handlers = new Map<string, (event: unknown, input: unknown) => Promise<unknown>>();
    const ipcMain: IpcMainHandlePort = { handle(channel, listener) {
      handlers.set(channel, (event, input) => listener(event, input as never));
    } };
    let target: Parameters<typeof composed.authority.registerWindow>[0];
    const owner = { ...composed, authority: { ...composed.authority,
      registerWindow(input: unknown, token: Parameters<typeof composed.authority.registerWindow>[1]) {
        target = input;
        return composed.authority.registerWindow(input, token);
      },
      async accept(input: unknown, token: Parameters<typeof composed.authority.accept>[1]) {
        const result = await composed.authority.accept(input, token);
        if (result.status === "ok") assert.equal(composed.authority.revoke(result.value.target, token).status, "ok");
        return result;
      },
    } };
    registerDesktopUiControlIpc({ ipcMain, getOwner: () => owner, resolve: event =>
      event === trustedEvent ? { window, frame, isCurrent: () => true } : undefined,
    });
    const observe = () => handlers.get(DESKTOP_UI_CONTROL_CHANNELS.observe)!(trustedEvent, workspaceId);
    const accept = (event: unknown, input: unknown) => handlers.get(DESKTOP_UI_CONTROL_CHANNELS.accept)!(event, input);
    await observe();
    const agent = { organizationId, principalId: identity.principalId, registeredClientId: randomUUID(),
      agentSessionId: randomUUID(), isCurrent: () => true };
    const nextRequest = async () => {
      const result = await composed.authority.request({ version: UI_CONTROL_VERSION, target,
        requestKey: randomUUID(), taskId: randomUUID() }, agent);
      assert.equal(result.status, "ok");
      if (result.status !== "ok") throw new Error("Expected a current fixture request.");
      return result.value;
    };
    const first = await nextRequest();
    assert.deepEqual(await observe(), { status: "ready", request: first });
    assert.equal(await accept({}, first.target), undefined);
    assert.equal(await accept(trustedEvent, first.target), undefined);
    assert.equal((await composed.authority.agentStatus(first.target, agent)).status, "ended");
    const second = await nextRequest();
    await organization.memberships.saveMembership({ ...membership, status: "suspended" });
    assert.equal(await accept(trustedEvent, second.target), undefined);
    assert.deepEqual(await observe(), { status: "unavailable" });
    await organization.memberships.saveMembership(membership);
    assert.deepEqual(await observe(), { status: "ready" });
    await workspaces.updateWorkspace({ ...workspace, status: "archived" });
    assert.deepEqual(await observe(), { status: "unavailable" });
  } finally {
    await database.close();
    await rm(directory, { recursive: true, force: true });
  }
});
