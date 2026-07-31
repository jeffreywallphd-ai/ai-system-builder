import type { SystemBuildMaterializerPort, SystemBuildMaterializedArtifact } from "../../ports/system-build";
import { canonicalizeSystemBuildValue } from "./canonical-system-build-json";

const WRITE_CAPABILITY_PATTERN = /(?:create|update|delete|write|submit|persist|mutation)/i;
const SECRET_KEY_PATTERN = /(?:^|[_-])(secret|token|password|api[_-]?key|credential)(?:$|[_-])/i;

export function createDeterministicSystemBuildMaterializer(): SystemBuildMaterializerPort {
  return {
    async materialize({ revision, lock }) {
      assertConfigurationSafety(revision.instances.map((instance) => instance.selectedConfiguration ?? {}));
      const policyInstances = lock.resolvedImplementations.filter((item) => item.facets.some((facet) => facet.kind === "policy"));
      const mutatingInstances = revision.instances.filter((instance) => WRITE_CAPABILITY_PATTERN.test(String(instance.definitionRef.id)));
      if (mutatingInstances.length > 0 && policyInstances.length === 0) throw new Error("A mutating system requires at least one platform-enforced policy asset.");

      const outputs: SystemBuildMaterializedArtifact[] = [];
      const base = {
        schemaVersion: "1.0",
        systemId: revision.systemId,
        systemRevisionId: revision.revisionId,
        composition: revision.composition,
        instances: [...revision.instances].sort((left, right) => String(left.instanceId).localeCompare(String(right.instanceId))),
        bindings: [...revision.bindings].sort((left, right) => String(left.bindingId).localeCompare(String(right.bindingId))),
      };
      outputs.push(jsonArtifact("manifest", "application/vnd.ai-system-builder.system-manifest+json", { ...base, lock }));

      const byFacet = (kind: string) => lock.resolvedImplementations.filter((item) => item.facets.some((facet) => facet.kind === kind));
      if (byFacet("ui").length) outputs.push(jsonArtifact("ui-bundle", "application/vnd.ai-system-builder.ui-bundle+json", { schemaVersion: "1.0", composition: revision.composition, instances: revision.instances, implementations: byFacet("ui") }));
      const logic = lock.resolvedImplementations.filter((item) => item.facets.some((facet) => ["logic", "data", "declarative"].includes(facet.kind)));
      if (logic.length) outputs.push(jsonArtifact("logic-bundle", "application/vnd.ai-system-builder.logic-bundle+json", { schemaVersion: "1.0", implementations: logic, bindings: revision.bindings }));
      if (byFacet("workflow").length) outputs.push(jsonArtifact("workflow", "application/vnd.ai-system-builder.workflow+json", { schemaVersion: "1.0", language: "finite-typed-acyclic-v1", implementations: byFacet("workflow"), bindings: revision.bindings.filter((binding) => ["control", "dependency", "output", "input"].includes(binding.bindingKind)) }));
      outputs.push(jsonArtifact("policy", "application/vnd.ai-system-builder.policy+json", { schemaVersion: "1.0", denyByDefault: true, platformDenialWins: true, policies: policyInstances, mutatingInstanceIds: mutatingInstances.map((item) => item.instanceId) }));
      outputs.push(jsonArtifact("configuration-schema", "application/schema+json", { $schema: "https://json-schema.org/draft/2020-12/schema", type: "object", additionalProperties: false, properties: Object.fromEntries(revision.instances.map((item) => [String(item.instanceId), { type: "object", default: item.selectedConfiguration ?? {} }])) }));
      outputs.push(jsonArtifact("migration-plan", "application/vnd.ai-system-builder.migration-plan+json", { schemaVersion: "1.0", baseline: "workspace-current", destructiveChanges: [], schemaImplementations: byFacet("data") }));
      outputs.push(jsonArtifact("sbom", "application/spdx+json", createSpdx(lock, revision.createdAt)));
      return outputs;
    },
  };
}

function jsonArtifact(kind: SystemBuildMaterializedArtifact["kind"], mediaType: string, value: unknown): SystemBuildMaterializedArtifact {
  return { kind, mediaType, content: canonicalizeSystemBuildValue(value) };
}

function createSpdx(lock: Parameters<SystemBuildMaterializerPort["materialize"]>[0]["lock"], createdAt: string) {
  return {
    spdxVersion: "SPDX-2.3",
    dataLicense: "CC0-1.0",
    SPDXID: "SPDXRef-DOCUMENT",
    name: `system-${lock.systemId}`,
    documentNamespace: `urn:ai-system-builder:${lock.systemId}:${lock.systemRevisionDigest.slice(7)}`,
    creationInfo: { created: createdAt, creators: [`Tool: ${lock.toolchainProfile}`] },
    packages: lock.resolvedImplementations.map((item, index) => ({
      SPDXID: `SPDXRef-Package-${index + 1}`,
      name: String(item.definitionRef.id),
      versionInfo: item.releaseVersion,
      downloadLocation: "NOASSERTION",
      filesAnalyzed: false,
      licenseConcluded: "NOASSERTION",
      licenseDeclared: "NOASSERTION",
      checksums: [{ algorithm: "SHA256", checksumValue: item.packageDigest.replace(/^sha256:/, "") }],
    })),
  };
}

function assertConfigurationSafety(values: readonly unknown[]): void {
  const visit = (value: unknown, path: readonly string[]) => {
    if (Array.isArray(value)) return value.forEach((item, index) => visit(item, [...path, String(index)]));
    if (!value || typeof value !== "object") return;
    for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
      if (SECRET_KEY_PATTERN.test(key) && typeof child === "string" && child.trim()) throw new Error(`Raw secret-like configuration is not permitted at ${[...path, key].join(".")}. Use a host-owned reference.`);
      visit(child, [...path, key]);
    }
  };
  values.forEach((value, index) => visit(value, ["instances", String(index), "configuration"]));
}
