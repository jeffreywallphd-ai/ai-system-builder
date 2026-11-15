import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { test } from "node:test";
import { createInMemoryStructuredDocumentStore } from "../../../../adapters/persistence/shared";
import { createStructuredHeadlessOperationStore, createStructuredSystemBuilderRepository } from "../../../../adapters/persistence/system-builder";
import type { AssetReference } from "../../../../contracts/asset";
import { HEADLESS_CONTRACT_VERSION, isHeadlessHostIncarnationId } from "../../../../contracts/headless";
import { createOrganizationId } from "../../../../contracts/organization";
import { createWorkspaceId } from "../../../../contracts/workspace";
import {
  SYSTEM_FOUNDATION_PACK_MANIFEST, SYSTEM_FOUNDATION_PACK_V2_MANIFEST, SYSTEM_FOUNDATION_PACK_V3_MANIFEST,
} from "../../../services/asset-packs/system-packs";
import { SystemBuilderReferenceTemplateRegistry, ValidateSystemBuilderRevisionService } from "../../../services/system-builder";
import { HeadlessSystemAuthoringUseCase } from "../headless-system-authoring.use-case";
import type { HeadlessPlanReviewPort, HeadlessPlanReviewState } from "../../../ports/system-builder/headless-build-plan-review.port";
import { HeadlessBuildPlanReviewUseCase, type HeadlessPlanReviewActor } from "../headless-build-plan-review.use-case";
import { CreateSystemBuilderSystemUseCase } from "../system-builder-use-cases";

const hostId = (id: string) => {
  if (!isHeadlessHostIncarnationId(id)) throw new Error("Invalid test host");
  return id;
};
const firstHost = hostId("41a96fc3-d2b8-4414-bd29-00059badc72d");
const secondHost = hostId("3a6112ce-ab8a-456f-876f-64730ff719df");
const organizationId = createOrganizationId("fixture-org");
const workspaceId = createWorkspaceId("fixture-workspace");
const clientId = "c6acfd8a-7c11-486a-95af-e1a7b08d16ef";
const templateId = "reference.secured-data-review@1.0.0";
const key = (suffix: number) => `a6f56324-2051-462c-b45b-${suffix.toString().padStart(12, "0")}`;
const definitions = [SYSTEM_FOUNDATION_PACK_MANIFEST, SYSTEM_FOUNDATION_PACK_V2_MANIFEST, SYSTEM_FOUNDATION_PACK_V3_MANIFEST]
  .flatMap(({ assets }) => assets.map(({ definition }) => definition));
const readExactDefinition = async (ref: AssetReference) =>
  definitions.find((definition) => definition.definitionId === ref.id && definition.version === ref.version);

function buildPlanReviewFixture(options: { expireBeforeCommit?: boolean; expireAfterCommit?: boolean } = {}) {
  const fingerprint = "ab".repeat(32);
  const targetScope = { organizationId, workspaceId, principalId: "fixture-principal", registeredClientId: clientId };
  let current = true;
  let permitted = true;
  let time = 100;
  let updates = 0;
  let state: HeadlessPlanReviewState = {
    revision: 1, stepCount: 3, expiresAt: 200, status: "pending", approvedSteps: 0,
  };
  const store: HeadlessPlanReviewPort = {
    async decide({ target, isCurrent, update }) {
      if (target.hostIncarnationId !== firstHost || target.fingerprint !== fingerprint ||
          target.scope.workspaceId !== workspaceId || target.scope.registeredClientId !== clientId ||
          !isCurrent() || !permitted) return { ok: false, code: "forbidden" };
      const result = update(state);
      if (result.ok) {
        if (options.expireBeforeCommit) time = state.expiresAt;
        if (!isCurrent()) return { ok: false, code: "expired" };
        if (!permitted) return { ok: false, code: "forbidden" };
        state = result.state;
        updates++;
        if (options.expireAfterCommit) time = state.expiresAt;
      }
      return result;
    },
  };
  const useCase = new HeadlessBuildPlanReviewUseCase(store, () => time);
  const actor: HeadlessPlanReviewActor = {
    organizationId, principalId: targetScope.principalId, channel: "app-popup",
    isCurrent: () => current, canDecide: async () => permitted,
  };
  const decide = (expectedRevision: number, decision: unknown, options?: {
    actor?: Partial<HeadlessPlanReviewActor>; scope?: Partial<typeof targetScope>; request?: Record<string, unknown>;
  }) => useCase.decide({ fingerprint, expectedRevision, decision, ...options?.request }, firstHost,
    { ...targetScope, ...options?.scope }, { ...actor, ...options?.actor });
  return { targetScope, actor, decide, snapshot: () => ({ ...state }), updates: () => updates,
    expire: () => { time = 200; }, disconnect: () => { current = false; }, losePermission: () => { permitted = false; } };
}

