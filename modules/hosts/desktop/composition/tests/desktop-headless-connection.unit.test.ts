import assert from "node:assert/strict";
import { AsyncResource } from "node:async_hooks";
import { createHash, randomUUID } from "node:crypto";
import { request } from "node:https";
import { test } from "node:test";
import { createInMemoryStructuredDocumentStore } from "../../../../adapters/persistence/shared";
import type { StructuredDocumentStore, StructuredDocumentWriteOptions } from "../../../../adapters/persistence/shared";
import { HEADLESS_CONTRACT_VERSION, UI_CONTROL_VERSION, isHeadlessHostIncarnationId, parseHeadlessBuildPlanProposal,
  readHeadlessPlanReviewAgentRequest, readHeadlessPlanReviewAgentResult, readHeadlessPlanStepResult,
  readHeadlessWindowResult } from "../../../../contracts/headless";
import { createStructuredOrganizationRepositories } from "../../../../adapters/persistence/organization";
import { createLocalWorkspaceRepository } from "../../../../adapters/persistence/workspace";
import { createStructuredHeadlessOperationStore, createStructuredSystemBuilderRepository } from "../../../../adapters/persistence/system-builder";
import { createStructuredHeadlessPlanReviewRepository } from "../../../../adapters/persistence/system-builder/createStructuredHeadlessPlanReviewRepository";
import { createDesktopHeadlessClientAuthority } from "../../../../adapters/security/headless";
import { normalizeAssetId } from "../../../../contracts/asset";
import { createOrganizationId } from "../../../../contracts/organization";
import { normalizeSystemBuilderSystemId, normalizeSystemBuilderRevisionId,
  type SystemBuilderRecord, type SystemBuilderRevision } from "../../../../contracts/system-builder";
import { createWorkspaceId } from "../../../../contracts/workspace";
import { createDesktopPinnedLoopbackAgent } from "../../../../adapters/transport/headless-loopback";
import { composeDesktopHeadlessConnection } from "../composeDesktopHeadlessConnection";
import { composeDesktopHeadlessPlanReview } from "../composeDesktopHeadlessPlanReview";
import { composeDesktopHeadlessPlanApprovals } from "../composeDesktopHeadlessPlanApprovals";
import { composeDesktopWorkspaceAuthorization } from "../composeDesktopWorkspaceAuthorization";
import { composeDesktopUiControl } from "../composeDesktopUiControl";
import { composeSystemBuilder } from "../../../shared/composition/composeSystemBuilder";

const workspaceId = createWorkspaceId("local-connection-workspace");
const organizationId = createOrganizationId("local-connection-org");
const at = "2026-11-13T00:00:00.000Z";
const hostIncarnationId = "632cfa6b-c323-419a-b2bd-5880b1f34858";
assert.ok(isHeadlessHostIncarnationId(hostIncarnationId));

function call(connector: { endpoint: string; fingerprint: string }, path: "pair" | "read" | "window" | "plan-review" | "plan-step", input: object, credential?: string) {
  const body = JSON.stringify(input);
  return new Promise<{ status: number; result: { value?: { credential?: string; registeredClientId?: string } } }>((resolve, reject) => {
    const req = request(new URL("/aisb-headless/v1/" + path, connector.endpoint), {
      method: "POST", agent: createDesktopPinnedLoopbackAgent(connector.endpoint, connector.fingerprint),
      headers: { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(body),
        ...(credential ? { Authorization: "Bearer " + credential } : {}) },
    }, (res) => {
      let text = "";
      res.setEncoding("utf8").on("data", (chunk: string) => { text += chunk; });
      res.on("error", reject);
      res.on("end", () => {
        try { resolve({ status: res.statusCode!, result: JSON.parse(text) }); } catch (error) { reject(error); }
      });
    });
    req.setTimeout(8_000, () => req.destroy(new Error("Fixture response timed out.")));
    req.on("error", reject).end(body);
  });
}

