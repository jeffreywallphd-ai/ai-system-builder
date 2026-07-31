import type { AssetDefinitionRepositoryPort } from "../../ports/asset";
import type {
  AssetImplementationArtifactPort,
  AssetImplementationBackingResourceRepositoryPort,
  AssetImplementationRepositoryPort,
} from "../../ports/asset-implementation";
import type {
  AssetPackageInspectorPort,
  AssetPackageRepositoryPort,
  AssetPackageTrustVerifierPort,
} from "../../ports/asset-package";
import type {
  AdmitAssetPackageCommand,
  AssetPackageRecord,
} from "../../../contracts/asset-package";
import {
  normalizeAssetImplementationBinding,
  normalizeAssetImplementationBindingId,
  normalizeAssetImplementationBackingResourceBundle,
  normalizeAssetImplementationRelease,
  normalizeAssetSourceSnapshotId,
  ASSET_IMPLEMENTATION_BACKING_RESOURCE_MEDIA_TYPE,
  describeAssetImplementationBackingResourceFiles,
  type AssetImplementationBackingResourceFile,
  type AssetImplementationArtifactDescriptor,
  type AssetImplementationTrustLevel,
} from "../../../contracts/asset-implementation";
import type { AssetPackageResult } from "./asset-package-result";
import { packageFailure, packageSuccess } from "./asset-package-result";

export class AdmitAssetPackageUseCase {
  public constructor(
    private readonly dependencies: {
      readonly inspector: AssetPackageInspectorPort;
      readonly packages: AssetPackageRepositoryPort;
      readonly artifacts: AssetImplementationArtifactPort;
      readonly trust: AssetPackageTrustVerifierPort;
      readonly definitions: AssetDefinitionRepositoryPort;
      readonly implementations: AssetImplementationRepositoryPort;
      readonly backingResources: AssetImplementationBackingResourceRepositoryPort;
      readonly now: () => string;
    },
  ) {}

