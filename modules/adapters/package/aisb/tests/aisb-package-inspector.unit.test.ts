import { describe, expect, it } from "../../../../testing/node-test";
import {
  createPackageEntry as entry,
  createPackageFixture,
  encodePackage as encode,
} from "../../../../testing/fixtures/asset-package-fixture";
import { createWorkspaceId } from "../../../../contracts/workspace";
import {
  ASSET_PACKAGE_STARTER_README,
  createAssetPackageStarter,
  createAssetPackageStarterBytes,
  serializeAssetPackageStarter,
} from "../../../../contracts/asset-package";
import { createAisbPackageInspector } from "../createAisbPackageInspector";

describe(".aisb-package bounded inspector", () => {
  it("rejects stale semantic entry and manifest identities without rewriting claims", async () => {
    const inspector = createAisbPackageInspector();
    const { container } = await createPackageFixture(inspector);
    const semantic = container.manifest.semanticManifest;
    const first = semantic.assets[0]!;
    for (const changed of [
      { ...semantic, assets: [{ ...first, definition: { ...first.definition, displayName: "Changed semantic panel" } }] },
      { ...semantic, displayName: "Changed semantic manifest" },
      { ...semantic, assets: [{ ...first, fingerprint: `fnv1a:${"0".repeat(8)}` }] },
      { ...semantic, checksum: `sha256:${"0".repeat(64)}` },
    ]) {
      const result = await inspector.inspect({
        inspectionId: "inspection-stale-semantic",
        workspaceId: createWorkspaceId("workspace-a"),
        bytes: encode({ ...container, manifest: { ...container.manifest, semanticManifest: changed } }),
        inspectedAt: "2026-07-17T12:00:00.000Z",
      });
      expect(result.summary.eligibleForAdmission).toBe(false);
      expect(result.summary.issues.some((value) => value.code.startsWith("package.semantic.identity."))).toBe(true);
      expect(JSON.parse(JSON.stringify(result.container?.manifest.semanticManifest))).toEqual(JSON.parse(JSON.stringify(changed)));
    }
  });

  it("returns static ineligible results for malformed declaration rows and deep raw content", async () => {
    const inspector = createAisbPackageInspector();
    const { container } = await createPackageFixture(inspector);
    const implementation = container.manifest.implementations[0]!;
    const malformed = [
      { ...container, entries: [null] },
      { ...container, manifest: { ...container.manifest, dependencies: [null] } },
      { ...container, manifest: { ...container.manifest, implementations: [null] } },
      { ...container, manifest: { ...container.manifest, implementations: [{ ...implementation, definitionRef: null }] } },
      { ...container, manifest: { ...container.manifest, implementations: [{ ...implementation, facets: [null] }] } },
    ];
    const deep = `{"nested":`.repeat(12000) + "null" + "}".repeat(12000);
    const raw = new TextDecoder().decode(encode({ ...container, manifest: { ...container.manifest, extra: "__deep_fixture__" } }));
    const inputs = [...malformed.map(encode), Buffer.from(raw.replace('"__deep_fixture__"', deep))];
    for (const bytes of inputs) {
      const result = await inspector.inspect({
        inspectionId: "inspection-malformed",
        workspaceId: createWorkspaceId("workspace-a"), bytes,
        inspectedAt: "2026-07-17T12:00:00.000Z",
      });
      expect(result.summary.eligibleForAdmission).toBe(false);
      expect(result.container).toBe(undefined);
      expect(JSON.stringify(result.summary)).not.toContain("TypeError");
      expect(JSON.stringify(result.summary)).not.toContain("RangeError");
      expect(JSON.stringify(result.summary)).not.toContain("contentBase64");
    }
  });

  it("accepts the deterministic non-executing starter package", async () => {
    const inspector = createAisbPackageInspector();
    const firstText = serializeAssetPackageStarter();
    const secondText = serializeAssetPackageStarter();
    const first = createAssetPackageStarterBytes();
    const second = createAssetPackageStarterBytes();

    expect(Array.from(second)).toEqual(Array.from(first));
    expect(secondText).toBe(firstText);
    expect(JSON.parse(new TextDecoder().decode(first))).toEqual(
      createAssetPackageStarter(),
    );
    expect(ASSET_PACKAGE_STARTER_README).toContain("add semantic definitions");

    const inspected = await inspector.inspect({
      inspectionId: "inspection-starter",
      workspaceId: createWorkspaceId("workspace-a"),
      bytes: first,
      inspectedAt: "2026-07-18T12:00:00.000Z",
    });

    expect(inspected.summary.eligibleForAdmission).toBe(true);
    expect(inspected.summary.definitionCount).toBe(0);
    expect(inspected.summary.implementationCount).toBe(0);
    expect(inspected.summary.entryCount).toBe(1);
    expect(inspected.summary.requestedCapabilities).toEqual([]);
    expect(inspected.entries.length).toBe(1);
    expect(inspected.entries[0]?.path).toBe("README.txt");
    expect(inspected.entries[0]?.mediaType).toBe("text/plain");
  });

  it("inspects a valid package without executing any entry", async () => {
    const inspector = createAisbPackageInspector();
    const packageFixture = await createPackageFixture(inspector);
    const inspected = await inspector.inspect({
      inspectionId: "inspection-1",
      workspaceId: createWorkspaceId("workspace-a"),
      bytes: packageFixture.bytes,
      inspectedAt: "2026-07-17T12:00:00.000Z",
    });
    expect(inspected.summary.eligibleForAdmission).toBe(true);
    expect(inspected.summary.provenanceStatus).toBe("unverified");
    expect(inspected.summary.sbomStatus).toBe("unverified");
    expect(inspected.summary.implementationCount).toBe(1);
    expect(JSON.stringify(inspected.summary)).not.toContain("contentBase64");
    expect(JSON.stringify(inspected.summary)).not.toContain("console.log");
    const withoutEvidenceEntry = await inspector.inspect({
      inspectionId: "inspection-digest-binding", workspaceId: createWorkspaceId("workspace-a"),
      bytes: encode({ ...packageFixture.container, entries: packageFixture.container.entries.filter((value) => value.path !== packageFixture.container.manifest.provenanceEntryPath) }),
      inspectedAt: "2026-07-17T12:00:00.000Z",
    });
    expect(withoutEvidenceEntry.summary.packageDigest).toBe(inspected.summary.packageDigest);
    const { checksum: _checksum, ...semanticManifest } = packageFixture.container.manifest.semanticManifest;
    const absentChecksum = await inspector.inspect({
      inspectionId: "inspection-no-checksum", workspaceId: createWorkspaceId("workspace-a"),
      bytes: encode({ ...packageFixture.container, manifest: { ...packageFixture.container.manifest, semanticManifest } }),
      inspectedAt: "2026-07-17T12:00:00.000Z",
    });
    expect(absentChecksum.summary.eligibleForAdmission).toBe(true);
  });

  it("rejects deep or malformed semantics before canonicalizing even legacy claims", async () => {
    const inspector = createAisbPackageInspector();
    const { container } = await createPackageFixture(inspector);
    let metadata: unknown = { note: "deep" };
    for (let index = 0; index < 40; index++) metadata = { nested: metadata };
    for (const changed of [
      { ...container.manifest.semanticManifest, metadata, checksum: `fnv1a:${"0".repeat(8)}` },
      { ...container.manifest.semanticManifest, assets: [null] },
      { ...container.manifest.semanticManifest, assets: {} },
    ]) {
      const result = await inspector.inspect({
        inspectionId: "inspection-unsafe-semantic", workspaceId: createWorkspaceId("workspace-a"),
        bytes: encode({ ...container, manifest: { ...container.manifest, semanticManifest: changed } }),
        inspectedAt: "2026-07-17T12:00:00.000Z",
      });
      expect(result.container).toBe(undefined);
      expect(result.summary.eligibleForAdmission).toBe(false);
      expect(result.summary.issues[0]?.code).toBe("package.semantic.invalid");
      expect(JSON.stringify(result.summary)).not.toContain("fnv1a:");
    }
  });

  it("fails closed for traversal, device paths, duplicates, oversize content, and digest tampering", async () => {
    const inspector = createAisbPackageInspector({
      maxEntryBytes: 32,
      maxExpandedBytes: 64,
    });
    const fixture = await createPackageFixture(inspector);
    const base = fixture.container;
    const maliciousEntries = [
      entry("../escape.js", "application/javascript", "x"),
      entry("CON.txt", "text/plain", "x"),
      entry("safe/duplicate.js", "application/javascript", "x"),
      entry("SAFE/DUPLICATE.js", "application/javascript", "x"),
      {
        ...entry("safe/tampered.js", "application/javascript", "x"),
        digest: `sha256:${"0".repeat(64)}` as const,
      },
      entry("safe/large.txt", "text/plain", "x".repeat(80)),
    ];
    const result = await inspector.inspect({
      inspectionId: "inspection-malicious",
      workspaceId: createWorkspaceId("workspace-a"),
      bytes: encode({ ...base, entries: maliciousEntries }),
      inspectedAt: "2026-07-17T12:00:00.000Z",
    });
    expect(result.summary.eligibleForAdmission).toBe(false);
    const codes = result.summary.issues.map((value) => value.code);
    expect(codes).toContain("package.entry.path-unsafe");
    expect(codes).toContain("package.entry.path-duplicate");
    expect(codes).toContain("package.entry.size-exceeded");
    expect(codes).toContain("package.entry.digest-mismatch");
  });

  it("bounds untrusted declaration arrays before admission", async () => {
    const inspector = createAisbPackageInspector();
    const fixture = await createPackageFixture(inspector);
    const result = await inspector.inspect({
      inspectionId: "inspection-declarations",
      workspaceId: createWorkspaceId("workspace-a"),
      bytes: encode({
        ...fixture.container,
        manifest: {
          ...fixture.container.manifest,
          requestedCapabilities: Array.from(
            { length: 65 },
            (_value, index) => `capability.${index}`,
          ),
          dependencies: Array.from({ length: 257 }, (_value, index) => ({
            packageId: `dependency.${index}`,
            versionRange: "*",
            required: true,
          })),
          implementations: [
            {
              ...fixture.container.manifest.implementations[0],
              facets: Array.from(
                { length: 17 },
                () => fixture.container.manifest.implementations[0].facets[0],
              ),
            },
          ],
        },
      }),
      inspectedAt: "2026-07-17T12:00:00.000Z",
    });

    expect(result.summary.eligibleForAdmission).toBe(false);
    const codes = result.summary.issues.map((value) => value.code);
    expect(codes).toContain("package.capability.invalid");
    expect(codes).toContain("package.dependency-count.exceeded");
    expect(codes).toContain("package.implementation.facet-count-exceeded");
  });
});
