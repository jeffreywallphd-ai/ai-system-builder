import assert from "node:assert/strict";
import test from "node:test";
import { normalizeAssetId, normalizeAssetSlotId, type AssetInstance } from "../../../../contracts/asset";
import { normalizeAssetImplementationFacetId, normalizeAssetImplementationReleaseId } from "../../../../contracts/asset-implementation";
import { createSystemFormActionBinding, normalizeSystemBuilderRevisionId, normalizeSystemBuilderSystemId,
  SYSTEM_FORM_ACTION_SCHEMA, type SystemBuilderRecord, type SystemBuilderRevision } from "../../../../contracts/system-builder";
import { normalizeSystemBuildArtifactId, normalizeSystemBuildId, normalizeSystemReleaseId, type SystemBuildLockManifest, type SystemRelease } from "../../../../contracts/system-build";
import { createWorkspaceId } from "../../../../contracts/workspace";
import { createSha256SystemBuildHasher } from "../../../../adapters/storage/system-build";
import { canonicalizeSystemBuildValue } from "../../system-build/canonical-system-build-json";
import { ResolveSystemFormReleaseService } from "../resolve-system-form-release.service";

const workspaceId = createWorkspaceId("workspace-form");
const systemId = normalizeSystemBuilderSystemId("system-form");
const revisionId = normalizeSystemBuilderRevisionId("revision-form-1");
const timestamp = "2026-11-12T10:00:00.000Z";
const hasher = createSha256SystemBuildHasher();
const digest = (value: unknown) => hasher.digest(canonicalizeSystemBuildValue(value));
const ref = (id: string) => ({ kind: "asset-instance" as const, id: normalizeAssetId(id) });
const member = (id: string, definition: string, selectedConfiguration: AssetInstance["selectedConfiguration"] = {}): AssetInstance => ({
  instanceId: normalizeAssetId(id), displayName: id, definitionRef: { kind: "asset-definition-version", id: normalizeAssetId(definition), version: "3.0.0" },
  lifecycleStatus: "draft", provenance: { sourceKind: "human-authored" }, selectedConfiguration,
});
const instances = [member("form-a", "builtin.form.form"), member("step-a", "builtin.form.field-group"),
  member("reason", "builtin.form.text-field", { required: true }), member("create-a", "builtin.data.create-operation", { entity: "Request" })];
const binding = createSystemFormActionBinding("action.request", { formId: "form-a", operationId: "create-a",
  mappings: [{ fieldId: "reason", recordField: "reason" }] });
const revision: SystemBuilderRevision = {
  systemId, revisionId, targetWorkspaceId: workspaceId, revisionNumber: 1, instances, bindings: [binding],
  placements: [["form-a", "step-a"], ["step-a", "reason"]].map(([parent, child]) => ({
    schemaVersion: "asset-placement.v1", placementId: `place.${child}`, parentInstanceRef: ref(parent!), childInstanceRef: ref(child!),
    slotId: normalizeAssetSlotId("fields"), order: 0,
  })),
  composition: { compositionId: normalizeAssetId("composition.form"), compositionType: "system", displayName: "Form test", version: "0.1.0", lifecycleStatus: "draft",
    rootInstanceRefs: [ref("form-a")], instanceRefs: instances.map((item) => ref(item.instanceId)),
    bindingRefs: [{ kind: "asset-binding", id: normalizeAssetId(binding.bindingId) }], provenance: { sourceKind: "human-authored" } },
  validationIssues: [], createdAt: timestamp, createdBy: "owner-a",
};
const record: SystemBuilderRecord = { systemId, targetWorkspaceId: workspaceId, name: "Form test", status: "validated", revision: 1,
  currentRevisionId: revisionId, composition: revision.composition, createdBy: "owner-a", createdAt: timestamp, updatedBy: "owner-a", updatedAt: timestamp };

