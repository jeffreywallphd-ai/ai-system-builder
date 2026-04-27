import { createContractError } from "../../contracts/shared";
import {
  encodeArtifactRepoBackingLocator,
  createHasArtifactInRepoRequest,
  createStoreArtifactInRepoRequest,
} from "../../contracts/storage";
import {
  Artifact,
  ArtifactBacking,
  ArtifactId,
} from "../../domain/artifact";
import type {
  ArtifactObjectStoragePort,
  ArtifactRepoStoragePort,
  ArtifactStorageBindingPort,
} from "../ports/storage";

export interface PublishArtifactToRepoCommand {
  artifactId: string;
  target: {
    provider: string;
    repository: string;
    revision?: string;
    path?: string;
  };
  mediaType?: string;
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
  artifactRepoStorage: ArtifactRepoStoragePort;
  artifactBindingStorage: ArtifactStorageBindingPort;
  now?: () => string;
}

export class PublishArtifactToRepoUseCase {
  private readonly artifactStorage: ArtifactObjectStoragePort;
  private readonly artifactRepoStorage: ArtifactRepoStoragePort;
  private readonly artifactBindingStorage: ArtifactStorageBindingPort;
  private readonly now: () => string;

  public constructor(dependencies: PublishArtifactToRepoUseCaseDependencies) {
    this.artifactStorage = dependencies.artifactStorage;
    this.artifactRepoStorage = dependencies.artifactRepoStorage;
    this.artifactBindingStorage = dependencies.artifactBindingStorage;
    this.now = dependencies.now ?? (() => new Date().toISOString());
  }

  public async execute(command: PublishArtifactToRepoCommand) {
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

    const targetPath = command.target.path?.trim();
    if (!targetPath) {
      return {
        ok: false as const,
        error: createContractError("validation", "target.path must be a non-empty string."),
      };
    }

    const localResult = await this.artifactStorage.retrieveArtifact({
      key: artifactId.toString(),
    });
    if (!localResult.ok) {
      return localResult;
    }

    const storeResult = await this.artifactRepoStorage.storeArtifactInRepo(
      createStoreArtifactInRepoRequest(localResult.value.content as Uint8Array, {
        target: command.target,
        mediaType: command.mediaType ?? localResult.value.descriptor.mediaType,
      }),
    );
    if (!storeResult.ok) {
      return storeResult;
    }

    const hasResult = await this.artifactRepoStorage.hasArtifactInRepo(
      createHasArtifactInRepoRequest(command.target),
    );
    if (!hasResult.ok) {
      return hasResult;
    }

    const revision = command.target.revision?.trim() || "main";
    const verifiedAt = this.now();
    const locator = encodeArtifactRepoBackingLocator({
      repository: command.target.repository,
      path: targetPath,
    });
    const existingBindingsResult = await this.artifactBindingStorage.readArtifactStorageBindings({
      artifactId: artifactId.toString(),
    });
    if (!existingBindingsResult.ok) {
      return existingBindingsResult;
    }

    const artifact = Artifact.fromStorageBindings({
      artifactId: artifactId.toString(),
      artifactFamily: "image",
      bindings: existingBindingsResult.value.bindings,
    });
    artifact.attachOrUpdateBacking(
      ArtifactBacking.from({
        kind: "artifact-repo",
        provider: command.target.provider,
        locator,
        role: "published",
        createdAt: verifiedAt,
        revision,
        target: {
          provider: command.target.provider,
          repository: command.target.repository,
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

    const bindingResult = await this.artifactBindingStorage.upsertArtifactStorageBinding({
      binding: latestPublishedBacking.toStorageBinding(artifact.id.toString()),
    });
    if (!bindingResult.ok) {
      return bindingResult;
    }

    return {
      ok: true as const,
      value: {
        target: {
          provider: command.target.provider,
          repository: command.target.repository,
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

