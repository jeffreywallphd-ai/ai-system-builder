import { describe, expect, it } from "../../../../testing/node-test";
import { createDeterministicSystemBuildMaterializer } from "../deterministic-system-build-materializer.service";

function fixture(configuration: Record<string, unknown> = {}, definitionId = "asset.read-record") {
  const revision = {
    systemId: "system-1",
    revisionId: "revision-1",
    createdAt: "2026-07-17T00:00:00.000Z",
    composition: { compositionId: "composition-1", displayName: "Example", lifecycleStatus: "draft", instanceRefs: [{ kind: "asset-instance", id: "instance-1" }], rootInstanceRefs: [{ kind: "asset-instance", id: "instance-1" }] },
    instances: [{ instanceId: "instance-1", definitionRef: { kind: "asset-definition-version", id: definitionId, version: "1.0.0" }, selectedConfiguration: configuration }],
    bindings: [],
  } as any;
  const lock = {
    schemaVersion: "1.0",
    systemId: "system-1",
    systemRevisionId: "revision-1",
    systemRevisionDigest: `sha256:${"a".repeat(64)}`,
    deploymentProfile: "local-desktop",
    hostApiVersion: "1.0.0",
    toolchainProfile: "builder/1.0.0",
    policyCompilerVersion: "policy/1.0.0",
    workflowCompilerVersion: "workflow/1.0.0",
    schemaCompilerVersion: "schema/1.0.0",
    resolvedImplementations: [{ instanceId: "instance-1", definitionRef: { kind: "asset-definition-version", id: definitionId, version: "1.0.0" }, releaseId: "release-1", releaseVersion: "1.0.0", packageDigest: `sha256:${"b".repeat(64)}`, facets: [{ facetId: "facet-1", kind: "declarative", runtimeKind: "declarative", entryKey: "main", requiredCapabilities: [], compatibility: { definitionVersion: "1.0.0", hostApiRange: "*", deploymentProfiles: ["local-desktop"] } }] }],
  } as any;
  return { revision, lock };
}

describe("deterministic system build materializer", () => {
  it("emits byte-for-byte repeatable artifacts including policy, schema, migration, and SPDX SBOM", async () => {
    const materializer = createDeterministicSystemBuildMaterializer();
    const input = fixture();
    const first = await materializer.materialize(input);
    const second = await materializer.materialize(input);
    expect(first).toEqual(second);
    const kinds = first.map((artifact) => artifact.kind);
    expect(["manifest", "logic-bundle", "policy", "configuration-schema", "migration-plan", "sbom"].every((kind) => kinds.includes(kind as any))).toBe(true);
    expect(String(first.find((artifact) => artifact.kind === "sbom")?.content)).toContain('"spdxVersion":"SPDX-2.3"');
  });

  it("rejects raw secrets and mutating assets without a platform policy", async () => {
    const materializer = createDeterministicSystemBuildMaterializer();
    await expect(materializer.materialize(fixture({ api_key: "secret-value" }))).rejects.toThrow(/Raw secret-like configuration/);
    await expect(materializer.materialize(fixture({}, "asset.update-record"))).rejects.toThrow(/requires at least one platform-enforced policy asset/);
  });
});
