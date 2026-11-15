import assert from "node:assert/strict";
import test from "node:test";
import { createStructuredIngestionAcquisitionRepository } from "../../../../adapters/persistence/ingestion";
import { createStructuredHeadlessLocalFileSelectionRepository } from "../../../../adapters/persistence/ingestion/createStructuredHeadlessLocalFileSelectionRepository";
import { createStructuredOrganizationRepositories } from "../../../../adapters/persistence/organization";
import { createInMemoryStructuredDocumentStore } from "../../../../adapters/persistence/shared";
import { createLocalWorkspaceRepository } from "../../../../adapters/persistence/workspace";
import { createDesktopHeadlessClientAuthority } from "../../../../adapters/security/headless";
import { HEADLESS_CONTRACT_VERSION, isHeadlessHostIncarnationId, type AppHeadlessLocalFileSelectionRequest } from "../../../../contracts/headless";
import { normalizeIngestionTaskFileId, normalizeIngestionTaskId } from "../../../../contracts/ingestion";
import { createOrganizationId } from "../../../../contracts/organization";
import { createWorkspaceId } from "../../../../contracts/workspace";
import { composeDesktopHeadlessLocalFileSelection } from "../composeDesktopHeadlessLocalFileSelection";

const fixtureHost = "632cfa6b-c323-419a-b2bd-5880b1f34858";
assert.ok(isHeadlessHostIncarnationId(fixtureHost));
const hostIncarnationId = fixtureHost;
const organizationId = createOrganizationId("org.desktop-data-fixture");
const workspaceId = createWorkspaceId("workspace.desktop-data-fixture");
const taskId = normalizeIngestionTaskId("ingestion.selected");
const fileId = normalizeIngestionTaskFileId("file.selected");
const at = "2026-11-13T00:00:00.000Z";
const now = () => Date.parse(at);
const identity = { organizationId, principalId: "fixture-owner", principalDisplayName: "Fixture", createdAt: at, updatedAt: at };
const forbidden = { ok: false, code: "headless.forbidden" };

async function fixture() {
  const platform = createInMemoryStructuredDocumentStore();
  const documents = platform.forOrganization(organizationId);
  const repositories = createStructuredOrganizationRepositories(platform);
  const member = { organizationId, principalId: identity.principalId, role: "owner" as const, createdAt: at, updatedAt: at };
  await repositories.organizations.saveOrganization({ organizationId, displayName: "Fixture", status: "active", createdAt: at, updatedAt: at });
  await repositories.memberships.saveMembership({ ...member, status: "active" });
  const workspaces = createLocalWorkspaceRepository({ documents, rootDirectory: "." });
  await workspaces.saveWorkspace({ organizationId, workspaceId, displayName: "Data fixture",
    status: "active", createdAt: at, updatedAt: at });
  const tasks = createStructuredIngestionAcquisitionRepository(documents);
  const task = await tasks.createTask({
    schemaVersion: "1.0", organizationId, workspaceId, taskId, kind: "file-batch", status: "queued",
    revision: 1, cleanupPending: true, createdAt: at, updatedAt: at, checkpointExpiresAt: "2026-11-13T00:01:00.000Z",
    files: [{ fileId, checkpointId: "checkpoint.sample", fileName: "synthetic.csv", mediaType: "text/csv",
      status: "pending", totalBytes: 0, acceptedBytes: 0, nextChunkIndex: 0 }],
    progress: { totalItems: 1, completedItems: 0, totalBytes: 0, acceptedBytes: 0, percent: 0 },
  });
  const registry = createDesktopHeadlessClientAuthority({ documents, identity,
    canReadWorkspace: async id => id === workspaceId, canReviewPlans: async id => id === workspaceId });
  const counts = { loaded: 0, reads: 0, transactions: 0, open: true, caller: true };
  const config = { beforeTaskRead: async () => {}, beforeTransaction: async (_ordinal: number) => {} };
  const owned = platform.runInOwnedTransaction!.bind(platform);
  const makeRequest = async (mode: "plan-review" | "read"): Promise<AppHeadlessLocalFileSelectionRequest> => {
    const pairing = await registry.beginPairing(workspaceId, () => true, mode);
    assert.equal(pairing.status, "ready");
    const paired = await registry.completePairing(pairing.pairingCode);
    assert.equal(paired.status, "paired");
    return { version: HEADLESS_CONTRACT_VERSION, operation: "data.select-local-file", input: {
      hostIncarnationId, workspaceId, taskId, fileId, taskRevision: 1,
      registeredClientId: paired.registeredClientId, expectedSelectionRevision: 0,
    } };
  };
  const service = composeDesktopHeadlessLocalFileSelection({
    hostIncarnationId, identity, rootDirectory: ".", now,
    platform: {
      ...platform,
      async runInOwnedTransaction(work, beforeCommit) {
        await config.beforeTransaction(++counts.transactions);
        return owned(work, beforeCommit);
      },
    },
    isOpen: () => counts.open, capturePlanReviewClients: registry.capturePlanReviewClients,
    async getIngestionTasks() {
      counts.loaded++;
      return {
        async executeCommand(command, context) {
          counts.reads++;
          assert.deepEqual(command, { action: "read", taskId });
          assert.deepEqual(context, { organizationId, principalId: identity.principalId, workspaceId });
          await config.beforeTaskRead();
          return { ok: true, value: { kind: "task", task: (await tasks.readTask(workspaceId, taskId))! } };
        },
      };
    },
  });
  const stored = createStructuredHeadlessLocalFileSelectionRepository(documents, now);
  const isSelected = (request: AppHeadlessLocalFileSelectionRequest) => {
    const { registeredClientId, expectedSelectionRevision: _expected, ...target } = request.input;
    return stored.matches({ organizationId, principalId: identity.principalId, registeredClientId, target });
  };
  return { service, counts, config, makeRequest, registry, repositories, member, isSelected, tasks, task };
}

