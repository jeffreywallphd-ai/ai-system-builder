import type {
  DatasetVersionHasherPort,
  DatasetVersionRepositoryPort,
} from "../../ports/dataset-version";
import type { ArtifactObjectStoragePort } from "../../ports/storage";
import type { ApplicationRequestContext } from "../../ports";
import {
  normalizeDatasetVersionDigest,
  normalizeDatasetVersionRecord,
  type DatasetVersionArtifact,
  type DatasetVersionArtifactRole,
  type DatasetVersionDigest,
  type DatasetVersionDocumentation,
  type DatasetVersionRecord,
  type DatasetVersionSource,
} from "../../../contracts/dataset";
import {
  createDeleteArtifactRequest,
  createHasArtifactRequest,
  createRetrieveArtifactRequest,
  createStoreArtifactRequest,
  type StorageObjectChecksum,
} from "../../../contracts/storage";
import { createWorkspaceId } from "../../../contracts/workspace";
import { createDatasetVersionDocumentationArtifacts } from "./dataset-version-documentation.service";

export interface DatasetVersionFinalizationArtifact {
  readonly role: Exclude<DatasetVersionArtifactRole, "recipe" | "dataset-card" | "croissant">;
  readonly artifactKey: string;
  readonly mediaType: string;
  readonly sizeBytes?: number;
  readonly checksum?: StorageObjectChecksum;
  readonly rowCount?: number;
}

export interface DatasetVersionFinalizationInput {
  readonly workspaceId: string;
  readonly organizationId?: DatasetVersionRecord["organizationId"];
  readonly createdBy: string;
  readonly datasetName: string;
  readonly recipeSnapshot: unknown;
  readonly recipeImplementation: { readonly id: string; readonly version: string };
  readonly sources: readonly DatasetVersionSource[];
  readonly artifacts: readonly DatasetVersionFinalizationArtifact[];
  readonly split?: { readonly strategy: string; readonly seed: number; readonly groupField?: string };
  readonly quality: {
    readonly policyId: string;
    readonly policyVersion: string;
    readonly policyFingerprint: DatasetVersionDigest;
    readonly reportFingerprint: DatasetVersionDigest;
  };
  readonly documentation: DatasetVersionDocumentation;
  readonly totalRows: number;
  readonly createdAt: string;
  readonly parentVersionId?: DatasetVersionRecord["versionId"];
}

export interface DatasetVersionFinalizationResult {
  readonly version: DatasetVersionRecord;
  readonly created: boolean;
}

export class DatasetVersionFinalizationService {
  public constructor(
    private readonly dependencies: {
      readonly repository: DatasetVersionRepositoryPort;
      readonly artifacts: ArtifactObjectStoragePort;
      readonly hasher: DatasetVersionHasherPort;
    },
  ) {}

