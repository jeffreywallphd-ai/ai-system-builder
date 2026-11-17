import assert from "node:assert/strict";
import { createInMemoryStructuredDocumentStore } from "../../../modules/adapters/persistence/shared";
import { createStructuredAssetImplementationRepository } from "../../../modules/adapters/persistence/asset-implementation";
import { createStructuredSystemBuildRepository } from "../../../modules/adapters/persistence/system-build";
import { createStructuredSystemBuilderRepository } from "../../../modules/adapters/persistence/system-builder";
import { ResolveAssetImplementationUseCase } from "../../../modules/application/use-cases/asset-implementation";
import { ValidateSystemBuilderRevisionService } from "../../../modules/application/services/system-builder";
import { createDeterministicSystemBuildMaterializer } from "../../../modules/application/services/system-build";
import { RequestSystemBuildUseCase } from "../../../modules/application/use-cases/system-build";
import type { AssetImplementationBinding, AssetImplementationRelease, AssetImplementationResolutionRequest } from "../../../modules/contracts/asset-implementation";
import { createRevisionWorkload, createVerifiedMemoryArtifactSink, fixtureDefinition, fixtureDefinitionRef, fixtureDigest, fixtureTime, fixtureWorkspace } from "./asset-system-workload-fixtures";

export async function createCoreWorkloads() {
  const documents = createInMemoryStructuredDocumentStore();
  const implementations = createStructuredAssetImplementationRepository(documents);
  for (let i = 0; i < 500; i++) {
    const release: AssetImplementationRelease = {
      releaseId: `implementation.${i}` as never, workspaceId: fixtureWorkspace, definitionRef: fixtureDefinitionRef, version: `1.0.${i}`, status: "published", trustLevel: "system-trusted",
      facets: [{facetId: `facet.${i}` as never, kind: "ui", runtimeKind: "trusted-built-in", entryKey: "foundation.page", requiredCapabilities: [], compatibility: {definitionVersion: "1.0.0", hostApiRange: i === 499 ? ">=9.0.0 <10.0.0" : ">=1.0.0 <2.0.0", deploymentProfiles: ["local-desktop"]}}],
      packageDigest: fixtureDigest(`package.${i}`), evidenceArtifacts: [], createdAt: fixtureTime, publishedAt: fixtureTime, publishedBy: "qualification-owner",
    };
    const binding: AssetImplementationBinding = {bindingId: `binding.${i}` as never, workspaceId: fixtureWorkspace, definitionRef: fixtureDefinitionRef, releaseId: release.releaseId, status: "active", priority: 100, revision: 1, createdAt: fixtureTime, updatedAt: fixtureTime, approvedBy: "qualification-owner"};
    await implementations.saveRelease(release); await implementations.createBinding(binding);
  }
  await implementations.saveRevocation({revocationId: "revocation.highest-compatible" as never, releaseId: "implementation.498" as never, reasonCode: "qualification-denial", message: "Qualification revocation", revokedAt: fixtureTime, revokedBy: "qualification-owner"});
  const resolver = new ResolveAssetImplementationUseCase(implementations);
  const request: AssetImplementationResolutionRequest = {workspaceId: fixtureWorkspace, definitionRef: fixtureDefinitionRef, requiredFacets: ["ui"], deploymentProfile: "local-desktop", availableCapabilities: [], permittedTrustLevels: ["system-trusted"], hostApiVersion: "1.0.0"};
  const revoked = await resolver.execute({...request, lockedReleaseId: "implementation.498" as never});
  assert.equal(revoked.status, "revoked");
  const revision = createRevisionWorkload();
  assert.equal(revision.instances.length, 500); assert.equal(revision.bindings.length, 1000);
  const definitions = new Map([[`${fixtureDefinitionRef.id}@${fixtureDefinitionRef.version}`, fixtureDefinition]]);
  const validator = new ValidateSystemBuilderRevisionService({readExactDefinition: async ref => definitions.get(`${ref.id}@${ref.version}`)}, () => fixtureTime);
  const invalid = await validator.execute({...revision, instances: revision.instances.slice(0, 499)});
  assert.equal(invalid.status, "invalid");
  const systems = createStructuredSystemBuilderRepository(documents);
  await systems.saveRevision(revision);
  const builds = createStructuredSystemBuildRepository(documents);
  const sink = createVerifiedMemoryArtifactSink(); let sequence = 0;
  const build = new RequestSystemBuildUseCase({systems, repository: builds, validator, resolver: {resolve: request => resolver.execute(request)}, artifacts: sink.port, hasher: sink.hasher, materializer: createDeterministicSystemBuildMaterializer(), now: () => fixtureTime});
  return {
    async "studio.validate"() {
      const result = await validator.execute(revision); assert.equal(result.status, "valid"); assert.equal(result.issues.length, 0);
    },
    async "implementation.resolve"() {
      const result = await resolver.execute(request); assert.equal(result.status, "ready"); assert.equal(result.selectedRelease?.releaseId, "implementation.497"); assert.equal(result.selectedFacets.length, 1);
    },
    async "system.build"() {
      const result = await build.execute({buildId: `qualification.build.${++sequence}` as never, workspaceId: fixtureWorkspace, systemId: revision.systemId, systemRevisionId: revision.revisionId, deploymentProfile: "local-desktop", availableCapabilities: [], permittedTrustLevels: ["system-trusted"], hostApiVersion: "1.0.0", toolchainProfile: "qualification/1.0.0", actorId: "qualification-owner"});
      assert.ok(result.ok); assert.equal(result.value.status, "succeeded");
      assert.equal(result.value.lock?.resolvedImplementations.length, 500); assert.ok(result.value.outputArtifacts.length);
      for (const artifact of result.value.outputArtifacts) await sink.port.readVerified(fixtureWorkspace, artifact);
    },
  };
}
