import {
  normalizeListModelFilesRequest,
  normalizeListModelFilesResult,
  type ListModelFilesRequest,
  type ListModelFilesResult,
} from "../../../contracts/model";
import type { ModelFileListerPort, ModelRegistryPort } from "../../ports/model";

export type ListModelFilesFailureCode = "not-found" | "unavailable";

export class ListModelFilesError extends Error {
  public constructor(
    public readonly code: ListModelFilesFailureCode,
    message: string,
    cause?: unknown,
  ) {
    super(message);
    this.name = "ListModelFilesError";
    if (cause !== undefined) {
      Object.defineProperty(this, "cause", { value: cause, enumerable: false });
    }
  }
}

export class ListModelFilesUseCase {
  public constructor(
    private readonly dependencies: {
      modelRegistry: Pick<ModelRegistryPort, "getModelRecord">;
      modelFileLister: ModelFileListerPort;
    },
  ) {}

  public async execute(request: ListModelFilesRequest): Promise<ListModelFilesResult> {
    const normalizedRequest = normalizeListModelFilesRequest(request);
    const record = await this.dependencies.modelRegistry.getModelRecord(
      normalizedRequest.workspaceId!,
      normalizedRequest.modelRecordId,
    );
    if (!record?.localPath) {
      throw new ListModelFilesError("not-found", "No local model files are available to show.");
    }

    try {
      const listed = await this.dependencies.modelFileLister.listFiles(record.localPath);
      return normalizeListModelFilesResult({
        modelRecordId: normalizedRequest.modelRecordId,
        files: listed.files,
        truncated: listed.truncated,
      });
    } catch (error) {
      throw new ListModelFilesError(
        "unavailable",
        "The model file list could not be loaded.",
        error,
      );
    }
  }
}