test("composes staged desktop plans with the same live workspace membership and saved revisions", { timeout: 12_000 }, async () => {
  const platform = createInMemoryStructuredDocumentStore();
  const documents = platform.forOrganization(organizationId);
  const identity = { organizationId, principalId: "fixture-planning-owner", principalDisplayName: "Fixture", createdAt: at, updatedAt: at };
  const repositories = createStructuredOrganizationRepositories(platform);
  await repositories.organizations.saveOrganization({ organizationId, displayName: "Fixture", status: "active", createdAt: at, updatedAt: at });
  const membership = { organizationId, principalId: identity.principalId, role: "owner" as const, createdAt: at, updatedAt: at };
  await repositories.memberships.saveMembership({ ...membership, status: "active" });
  const workspaces = createLocalWorkspaceRepository({ documents, rootDirectory: "." });
  await workspaces.saveWorkspace({ organizationId, workspaceId, displayName: "Plan fixture", status: "active", createdAt: at, updatedAt: at });
  const baseAuthorization = composeDesktopWorkspaceAuthorization({ documents: platform, localIdentity: identity });
  let revokeWhenCommitted: (() => Promise<void>) | undefined;
  let pendingRevocation: Promise<void> | undefined;
  const authorization = {
    async authorizeWorkspaceOperation(input: Parameters<typeof baseAuthorization.authorizeWorkspaceOperation>[0]) {
      if (input.operation === "headless.plan.run-step") await pendingRevocation;
      return baseAuthorization.authorizeWorkspaceOperation(input);
    },
  };
  let open = true;
  const planReview = composeDesktopHeadlessPlanReview({ platform, hostIncarnationId, identity, workspaces, authorization,
    rootDirectory: ".", isOpen: () => open, systems: composeSystemBuilder({
      documents, definitions: { async readExactDefinition() { return undefined; } },
      assetRegistryRead: {
        async listDefinitionCards() { return { items: [] }; },
        async readDefinitionDetail() { return undefined; },
      },
    }), audit: {
      window() {},
      backend(_operation, _workspaceId, status) {
        if (status !== "committed" || !revokeWhenCommitted) return;
        const revoke = revokeWhenCommitted;
        revokeWhenCommitted = undefined;
        pendingRevocation = revoke();
      },
      counts: () => ({ pending: 0, failed: 0, dropped: 0 }),
      async close() {},
    } });
  const connector = composeDesktopHeadlessConnection({ documents, identity, workspaces, authorization, planReview,
    async read() { return { ok: false, code: "headless.forbidden" }; },
  });
  const approvals = composeDesktopHeadlessPlanApprovals({ platform, hostIncarnationId, identity, rootDirectory: ".",
    isOpen: () => open, capturePlanReviewClients: connector.capturePlanReviewClients });
  try {
    const pairing = await connector.beginPairing(workspaceId, () => true, "plan-review");
    assert.equal(pairing.status, "ready");
    const paired = await call(pairing, "pair", { pairingCode: pairing.pairingCode });
    assert.equal(paired.status, 200);
    const { credential, registeredClientId } = paired.result.value ?? {};
    assert.ok(credential && registeredClientId);
    const scope = { hostIncarnationId, workspaceId };
    function planned(steps: readonly unknown[]) {
      const proposed = parseHeadlessBuildPlanProposal({ ...scope, steps }, hostIncarnationId);
      assert.ok(proposed.ok);
      const fingerprint = createHash("sha256").update(JSON.stringify(proposed.preview), "utf8").digest("hex");
      return { ...scope, fingerprint, steps };
    }
    const ordinary = planned([{ operation: "systems.create", name: "Synthetic proposed system",
      templateId: "reference.secured-data-review@1.0.0", idempotencyKey: randomUUID() }]);
    const invalidReference = planned([{ operation: "systems.clone", name: "Synthetic copy", systemId: "fixture-missing-system",
      baseRecordRevision: 4, baseRevisionId: "fixture-missing-system.r2", idempotencyKey: randomUUID() }]);
    const submit = (input: typeof ordinary) => call(pairing, "plan-review",
      { version: HEADLESS_CONTRACT_VERSION, operation: "plan.submit", input }, credential);
    const read = () => call(pairing, "plan-review", { version: HEADLESS_CONTRACT_VERSION, operation: "plan.status",
      input: { ...scope, fingerprint: ordinary.fingerprint } }, credential);
    const staged = await submit(ordinary);
    assert.equal(staged.status, 200);
    const pending = readHeadlessPlanReviewAgentResult(staged.result, ordinary.fingerprint);
    assert.ok(pending.ok && pending.value.status === "pending" && pending.value.approvedSteps === 0);
    assert.deepEqual((await read()).result, staged.result);
    assert.equal((await submit(invalidReference)).status, 409);
    const systems = createStructuredSystemBuilderRepository(documents);
    function fixtureSystem(id: string) {
      const systemId = normalizeSystemBuilderSystemId(id);
      const revisionId = normalizeSystemBuilderRevisionId(id + ".r1");
      const composition = { compositionId: normalizeAssetId(id + ".composition"), compositionType: "system",
        displayName: "Fixture source", version: "0.1.0", lifecycleStatus: "draft",
        rootInstanceRefs: [], instanceRefs: [], bindingRefs: [], provenance: { sourceKind: "human-authored" } } as const;
      const record: SystemBuilderRecord = { systemId, targetWorkspaceId: workspaceId, name: "Fixture source", status: "draft",
        revision: 1, currentRevisionId: revisionId, composition, createdAt: at, updatedAt: at,
        createdBy: identity.principalId, updatedBy: identity.principalId };
      const revision: SystemBuilderRevision = { systemId, targetWorkspaceId: workspaceId, revisionId, revisionNumber: 1,
        composition, instances: [], bindings: [], validationIssues: [], createdAt: at, createdBy: identity.principalId };
      return { record, revision };
    }
    const source = fixtureSystem("fixture-saved-source");
    const dangling = fixtureSystem("fixture-dangling-source");
    await systems.createRecordAndRevision(source.record, source.revision);
    await systems.createRecord(dangling.record);
    const cloneFields = { operation: "systems.clone", name: "Synthetic copy" };
    const savedClone = { ...cloneFields, systemId: source.record.systemId,
      baseRecordRevision: 1, baseRevisionId: source.revision.revisionId };
    const validClone = planned([{ ...savedClone, idempotencyKey: randomUUID() }]);
    const stagedClone = await submit(validClone);
    assert.equal(stagedClone.status, 200);
    const absentRevision = planned([{ ...cloneFields, systemId: dangling.record.systemId,
      baseRecordRevision: 1, baseRevisionId: dangling.revision.revisionId, idempotencyKey: randomUUID() }]);
    assert.equal((await submit(absentRevision)).status, 409);
    await systems.updateRecord({ ...source.record, revision: 2, name: "Edited fixture" }, 1);
    assert.deepEqual(await submit(validClone), stagedClone);
    const newStaleClone = planned([{ ...savedClone, idempotencyKey: randomUUID() }]);
    assert.equal((await submit(newStaleClone)).status, 409);
    assert.equal((await submit({ ...ordinary, workspaceId: createWorkspaceId("different-fixture-workspace") })).status, 403);
    const caller = { channel: "app-popup" as const, isCurrent: () => true };
    const selection = { workspaceId, registeredClientId, fingerprint: ordinary.fingerprint };
    const denied = { ok: false, code: "forbidden" };
    const currentList = await approvals.list(workspaceId, caller.isCurrent);
    assert.ok(currentList.ok);
    assert.deepEqual(new Set(currentList.requests.map(entry => entry.fingerprint)), new Set([ordinary.fingerprint, validClone.fingerprint]));
    assert.ok(currentList.requests.every(entry => entry.registeredClientId === registeredClientId));
    assert.deepEqual(await approvals.list(createWorkspaceId("different-fixture-workspace"), caller.isCurrent), denied);
    assert.deepEqual(await approvals.open(selection, { ...caller, isCurrent: () => false }), denied);
    const shown = await approvals.open(selection, caller);
    assert.ok(shown.ok && shown.snapshot.state.status === "pending");
    const decide = { expectedRevision: 1, fingerprint: ordinary.fingerprint, decision: { kind: "approve", mode: "whole-plan" } };
    assert.deepEqual(await approvals.decide(selection, { ...decide, fingerprint: validClone.fingerprint }, caller), denied);
    const approved = await approvals.decide(selection, decide, caller);
    assert.ok(approved.ok && approved.state.status === "approved" && approved.state.lastChannel === "app-popup");
    assert.deepEqual(await approvals.decide(selection, decide, caller), { ok: false, code: "stale" });

    const rename = planned([{ operation: "systems.rename", name: "Approved fixture name", systemId: source.record.systemId,
      baseRecordRevision: 2, baseRevisionId: source.revision.revisionId, idempotencyKey: randomUUID() }]);
    assert.equal((await submit(rename)).status, 200);
    const exact = { ...scope, fingerprint: rename.fingerprint, approvalRevision: 2, step: 1 };
    const run = (input: typeof exact = exact) =>
      call(pairing, "plan-step", { version: HEADLESS_CONTRACT_VERSION, operation: "plan.run-step", input }, credential);
    assert.equal((await run()).status, 403);
    const renameTarget = { ...selection, fingerprint: rename.fingerprint };
    const decision = await approvals.decide(renameTarget, { ...decide, fingerprint: rename.fingerprint }, caller);
    assert.ok(decision.ok && decision.state.status === "approved");
    const differentPair = await connector.beginPairing(workspaceId, () => true, "plan-review");
    assert.equal(differentPair.status, "ready");
    const different = await call(differentPair, "pair", { pairingCode: differentPair.pairingCode });
    const otherCredential = different.result.value?.credential;
    assert.ok(otherCredential);
    assert.equal((await call(pairing, "plan-step", { version: HEADLESS_CONTRACT_VERSION, operation: "plan.run-step",
      input: exact }, otherCredential)).status, 403);
    assert.equal((await run({ ...exact, approvalRevision: 1 })).status, 403);
    assert.equal((await run({ ...exact, step: 2 })).status, 403);
    assert.equal((await run({ ...exact, workspaceId: createWorkspaceId("different-fixture-workspace") })).status, 403);
    const forgedInput = { ...exact, name: "Unapproved fixture name" };
    assert.equal((await run(forgedInput)).status, 400);
    const committed = await run();
    assert.equal(committed.status, 200);
    const saved = readHeadlessPlanStepResult(committed.result, exact);
    assert.ok(saved.ok && saved.value.kind === "committed");
    assert.equal(saved.value.reference.systemId, source.record.systemId);
    assert.equal(saved.value.reference.recordRevision, 3);
    assert.equal((await systems.readRecord(workspaceId, source.record.systemId))?.name, "Approved fixture name");
    const retry = await run();
    assert.equal(retry.status, 200);
    assert.deepEqual(readHeadlessPlanStepResult(retry.result, exact), { ok: true, value: { ...saved.value, kind: "replayed" } });
    assert.equal(await createStructuredHeadlessOperationStore(platform).watermark({ workspaceId, organizationId }), 1);
    assert.ok((await approvals.decide(renameTarget, { fingerprint: rename.fingerprint,
      expectedRevision: 2, decision: { kind: "revoke" } }, caller)).ok);
    assert.equal((await run()).status, 403);

    const withdrawing = planned([{ operation: "systems.rename", name: "Committed before withdrawal", systemId: source.record.systemId,
      baseRecordRevision: 3, baseRevisionId: source.revision.revisionId, idempotencyKey: randomUUID() }]);
    assert.equal((await submit(withdrawing)).status, 200);
    const withdrawingTarget = { ...selection, fingerprint: withdrawing.fingerprint };
    assert.ok((await approvals.decide(withdrawingTarget, { ...decide, fingerprint: withdrawing.fingerprint }, caller)).ok);
    revokeWhenCommitted = async () => {
      assert.ok((await approvals.decide(withdrawingTarget, { fingerprint: withdrawing.fingerprint,
        expectedRevision: 2, decision: { kind: "revoke" } }, caller)).ok);
    };
    const withheld = await run({ ...exact, fingerprint: withdrawing.fingerprint });
    assert.ok(pendingRevocation);
    await pendingRevocation;
    assert.deepEqual(withheld, { status: 403, result: { ok: false, code: "headless.forbidden" } });
    assert.equal((await systems.readRecord(workspaceId, source.record.systemId))?.name, "Committed before withdrawal");
    assert.equal(await createStructuredHeadlessOperationStore(platform).watermark({ workspaceId, organizationId }), 2);

    await repositories.memberships.saveMembership({ ...membership, status: "suspended" });
    assert.equal((await read()).status, 403);
    assert.deepEqual(await approvals.list(workspaceId, caller.isCurrent), denied);
    assert.deepEqual(await approvals.open(selection, caller), denied);
    assert.equal((await submit(ordinary)).status, 403);
    // A pre-transaction policy result cannot replace the saved current membership.
    const candidate = readHeadlessPlanReviewAgentRequest({ version: HEADLESS_CONTRACT_VERSION,
      operation: "plan.submit", input: ordinary }, hostIncarnationId);
    assert.ok(candidate.ok);
    const permissiveOuter = composeDesktopHeadlessPlanReview({ platform, hostIncarnationId, identity, workspaces,
      authorization: { async authorizeWorkspaceOperation() {} }, rootDirectory: ".", isOpen: () => open });
    const formerlyCurrent = { organizationId, principalId: identity.principalId, registeredClientId,
      workspaceIds: [workspaceId], operations: [], planReview: true as const, isCurrent: () => true };
    assert.deepEqual(await permissiveOuter.execute(candidate.request, formerlyCurrent, async () => formerlyCurrent),
      { ok: false, code: "headless.forbidden" });
    assert.equal((await documents.listDocuments("headless/system-builder/plan-reviews")).length, 4);
    await repositories.memberships.saveMembership({ ...membership, status: "active" });
    assert.equal(await connector.revoke(registeredClientId), true);
    assert.deepEqual(await approvals.list(workspaceId, caller.isCurrent), { ok: true, requests: [] });
    assert.deepEqual(await approvals.open(selection, caller), denied);
    assert.deepEqual(await approvals.decide(selection, { ...decide, expectedRevision: 2, decision: { kind: "revoke" } }, caller), denied);
  } finally {
    open = false;
    await connector.close();
  }
});

