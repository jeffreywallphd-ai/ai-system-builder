import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { createOrganizationId } from "../../../../contracts/organization";
import { normalizeSystemReleaseId } from "../../../../contracts/system-build";
import type { SystemDataAuditEntry, SystemDataRecord } from "../../../../contracts/system-data";
import { createWorkspaceId } from "../../../../contracts/workspace";

import {
  StructuredDocumentConflictError,
  mutateDocumentRecord,
} from "../../shared";
import { resolvePostgresPoolConfig } from "../client/createPostgresPool";
import { openPostgresDatabase } from "../postgres-database";
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
