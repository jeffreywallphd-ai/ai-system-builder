import { describe, expect, it } from "../../../../testing/node-test";
import { normalizeSystemBuildArtifactId, normalizeSystemReleaseId } from "../../../../contracts/system-build";
import { createWorkspaceId } from "../../../../contracts/workspace";
import { ReleaseBoundSystemDataDefinitionService } from "../release-bound-system-data-definition.service";

const workspaceId = createWorkspaceId("workspace-release");
const releaseId = normalizeSystemReleaseId("release-reference");
const descriptor = {
  artifactId: normalizeSystemBuildArtifactId("artifact-manifest"),
  kind: "manifest",
  digest: ("sha256:" + "a".repeat(64)) as const,
  mediaType: "application/vnd.ai-system-builder.manifest+json",
  sizeBytes: 1,
} as const;

function manifest() {
  const policy = (action: string, roles: readonly string[]) => ({
    definitionRef: { id: "builtin.security.authorization-policy" },
    selectedConfiguration: { action, allowedRoles: roles },
  });
  return {
    instances: [
      { definitionRef: { id: "builtin.security.authentication-requirement" }, selectedConfiguration: { required: true } },
      { definitionRef: { id: "builtin.security.field-mask" }, selectedConfiguration: { protectedFields: ["secret"], visibleToRoles: ["owner"] } },
      { definitionRef: { id: "builtin.security.audit-event" }, selectedConfiguration: { eventType: "system-data.record" } },
      { definitionRef: { id: "builtin.data.create-operation" }, selectedConfiguration: { entity: "service-request" } },
      { definitionRef: { id: "builtin.data.read-operation" }, selectedConfiguration: { entity: "service-request" } },
      { definitionRef: { id: "builtin.data.update-operation" }, selectedConfiguration: { entity: "service-request" } },
      { definitionRef: { id: "builtin.data.list-operation" }, selectedConfiguration: { entity: "service-request", maximumPageSize: "40" } },
      { definitionRef: { id: "builtin.workflow.record-crud" }, selectedConfiguration: { entity: "service-request" } },
      { definitionRef: { id: "builtin.data.entity" }, selectedConfiguration: { name: "service-request" } },
      { definitionRef: { id: "builtin.data.field" }, selectedConfiguration: { name: "title", label: "Title", type: "text", required: true, maximumLength: 120 } },
      { definitionRef: { id: "builtin.data.field" }, selectedConfiguration: { name: "secret", label: "Secret", type: "text", required: false } },
      { definitionRef: { id: "builtin.form.form" }, selectedConfiguration: { title: "Request details" } },
      policy("create", ["owner", "editor"]),
      policy("read", ["owner", "editor", "viewer"]),
      policy("update", ["owner", "editor"]),
      policy("list", ["owner", "editor", "viewer"]),
    ],
  };
}

function release() {
  return {
    releaseId,
    targetWorkspaceId: workspaceId,
    artifacts: [descriptor],
  } as any;
}

describe("release-bound system-data definition resolver", () => {
  it("derives a finite form schema and narrowing policies only from a verified approved release", async () => {
    const service = new ReleaseBoundSystemDataDefinitionService(
      { async readRelease(candidateWorkspace, candidateRelease) {
        return candidateWorkspace === workspaceId && candidateRelease === releaseId ? release() : undefined;
      } } as any,
      { async readVerified() {
        return new TextEncoder().encode(JSON.stringify(manifest()));
      } },
    );
    const resolved = await service.resolve(workspaceId, releaseId, "service-request");
    expect(resolved).toBeDefined();
    expect(resolved?.descriptor.maximumPageSize).toBe(40);
    expect(resolved?.descriptor.fields.find((field) => field.name === "secret")?.protected).toBe(true);
    expect(resolved?.rolesByAction.update).toEqual(["owner", "editor"]);
    expect(await service.resolve(workspaceId, normalizeSystemReleaseId("release-missing"), "service-request")).toBeUndefined();
  });

  it("fails closed when verified content is unavailable or policy evidence is incomplete", async () => {
    const unavailable = new ReleaseBoundSystemDataDefinitionService(
      { async readRelease() { return release(); } } as any,
      { async readVerified() { throw new Error("digest mismatch"); } },
    );
    expect(await unavailable.resolve(workspaceId, releaseId, "service-request")).toBeUndefined();
    const incompleteDocument = manifest();
    incompleteDocument.instances.splice(incompleteDocument.instances.findIndex((item) =>
      item.definitionRef.id === "builtin.security.authorization-policy"
      && item.selectedConfiguration.action === "update"), 1);
    const incomplete = new ReleaseBoundSystemDataDefinitionService(
      { async readRelease() { return release(); } } as any,
      { async readVerified() { return new TextEncoder().encode(JSON.stringify(incompleteDocument)); } },
    );
    expect(await incomplete.resolve(workspaceId, releaseId, "service-request")).toBeUndefined();
  });

  it("rejects ambiguous or misbound security and operation declarations", async () => {
    const candidates = [
      (() => {
        const document = manifest() as any;
        document.instances.find((item: any) => item.definitionRef.id === "builtin.security.authentication-requirement").selectedConfiguration.required = false;
        return document;
      })(),
      (() => {
        const document = manifest() as any;
        document.instances.find((item: any) => item.definitionRef.id === "builtin.data.update-operation").selectedConfiguration.entity = "other-entity";
        return document;
      })(),
      (() => {
        const document = manifest() as any;
        document.instances.push(document.instances.find((item: any) => item.definitionRef.id === "builtin.security.field-mask"));
        return document;
      })(),
    ];
    for (const candidate of candidates) {
      const service = new ReleaseBoundSystemDataDefinitionService(
        { async readRelease() { return release(); } } as any,
        { async readVerified() { return new TextEncoder().encode(JSON.stringify(candidate)); } },
      );
      expect(await service.resolve(workspaceId, releaseId, "service-request")).toBeUndefined();
    }
  });
});