test("accepts a whole plan from either verified human channel and supports exact revoke", async () => {
  for (const channel of ["app-popup", "authenticated-chat"] as const) {
    const fixture = buildPlanReviewFixture();
    const approve = { kind: "approve", mode: "whole-plan" };
    const outcome = await fixture.decide(1, approve, { actor: { channel } });
    assert.ok(outcome.ok);
    assert.deepEqual(outcome.state, { ...fixture.snapshot(), revision: 2, status: "approved",
      mode: "whole-plan", approvedSteps: 3, lastChannel: channel });
    assert.deepEqual(await fixture.decide(1, approve, { actor: { channel } }), { ok: false, code: "stale" });
    assert.equal(fixture.updates(), 1);
    await fixture.decide(2, { kind: "revoke" }, { actor: { channel: channel === "app-popup" ? "authenticated-chat" : "app-popup" } });
    assert.equal(fixture.snapshot().status, "revoked");
    assert.deepEqual(await fixture.decide(3, approve), { ok: false, code: "stale" });
  }
});

test("records decisions for individual steps in order across the same plan on both channels", async () => {
  const fixture = buildPlanReviewFixture();
  const approve = (step: number) => ({ kind: "approve", mode: "each-change", step });
  assert.deepEqual(await fixture.decide(1, approve(2)), { ok: false, code: "stale" });
  const results = await Promise.all([
    fixture.decide(1, approve(1)),
    fixture.decide(1, approve(1), { actor: { channel: "authenticated-chat" } }),
  ]);
  assert.equal(results.filter(result => result.ok).length, 1);
  assert.equal(fixture.snapshot().approvedSteps, 1);
  assert.deepEqual(await fixture.decide(2, { kind: "approve", mode: "whole-plan" }), { ok: false, code: "stale" });
  const second = await fixture.decide(2, approve(2), { actor: { channel: "authenticated-chat" } });
  assert.ok(second.ok && second.state.status === "pending" && second.state.approvedSteps === 2);
  const third = await fixture.decide(3, approve(3));
  assert.ok(third.ok && third.state.status === "approved" && third.state.approvedSteps === 3);
});

test("rejects a new decision against changed plan, missing authority or expiry, and leaves denied or cancelled plans closed", async () => {
  const approve = { kind: "approve", mode: "whole-plan" };
  const fixture = buildPlanReviewFixture();
  const denied = { ok: false, code: "forbidden" };
  assert.deepEqual(await fixture.decide(1, approve, { request: { fingerprint: "cd".repeat(32) } }), denied);
  assert.deepEqual(await fixture.decide(1, approve, { actor: { principalId: "different-person" } }), denied);
  assert.deepEqual(await fixture.decide(1, approve, { scope: { workspaceId: createWorkspaceId("other-workspace") } }), denied);
  assert.deepEqual(await fixture.decide(1, approve, { request: { channel: "authenticated-chat" } }), { ok: false, code: "invalid" });
  assert.deepEqual(await fixture.decide(1, { ...approve, step: 1 }), { ok: false, code: "invalid" });
  fixture.expire();
  assert.deepEqual(await fixture.decide(1, approve), { ok: false, code: "expired" });
  fixture.disconnect();
  assert.deepEqual(await fixture.decide(1, approve), denied);
  assert.equal(fixture.updates(), 0);
  for (const [kind, status] of [["deny", "denied"], ["cancel", "cancelled"]]) {
    const fresh = buildPlanReviewFixture();
    const stopped = await fresh.decide(1, { kind });
    assert.ok(stopped.ok && stopped.state.status === status);
    assert.deepEqual(await fresh.decide(2, approve), { ok: false, code: "stale" });
  }
  const losesAccess = buildPlanReviewFixture();
  assert.deepEqual(await losesAccess.decide(1, approve, {
    actor: { canDecide: async () => { losesAccess.losePermission(); return true; } },
  }), denied);
  assert.equal(losesAccess.updates(), 0);
});

