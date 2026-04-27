import { createContractError } from "../../contracts/shared";
import { createStoreArtifactRequest } from "../../contracts/storage";
import { Artifact, ArtifactBacking, ArtifactId } from "../../domain/artifact";
import type {
  ArtifactObjectStoragePort,
  ArtifactRepoStoragePort,
  ArtifactStorageBindingPort,
} from "../ports/storage";

export interface LocalizeArtifactFromRepoCommand {
  artifactId: string;
}

export interface LocalizeArtifactFromRepoSuccessValue {
  artifactId: string;
  localObject: {
    key: string;
    mediaType?: string;
    sizeBytes: number;
  };
  source: {
    provider: string;
    repository: string;
    path: string;
    revision?: string;
    locator: string;
  };
  localizedAt: string;
}

export interface LocalizeArtifactFromRepoUseCaseDependencies {
  artifactRepoStorage: ArtifactRepoStoragePort;
  artifactBindingStorage: ArtifactStorageBindingPort;
  artifactStorage: ArtifactObjectStoragePort;
  now?: () => string;
}

export class LocalizeArtifactFromRepoUseCase {
  private readonly artifactRepoStorage: ArtifactRepoStoragePort;
  private readonly artifactBindingStorage: ArtifactStorageBindingPort;
  private readonly artifactStorage: ArtifactObjectStoragePort;
  private readonly now: () => string;

  public constructor(dependencies: LocalizeArtifactFromRepoUseCaseDependencies) {
    this.artifactRepoStorage = dependencies.artifactRepoStorage;
    this.artifactBindingStorage = dependencies.artifactBindingStorage;
    this.artifactStorage = dependencies.artifactStorage;
    this.now = dependencies.now ?? (() => new Date().toISOString());
  }

  public async execute(command: LocalizeArtifactFromRepoCommand) {
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

    const readBindingsResult = await this.artifactBindingStorage.readArtifactStorageBindings({
      artifactId: artifactId.toString(),
    });
    if (!readBindingsResult.ok) {
      return readBindingsResult;
    }

    const artifact = Artifact.fromStorageBindings({
      artifactId: artifactId.toString(),
      artifactFamily: "image",
      bindings: readBindingsResult.value.bindings,
    });

    const importedSource = artifact.latestBackingForRole("imported-source");
    if (!importedSource) {
      return {
        ok: false as const,
        error: createContractError("not-found", "No imported source backing exists for this artifact."),
      };
    }

    const target = importedSource.resolvedTarget();
    if (!target) {
      return {
        ok: false as const,
        error: createContractError("internal", "Imported source backing target could not be resolved."),
      };
    }

    const retrieveResult = await this.artifactRepoStorage.retrieveArtifactFromRepo({ target });
    if (!retrieveResult.ok) {
      if (retrieveResult.error.code === "unavailable") {
        return {
          ok: false as const,
          error: createContractError(
            "unavailable",
            `Failed to localize imported artifact from Hugging Face. ${retrieveResult.error.message}`,
            {
              details: retrieveResult.error.details,
            },
          ),
        };
      }
      return retrieveResult;
    }

    const localizedAt = this.now();
    const storeResult = await this.artifactStorage.storeArtifact(
      createStoreArtifactRequest(retrieveResult.value.content, {
        descriptor: {
          key: artifactId.toString(),
          mediaType: retrieveResult.value.descriptor.mediaType,
        },
        overwrite: true,
      }),
    );
    if (!storeResult.ok) {
      return storeResult;
    }
    const localizedSizeBytes = storeResult.value.sizeBytes ?? retrieveResult.value.content.byteLength;

    const updatedImported = importedSource.withVerification(
      {
        exists: true,
        verifiedAt: localizedAt,
      },
      localizedAt,
    );
    artifact.attachOrUpdateBacking(updatedImported);
    artifact.attachOrUpdateBacking(
      ArtifactBacking.from({
        kind: "artifact-object",
        provider: "local-filesystem",
        locator: artifactId.toString(),
        role: "primary",
        createdAt: localizedAt,
      }),
    );

    const upserts = artifact.toStorageBindings();
    for (const binding of upserts) {
      if (binding.role === "imported-source" || binding.role === "primary") {
        const result = await this.artifactBindingStorage.upsertArtifactStorageBinding({ binding });
        if (!result.ok) {
          return result;
        }
      }
    }

    return {
      ok: true as const,
      value: {
        artifactId: artifact.id.toString(),
        localObject: {
          key: storeResult.value.key,
          mediaType: storeResult.value.mediaType,
          sizeBytes: localizedSizeBytes,
        },
        source: {
          provider: target.provider,
          repository: target.repository,
          path: target.path,
          revision: target.revision,
          locator: importedSource.locator,
        },
        localizedAt,
      } satisfies LocalizeArtifactFromRepoSuccessValue,
    };
  }
}