test("desktop approval commit and replies obey the same requester's lifetime", async t => {
  const conditions = ["revoke", "expire", "revocation-write-fails", "open-egress", "decide-egress"] as const;
  for (const condition of conditions) await t.test(condition, async () => {
    const base = createInMemoryStructuredDocumentStore();
    let onDecisionCommit: () => void = () => {};
    let onOwnedResult: () => void = () => {};
    let observedDecisionWrite = false;
    const platform: StructuredDocumentStore = {
      ...base,
      async runInOwnedTransaction(work, beforeCommit) {
        let stagedDecision = false;
        function watch(owner: StructuredDocumentStore): StructuredDocumentStore {
          return {
            ...owner,
            forOrganization(id) { return watch(owner.forOrganization(id)); },
            async writeDocument<T>(namespace: string, key: string, value: T, options?: StructuredDocumentWriteOptions) {
              const saved = await owner.writeDocument(namespace, key, value, options);
              if (namespace === "headless/system-builder/plan-reviews" && options?.expectedRevision === 1)
                stagedDecision = true;
              return saved;
            },
          };
        }
        const result = await base.runInOwnedTransaction!(owner => work(watch(owner)), () => {
          if (stagedDecision) {
            observedDecisionWrite = true;
            onDecisionCommit();
          }
          beforeCommit();
        });
        onOwnedResult();
        return result;
      },
    };
    const documents = platform.forOrganization(organizationId);
    const identity = { organizationId, principalId: "fixture-review-owner", principalDisplayName: "Fixture", createdAt: at, updatedAt: at };
    const provision = createStructuredOrganizationRepositories(platform);
    await provision.organizations.saveOrganization({ organizationId, displayName: "Fixture", status: "active", createdAt: at, updatedAt: at });
    await provision.memberships.saveMembership({ organizationId, principalId: identity.principalId, role: "owner",
      status: "active", createdAt: at, updatedAt: at });
    await createLocalWorkspaceRepository({ documents, rootDirectory: "." }).saveWorkspace({
      workspaceId, organizationId, displayName: "Fixture", status: "active", createdAt: at, updatedAt: at,
    });
    let clock = Date.parse(at);
    const now = () => clock;
    let failRevocationWrite = false;
    const registryDocuments: StructuredDocumentStore = { ...documents, async runInTransaction(work) {
      if (failRevocationWrite) throw new Error("The synthetic registry write failed.");
      return documents.runInTransaction(work);
    } };
    const registry = createDesktopHeadlessClientAuthority({ documents: registryDocuments, identity, now,
      canReadWorkspace: async target => target === workspaceId, canReviewPlans: async target => target === workspaceId,
    });
    const revocationCaller = new AsyncResource("fixture-desktop-revocation");
    try {
      const pending = await registry.beginPairing(workspaceId, () => true, "plan-review");
      assert.equal(pending.status, "ready");
      const requester = await registry.completePairing(pending.pairingCode);
      assert.equal(requester.status, "paired");
      if (condition === "expire" || condition.endsWith("-egress")) clock = requester.expiresAt - 100;
      const proposal = { hostIncarnationId, workspaceId, steps: [{ operation: "systems.create", name: "Fixture proposal",
        templateId: "reference.secured-data-review@1.0.0", idempotencyKey: randomUUID() }] };
      const decoded = parseHeadlessBuildPlanProposal(proposal, hostIncarnationId);
      assert.ok(decoded.ok);
      const fingerprint = createHash("sha256").update(JSON.stringify(decoded.preview), "utf8").digest("hex");
      const { registeredClientId } = requester;
      const target = { hostIncarnationId, fingerprint, scope: { organizationId, principalId: identity.principalId, workspaceId, registeredClientId } };
      const store = createStructuredHeadlessPlanReviewRepository(platform, async () => true, now);
      const staged = await store.propose({ target, isCurrent: () => true, proposal });
      assert.ok(staged.ok);
      const approvals = composeDesktopHeadlessPlanApprovals({ platform, hostIncarnationId, identity,
        rootDirectory: ".", isOpen: () => true, capturePlanReviewClients: registry.capturePlanReviewClients, now });
      const caller = { channel: "app-popup" as const, isCurrent: () => true };
      const selection = { workspaceId, registeredClientId, fingerprint };
      assert.ok((await approvals.open(selection, caller)).ok);
      const decision = { fingerprint, expectedRevision: 1, decision: { kind: "approve", mode: "whole-plan" } };
      if (condition === "open-egress" || condition === "decide-egress") {
        const decideAtEgress = condition === "decide-egress";
        let transactions = 0;
        let callerChecks = 0;
        let queuedExpiry = false;
        onOwnedResult = () => { transactions++; };
        const delayedCaller = { ...caller, isCurrent() {
          if (transactions === (decideAtEgress ? 3 : 2) && ++callerChecks === (decideAtEgress ? 2 : 1)) {
            queuedExpiry = true;
            queueMicrotask(() => { clock = requester.expiresAt; });
          }
          return true;
        } };
        const response = decideAtEgress ? await approvals.decide(selection, decision, delayedCaller)
          : await approvals.open(selection, delayedCaller);
        assert.equal(queuedExpiry, true);
        assert.deepEqual(response, { ok: false, code: "forbidden" });
        assert.equal(observedDecisionWrite, decideAtEgress);
        const stored = await store.read({ target, isCurrent: () => true });
        assert.ok(stored.ok && stored.snapshot.state.status === (decideAtEgress ? "approved" : "pending"));
        return;
      }
      let revoking: Promise<boolean> | undefined;
      onDecisionCommit = () => {
        if (condition === "expire") clock = requester.expiresAt;
        else {
          failRevocationWrite = condition === "revocation-write-fails";
          revoking = revocationCaller.runInAsyncScope(() => registry.revokeClient(registeredClientId));
        }
      };
      const response = await approvals.decide(selection, decision, caller);
      assert.equal(observedDecisionWrite, true);
      assert.deepEqual(response, { ok: false, code: "forbidden" });
      if (condition !== "expire") {
        assert.ok(revoking);
        assert.equal(await revoking, condition === "revoke");
        const enrollment = await documents.readDocument<readonly unknown[]>("headless-client-authority", "clients-v1");
        assert.equal(enrollment?.value.length, condition === "revoke" ? 0 : 1);
      }
      assert.deepEqual(await store.read({ target, isCurrent: () => true }), staged);
      assert.deepEqual(await approvals.list(workspaceId, caller.isCurrent), { ok: true, requests: [] });
      assert.deepEqual(await approvals.open(selection, caller), { ok: false, code: "forbidden" });
    } finally {
      revocationCaller.emitDestroy();
      registry.close();
    }
  });
});

