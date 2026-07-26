import { createHash } from "node:crypto";

import { describe, expect, it } from "../../../../testing/node-test";
import { createInMemoryStructuredDocumentStore } from "../../../../adapters/persistence/shared";
import {
  createStructuredAssetImplementationBackingResourceRepository,
  createStructuredAssetImplementationRepository,
} from "../../../../adapters/persistence/asset-implementation";
import { createStructuredAssetPackageRepository } from "../../../../adapters/persistence/asset-package";
import { createAssetImplementationArtifactAdapter } from "../../../../adapters/storage/asset-implementation";
import { createAisbPackageInspector } from "../../../../adapters/package/aisb";
import { createAssetPackageTrustVerifier } from "../../../../adapters/package/trust";
import { createPackageFixture } from "../../../../testing/fixtures/asset-package-fixture";
import { createWorkspaceId } from "../../../../contracts/workspace";
import type { AssetDefinitionRepositoryPort } from "../../../ports/asset";
import {
  ActivateAssetPackageUseCase,
  AdmitAssetPackageUseCase,
  DisableAssetPackageUseCase,
  InspectAssetPackageUseCase,
  RollbackAssetPackageUseCase,
} from "..";

describe("asset package lifecycle", () => {
  it("quarantines, explicitly admits, installs, activates, disables, and rolls back without overwrite", async () => {
    const documents = createInMemoryStructuredDocumentStore();
    const packages = createStructuredAssetPackageRepository(documents);
    const implementations = createStructuredAssetImplementationRepository(documents);
    const backingResources = createStructuredAssetImplementationBackingResourceRepository(documents);
    const artifacts = createAssetImplementationArtifactAdapter(memoryStorage());
    const inspector = createAisbPackageInspector();
    const definitions = memoryDefinitions();
    let clock = 0;
    const now = () => `2026-07-17T12:00:0${clock++}.000Z`;
    const inspect = new InspectAssetPackageUseCase({ inspector, repository: packages, artifacts, nextInspectionId: () => "inspection-1", now });
    const fixture = await createPackageFixture(inspector);
    const inspected = await inspect.execute({ workspaceId: createWorkspaceId("workspace-a"), bytes: fixture.bytes, actorId: "user-a" });
    expect(inspected.ok).toBe(true);
    if (!inspected.ok) return;

    const admit = new AdmitAssetPackageUseCase({ inspector, packages, artifacts, trust: createAssetPackageTrustVerifier(), definitions, implementations, backingResources, now });
    const admitted = await admit.execute({
      workspaceId: createWorkspaceId("workspace-a"),
      inspectionId: inspected.value.inspectionId,
      packageDigest: inspected.value.packageDigest,
      approvalScope: "workspace",
      approvedCapabilities: [],
      actorId: "user-a",
    });
    expect(admitted.ok).toBe(true);
    if (!admitted.ok) return;
    expect(admitted.value.status).toBe("installed");
    expect((await implementations.listReleases(createWorkspaceId("workspace-a"))).length).toBe(1);
    const backing = await backingResources.list(createWorkspaceId("workspace-a"));
    expect(backing.length).toBe(1);
    expect(backing[0]?.origin).toBe("admitted-package");
    expect(backing[0]?.files.some((file) => file.path.endsWith(".js"))).toBe(true);
    expect(backing[0]?.files.find((file) => file.path.endsWith(".js"))?.editable).toBe(false);

    const activate = new ActivateAssetPackageUseCase(packages, now);
    const firstActive = await activate.execute({ workspaceId: createWorkspaceId("workspace-a"), recordId: admitted.value.recordId, actorId: "user-a" });
    expect(firstActive.ok && firstActive.value.status).toBe("active");
    const second = await packages.savePackage({ ...admitted.value, recordId: `${admitted.value.recordId}.upgrade`, version: "1.1.0", status: "installed", revision: 1, createdAt: now(), updatedAt: now() });
    const secondActive = await activate.execute({ workspaceId: createWorkspaceId("workspace-a"), recordId: second.recordId, actorId: "user-a" });
    expect(secondActive.ok && secondActive.value.previousActiveRecordId).toBe(admitted.value.recordId);
    const rollback = new RollbackAssetPackageUseCase(packages, activate);
    const rolledBack = await rollback.execute({ workspaceId: createWorkspaceId("workspace-a"), recordId: second.recordId, actorId: "user-a" });
    expect(rolledBack.ok && rolledBack.value.recordId).toBe(admitted.value.recordId);
    const disable = new DisableAssetPackageUseCase(packages, now);
    const disabled = await disable.execute({ workspaceId: createWorkspaceId("workspace-a"), recordId: admitted.value.recordId, actorId: "user-a" });
    expect(disabled.ok && disabled.value.status).toBe("disabled");
  });

  it("requires verified signatures for organization approval and exact capability consent", async () => {
    const documents = createInMemoryStructuredDocumentStore();
    const packages = createStructuredAssetPackageRepository(documents);
    const implementations = createStructuredAssetImplementationRepository(documents);
    const backingResources = createStructuredAssetImplementationBackingResourceRepository(documents);
    const artifacts = createAssetImplementationArtifactAdapter(memoryStorage());
    const inspector = createAisbPackageInspector();
    const fixture = await createPackageFixture(inspector);
    const inspect = new InspectAssetPackageUseCase({ inspector, repository: packages, artifacts, nextInspectionId: () => "inspection-2", now: () => "2026-07-17T12:00:00.000Z" });
    const inspected = await inspect.execute({ workspaceId: createWorkspaceId("workspace-a"), bytes: fixture.bytes, actorId: "user-a" });
    if (!inspected.ok) throw new Error(inspected.error.message);
    const admit = new AdmitAssetPackageUseCase({ inspector, packages, artifacts, trust: createAssetPackageTrustVerifier(), definitions: memoryDefinitions(), implementations, backingResources, now: () => "2026-07-17T12:00:01.000Z" });
    const result = await admit.execute({ workspaceId: createWorkspaceId("workspace-a"), inspectionId: inspected.value.inspectionId, packageDigest: inspected.value.packageDigest, approvalScope: "organization", approvedCapabilities: [], actorId: "admin-a" });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("package-signature-required");
  });
});

function memoryDefinitions(): AssetDefinitionRepositoryPort {
  const values = new Map<string, any>();
  return {
    async saveDefinition(value) { const key = `${value.definitionId}@${value.version}`; const existing = values.get(key); if (existing && JSON.stringify(existing) !== JSON.stringify(value)) throw new Error("conflict"); values.set(key, structuredClone(value)); return value; },
    async getDefinition(reference) { return values.get(`${reference.id}@${reference.version}`); },
    async listDefinitions() { return { definitions: [...values.values()] }; },
  };
}

function memoryStorage() {
  const values = new Map<string, Uint8Array>();
  return {
    async storeArtifact(request: any) {
      if (values.has(request.descriptor.key)) return { ok: false as const, error: { code: "conflict", message: "exists" } };
      values.set(request.descriptor.key, Uint8Array.from(request.content));
      return { ok: true as const, value: { descriptor: request.descriptor } };
    },
    async retrieveArtifact(request: any) {
      const value = values.get(request.key);
      return value
        ? { ok: true as const, value: { descriptor: { key: request.key, mediaType: "application/octet-stream", sizeBytes: value.byteLength, checksum: { algorithm: "sha256", value: createHash("sha256").update(value).digest("hex") } }, content: value } }
        : { ok: false as const, error: { code: "not-found", message: "missing" } };
    },
  } as any;
}
