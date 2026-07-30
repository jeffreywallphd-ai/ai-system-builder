import type { ModelPublisherPort } from "../../../application/ports/model";
import type { PublishModelRequest, PublishModelResult } from "../../../contracts/model";
import {
  listContainedFiles,
  readContainedFile,
  resolveApprovedDirectory,
} from "../../filesystem-security";

interface HuggingFaceUploadClient {
  uploadFile(params: {
    repo: string;
    path: string;
    content: Uint8Array;
    token?: string;
    revision?: string;
    private?: boolean;
  }): Promise<void>;
}

interface HuggingFaceCreateRepoResponse {
  ok: boolean;
  status: number;
  statusText: string;
}

type HuggingFaceFetchImplementation = (
  input: string,
  init?: {
    method?: string;
    headers?: Record<string, string>;
    body?: string;
  },
) => Promise<HuggingFaceCreateRepoResponse>;

export interface CreateHuggingFaceModelPublisherAdapterOptions {
  client: HuggingFaceUploadClient;
  tokenProvider?: () => string | undefined;
  fetchImplementation?: HuggingFaceFetchImplementation;
  hubBaseUrl?: string;
  approvedModelRoots: readonly string[];
  maximumFileCount?: number;
  maximumTotalBytes?: number;
}

function isAllowlistedModelFile(file: string): boolean {
  const normalized = file.toLowerCase();
  return normalized === ".gitattributes"
    || normalized === "readme.md"
    || normalized.endsWith(".json")
    || normalized.endsWith(".safetensors")
    || normalized.endsWith(".model")
    || normalized.endsWith(".tiktoken")
    || normalized.endsWith(".txt");
}