test("pinned paired agents can request and present only with an exact interactive lease", async () => {
  const platform = createInMemoryStructuredDocumentStore();
  const documents = platform.forOrganization(organizationId);
  const identity = { organizationId, principalId: "fixture-owner", principalDisplayName: "Fixture", createdAt: at, updatedAt: at };
  const repositories = createStructuredOrganizationRepositories(platform);
  const workspace = { organizationId, workspaceId, displayName: "Fixture", status: "active" as const, createdAt: at, updatedAt: at };
  await repositories.organizations.saveOrganization({ ...workspace });
  await repositories.memberships.saveMembership({ organizationId, principalId: identity.principalId,
    role: "owner", status: "active", createdAt: at, updatedAt: at });
  const workspaces = createLocalWorkspaceRepository({ documents, rootDirectory: "." });
  await workspaces.saveWorkspace(workspace);
  let now = 100;
  let available = true;
  let beforePublish: (() => Promise<void>) | undefined;
  const control = composeDesktopUiControl({ identity, hostIncarnationId, rootDirectory: ".", documents: platform, isOpen: () => true, now: () => now,
    async canPresent(scope, intent) {
      return available && scope === workspaceId && intent.action === "open-system" && intent.systemId === "system-a" && intent.revisionId === "revision-a"
        ? { title: "Fixture resource" } : undefined;
    },
  });
  const connector = composeDesktopHeadlessConnection({ documents, identity, workspaces, presentation: {
    ...control, async authorizePublication(...args) {
      await beforePublish?.();
      return control.authorizePublication(...args);
    },
  },
    authorization: { async authorizeWorkspaceOperation() {} },
    async read() { return { ok: false, code: "headless.forbidden" }; },
  });
  try {
    assert.equal(await connector.readWorkspaceLabel(workspaceId, "plan-review"), undefined);
    assert.deepEqual(await connector.beginPairing(workspaceId, () => true, "plan-review"), { status: "denied" });
    const window = { hostIncarnationId, workspaceId, windowId: randomUUID(), uiIncarnationId: randomUUID() };
    const owner = { ...identity, isCurrent: () => true };
    assert.equal(control.authority.registerWindow(window, owner), true);
    const first = await connector.beginPairing(workspaceId, () => true, "presentation");
    assert.equal(first.status, "ready");
    const firstPaired = await call(first, "pair", { pairingCode: first.pairingCode });
    const credential = firstPaired.result.value?.credential;
    assert.ok(credential);
    const second = await connector.beginPairing(workspaceId, () => true);
    assert.equal(second.status, "ready");
    const other = (await call(second, "pair", { pairingCode: second.pairingCode })).result.value?.credential;
    assert.ok(other);
    const third = await connector.beginPairing(workspaceId, () => true, "presentation");
    assert.equal(third.status, "ready");
    const { credential: peer, registeredClientId: peerId } = (await call(third, "pair", { pairingCode: third.pairingCode })).result.value ?? {};
    assert.ok(peer && peerId);
    const dispatch = async (operation: string, input: object, selected = credential) => {
      const reply = await call(first, "window", { version: UI_CONTROL_VERSION, operation, input }, selected);
      return { status: reply.status, body: readHeadlessWindowResult(reply.result) };
    };
    assert.deepEqual((await dispatch("window.list", { hostIncarnationId, workspaceId })).body,
      { ok: true, value: { kind: "windows", windows: [window] } });
    assert.equal((await dispatch("window.list", { hostIncarnationId, workspaceId }, other)).status, 403);
    assert.equal((await dispatch("window.list", { hostIncarnationId, workspaceId: "other-workspace" })).status, 403);
    const prompt = { target: window, taskId: randomUUID(), requestKey: randomUUID() };
    assert.equal((await dispatch("window.request", { ...prompt, agentSessionId: randomUUID() })).status, 400);
    const request = (await dispatch("window.request", prompt)).body;
    assert.ok(request.ok && request.value.kind === "request" && request.value.request.status === "pending");
    const attempt = request.value.request.target;
    assert.equal(request.value.request.agentSessionId, firstPaired.result.value?.registeredClientId);
    assert.equal((await dispatch("window.accept", { target: attempt })).status, 400);
    assert.equal((await dispatch("window.status", { target: attempt }, peer)).status, 403);
    const accepted = await control.authority.accept(attempt, owner);
    assert.ok(accepted.status === "ok");
    const target = accepted.value.target;
    const commandId = randomUUID();
    const intent = { action: "open-system", systemId: "system-a", revisionId: "revision-a" };
    assert.equal((await dispatch("window.present", { target, commandId, intent })).status, 403);
    assert.equal((await control.authority.ready(target, owner)).status, "ok");
    const live = (await dispatch("window.status", { target: attempt })).body;
    assert.ok(live.ok && live.value.kind === "request" && live.value.lease?.leaseId === target.leaseId);
    assert.equal((await dispatch("window.present", { target, commandId, intent }, peer)).status, 403);
    assert.equal((await dispatch("window.present", { target, commandId, intent: { ...intent, systemId: "wrong" } })).status, 403);
    assert.equal((await dispatch("window.present", { target, commandId, intent })).status, 200);
    const queue = control.readDelivery(target);
    assert.equal(queue?.next(target, 1).status, "delivered");
    assert.equal(queue?.acknowledge(target, 1, commandId, "applied")?.status, "applied");
    assert.equal((await dispatch("window.present", { target, commandId, intent: { ...intent, revisionId: "revision-b" } })).status, 409);
    const context = { view: "other", ready: true, dirtyNavigationBlocked: false } as const;
    async function waitForChallenge() {
      for (let attempt = 0; attempt < 40; attempt++) {
        await new Promise(resolve => setTimeout(resolve, 5));
        const value = control.contextChallenge(target);
        if (value) return value;
      }
      assert.fail("Expected a current context challenge.");
    }
    const readingContext = dispatch("window.context", { target });
    const challenge = await waitForChallenge();
    assert.equal(control.publishContext(target, owner, context, randomUUID()), false);
    assert.equal(control.publishContext(target, owner, context, challenge), true);
    assert.equal(control.publishContext(target, owner, context, challenge), false);
    assert.deepEqual((await readingContext).body, { ok: true, value: { kind: "context", context } });
    const held = dispatch("window.context", { target });
    const heldChallenge = await waitForChallenge();
    beforePublish = async () => { now += 750; };
    assert.equal(control.publishContext(target, owner, context, heldChallenge), true);
    assert.equal((await held).status, 403);
    beforePublish = undefined;
    assert.equal((await dispatch("window.context", { target })).status, 503);
    assert.deepEqual((await dispatch("window.present", { target, commandId, intent })).body,
      { ok: true, value: { kind: "command", duplicate: true, receipt: { sequence: 1, commandId, status: "applied" } } });
    beforePublish = async () => { available = false; };
    assert.equal((await dispatch("window.present", { target, commandId, intent })).status, 403);
    beforePublish = undefined;
    available = true;
    assert.equal(await connector.revoke(peerId), true);
    assert.ok((await dispatch("window.status", { target: attempt })).body.ok);
    assert.equal(control.authority.revoke(target, owner).status, "ok");
    assert.equal((await dispatch("window.context", { target })).status, 403);
    assert.deepEqual(await dispatch("window.renew", { target }), { status: 200, body: { ok: true, value: { kind: "ended" } } });
    assert.equal(queue?.next(target, 1).status, "denied");
    const pendingPairing = await connector.beginPairing(workspaceId, () => true, "presentation");
    assert.equal(pendingPairing.status, "ready");
    connector.stopPresentationAdmission();
    control.close();
    const availability = await connector.status();
    assert.equal(availability.status === "ready" && availability.presentationAvailable, undefined);
    assert.equal((await connector.beginPairing(workspaceId, () => true, "presentation")).status, "denied");
    assert.equal((await call(pendingPairing, "pair", { pairingCode: pendingPairing.pairingCode })).status, 403);
    assert.equal((await dispatch("window.list", { hostIncarnationId, workspaceId })).status, 403);
    assert.equal((await connector.beginPairing(workspaceId, () => true, "read")).status, "ready");
  } finally { await connector.close(); }
});

