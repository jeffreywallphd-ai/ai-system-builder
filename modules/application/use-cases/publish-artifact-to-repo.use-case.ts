import { createContractError } from "../../contracts/shared";
import {
  encodeArtifactRepoBackingLocator,
  createHasArtifactInRepoRequest,
  createStoreArtifactInRepoRequest,
  normalizeArtifactRepoTarget,
} from "../../contracts/storage";
import {
  Artifact,
  ArtifactBacking,
  ArtifactId,
} from "../../domain/artifact";
import type {
  ApplicationRequestContext,
  ArtifactCatalogReadPort,
} from "../ports";
import type { WorkspaceOperationAuthorizationPort } from "../ports/security";
import type { WorkspaceRepository } from "../ports/workspace";
import type {
  ArtifactObjectStoragePort,
  ArtifactRepoStoragePort,
  ArtifactStorageBindingPort,
} from "../ports/storage";
import { resolveArtifactWorkspaceContext } from "./artifact-workspace-context";

export interface PublishArtifactToRepoCommand {
  artifactId: string;
  target: {
    provider: string;
    repository: string;
    revision?: string;
    path?: string;
  };
  mediaType?: string;
  repositoryCreation?: {
    readonly approved: true;
    readonly visibility: "private" | "public";
  };
}

export interface PublishArtifactToRepoSuccessValue {
  target: {
    provider: string;
    repository: string;
    path: string;
    revision?: string;
    locator: string;
  };
  verification: {
    exists: boolean;
    verifiedAt: string;
  };
}

export interface PublishArtifactToRepoUseCaseDependencies {
  artifactStorage: ArtifactObjectStoragePort;
  artifactCatalogRead: ArtifactCatalogReadPort;
  artifactRepoStorage: ArtifactRepoStoragePort;
  artifactBindingStorage: ArtifactStorageBindingPort;
  workspaceRepository?: Pick<WorkspaceRepository, "readWorkspace">;
  workspaceAuthorization?: WorkspaceOperationAuthorizationPort;
  now?: () => string;
}

export class PublishArtifactToRepoUseCase {
  private readonly artifactStorage: ArtifactObjectStoragePort;
  private readonly artifactCatalogRead: ArtifactCatalogReadPort;
  private readonly artifactRepoStorage: ArtifactRepoStoragePort;
  private readonly artifactBindingStorage: ArtifactStorageBindingPort;
  private readonly workspaceRepository?: Pick<WorkspaceRepository, "readWorkspace">;
  private readonly workspaceAuthorization?: WorkspaceOperationAuthorizationPort;
  private readonly now: () => string;

  public constructor(dependencies: PublishArtifactToRepoUseCaseDependencies) {
    this.artifactStorage = dependencies.artifactStorage;
    this.artifactCatalogRead = dependencies.artifactCatalogRead;
    this.artifactRepoStorage = dependencies.artifactRepoStorage;
    this.artifactBindingStorage = dependencies.artifactBindingStorage;
    this.workspaceRepository = dependencies.workspaceRepository;
    this.workspaceAuthorization = dependencies.workspaceAuthorization;
    this.now = dependencies.now ?? (() => new Date().toISOString());
  }

