import { createHash } from "node:crypto";
import { types } from "node:util";
import {ArtifactId} from "../../../../modules/domain/artifact/ArtifactId";
import { imageCheckpointName } from "./image-host-launch-plan.mjs";

export type ImageHost = "packaged-desktop" | "thin-chrome";
export type ImageJourney = "create-register" | "task-recovery";
export const IMAGE_HOST_TIMEOUT_MS = 10 * 60_000;
export const IMAGE_HOST_PHASE_TIMEOUT_MS = 120_000;
export const IMAGE_HOST_WORKSPACE_NAME = "Image generation qualification";
export const IMAGE_HOST_PHASES = Object.freeze({
  "create-register": Object.freeze(["input-checkpoint-visible", "bounded-request-entered", "request-accepted",
    "real-output-decoded", "registration-confirmed", "exact-artifact-reopened", "reload-preserves-artifact"]),
  "task-recovery": Object.freeze(["input-checkpoint-visible", "bounded-request-entered", "navigation-preserves-draft",
    "request-accepted", "reload-restores-task", "real-output-decoded", "registration-confirmed",
    "exact-artifact-reopened", "no-duplicate-registration"]),
});
const invalid = () => new Error("The fixed image host test declaration is unavailable or invalid.");
function host(value: unknown): ImageHost {
  if (value !== "packaged-desktop" && value !== "thin-chrome") throw invalid();
  return value;
}
function journey(value: unknown): ImageJourney {
  if (value !== "create-register" && value !== "task-recovery") throw invalid();
  return value;
}
export function imagePublicId(value: unknown): string {
  if (typeof value !== "string" || !/^[A-Za-z0-9][A-Za-z0-9._:-]{3,191}$/.test(value)) throw invalid();
  return value;
}
export function imageHostWorkspace(run: unknown, target: unknown, scenario: unknown): string {
  if (typeof run !== "string" || !/^[a-z0-9-]{20,80}$/.test(run)) throw invalid();
  return `workspace.image-host.${createHash("sha256").update(`${run}\0${host(target)}\0${journey(scenario)}\0v1`).digest("hex").slice(0, 16)}`;
}
export function imageHostModelRecord(run: unknown, target: unknown, scenario: unknown): string {
  return imageHostWorkspace(run,target,scenario).replace(/^workspace\./,"model.");
}
export interface ImageHostFixture {
  readonly schemaVersion: "image-host-fixture-v1";
  readonly runId: string;
  readonly sourceRevision: string;
  readonly host: ImageHost;
  readonly journey: ImageJourney;
  readonly workspaceId: string;
  readonly modelRecordId: string;
  readonly checkpointFileName: string;
  readonly checkpointSha256: string;
}
/** Input declaration only; this function grants no model, process or filesystem authority. */
export function captureImageHostFixture(input: unknown, run: unknown, source: unknown, target: unknown, scenario: unknown): Readonly<ImageHostFixture> | undefined {
  if (input === undefined || input === "") return undefined;
  const ownedWorkspace = imageHostWorkspace(run, target, scenario);
  if (typeof input !== "string" || Buffer.byteLength(input) > 4096 ||
      typeof source !== "string" || !/^source\.[a-f0-9]{64}$/.test(source)) throw invalid();
  let raw: unknown;
  try { raw = JSON.parse(input); } catch { throw invalid(); }
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw invalid();
  const fields = ["schemaVersion", "runId", "sourceRevision", "host", "journey", "workspaceId", "modelRecordId", "checkpointFileName", "checkpointSha256"];
  if (Object.keys(raw).length !== fields.length || fields.some(key => !Object.prototype.hasOwnProperty.call(raw, key))) throw invalid();
  const value = raw as Record<string, unknown>;
  if (value.schemaVersion !== "image-host-fixture-v1" || value.runId !== run || value.sourceRevision !== source ||
      value.host !== target || value.journey !== scenario || value.workspaceId !== ownedWorkspace ||
      value.modelRecordId !== imageHostModelRecord(run,target,scenario) ||
      !imageCheckpointName(value.checkpointFileName) ||
      typeof value.checkpointSha256 !== "string" || !/^[a-f0-9]{64}$/.test(value.checkpointSha256)) throw invalid();
  return Object.freeze({ schemaVersion: "image-host-fixture-v1", runId: run as string, sourceRevision: source,
    host: host(target), journey: journey(scenario), workspaceId: ownedWorkspace,
    modelRecordId: imagePublicId(value.modelRecordId), checkpointFileName: value.checkpointFileName,
    checkpointSha256: value.checkpointSha256 });
}
export function imageTaskStorageKey(target: unknown, workspace: unknown): string {
  const prefix = host(target) === "packaged-desktop" ? "ai-system-builder.image-task.v1:" : "ai-system-builder.thin-image-task.v1:";
  if (typeof workspace !== "string" || !/^workspace\.image-host\.[a-f0-9]{16}$/.test(workspace)) throw invalid();
  return prefix + workspace;
}
export function imageArtifactId(value:unknown):string {
  if(typeof value!=="string"||value.length>192||value.split("/").some(part=>!part||part==="."||part==="..")||ArtifactId.from(value).toString()!==value)throw invalid();
  return value;
}
export function imageStorageKey(value:unknown):string {
  if(typeof value!=="string"||value.length>512||!value.endsWith(".png")||value.split("/").some(part=>!part||part==="."||part===".."||!/^[A-Za-z0-9._-]+$/.test(part)))throw invalid();
  return value;
}
/** Witness the real UI's finalization response; no response/task/result is injected. */
export function captureImageFinalization(requestText:unknown,responseText:unknown,workspaceId:string){
  if(typeof requestText!=="string"||Buffer.byteLength(requestText)>4096||typeof responseText!=="string"||Buffer.byteLength(responseText)>16384)throw invalid();
  let request,response;try{request=JSON.parse(requestText);response=JSON.parse(responseText);}catch{throw invalid();}
  if(!request||Object.keys(request).length!==2||request.workspaceId!==workspaceId||response?.ok!==true||response.value?.finalized!==true||!Array.isArray(response.value.assets)||response.value.assets.length!==1)throw invalid();
  const asset=response.value.assets[0];
  if(asset?.mediaType!=="image/png")throw invalid();
  return Object.freeze({requestId:imagePublicId(request.requestId),assetId:imagePublicId(asset.assetId),artifactId:imageArtifactId(asset.artifactId),storageKey:imageStorageKey(asset.storageKey)});
}
/** Phase completion must be supplied by the actual UI assertions, never by fixture setup. */
export function imageHostReport(target: unknown, scenario: unknown, phases: unknown, failed: unknown) {
  const selectedHost = host(target), selectedJourney = journey(scenario), expected = IMAGE_HOST_PHASES[selectedJourney];
  if (typeof failed !== "boolean" || types.isProxy(phases) || !Array.isArray(phases) ||
      Object.getPrototypeOf(phases) !== Array.prototype || phases.length > expected.length) throw invalid();
  const descriptors = Object.getOwnPropertyDescriptors(phases);
  if (Reflect.ownKeys(descriptors).length !== phases.length + 1) throw invalid();
  const captured: string[] = [];
  for (let index = 0; index < phases.length; index++) {
    const item = descriptors[String(index)];
    if (!item || !("value" in item) || item.value !== expected[index]) throw invalid();
    captured.push(item.value);
  }
  return { schemaVersion: "image-host-ui-outcome-v1", host: selectedHost, journey: selectedJourney,
    status: !failed && captured.length === expected.length ? "passed" : "failed", phases: captured,
    nextPhase: expected[captured.length] ?? "complete", parentQualificationGranted: false,
    scope: "Actual generated-image UI and exact saved result only. No image semantic quality, native security, performance or parent qualification." };
}