test("starts only on explicit approved workspace pairing or reconnect and closes owned listener", async () => {
  const documents = createInMemoryStructuredDocumentStore().forOrganization(organizationId);
  let allowed = true;
  let focused = true;
  let policyReads = 0;
  let loseFocusOn: number | undefined;
  const compose = () => composeDesktopHeadlessConnection({
    documents,
    identity: { organizationId, principalId: "fixture-owner", principalDisplayName: "Fixture owner", createdAt: at, updatedAt: at },
    workspaces: { async readWorkspace(id) {
      return id === workspaceId ? { organizationId, workspaceId, displayName: "Fixture", status: "active", createdAt: at, updatedAt: at } : undefined;
    } },
    authorization: { async authorizeWorkspaceOperation() {
      if (++policyReads === loseFocusOn) focused = false;
      if (!allowed) throw new Error("Denied");
    } },
    async read(_input, grant) {
      const value = await grant();
      if (!value) return { ok: false, code: "headless.forbidden" };
      return { ok: true, operation: "host.describe", value: {
        version: HEADLESS_CONTRACT_VERSION, hostIncarnationId, workspaces: value.workspaceIds, operations: value.operations,
      } };
    },
  });
  const describe = { version: HEADLESS_CONTRACT_VERSION, operation: "host.describe", input: {} };
  const first = compose();
  let restart: ReturnType<typeof compose> | undefined;
  try {
    const before = await first.status();
    assert.ok(before.status === "ready" && !before.running && before.clients.length === 0);
    assert.equal(before.conversationAvailable, undefined);
    const approved = () => focused;
    assert.equal(await first.readWorkspaceLabel(workspaceId, "conversation"), undefined);
    assert.deepEqual(await first.beginPairing(workspaceId, approved, "conversation"), { status: "denied" });
    assert.equal(await first.startExistingClients(approved), "denied");
    assert.deepEqual(await first.beginPairing(createWorkspaceId("outside-fixture"), approved), { status: "denied" });
    loseFocusOn = policyReads + 1;
    assert.deepEqual(await first.beginPairing(workspaceId, approved), { status: "denied" });
    const afterLostFocus = await first.status();
    assert.ok(afterLostFocus.status === "ready" && !afterLostFocus.running);
    focused = true;
    const pairing = await first.beginPairing(workspaceId, approved);
    assert.equal(pairing.status, "ready");
    const reply = await call(pairing, "pair", { pairingCode: pairing.pairingCode });
    assert.equal(reply.status, 200);
    const { credential, registeredClientId } = reply.result.value ?? {};
    assert.ok(credential && registeredClientId);
    await first.close();
    await assert.rejects(call(pairing, "read", describe, credential));

    restart = compose();
    const dormant = await restart.status();
    assert.ok(dormant.status === "ready" && !dormant.running);
    assert.equal(dormant.clients[0]?.registeredClientId, registeredClientId);
    allowed = false;
    assert.equal(await restart.startExistingClients(approved), "denied");
    allowed = true;
    assert.equal(await restart.startExistingClients(approved), "started");
    const started = await restart.status();
    assert.ok(started.status === "ready" && started.running && started.endpoint && started.fingerprint);
    assert.equal((await call({endpoint: started.endpoint, fingerprint: started.fingerprint}, "read", describe, credential)).status, 200);
    assert.equal(await restart.revoke(registeredClientId), true);
    assert.equal((await call({endpoint: started.endpoint, fingerprint: started.fingerprint}, "read", describe, credential)).status, 403);
  } finally {
    await first.close();
    await restart?.close();
  }
});