  public async execute(command: AdmitAssetPackageCommand): Promise<AssetPackageResult<AssetPackageRecord>> {
    const inspection = await this.dependencies.packages.readInspection(command.workspaceId, command.inspectionId);
    if (!inspection || inspection.summary.packageDigest !== command.packageDigest) {
      return packageFailure("package-inspection-not-found", "Matching package inspection was not found.");
    }
    const packageArtifact: AssetImplementationArtifactDescriptor = {
      artifactId: inspection.artifact.artifactId as never,
      kind: "package",
      digest: inspection.artifact.digest,
      mediaType: inspection.artifact.mediaType,
      sizeBytes: inspection.artifact.sizeBytes,
    };
    let bytes: Uint8Array;
    try {
      bytes = await this.dependencies.artifacts.readVerified(command.workspaceId, packageArtifact);
    } catch {
      return packageFailure("package-artifact-invalid", "Quarantined package content failed integrity verification.");
    }
    const inspected = await this.dependencies.inspector.inspect({
      inspectionId: command.inspectionId,
      workspaceId: command.workspaceId,
      bytes,
      inspectedAt: inspection.summary.inspectedAt,
    });
    if (!inspected.container || !inspected.summary.eligibleForAdmission || inspected.summary.packageDigest !== command.packageDigest) {
      return packageFailure("package-admission-blocked", "Package does not satisfy admission requirements.");
    }
    const approved = new Set(command.approvedCapabilities);
    if (inspected.summary.requestedCapabilities.some((capability) => !approved.has(capability))) {
      return packageFailure("package-capability-not-approved", "All requested capabilities require explicit approval.");
    }
    const entries = new Map(inspected.entries.map((entry) => [entry.path, entry.bytes]));
    const trust = await this.dependencies.trust.verify({
      container: inspected.container,
      packageDigest: inspected.summary.packageDigest,
      entries,
    });
    if (trust.provenanceStatus !== "verified" || trust.sbomStatus !== "verified" || trust.signatureStatus === "failed") {
      return packageFailure("package-evidence-invalid", "Package provenance, SBOM, or signature evidence did not pass policy.");
    }
    if (command.approvalScope === "organization" && trust.signatureStatus !== "verified") {
      return packageFailure("package-signature-required", "Organization approval requires a verified signature.");
    }

    const manifest = inspected.container.manifest;
    const conflict = await this.findConflict(command, manifest);
    if (conflict) return packageFailure("package-identity-conflict", conflict);
    const dependencyFailure = await this.validateDependencies(command, manifest.dependencies ?? []);
    if (dependencyFailure) return packageFailure("package-dependency-unavailable", dependencyFailure);

    for (const entry of manifest.semanticManifest.assets) {
      await this.dependencies.definitions.saveDefinition(entry.definition);
    }
    const storedEntries = new Map<string, AssetImplementationArtifactDescriptor>();
    for (const entry of inspected.entries) {
      storedEntries.set(
        entry.path,
        await this.dependencies.artifacts.putImmutable({
          workspaceId: command.workspaceId,
          kind: evidenceKind(entry.path, manifest),
          mediaType: entry.mediaType,
          content: entry.bytes,
        }),
      );
    }
    const trustLevel: AssetImplementationTrustLevel =
      command.approvalScope === "organization" ? "organization-approved" : "workspace-approved";
    const now = this.dependencies.now();
    for (const [implementationIndex, declaration] of manifest.implementations.entries()) {
      const release = normalizeAssetImplementationRelease({
        releaseId: declaration.releaseId,
        workspaceId: command.workspaceId,
        definitionRef: declaration.definitionRef,
        version: declaration.version,
        status: "published",
        trustLevel,
        facets: declaration.facets.map((facet) => ({
          facetId: facet.facetId,
          kind: facet.kind,
          runtimeKind: facet.runtimeKind,
          entryKey: facet.entryKey,
          ...(facet.packageEntryPath ? { artifact: storedEntries.get(facet.packageEntryPath) } : {}),
          requiredCapabilities: facet.requiredCapabilities,
          compatibility: facet.compatibility,
        })),
        packageDigest: command.packageDigest,
        evidenceArtifacts: (declaration.evidenceEntryPaths ?? []).map((path) => storedEntries.get(path)).filter((value): value is AssetImplementationArtifactDescriptor => Boolean(value)),
        createdAt: now,
        publishedAt: now,
        publishedBy: command.actorId,
      });
      await this.dependencies.implementations.saveRelease(release);
      const backingBundle = normalizeAssetImplementationBackingResourceBundle({
        formatVersion: "1.0",
        files: [
          {
            path: "other/definition.json",
            role: "other",
            mediaType: "application/json",
            content: JSON.stringify(
              manifest.semanticManifest.assets.find(
                (entry) =>
                  entry.definitionRef.id === declaration.definitionRef.id &&
                  entry.definitionRef.version === declaration.definitionRef.version,
              )?.definition,
              null,
              2,
            ),
          },
          ...declaration.facets.flatMap((facet) => {
            if (!facet.packageEntryPath) return [];
            const inspectedEntry = inspected.entries.find(
              (entry) => entry.path === facet.packageEntryPath,
            );
            if (!inspectedEntry) return [];
            const content = decodeTextBackingResource(inspectedEntry.bytes);
            if (content === undefined) return [];
            return [
              {
                path: inspectedEntry.path,
                role: backingRole(facet.kind, inspectedEntry.path),
                mediaType: inspectedEntry.mediaType,
                content,
              } satisfies AssetImplementationBackingResourceFile,
            ];
          }),
        ],
      });
      const backingArtifact = await this.dependencies.artifacts.putImmutable({
        workspaceId: command.workspaceId,
        kind: "source",
        mediaType: ASSET_IMPLEMENTATION_BACKING_RESOURCE_MEDIA_TYPE,
        content: JSON.stringify(backingBundle),
      });
      const backingIdentity = `${command.packageDigest.slice(-12)}.${implementationIndex + 1}`;
      await this.dependencies.backingResources.save({
        backingResourceId: `implementation-backing.package.${backingIdentity}`,
        origin: "admitted-package",
        releaseId: release.releaseId,
        definitionRef: release.definitionRef,
        scope: "workspace",
        workspaceId: command.workspaceId,
        artifactWorkspaceId: command.workspaceId,
        sourceSnapshotId: normalizeAssetSourceSnapshotId(
          `source-snapshot.package.${backingIdentity}`,
        ),
        artifact: backingArtifact,
        files: describeAssetImplementationBackingResourceFiles(backingBundle),
        createdAt: now,
        createdBy: command.actorId,
      });
      await this.dependencies.implementations.createBinding(
        normalizeAssetImplementationBinding({
          bindingId: normalizeAssetImplementationBindingId(`package.${manifest.packageId}.${manifest.version}.${release.releaseId}`),
          workspaceId: command.workspaceId,
          definitionRef: declaration.definitionRef,
          releaseId: release.releaseId,
          status: "disabled",
          priority: 100,
          revision: 1,
          createdAt: now,
          updatedAt: now,
          approvedBy: command.actorId,
        }),
      );
    }

    const record: AssetPackageRecord = {
      recordId: `package.${manifest.packageId}.${manifest.version}.${command.packageDigest.slice(-12)}`,
      workspaceId: command.workspaceId,
      packageId: manifest.packageId,
      version: manifest.version,
      displayName: manifest.displayName,
      ...(manifest.publisher ? { publisher: manifest.publisher } : {}),
      packageDigest: command.packageDigest,
      artifact: inspection.artifact,
      status: "installed",
      trustLevel,
      definitionCount: manifest.semanticManifest.assets.length,
      implementationCount: manifest.implementations.length,
      requestedCapabilities: manifest.requestedCapabilities,
      admittedBy: command.actorId,
      admittedAt: now,
      revision: 1,
      createdAt: now,
      updatedAt: now,
    };
    try {
      return packageSuccess(await this.dependencies.packages.savePackage(record));
    } catch {
      const existing = (await this.dependencies.packages.listPackages(command.workspaceId)).find(
        (item) => item.packageId === record.packageId && item.version === record.version && item.packageDigest === record.packageDigest,
      );
      return existing ? packageSuccess(existing) : packageFailure("package-install-conflict", "Package install conflicted with an existing record.");
    }
  }

