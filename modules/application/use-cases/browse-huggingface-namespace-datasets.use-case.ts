import type { ApplicationRequestContext } from "../ports";
import type { LoggingPort } from "../ports/logging";
import type { HuggingFaceRepoBrowserPort } from "../ports/storage";
import { API_HUGGING_FACE_NAMESPACE_DATASETS_BROWSE_OPERATION } from "../../contracts/api";

export interface BrowseHuggingFaceNamespaceDatasetsCommand {
  namespace: string;
}

export class BrowseHuggingFaceNamespaceDatasetsUseCase {
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
    command: BrowseHuggingFaceNamespaceDatasetsCommand,
    context: ApplicationRequestContext = {},
  ) {
    const startedAt = Date.now();
    const namespace = command.namespace?.trim() ?? "";

    await this.logging.log({
      timestamp: this.now(),
      level: "info",
      verbosity: "normal",
      event: "application.huggingface.namespace-browse.started",
      message: "Starting Hugging Face namespace dataset browse request.",
      component: "application.use-cases",
      operation: API_HUGGING_FACE_NAMESPACE_DATASETS_BROWSE_OPERATION,
      useCase: "BrowseHuggingFaceNamespaceDatasetsUseCase",
      requestId: context.requestId,
      correlationId: context.correlationId,
      data: { namespace },
    });

    const result = await this.repoBrowser.listNamespaceDatasets(command.namespace, context);
    if (!result.ok) {
      await this.logging.log({
        timestamp: this.now(),
        level: "error",
        verbosity: "normal",
        event: "application.huggingface.namespace-browse.failed",
        message: "Hugging Face namespace dataset browse request failed.",
        component: "application.use-cases",
        operation: API_HUGGING_FACE_NAMESPACE_DATASETS_BROWSE_OPERATION,
        useCase: "BrowseHuggingFaceNamespaceDatasetsUseCase",
        outcome: "failure",
        durationMs: Date.now() - startedAt,
        requestId: result.requestId ?? context.requestId,
        correlationId: result.correlationId ?? context.correlationId,
        data: { namespace },
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
      event: "application.huggingface.namespace-browse.succeeded",
      message: "Hugging Face namespace dataset browse request succeeded.",
      component: "application.use-cases",
      operation: API_HUGGING_FACE_NAMESPACE_DATASETS_BROWSE_OPERATION,
      useCase: "BrowseHuggingFaceNamespaceDatasetsUseCase",
      outcome: "success",
      durationMs: Date.now() - startedAt,
      requestId: result.requestId ?? context.requestId,
      correlationId: result.correlationId ?? context.correlationId,
      data: { namespace: result.value.namespace, datasetCount: result.value.datasets.length },
    });

    return result;
  }
}
