// These lifecycle fixtures explicitly admit their synthetic workspaces; real policy denials have separate composed coverage.
const workspaceAccess = { async authorize() {} };
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
import { createPackageFixture, encodePackage } from "../../../../testing/fixtures/asset-package-fixture";
import { createWorkspaceId } from "../../../../contracts/workspace";
import type { AssetDefinitionRepositoryPort } from "../../../ports/asset";
import {
  ActivateAssetPackageUseCase,
  AdmitAssetPackageUseCase,
  DisableAssetPackageUseCase,
  InspectAssetPackageUseCase,
  RollbackAssetPackageUseCase,
} from "..";
import { ResolveAssetImplementationUseCase } from "../../asset-implementation";

describe("asset package lifecycle", () => {
  it("reinspects genuine quarantine bytes before trust or writes despite a stale eligible summary", async () => {
    for (const claim of [`fnv1a:${"0".repeat(8)}`, `sha256:semantic-v2:${"0".repeat(64)}`]) {
      const workspaceId = createWorkspaceId("workspace-a");
      const documents = createInMemoryStructuredDocumentStore();
      const packages = createStructuredAssetPackageRepository(documents);
      const implementations = createStructuredAssetImplementationRepository(documents);
      const backingResources = createStructuredAssetImplementationBackingResourceRepository(documents);
      const artifacts = createAssetImplementationArtifactAdapter(memoryStorage());
      const definitions = memoryDefinitions();
      const inspector = createAisbPackageInspector();
      const fixture = await createPackageFixture(inspector);
      const semantic = fixture.container.manifest.semanticManifest;
      const bytes = encodePackage({ ...fixture.container, manifest: { ...fixture.container.manifest, semanticManifest: {
        ...semantic, assets: semantic.assets.map((entry) => ({ ...entry, fingerprint: claim })),
      } } });
      const now = () => "2026-07-17T12:00:00.000Z";
      const inspect = new InspectAssetPackageUseCase({ workspaceAccess, inspector, repository: packages, artifacts, nextInspectionId: () => "historical-inspection", now });
      const inspected = await inspect.execute({ workspaceId, bytes, actorId: "user-a" });
      if (!inspected.ok) throw new Error("Safe identity-invalid fixture must remain quarantinable.");
      expect(inspected.value.eligibleForAdmission).toBe(false);
      const retained = await packages.readInspection(workspaceId, inspected.value.inspectionId);
      if (!retained) throw new Error("Missing fixture inspection.");
      // Model an older policy summary; immutable bytes/descriptors stay genuine.
      const historicalId = "prior-policy-inspection";
      await packages.saveInspection({ ...retained, inspectionId: historicalId,
        summary: { ...retained.summary, inspectionId: historicalId, eligibleForAdmission: true, issues: [] } });
      let trustCalls = 0;
      let writes = 0;
      const trust = createAssetPackageTrustVerifier();
      const admit = new AdmitAssetPackageUseCase({ workspaceAccess,
        inspector,
        packages: { ...packages, async savePackage(value) { writes++; return packages.savePackage(value); } },
        artifacts: { ...artifacts, async putImmutable(value) { writes++; return artifacts.putImmutable(value); } },
        trust: { async verify(value) { trustCalls++; return trust.verify(value); } },
        definitions: { ...definitions, async saveDefinition(value) { writes++; return definitions.saveDefinition(value); } },
        implementations: { ...implementations,
          async saveRelease(value) { writes++; return implementations.saveRelease(value); },
          async createBinding(value) { writes++; return implementations.createBinding(value); },
        },
        backingResources: { ...backingResources, async save(value) { writes++; return backingResources.save(value); } },
        now,
      });
      const result = await admit.execute({ workspaceId, inspectionId: historicalId,
        packageDigest: inspected.value.packageDigest, approvalScope: "workspace", approvedCapabilities: [], actorId: "user-a" });
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error.code).toBe("package-admission-blocked");
      expect(trustCalls).toBe(0);
      expect(writes).toBe(0);
      expect((await packages.listPackages(workspaceId)).length).toBe(0);
      expect((await implementations.listReleases(workspaceId)).length).toBe(0);
      expect((await backingResources.list(workspaceId)).length).toBe(0);
    }
  });

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
    const inspect = new InspectAssetPackageUseCase({ workspaceAccess, inspector, repository: packages, artifacts, nextInspectionId: () => "inspection-1", now });
    const fixture = await createPackageFixture(inspector);
    const inspected = await inspect.execute({ workspaceId: createWorkspaceId("workspace-a"), bytes: fixture.bytes, actorId: "user-a" });
    expect(inspected.ok).toBe(true);
    if (!inspected.ok) return;

    const admit = new AdmitAssetPackageUseCase({ workspaceAccess, inspector, packages, artifacts, trust: createAssetPackageTrustVerifier(), definitions, implementations, backingResources, now });
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
    const releases = await implementations.listReleases(createWorkspaceId("workspace-a"));
    expect(releases.length).toBe(1);
    expect((await implementations.listBindings(createWorkspaceId("workspace-a")))[0]?.status).toBe("disabled");
    const backing = await backingResources.list(createWorkspaceId("workspace-a"));
    expect(backing.length).toBe(1);
    expect(backing[0]?.origin).toBe("admitted-package");
    expect(backing[0]?.files.some((file) => file.path.endsWith(".js"))).toBe(true);
    expect(backing[0]?.files.find((file) => file.path.endsWith(".js"))?.editable).toBe(false);

    const release = releases[0]!;
    const resolver = new ResolveAssetImplementationUseCase(implementations, packages);
    const resolutionRequest = {
      workspaceId: createWorkspaceId("workspace-a"),
      definitionRef: release.definitionRef,
      requiredFacets: [release.facets[0]!.kind],
      deploymentProfile: release.facets[0]!.compatibility.deploymentProfiles[0]!,
      availableCapabilities: [],
      permittedTrustLevels: ["workspace-approved"],
      hostApiVersion: "1.0.0",
    } as const;
    expect((await resolver.execute(resolutionRequest)).status).toBe("unimplemented");

    const activate = new ActivateAssetPackageUseCase(packages, implementations, now, workspaceAccess);
    const firstActive = await activate.execute({ workspaceId: createWorkspaceId("workspace-a"), recordId: admitted.value.recordId, actorId: "user-a" });
    expect(firstActive.ok && firstActive.value.status).toBe("active");
    expect((await implementations.listBindings(createWorkspaceId("workspace-a")))[0]?.status).toBe("active");
    expect((await resolver.execute(resolutionRequest)).status).toBe("ready");
    const second = await packages.savePackage({ ...admitted.value, recordId: `${admitted.value.recordId}.upgrade`, version: "1.1.0", status: "installed", revision: 1, createdAt: now(), updatedAt: now() });
    const secondActive = await activate.execute({ workspaceId: createWorkspaceId("workspace-a"), recordId: second.recordId, actorId: "user-a" });
    expect(secondActive.ok && secondActive.value.previousActiveRecordId).toBe(admitted.value.recordId);
    const rollback = new RollbackAssetPackageUseCase(packages, activate, workspaceAccess);
    const rolledBack = await rollback.execute({ workspaceId: createWorkspaceId("workspace-a"), recordId: second.recordId, actorId: "user-a" });
    expect(rolledBack.ok && rolledBack.value.recordId).toBe(admitted.value.recordId);
    const disable = new DisableAssetPackageUseCase(packages, implementations, now, workspaceAccess);
    const disabled = await disable.execute({ workspaceId: createWorkspaceId("workspace-a"), recordId: admitted.value.recordId, actorId: "user-a" });
    expect(disabled.ok && disabled.value.status).toBe("disabled");
    expect((await implementations.listBindings(createWorkspaceId("workspace-a")))[0]?.status).toBe("disabled");
    expect((await resolver.execute(resolutionRequest)).status).toBe("unimplemented");
  });

  it("requires verified signatures for organization approval and exact capability consent", async () => {
    const documents = createInMemoryStructuredDocumentStore();
    const packages = createStructuredAssetPackageRepository(documents);
    const implementations = createStructuredAssetImplementationRepository(documents);
    const backingResources = createStructuredAssetImplementationBackingResourceRepository(documents);
    const artifacts = createAssetImplementationArtifactAdapter(memoryStorage());
    const inspector = createAisbPackageInspector();
    const fixture = await createPackageFixture(inspector);
    const inspect = new InspectAssetPackageUseCase({ workspaceAccess, inspector, repository: packages, artifacts, nextInspectionId: () => "inspection-2", now: () => "2026-07-17T12:00:00.000Z" });
    const inspected = await inspect.execute({ workspaceId: createWorkspaceId("workspace-a"), bytes: fixture.bytes, actorId: "user-a" });
    if (!inspected.ok) throw new Error(inspected.error.message);
    const admit = new AdmitAssetPackageUseCase({ workspaceAccess, inspector, packages, artifacts, trust: createAssetPackageTrustVerifier(), definitions: memoryDefinitions(), implementations, backingResources, now: () => "2026-07-17T12:00:01.000Z" });
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
