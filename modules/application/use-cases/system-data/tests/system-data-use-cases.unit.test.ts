import { describe, expect, it } from "../../../../testing/node-test";
import { createInMemoryStructuredDocumentStore } from "../../../../adapters/persistence/shared";
import { createStructuredSystemDataRepository } from "../../../../adapters/persistence/system-data";
import type { SystemDataResolvedDefinition } from "../../../ports/system-data";
import { normalizeSystemReleaseId } from "../../../../contracts/system-build";
import { createWorkspaceId } from "../../../../contracts/workspace";
import { ReleaseBoundSystemDataUseCases } from "../system-data-use-cases";

const workspaceId = createWorkspaceId("workspace-runtime");
const releaseId = normalizeSystemReleaseId("release-runtime");
const definition: SystemDataResolvedDefinition = {
  descriptor: {
    schemaVersion: "1.0",
    targetWorkspaceId: workspaceId,
    releaseId,
    entityType: "service-request",
    title: "Request details",
    maximumPageSize: 50,
    fields: [
      { name: "title", label: "Title", type: "text", required: true, maximumLength: 20 },
      { name: "amount", label: "Amount", type: "number", required: true, minimum: 0, maximum: 100 },
      { name: "status", label: "Status", type: "enum", required: true, enumValues: ["draft", "submitted"] },
      { name: "dueDate", label: "Due date", type: "date", required: true },
      { name: "relatedRequest", label: "Related request", type: "relationship", required: false },
      { name: "confidentialNotes", label: "Confidential notes", type: "text", required: false, protected: true },
    ],
  },
  rolesByAction: {
    create: ["owner", "editor"],
    read: ["owner", "editor", "viewer"],
    update: ["owner", "editor"],
    list: ["owner", "editor", "viewer"],
  },
  unmaskRoles: ["owner"],
};
const owner = { actorId: "owner-a", roles: ["owner"], authenticated: true };
const editor = { actorId: "editor-a", roles: ["editor"], authenticated: true };
const viewer = { actorId: "viewer-a", roles: ["viewer"], authenticated: true };

function createRuntime() {
  const repository = createStructuredSystemDataRepository(createInMemoryStructuredDocumentStore());
  let id = 0;
  const definitions = {
    async resolve(candidateWorkspaceId: typeof workspaceId, candidateReleaseId: typeof releaseId, entityType: string) {
      return candidateWorkspaceId === workspaceId && candidateReleaseId === releaseId && entityType === "service-request"
        ? definition
        : undefined;
    },
  };
  return {
    repository,
    runtime: new ReleaseBoundSystemDataUseCases({
      repository,
      definitions,
      generateAuditId: () => "audit-" + (++id),
      now: () => "2026-07-17T00:00:00.000Z",
    }),
  };
}

const values = {
  title: "Quarterly request",
  amount: 25,
  status: "draft",
  dueDate: "2026-08-01",
  relatedRequest: "record-related",
  confidentialNotes: "never place this value in audit",
} as const;

describe("release-bound system-data use cases", () => {
  it("validates allowlisted fields on the trusted layer and records safe audit metadata", async () => {
    const { runtime, repository } = createRuntime();
    const invalid = await runtime.create({
      workspaceId,
      releaseId,
      entityType: "service-request",
      principal: editor,
      recordId: "record-invalid",
      values: { ...values, amount: -1, unknown: "value" },
    });
    expect(invalid.ok).toBe(false);
    if (!invalid.ok) expect(["system-data.field-unknown", "system-data.field-minimum"]).toContain(invalid.error.code);
    const created = await runtime.create({
      workspaceId,
      releaseId,
      entityType: "service-request",
      principal: editor,
      recordId: "record-a",
      values,
    });
    expect(created.ok).toBe(true);
    const audits = await repository.listAudit(workspaceId, releaseId, "service-request", 20);
    expect(audits.some((entry) => entry.outcome === "validation-failed")).toBe(true);
    expect(JSON.stringify(audits).includes("never place this value in audit")).toBe(false);
    expect(audits.find((entry) => entry.outcome === "allowed")?.changedFields).toContain("confidentialNotes");
  });

  it("authorizes every action, masks protected fields, and fails closed for other releases", async () => {
    const { runtime } = createRuntime();
    const deniedCreate = await runtime.create({
      workspaceId,
      releaseId,
      entityType: "service-request",
      principal: viewer,
      recordId: "record-denied",
      values,
    });
    expect(deniedCreate.ok).toBe(false);
    if (!deniedCreate.ok) expect(deniedCreate.error.code).toBe("system-data.forbidden");
    const created = await runtime.create({
      workspaceId,
      releaseId,
      entityType: "service-request",
      principal: editor,
      recordId: "record-a",
      values,
    });
    expect(created.ok).toBe(true);
    const masked = await runtime.read({
      workspaceId,
      releaseId,
      entityType: "service-request",
      principal: viewer,
      recordId: "record-a",
    });
    expect(masked.ok).toBe(true);
    if (masked.ok) expect(masked.value.values.confidentialNotes).toBeUndefined();
    const unmasked = await runtime.read({
      workspaceId,
      releaseId,
      entityType: "service-request",
      principal: owner,
      recordId: "record-a",
    });
    expect(unmasked.ok).toBe(true);
    if (unmasked.ok) expect(unmasked.value.values.confidentialNotes).toBe(values.confidentialNotes);
    const unavailable = await runtime.list({
      workspaceId,
      releaseId: normalizeSystemReleaseId("release-other"),
      entityType: "service-request",
      principal: owner,
    });
    expect(unavailable.ok).toBe(false);
    if (!unavailable.ok) expect(unavailable.error.code).toBe("system-data.release-unavailable");
  });

  it("enforces optimistic updates and restricts audit inspection", async () => {
    const { runtime } = createRuntime();
    const created = await runtime.create({
      workspaceId,
      releaseId,
      entityType: "service-request",
      principal: editor,
      recordId: "record-a",
      values,
    });
    if (!created.ok) throw new Error(created.error.message);
    const updated = await runtime.update({
      workspaceId,
      releaseId,
      entityType: "service-request",
      principal: editor,
      recordId: "record-a",
      expectedRevision: 1,
      values: { ...values, status: "submitted" },
    });
    expect(updated.ok).toBe(true);
    const conflict = await runtime.update({
      workspaceId,
      releaseId,
      entityType: "service-request",
      principal: editor,
      recordId: "record-a",
      expectedRevision: 1,
      values,
    });
    expect(conflict.ok).toBe(false);
    if (!conflict.ok) expect(conflict.error.code).toBe("system-data.conflict");
    const deniedAudit = await runtime.listAudit({
      workspaceId,
      releaseId,
      entityType: "service-request",
      principal: viewer,
    });
    expect(deniedAudit.ok).toBe(false);
    const allowedAudit = await runtime.listAudit({
      workspaceId,
      releaseId,
      entityType: "service-request",
      principal: owner,
    });
    expect(allowedAudit.ok).toBe(true);
    if (allowedAudit.ok) expect(allowedAudit.value.some((entry) => entry.outcome === "conflict")).toBe(true);
  });
});
