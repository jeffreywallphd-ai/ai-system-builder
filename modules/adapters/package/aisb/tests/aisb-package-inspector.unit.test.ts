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
