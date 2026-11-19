/** Exact private read-only interoperability evidence, never native ownership. */
import {createHmac, timingSafeEqual} from "node:crypto";
import {readStrictPassiveRecord} from "../../../../contracts/shared";
import {capturePassiveModelData} from "./modelDownloadManifest";

export const MODEL_SOURCE_IDENTITY_CAPABILITY = "ensure-model-download.source-identity-v1";
export const MODEL_SOURCE_IDENTITY_VERSION = "model-source-identity-binding-v1";
const DOMAIN = "aisb:model-source-identity:v1\0";
const fail = () => new Error("The model receiver identity could not be confirmed.");
export type RuntimeFilesystemIdentity = readonly [string, string, string, string, string];
export interface ModelSourceIdentityProbeInput {
  readonly phase: "roots" | "snapshot";
  readonly taskId: string; readonly acquisitionId: string; readonly handoffId: string; readonly challenge: string;
}
export interface ModelSourceRuntimeIncarnation {readonly runtimeId: string; readonly workerStartedAt: string;}
export interface ModelSourceRuntimeFileFacts {
  readonly path: string; readonly identity: RuntimeFilesystemIdentity; readonly nlink: number;
  readonly sizeBytes: number; readonly mtimeNs: string; readonly ctimeNs: string;
}
export interface ModelSourceIdentityProof extends ModelSourceIdentityProbeInput, ModelSourceRuntimeIncarnation {
  readonly version: typeof MODEL_SOURCE_IDENTITY_VERSION;
  readonly roots: {readonly acquisition: RuntimeFilesystemIdentity; readonly source: RuntimeFilesystemIdentity; readonly receiver: RuntimeFilesystemIdentity};
  readonly manifestDigest: string | null; readonly files: readonly ModelSourceRuntimeFileFacts[];
}
export interface ModelSourceIdentityEnvelope {readonly proof: ModelSourceIdentityProof; readonly mac: string;}
/** Trusted client closure captures one ALREADY owned launch; it never starts one. */
export interface ModelSourceIdentityProbe extends ModelSourceRuntimeIncarnation {
  readonly assertCurrent: () => void;
  readonly inspect: (input: ModelSourceIdentityProbeInput) => Promise<ModelSourceIdentityEnvelope>;
}
const uuid = (value: unknown) => typeof value === "string" && /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(value);
const integer = (value: unknown, positive = false): value is string => typeof value === "string" &&
  (positive ? /^[1-9][0-9]{0,38}$/ : /^(?:0|[1-9][0-9]{0,38})$/).test(value);
