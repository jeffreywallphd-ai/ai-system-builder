export interface ThinClientArtifactUploadInput {
  fileName: string;
  mediaType: string;
  bytes: Uint8Array;
  source?: string;
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
  };
  error?: {
    code?: string;
    message?: string;
  };
}

export interface ApiArtifactUploadClient {
  uploadArtifact: (input: ThinClientArtifactUploadInput) => Promise<ThinClientArtifactUploadResult>;
  getAcceptedTypes: () => Promise<ThinClientArtifactUploadAcceptedTypePolicy>;
}

export interface CreateApiArtifactUploadClientOptions {
  apiBaseUrl?: string;
}

const DEFAULT_UPLOAD_SOURCE = "thin-client.artifact-upload.form";

function isApiResponseEnvelope(value: unknown): value is ApiResponseEnvelope {
  return typeof value === "object" && value !== null && "ok" in value;
}

function createUploadUrl(apiBaseUrl: string): string {
  const trimmedBaseUrl = apiBaseUrl.trim();
  const baseUrl = trimmedBaseUrl.length > 0 ? trimmedBaseUrl : "/api";
  return `${baseUrl.replace(/\/+$/, "")}/artifact/upload`;
}

function createUploadPolicyUrl(apiBaseUrl: string): string {
  return `${createUploadUrl(apiBaseUrl)}/policy`;
}

function createHttpErrorMessage(response: Response): string {
  const normalizedStatusText = response.statusText.trim();
  if (normalizedStatusText.length > 0) {
    return `Artifact upload failed (${response.status} ${normalizedStatusText}).`;
  }

  return `Artifact upload failed (HTTP ${response.status}).`;
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

function createUploadFormData(input: ThinClientArtifactUploadInput): FormData {
  const formData = new FormData();
  const file = new File([input.bytes], input.fileName, { type: input.mediaType });

  formData.append("file", file);
  formData.append("source", input.source ?? DEFAULT_UPLOAD_SOURCE);

  return formData;
}

export function createApiArtifactUploadClient(
  options: CreateApiArtifactUploadClientOptions = {},
): ApiArtifactUploadClient {
  const apiBaseUrl = options.apiBaseUrl ?? "/api";
  const uploadUrl = createUploadUrl(apiBaseUrl);
  const uploadPolicyUrl = createUploadPolicyUrl(apiBaseUrl);

  return {
    async uploadArtifact(input: ThinClientArtifactUploadInput): Promise<ThinClientArtifactUploadResult> {
      const response = await fetch(uploadUrl, {
        method: "POST",
        body: createUploadFormData(input),
      });

      const responseBody = await readApiResponseBody(response);
      if (!response.ok && !isApiResponseEnvelope(responseBody)) {
        return {
          ok: false,
          error: {
            code: "internal",
            message: createHttpErrorMessage(response),
          },
        };
      }

      return toRendererResult(responseBody);
    },

    async getAcceptedTypes(): Promise<ThinClientArtifactUploadAcceptedTypePolicy> {
      const response = await fetch(uploadPolicyUrl);
      const responseBody = await readApiResponseBody(response);
      if (!isApiResponseEnvelope(responseBody) || !responseBody.ok || !responseBody.value?.policy) {
        throw new Error("Failed to read accepted artifact upload types.");
      }

      return responseBody.value.policy;
    },
  };
}
