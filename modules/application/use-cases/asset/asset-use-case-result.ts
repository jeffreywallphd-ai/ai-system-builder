import type { AssetMetadata } from "../../../contracts/asset";
import type { AssetValidationResult } from "../../services/asset";

export type AssetUseCaseErrorCode = "not-found" | "validation-failed" | "conflict" | "invalid-reference" | "internal";

export interface AssetUseCaseResult<T> {
  readonly ok: boolean;
  readonly value?: T;
  readonly validation?: AssetValidationResult;
  readonly error?: {
    readonly code: AssetUseCaseErrorCode;
    readonly message: string;
    readonly details?: AssetMetadata;
  };
}