function validatePublishLayout(files: string[], fileContentByPath: ReadonlyMap<string, string>): void {
  const fileSet = new Set(files.map((file) => file.replace(/^\.\//, "")));
  const hasAdapterConfig = fileSet.has("adapter_config.json");
  const hasAdapterModel = fileSet.has("adapter_model.safetensors");
  const hasDiffusersLoraModel = fileSet.has("pytorch_lora_weights.safetensors");
  const hasAdapterWeights = hasAdapterModel || hasDiffusersLoraModel;
  const hasShardIndex = fileSet.has("model.safetensors.index.json");
  const shardFiles = files.filter((file) => /model-\d{5}-of-\d{5}\.safetensors$/.test(file));
  const hasSingleModelSafetensors = fileSet.has("model.safetensors");
  const hasConfig = fileSet.has("config.json");

  if (hasAdapterConfig || hasAdapterWeights) {
    if (!hasAdapterConfig || !hasAdapterWeights) {
      throw new Error("Publishing adapter outputs requires adapter_config.json and adapter safetensors weights.");
    }
    return;
  }

  if (shardFiles.length > 0 && !hasShardIndex) {
    throw new Error("Publishing sharded full model outputs requires model.safetensors.index.json.");
  }

  if (hasShardIndex) {
    if (!hasConfig) {
      throw new Error("Publishing full model outputs requires config.json.");
    }
    const indexFile = files.find((file) => file.replace(/^\.\//, "") === "model.safetensors.index.json");
    if (!indexFile) {
      throw new Error("Publishing sharded full model outputs requires model.safetensors.index.json.");
    }
    const indexContent = fileContentByPath.get(indexFile);
    if (!indexContent) {
      throw new Error("Publishing sharded full model outputs requires a readable model.safetensors.index.json.");
    }
    let parsed: { weight_map?: Record<string, string> };
    try {
      parsed = JSON.parse(indexContent) as { weight_map?: Record<string, string> };
    } catch {
      throw new Error("Publishing sharded full model outputs requires a valid model.safetensors.index.json.");
    }
    const referencedShards = new Set(Object.values(parsed.weight_map ?? {}));
    for (const shard of referencedShards) {
      if (!fileSet.has(shard)) {
        throw new Error(`Publishing rejected: missing shard file referenced by index: ${shard}`);
      }
    }
    return;
  }

  if (!hasSingleModelSafetensors) {
    throw new Error("Publishing full model outputs requires model.safetensors or a valid shard index.");
  }
  if (!hasConfig) {
    throw new Error("Publishing full model outputs requires config.json.");
  }
}

function mapError(error: unknown): Error {
  const value = error as { statusCode?: number; status?: number; message?: string };
  const status = value.statusCode ?? value.status;
  if (status === 401 || status === 403) {
    return new Error("Hugging Face publish failed: unauthorized.");
  }
  if (status === 404) {
    return new Error("Hugging Face publish failed: repository not found.");
  }
  if (status === 429) {
    return new Error("Hugging Face publish failed: rate limited.");
  }
  return new Error(`Hugging Face publish failed: ${value.message ?? String(error)}`);
}

function isRepositoryMissingStatus(error: unknown): boolean {
  const value = error as { statusCode?: number; status?: number };
  const status = value.statusCode ?? value.status;
  return status === 404;
}

function resolveRepositoryIdentity(repository: string): { namespace: string; name: string } {
  const [namespace, ...nameSegments] = repository.split("/");
  const name = nameSegments.join("/");
  if (!namespace?.trim() || !name.trim()) {
    throw new Error("Hugging Face publish failed: repository must include namespace and name (owner/repo).");
  }
  return {
    namespace: namespace.trim(),
    name: name.trim(),
  };
}

async function createModelRepositoryIfMissing(
  repository: string,
  token: string,
  privateRepository: boolean,
  fetchImplementation: HuggingFaceFetchImplementation,
  hubBaseUrl: string,
): Promise<void> {
  const identity = resolveRepositoryIdentity(repository);
  const response = await fetchImplementation(`${hubBaseUrl}/api/repos/create`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      name: identity.name,
      organization: identity.namespace,
      type: "model",
      private: privateRepository,
    }),
  });

  if (response.ok || response.status === 409) {
    return;
  }

  throw mapError({ status: response.status, message: response.statusText });
}

export function createHuggingFaceModelPublisherAdapter(
  options: CreateHuggingFaceModelPublisherAdapterOptions,
): ModelPublisherPort {
  const hubBaseUrl = options.hubBaseUrl?.replace(/\/$/, "") ?? "https://huggingface.co";
  const maximumFileCount = options.maximumFileCount ?? 512;
  const maximumTotalBytes = options.maximumTotalBytes ?? 20 * 1024 * 1024 * 1024;
  const maybeFetchImplementation = options.fetchImplementation
    ?? (globalThis as { fetch?: HuggingFaceFetchImplementation }).fetch;

  return {
    async publishModel(request: PublishModelRequest & { modelPath: string }): Promise<PublishModelResult> {
      const token = request.token ?? options.tokenProvider?.();
      if (options.approvedModelRoots.length === 0) {
        throw new Error("Hugging Face publish failed: no approved model storage root is configured.");
      }
      const approvedDirectory = await resolveApprovedDirectory({
        allowedRoots: options.approvedModelRoots,
        candidateDirectory: request.modelPath,
      });
      const files = await listContainedFiles({
        rootDirectory: approvedDirectory.rootDirectory,
        prefix: approvedDirectory.relativeKey || undefined,
        rejectUnsafeEntries: true,
      });
      if (files.length === 0 || files.length > maximumFileCount) {
        throw new Error(`Hugging Face publish failed: model file count must be between 1 and ${maximumFileCount}.`);
      }
      const disallowedFile = files.find((file) => !isAllowlistedModelFile(file));
      if (disallowedFile) {
        throw new Error(`Hugging Face publish failed: model file is not allowlisted: ${disallowedFile}`);
      }

      const storageKeyFor = (file: string) => approvedDirectory.relativeKey
        ? `${approvedDirectory.relativeKey}/${file}`
        : file;
      const textFiles = new Map<string, string>();
      const retainedContent = new Map<string, Uint8Array>();
      if (files.includes("model.safetensors.index.json")) {
        const indexFile = await readContainedFile({
          rootDirectory: approvedDirectory.rootDirectory,
          key: storageKeyFor("model.safetensors.index.json"),
          maximumBytes: 4 * 1024 * 1024,
        });
        retainedContent.set("model.safetensors.index.json", indexFile.content);
        textFiles.set("model.safetensors.index.json", new TextDecoder().decode(indexFile.content));
      }
      validatePublishLayout(files, textFiles);

      let totalBytes = 0;
      for (const file of files) {
        const content = retainedContent.get(file) ?? (await readContainedFile({
          rootDirectory: approvedDirectory.rootDirectory,
          key: storageKeyFor(file),
          maximumBytes: maximumTotalBytes,
        })).content;
        totalBytes += content.byteLength;
        if (totalBytes > maximumTotalBytes) {
          throw new Error(`Hugging Face publish failed: model exceeds the ${maximumTotalBytes}-byte publication limit.`);
        }
        const remotePath = `${request.pathPrefix ? `${request.pathPrefix.replace(/\/$/, "")}/` : ""}${file}`;
        try {
          await options.client.uploadFile({
            repo: request.repository,
            path: remotePath,
            content,
            token,
            revision: request.revision,
            private: request.private,
          });
        } catch (error) {
          if (isRepositoryMissingStatus(error)) {
            if (!token?.trim()) {
              throw new Error("Hugging Face publish failed: repository not found and no token available for repository creation.");
            }
            if (!maybeFetchImplementation) {
              throw new Error("Hugging Face publish failed: repository not found and fetch implementation is unavailable.");
            }
            await createModelRepositoryIfMissing(
              request.repository,
              token.trim(),
              request.private ?? true,
              maybeFetchImplementation,
              hubBaseUrl,
            );
            await options.client.uploadFile({
              repo: request.repository,
              path: remotePath,
              content,
              token,
              revision: request.revision,
              private: request.private,
            });
            continue;
          }
          throw mapError(error);
        }
      }

      return {
        modelRecordId: request.modelRecordId,
        published: true,
        provider: "huggingface",
        repository: request.repository,
        revision: request.revision,
        url: `https://huggingface.co/${request.repository}`,
      };
    },
  };
}