test("drains a pending desktop management transaction before allowing persistence teardown", { timeout: 10_000 }, async () => {
  const store = createInMemoryStructuredDocumentStore().forOrganization(organizationId);
  let enter!: () => void;
  let resume!: () => void;
  const entered = new Promise<void>((resolve) => { enter = resolve; });
  const resumed = new Promise<void>((resolve) => { resume = resolve; });
  const documents: StructuredDocumentStore = {
    ...store,
    async runInTransaction(work) {
      enter();
      await resumed;
      return store.runInTransaction(work);
    },
  };
  const connection = composeDesktopHeadlessConnection({
    documents,
    identity: { organizationId, principalId: "fixture-owner", principalDisplayName: "Fixture owner", createdAt: at, updatedAt: at },
    workspaces: { async readWorkspace() { return undefined; } },
    authorization: { async authorizeWorkspaceOperation() { throw new Error("Not needed for revocation"); } },
    async read() { return { ok: false, code: "headless.forbidden" }; },
  });
  const revoking = connection.revoke("ba775977-1147-47b3-a589-580568e21d11");
  try {
    await entered;
    let closed = false;
    const closing = connection.close().then(() => { closed = true; });
    await Promise.resolve();
    assert.equal(closed, false);
    assert.equal(await connection.revoke("ba775977-1147-47b3-a589-580568e21d11"), false);
    assert.deepEqual(await connection.status(), { status: "unavailable" });
    assert.equal(closed, false);
    resume();
    assert.equal(await revoking, false);
    await closing;
    assert.equal(closed, true);
  } finally {
    resume();
    await connection.close();
  }
});

