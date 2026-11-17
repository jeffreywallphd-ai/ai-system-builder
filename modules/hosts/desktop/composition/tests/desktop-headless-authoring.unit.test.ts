import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtemp, realpath, rm } from "node:fs/promises";
import { request } from "node:https";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { openLocalSqliteDatabase, resolveLocalSqliteDatabasePolicy } from "../../../../adapters/persistence/sqlite";
import { createStructuredOrganizationRepositories } from "../../../../adapters/persistence/organization";
import { createLocalWorkspaceRepository } from "../../../../adapters/persistence/workspace";
import type { StructuredDocumentStore } from "../../../../adapters/persistence/shared";
import { createDesktopPinnedLoopbackAgent } from "../../../../adapters/transport/headless-loopback";
import {
  SYSTEM_FOUNDATION_PACK_MANIFEST, SYSTEM_FOUNDATION_PACK_V2_MANIFEST, SYSTEM_FOUNDATION_PACK_V3_MANIFEST,
} from "../../../../application/services/asset-packs/system-packs";
import type { AssetReference } from "../../../../contracts/asset";
import { HEADLESS_CONTRACT_VERSION, UI_CONTROL_VERSION, isHeadlessHostIncarnationId } from "../../../../contracts/headless";
import { createOrganizationId } from "../../../../contracts/organization";
import { createWorkspaceId } from "../../../../contracts/workspace";
import { composeSystemBuilder } from "../../../shared/composition/composeSystemBuilder";
import { composeDesktopHeadlessAuthoring } from "../composeDesktopHeadlessAuthoring";
import { composeDesktopHeadlessConnection } from "../composeDesktopHeadlessConnection";
import { composeDesktopUiControl } from "../composeDesktopUiControl";

const hostIncarnationId = (() => {
  const value = "632cfa6b-c323-419a-b2bd-5880b1f34858";
  if (!isHeadlessHostIncarnationId(value)) throw new Error("Invalid fixture");
  return value;
})();
const organizationId = createOrganizationId("fixture-desktop-org");
const workspaceId = createWorkspaceId("fixture-desktop-workspace");
const at = "2026-11-13T00:00:00.000Z";
const identity = { organizationId, principalId: "fixture-owner", principalDisplayName: "Fixture", createdAt: at, updatedAt: at };
const definitions = [SYSTEM_FOUNDATION_PACK_MANIFEST, SYSTEM_FOUNDATION_PACK_V2_MANIFEST, SYSTEM_FOUNDATION_PACK_V3_MANIFEST]
  .flatMap(({ assets }) => assets.map(({ definition }) => definition));
const findDefinition = async (reference: AssetReference) =>
  definitions.find(({ definitionId, version }) => definitionId === reference.id && version === reference.version);

function post(connector: { endpoint: string; fingerprint: string }, route: string, data: object, credential?: string) {
  const body = JSON.stringify(data);
  return new Promise<{ status: number; value?: { credential?: string; registeredClientId?: string; kind?: string }; code?: string }>((resolve, reject) => {
    const req = request(new URL(`/aisb-headless/v1/${route}`, connector.endpoint), {
      method: "POST", agent: createDesktopPinnedLoopbackAgent(connector.endpoint, connector.fingerprint),
      headers: { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(body),
        ...(credential ? { Authorization: "Bearer " + credential } : {}) },
    }, (response) => {
      let text = "";
      response.setEncoding("utf8").on("data", (chunk: string) => { text += chunk; });
      response.on("error", reject);
      response.on("end", () => {
        try { resolve({ status: response.statusCode, ...JSON.parse(text) }); } catch (error) { reject(error); }
      });
    });
    req.setTimeout(8_000, () => req.destroy(new Error("Fixture request timed out.")));
    req.on("error", reject).end(body);
  });
}

