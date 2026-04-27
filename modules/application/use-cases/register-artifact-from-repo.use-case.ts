import type { ArtifactCatalogAppendPort } from "../ports/artifact-catalog";
import type { ApplicationRequestContext } from "../ports";
import type { LoggingPort } from "../ports/logging";
import type { ArtifactRepoStoragePort, ArtifactStorageBindingPort } from "../ports/storage";
import { resolveArtifactFamily } from "../shared/artifact-family-classifier";
import { createContractError } from "../../contracts/shared";
import {
  createHasArtifactInRepoRequest,
  encodeArtifactRepoBackingLocator,
} from "../../contracts/storage";
import {
  Artifact,
  ArtifactBacking,
  ArtifactId,
  SystemArtifactIdFactory,
  type ArtifactIdFactory,
} from "../../domain/artifact";
import type { ArtifactFamily } from "../../domain/artifact";

export interface RegisterArtifactFromRepoCommand {
  target: {
    provider: string;
    repository: string;
    path: string;
    revision?: string;
  };
  artifactFamily?: ArtifactFamily;
  mediaType?: string;
}

export interface RegisterArtifactFromRepoSuccessValue {
  artifactId: string;
  backing: {
    target: {
      provider: string;
      repository: string;
      path: string;
      revision: string;
      locator: string;
    };
    verification: {
      exists: true;
      verifiedAt: string;
    };
    role: "imported-source";
  };
}

export interface RegisterArtifactFromRepoUseCaseDependencies {
  artifactRepoStorage: ArtifactRepoStoragePort;
  artifactBindingStorage: ArtifactStorageBindingPort;
  artifactCatalogAppend: ArtifactCatalogAppendPort;
  logging: LoggingPort;
  now?: () => string;
  artifactIdFactory?: ArtifactIdFactory;
  createArtifactId?: () => ArtifactId;
}

export class RegisterArtifactFromRepoUseCase {
  private readonly artifactRepoStorage: ArtifactRepoStoragePort;
  private readonly artifactBindingStorage: ArtifactStorageBindingPort;
  private readonly artifactCatalogAppend: ArtifactCatalogAppendPort;
  private readonly logging: LoggingPort;
  private readonly now: () => string;
  private readonly createArtifactId: () => ArtifactId;

  public constructor(dependencies: RegisterArtifactFromRepoUseCaseDependencies) {
    this.artifactRepoStorage = dependencies.artifactRepoStorage;
    this.artifactBindingStorage = dependencies.artifactBindingStorage;
    this.artifactCatalogAppend = dependencies.artifactCatalogAppend;
    this.logging = dependencies.logging;
    this.now = dependencies.now ?? (() => new Date().toISOString());
    const artifactIdFactory = dependencies.artifactIdFactory ?? new SystemArtifactIdFactory();
    this.createArtifactId = dependencies.createArtifactId ?? (() => artifactIdFactory.createArtifactId());
  }

