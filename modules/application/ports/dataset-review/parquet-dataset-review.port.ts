import type {
  DatasetReviewPageSize,
  DatasetReviewRow,
} from "../../../contracts/dataset";
import type { WorkspaceId } from "../../../contracts/workspace";

export interface ParquetDatasetReviewPort {
  readPage(input: {
    readonly workspaceId: WorkspaceId;
    readonly content: Uint8Array;
    readonly page: number;
    readonly pageSize: DatasetReviewPageSize;
  }): Promise<{
    readonly totalRows: number;
    readonly rows: readonly DatasetReviewRow[];
  }>;
  rejectRow(input: {
    readonly workspaceId: WorkspaceId;
    readonly content: Uint8Array;
    readonly rowIndex: number;
    readonly rowFingerprint: `sha256:${string}`;
  }): Promise<{ readonly content: Uint8Array; readonly totalRows: number }>;
  replaceRow(input: {
    readonly workspaceId: WorkspaceId;
    readonly content: Uint8Array;
    readonly rowIndex: number;
    readonly rowFingerprint: `sha256:${string}`;
    readonly values: Readonly<Record<string, unknown>>;
  }): Promise<{ readonly content: Uint8Array; readonly totalRows: number }>;
}