test("caps admitted management work without queuing extra persistence calls", { timeout: 10_000 }, async () => {
  const store = createInMemoryStructuredDocumentStore().forOrganization(organizationId);
  let reads = 0;
  let entered!: () => void;
  let resume!: () => void;
  const waiting = new Promise<void>((resolve) => { entered = resolve; });
  const released = new Promise<void>((resolve) => { resume = resolve; });
  const documents: StructuredDocumentStore = {
    ...store,
    async readDocument(namespace, key) {
      if (++reads === 4) entered();
      await released;
      return store.readDocument(namespace, key);
    },
  };
  const connection = composeDesktopHeadlessConnection({
    documents,
    identity: { organizationId, principalId: "fixture-owner", principalDisplayName: "Fixture owner", createdAt: at, updatedAt: at },
    workspaces: { async readWorkspace() { throw new Error("Not needed for status"); } },
    authorization: { async authorizeWorkspaceOperation() { throw new Error("Not needed for status"); } },
    async read() { return { ok: false, code: "headless.forbidden" }; },
  });
  const pending = Array.from({ length: 4 }, () => connection.status());
  try {
    await waiting;
    assert.deepEqual(await connection.status(), { status: "unavailable" });
    assert.equal(await connection.revoke("ba775977-1147-47b3-a589-580568e21d11"), false);
    assert.equal(reads, 4);
    resume();
    const admitted = await Promise.all(pending);
    assert.ok(admitted.every((result) => result.status === "ready"));
  } finally {
    resume();
    await connection.close();
  }
});
