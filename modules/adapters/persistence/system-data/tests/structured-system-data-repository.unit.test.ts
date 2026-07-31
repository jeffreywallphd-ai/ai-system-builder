import { describe, expect, it } from "../../../../testing/node-test";
import { createOrganizationId } from "../../../../contracts/organization";
import { normalizeSystemReleaseId } from "../../../../contracts/system-build";
import type { SystemDataAuditEntry, SystemDataRecord } from "../../../../contracts/system-data";
import { createWorkspaceId } from "../../../../contracts/workspace";
import { createInMemoryStructuredDocumentStore } from "../../shared";
import { createStructuredSystemDataRepository } from "../createStructuredSystemDataRepository";

const workspaceId = createWorkspaceId("workspace-a");
const releaseId = normalizeSystemReleaseId("release-a");
const timestamp = "2026-07-17T00:00:00.000Z";

function record(revision = 1): SystemDataRecord {
  return {
    recordId: "record-a",
    targetWorkspaceId: workspaceId,
    releaseId,
    entityType: "service-request",
    revision,
    values: { title: revision === 1 ? "First" : "Updated" },
    createdAt: timestamp,
    createdBy: "person-a",
    updatedAt: timestamp,
    updatedBy: "person-a",
  };
}

function audit(auditId: string, action: SystemDataAuditEntry["action"] = "create"): SystemDataAuditEntry {
  return {
    auditId,
    targetWorkspaceId: workspaceId,
    releaseId,
    entityType: "service-request",
    action,
    outcome: "allowed",
    actorId: "person-a",
    recordId: "record-a",
    changedFields: ["title"],
    occurredAt: timestamp,
  };
}

describe("structured system-data repository", () => {
  it("atomically persists optimistic records and append-only audit entries", async () => {
    const repository = createStructuredSystemDataRepository(createInMemoryStructuredDocumentStore());
    await repository.createRecordWithAudit(record(), audit("audit-create"));
    expect(await repository.readRecord(workspaceId, releaseId, "service-request", "record-a")).toEqual(record());
    await expect(repository.updateRecordWithAudit(record(2), audit("audit-update", "update"), 1)).resolves.toEqual(record(2));
    await expect(repository.updateRecordWithAudit(record(2), audit("audit-stale", "update"), 1)).rejects.toThrow();
    expect((await repository.listAudit(workspaceId, releaseId, "service-request", 20)).map((item) => item.auditId).sort()).toEqual(["audit-create", "audit-update"]);
    await expect(repository.appendAudit(audit("audit-create"))).rejects.toThrow();
  });

  it("isolates workspace, release, entity, and organization scopes", async () => {
    const root = createInMemoryStructuredDocumentStore();
    const organizationA = createStructuredSystemDataRepository(root.forOrganization(createOrganizationId("org-a")));
    const organizationB = createStructuredSystemDataRepository(root.forOrganization(createOrganizationId("org-b")));
    await organizationA.createRecordWithAudit(record(), audit("audit-a"));
    expect(await organizationA.listRecords(createWorkspaceId("workspace-b"), releaseId, "service-request")).toEqual([]);
    expect(await organizationA.listRecords(workspaceId, normalizeSystemReleaseId("release-b"), "service-request")).toEqual([]);
    expect(await organizationA.listRecords(workspaceId, releaseId, "other-entity")).toEqual([]);
    expect(await organizationB.listRecords(workspaceId, releaseId, "service-request")).toEqual([]);
    expect(await organizationB.listAudit(workspaceId, releaseId, "service-request", 20)).toEqual([]);
  });
});