test("a paired writer saves through the real pinned connector and SQLite after the independent window revokes", async () => {
  const directory = await realpath(await mkdtemp(path.join(await realpath(tmpdir()), "desktop-headless-authoring-")));
  let database: Awaited<ReturnType<typeof openLocalSqliteDatabase>> | undefined;
  let control: ReturnType<typeof composeDesktopUiControl> | undefined;
  let connector: ReturnType<typeof composeDesktopHeadlessConnection> | undefined;
  try {
    database = await openLocalSqliteDatabase({ policy: resolveLocalSqliteDatabasePolicy({ dataRootDirectory: directory }) });
    const platform = database.documents;
    const documents = platform.forOrganization(organizationId);
    const organizations = createStructuredOrganizationRepositories(platform);
    await organizations.organizations.saveOrganization({ organizationId, displayName: "Fixture", status: "active", createdAt: at, updatedAt: at });
    await organizations.memberships.saveMembership({ organizationId, principalId: identity.principalId, role: "owner", status: "active", createdAt: at, updatedAt: at });
    let allowed = true;
    let open = true;
    let id = 0;
    const workspaces = createLocalWorkspaceRepository({ rootDirectory: directory, documents });
    const workspace = { organizationId, workspaceId, status: "active" as const, displayName: "Fixture", createdAt: at, updatedAt: at };
    await workspaces.saveWorkspace(workspace);
    let archiveBeforeOwner = false;
    let beforeNextWrite: (() => Promise<void>) | undefined;
    const platformForAuthor: StructuredDocumentStore = {
      ...platform,
      async runInOwnedTransaction(work, beforeCommit) {
        const pause = beforeNextWrite;
        beforeNextWrite = undefined;
        await pause?.();
        if (archiveBeforeOwner) {
          archiveBeforeOwner = false;
          await workspaces.updateWorkspace({ ...workspace, status: "archived" });
        }
        return platform.runInOwnedTransaction!(work, beforeCommit);
      },
    };
    const authorization = { async authorizeWorkspaceOperation(input: { requiredScopes: readonly string[] }) {
      if (!allowed && input.requiredScopes.includes("asset:write")) throw new Error("Fixture permission revoked.");
    } };
    const systems = composeSystemBuilder({
      documents, definitions: { readExactDefinition: findDefinition },
      assetRegistryRead: {
        async listDefinitionCards() { return { items: [] }; },
        async readDefinitionDetail(reference, options) {
          assert.equal(options?.workspaceId, workspaceId);
          const definition = await findDefinition(reference);
          return definition ? { definition, builtIn: true } : undefined;
        },
      },
      generateSystemId: () => `fixture-system-${++id}`,
    });
    control = composeDesktopUiControl({ hostIncarnationId, identity, documents: platform,
      rootDirectory: directory, isOpen: () => open });
    connector = composeDesktopHeadlessConnection({ identity, documents, workspaces, authorization, presentation: control,
      async read() { return { ok: false, code: "headless.unavailable" }; },
      authoring: composeDesktopHeadlessAuthoring({
        hostIncarnationId, identity, platformDocuments: platformForAuthor, rootDirectory: directory,
        workspaces, authorization, systems, isOpen: () => open,
      }),
    });
    async function pair(access: "read" | "author" | "presentation") {
      const address = await connector!.beginPairing(workspaceId, () => true, access);
      assert.equal(address.status, "ready");
      const paired = await post(address, "pair", { pairingCode: address.pairingCode });
      assert.equal(paired.status, 200);
      assert.ok(paired.value?.credential);
      return { address, credential: paired.value.credential, registeredClientId: paired.value.registeredClientId };
    }
    const reader = await pair("read");
    const writer = await pair("author");
    const presenter = await pair("presentation");
    assert.ok(presenter.registeredClientId);
    const requestedWindow = { hostIncarnationId, workspaceId, windowId: randomUUID(), uiIncarnationId: randomUUID() };
    const current = () => open;
    const interactiveOwner = { ...identity, isCurrent: current };
    const agent = { ...identity, registeredClientId: presenter.registeredClientId,
      agentSessionId: presenter.registeredClientId, isCurrent: current };
    assert.equal(control.authority.registerWindow(requestedWindow, interactiveOwner), true);
    const prompted = await control.authority.request({ version: UI_CONTROL_VERSION, target: requestedWindow,
      requestKey: randomUUID(), taskId: randomUUID() }, agent);
    assert.equal(prompted.status, "ok");
    if (prompted.status !== "ok") throw new Error("Window test consent was unavailable.");
    const accepted = await control.authority.accept(prompted.value.target, interactiveOwner);
    assert.equal(accepted.status, "ok");
    if (accepted.status !== "ok") throw new Error("Window test acceptance was unavailable.");
    const lease = accepted.value.target;
    assert.equal((await control.authority.ready(lease, interactiveOwner)).status, "ok");
    const command = {
      version: HEADLESS_CONTRACT_VERSION, operation: "systems.create", input: {
        hostIncarnationId, workspaceId, name: "Synthetic portal", templateId: "reference.secured-data-review@1.0.0",
        idempotencyKey: "a6f56324-2051-462c-b45b-d9b49bf6dd4a",
      },
    };
    assert.equal((await post(reader.address, "author", command, reader.credential)).status, 403);
    const admitted = Promise.withResolvers<void>();
    const resume = Promise.withResolvers<void>();
    beforeNextWrite = () => { admitted.resolve(); return resume.promise; };
    const committing = post(writer.address, "author", command, writer.credential);
    try {
      await Promise.race([admitted.promise, committing.then(() => { throw new Error("The save did not reach its transaction."); })]);
      assert.equal((await systems.useCases.list.execute({ workspaceId })).length, 0);
      assert.equal(control.authority.revoke(lease, interactiveOwner).status, "ok");
      assert.equal((await control.authority.agentStatus(prompted.value.target, agent)).status, "ended");
      assert.equal((await post(presenter.address, "window", { version: UI_CONTROL_VERSION,
        operation: "window.context", input: { target: lease } }, presenter.credential)).status, 403);
    } finally { resume.resolve(); }
    assert.equal((await committing).value?.kind, "committed");
    assert.equal((await post(writer.address, "author", command, writer.credential)).value?.kind, "replayed");
    const saved = await systems.useCases.list.execute({ workspaceId });
    assert.equal(saved.length, 1);
    assert.equal(saved[0]?.name, "Synthetic portal");
    const nextSave = { ...command, input: { ...command.input, name: "Synthetic follow-up", idempotencyKey: randomUUID() } };
    assert.equal((await post(writer.address, "author", nextSave, writer.credential)).value?.kind, "committed");
    allowed = false;
    assert.equal((await post(writer.address, "author", command, writer.credential)).status, 403);
    assert.equal((await systems.useCases.list.execute({ workspaceId })).length, 2);
    allowed = true;
    archiveBeforeOwner = true;
    const next = { ...command, input: { ...command.input, name: "Must not be saved", idempotencyKey: "ff6faed0-9705-40bd-b325-49b34f06588f" } };
    assert.equal((await post(writer.address, "author", next, writer.credential)).status, 403);
    assert.equal((await systems.useCases.list.execute({ workspaceId })).length, 2);
    const receipts = await documents.listDocuments("headless/system-builder/receipts");
    assert.equal(receipts.length, 2);
    assert.equal((await documents.listDocuments<{ watermark: number }>("headless/system-builder/changes"))[0]?.value.watermark, 2);
    open = false;
  } finally {
    control?.close();
    try { await connector?.close(); } finally { await database?.close(); await rm(directory, { recursive: true, force: true }); }
  }
});
