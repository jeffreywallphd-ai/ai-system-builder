import type { DatasetVersionRepositoryPort, DatasetVersionHasherPort, DatasetVersionPublisherPort } from "../../ports/dataset-version";
import type { ArtifactObjectStoragePort } from "../../ports/storage";
import type { WorkspaceOperationAuthorizationPort } from "../../ports/security";
import type { WorkspaceRepository } from "../../ports/workspace";
import type { ApplicationRequestContext } from "../../ports";
import { createFailureResult, createSuccessResult, createContractError } from "../../../contracts/shared";
import { createRetrieveArtifactRequest } from "../../../contracts/storage";
import { normalizeDatasetVersionDigest, type DatasetPublicationVisibility, type DatasetVersionArtifact, type DatasetVersionPublicationRecord } from "../../../contracts/dataset";
import { createWorkspaceId } from "../../../contracts/workspace";
import { resolveArtifactWorkspaceContext } from "../artifact-workspace-context";

export interface PublishDatasetVersionCommand {
  readonly workspaceId: string;
  readonly versionId: string;
  readonly repositoryId: string;
  readonly visibility?: DatasetPublicationVisibility;
  readonly createRepository?: boolean;
  readonly confirmation: {
    readonly approved: true;
    readonly visibility: DatasetPublicationVisibility;
    readonly publicAccessConfirmed?: true;
  };
}

export class PublishDatasetVersionUseCase {
  public constructor(private readonly dependencies: {
    readonly repository: DatasetVersionRepositoryPort;
    readonly artifacts: ArtifactObjectStoragePort;
    readonly publisher: DatasetVersionPublisherPort;
    readonly hasher: DatasetVersionHasherPort;
    readonly workspaceRepository?: Pick<WorkspaceRepository, "readWorkspace">;
    readonly workspaceAuthorization?: WorkspaceOperationAuthorizationPort;
    readonly now?: () => string;
  }) {}

  public async execute(command: PublishDatasetVersionCommand, context: ApplicationRequestContext = {}) {
    let workspaceId;
    try { workspaceId = createWorkspaceId(command.workspaceId); } catch { return createFailureResult(createContractError("validation", "Choose a valid workspace before publishing."), context); }
    if (context.workspaceId !== workspaceId) return createFailureResult(createContractError("not-found", "Dataset version was not found."), context);
    const visibility = command.visibility ?? "private";
    if (visibility === "protected") {
      return createFailureResult(createContractError("validation", "Protected provider visibility is not supported. Choose Private or Public."), context);
    }
    if (!command.confirmation?.approved || command.confirmation.visibility !== visibility || (visibility === "public" && command.confirmation.publicAccessConfirmed !== true)) {
      return createFailureResult(createContractError("validation", visibility === "public" ? "Public access requires a separate explicit confirmation." : "Confirm the private publication destination before publishing."), context);
    }
    if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]*\/[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(command.repositoryId) || command.repositoryId.includes("..")) {
      return createFailureResult(createContractError("validation", "Repository must use the namespace/name format."), context);
    }
    if (this.dependencies.workspaceRepository || this.dependencies.workspaceAuthorization) {
      const authorized = await resolveArtifactWorkspaceContext(context, this.dependencies.workspaceRepository, this.dependencies.workspaceAuthorization ? {
        port: this.dependencies.workspaceAuthorization,
        operation: "dataset-version.publish",
        requiredScopes: ["artifact:write", "provider-credential:use", ...(command.createRepository ? ["provider-repository:create" as const] : [])],
      } : undefined);
      if (!authorized.ok) return authorized;
    }
    const version = await this.dependencies.repository.readVersion(workspaceId, command.versionId as never);
    if (!version) return createFailureResult(createContractError("not-found", "Dataset version was not found."), context);
    const existing = (await this.dependencies.repository.listPublications(workspaceId, version.versionId)).find((item) => item.provider === "hugging-face" && item.repositoryId === command.repositoryId && item.visibility === visibility);
    if (existing) return createSuccessResult({ publication: existing }, context);

    try {
      const files = [];
      for (const [index, artifact] of version.artifacts.entries()) {
        const retrieved = await this.dependencies.artifacts.retrieveArtifact<Uint8Array>(createRetrieveArtifactRequest(artifact.artifactKey), context);
        if (!retrieved.ok) throw new Error("A version artifact is unavailable for publication.");
        const actual = this.dependencies.hasher.digest(retrieved.value.content);
        if (actual !== artifact.digest) throw new Error("A version artifact failed integrity verification.");
        files.push({ path: publicationPath(artifact, index), content: retrieved.value.content, mediaType: artifact.mediaType, digest: artifact.digest });
      }
      const published = await this.dependencies.publisher.publishDatasetVersion({
        provider: "hugging-face", repositoryId: command.repositoryId, branch: "main", visibility,
        repositoryCreationApproved: command.createRepository === true, versionDigest: version.versionDigest, files,
      }, context);
      if (!published.ok) return published;
      const publishedAt = this.dependencies.now?.() ?? new Date().toISOString();
      const publicationId = `dataset-pub:${this.dependencies.hasher.digest(`${version.versionDigest}:${command.repositoryId}:${published.value.revision}`).slice("sha256:".length, "sha256:".length + 32)}` as DatasetVersionPublicationRecord["publicationId"];
      const publication = await this.dependencies.repository.recordPublication({
        schemaVersion: "1.0", publicationId, versionId: version.versionId,
        ...(version.organizationId ? { organizationId: version.organizationId } : {}), workspaceId,
        provider: "hugging-face", repositoryId: command.repositoryId, revision: published.value.revision,
        visibility, publishedAt, publishedBy: context.principalId?.trim() || "local-user",
      });
      return createSuccessResult({ publication }, context);
    } catch {
      return createFailureResult(createContractError("internal", "The dataset version could not be published. Local version files remain available to retry."), context);
    }
  }
}

function publicationPath(artifact: DatasetVersionArtifact, index: number): string {
  if (artifact.role === "dataset-card") return "README.md";
  if (artifact.role === "croissant") return "croissant.json";
  if (artifact.role === "recipe") return "metadata/recipe.json";
  if (artifact.role === "report") return "reports/quality-report.json";
  if (artifact.role === "quarantine") return "data/quarantine.jsonl";
  const extension = mediaTypeExtension(artifact.mediaType);
  return `data/${artifact.role}${index === 0 ? "" : `-${index + 1}`}.${extension}`;
}

function mediaTypeExtension(mediaType: string): string {
  if (mediaType.includes("parquet")) return "parquet";
  if (mediaType.includes("csv")) return "csv";
  if (mediaType.includes("ndjson") || mediaType.includes("jsonl")) return "jsonl";
  if (mediaType.includes("json")) return "json";
  return "bin";
}
