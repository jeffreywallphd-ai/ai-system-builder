import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import type { AssetBinding, AssetDefinition, AssetInstance, AssetReference } from "../../../modules/contracts/asset";
import type { SystemBuilderRevision } from "../../../modules/contracts/system-builder";
import type { SystemBuildArtifactPort } from "../../../modules/application/ports/system-build";
import { createWorkspaceId } from "../../../modules/contracts/workspace";
import { createSha256SystemBuildHasher } from "../../../modules/adapters/storage/system-build";

export const fixtureTime = "2026-10-21T00:00:00.000Z";
export const fixtureWorkspace = createWorkspaceId("qualification.workspace");
export const fixtureDefinition: AssetDefinition = {
  definitionId: "qualification.page", version: "1.0.0", assetType: "page", assetFamily: "structural", displayName: "Qualification page", description: "Neutral fixture page", lifecycleStatus: "published", provenance: {sourceKind: "human-authored"},
  ports: [
    {portId: "in", direction: "input", contract: {contractKind: "json"}, cardinality: {maxConnections: 2}},
    {portId: "out", direction: "output", contract: {contractKind: "json"}, cardinality: {maxConnections: 2}},
  ],
};
export const fixtureDefinitionRef = {kind: "asset-definition-version", id: "qualification.page", version: "1.0.0"} as AssetReference;

export function createRevisionWorkload(): SystemBuilderRevision {
  const instances: AssetInstance[] = Array.from({length: 500}, (_, i) => ({instanceId: `instance.${i}`, definitionRef: fixtureDefinitionRef, displayName: `Page ${i}`, lifecycleStatus: "draft", selectedConfiguration: {}, parentCompositionRef: {kind: "asset-composition", id: "qualification.composition" as never}, provenance: {sourceKind: "human-authored"}}));
  const instanceRef = (index: number): AssetReference => ({kind: "asset-instance", id: `instance.${index}` as never});
  const bindings: AssetBinding[] = Array.from({length: 1000}, (_, i) => ({bindingId: `binding.${i}`, bindingKind: "output", sourceRef: instanceRef(Math.floor(i / 2)), targetRef: instanceRef((Math.floor(i / 2) + (i % 2) + 1) % 500), sourcePortRef: {kind: "asset-definition", id: "out" as never}, targetPortRef: {kind: "asset-definition", id: "in" as never}}));
  return {
    revisionId: "qualification.revision" as never, systemId: "qualification.system" as never, targetWorkspaceId: fixtureWorkspace, revisionNumber: 1,
    composition: {compositionId: "qualification.composition", compositionType: "system", displayName: "Qualification system", version: "1.0.0", lifecycleStatus: "draft", instanceRefs: instances.map((_, i) => instanceRef(i)), rootInstanceRefs: instances.map((_, i) => instanceRef(i)), bindingRefs: bindings.map(binding => ({kind: "asset-binding", id: binding.bindingId as never})), provenance: {sourceKind: "human-authored"}},
    instances, bindings, validationIssues: [], createdAt: fixtureTime, createdBy: "qualification-owner",
  };
}

export function createVerifiedMemoryArtifactSink() {
  const hasher = createSha256SystemBuildHasher();
  const contents = new Map<string, Uint8Array>();
  const port: SystemBuildArtifactPort = {
    async putImmutable(request) {
      const content: unknown = request.content;
      assert.ok(typeof content === "string" || content instanceof Uint8Array);
      const bytes = typeof content === "string" ? new TextEncoder().encode(content) : content.slice();
      const digest = hasher.digest(bytes);
      if (request.expectedDigest) assert.equal(digest, request.expectedDigest);
      if (contents.has(digest)) assert.deepEqual(contents.get(digest), bytes);
      else contents.set(digest, bytes);
      return {artifactId: `artifact:${request.kind}:${digest.slice(7)}` as never, kind: request.kind, digest, mediaType: request.mediaType, sizeBytes: bytes.byteLength};
    },
    async readVerified(_workspace, descriptor) {
      const bytes = contents.get(descriptor.digest);
      assert.ok(bytes); assert.equal(bytes.byteLength, descriptor.sizeBytes); assert.equal(hasher.digest(bytes), descriptor.digest);
      return bytes.slice() as never;
    },
  };
  return {port, hasher, contents};
}

export function fixtureDigest(value: string): `sha256:${string}` {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}