const digest = (value: unknown): value is string => typeof value === "string" && /^sha256:[a-f0-9]{64}$/.test(value);
function record(value: unknown, fields: readonly string[]) {
  const result = readStrictPassiveRecord(value, fields);
  if (Object.keys(result).length !== fields.length) throw fail();
  return result;
}
export function captureModelSourceProbeInput(raw: unknown): ModelSourceIdentityProbeInput {
  try {
    const value = record(capturePassiveModelData(raw), ["phase", "taskId", "acquisitionId", "handoffId", "challenge"]);
    if (!["roots", "snapshot"].includes(value.phase as string) || !uuid(value.taskId) || !uuid(value.acquisitionId) || !uuid(value.handoffId) ||
        typeof value.challenge !== "string" || !/^[a-f0-9]{64}$/.test(value.challenge)) throw fail();
    return capturePassiveModelData(value) as unknown as ModelSourceIdentityProbeInput;
  } catch {throw fail();}
}
export function captureModelSourceRuntime(raw: unknown): ModelSourceRuntimeIncarnation {
  try {
    const value = record(capturePassiveModelData(raw), ["runtimeId", "workerStartedAt"]);
    if (typeof value.runtimeId !== "string" || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(value.runtimeId) ||
        typeof value.workerStartedAt !== "string" || value.workerStartedAt.length > 48 ||
        !/^\d{4}-\d\d-\d\dT[0-9:.]+(?:Z|\+00:00)$/.test(value.workerStartedAt)) throw fail();
    return Object.freeze({runtimeId: value.runtimeId, workerStartedAt: value.workerStartedAt});
  } catch {throw fail();}
}
function filesystemIdentity(raw: unknown): RuntimeFilesystemIdentity {
  if (!Array.isArray(raw) || raw.length !== 5 || raw.some((value, index) => !integer(value, index === 1))) throw fail();
  return Object.freeze([...raw]) as unknown as RuntimeFilesystemIdentity;
}
export function readModelSourceIdentityEnvelope(raw: unknown, expected: ModelSourceIdentityProbeInput,
  runtime: ModelSourceRuntimeIncarnation): ModelSourceIdentityEnvelope {
  try {
    const value = record(capturePassiveModelData(raw), ["proof", "mac"]);
    const p = record(value.proof, ["version", "phase", "taskId", "acquisitionId", "handoffId", "challenge", "runtimeId", "workerStartedAt",
      "roots", "manifestDigest", "files"]);
    if (typeof value.mac !== "string" || !/^[a-f0-9]{64}$/.test(value.mac) || p.version !== MODEL_SOURCE_IDENTITY_VERSION ||
        p.runtimeId !== runtime.runtimeId || p.workerStartedAt !== runtime.workerStartedAt ||
        ["phase", "taskId", "acquisitionId", "handoffId", "challenge"].some(key => p[key] !== expected[key as keyof ModelSourceIdentityProbeInput])) throw fail();
    const r = record(p.roots, ["acquisition", "source", "receiver"]);
    const roots = {acquisition: filesystemIdentity(r.acquisition), source: filesystemIdentity(r.source), receiver: filesystemIdentity(r.receiver)};
    if (!Array.isArray(p.files) || p.files.length > 64 || (expected.phase === "roots" ? p.files.length !== 0 || p.manifestDigest !== null :
        p.files.length < 3 || !digest(p.manifestDigest))) throw fail();
    const files = p.files.map(rawFile => {
      const file = record(rawFile, ["path", "identity", "nlink", "sizeBytes", "mtimeNs", "ctimeNs"]);
      if (typeof file.path !== "string" || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(file.path) || file.path.includes("..") ||
          ![1, 2].includes(file.nlink as number) || !Number.isSafeInteger(file.sizeBytes) || (file.sizeBytes as number) < 1 ||
          (file.sizeBytes as number) > 100 * 1024 * 1024 * 1024 || !integer(file.mtimeNs) || !integer(file.ctimeNs)) throw fail();
      return {path: file.path, identity: filesystemIdentity(file.identity), nlink: file.nlink, sizeBytes: file.sizeBytes,
        mtimeNs: file.mtimeNs, ctimeNs: file.ctimeNs} as ModelSourceRuntimeFileFacts;
    });
    if (new Set(files.map(file => file.path.toLowerCase())).size !== files.length) throw fail();
    return capturePassiveModelData({proof: {...expected, runtimeId: runtime.runtimeId, workerStartedAt: runtime.workerStartedAt,
      version: MODEL_SOURCE_IDENTITY_VERSION, roots,
      manifestDigest: p.manifestDigest as string | null, files}, mac: value.mac});
  } catch {throw fail();}
}
function sorted(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sorted);
  if (value && typeof value === "object") return Object.fromEntries(Object.keys(value).sort().map(key => [key, sorted((value as Record<string, unknown>)[key])]));
  return value;
}
/** Both sides sign only reconstructed closed ASCII data under a fixed domain. */
export function modelSourceIdentityMac(secret: Uint8Array, proof: ModelSourceIdentityProof): Buffer {
  if (secret.byteLength !== 32) throw fail();
  const canonical = JSON.stringify(sorted(proof));
  if (canonical.length > 60 * 1024 || /[^\x00-\x7f]/.test(canonical)) throw fail();
  return createHmac("sha256", secret).update(DOMAIN, "ascii").update(canonical, "ascii").digest();
}
export function verifyModelSourceIdentityMac(secret: Uint8Array, envelope: ModelSourceIdentityEnvelope): void {
  if (!timingSafeEqual(modelSourceIdentityMac(secret, envelope.proof), Buffer.from(envelope.mac, "hex"))) throw fail();
}
