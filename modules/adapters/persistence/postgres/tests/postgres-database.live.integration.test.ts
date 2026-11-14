import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { createOrganizationId } from "../../../../contracts/organization";
import { normalizeAssetId } from "../../../../contracts/asset";
import { normalizeSystemReleaseId } from "../../../../contracts/system-build";
import {
  normalizeSystemBuilderRevisionId, normalizeSystemBuilderSystemId, systemBuilderSuccess,
  type SystemBuilderRecord, type SystemBuilderRevision,
} from "../../../../contracts/system-builder";
import type { SystemDataAuditEntry, SystemDataRecord } from "../../../../contracts/system-data";
import { createWorkspaceId } from "../../../../contracts/workspace";

import {
  StructuredDocumentConflictError,
  mutateDocumentRecord,
  type StructuredDocumentStore,
} from "../../shared";
import { createPostgresPool, resolvePostgresPoolConfig } from "../client/createPostgresPool";
import { openPostgresDatabase } from "../postgres-database";
import { createStructuredHeadlessOperationStore } from "../../system-builder/createStructuredHeadlessOperationStore";
import { createStructuredSystemBuilderRepository } from "../../system-builder/createStructuredSystemBuilderRepository";
import { createStructuredSystemDataRepository } from "../../system-data";
import { runSystemBuildPersistenceConformance } from "../../system-build/tests/system-build-persistence-conformance";
import { runSystemDeploymentPersistenceConformance } from "../../system-deployment/tests/system-deployment-persistence-conformance";

const liveDatabaseUrl = process.env.TEST_POSTGRES_URL?.trim();