  private async findConflict(command: AdmitAssetPackageCommand, manifest: NonNullable<Awaited<ReturnType<AssetPackageInspectorPort["inspect"]>>["container"]>["manifest"]): Promise<string | undefined> {
    for (const entry of manifest.semanticManifest.assets) {
      const existing = await this.dependencies.definitions.getDefinition(entry.definitionRef);
      if (existing && JSON.stringify(existing) !== JSON.stringify(entry.definition)) {
        return "A definition with the same exact identity already has different content.";
      }
    }
    for (const implementation of manifest.implementations) {
      const existing = await this.dependencies.implementations.readRelease(implementation.releaseId, command.workspaceId);
      if (existing && existing.packageDigest !== command.packageDigest) {
        return "An implementation release with the same identity already has different content.";
      }
    }
    return undefined;
  }

  private async validateDependencies(command: AdmitAssetPackageCommand, dependencies: readonly { packageId: string; versionRange: string; required: boolean }[]): Promise<string | undefined> {
    const installed = await this.dependencies.packages.listPackages(command.workspaceId);
    for (const dependency of dependencies.filter((entry) => entry.required)) {
      if (!installed.some((entry) => entry.packageId === dependency.packageId && ["installed", "active"].includes(entry.status) && versionSatisfies(entry.version, dependency.versionRange))) {
        return `Required package ${dependency.packageId} is not installed at a compatible version.`;
      }
    }
    return undefined;
  }
}

function evidenceKind(path: string, manifest: { sbomEntryPath?: string; provenanceEntryPath?: string }): "bundle" | "sbom" | "provenance" | "evidence" {
  if (path === manifest.sbomEntryPath) return "sbom";
  if (path === manifest.provenanceEntryPath) return "provenance";
  if (/\.(?:js|wasm|css)$/i.test(path)) return "bundle";
  return "evidence";
}

function versionSatisfies(version: string, range: string): boolean {
  if (range === "*" || range === version) return true;
  const major = version.split(".")[0];
  return range === `^${version}` || range.startsWith(`^${major}.`) || range.includes(version);
}

function decodeTextBackingResource(bytes: Uint8Array): string | undefined {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return undefined;
  }
}

function backingRole(
  facetKind: string,
  path: string,
): AssetImplementationBackingResourceFile["role"] {
  if (/\.s?css$/i.test(path)) return "frontend-style";
  if (facetKind === "ui") return "frontend-structure";
  if (["logic", "workflow", "data", "policy", "migration"].includes(facetKind)) {
    return "backend-logic";
  }
  return "other";
}
