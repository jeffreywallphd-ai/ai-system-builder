import type { ApplicationRequestContext } from "../ports";
import type { LoggingPort } from "../ports/logging";
import type { HuggingFaceRepoBrowserPort } from "../ports/storage";
import { API_HUGGING_FACE_DATASET_PARQUET_FILES_BROWSE_OPERATION } from "../../contracts/api";

export interface BrowseHuggingFaceDatasetParquetFilesCommand {
  repository: string;
  revision?: string;
}

export class BrowseHuggingFaceDatasetParquetFilesUseCase {
  private readonly repoBrowser: HuggingFaceRepoBrowserPort;
  private readonly logging: LoggingPort;
  private readonly now: () => string;

  public constructor(dependencies: {
    repoBrowser: HuggingFaceRepoBrowserPort;
    logging: LoggingPort;
    now?: () => string;
  }) {
    this.repoBrowser = dependencies.repoBrowser;
    this.logging = dependencies.logging;
    this.now = dependencies.now ?? (() => new Date().toISOString());
  }

  public async execute(
    command: BrowseHuggingFaceDatasetParquetFilesCommand,
    context: ApplicationRequestContext = {},
  ) {
    const startedAt = Date.now();
    const repository = command.repository?.trim() ?? "";
    const revision = command.revision?.trim() || "main";

    await this.logging.log({
      timestamp: this.now(),
      level: "info",
      verbosity: "normal",
      event: "application.huggingface.dataset.selected",
      message: "Hugging Face dataset selected.",
      component: "application.use-cases",
      operation: API_HUGGING_FACE_DATASET_PARQUET_FILES_BROWSE_OPERATION,
      useCase: "BrowseHuggingFaceDatasetParquetFilesUseCase",
      requestId: context.requestId,
      correlationId: context.correlationId,
      data: { repository, revision },
    });
    await this.logging.log({
      timestamp: this.now(),
      level: "info",
      verbosity: "normal",
      event: "application.huggingface.dataset-files-browse.started",
      message: "Starting Hugging Face dataset file-list request.",
      component: "application.use-cases",
      operation: API_HUGGING_FACE_DATASET_PARQUET_FILES_BROWSE_OPERATION,
      useCase: "BrowseHuggingFaceDatasetParquetFilesUseCase",
      requestId: context.requestId,
      correlationId: context.correlationId,
      data: { repository, revision },
    });

    const result = await this.repoBrowser.listDatasetParquetFiles({
      repository: command.repository,
      revision: command.revision,
    }, context);
    if (!result.ok) {
      await this.logging.log({
        timestamp: this.now(),
        level: "error",
        verbosity: "normal",
        event: "application.huggingface.dataset-files-browse.failed",
        message: "Hugging Face dataset file-list request failed.",
        component: "application.use-cases",
        operation: API_HUGGING_FACE_DATASET_PARQUET_FILES_BROWSE_OPERATION,
        useCase: "BrowseHuggingFaceDatasetParquetFilesUseCase",
        outcome: "failure",
        durationMs: Date.now() - startedAt,
        requestId: result.requestId ?? context.requestId,
        correlationId: result.correlationId ?? context.correlationId,
        data: { repository, revision },
        error: {
          errorType: "provider",
          errorCode: result.error.code,
          errorMessage: result.error.message,
          details: result.error.details,
        },
      });
      return result;
    }

    await this.logging.log({
      timestamp: this.now(),
      level: "info",
      verbosity: "normal",
      event: "application.huggingface.dataset-files-browse.succeeded",
      message: "Hugging Face dataset file-list request succeeded.",
      component: "application.use-cases",
      operation: API_HUGGING_FACE_DATASET_PARQUET_FILES_BROWSE_OPERATION,
      useCase: "BrowseHuggingFaceDatasetParquetFilesUseCase",
      outcome: "success",
      durationMs: Date.now() - startedAt,
      requestId: result.requestId ?? context.requestId,
      correlationId: result.correlationId ?? context.correlationId,
      data: {
        repository: result.value.repository,
        revision: result.value.revision,
        fileCount: result.value.files.length,
      },
    });

    return result;
  }
}