  public async execute(
    command: PublishArtifactToRepoCommand,
    context: ApplicationRequestContext = {},
  ) {
    let artifactId: ArtifactId;
    try {
      artifactId = ArtifactId.from(command.artifactId);
    } catch (error) {
      return {
        ok: false as const,
        error: createContractError("validation", "artifactId must be a non-empty string.", {
          details: {
            reason: error instanceof Error ? error.message : String(error),
          },
        }),
      };
    }

    let normalizedTarget;
    try {
      normalizedTarget = normalizeArtifactRepoTarget(command.target as never);
    } catch (error) {
      return {
        ok: false as const,
        error: createContractError(
          "validation",
          error instanceof Error ? error.message : "Artifact repo target is invalid.",
        ),
      };
    }
    const targetPath = normalizedTarget.path;
    if (!targetPath) {
      return {
        ok: false as const,
        error: createContractError("validation", "target.path must be a non-empty string."),
      };
    }

    if (
      this.workspaceRepository ||
      this.workspaceAuthorization ||
      context.workspaceId
    ) {
      const workspaceContext = await resolveArtifactWorkspaceContext(
        context,
        this.workspaceRepository,
        this.workspaceAuthorization
          ? {
              port: this.workspaceAuthorization,
              operation: "artifact.publish",
              requiredScopes: [
                "artifact:write",
                "provider-credential:use",
                ...(command.repositoryCreation
                  ? (["provider-repository:create"] as const)
                  : []),
              ],
            }
          : undefined,
      );
      if (!workspaceContext.ok) return workspaceContext;
    }
    const hasContext = Object.values(context).some(
      (value) => value !== undefined,
    );

    const catalogRequest = {
      ...(context.workspaceId ? { workspaceId: context.workspaceId as never } : {}),
      storageKey: artifactId.toString(),
    };
    const catalogResult = await (hasContext
      ? this.artifactCatalogRead.readArtifactCatalogRecord(catalogRequest, context)
      : this.artifactCatalogRead.readArtifactCatalogRecord(catalogRequest));
    if (!catalogResult.ok) {
      return catalogResult;
    }

    const bindingsRequest = {
      ...(context.workspaceId ? { workspaceId: context.workspaceId as never } : {}),
      artifactId: artifactId.toString(),
    };
    const existingBindingsResult = await (hasContext
      ? this.artifactBindingStorage.readArtifactStorageBindings(bindingsRequest, context)
      : this.artifactBindingStorage.readArtifactStorageBindings(bindingsRequest));
    if (!existingBindingsResult.ok) {
      return existingBindingsResult;
    }
    const primaryBinding = existingBindingsResult.value.bindings.find((binding) =>
      binding.role === "primary"
      && binding.backing.kind === "artifact-object"
      && ["filesystem", "local-filesystem", "local"].includes(binding.backing.provider),
    );
    if (
      primaryBinding?.workspaceId
      && context.workspaceId
      && primaryBinding.workspaceId !== context.workspaceId
    ) {
      return {
        ok: false as const,
        error: createContractError("not-found", "Artifact is not available in the requested workspace."),
      };
    }

    const localStorageKey = primaryBinding?.backing.locator ?? catalogResult.value.record.storageKey;
    if (localStorageKey !== catalogResult.value.record.storageKey && !primaryBinding) {
      return {
        ok: false as const,
        error: createContractError("not-found", "Artifact has no approved local storage binding."),
      };
    }

    const localResult = await (hasContext
      ? this.artifactStorage.retrieveArtifact({ key: localStorageKey }, context)
      : this.artifactStorage.retrieveArtifact({ key: localStorageKey }));
    if (!localResult.ok) {
      return localResult;
    }

    const storeResult = await this.artifactRepoStorage.storeArtifactInRepo(
      createStoreArtifactInRepoRequest(localResult.value.content as Uint8Array, {
        target: normalizedTarget,
        mediaType: command.mediaType ?? localResult.value.descriptor.mediaType,
        repositoryCreation: command.repositoryCreation,
      }),
    );
    if (!storeResult.ok) {
      return storeResult;
    }

    const hasResult = await this.artifactRepoStorage.hasArtifactInRepo(
      createHasArtifactInRepoRequest(normalizedTarget),
    );
    if (!hasResult.ok) {
      return hasResult;
    }

    const revision = normalizedTarget.revision ?? "main";
    const verifiedAt = this.now();
    const locator = encodeArtifactRepoBackingLocator({
      repository: normalizedTarget.repository,
      path: targetPath,
    });
    const artifact = Artifact.fromStorageBindings({
      artifactId: artifactId.toString(),
      artifactFamily: "image",
      bindings: existingBindingsResult.value.bindings,
    });
    artifact.attachOrUpdateBacking(
      ArtifactBacking.from({
        kind: "artifact-repo",
        provider: normalizedTarget.provider,
        locator,
        role: "published",
        createdAt: verifiedAt,
        revision,
        target: {
          provider: normalizedTarget.provider,
          repository: normalizedTarget.repository,
          path: targetPath,
          revision,
        },
        verification: {
          exists: hasResult.value.exists,
          verifiedAt,
        },
      }),
    );

    const latestPublishedBacking = artifact.latestBackingForRole("published");
    if (!latestPublishedBacking) {
      return {
        ok: false as const,
        error: createContractError("internal", "Published backing could not be constructed."),
      };
    }

    const publishedBinding = latestPublishedBacking.toStorageBinding(artifact.id.toString());
    const bindingRequest = {
      binding: {
        ...publishedBinding,
        ...(context.workspaceId ? { workspaceId: context.workspaceId as never } : {}),
      },
    };
    const bindingResult = await (hasContext
      ? this.artifactBindingStorage.upsertArtifactStorageBinding(bindingRequest, context)
      : this.artifactBindingStorage.upsertArtifactStorageBinding(bindingRequest));
    if (!bindingResult.ok) {
      return bindingResult;
    }

    return {
      ok: true as const,
      value: {
        target: {
          provider: normalizedTarget.provider,
          repository: normalizedTarget.repository,
          path: targetPath,
          revision,
          locator,
        },
        verification: {
          exists: hasResult.value.exists,
          verifiedAt,
        },
      } satisfies PublishArtifactToRepoSuccessValue,
    };
  }
}

