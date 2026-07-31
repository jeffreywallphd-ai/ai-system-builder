import {
  normalizeRevealModelInFolderRequest,
  type RevealModelInFolderRequest,
  type RevealModelInFolderResult,
} from "../../../contracts/model";
import type {
  ModelLocationRevealerPort,
  ModelRegistryPort,
} from "../../ports/model";

export type RevealModelInFolderFailureCode = "not-found" | "unavailable";

export class RevealModelInFolderError extends Error {
  public constructor(
    public readonly code: RevealModelInFolderFailureCode,
    message: string,
    cause?: unknown,
  ) {
    super(message);
    this.name = "RevealModelInFolderError";
    if (cause !== undefined) {
      Object.defineProperty(this, "cause", {
        value: cause,
        enumerable: false,
      });
    }
  }
}

export function isRevealModelInFolderError(
  error: unknown,
): error is RevealModelInFolderError {
  return error instanceof RevealModelInFolderError;
}

export class RevealModelInFolderUseCase {
  public constructor(
    private readonly dependencies: {
      modelRegistry: Pick<ModelRegistryPort, "getModelRecord">;
      modelLocationRevealer: ModelLocationRevealerPort;
    },
  ) {}

  public async execute(
    request: RevealModelInFolderRequest,
  ): Promise<RevealModelInFolderResult> {
    const normalizedRequest = normalizeRevealModelInFolderRequest(request);
    const record = await this.dependencies.modelRegistry.getModelRecord(
      normalizedRequest.workspaceId!,
      normalizedRequest.modelRecordId,
    );

    if (!record?.localPath) {
      throw new RevealModelInFolderError(
        "not-found",
        "No local model files are available to open.",
      );
    }

    try {
      await this.dependencies.modelLocationRevealer.revealPath(record.localPath);
    } catch (error) {
      throw new RevealModelInFolderError(
        "unavailable",
        "The model folder could not be opened.",
        error,
      );
    }

    return {
      modelRecordId: normalizedRequest.modelRecordId,
      revealed: true,
    };
  }
}
