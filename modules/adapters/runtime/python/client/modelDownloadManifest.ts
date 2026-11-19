import {createHash} from "node:crypto";
import {types} from "node:util";
import {copyBoundedPassiveData, readStrictPassiveRecord} from "../../../../contracts/shared";
import {readModelDownloadSource, normalizeModelDownloadRevision, type ModelDownloadSource} from "../../../../contracts/model";

export interface RuntimeModelDownloadManifest {
  readonly source: ModelDownloadSource;
  readonly manifestDigest: string;
}
const invalid = () => new Error("The selected model source manifest is invalid.");

/** Reject proxy traps before the shared passive copier inspects nested objects. */
function assertPassiveModelInput(input: unknown): void {
  let nodes = 0;
  const inspect = (value: unknown, depth: number): void => {
    if (++nodes > 4096 || depth > 12) throw invalid();
    if (value === null || typeof value !== "object") return;
    if (types.isProxy(value)) throw invalid();
    const prototype = Object.getPrototypeOf(value);
    if (Array.isArray(value) ? prototype !== Array.prototype : prototype !== Object.prototype && prototype !== null) throw invalid();
    const keys = Reflect.ownKeys(value);
    if (keys.length > (Array.isArray(value) ? 1025 : 128)) throw invalid();
    for (const key of keys) {
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (!descriptor || !("value" in descriptor)) throw invalid();
      inspect(descriptor.value, depth + 1);
    }
  };
  inspect(input, 0);
}
export function freezeCapturedModelData<T>(value: T): T {
  if (value && typeof value === "object") {
    for (const child of Object.values(value)) freezeCapturedModelData(child);
    Object.freeze(value);
  }
  return value;
}

/** Presence is strict; caller objects cannot change the source while capability checks wait. */
export function captureModelManifestPayload<T>(input: T): {payload: T; manifest?: RuntimeModelDownloadManifest} {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw invalid();
  if (types.isProxy(input)) throw invalid();
  // A generic request cannot grant a private source recipient or ACK channel.
  // Inspect descriptors only, including prototypes, without invoking getters
  // or proxy traps; the new private owner will supply its own admitted path.
  let current: object | null = input;
  for (let depth = 0; current !== null; depth++) {
    if (depth >= 32 || types.isProxy(current) || Object.getOwnPropertyDescriptor(current, "sourceTransfer")) throw invalid();
    current = Object.getPrototypeOf(current) as object | null;
  }
  const property = Object.getOwnPropertyDescriptor(input, "sourceManifest");
  if (!property && "sourceManifest" in input || property && !("value" in property)) throw invalid();
  try {
    assertPassiveModelInput(input);
    const raw = copyBoundedPassiveData(input) as Record<string, unknown>;
    if (!property) return {payload: freezeCapturedModelData(raw) as T};
    if (raw.provider !== "transformers" || typeof raw.modelId !== "string" || raw.artifactForm !== undefined && raw.artifactForm !== "full-model") throw invalid();
    const revision = normalizeModelDownloadRevision(raw.revision);
    if (revision === undefined) throw invalid();
    const selected = readStrictPassiveRecord(raw.sourceManifest, ["source", "manifestDigest"]);
    const source = readModelDownloadSource(selected.source, {provider: "huggingface", modelId: raw.modelId, revision});
    const manifestDigest = "sha256:" + createHash("sha256").update(JSON.stringify(source), "utf8").digest("hex");
    if (selected.manifestDigest !== manifestDigest) throw invalid();
    const manifest = {source, manifestDigest};
    return {payload: freezeCapturedModelData({...raw, sourceManifest: manifest}) as T, manifest};
  } catch {throw invalid();}
}

export function captureManifestExpectation(value: unknown): RuntimeModelDownloadManifest {
  try {
    const raw = readStrictPassiveRecord(copyBoundedPassiveData(value), ["source", "manifestDigest"]);
    const source = raw.source as Record<string, unknown>;
    if (!source || typeof source !== "object" || Array.isArray(source)) throw invalid();
    const selected = captureModelManifestPayload({provider: "transformers", modelId: source.modelId,
      revision: source.revision, sourceManifest: raw});
    if (!selected.manifest) throw invalid();
    return selected.manifest;
  } catch {throw invalid();}
}

export function readVerifiedManifestDigest(value: unknown): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "string" || !/^sha256:[a-f0-9]{64}$/.test(value)) throw invalid();
  return value;
}
