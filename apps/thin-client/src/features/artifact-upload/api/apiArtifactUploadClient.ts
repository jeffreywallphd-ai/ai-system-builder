import { secureFetch } from "../../../security/secureFetch";
import { parseApiEnvelope, toThinClientApiError } from "../../../security/apiErrorEnvelope";
export interface ThinClientArtifactUploadInput {
  fileName: string;
  mediaType: string;
  bytes: Uint8Array;
  source?: string;
  workspaceId: string;
}

export interface ThinClientArtifactUploadAcceptedTypePolicy {
  acceptedMediaTypes: readonly string[];
  acceptedExtensions: readonly string[];
}

export interface ThinClientArtifactUploadSuccessResult {
  ok: true;
  value: {
    descriptor: {
      key: string;
      mediaType?: string;
      sizeBytes?: number;
    };
  };
}

export interface ThinClientArtifactUploadFailureResult {
  ok: false;
  error: {
    code: string;
    message: string;
  };
}

export type ThinClientArtifactUploadResult =
  | ThinClientArtifactUploadSuccessResult
  | ThinClientArtifactUploadFailureResult;

export type ThinClientWebsiteIngestionMode = "automatic" | "rendered";

export interface ThinClientWebsitePageIngestionResult {
  target: {
    url: string;
    label?: string;
  };
  resolvedUrl: string;
  acquisitionMechanismUsed: "simple-http" | "rendered-browser";
  stagedArtifact?: {
    sourceKind?: string;
    originalName?: string;
    storage: {
      key: string;
      mediaType?: string;
      sizeBytes?: number;
    };
  };
  warnings?: string[];
}

export interface ThinClientWebsitePagesBatchSummary {
  attempted: number;
  succeeded: number;
  failed: number;
}

export interface ThinClientWebsitePagesBatchItem {
  target: {
    url: string;
    label?: string;
  };
  ok: boolean;
  result?: ThinClientWebsitePageIngestionResult;
  error?: {
    code: string;
    message: string;
  };
}

export type ThinClientWebsitePageIngestionClientResult =
  | { ok: true; value: ThinClientWebsitePageIngestionResult }
  | ThinClientArtifactUploadFailureResult;

export type ThinClientWebsitePagesBatchIngestionClientResult =
  | { ok: true; value: { items: ThinClientWebsitePagesBatchItem[]; summary: ThinClientWebsitePagesBatchSummary } }
  | ThinClientArtifactUploadFailureResult;

interface ApiResponseEnvelope {
  ok: boolean;
  value?: {
    descriptor?: {
      storage?: {
        key?: string;
        mediaType?: string;
        sizeBytes?: number;
      };
    };
    policy?: ThinClientArtifactUploadAcceptedTypePolicy;
    result?: unknown;
  };
  error?: {
    code?: string;
    message?: string;
  };
}

export interface ApiArtifactUploadClient {
  uploadArtifact: (input: ThinClientArtifactUploadInput) => Promise<ThinClientArtifactUploadResult>;
  getAcceptedTypes: () => Promise<ThinClientArtifactUploadAcceptedTypePolicy>;
  ingestWebsitePage?: (input: {
    url: string;
    label?: string;
    mode?: ThinClientWebsiteIngestionMode;
    workspaceId: string;
  }) => Promise<ThinClientWebsitePageIngestionClientResult>;
  ingestWebsitePagesBatch?: (input: {
    targets: Array<{ url: string; label?: string }>;
    mode?: ThinClientWebsiteIngestionMode;
    workspaceId: string;
  }) => Promise<ThinClientWebsitePagesBatchIngestionClientResult>;
}

export interface CreateApiArtifactUploadClientOptions {
  apiBaseUrl?: string;
}

const DEFAULT_UPLOAD_SOURCE = "thin-client.artifact-upload.form";

function isApiResponseEnvelope(value: unknown): value is ApiResponseEnvelope {
  try { parseApiEnvelope(value); return true; } catch { return false; }
}

function createUploadUrl(apiBaseUrl: string): string {
  const trimmedBaseUrl = apiBaseUrl.trim();
  const baseUrl = trimmedBaseUrl.length > 0 ? trimmedBaseUrl : "/api";
  return `${baseUrl.replace(/\/+$/, "")}/artifact/upload`;
}

function createUploadPolicyUrl(apiBaseUrl: string): string {
  return `${createUploadUrl(apiBaseUrl)}/policy`;
}

