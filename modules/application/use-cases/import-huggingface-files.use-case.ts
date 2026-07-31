import type { ApplicationRequestContext } from "../ports";
import type { LoggingPort } from "../ports/logging";
import { createContractError } from "../../contracts/shared";
import type { BrowseHuggingFaceDatasetParquetFilesUseCase } from "./browse-huggingface-dataset-parquet-files.use-case";
import type { RegisterArtifactFromRepoUseCase } from "./register-artifact-from-repo.use-case";

export interface ImportHuggingFaceRepositorySelection {
  repository: string;
  revision?: string;
}

export interface ImportHuggingFaceFileSelection extends ImportHuggingFaceRepositorySelection {
  path: string;
  mediaType?: string;
}

export interface ImportHuggingFaceFilesCommand {
  repositories?: ImportHuggingFaceRepositorySelection[];
  files?: ImportHuggingFaceFileSelection[];
}

export interface ImportHuggingFaceFileResult {
  repository: string;
  path: string;
  revision: string;
  mediaType?: string;
  status: "registered" | "failed";
  artifactId?: string;
  message?: string;
  code?: "validation" | "not-found" | "unavailable" | "internal";
}

export interface ImportHuggingFaceRepositoryResult {
  repository: string;
  revision: string;
  status: "succeeded" | "partial" | "failed";
  files: ImportHuggingFaceFileResult[];
  message?: string;
  code?: "validation" | "not-found" | "unavailable" | "internal";
}

export interface ImportHuggingFaceFilesSuccessValue {
  repositories: ImportHuggingFaceRepositoryResult[];
  summary: {
    attempted: number;
    succeeded: number;
    failed: number;
  };
}

export class ImportHuggingFaceFilesUseCase {
  private readonly browseFiles: Pick<BrowseHuggingFaceDatasetParquetFilesUseCase, "execute">;
  private readonly registerArtifact: Pick<RegisterArtifactFromRepoUseCase, "execute">;
  private readonly logging: LoggingPort;
  private readonly now: () => string;

  public constructor(dependencies: {
    browseFiles: Pick<BrowseHuggingFaceDatasetParquetFilesUseCase, "execute">;
    registerArtifact: Pick<RegisterArtifactFromRepoUseCase, "execute">;
    logging: LoggingPort;
    now?: () => string;
  }) {
    this.browseFiles = dependencies.browseFiles;
    this.registerArtifact = dependencies.registerArtifact;
    this.logging = dependencies.logging;
    this.now = dependencies.now ?? (() => new Date().toISOString());
  }

  public async execute(
    command: ImportHuggingFaceFilesCommand,
    context: ApplicationRequestContext = {},
  ) {
    const startedAt = Date.now();
    const repositorySelections = normalizeRepositorySelections(command.repositories ?? []);
    const fileSelections = normalizeFileSelections(command.files ?? []);

    await this.logging.log({
      timestamp: this.now(),
      level: "info",
      verbosity: "normal",
      event: "application.huggingface.files-import.started",
      message: "Starting Hugging Face file import batch.",
      component: "application.use-cases",
      operation: "huggingface.files.import",
      useCase: "ImportHuggingFaceFilesUseCase",
      requestId: context.requestId,
      correlationId: context.correlationId,
      data: {
        repositoryCount: repositorySelections.length,
        selectedFileCount: fileSelections.length,
      },
    });

    if (repositorySelections.length === 0 && fileSelections.length === 0) {
      const result = {
        ok: false as const,
        error: createContractError(
          "validation",
          "At least one Hugging Face repository or file must be selected for import.",
        ),
      };
      await this.logging.log({
        timestamp: this.now(),
        level: "warn",
        verbosity: "normal",
        event: "application.huggingface.files-import.failed",
        message: "Hugging Face file import batch failed validation.",
        component: "application.use-cases",
        operation: "huggingface.files.import",
        useCase: "ImportHuggingFaceFilesUseCase",
        requestId: context.requestId,
        correlationId: context.correlationId,
        outcome: "failure",
        durationMs: Date.now() - startedAt,
        error: { errorType: "validation", errorCode: result.error.code, errorMessage: result.error.message },
      });
      return result;
    }

    const grouped = new Map<string, ImportHuggingFaceRepositoryResult>();
    for (const selection of repositorySelections) {
      const repositoryResult = await this.browseRepositoryFiles(selection, context);
      grouped.set(repositoryKey(selection.repository, selection.revision), repositoryResult);
    }

    for (const file of fileSelections) {
      const key = repositoryKey(file.repository, file.revision);
      const repositoryResult = grouped.get(key)
        ?? {
          repository: file.repository,
          revision: file.revision ?? "main",
          status: "failed" as const,
          files: [],
        };
      if (!repositoryResult.files.some((candidate) => candidate.path === file.path)) {
        repositoryResult.files.push({
          repository: file.repository,
          path: file.path,
          revision: file.revision ?? "main",
          mediaType: file.mediaType,
          status: "failed",
        });
      }
      grouped.set(key, repositoryResult);
    }

    const repositories: ImportHuggingFaceRepositoryResult[] = [];
    for (const repositoryResult of grouped.values()) {
      if (repositoryResult.files.length > 0) {
        await this.registerRepositoryFiles(repositoryResult, context);
      }
      repositoryResult.status = summarizeRepositoryStatus(repositoryResult);
      repositories.push(repositoryResult);
    }

    const summary = summarizeBatch(repositories);
    const result = {
      ok: true as const,
      value: {
        repositories,
        summary,
      } satisfies ImportHuggingFaceFilesSuccessValue,
      requestId: context.requestId,
      correlationId: context.correlationId,
    };

    await this.logging.log({
      timestamp: this.now(),
      level: summary.failed > 0 ? "warn" : "info",
      verbosity: "normal",
      event: "application.huggingface.files-import.finished",
      message: "Finished Hugging Face file import batch.",
      component: "application.use-cases",
      operation: "huggingface.files.import",
      useCase: "ImportHuggingFaceFilesUseCase",
      requestId: context.requestId,
      correlationId: context.correlationId,
      outcome: summary.failed > 0 ? "failure" : "success",
      durationMs: Date.now() - startedAt,
      data: summary,
    });

    return result;
  }