test(
  "live PostgreSQL migration, transaction, health, and revision conformance",
  { skip: !liveDatabaseUrl },
  async () => {
    const config = resolvePostgresPoolConfig({
      DATABASE_URL: liveDatabaseUrl,
      POSTGRES_SSL_MODE: process.env.TEST_POSTGRES_SSL_MODE ?? "disable",
      POSTGRES_APPLICATION_NAME: "ai-system-builder-integration-test",
    });
    const databases = await Promise.all(
      Array.from({ length: 4 }, () => openPostgresDatabase({ config })),
    );
    const [database] = databases;
    const namespace = `integration-${randomUUID()}`;
    const systemDataWorkspaceId = createWorkspaceId(`workspace-${randomUUID()}`);
    const systemDataReleaseId = normalizeSystemReleaseId(`release-${randomUUID()}`);
    const systemDataEntityType = "service-request";
    const systemDataRecordId = `record-${randomUUID()}`;
    const systemDataRecordKey = [
      systemDataWorkspaceId,
      systemDataReleaseId,
      systemDataEntityType,
      systemDataRecordId,
    ].join("/");
    const systemDataCreateAuditKey = [
      systemDataWorkspaceId,
      systemDataReleaseId,
      systemDataEntityType,
      "2026-07-17T00:00:00.000Z",
      "audit-postgres-create",
    ].join("/");
    const systemDataUpdateAuditKey = [
      systemDataWorkspaceId,
      systemDataReleaseId,
      systemDataEntityType,
      "2026-07-17T00:00:01.000Z",
      "audit-postgres-update",
    ].join("/");
    const orgA = database.documents.forOrganization(createOrganizationId(`org-a-${randomUUID()}`));
    const orgB = database.documents.forOrganization(createOrganizationId(`org-b-${randomUUID()}`));
    try {
      await orgA.writeDocument(namespace, "shared", { owner: "a" });
      await orgB.writeDocument(namespace, "shared", { owner: "b" });
      assert.equal((await orgA.readDocument<{ owner: string }>(namespace, "shared"))?.value.owner, "a");
      assert.equal((await orgB.readDocument<{ owner: string }>(namespace, "shared"))?.value.owner, "b");
      const first = await database.documents.writeDocument(
        namespace,
        "record",
        { value: 1 },
      );
      const second = await database.documents.writeDocument(
        namespace,
        "record",
        { value: 2 },
        { expectedRevision: first.revision },
      );
      await assert.rejects(
        () =>
          database.documents.writeDocument(
            namespace,
            "record",
            { value: 3 },
            { expectedRevision: first.revision },
          ),
        StructuredDocumentConflictError,
      );
      assert.equal(second.value.value, 2);
      await assert.rejects(
        () =>
          database.documents.runInTransaction(async (transaction) => {
            await transaction.writeDocument(namespace, "rolled-back", {
              value: "temporary",
            });
            throw new Error("expected rollback");
          }),
        /expected rollback/,
      );
      assert.equal(
        await database.documents.readDocument(namespace, "rolled-back"),
        undefined,
      );
      assert.deepEqual(
        await databases[1].documents.readDocument(namespace, "record"),
        second,
      );
      assert.equal(
        await databases[2].documents.readDocument(
          `${namespace}-other`,
          "record",
        ),
        undefined,
      );
      const systemDataOrgA = createStructuredSystemDataRepository(orgA);
      const systemDataOrgB = createStructuredSystemDataRepository(orgB);
      const firstSystemDataRecord: SystemDataRecord = {
        recordId: systemDataRecordId,
        targetWorkspaceId: systemDataWorkspaceId,
        releaseId: systemDataReleaseId,
        entityType: systemDataEntityType,
        revision: 1,
        values: { title: "PostgreSQL first" },
        createdAt: "2026-07-17T00:00:00.000Z",
        createdBy: "person-postgres",
        updatedAt: "2026-07-17T00:00:00.000Z",
        updatedBy: "person-postgres",
      };
      const createAudit: SystemDataAuditEntry = {
        auditId: "audit-postgres-create",
        targetWorkspaceId: systemDataWorkspaceId,
        releaseId: systemDataReleaseId,
        entityType: systemDataEntityType,
        action: "create",
        outcome: "allowed",
        actorId: "person-postgres",
        recordId: systemDataRecordId,
        changedFields: ["title"],
        occurredAt: "2026-07-17T00:00:00.000Z",
      };
      await systemDataOrgA.createRecordWithAudit(firstSystemDataRecord, createAudit);
      const secondSystemDataRecord: SystemDataRecord = {
        ...firstSystemDataRecord,
        revision: 2,
        values: { title: "PostgreSQL updated" },
        updatedAt: "2026-07-17T00:00:01.000Z",
      };
      const updateAudit: SystemDataAuditEntry = {
        ...createAudit,
        auditId: "audit-postgres-update",
        action: "update",
        occurredAt: "2026-07-17T00:00:01.000Z",
      };
      await systemDataOrgA.updateRecordWithAudit(secondSystemDataRecord, updateAudit, 1);
      await assert.rejects(
        () => systemDataOrgA.updateRecordWithAudit(
          secondSystemDataRecord,
          { ...updateAudit, auditId: "audit-postgres-stale" },
          1,
        ),
        StructuredDocumentConflictError,
      );
      assert.deepEqual(
        await systemDataOrgA.readRecord(
          systemDataWorkspaceId,
          systemDataReleaseId,
          systemDataEntityType,
          systemDataRecordId,
        ),
        secondSystemDataRecord,
      );
      assert.equal(
        (await systemDataOrgA.listAudit(
          systemDataWorkspaceId,
          systemDataReleaseId,
          systemDataEntityType,
          20,
        )).length,
        2,
      );
      assert.deepEqual(
        await systemDataOrgB.listRecords(
          systemDataWorkspaceId,
          systemDataReleaseId,
          systemDataEntityType,
        ),
        [],
      );
      await Promise.all(
        Array.from({ length: 24 }, (_, index) =>
          mutateDocumentRecord(
            {
              rootDirectory: ".",
              documents: databases[index % databases.length].documents,
            },
            `${namespace}/counter.json`,
            { count: 0, writers: [] as number[] },
            (current) => ({
              value: {
                count: current.count + 1,
                writers: [...current.writers, index],
              },
              result: undefined,
            }),
          ),
        ),
      );
      const counter = await database.documents.readDocument<{
        count: number;
        writers: number[];
      }>(namespace, "counter.json");
      assert.equal(counter?.value.count, 24);
      assert.equal(new Set(counter?.value.writers).size, 24);
      assert.equal((await database.checkHealth()).healthy, true);
      const systemBuildConformance = await runSystemBuildPersistenceConformance(
        database.documents,
        `postgres-${randomUUID()}`,
      );
      assert.equal(systemBuildConformance.buildCount, 36);
      assert.equal(systemBuildConformance.releaseCount, 1);
      assert.equal(systemBuildConformance.restartSafe, true);
      const systemDeploymentConformance =
        await runSystemDeploymentPersistenceConformance(
          database.documents,
          `postgres-${randomUUID()}`,
        );
      assert.equal(systemDeploymentConformance.currentConflict, true);
      assert.equal(systemDeploymentConformance.retainedDeploymentCount, 2);
      assert.equal(systemDeploymentConformance.retainedRunCount, 1);
      assert.equal(systemDeploymentConformance.restartSafe, true);
      assert.equal(systemDeploymentConformance.workspaceIsolation, true);
    } finally {
      await orgA.deleteDocument(namespace, "shared");
      await orgB.deleteDocument(namespace, "shared");
      await database.documents.deleteDocument(namespace, "record");
      await database.documents.deleteDocument(namespace, "counter.json");
      await orgA.deleteDocument("system-data/records", systemDataRecordKey);
      await orgA.deleteDocument("system-data/audit", systemDataCreateAuditKey);
      await orgA.deleteDocument("system-data/audit", systemDataUpdateAuditKey);
      await Promise.all(databases.map((opened) => opened.close()));
    }
  },
);