function createWebsitePageIngestionUrl(apiBaseUrl: string): string {
  const trimmedBaseUrl = apiBaseUrl.trim();
  const baseUrl = trimmedBaseUrl.length > 0 ? trimmedBaseUrl : "/api";
  return `${baseUrl.replace(/\/+$/, "")}/artifact/ingest-website-page`;
}

function createWebsitePagesBatchIngestionUrl(apiBaseUrl: string): string {
  const trimmedBaseUrl = apiBaseUrl.trim();
  const baseUrl = trimmedBaseUrl.length > 0 ? trimmedBaseUrl : "/api";
  return `${baseUrl.replace(/\/+$/, "")}/artifact/ingest-website-pages-batch`;
}

async function readApiResponseBody(response: Response): Promise<unknown> {
  try {
    return (await response.json()) as unknown;
  } catch {
    return undefined;
  }
}

function toRendererResult(responseBody: unknown): ThinClientArtifactUploadResult {
  if (!isApiResponseEnvelope(responseBody)) {
    return {
      ok: false,
      error: {
        code: "internal",
        message: "Artifact upload failed.",
      },
    };
  }

  if (responseBody.ok && responseBody.value?.descriptor?.storage?.key) {
    return {
      ok: true,
      value: {
        descriptor: {
          key: responseBody.value.descriptor.storage.key,
          mediaType: responseBody.value.descriptor.storage.mediaType,
          sizeBytes: responseBody.value.descriptor.storage.sizeBytes,
        },
      },
    };
  }

  return {
    ok: false,
    error: {
      code: responseBody.error?.code ?? "internal",
      message: responseBody.error?.message ?? "Artifact upload failed.",
    },
  };
}

function toWebsitePageIngestionResult(responseBody: unknown): ThinClientWebsitePageIngestionClientResult {
  if (!isApiResponseEnvelope(responseBody)) {
    return { ok: false, error: { code: "internal", message: "Website ingestion failed." } };
  }

  if (!responseBody.ok) {
    return {
      ok: false,
      error: {
        code: responseBody.error?.code ?? "internal",
        message: responseBody.error?.message ?? "Website ingestion failed.",
      },
    };
  }

  const result = (responseBody.value as { result?: ThinClientWebsitePageIngestionResult } | undefined)?.result;
  if (!result) {
    return { ok: false, error: { code: "internal", message: "Website ingestion response missing result payload." } };
  }

  return { ok: true, value: result };
}

function toBatchItem(item: unknown): ThinClientWebsitePagesBatchItem | undefined {
  if (!item || typeof item !== "object") {
    return undefined;
  }

  const value = item as {
    target?: { url?: string; label?: string };
    ok?: boolean;
    result?: ThinClientWebsitePageIngestionResult | { ok?: boolean; value?: ThinClientWebsitePageIngestionResult; error?: { code?: string; message?: string } };
    error?: { code?: string; message?: string };
  };

  const target = value.target?.url ? { url: value.target.url, label: value.target.label } : undefined;
  if (!target) {
    return undefined;
  }

  if (typeof value.ok === "boolean") {
    return {
      target,
      ok: value.ok,
      result: value.result as ThinClientWebsitePageIngestionResult | undefined,
      error: value.error?.message ? { code: value.error.code ?? "internal", message: value.error.message } : undefined,
    };
  }

  const contractResult = value.result as { ok?: boolean; value?: ThinClientWebsitePageIngestionResult; error?: { code?: string; message?: string } } | undefined;
  if (contractResult?.ok) {
    return { target, ok: true, result: contractResult.value };
  }

  return {
    target,
    ok: false,
    error: {
      code: contractResult?.error?.code ?? "internal",
      message: contractResult?.error?.message ?? "Website ingestion failed.",
    },
  };
}

function toWebsitePagesBatchIngestionResult(responseBody: unknown): ThinClientWebsitePagesBatchIngestionClientResult {
  if (!isApiResponseEnvelope(responseBody)) {
    return { ok: false, error: { code: "internal", message: "Website batch ingestion failed." } };
  }

  if (!responseBody.ok) {
    return {
      ok: false,
      error: {
        code: responseBody.error?.code ?? "internal",
        message: responseBody.error?.message ?? "Website batch ingestion failed.",
      },
    };
  }

  const result = (responseBody.value as { result?: { items?: unknown[]; summary?: ThinClientWebsitePagesBatchSummary } } | undefined)?.result;
  const items = result?.items?.map(toBatchItem).filter((item): item is ThinClientWebsitePagesBatchItem => Boolean(item)) ?? [];
  if (!result?.summary) {
    return { ok: false, error: { code: "internal", message: "Website batch ingestion response missing result payload." } };
  }

  return { ok: true, value: { items, summary: result.summary } };
}

function copyToArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return copy.buffer;
}

function createUploadFormData(input: ThinClientArtifactUploadInput): FormData {
  const formData = new FormData();
  const file = new File([copyToArrayBuffer(input.bytes)], input.fileName, { type: input.mediaType });

  formData.append("file", file);
  formData.append("source", input.source ?? DEFAULT_UPLOAD_SOURCE);
  formData.append("workspaceId", input.workspaceId);

  return formData;
}

export function createApiArtifactUploadClient(
  options: CreateApiArtifactUploadClientOptions = {},
): ApiArtifactUploadClient {
  const apiBaseUrl = options.apiBaseUrl ?? "/api";
  const uploadUrl = createUploadUrl(apiBaseUrl);
  const uploadPolicyUrl = createUploadPolicyUrl(apiBaseUrl);
  const websitePageIngestionUrl = createWebsitePageIngestionUrl(apiBaseUrl);
  const websitePagesBatchIngestionUrl = createWebsitePagesBatchIngestionUrl(apiBaseUrl);

  return {
    async uploadArtifact(input: ThinClientArtifactUploadInput): Promise<ThinClientArtifactUploadResult> {
      if (!input.workspaceId?.trim()) {
        return { ok: false, error: { code: "validation", message: "Workspace id is required for artifact upload." } };
      }

      const response = await secureFetch(uploadUrl, {
        method: "POST",
        body: createUploadFormData(input),
      });

      const responseBody = await readApiResponseBody(response);
      if (!response.ok && !isApiResponseEnvelope(responseBody)) {
        const err = toThinClientApiError(response.status, uploadUrl);
        return { ok: false, error: { code: err.code ?? "internal", message: err.message } };
      }

      return toRendererResult(responseBody);
    },

    async getAcceptedTypes(): Promise<ThinClientArtifactUploadAcceptedTypePolicy> {
      const response = await secureFetch(uploadPolicyUrl);
      const responseBody = await readApiResponseBody(response);
      if (!isApiResponseEnvelope(responseBody) || !responseBody.ok || !responseBody.value?.policy) {
        throw new Error("Failed to read accepted artifact upload types.");
      }

      return responseBody.value.policy;
    },

    async ingestWebsitePage(input): Promise<ThinClientWebsitePageIngestionClientResult> {
      if (!input.workspaceId?.trim()) {
        return { ok: false, error: { code: "validation", message: "Workspace id is required for website ingestion." } };
      }

      const response = await secureFetch(websitePageIngestionUrl, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          workspaceId: input.workspaceId,
          source: "thin-client.artifact-upload.website-scrape",
          request: {
            url: input.url,
            label: input.label,
            mode: input.mode,
          },
        }),
      });
      const responseBody = await readApiResponseBody(response);
      if (!response.ok && !isApiResponseEnvelope(responseBody)) {
        const err = toThinClientApiError(response.status, websitePageIngestionUrl);
        return { ok: false, error: { code: err.code ?? "internal", message: err.message } };
      }

      return toWebsitePageIngestionResult(responseBody);
    },

    async ingestWebsitePagesBatch(input): Promise<ThinClientWebsitePagesBatchIngestionClientResult> {
      if (!input.workspaceId?.trim()) {
        return { ok: false, error: { code: "validation", message: "Workspace id is required for website ingestion." } };
      }

      const response = await secureFetch(websitePagesBatchIngestionUrl, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          workspaceId: input.workspaceId,
          source: "thin-client.artifact-upload.website-scrape",
          request: {
            targets: input.targets,
            mode: input.mode,
          },
        }),
      });
      const responseBody = await readApiResponseBody(response);
      if (!response.ok && !isApiResponseEnvelope(responseBody)) {
        const err = toThinClientApiError(response.status, websitePagesBatchIngestionUrl);
        return { ok: false, error: { code: err.code ?? "internal", message: err.message } };
      }

      return toWebsitePagesBatchIngestionResult(responseBody);
    },
  };
}