  public async execute(command: RegisterArtifactFromRepoCommand, context: ApplicationRequestContext = {}) {
    const startedAt = Date.now();
    const provider = command.target.provider?.trim();
    const repository = command.target.repository?.trim();
    const path = command.target.path?.trim();
    const revision = command.target.revision?.trim() || "main";
    const resolvedArtifactFamily: ArtifactFamily = command.artifactFamily
      ?? resolveArtifactFamily({ mediaType: command.mediaType, fileName: command.target.path });
    await this.logging.log({
      timestamp: this.now(),
      level: "info",
      verbosity: "normal",
      event: "application.huggingface.file-registration.started",
      message: "Starting Hugging Face file registration request.",
      component: "application.use-cases",
      operation: "artifact.register.from-repo",
      useCase: "RegisterArtifactFromRepoUseCase",
      requestId: context.requestId,
      correlationId: context.correlationId,
      data: { provider, repository, path, revision },
    });

    if (!provider || !repository || !path) {
      const result = {
        ok: false as const,
        error: createContractError(
          "validation",
          "target.provider, target.repository, and target.path must be non-empty strings.",
        ),
      };
      await this.logging.log({
        timestamp: this.now(),
        level: "warn",
        verbosity: "normal",
        event: "application.huggingface.file-registration.failed",
        message: "Hugging Face file registration failed validation.",
        component: "application.use-cases",
        operation: "artifact.register.from-repo",
        useCase: "RegisterArtifactFromRepoUseCase",
        requestId: context.requestId,
        correlationId: context.correlationId,
        outcome: "failure",
        durationMs: Date.now() - startedAt,
        data: { provider, repository, path, revision },
        error: { errorType: "validation", errorCode: result.error.code, errorMessage: result.error.message },
      });
      return result;
    }

    const hasResult = await this.artifactRepoStorage.hasArtifactInRepo(
      createHasArtifactInRepoRequest({ provider, repository, path, revision }),
    );

    if (!hasResult.ok) {
      if (hasResult.error.code === "unavailable") {
        const unavailableResult = {
          ok: false as const,
          error: createContractError(
            "unavailable",
            `Failed to verify Hugging Face repository access for register/import. ${hasResult.error.message}`,
            {
              details: hasResult.error.details,
            },
          ),
        };
        await this.logging.log({
          timestamp: this.now(),
          level: "error",
          verbosity: "normal",
          event: "application.huggingface.file-registration.failed",
          message: "Hugging Face file registration failed while verifying remote target.",
          component: "application.use-cases",
          operation: "artifact.register.from-repo",
          useCase: "RegisterArtifactFromRepoUseCase",
          requestId: context.requestId,
          correlationId: context.correlationId,
          outcome: "failure",
          durationMs: Date.now() - startedAt,
          data: { provider, repository, path, revision },
          error: {
            errorType: "provider",
            errorCode: unavailableResult.error.code,
            errorMessage: unavailableResult.error.message,
            details: unavailableResult.error.details,
          },
        });
        return unavailableResult;
      }
      await this.logging.log({
        timestamp: this.now(),
        level: "error",
        verbosity: "normal",
        event: "application.huggingface.file-registration.failed",
        message: "Hugging Face file registration failed while verifying remote target.",
        component: "application.use-cases",
        operation: "artifact.register.from-repo",
        useCase: "RegisterArtifactFromRepoUseCase",
        requestId: context.requestId,
        correlationId: context.correlationId,
        outcome: "failure",
        durationMs: Date.now() - startedAt,
        data: { provider, repository, path, revision },
        error: {
          errorType: "provider",
          errorCode: hasResult.error.code,
          errorMessage: hasResult.error.message,
          details: hasResult.error.details,
        },
      });
      return hasResult;
    }

    if (!hasResult.value.exists) {
      const notFoundResult = {
        ok: false as const,
        error: createContractError(
          "not-found",
          "Remote artifact was not found at the requested provider/repository/path.",
        ),
      };
      await this.logging.log({
        timestamp: this.now(),
        level: "warn",
        verbosity: "normal",
        event: "application.huggingface.file-registration.failed",
        message: "Hugging Face file registration target was not found.",
        component: "application.use-cases",
        operation: "artifact.register.from-repo",
        useCase: "RegisterArtifactFromRepoUseCase",
        requestId: context.requestId,
        correlationId: context.correlationId,
        outcome: "failure",
        durationMs: Date.now() - startedAt,
        data: { provider, repository, path, revision },
        error: { errorType: "not-found", errorCode: notFoundResult.error.code, errorMessage: notFoundResult.error.message },
      });
      return notFoundResult;
    }

    // Internal artifact identity is system-owned; repo coordinates remain backing metadata.
    const artifactId = this.createArtifactId();
    const verifiedAt = this.now();
    const locator = encodeArtifactRepoBackingLocator({ repository, path });

    const appendResult = await this.artifactCatalogAppend.appendArtifactCatalogRecord({
      record: {
        storageKey: artifactId.toString(),
        artifactFamily: resolvedArtifactFamily,
        mediaType: command.mediaType?.trim() || undefined,
        originalName: path,
        createdAt: verifiedAt,
      },
    });
    if (!appendResult.ok) {
      await this.logging.log({
        timestamp: this.now(),
        level: "error",
        verbosity: "normal",
        event: "application.huggingface.file-registration.failed",
        message: "Hugging Face file registration failed while appending artifact catalog record.",
        component: "application.use-cases",
        operation: "artifact.register.from-repo",
        useCase: "RegisterArtifactFromRepoUseCase",
        requestId: context.requestId,
        correlationId: context.correlationId,
        outcome: "failure",
        durationMs: Date.now() - startedAt,
        data: { provider, repository, path, revision },
        error: {
          errorType: "persistence",
          errorCode: appendResult.error.code,
          errorMessage: appendResult.error.message,
          details: appendResult.error.details,
        },
      });
      return appendResult;
    }

    const artifact = Artifact.create({
      id: artifactId,
      artifactFamily: resolvedArtifactFamily,
    });
    artifact.attachOrUpdateBacking(
      ArtifactBacking.from({
        kind: "artifact-repo",
        provider,
        locator,
        role: "imported-source",
        createdAt: verifiedAt,
        revision,
        target: {
          provider,
          repository,
          path,
          revision,
        },
        verification: {
          exists: true,
          verifiedAt,
        },
      }),
    );
    const importedSource = artifact.latestBackingForRole("imported-source");
    if (!importedSource) {
      const internalResult = {
        ok: false as const,
        error: createContractError("internal", "Imported-source backing could not be constructed."),
      };
      await this.logging.log({
        timestamp: this.now(),
        level: "error",
        verbosity: "normal",
        event: "application.huggingface.file-registration.failed",
        message: "Hugging Face file registration failed while constructing imported-source backing.",
        component: "application.use-cases",
        operation: "artifact.register.from-repo",
        useCase: "RegisterArtifactFromRepoUseCase",
        requestId: context.requestId,
        correlationId: context.correlationId,
        outcome: "failure",
        durationMs: Date.now() - startedAt,
        data: { provider, repository, path, revision },
        error: { errorType: "internal", errorCode: internalResult.error.code, errorMessage: internalResult.error.message },
      });
      return internalResult;
    }

    const bindingResult = await this.artifactBindingStorage.upsertArtifactStorageBinding({
      binding: importedSource.toStorageBinding(artifact.id.toString()),
    });

    if (!bindingResult.ok) {
      await this.logging.log({
        timestamp: this.now(),
        level: "error",
        verbosity: "normal",
        event: "application.huggingface.file-registration.failed",
        message: "Hugging Face file registration failed while writing backing binding.",
        component: "application.use-cases",
        operation: "artifact.register.from-repo",
        useCase: "RegisterArtifactFromRepoUseCase",
        requestId: context.requestId,
        correlationId: context.correlationId,
        outcome: "failure",
        durationMs: Date.now() - startedAt,
        data: { provider, repository, path, revision },
        error: {
          errorType: "persistence",
          errorCode: bindingResult.error.code,
          errorMessage: bindingResult.error.message,
          details: bindingResult.error.details,
        },
      });
      return bindingResult;
    }

    const result = {
      ok: true as const,
      value: {
        artifactId: artifact.id.toString(),
        backing: {
          role: "imported-source",
          target: {
            provider,
            repository,
            path,
            revision,
            locator,
          },
          verification: {
            exists: true,
            verifiedAt,
          },
        },
      } satisfies RegisterArtifactFromRepoSuccessValue,
    };
    await this.logging.log({
      timestamp: this.now(),
      level: "info",
      verbosity: "normal",
      event: "application.huggingface.file-registration.succeeded",
      message: "Hugging Face file registration request succeeded.",
      component: "application.use-cases",
      operation: "artifact.register.from-repo",
      useCase: "RegisterArtifactFromRepoUseCase",
      requestId: context.requestId,
      correlationId: context.correlationId,
      outcome: "success",
      durationMs: Date.now() - startedAt,
      data: { artifactId: result.value.artifactId, provider, repository, path, revision },
    });
    return result;
  }
}
