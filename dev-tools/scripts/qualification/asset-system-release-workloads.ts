import assert from "node:assert/strict";
import { createInMemoryStructuredDocumentStore } from "../../../modules/adapters/persistence/shared";
import { createTrustedSystemDeploymentRuntimeAdapter } from "../../../modules/adapters/runtime/system-deployment";
import { SYSTEM_FOUNDATION_CURRENT_PACK_MANIFEST } from "../../../modules/application/services/asset-packs/system-packs";
import { createRuntimeDatabaseTestAdapter } from "../../../modules/application/use-cases/system-deployment/tests/runtimeDatabaseTestAdapter";
import { createSystemReviewArtifactRef } from "../../../modules/application/use-cases/system-review";
import { composeAssetImplementationKernel, SYSTEM_FOUNDATION_V3_TRUSTED_IMPLEMENTATION_SEEDS } from "../../../modules/hosts/shared/composition/composeAssetImplementationKernel";
import { composeSystemBuilder } from "../../../modules/hosts/shared/composition/composeSystemBuilder";
import { composeSystemBuild } from "../../../modules/hosts/shared/composition/composeSystemBuild";
import { composeSystemReview } from "../../../modules/hosts/shared/composition/composeSystemReview";
import { composeSystemDeployment, createDefaultSystemDeploymentPolicy } from "../../../modules/hosts/shared/composition/composeSystemDeployment";
import { fixtureWorkspace, fixtureTime, createVerifiedMemoryArtifactSink } from "./asset-system-workload-fixtures";