test("does not acknowledge approval if its deadline passes at commit or before the response", async () => {
  const approve = { kind: "approve", mode: "whole-plan" };
  const deniedAtCommit = buildPlanReviewFixture({ expireBeforeCommit: true });
  assert.deepEqual(await deniedAtCommit.decide(1, approve), { ok: false, code: "expired" });
  assert.equal(deniedAtCommit.updates(), 0);
  assert.equal(deniedAtCommit.snapshot().status, "pending");

  const expiredAtResponse = buildPlanReviewFixture({ expireAfterCommit: true });
  assert.deepEqual(await expiredAtResponse.decide(1, approve), { ok: false, code: "expired" });
  assert.equal(expiredAtResponse.updates(), 1);
  assert.equal(expiredAtResponse.snapshot().status, "approved");
});

function setup(options: { readonly wrongCloneRevision?: boolean } = {}) {
  const documents = createInMemoryStructuredDocumentStore();
  const repository = createStructuredSystemBuilderRepository(documents.forOrganization(organizationId));
  const operations = createStructuredHeadlessOperationStore(documents);
  const validator = new ValidateSystemBuilderRevisionService({ readExactDefinition });
  let index = 0;
  let current = true;
  let allowed = true;
  const application = new HeadlessSystemAuthoringUseCase({
    organizationId,
    repository: options.wrongCloneRevision ? {
      ...repository,
      async readRevision(...args) {
        const revision = await repository.readRevision(...args);
        return revision && { ...revision, targetWorkspaceId: createWorkspaceId("fixture-other-workspace") };
      },
    } : repository,
    operations, templates: new SystemBuilderReferenceTemplateRegistry(),
    access: { async authorize(workspace) { if (workspace !== workspaceId || !allowed) throw new Error("fixture denied"); } },
    validator: () => validator,
    resolveDefinition: async (workspace, ref) => workspace === workspaceId ? readExactDefinition(ref) : undefined,
    generateSystemId: () => `fixture-system-${++index}`, digest: (data) => createHash("sha256").update(data).digest("hex"),
  });
  const grant = {
    organizationId, principalId: "fixture-principal", registeredClientId: clientId,
    canUse: async (workspace: typeof workspaceId) => allowed && workspace === workspaceId,
    isCurrent: () => current,
  };
  const execute = (operation: string, input: Record<string, unknown>, host = firstHost) => application.execute({
    version: HEADLESS_CONTRACT_VERSION, operation, input: { hostIncarnationId: host, workspaceId, ...input },
  }, host, grant);
  const create = (host = firstHost) => execute("systems.create", { name: "Synthetic system", templateId, idempotencyKey: key(1) }, host);
  const createInUi = () => new CreateSystemBuilderSystemUseCase({ repository, validator, generateSystemId: () => "fixture-ui-system" })
    .execute({ workspaceId, name: "Synthetic system from UI", actorId: "fixture-ui" });
  return { repository, operations, application, grant, execute, create, createInUi, loseGrant: () => { current = false; }, loseMembership: () => { allowed = false; } };
}

test("uses existing template, rename and clone commands, with one event each and no repeat write under a new host ID", async () => {
  const fixture = setup();
  const created = await fixture.create();
  assert.ok(created.ok && created.value.kind === "committed");
  const original = await fixture.repository.readRecord(workspaceId, created.value.reference.systemId);
  assert.ok(original?.description);
  const replay = await fixture.create(secondHost);
  assert.deepEqual(replay, { ok: true, value: { kind: "replayed", reference: created.value.reference } });
  const base = { systemId: created.value.reference.systemId, baseRecordRevision: 1, baseRevisionId: created.value.reference.revisionId };
  const renamed = await fixture.execute("systems.rename", { ...base, name: "New name", idempotencyKey: key(2) });
  assert.ok(renamed.ok && renamed.value.kind === "committed");
  const saved = await fixture.repository.readRecord(workspaceId, base.systemId);
  assert.equal(saved?.name, "New name");
  assert.equal(saved.description, original.description);
  const stale = await fixture.execute("systems.clone", { ...base, name: "Clone", idempotencyKey: key(3) });
  assert.ok(!stale.ok);
  assert.equal(stale.error.code, "headless.stale-revision");
  const clone = await fixture.execute("systems.clone", {
    ...base, baseRecordRevision: 2, name: "Clone", idempotencyKey: key(3),
  });
  assert.ok(clone.ok && clone.value.kind === "committed");
  assert.notEqual(clone.value.reference.systemId, base.systemId);
  assert.equal((await fixture.repository.listRecords(workspaceId)).length, 2);
  const changes = await fixture.operations.readChanges({ organizationId, workspaceId }, 0);
  assert.equal(changes.kind, "changes");
  assert.deepEqual(changes.events.map(({ sequence }) => sequence), [1, 2, 3]);
});

