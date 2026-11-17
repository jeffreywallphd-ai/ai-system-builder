import type { ApplicationRequestContext } from "../application-request-context";
import type { HuggingFaceDatasetSummary } from "../../../contracts/storage";

export interface HuggingFaceDatasetParquetFileDescriptor {
  repository: string;
  path: string;
  revision: string;
  sizeBytes?: number;
}

export interface HuggingFaceRepoBrowserPort {
  listNamespaceDatasets(
    namespace: string,
    context?: ApplicationRequestContext,
  ): Promise<
    | {
      ok: true;
      value: {
        namespace: string;
        datasets: HuggingFaceDatasetSummary[];
      };
      requestId?: string;
      correlationId?: string;
    }
    | {
      ok: false;
      error: {
        code: "validation" | "not-found" | "unavailable" | "internal";
        message: string;
        details?: Readonly<Record<string, unknown>>;
      };
      requestId?: string;
      correlationId?: string;
    }
  >;

  listDatasetParquetFiles(
    input: { repository: string; revision?: string },
    context?: ApplicationRequestContext,
  ): Promise<
    | {
      ok: true;
      value: {
        repository: string;
        revision: string;
        files: HuggingFaceDatasetParquetFileDescriptor[];
      };
      requestId?: string;
      correlationId?: string;
    }
    | {
      ok: false;
      error: {
        code: "validation" | "not-found" | "unavailable" | "internal";
        message: string;
        details?: Readonly<Record<string, unknown>>;
      };
      requestId?: string;
      correlationId?: string;
    }
  >;
}
