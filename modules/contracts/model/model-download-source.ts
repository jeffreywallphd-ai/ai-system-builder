import {copyBoundedPassiveData, hasKnownPassiveCredential, readStrictPassiveRecord} from "../shared";
import {normalizeModelDownloadRevision} from "./model-management-operations";

export const MAX_MODEL_SOURCE_FILES = 64;
export const MAX_MODEL_SOURCE_BYTES = 20 * 1024 ** 3;
export interface ModelDownloadSourceRequest {
  readonly provider: "huggingface";
  readonly modelId: string;
  readonly revision?: string;
}
export interface ModelDownloadSourceFile {
  readonly path: string;
  readonly sizeBytes: number;
  readonly integrity: {readonly algorithm: "sha256" | "git-blob-sha1"; readonly digest: string};
}
export interface ModelDownloadSource {
  readonly provider: "huggingface";
  readonly modelId: string;
  readonly revision: string;
  readonly format: "transformers-safetensors";
  readonly license: {readonly kind: "provider-declared"; readonly identifier: string} | {readonly kind: "unknown"};
  readonly files: readonly ModelDownloadSourceFile[];
  readonly totalBytes: number;
  readonly excludedFileCount: number;
  readonly sourceVerification: "provider-metadata";
  readonly bytesVerification: "not-checked";
  readonly runtimeReadiness: "not-checked";
}
export const MODEL_SOURCE_ANCILLARY_FILES = Object.freeze(["config.json", "generation_config.json", "tokenizer.json", "tokenizer_config.json",
  "special_tokens_map.json", "added_tokens.json", "tokenizer.model", "vocab.json", "vocab.txt", "merges.txt",
  "model.safetensors.index.json", "chat_template.jinja", "LICENSE", "LICENSE.txt", "LICENSE.md"] as const);
const ancillary = new Set<string>(MODEL_SOURCE_ANCILLARY_FILES);
function invalid(): never {throw new Error("Model source metadata is invalid.");}
function record(raw: unknown, required: readonly string[], optional: readonly string[] = []) {
  const result = readStrictPassiveRecord(raw, [...required, ...optional]);
  if (required.some(key => !Object.prototype.hasOwnProperty.call(result, key))) invalid();
  return result;
}
function modelId(value: unknown): value is string {
  return typeof value === "string" && /^[A-Za-z0-9][A-Za-z0-9._-]{0,95}\/[A-Za-z0-9][A-Za-z0-9._-]{0,95}$/.test(value) &&
    !value.includes("..") && !hasKnownPassiveCredential(value);
}
function filePath(value: unknown): value is string {
  return typeof value === "string" && /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(value) && !value.includes("..") &&
    !/[. ]$/.test(value) && !/^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(value) && !hasKnownPassiveCredential(value) &&
    (ancillary.has(value) || value.endsWith(".safetensors"));
}
export function readModelDownloadSourceRequest(value: unknown): ModelDownloadSourceRequest {
  const input = record(copyBoundedPassiveData(value), ["provider", "modelId"], ["revision"]);
  if (input.provider !== "huggingface" || !modelId(input.modelId)) invalid();
  if ("revision" in input && typeof input.revision !== "string") invalid();
  const revision = normalizeModelDownloadRevision(input.revision);
  return {provider: "huggingface", modelId: input.modelId, ...(revision === undefined ? {} : {revision})};
}
/** Selected source metadata only. These hashes have not been checked against local bytes. */
export function readModelDownloadSource(value: unknown, expected: ModelDownloadSourceRequest): ModelDownloadSource {
  const target = readModelDownloadSourceRequest(expected);
  const source = record(copyBoundedPassiveData(value), ["provider", "modelId", "revision", "format", "license", "files",
    "totalBytes", "excludedFileCount", "sourceVerification", "bytesVerification", "runtimeReadiness"]);
  if (source.provider !== target.provider || source.modelId !== target.modelId || typeof source.revision !== "string" ||
      normalizeModelDownloadRevision(source.revision) !== source.revision ||
      (target.revision !== undefined && source.revision !== target.revision) || source.format !== "transformers-safetensors" ||
      source.sourceVerification !== "provider-metadata" || source.bytesVerification !== "not-checked" || source.runtimeReadiness !== "not-checked" ||
      !Array.isArray(source.files) || source.files.length < 3 || source.files.length > MAX_MODEL_SOURCE_FILES ||
      !Number.isSafeInteger(source.excludedFileCount) || (source.excludedFileCount as number) < 0 || (source.excludedFileCount as number) > 256) invalid();
  const rawLicense = record(source.license, ["kind"], ["identifier"]);
  let license: ModelDownloadSource["license"];
  if (rawLicense.kind === "unknown" && !("identifier" in rawLicense)) license = {kind: "unknown"};
  else if (rawLicense.kind === "provider-declared" && typeof rawLicense.identifier === "string" &&
      /^[A-Za-z0-9][A-Za-z0-9+._-]{0,79}$/.test(rawLicense.identifier) && !hasKnownPassiveCredential(rawLicense.identifier))
    license = {kind: "provider-declared", identifier: rawLicense.identifier};
  else return invalid();
  const files = source.files.map(raw => {
    const file = record(raw, ["path", "sizeBytes", "integrity"]);
    const integrity = record(file.integrity, ["algorithm", "digest"]);
    if (!filePath(file.path) || !Number.isSafeInteger(file.sizeBytes) || (file.sizeBytes as number) < 1 ||
        (file.sizeBytes as number) > MAX_MODEL_SOURCE_BYTES || typeof integrity.digest !== "string" ||
        !(integrity.algorithm === "sha256" && /^[a-f0-9]{64}$/.test(integrity.digest) ||
          integrity.algorithm === "git-blob-sha1" && /^[a-f0-9]{40}$/.test(integrity.digest)) ||
        (file.path.endsWith(".safetensors") && integrity.algorithm !== "sha256")) invalid();
    return {path: file.path, sizeBytes: file.sizeBytes as number,
      integrity: {algorithm: integrity.algorithm, digest: integrity.digest}} as ModelDownloadSourceFile;
  }).sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0);
  const names = files.map(file => file.path.toLowerCase());
  const totalBytes = files.reduce((sum, file) => sum + file.sizeBytes, 0);
  if (new Set(names).size !== names.length || !names.includes("config.json") ||
      !names.some(name => name === "tokenizer.json" || name === "tokenizer.model" || name === "vocab.txt") ||
      !names.some(name => name.endsWith(".safetensors")) || !Number.isSafeInteger(totalBytes) || totalBytes > MAX_MODEL_SOURCE_BYTES ||
      source.totalBytes !== totalBytes) invalid();
  return {provider: target.provider, modelId: target.modelId, revision: source.revision, format: "transformers-safetensors",
    license, files, totalBytes, excludedFileCount: source.excludedFileCount as number,
    sourceVerification: "provider-metadata", bytesVerification: "not-checked", runtimeReadiness: "not-checked"};
}
