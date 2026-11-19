import {createHash} from "node:crypto";
import {types} from "node:util";
import {copyBoundedPassiveData, readStrictPassiveRecord} from "../../../../contracts/shared";
import {readModelDownloadSource, normalizeModelDownloadRevision, type ModelDownloadSource} from "../../../../contracts/model";

export interface RuntimeModelDownloadManifest {
  readonly source: ModelDownloadSource;
  readonly manifestDigest: string;
}
const invalid = () => new Error("The selected model source manifest is invalid.");
export function freezeCapturedModelData<T>(value: T): T {
  if (value && typeof value === "object") {
    for (const child of Object.values(value)) freezeCapturedModelData(child);
    Object.freeze(value);
  }
  return value;
}

/** Presence is strict; caller objects cannot change the source while capability checks wait. */
export function captureModelManifestPayload<T>(input: T): {payload: T; manifest?: RuntimeModelDownloadManifest} {
  if (!input || typeof input !== "object") return {payload: input};
  if (types.isProxy(input)) throw invalid();
  const property = Object.getOwnPropertyDescriptor(input, "sourceManifest");
  if (!property) {
    if ("sourceManifest" in input) throw invalid();
    return {payload: input};
  }
  if (!("value" in property)) throw invalid();
  try {
    const raw = copyBoundedPassiveData(input) as Record<string, unknown>;
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