test("the app reuses the actual registered plan-review client and loads ingestion only when admitted", async () => {
  const { service, counts, makeRequest, registry, isSelected, tasks, task } = await fixture();
  try {
    const pending = await makeRequest("read");
    const request = await makeRequest("plan-review");
    assert.deepEqual(await service.select(pending, () => true), forbidden);
    assert.equal(counts.loaded, 0);
    const receipt = await service.select(request, () => true);
    assert.ok(receipt.ok);
    assert.equal(receipt.receiptIsCurrent(), true);
    assert.deepEqual(receipt.value, {
      workspaceId, taskId, fileId, taskRevision: 1, selectionRevision: 1,
    });
    assert.equal(counts.loaded, 1);
    assert.equal(counts.reads, 2);
    assert.equal(await isSelected(request), true);
    assert.deepEqual(await tasks.readTask(workspaceId, taskId), task);
    assert.equal(await registry.revokeClient(request.input.registeredClientId), true);
    assert.equal(receipt.receiptIsCurrent(), false);
  } finally { registry.close(); }
});

test("a retired app frame or selected registration cannot publish a Desktop selection confirmation", async () => {
  for (const retirement of ["frame", "registration", "workspace-access"] as const) {
    const { service, counts, config, makeRequest, registry, repositories, member, isSelected } = await fixture();
    try {
      const request = await makeRequest("plan-review");
      config.beforeTaskRead = async () => {
        if (retirement === "frame") counts.caller = false;
        else if (retirement === "registration") assert.equal(await registry.revokeClient(request.input.registeredClientId), true);
        else await repositories.memberships.saveMembership({ ...member, status: "suspended" });
      };
      assert.deepEqual(await service.select(request, () => counts.caller), forbidden);
      assert.equal(counts.reads, 1);
      assert.equal(await isSelected(request), false);
      const alreadyLoaded = counts.loaded;
      assert.deepEqual(await service.select(request, () => counts.caller), forbidden);
      assert.equal(counts.loaded, alreadyLoaded);
    } finally { registry.close(); }
  }
});

test("suspending role access after the last preflight denies the actual owned selection write", async () => {
  const { service, counts, config, makeRequest, registry, repositories, member, isSelected } = await fixture();
  try {
    const request = await makeRequest("plan-review");
    let retired = false;
    config.beforeTransaction = async ordinal => {
      // The four preflight transactions already completed. This is the selection owner.
      if (ordinal === 5) {
        assert.equal(counts.reads, 1);
        await repositories.memberships.saveMembership({ ...member, status: "suspended" });
        retired = true;
      }
    };
    assert.deepEqual(await service.select(request, () => true), forbidden);
    assert.equal(retired, true);
    assert.equal(await isSelected(request), false);
  } finally { registry.close(); }
});

test("only the exact paired agent can preview the current selection and owned data protects reply release", async () => {
  const { service, registry, makeRequest, tasks, task } = await fixture();
  try {
    const appSelection = await makeRequest("plan-review");
    const otherSelection = await makeRequest("plan-review");
    const { registeredClientId, expectedSelectionRevision: _expected, ...input } = appSelection.input;
    const request = { version: HEADLESS_CONTRACT_VERSION, operation: "data.prepare-local-file", input } as const;
    const grant = { organizationId, principalId: identity.principalId, registeredClientId,
      workspaceIds: [workspaceId], operations: [], planReview: true as const, isCurrent: () => true };
    assert.deepEqual((await service.preview(request, grant)).result, forbidden);
    assert.ok((await service.select(appSelection, () => true)).ok);
    assert.deepEqual((await service.preview(request, { ...grant, planReview: undefined })).result, forbidden);
    assert.deepEqual((await service.preview(request, { ...grant, registeredClientId: otherSelection.input.registeredClientId })).result, forbidden);
    assert.deepEqual((await service.preview(request, { ...grant, workspaceIds: [] })).result, forbidden);
    const pending = await service.preview(request, grant);
    assert.deepEqual(pending.result, { ok: true, value: { workspaceId, taskId, fileId, taskRevision: 1,
      mediaType: "text/csv", fileBytes: 0, checkpointExpiresAt: now() + 60_000, effect: "save-local-source", externalProviderCalls: 0 } });
    let releases = 0;
    const send = () => { releases++; return true; };
    assert.equal(await pending.publishIfCurrent?.(send), true);
    assert.ok((await service.select({ ...otherSelection,
      input: { ...otherSelection.input, expectedSelectionRevision: 1 } }, () => true)).ok);
    assert.equal(await pending.publishIfCurrent?.(send), false);
    assert.deepEqual((await service.preview(request, grant)).result, forbidden);
    assert.ok((await service.select({ ...appSelection,
      input: { ...appSelection.input, expectedSelectionRevision: 2 } }, () => true)).ok);
    const current = await service.preview(request, grant);
    assert.ok(current.result.ok);
    await tasks.saveTask({ ...task, revision: 2, updatedAt: "2026-11-13T00:00:01.000Z" }, 1);
    assert.equal(await current.publishIfCurrent?.(send), false);
    assert.deepEqual((await service.preview(request, grant)).result, { ok: false, code: "headless.stale" });
    assert.equal(releases, 1);
  } finally { registry.close(); }
});
