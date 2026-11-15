import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { mkdtemp, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import { createStructuredOrganizationRepositories } from "../../../../adapters/persistence/organization";
import type { StructuredDocumentStore } from "../../../../adapters/persistence/shared";
import { openLocalSqliteDatabase, resolveLocalSqliteDatabasePolicy } from "../../../../adapters/persistence/sqlite";
import { createStructuredHeadlessOperationStore } from "../../../../adapters/persistence/system-builder";
import { createLocalWorkspaceRepository } from "../../../../adapters/persistence/workspace";
import {
  SYSTEM_FOUNDATION_PACK_MANIFEST, SYSTEM_FOUNDATION_PACK_V2_MANIFEST, SYSTEM_FOUNDATION_PACK_V3_MANIFEST,
} from "../../../../application/services/asset-packs/system-packs";
import { AuthorizeWorkspaceOperationService, createOrganizationAuthorizationPolicy } from "../../../../application/services/security";
import type { AssetReference } from "../../../../contracts/asset";
import { createTenantPlacementConfig } from "../../../../contracts/config";
import { HEADLESS_CONTRACT_VERSION, parseHeadlessBuildPlanProposal, readHeadlessPlanReviewAgentRequest,
  type HeadlessHostIncarnationId } from "../../../../contracts/headless";
import { createOrganizationId } from "../../../../contracts/organization";
import { createWorkspaceId } from "../../../../contracts/workspace";
import { composeSystemBuilder } from "../../../shared/composition/composeSystemBuilder";
import { composeManagedHeadlessAuthoring } from "../composeManagedHeadlessAuthoring";
import { composeManagedHeadlessPlanReview } from "../composeManagedHeadlessPlanReview";

const organizationId = createOrganizationId("managed-fixture");
const workspaceId = createWorkspaceId("workspace-fixture");
const principalId = "principal-fixture";
const timestamp = "2026-11-14T12:00:00.000Z";
const hostIncarnationId = randomUUID() as HeadlessHostIncarnationId;
const definitions = [SYSTEM_FOUNDATION_PACK_MANIFEST, SYSTEM_FOUNDATION_PACK_V2_MANIFEST, SYSTEM_FOUNDATION_PACK_V3_MANIFEST]
  .flatMap(({ assets }) => assets.map(({ definition }) => definition));
const findDefinition = async ({ id, version }: AssetReference) =>
  definitions.find(row => row.definitionId === id && row.version === version);

test("managed edits and retry receipts require current workspace permission within the owned transaction", async t => {
  const fixture = await mkdtemp(path.join(await realpath(tmpdir()), "managed-author-"));
  const db = await openLocalSqliteDatabase({policy: resolveLocalSqliteDatabasePolicy({dataRootDirectory: fixture})});
  try {
    const root = db.documents;
    const documents = root.forOrganization(organizationId);
    const repositories = createStructuredOrganizationRepositories(root);
    await repositories.organizations.saveOrganization({organizationId, displayName: "Synthetic", status: "active", createdAt: timestamp, updatedAt: timestamp});
    const membership = {organizationId, principalId, role: "operator" as const, status: "active" as const, createdAt: timestamp, updatedAt: timestamp};
    await repositories.memberships.saveMembership(membership);
    const workspace = {workspaceId, organizationId, displayName: "Synthetic workspace", status: "active" as const, createdAt: timestamp, updatedAt: timestamp};
    const workspaces = createLocalWorkspaceRepository({rootDirectory: fixture, documents});
    await workspaces.saveWorkspace(workspace);
    let context = {organizationId, principalId};
    const contexts = {getCurrentOrganizationContext: () => context};
    const placement = createTenantPlacementConfig();
    const policy = createOrganizationAuthorizationPolicy({...repositories, tenantPlacement: placement});
    let authorizationCompleted: (() => void) | undefined;
    const authorization = new AuthorizeWorkspaceOperationService({organizationContext: contexts, authorizer: {
      async execute(input) {
        const decision = await policy.authorize(input);
        if (!decision.allowed) throw new Error("Fixture policy denied.");
        authorizationCompleted?.();
        return decision;
      },
    }});
    const systems = composeSystemBuilder({documents, generateSystemId: () => `system.${randomUUID()}`,
      definitions: {readExactDefinition: findDefinition},
      assetRegistryRead: {
        async listDefinitionCards() { return {items: []}; },
        async readDefinitionDetail(reference, options) {
          assert.equal(options?.workspaceId, workspaceId);
          const definition = await findDefinition(reference);
          return definition ? {definition, builtIn: true} : undefined;
        },
      },
    });
    let beforeOwner: (() => Promise<unknown>) | undefined;
    let atCommit: (() => void) | undefined;
    const platform: StructuredDocumentStore = {...root,
      async runInOwnedTransaction(transaction, beforeCommit) {
        const before = beforeOwner;
        beforeOwner = undefined;
        await before?.();
        return root.runInOwnedTransaction!(transaction, () => {atCommit?.(); beforeCommit?.();});
      },
    };
    const service = composeManagedHeadlessAuthoring({hostIncarnationId, platform, rootDirectory: fixture,
      contexts, workspaces, authorization, placement, systems});
    let current = true;
    const registration = {purpose: "agent" as const, organizationId, principalId, registeredClientId: randomUUID(), isCurrent: () => current};
    const command = {version: HEADLESS_CONTRACT_VERSION, operation: "systems.create", input: {hostIncarnationId, workspaceId,
      name: "Synthetic portal", idempotencyKey: randomUUID(), templateId: "reference.secured-data-review@1.0.0"}};
    const execute = (request = command) => service.execute(request, registration, () => true);
    const denied = {ok: false, code: "headless.forbidden"};

    context = {...context, principalId: "foreign-principal"};
    assert.deepEqual(await execute(), denied);
    context = {...context, principalId};
    beforeOwner = () => repositories.memberships.saveMembership({...membership, status: "removed"});
    assert.deepEqual(await execute(), denied);
    assert.equal((await systems.useCases.list.execute({workspaceId})).length, 0);
    await repositories.memberships.saveMembership(membership);
    atCommit = () => {current = false;};
    assert.deepEqual(await execute(), denied);
    atCommit = undefined;
    assert.equal((await systems.useCases.list.execute({workspaceId})).length, 0);
    assert.equal(await createStructuredHeadlessOperationStore(root).watermark({organizationId, workspaceId}), 0);

    current = true;
    const saved = await execute();
    assert.ok(saved.ok && saved.value.kind === "committed");
    assert.deepEqual(await execute(), {ok: true, value: {...saved.value, kind: "replayed"}});
    assert.equal((await systems.useCases.list.execute({workspaceId})).length, 1);
    assert.equal(await createStructuredHeadlessOperationStore(root).watermark({organizationId, workspaceId}), 1);
    let expireAfterCheck = false;
    let observedReplayTransaction = false;
    let postTransactionAuthorizations = 0;
    atCommit = () => { observedReplayTransaction = true; };
    authorizationCompleted = () => {
      if (observedReplayTransaction && ++postTransactionAuthorizations === 2) expireAfterCheck = true;
    };
    const atEgress = {...registration, isCurrent() {
      if (expireAfterCheck) {
        expireAfterCheck = false;
        queueMicrotask(() => { current = false; });
      }
      return current;
    }};
    assert.deepEqual(await service.execute(command, atEgress, () => true), denied);
    assert.equal(observedReplayTransaction, true);
    assert.equal(postTransactionAuthorizations, 2);
    assert.equal(current, false);
    atCommit = undefined;
    authorizationCompleted = undefined;
    current = true;
    beforeOwner = () => workspaces.updateWorkspace({...workspace, status: "archived"});
    assert.deepEqual(await execute(), denied);

    await t.test("a dedicated managed client stages the exact plan without changing saved systems", async () => {
      await workspaces.updateWorkspace(workspace);
      const review = composeManagedHeadlessPlanReview({hostIncarnationId, platform, rootDirectory:fixture,
        contexts, workspaces, authorization, placement});
      const client = {...registration, purpose:"plan-review" as const};
      const scope = {hostIncarnationId, workspaceId};
      const decode = (operation: "plan.submit" | "plan.status", input: object) => {
        const parsed = readHeadlessPlanReviewAgentRequest({version:HEADLESS_CONTRACT_VERSION, operation, input}, hostIncarnationId);
        assert.ok(parsed.ok);
        return parsed.request;
      };
      const build = (steps: readonly unknown[]) => {
        const proposed = parseHeadlessBuildPlanProposal({...scope, steps}, hostIncarnationId);
        assert.ok(proposed.ok);
        const fingerprint = createHash("sha256").update(JSON.stringify(proposed.preview)).digest("hex");
        const input = {...scope, fingerprint, steps};
        return {input, submit:decode("plan.submit", input), status:decode("plan.status", {...scope, fingerprint})};
      };
      const ordinary = build([{operation:"systems.create", name:"Synthetic approved work",
        templateId:"reference.secured-data-review@1.0.0", idempotencyKey:randomUUID()}]);
      const fresh = () => true;
      assert.deepEqual(await review(ordinary.submit, client, () => false), denied);
      context = {...context, principalId:"foreign-principal"};
      assert.deepEqual(await review(ordinary.submit, client, fresh), denied);
      context = {...context, principalId};
      beforeOwner = () => repositories.memberships.saveMembership({...membership, status:"removed"});
      assert.deepEqual(await review(ordinary.submit, client, fresh), denied);
      await repositories.memberships.saveMembership(membership);
      assert.deepEqual(await review(ordinary.status, client, fresh), denied);
      atCommit = () => {current = false;};
      assert.deepEqual(await review(ordinary.submit, client, fresh), denied);
      atCommit = undefined;
      current = true;
      assert.deepEqual(await review(ordinary.status, client, fresh), denied);
      assert.deepEqual(await review(decode("plan.submit", {...ordinary.input, fingerprint:"a".repeat(64)}), client, fresh),
        {ok:false, code:"headless.invalid-request"});
      const invalidSource = build([{operation:"systems.clone", systemId:"system.missing-fixture",
        baseRecordRevision:1, baseRevisionId:"system.missing-fixture.r1", name:"Synthetic copy", idempotencyKey:randomUUID()}]);
      assert.deepEqual(await review(invalidSource.submit, client, fresh), {ok:false, code:"headless.stale"});
      assert.deepEqual(await review(invalidSource.status, client, fresh), denied);
      const staged = await review(ordinary.submit, client, fresh);
      assert.ok(staged.ok && staged.value.status === "pending" && staged.value.approvedSteps === 0);
      assert.deepEqual(await review(ordinary.submit, client, fresh), staged);
      assert.deepEqual(await review(ordinary.status, client, fresh), staged);
      assert.deepEqual(await review(ordinary.status, {...client, registeredClientId:randomUUID()}, fresh), denied);
      assert.deepEqual(await review(decode("plan.status", {...scope, fingerprint:ordinary.input.fingerprint,
        workspaceId:"another-workspace"}), client, fresh), denied);
      assert.equal((await systems.useCases.list.execute({workspaceId})).length, 1);
      assert.equal(await createStructuredHeadlessOperationStore(root).watermark({organizationId, workspaceId}), 1);
    });
  } finally {
    await db.close();
    await rm(fixture, {recursive: true, force: false});
  }
});
