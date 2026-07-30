import { normalizeAssetPackId, normalizeAssetPackVersion } from "../asset";

import {
  ASSET_PACKAGE_FORMAT_VERSION,
  ASSET_PACKAGE_MEDIA_TYPE,
  type AssetPackageContainerV1,
} from "./asset-package-contracts";

export const ASSET_PACKAGE_STARTER_FILENAME =
  "ai-system-builder-asset-starter.aisb-package";

const STARTER_README =
  "AI System Builder asset package starter. Replace example identities and add semantic definitions and implementation entries before import.\n";

const STARTER_README_BASE64 =
  "QUkgU3lzdGVtIEJ1aWxkZXIgYXNzZXQgcGFja2FnZSBzdGFydGVyLiBSZXBsYWNlIGV4YW1wbGUgaWRlbnRpdGllcyBhbmQgYWRkIHNlbWFudGljIGRlZmluaXRpb25zIGFuZCBpbXBsZW1lbnRhdGlvbiBlbnRyaWVzIGJlZm9yZSBpbXBvcnQuCg==";

const STARTER_README_DIGEST =
  "sha256:99b983a7046c27755865a08ac82a5162755fe8484e16479dcf21d13053fe6913" as const;

/**
 * Returns a fresh, inspector-valid package starter without executable entries.
 * Consumers must replace example identities and add definitions before sharing.
 */
export function createAssetPackageStarter(): AssetPackageContainerV1 {
  const packageId = normalizeAssetPackId("org.example.asset-starter");
  const version = normalizeAssetPackVersion("0.1.0");

  return {
    mediaType: ASSET_PACKAGE_MEDIA_TYPE,
    manifest: {
      formatVersion: ASSET_PACKAGE_FORMAT_VERSION,
      packageId,
      version,
      displayName: "Example Asset Starter",
      publisher: "Example Publisher",
      semanticManifest: {
        schemaVersion: "asset-pack-manifest.v1",
        packId: packageId,
        version,
        displayName: "Example Asset Starter",
        description:
          "Replace the example metadata and add asset definitions before sharing.",
        publisher: "Example Publisher",
        sourceKind: "imported",
        sourceLayer: "imported-pack",
        trustStatus: "unverified",
        assets: [],
      },
      implementations: [],
      requestedCapabilities: [],
      supportedDeploymentProfiles: [],
      dependencies: [],
    },
    entries: [
      {
        path: "README.txt",
        mediaType: "text/plain",
        digest: STARTER_README_DIGEST,
        sizeBytes: 139,
        contentBase64: STARTER_README_BASE64,
      },
    ],
  };
}

export function serializeAssetPackageStarter(): string {
  return `${JSON.stringify(createAssetPackageStarter(), null, 2)}\n`;
}

export function createAssetPackageStarterBytes(): Uint8Array {
  return new TextEncoder().encode(serializeAssetPackageStarter());
}

// Keep the readable source text close to its descriptor for maintainers.
export const ASSET_PACKAGE_STARTER_README = STARTER_README;
