import path from "node:path";
import { existsSync } from "node:fs";

import { createOrganizationId } from "../../../../contracts/organization";
import { normalizeSystemReleaseId } from "../../../../contracts/system-build";
import type { SystemDataAuditEntry, SystemDataRecord } from "../../../../contracts/system-data";
import { createWorkspaceId } from "../../../../contracts/workspace";
import { CreateWorkspaceUseCase } from "../../../../application/use-cases/workspace/create-workspace.use-case";
import {
  openLocalSqliteDatabase,
  restoreLocalSqliteDatabase,
} from "../sqlite-database";
import { resolveLocalSqliteDatabasePolicy } from "../local-sqlite-database-policy";
import {
  createLocalWorkspaceRepository,
  createLocalWorkspaceSelectionRepository,
  createLocalWorkspaceSystemPackActivationRepository,
} from "../../workspace";
import { createStructuredSystemDataRepository } from "../../system-data";
import { runSystemBuildPersistenceConformance } from "../../system-build/tests/system-build-persistence-conformance";
import { runSystemDeploymentPersistenceConformance } from "../../system-deployment/tests/system-deployment-persistence-conformance";

async function main(): Promise<void> {
  const rootDirectory = process.argv[2];
  if (!rootDirectory) throw new Error("A temporary root directory is required.");

  const policy = resolveLocalSqliteDatabasePolicy({ dataRootDirectory: rootDirectory });
  const database = await openLocalSqliteDatabase({
    policy,
    now: () => "2026-07-16T12:00:00.000Z",
  });

  const first = await database.documents.writeDocument("tests", "one", { value: 1 });
  const second = await database.documents.writeDocument("tests", "one", { value: 2 }, { expectedRevision: first.revision });
  const systemDataWorkspaceId = createWorkspaceId("workspace-sqlite-system-data");
  const systemDataReleaseId = normalizeSystemReleaseId("release-sqlite-system-data");
  const systemDataRepository = createStructuredSystemDataRepository(database.documents);
  const firstSystemDataRecord: SystemDataRecord = {
    recordId: "record-sqlite",
    targetWorkspaceId: systemDataWorkspaceId,
    releaseId: systemDataReleaseId,
    entityType: "service-request",
    revision: 1,
    values: { title: "SQLite first" },
    createdAt: "2026-07-16T12:00:00.000Z",
    createdBy: "person-sqlite",
    updatedAt: "2026-07-16T12:00:00.000Z",
    updatedBy: "person-sqlite",
  };
  const createAudit: SystemDataAuditEntry = {
    auditId: "audit-sqlite-create",
    targetWorkspaceId: systemDataWorkspaceId,
    releaseId: systemDataReleaseId,
    entityType: "service-request",
    action: "create",
    outcome: "allowed",
    actorId: "person-sqlite",
    recordId: "record-sqlite",
    changedFields: ["title"],
    occurredAt: "2026-07-16T12:00:00.000Z",
  };
  await systemDataRepository.createRecordWithAudit(firstSystemDataRecord, createAudit);
  const secondSystemDataRecord: SystemDataRecord = {
    ...firstSystemDataRecord,
    revision: 2,
    values: { title: "SQLite updated" },
  };
  const updateAudit: SystemDataAuditEntry = {
    ...createAudit,
    auditId: "audit-sqlite-update",
    action: "update",
  };
  await systemDataRepository.updateRecordWithAudit(secondSystemDataRecord, updateAudit, 1);
  let systemDataConflict = false;
  try {
    await systemDataRepository.updateRecordWithAudit(
      secondSystemDataRecord,
      { ...updateAudit, auditId: "audit-sqlite-stale" },
      1,
    );
  } catch {
    systemDataConflict = true;
  }
  const systemDataRoundTrip = await systemDataRepository.readRecord(
    systemDataWorkspaceId,
    systemDataReleaseId,
    "service-request",
    "record-sqlite",
  );
  const systemDataAuditCount = (
    await systemDataRepository.listAudit(systemDataWorkspaceId, systemDataReleaseId, "service-request", 20)
  ).length;
  const orgA = database.documents.forOrganization(createOrganizationId("org-a"));
  const orgB = database.documents.forOrganization(createOrganizationId("org-b"));
  await database.documents.writeDocument("tenant-test", "shared", { owner: "platform" });
  await orgA.writeDocument("tenant-test", "shared", { owner: "a" });
  await orgB.writeDocument("tenant-test", "shared", { owner: "b" });
  const structuredRoot = path.join(rootDirectory, "artifacts");

  const organizationWorkspaceRepository = createLocalWorkspaceRepository({
    rootDirectory: structuredRoot,
    documents: orgA,
  });
  const organizationWorkspaceSelectionRepository = createLocalWorkspaceSelectionRepository({
    rootDirectory: structuredRoot,
    documents: orgA,
  });
  const organizationSystemPackActivationRepository = createLocalWorkspaceSystemPackActivationRepository({
    rootDirectory: structuredRoot,
    documents: orgA,
  });
  const organizationWorkspaceResult = await new CreateWorkspaceUseCase({
    workspaceRepository: organizationWorkspaceRepository,
    workspaceSelectionRepository: organizationWorkspaceSelectionRepository,
    systemPackActivationRepository: organizationSystemPackActivationRepository,
    organizationId: createOrganizationId("org-a"),
  }).execute({
    command: {
      displayName: "Jeff's Systems",
      includeSystemFoundationAssets: true,
    },
    selectAfterCreate: true,
  });
  const organizationWorkspaceCount = (await organizationWorkspaceRepository.listWorkspaces()).length;

  const workspaceRepository = createLocalWorkspaceRepository({ rootDirectory: structuredRoot, documents: database.documents });
  await workspaceRepository.saveWorkspace({
    workspaceId: "workspace-sqlite",
    displayName: "SQLite workspace",
    status: "active",
    createdAt: "2026-07-16T12:00:00.000Z",
    updatedAt: "2026-07-16T12:00:00.000Z",
  });
  const persistedWorkspace = await workspaceRepository.readWorkspace("workspace-sqlite");
  try {
    await database.documents.runInTransaction(async (transaction) => {
      await transaction.writeDocument("tests", "rolled-back", { value: true });
      throw new Error("force rollback");
    });
  } catch (error) {
    if (!(error instanceof Error) || error.message !== "force rollback") throw error;
  }

  const health = database.checkHealth();
  const backupPath = path.join(rootDirectory, "backups", "verified.sqlite3");
  const backup = await database.createBackup(backupPath);
  database.close();

  const replacement = await openLocalSqliteDatabase({ policy });
  await replacement.documents.writeDocument("tests", "one", { value: 99 });
  replacement.close();
  const restore = await restoreLocalSqliteDatabase({ backupPath, databasePath: policy.databaseFilePath });

  const restored = await openLocalSqliteDatabase({ policy });
  const restoredDocument = await restored.documents.readDocument<{ value: number }>("tests", "one");
  const rolledBack = await restored.documents.readDocument("tests", "rolled-back");
  const organizationAOwner = (await restored.documents.forOrganization(createOrganizationId("org-a"))
    .readDocument<{ owner: string }>("tenant-test", "shared"))?.value.owner;
  const organizationBOwner = (await restored.documents.forOrganization(createOrganizationId("org-b"))
    .readDocument<{ owner: string }>("tenant-test", "shared"))?.value.owner;
  const platformOwner = (await restored.documents
    .readDocument<{ owner: string }>("tenant-test", "shared"))?.value.owner;
  const systemBuildConformance = await runSystemBuildPersistenceConformance(
    restored.documents,
    "sqlite",
  );
  const systemDeploymentConformance =
    await runSystemDeploymentPersistenceConformance(
      restored.documents,
      "sqlite",
    );
  restored.close();

  process.stdout.write(JSON.stringify({
    health,
    backup,
    restore,
    secondRevision: second.revision,
    systemDataRevision: systemDataRoundTrip?.revision,
    systemDataTitle: systemDataRoundTrip?.values.title,
    systemDataAuditCount,
    systemDataConflict,
    restoredValue: restoredDocument?.value.value,
    rolledBackPresent: Boolean(rolledBack),
    workspaceDisplayName: persistedWorkspace?.displayName,
    workspaceJsonWritten: existsSync(path.join(structuredRoot, "workspaces")),
    organizationWorkspaceStatus: organizationWorkspaceResult.status,
    organizationWorkspaceDisplayName: organizationWorkspaceResult.workspace?.displayName,
    organizationWorkspaceCount,
    organizationWorkspaceActivationCount: organizationWorkspaceResult.systemPackActivations.length,
    organizationWorkspaceSelectionId: organizationWorkspaceResult.activeSelection?.workspaceId,
    organizationAOwner,
    organizationBOwner,
    platformOwner,
    systemBuildConformance,
    systemDeploymentConformance,
  }));
}

void main();
