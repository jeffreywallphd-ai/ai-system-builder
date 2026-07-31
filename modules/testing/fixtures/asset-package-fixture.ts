import { createHash } from "node:crypto";

import { createImportedPackManifestFixture } from "../../application/services/asset-packs/tests/fixtures/asset-pack-manifest.fixtures";
import type { AssetPackageInspectorPort } from "../../application/ports/asset-package";
import {
  ASSET_PACKAGE_MEDIA_TYPE,
  type AssetPackageContainerV1,
  type AssetPackageEntryDeclaration,
} from "../../contracts/asset-package";
import { createWorkspaceId } from "../../contracts/workspace";
import { createAisbPackageInspector } from "../../adapters/package/aisb";

export async function createPackageFixture(
  inspector: AssetPackageInspectorPort = createAisbPackageInspector(),
) {
  const semanticManifest = createImportedPackManifestFixture();
  const definitionRef = semanticManifest.assets[0]!.definitionRef;
  const bundle = createPackageEntry("implementations/panel.js", "application/javascript", "export const render = () => 'panel';");
  const sbom = createPackageEntry("evidence/sbom.json", "application/spdx+json", JSON.stringify({ SPDXID: "SPDXRef-DOCUMENT", packages: [] }));
  const manifest = {
    formatVersion: "1.0" as const,
    packageId: String(semanticManifest.packId),
    version: String(semanticManifest.version),
    displayName: semanticManifest.displayName,
    publisher: semanticManifest.publisher,
    semanticManifest,
    implementations: [{
      releaseId: "release.imported.panel.1" as never,
      definitionRef,
      version: definitionRef.version!,
      facets: [{
        facetId: "facet.imported.panel.ui" as never,
        kind: "ui" as const,
        runtimeKind: "sandboxed-browser" as const,
        entryKey: "panel.render",
        packageEntryPath: bundle.path,
        requiredCapabilities: [],
        compatibility: {
          definitionVersion: definitionRef.version!,
          hostApiRange: ">=1.0.0 <2.0.0",
          deploymentProfiles: ["local-desktop" as const, "campus-server" as const, "thin-client" as const],
        },
      }],
      evidenceEntryPaths: [sbom.path, "evidence/provenance.json"],
    }],
    requestedCapabilities: [],
    supportedDeploymentProfiles: ["local-desktop" as const, "campus-server" as const, "thin-client" as const],
    sbomEntryPath: sbom.path,
    provenanceEntryPath: "evidence/provenance.json",
  };
  let container: AssetPackageContainerV1 = { mediaType: ASSET_PACKAGE_MEDIA_TYPE, manifest, entries: [bundle, sbom] };
  const first = await inspector.inspect({ inspectionId: "digest-probe", workspaceId: createWorkspaceId("workspace-a"), bytes: encodePackage(container), inspectedAt: "2026-07-17T12:00:00.000Z" });
  const provenance = createPackageEntry(
    "evidence/provenance.json",
    "application/vnd.in-toto+json",
    JSON.stringify({ subject: [{ name: manifest.packageId, digest: { sha256: first.summary.packageDigest.slice(7) } }] }),
  );
  container = { ...container, entries: [bundle, sbom, provenance] };
  return { container, bytes: encodePackage(container) };
}

export function createPackageEntry(
  path: string,
  mediaType: string,
  content: string,
): AssetPackageEntryDeclaration {
  const bytes = Buffer.from(content);
  return {
    path,
    mediaType,
    digest: `sha256:${createHash("sha256").update(bytes).digest("hex")}`,
    sizeBytes: bytes.byteLength,
    contentBase64: bytes.toString("base64"),
  };
}

export const encodePackage = (value: unknown) => Buffer.from(JSON.stringify(value));
