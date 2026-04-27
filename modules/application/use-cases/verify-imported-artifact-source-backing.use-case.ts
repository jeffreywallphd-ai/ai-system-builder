import { createContractError } from "../../contracts/shared";
import { createHasArtifactInRepoRequest } from "../../contracts/storage";
import { Artifact, ArtifactId } from "../../domain/artifact";
import type { ArtifactRepoStoragePort, ArtifactStorageBindingPort } from "../ports/storage";

export interface VerifyImportedArtifactSourceBackingCommand {
  artifactId: string;
}

export interface VerifyImportedArtifactSourceBackingSuccessValue {
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

export interface VerifyImportedArtifactSourceBackingUseCaseDependencies {
  artifactRepoStorage: ArtifactRepoStoragePort;
  artifactBindingStorage: ArtifactStorageBindingPort;
  now?: () => string;
}

export class VerifyImportedArtifactSourceBackingUseCase {
  private readonly artifactRepoStorage: ArtifactRepoStoragePort;
  private readonly artifactBindingStorage: ArtifactStorageBindingPort;
  private readonly now: () => string;

  public constructor(dependencies: VerifyImportedArtifactSourceBackingUseCaseDependencies) {
    this.artifactRepoStorage = dependencies.artifactRepoStorage;
    this.artifactBindingStorage = dependencies.artifactBindingStorage;
    this.now = dependencies.now ?? (() => new Date().toISOString());
  }

  public async execute(command: VerifyImportedArtifactSourceBackingCommand) {
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
    const importedSourceBacking = artifact.latestBackingForRole("imported-source");
    if (!importedSourceBacking) {
      return {
        ok: false as const,
        error: createContractError("not-found", "No imported source backing exists for this artifact."),
      };
    }

    const target = importedSourceBacking.resolvedTarget();
    if (!target) {
      return {
        ok: false as const,
        error: createContractError("internal", "Imported source backing target could not be resolved."),
      };
    }

    const hasResult = await this.artifactRepoStorage.hasArtifactInRepo(
      createHasArtifactInRepoRequest({
        provider: target.provider,
        repository: target.repository,
        revision: target.revision,
        path: target.path,
      }),
    );
    if (!hasResult.ok) {
      return hasResult;
    }

    const verifiedAt = this.now();
    const updatedBacking = importedSourceBacking.withVerification(
      {
        exists: hasResult.value.exists,
        verifiedAt,
      },
      verifiedAt,
    );
    artifact.attachOrUpdateBacking(updatedBacking);

    const upsertResult = await this.artifactBindingStorage.upsertArtifactStorageBinding({
      binding: updatedBacking.toStorageBinding(artifact.id.toString()),
    });
    if (!upsertResult.ok) {
      return upsertResult;
    }

    return {
      ok: true as const,
      value: {
        target: {
          provider: target.provider,
          repository: target.repository,
          path: target.path,
          revision: target.revision,
          locator: importedSourceBacking.locator,
        },
        verification: {
          exists: hasResult.value.exists,
          verifiedAt,
        },
      } satisfies VerifyImportedArtifactSourceBackingSuccessValue,
    };
  }
}