const exactLock: SystemBuildLockManifest = {
  schemaVersion: "1.0", systemId, systemRevisionId: revisionId, systemRevisionDigest: digest(revision), deploymentProfile: "local-desktop",
  hostApiVersion: "1.0.0", toolchainProfile: "form-test", policyCompilerVersion: "test", workflowCompilerVersion: "test", schemaCompilerVersion: "test",
  resolvedImplementations: instances.map((item) => ({ instanceId: String(item.instanceId), definitionRef: item.definitionRef,
    releaseId: normalizeAssetImplementationReleaseId(`implementation.${item.instanceId}`), releaseVersion: "3.0.0", packageDigest: digest(item.definitionRef),
    trustLevel: "system-trusted", facets: [{ facetId: normalizeAssetImplementationFacetId(`facet.${item.instanceId}`), kind: "declarative", runtimeKind: "trusted-built-in",
      entryKey: `foundation.${item.instanceId}`, requiredCapabilities: [], compatibility: { definitionVersion: "3.0.0", hostApiRange: ">=1.0.0 <2.0.0", deploymentProfiles: ["local-desktop"] } }] })),
  runtimeFormActions: [{ schemaVersion: SYSTEM_FORM_ACTION_SCHEMA, formId: "form-a", operationId: "create-a" }],
};
function fixture(options: { lock?: SystemBuildLockManifest; revision?: SystemBuilderRevision; record?: SystemBuilderRecord; revoked?: boolean; tampered?: boolean } = {}) {
  const lock = options.lock ?? exactLock;
  const lockDigest = digest(lock);
  const manifest = { artifactId: normalizeSystemBuildArtifactId("artifact.form.manifest"), kind: "manifest" as const,
    digest: digest(revision.composition), mediaType: "application/json", sizeBytes: 250 };
  const releaseDigest = digest({ lockDigest, artifacts: [{ kind: manifest.kind, digest: manifest.digest }] });
  const releaseId = normalizeSystemReleaseId(`system-release:${releaseDigest.slice(7)}`);
  const release: SystemRelease = { releaseId, targetWorkspaceId: workspaceId, systemId, systemRevisionId: revisionId,
    sourceBuildId: normalizeSystemBuildId("build-form"), lockDigest, releaseDigest, lock, artifacts: [manifest],
    compatibility: { deploymentProfiles: ["local-desktop"], hostApiVersion: "1.0.0" }, assurance: "repeatable",
    approvedBy: "owner-a", approvedAt: timestamp, createdAt: timestamp };
  const service = new ResolveSystemFormReleaseService({ hasher, builds: { readRelease: async () => release }, systems: {
    readRecord: async () => options.record ?? record, readRevision: async () => options.revision ?? revision,
  }, revocations: { listRevokedImplementationReleaseIds: async (_id, ids) => options.revoked ? ids.slice(0, 1) : [] },
  artifacts: { readVerified: async () => { if (options.tampered) throw new Error("synthetic invalid manifest"); return new Uint8Array() as never; } } });
  return { service, request: { workspaceId, releaseId, releaseDigest, formId: "form-a" } };
}

test("form action admission needs the exact approved release and stamped trusted form", async () => {
  const { service, request } = fixture();
  assert.equal((await service.resolve(request))?.operationId, "create-a");
  assert.equal(await service.resolve({ ...request, workspaceId: createWorkspaceId("other-workspace") }), undefined);
  assert.equal(await service.resolve({ ...request, releaseDigest: digest("different") }), undefined);
  assert.equal(await service.resolve({ ...request, formId: "another-form" }), undefined);
});

test("listing returns each admitted form once and rejects duplicate or missing stamps", async () => {
  const { service, request } = fixture();
  assert.deepEqual((await service.list(request)).map((entry) => entry.form.id), ["form-a"]);
  const duplicate = fixture({ lock: { ...exactLock, runtimeFormActions: [
    ...exactLock.runtimeFormActions!, ...exactLock.runtimeFormActions!,
  ] } });
  assert.deepEqual(await duplicate.service.list(duplicate.request), []);
  const unstamped = fixture({ lock: { ...exactLock, runtimeFormActions: undefined } });
  assert.deepEqual(await unstamped.service.list(unstamped.request), []);
});

test("the discovery count does not deny a valid exact form in a larger stamped release", async () => {
  const { service, request } = fixture({ lock: { ...exactLock, runtimeFormActions: [
    ...exactLock.runtimeFormActions!, ...Array.from({ length: 64 }, (_, index) => ({
      schemaVersion: SYSTEM_FORM_ACTION_SCHEMA as typeof SYSTEM_FORM_ACTION_SCHEMA, formId: `other-form-${index}`, operationId: "create-a",
    })),
  ] } });
  assert.equal((await service.resolve(request))?.form.id, "form-a");
  assert.deepEqual((await service.list(request)).map((entry) => entry.form.id), ["form-a"]);
});

test("old locks, altered revisions, untrusted implementations and current revocation cannot admit an action", async () => {
  const untrusted = exactLock.resolvedImplementations.map((item) => item.instanceId === "create-a"
    ? { ...item, trustLevel: "workspace-approved" as const } : item);
  const samples = [fixture({ lock: { ...exactLock, runtimeFormActions: undefined } }),
    fixture({ lock: { ...exactLock, resolvedImplementations: untrusted } }),
    fixture({ revision: { ...revision, revisionNumber: 2 } }), fixture({ revoked: true }), fixture({ tampered: true }),
    fixture({ record: { ...record, status: "archived" } }),
    fixture({ record: { ...record, systemId: normalizeSystemBuilderSystemId("system-other") } })];
  for (const { service, request } of samples) assert.equal(await service.resolve(request), undefined);
});