  private async browseRepositoryFiles(
    selection: ImportHuggingFaceRepositorySelection,
    context: ApplicationRequestContext,
  ): Promise<ImportHuggingFaceRepositoryResult> {
    const result = await this.browseFiles.execute({
      repository: selection.repository,
      revision: selection.revision,
    }, context);

    if (!result.ok) {
      return {
        repository: selection.repository,
        revision: selection.revision ?? "main",
        status: "failed",
        files: [],
        code: normalizeImportErrorCode(result.error.code),
        message: result.error.message,
      };
    }

    return {
      repository: result.value.repository,
      revision: result.value.revision,
      status: "failed",
      files: result.value.files.map((file) => ({
        repository: file.repository,
        path: file.path,
        revision: file.revision,
        status: "failed",
      })),
    };
  }

  private async registerRepositoryFiles(
    repositoryResult: ImportHuggingFaceRepositoryResult,
    context: ApplicationRequestContext,
  ): Promise<void> {
    for (const file of repositoryResult.files) {
      const result = await this.registerArtifact.execute({
        target: {
          provider: "huggingface",
          repository: file.repository,
          path: file.path,
          revision: file.revision,
        },
        mediaType: file.mediaType,
      }, context);

      if (result.ok) {
        file.status = "registered";
        file.artifactId = result.value.artifactId;
        file.message = undefined;
        file.code = undefined;
      } else {
        file.status = "failed";
        file.code = normalizeImportErrorCode(result.error.code);
        file.message = result.error.message;
      }
    }
  }
}

function normalizeRepositorySelections(
  selections: ImportHuggingFaceRepositorySelection[],
): ImportHuggingFaceRepositorySelection[] {
  const byKey = new Map<string, ImportHuggingFaceRepositorySelection>();
  for (const selection of selections) {
    const repository = selection.repository?.trim();
    const revision = selection.revision?.trim() || "main";
    if (!repository) {
      continue;
    }
    byKey.set(repositoryKey(repository, revision), { repository, revision });
  }
  return [...byKey.values()];
}

function normalizeFileSelections(
  selections: ImportHuggingFaceFileSelection[],
): ImportHuggingFaceFileSelection[] {
  const byKey = new Map<string, ImportHuggingFaceFileSelection>();
  for (const selection of selections) {
    const repository = selection.repository?.trim();
    const path = selection.path?.trim();
    const revision = selection.revision?.trim() || "main";
    const mediaType = selection.mediaType?.trim() || undefined;
    if (!repository || !path) {
      continue;
    }
    byKey.set(`${repositoryKey(repository, revision)}:${path}`, { repository, path, revision, mediaType });
  }
  return [...byKey.values()];
}

function repositoryKey(repository: string, revision?: string): string {
  return `${repository.trim()}@${revision?.trim() || "main"}`;
}

function summarizeRepositoryStatus(
  result: ImportHuggingFaceRepositoryResult,
): "succeeded" | "partial" | "failed" {
  if (result.files.length === 0) {
    return "failed";
  }
  const succeeded = result.files.filter((file) => file.status === "registered").length;
  if (succeeded === result.files.length) {
    return "succeeded";
  }
  return succeeded > 0 ? "partial" : "failed";
}

function summarizeBatch(repositories: ImportHuggingFaceRepositoryResult[]): ImportHuggingFaceFilesSuccessValue["summary"] {
  const files = repositories.flatMap((repository) => repository.files);
  const succeeded = files.filter((file) => file.status === "registered").length;
  return {
    attempted: files.length,
    succeeded,
    failed: files.length - succeeded + repositories.filter((repository) => repository.files.length === 0 && repository.status === "failed").length,
  };
}

function normalizeImportErrorCode(code: string): "validation" | "not-found" | "unavailable" | "internal" {
  return code === "validation" || code === "not-found" || code === "unavailable" ? code : "internal";
}
