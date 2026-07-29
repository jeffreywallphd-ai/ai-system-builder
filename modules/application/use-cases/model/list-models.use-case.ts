import {
  normalizeListModelsRequest,
  normalizeListModelsResult,
  type ListModelsRequest,
  type ListModelsResult,
} from "../../../contracts/model";
import type { ModelRegistryPort } from "../../ports/model";

class ListModelsExecutionStageError extends Error {
  public readonly code: string;

  public constructor(code: string, cause: unknown) {
    super("The model list operation failed at a bounded execution stage.");
    this.name = "ListModelsExecutionStageError";
    this.code = code;
    Object.defineProperty(this, "cause", {
      value: cause,
      enumerable: false,
      configurable: true,
    });
  }
}

export class ListModelsUseCase {
  public constructor(
    private readonly dependencies: { modelRegistry: ModelRegistryPort },
  ) {}

  public async execute(request: ListModelsRequest): Promise<ListModelsResult> {
    let normalizedRequest: ListModelsRequest;
    try {
      normalizedRequest = normalizeListModelsRequest(request);
    } catch (error) {
      throw new ListModelsExecutionStageError(
        "MODEL_LIST_REQUEST_INVALID",
        error,
      );
    }

    let result: ListModelsResult;
    try {
      result =
        await this.dependencies.modelRegistry.listModels(normalizedRequest);
    } catch (error) {
      throw new ListModelsExecutionStageError(
        "MODEL_LIST_REGISTRY_FAILED",
        error,
      );
    }

    try {
      return normalizeListModelsResult(result);
    } catch (error) {
      throw new ListModelsExecutionStageError(
        "MODEL_LIST_RESULT_INVALID",
        error,
      );
    }
  }
}
