import type { ApplicationRequestContext } from "../application-request-context";

export interface HuggingFaceDatasetDescriptor {
  namespace: string;
  repository: string;
}

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
        datasets: HuggingFaceDatasetDescriptor[];
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