  public async finalize(input: DatasetVersionFinalizationInput, context?: ApplicationRequestContext): Promise<DatasetVersionFinalizationResult> {
    const workspaceId = createWorkspaceId(input.workspaceId);
    if (context?.workspaceId !== workspaceId) throw new Error("Dataset version finalization requires the exact workspace scope.");
    if (context.organizationId !== input.organizationId) throw new Error("Dataset version finalization requires the exact organization scope.");

    const recipeJson = canonicalJson(input.recipeSnapshot);
    const recipeBytes = new TextEncoder().encode(recipeJson);
    const recipeDigest = this.dependencies.hasher.digest(recipeBytes);
    const recipeArtifactKey = `dataset-versions/recipes/${recipeDigest.slice("sha256:".length)}.json`;
    let createdRecipe = false;
    const createdArtifactKeys: string[] = [];
    try {
      createdRecipe = await this.storeRecipeArtifact(recipeArtifactKey, recipeBytes, recipeDigest, input, context);
      if (createdRecipe) createdArtifactKeys.push(recipeArtifactKey);
      const artifacts = await Promise.all(input.artifacts.map((artifact) => this.resolveArtifact(artifact, context)));
      artifacts.push({ role: "recipe", artifactKey: recipeArtifactKey, digest: recipeDigest, mediaType: "application/json", sizeBytes: recipeBytes.byteLength });
      const documentation = createDatasetVersionDocumentationArtifacts({
        documentation: input.documentation,
        artifacts,
        totalRows: input.totalRows,
      });
      for (const generated of [
        { role: "dataset-card" as const, name: "README.md", mediaType: "text/markdown", content: documentation.card },
        { role: "croissant" as const, name: "croissant.json", mediaType: "application/ld+json", content: documentation.croissant },
      ]) {
        const content = new TextEncoder().encode(generated.content);
        const digest = this.dependencies.hasher.digest(content);
        const key = `dataset-versions/documentation/${digest.slice("sha256:".length)}/${generated.name}`;
        if (await this.storeDocumentationArtifact(key, content, digest, generated.mediaType, input, context)) {
          createdArtifactKeys.push(key);
        }
        artifacts.push({ role: generated.role, artifactKey: key, digest, mediaType: generated.mediaType, sizeBytes: content.byteLength });
      }
      artifacts.sort((left, right) => `${left.role}:${left.artifactKey}`.localeCompare(`${right.role}:${right.artifactKey}`));

      const datasetId = slugIdentifier(input.datasetName);
      const lineage = {
        sources: [...input.sources],
        recipe: { artifactKey: recipeArtifactKey, digest: recipeDigest, implementationId: input.recipeImplementation.id, implementationVersion: input.recipeImplementation.version },
        ...(input.split ? { split: input.split } : {}),
        quality: input.quality,
        ...(input.parentVersionId ? { parentVersionId: input.parentVersionId } : {}),
      };
      const digestInput = { schemaVersion: "1.0", datasetId, ...(input.organizationId ? { organizationId: input.organizationId } : {}), workspaceId, artifacts, lineage, documentation: input.documentation, totalRows: input.totalRows };
      const versionDigest = this.dependencies.hasher.digest(canonicalJson(digestInput));
      const versionId = `${datasetId}:${versionDigest.slice("sha256:".length, "sha256:".length + 20)}` as DatasetVersionRecord["versionId"];
      const existing = await this.dependencies.repository.readVersion(workspaceId, versionId);
      if (existing) {
        if (existing.versionDigest !== versionDigest) throw new Error("Dataset version identity conflicts with different content.");
        return { version: existing, created: false };
      }
      const version = normalizeDatasetVersionRecord({
        schemaVersion: "1.0", versionId, datasetId: datasetId as DatasetVersionRecord["datasetId"],
        ...(input.organizationId ? { organizationId: input.organizationId } : {}), workspaceId, versionDigest, artifacts, lineage,
        documentation: input.documentation, totalRows: input.totalRows, createdAt: input.createdAt, createdBy: input.createdBy,
      });
      return { version: await this.dependencies.repository.createVersion(version), created: true };
    } catch (error) {
      for (const key of createdArtifactKeys.reverse()) {
        try { await this.dependencies.artifacts.deleteArtifact(createDeleteArtifactRequest(key), context); } catch { /* Best-effort content-addressed orphan cleanup. */ }
      }
      throw error;
    }
  }

  private async storeRecipeArtifact(key: string, content: Uint8Array, digest: DatasetVersionDigest, input: DatasetVersionFinalizationInput, context?: ApplicationRequestContext): Promise<boolean> {
    const present = await this.dependencies.artifacts.hasArtifact(createHasArtifactRequest(key), context);
    if (!present.ok) throw new Error("Dataset recipe availability could not be verified.");
    if (present.value.exists) { await this.verifyStoredArtifact(key, digest, context); return false; }
    const stored = await this.dependencies.artifacts.storeArtifact(createStoreArtifactRequest(content, {
      descriptor: { key, mediaType: "application/json", sizeBytes: content.byteLength, checksum: { algorithm: "sha256", value: digest.slice("sha256:".length) }, metadata: { workspaceId: input.workspaceId, artifactRole: "dataset-version-recipe" } }, overwrite: false,
    }), context);
    if (!stored.ok) { await this.verifyStoredArtifact(key, digest, context); return false; }
    return true;
  }