/** Actual verified release boundary; database lifecycle is an explicitly in-memory fixture. */
export async function createReleaseWorkloads(sampleCapacity = 35) {
  const documents = createInMemoryStructuredDocumentStore();
  const definitions = new Map(SYSTEM_FOUNDATION_CURRENT_PACK_MANIFEST.assets.map(entry => [`${entry.definition.definitionId}@${entry.definition.version}`, entry.definition]));
  const getDefinition = async (ref: {id: string; version?: string}) => definitions.get(`${ref.id}@${ref.version}`);
  const implementations = composeAssetImplementationKernel({documents, definitions: {getDefinition, async saveDefinition(value) {return value;}, async listDefinitions() {return {definitions: [...definitions.values()]};}}, trustedSeeds: SYSTEM_FOUNDATION_V3_TRUSTED_IMPLEMENTATION_SEEDS, now: () => fixtureTime});
  await implementations.ensureTrustedBuiltIns();
  const builder = composeSystemBuilder({documents, definitions: {readExactDefinition: getDefinition}, assetRegistryRead: {listDefinitionCards: async () => ({items: []}), readDefinitionDetail: async () => undefined}, generateSystemId: () => "qualification.review-system", now: () => fixtureTime});
  const created = await builder.useCases.createFromTemplate.execute({workspaceId: fixtureWorkspace, templateId: "reference.secured-data-review@1.0.0", name: "Qualification review", actorId: "qualification-owner"});
  assert.ok(created.ok, JSON.stringify(created));
  assert.ok(created.value.currentRevisionId);
  const sink = createVerifiedMemoryArtifactSink();
  const builds = composeSystemBuild({documents, systemBuilder: builder, resolver: {resolve: request => implementations.useCases.resolve.execute(request)}, artifacts: sink.port, hasher: sink.hasher, guidedProfile: {id: "local-desktop", label: "Fixture", deploymentProfile: "local-desktop", availableCapabilities: [], permittedTrustLevels: ["system-trusted"], hostApiVersion: "1.0.0", toolchainProfile: "qualification/1.0.0"}, now: () => fixtureTime});
  const built = await builds.useCases.request.execute({buildId: "qualification.review-build" as never, workspaceId: fixtureWorkspace, systemId: created.value.systemId, systemRevisionId: created.value.currentRevisionId, deploymentProfile: "local-desktop", availableCapabilities: [], permittedTrustLevels: ["system-trusted"], hostApiVersion: "1.0.0", toolchainProfile: "qualification/1.0.0", actorId: "qualification-owner"});
  assert.ok(built.ok && built.value.status === "succeeded", JSON.stringify(built));
  assert.ok(built.value.lockDigest);
  const approved = await builds.useCases.approve.execute({workspaceId: fixtureWorkspace, buildId: built.value.buildId, expectedLockDigest: built.value.lockDigest, actorId: "qualification-owner"});
  assert.ok(approved.ok, JSON.stringify(approved));
  const releaseId = approved.value.releaseId;
  const storageKey = "qualification/review.txt";
  const bytes = new TextEncoder().encode("x".repeat(2_097_152));
  let reads = 0; let sequence = 0;
  const item = {artifactId: storageKey, storageKey, artifactFamily: "structured-text" as const, mediaType: "text/plain", sizeBytes: bytes.byteLength, originalName: "review.txt", createdAt: fixtureTime};
  const review = composeSystemReview({documents, builds: builds.repository, buildArtifacts: sink.port, artifacts: {
    async browseArtifacts(_query, context) {assert.equal(context?.workspaceId, fixtureWorkspace); return {ok: true, value: {items: [item]}};},
    async readArtifactDetail() {throw new Error("Preview must use scoped browse metadata.");},
  }, content: {async retrieveArtifactViewerMediaByStorageKey(request, context) {assert.equal(context?.workspaceId, fixtureWorkspace); assert.equal(request.storageKey, storageKey); assert.equal(request.maximumBytes, bytes.byteLength); reads++; return {ok: true, value: {storageKey, mediaType: "text/plain", bytes}};}}, generateAuditId: () => `qualification.review-audit.${++sequence}`, now: () => fixtureTime});
  const query = {workspaceId: fixtureWorkspace, releaseId, artifactRef: createSystemReviewArtifactRef(storageKey), principal: {actorId: "qualification-viewer", roles: ["viewer"], authenticated: true}};
  const denied = await review.runtime.preview({...query, principal: {...query.principal, authenticated: false}});
  assert.equal(denied.ok, false); assert.equal(reads, 0);
  const definition = await review.definitions.resolve(fixtureWorkspace, releaseId);
  assert.equal(definition?.descriptor.maximumPreviewBytes, bytes.byteLength);

  const handoffs: Array<() => Promise<void>> = [];
  for (let index = 0; index < sampleCapacity; index++) {
    const runtimeDocuments = createInMemoryStructuredDocumentStore();
    let auditSequence = 0;
    const organizationId = "qualification.organization" as never;
    const deploymentId = `qualification.deployment.${index}` as never;
    const root = composeSystemDeployment({documents: runtimeDocuments, builds: builds.repository, artifacts: sink.port, runtime: createTrustedSystemDeploymentRuntimeAdapter({deploymentProfiles: ["local-desktop"], now: () => fixtureTime}), runtimeDatabases: createRuntimeDatabaseTestAdapter(), revocations: {async listRevokedImplementationReleaseIds(_workspace, ids) {const revoked = await implementations.repository.listRevocations(); return ids.filter(id => revoked.some(record => record.releaseId === id));}}, platformPolicy: createDefaultSystemDeploymentPolicy(), generateAuditId: () => `qualification.deployment-audit.${++auditSequence}`, generateRuntimeInstanceId: () => `qualification.runtime.${index}` as never, now: () => fixtureTime});
    const installed = await root.useCases.install.execute({organizationId, workspaceId: fixtureWorkspace, deploymentId, releaseId, deploymentProfile: "local-desktop", hostApiVersion: "1.0.0", hostCapabilities: [], sandboxQualified: false, policy: createDefaultSystemDeploymentPolicy(), actorId: "qualification-owner"});
    assert.ok(installed.ok, JSON.stringify(installed));
    const active = await root.useCases.activate.execute({organizationId, workspaceId: fixtureWorkspace, deploymentId, actorId: "qualification-owner"});
    assert.ok(active.ok && active.value.status === "active", JSON.stringify(active));
    handoffs.push(async () => {
      const runId = `qualification.run.${index}` as never;
      const result = await root.useCases.startRun.execute({organizationId, workspaceId: fixtureWorkspace, deploymentId, runId, requestedCapabilities: [], requestedSecretReferences: [], requestedEgressOrigins: [], actorId: "qualification-owner"});
      assert.ok(result.ok && result.value.status === "running", JSON.stringify(result));
      assert.equal(result.value.launchDescriptor?.releaseId, releaseId);
      const runtimeInstance = await root.runtimeInstanceRepository.readRuntimeInstanceByDeployment(organizationId, fixtureWorkspace, deploymentId);
      assert.equal(runtimeInstance?.runtimeInstanceId, `qualification.runtime.${index}`);
      assert.equal(runtimeInstance?.releaseId, releaseId);
      assert.equal((await root.repository.readRun(organizationId, fixtureWorkspace, runId))?.status, "running");
      const audit = await root.useCases.listAudit.execute({organizationId, workspaceId: fixtureWorkspace, deploymentId, actorId: "qualification-owner"});
      assert.ok(audit.some(entry => entry.action === "run-start" && entry.outcome === "allowed"));
    });
  }
  let handoffIndex = 0;
  return {
    async "system.preview"() {
      const before = reads;
      const result = await review.runtime.preview(query);
      assert.ok(result.ok); assert.equal(result.value.status, "ready"); assert.equal(result.value.kind, "text"); assert.equal(result.value.truncated, true); assert.ok(result.value.text && result.value.text.length <= 16_000); assert.equal(reads, before + 1);
      const audit = await review.audit.listAudit(fixtureWorkspace, releaseId, 100);
      assert.ok(audit.some(entry => entry.action === "preview" && entry.outcome === "allowed"));
    },
    async "runtime.handoff"() {assert.ok(handoffIndex < handoffs.length, "Prepared handoff fixtures exhausted."); await handoffs[handoffIndex++]();},
  };
}