test("does not clone when the saved graph read cannot prove the requested identity", async () => {
  const fixture = setup({ wrongCloneRevision: true });
  const created = await fixture.create();
  assert.ok(created.ok && created.value.kind === "committed");
  const { systemId, revisionId } = created.value.reference;
  const clone = await fixture.execute("systems.clone", {
    systemId, baseRecordRevision: 1, baseRevisionId: revisionId, name: "Clone", idempotencyKey: key(8),
  });
  assert.ok(!clone.ok);
  assert.equal(clone.error.code, "headless.stale-revision");
  assert.equal((await fixture.repository.listRecords(workspaceId)).length, 1);
});

test("requires current grant and membership to return a saved result; changed input under the key is refused", async () => {
  const fixture = setup();
  assert.ok((await fixture.create()).ok);
  const differentOrg = createOrganizationId("fixture-other-org");
  const crossTenant = await fixture.application.execute({
    version: HEADLESS_CONTRACT_VERSION, operation: "systems.create",
    input: { hostIncarnationId: firstHost, workspaceId, templateId, name: "Synthetic system", idempotencyKey: key(1) },
  }, firstHost, { ...fixture.grant, organizationId: differentOrg });
  assert.ok(!crossTenant.ok);
  assert.equal(crossTenant.error.code, "headless.forbidden");
  assert.equal(await fixture.operations.watermark({ organizationId: differentOrg, workspaceId }), 0);
  const changed = await fixture.execute("systems.create", { name: "Changed input", templateId, idempotencyKey: key(1) });
  assert.ok(!changed.ok);
  assert.equal(changed.error.code, "headless.idempotency-conflict");
  fixture.loseMembership();
  const denied = await fixture.create(secondHost);
  assert.ok(!denied.ok);
  assert.equal(denied.error.code, "headless.forbidden");
  assert.equal((await fixture.repository.listRecords(workspaceId)).length, 1);
  fixture.loseGrant();
  const foreign = await fixture.execute("systems.create", {
    workspaceId: createWorkspaceId("other-workspace"), name: "Other", templateId, idempotencyKey: key(2),
  });
  assert.ok(!foreign.ok);
  assert.equal(foreign.error.code, "headless.forbidden");
});

test("previews and commits an edit against the same saved UI system, then replays without another revision", async () => {
  const fixture = setup();
  const created = await fixture.createInUi();
  assert.ok(created.ok && created.value.currentRevisionId);
  const { systemId, currentRevisionId: baseRevisionId } = created.value;
  const original = await fixture.repository.readRevision(workspaceId, systemId, baseRevisionId);
  const page = original?.instances.find(({ definitionRef }) => definitionRef.id === "builtin.layout.page.single");
  assert.ok(page);
  const input = { systemId, baseRevisionId, baseRecordRevision: 1, edits: [{
    kind: "add", instanceId: "fixture.new-container", definitionId: "builtin.ui.container", version: "3.0.0",
    configuration: { label: "New container" }, parentInstanceId: page.instanceId, slotId: "content", order: 0,
  }] };
  const preview = await fixture.execute("systems.preview-edits", input);
  assert.ok(preview.ok && preview.value.kind === "preview");
  assert.equal(await fixture.operations.watermark({ organizationId, workspaceId }), 0);
  const apply = { ...input, previewDigest: preview.value.previewDigest, idempotencyKey: key(7) };
  const result = await fixture.execute("systems.apply-edits", apply);
  assert.ok(result.ok && result.value.kind === "committed");
  assert.deepEqual(await fixture.execute("systems.apply-edits", apply, secondHost), {
    ok: true, value: { kind: "replayed", reference: result.value.reference },
  });
  assert.equal((await fixture.repository.listRevisions(workspaceId, systemId)).length, 2);
  assert.equal(await fixture.operations.watermark({ organizationId, workspaceId }), 1);
});
