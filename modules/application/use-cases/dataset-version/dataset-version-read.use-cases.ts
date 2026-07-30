import type { DatasetVersionRepositoryPort } from "../../ports/dataset-version";
import type { DatasetVersionHasherPort } from "../../ports/dataset-version";
import type { ArtifactObjectStoragePort } from "../../ports/storage";
import type { ApplicationRequestContext } from "../../ports";
import type { WorkspaceOperationAuthorizationPort } from "../../ports/security";
import type { WorkspaceRepository } from "../../ports/workspace";
import type { DatasetVersionComparison, DatasetVersionId, DatasetVersionRecord, DatasetVersionReproduction } from "../../../contracts/dataset";
import type { WorkspaceId } from "../../../contracts/workspace";
import { createRetrieveArtifactRequest } from "../../../contracts/storage";
import { resolveArtifactWorkspaceContext } from "../artifact-workspace-context";

const MAX_RECIPE_BYTES = 512 * 1024;

export class ListDatasetVersionsUseCase {
  private readonly dependencies: DatasetVersionReadDependencies;
  public constructor(input: DatasetVersionRepositoryPort | DatasetVersionReadDependencies) { this.dependencies = readDependencies(input); }
  public async execute(input: { readonly workspaceId: WorkspaceId; readonly datasetId?: string }, context: ApplicationRequestContext = {}): Promise<readonly DatasetVersionRecord[]> {
    if (!(await canReadWorkspace(this.dependencies, input.workspaceId, context))) return [];
    return this.dependencies.repository.listVersions(input.workspaceId, input.datasetId);
  }
}

export class CompareDatasetVersionsUseCase {
  private readonly dependencies: DatasetVersionReadDependencies;
  public constructor(input: DatasetVersionRepositoryPort | DatasetVersionReadDependencies) { this.dependencies = readDependencies(input); }
  public async execute(input: { readonly workspaceId: WorkspaceId; readonly fromVersionId: DatasetVersionId; readonly toVersionId: DatasetVersionId }, context: ApplicationRequestContext = {}): Promise<DatasetVersionComparison | undefined> {
    if (!(await canReadWorkspace(this.dependencies, input.workspaceId, context))) return undefined;
    const [from, to] = await Promise.all([this.dependencies.repository.readVersion(input.workspaceId, input.fromVersionId), this.dependencies.repository.readVersion(input.workspaceId, input.toVersionId)]);
    if (!from || !to || from.datasetId !== to.datasetId) return undefined;
    const fromSources = new Map(from.lineage.sources.map((source) => [source.artifactKey, source.digest]));
    const toSources = new Map(to.lineage.sources.map((source) => [source.artifactKey, source.digest]));
    const roles = new Set([...from.artifacts.map((artifact) => artifact.role), ...to.artifacts.map((artifact) => artifact.role)]);
    return {
      fromVersionId: from.versionId, toVersionId: to.versionId, identical: from.versionDigest === to.versionDigest, rowDelta: to.totalRows - from.totalRows,
      sources: { added: [...toSources.keys()].filter((key) => !fromSources.has(key)).length, removed: [...fromSources.keys()].filter((key) => !toSources.has(key)).length, changed: [...toSources].filter(([key, digest]) => fromSources.has(key) && fromSources.get(key) !== digest).length },
      changedArtifactRoles: [...roles].filter((role) => artifactDigestForRole(from, role) !== artifactDigestForRole(to, role)).sort(),
      recipeChanged: from.lineage.recipe.digest !== to.lineage.recipe.digest,
      qualityPolicyChanged: from.lineage.quality.policyFingerprint !== to.lineage.quality.policyFingerprint,
      documentationChanged: JSON.stringify(from.documentation) !== JSON.stringify(to.documentation),
    };
  }
}

export class ReadDatasetVersionReproductionUseCase {
  public constructor(private readonly dependencies: {
    readonly repository: DatasetVersionRepositoryPort;
    readonly artifacts: ArtifactObjectStoragePort;
    readonly hasher: DatasetVersionHasherPort;
    readonly workspaceRepository?: Pick<WorkspaceRepository, "readWorkspace">;
    readonly workspaceAuthorization?: WorkspaceOperationAuthorizationPort;
  }) {}
  public async execute(input: { readonly workspaceId: WorkspaceId; readonly versionId: DatasetVersionId }, context: ApplicationRequestContext = {}): Promise<DatasetVersionReproduction | undefined> {
    if (!(await canReadWorkspace(this.dependencies, input.workspaceId, context))) return undefined;
    const version = await this.dependencies.repository.readVersion(input.workspaceId, input.versionId);
    if (!version) return undefined;
    const retrieved = await this.dependencies.artifacts.retrieveArtifact<Uint8Array>(createRetrieveArtifactRequest(version.lineage.recipe.artifactKey), context);
    if (!retrieved.ok) throw new Error("The saved preparation settings are unavailable.");
    const bytes = retrieved.value.content;
    if (!(bytes instanceof Uint8Array) || bytes.byteLength === 0 || bytes.byteLength > MAX_RECIPE_BYTES) throw new Error("The saved preparation settings are invalid.");
    if (this.dependencies.hasher.digest(bytes) !== version.lineage.recipe.digest) throw new Error("The saved preparation settings failed integrity verification.");
    let recipeSnapshot: unknown;
    try { recipeSnapshot = JSON.parse(new TextDecoder().decode(bytes)); } catch { throw new Error("The saved preparation settings are invalid."); }
    if (!recipeSnapshot || typeof recipeSnapshot !== "object" || Array.isArray(recipeSnapshot)) throw new Error("The saved preparation settings are invalid.");
    return {
      versionId: version.versionId,
      sourceArtifactIds: version.lineage.sources.map((source) => source.sourceArtifactId).filter((value): value is string => Boolean(value)),
      recipeSnapshot: recipeSnapshot as Record<string, unknown>,
      lineage: version.lineage,
    };
  }
}

interface DatasetVersionReadDependencies {
  readonly repository: DatasetVersionRepositoryPort;
  readonly workspaceRepository?: Pick<WorkspaceRepository, "readWorkspace">;
  readonly workspaceAuthorization?: WorkspaceOperationAuthorizationPort;
}

function readDependencies(input: DatasetVersionRepositoryPort | DatasetVersionReadDependencies): DatasetVersionReadDependencies {
  return "repository" in input ? input : { repository: input };
}

async function canReadWorkspace(dependencies: DatasetVersionReadDependencies, workspaceId: WorkspaceId, context: ApplicationRequestContext): Promise<boolean> {
  if (context.workspaceId !== undefined && context.workspaceId !== workspaceId) return false;
  if (!dependencies.workspaceRepository && !dependencies.workspaceAuthorization) return true;
  const result = await resolveArtifactWorkspaceContext({ ...context, workspaceId }, dependencies.workspaceRepository, dependencies.workspaceAuthorization ? { port: dependencies.workspaceAuthorization, operation: "dataset-version.read", requiredScopes: ["artifact:read"] } : undefined);
  return result.ok;
}

function artifactDigestForRole(version: DatasetVersionRecord, role: string): string {
  return version.artifacts.filter((artifact) => artifact.role === role).map((artifact) => artifact.digest).sort().join(",");
}