test("live PostgreSQL atomic headless persistence replays across restricted runtime pools and rollback", {
  skip: !liveDatabaseUrl, timeout: 45_000,
}, async () => {
  const config = resolvePostgresPoolConfig({
    DATABASE_URL: liveDatabaseUrl,
    POSTGRES_SSL_MODE: process.env.TEST_POSTGRES_SSL_MODE ?? "disable",
    POSTGRES_APPLICATION_NAME: "ai-system-builder-owned-transaction-test",
  });
  const migration = await openPostgresDatabase({ config });
  const administrator = createPostgresPool(config);
  const role = `owned_fixture_${randomUUID().replaceAll("-", "")}`;
  const runtimeUrl = new URL(config.connectionString);
  // The existing disposable test database role can assume this fixture's
  // non-login, non-owner role when each runtime connection starts.
  const existingOptions = runtimeUrl.searchParams.get("options");
  runtimeUrl.searchParams.set("options", `${existingOptions ?? ""} -c role=${role}`.trim());
  const runtime = { ...config, connectionString: runtimeUrl.toString() };
  const scope = {
    organizationId: createOrganizationId(`owned-org-${randomUUID()}`),
    workspaceId: createWorkspaceId(`owned-space-${randomUUID()}`),
    principalId: "fixture-principal",
    registeredClientId: randomUUID(),
  };
  const other = { ...scope, organizationId: createOrganizationId(`other-org-${randomUUID()}`) };
  const membershipKey = scope.organizationId;
  const first = savedSystem("first");
  const cancelled = savedSystem("cancelled");
  const authority = { current: true };
  const pools: Awaited<ReturnType<typeof openPostgresDatabase>>[] = [];
  let created = false;

  try {
    await administrator.query(`CREATE ROLE ${role} NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOREPLICATION NOBYPASSRLS`);
    created = true;
    await administrator.query(`GRANT SELECT ON schema_migrations TO ${role}`);
    await administrator.query(`GRANT SELECT, INSERT, UPDATE, DELETE ON structured_documents, organization_documents TO ${role}`);
    for (let index = 0; index < 2; index += 1) pools.push(await openPostgresDatabase({ config: runtime, migrate: false }));
    const firstPool = pools[0].documents;
    const otherPool = pools[1].documents;
    const scoped = otherPool.forOrganization(scope.organizationId);
    await firstPool.writeDocument("headless-test-policy", membershipKey, { allowed: true });
    const policy = {
      async authorize(transaction: StructuredDocumentStore) {
        return (await transaction.readDocument<{ allowed: boolean }>("headless-test-policy", membershipKey))?.value.allowed === true;
      },
    };
    const writer = createStructuredHeadlessOperationStore(firstPool, Date.now, policy);
    const replay = createStructuredHeadlessOperationStore(otherPool, Date.now, policy);
    const command = (candidate: typeof first) => ({
      scope, operation: "systems.create" as const, key: randomUUID(), fingerprint: "a".repeat(64),
      isCurrent: () => authority.current,
      async mutate(repository: ReturnType<typeof createStructuredSystemBuilderRepository>) {
        await repository.createRecordAndRevision(candidate.record, candidate.revision);
        return systemBuilderSuccess(candidate.reference);
      },
    });
    const fixture = command(first);
    let waited = () => {};
    const secondStarted = new Promise<void>((resolve) => { waited = resolve; });
    let free = () => {};
    const firstCommitted = new Promise<void>((resolve) => { free = resolve; });
    const competing = replay.run({ ...fixture, async mutate(repository) {
      waited();
      await firstCommitted;
      return fixture.mutate(repository);
    } });
    let observed: Awaited<ReturnType<typeof writer.run>> | undefined;
    try {
      await Promise.race([secondStarted, competing.then(() => assert.fail("the contender must enter its mutation"))]);
      observed = await writer.run(fixture);
    } finally {
      free();
      await competing;
    }
    assert.deepEqual(observed, { kind: "committed", reference: first.reference });
    assert.deepEqual(await competing, { kind: "replayed", reference: first.reference });
    await pools[0].close();
    assert.deepEqual(await replay.run({ ...fixture, mutate: () => assert.fail("a durable receipt must avoid the edit") }),
      { kind: "replayed", reference: first.reference });

    const runtimeRole = createPostgresPool(runtime);
    try {
      const result = await runtimeRole.query<{ restricted: boolean }>(
        "SELECT NOT (r.rolsuper OR r.rolbypassrls OR r.oid = t.relowner) AS restricted FROM pg_roles r, pg_class t WHERE r.rolname = current_user AND t.oid = 'organization_documents'::regclass",
      );
      assert.equal(result.rows[0]?.restricted, true);
      const foreign = await runtimeRole.query("SELECT 1 FROM organization_documents WHERE organization_id = $1", [scope.organizationId]);
      assert.equal(foreign.rowCount, 0);
    } finally {
      await runtimeRole.end();
    }
    assert.equal(await replay.watermark(other), 0);
    const fenced: StructuredDocumentStore = {
      ...otherPool,
      runInOwnedTransaction(work, beforeCommit) {
        return otherPool.runInOwnedTransaction!(work, () => { authority.current = false; beforeCommit(); });
      },
    };
    const stopped = command(cancelled);
    assert.deepEqual(await createStructuredHeadlessOperationStore(fenced, Date.now, policy).run(stopped), { kind: "denied" });
    const repository = createStructuredSystemBuilderRepository(scoped);
    assert.equal(await repository.readRecord(scope.workspaceId, cancelled.record.systemId), undefined);
    assert.equal(await repository.readRevision(scope.workspaceId, cancelled.record.systemId, cancelled.revision.revisionId), undefined);
    assert.equal((await scoped.listDocuments("headless/system-builder/receipts")).length, 1);
    assert.deepEqual(await replay.readChanges(scope, 0), {
      kind: "changes", watermark: 1, events: [{ ...first.reference, sequence: 1 }],
    });

    await otherPool.writeDocument("headless-test-policy", membershipKey, { allowed: false });
    authority.current = true;
    assert.deepEqual(await replay.run(fixture), { kind: "denied" });
    assert.deepEqual(await replay.run(stopped), { kind: "denied" });
    assert.equal(await replay.watermark(scope), 1);
  } finally {
    try {
      await Promise.all(pools.map((database) => database.close()));
      await migration.documents.runInTransaction(async (transaction) => {
        const scoped = transaction.forOrganization(scope.organizationId);
        for (const namespace of await scoped.listNamespaces()) {
          for (const document of await scoped.listDocuments(namespace)) await scoped.deleteDocument(namespace, document.key);
        }
        await transaction.deleteDocument("headless-test-policy", membershipKey);
      });
      if (created) {
        await administrator.query(`REVOKE ALL ON schema_migrations, structured_documents, organization_documents FROM ${role}`);
        await administrator.query(`DROP ROLE ${role}`);
      }
    } finally {
      await Promise.all([migration.close(), administrator.end()]);
    }
  }

  function savedSystem(name: string) {
    const at = "2026-11-14T00:00:00.000Z";
    const systemId = normalizeSystemBuilderSystemId(`fixture-${name}`);
    const revisionId = normalizeSystemBuilderRevisionId(`${systemId}.r1`);
    const composition = {
      compositionId: normalizeAssetId(`${systemId}.composition`),
      compositionType: "system", displayName: name, version: "0.1.0", lifecycleStatus: "draft",
      rootInstanceRefs: [], instanceRefs: [], bindingRefs: [], provenance: { sourceKind: "human-authored" },
    } as const;
    const record: SystemBuilderRecord = {
      systemId, targetWorkspaceId: scope.workspaceId, name, status: "draft", revision: 1, currentRevisionId: revisionId,
      composition, createdAt: at, updatedAt: at, createdBy: "fixture-actor", updatedBy: "fixture-actor",
    };
    const revision: SystemBuilderRevision = {
      systemId, targetWorkspaceId: scope.workspaceId, revisionId, revisionNumber: 1, composition, instances: [], bindings: [],
      validationIssues: [], createdAt: at, createdBy: "fixture-actor",
    };
    return { record, revision, reference: { systemId, revisionId, recordRevision: 1 } };
  }
});