  private async resolveArtifact(artifact: DatasetVersionFinalizationArtifact, context?: ApplicationRequestContext): Promise<DatasetVersionArtifact> {
    const expected = digestFromChecksum(artifact.checksum);
    const digest = expected ?? (await this.digestStoredArtifact(artifact.artifactKey, context));
    if (expected) await this.verifyStoredArtifact(artifact.artifactKey, expected, context);
    return { role: artifact.role, artifactKey: artifact.artifactKey, digest, mediaType: artifact.mediaType, sizeBytes: artifact.sizeBytes ?? 0, ...(artifact.rowCount === undefined ? {} : { rowCount: artifact.rowCount }) };
  }

  private async storeDocumentationArtifact(
    key: string,
    content: Uint8Array,
    digest: DatasetVersionDigest,
    mediaType: string,
    input: DatasetVersionFinalizationInput,
    context?: ApplicationRequestContext,
  ): Promise<boolean> {
    const present = await this.dependencies.artifacts.hasArtifact(createHasArtifactRequest(key), context);
    if (!present.ok) throw new Error("Dataset documentation availability could not be verified.");
    if (present.value.exists) { await this.verifyStoredArtifact(key, digest, context); return false; }
    const stored = await this.dependencies.artifacts.storeArtifact(createStoreArtifactRequest(content, {
      descriptor: { key, mediaType, sizeBytes: content.byteLength, checksum: { algorithm: "sha256", value: digest.slice("sha256:".length) }, metadata: { workspaceId: input.workspaceId, artifactRole: "dataset-version-documentation" } },
      overwrite: false,
    }), context);
    if (!stored.ok) { await this.verifyStoredArtifact(key, digest, context); return false; }
    return true;
  }

  private async verifyStoredArtifact(key: string, expected: DatasetVersionDigest, context?: ApplicationRequestContext): Promise<void> {
    if ((await this.digestStoredArtifact(key, context)) !== expected) throw new Error("Dataset version artifact digest verification failed.");
  }

  private async digestStoredArtifact(key: string, context?: ApplicationRequestContext): Promise<DatasetVersionDigest> {
    const retrieved = await this.dependencies.artifacts.retrieveArtifact<Uint8Array>(createRetrieveArtifactRequest(key), context);
    if (!retrieved.ok) throw new Error("Dataset version artifact could not be read for verification.");
    return this.dependencies.hasher.digest(retrieved.value.content);
  }
}

function digestFromChecksum(checksum: StorageObjectChecksum | undefined): DatasetVersionDigest | undefined {
  if (!checksum || checksum.algorithm.trim().toLowerCase() !== "sha256") return undefined;
  return normalizeDatasetVersionDigest(`sha256:${checksum.value}`);
}

function canonicalJson(value: unknown): string {
  const normalized = stableJson(value, new Set<object>(), 0);
  if (normalized.length > 512 * 1024) throw new Error("Dataset version recipe or manifest is too large.");
  return normalized;
}

function stableJson(value: unknown, seen: Set<object>, depth: number): string {
  if (depth > 32) throw new Error("Dataset version metadata is too deeply nested.");
  if (value === null || typeof value === "boolean" || typeof value === "string") return JSON.stringify(value);
  if (typeof value === "number") { if (!Number.isFinite(value)) throw new Error("Dataset version metadata contains an invalid number."); return JSON.stringify(value); }
  if (typeof value === "undefined") return "null";
  if (typeof value !== "object") throw new Error("Dataset version metadata must be JSON compatible.");
  if (seen.has(value)) throw new Error("Dataset version metadata must not be circular.");
  seen.add(value);
  try {
    if (Array.isArray(value)) return `[${value.map((item) => stableJson(item, seen, depth + 1)).join(",")}]`;
    const entries = Object.entries(value as Record<string, unknown>).filter(([, item]) => item !== undefined).sort(([left], [right]) => left.localeCompare(right));
    return `{${entries.map(([key, item]) => `${JSON.stringify(key)}:${stableJson(item, seen, depth + 1)}`).join(",")}}`;
  } finally { seen.delete(value); }
}

function slugIdentifier(value: string): string {
  const normalized = value.trim().toLowerCase().replace(/[^a-z0-9._-]+/g, "-").replace(/-+/g, "-").replace(/^[._-]+|[._-]+$/g, "").slice(0, 96);
  return normalized || "dataset";
}
