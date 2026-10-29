import {createHash} from "node:crypto";
import {types} from "node:util";
import {TECHNICAL_ACCESSIBILITY_RULE_IDS} from "./technical-accessibility-observation";
import {finalizeQualificationEvidence, safeQualificationFailureType, type QualificationEvidenceReport} from "./qualification-reporting";
import {runOwnedRestartPhase} from "./asset-authoring-oracles";

export const ASSET_REPORT_MAX_BYTES = 262144;
export const ASSET_PNG_MAX_BYTES = 16 * 1024 * 1024;
const INVALID = "Invalid Assets qualification observation.";
const identities = new WeakSet<object>();
export interface AssetQualificationIdentity {
  readonly source: string; readonly runId: string;
  readonly host: "packaged-desktop" | "managed-thin-chrome";
  readonly nativeZoom: boolean; readonly suffix: string;
}
export function assetQualificationIdentity(source: unknown, runId: unknown, host: unknown, nativeZoom: unknown, title: unknown): AssetQualificationIdentity {
  if (typeof source !== "string" || !/^source\.[a-f0-9]{64}$/.test(source) ||
      typeof runId !== "string" || !/^[a-z0-9-]{20,80}$/.test(runId) || typeof nativeZoom !== "boolean" ||
      (host !== "packaged-desktop" && host !== "managed-thin-chrome")) throw new Error(INVALID);
  const expected = host === "packaged-desktop"
    ? `packaged desktop Assets ${nativeZoom ? "native 400 percent zoom" : "meaningful authoring and persistence"}`
    : nativeZoom ? "managed thin client Assets reflows at actual native 400 percent browser zoom"
      : "managed thin client builds, customizes, reviews, publishes and reopens real assets";
  if (title !== expected) throw new Error(INVALID);
  const value = Object.freeze({source, runId, host, nativeZoom,
    suffix: host === "managed-thin-chrome" ? nativeZoom ? "-managed-native400" : "-managed-standard" : ""});
  identities.add(value); return value;
}
function admitted(value: AssetQualificationIdentity) {
  if (!value || !identities.has(value)) throw new Error(INVALID);
}
export function requireAssetQualificationIdentity(value: unknown): AssetQualificationIdentity {
  admitted(value as AssetQualificationIdentity); return value as AssetQualificationIdentity;
}
export type AssetFailureStage = "admission" | "journey" | "media" | "keyboard" | "numbers" | "surface" | "audit" | "motion" | "restore";
const stages = new Set<string>(["admission", "journey", "media", "keyboard", "numbers", "surface", "audit", "motion", "restore", "evidence-save", "evidence-attach"]);
const keys = new Set(("surface width kind focus outline contrast screenshotScale screenshot screenshotSha256 visible shadow x y right bottom height thickness offset solid viewportWidth viewportHeight viewportHeightExact dpr samples ratios minimum imageWidth imageHeight cssToDeviceScale state facts stateBackground stepZ numberBackground numberImage foreground font opacity maximumBackdropDeviation textContrast cards maximumTitleBadgeOverlap maximumLabelOverflow within color background violations incomplete passed measurements innerWidth outerWidth cssZoom visualScale overflow motionElements maximumMotionMs textualStatusCount schemaVersion status frame media layoutWidth controls inaccessible contrastPassedNodes retries attempted rule nodes failures").split(" "));
const strings = new Set(["Browse", "Import Assets", "Studio", "Saved", "Customizations", "native", "first", "active", "default", "none", "auto", "1", "normal", "forced-colors", "passed", "failed", "keyboard-focus", "focus-image", "rendered-focus-contrast", "numbered-step-background", "title-badge-layout", "file-choose-keyboard-focus", "actual-primary-hover-contrast", "actual-device-viewport", "technical-accessibility-audit-v1", "native-technical-accessibility-audit-v1", "rule-violation", "unresolved-rule", "unresolved-contrast-retry", "missing-contrast-sample", "native-reflow-overflow", "native-control-inaccessible"]);
const ruleIds = new Set<string>(TECHNICAL_ACCESSIBILITY_RULE_IDS);
const imageName = /^(?:keyboard-focus-(?:1440|320|native)|workflow-number-(?:1440|320|native)-(?:first|active|default))\.png$/;
function fields(value: unknown, allowed: ReadonlySet<string>) {
  if (!value || typeof value !== "object" || types.isProxy(value) || Object.getPrototypeOf(value) !== Object.prototype) throw new Error(INVALID);
  const descriptors = Object.getOwnPropertyDescriptors(value);
  if (Reflect.ownKeys(descriptors).length > 64) throw new Error(INVALID);
  for (const key of Reflect.ownKeys(descriptors)) if (typeof key !== "string" || !allowed.has(key) || !("value" in descriptors[key]!)) throw new Error(INVALID);
  return descriptors;
}
/** A bounded clone; DOM selectors, text and arbitrary object methods never enter JSON. */
export function assetObservation(value: unknown): Record<string, unknown> {
  fields(value, keys);
  let entries = 0;
  function copy(item: unknown, key: string, depth: number): unknown {
    if (++entries > 10000 || depth > 10) throw new Error(INVALID);
    if (typeof item === "number") {if (!Number.isFinite(item) || Math.abs(item) > 1e9) throw new Error(INVALID); return item;}
    if (typeof item === "boolean") return item;
    if (typeof item === "string") {
      if (item.length > 300) throw new Error(INVALID);
      if (strings.has(item) || (key === "rule" && ruleIds.has(item)) ||
          (key === "screenshot" && imageName.test(item)) || (key === "screenshotSha256" && /^[a-f0-9]{64}$/.test(item))) return item;
      throw new Error(INVALID);
    }
    if (item && typeof item === "object" && !types.isProxy(item) && Array.isArray(item)) {
      if (Object.getPrototypeOf(item) !== Array.prototype) throw new Error(INVALID);
      const length = Object.getOwnPropertyDescriptor(item, "length")?.value;
      if (!Number.isSafeInteger(length) || length > 512) throw new Error(INVALID);
      const descriptors = Object.getOwnPropertyDescriptors(item) as Record<string, PropertyDescriptor>;
      if (Reflect.ownKeys(descriptors).length !== length + 1) throw new Error(INVALID);
      return Array.from({length}, (_, index) => {const field = descriptors[String(index)]; if (!field || !("value" in field)) throw new Error(INVALID); return copy(field.value, key, depth + 1);});
    }
    const descriptors = fields(item, keys), result: Record<string, unknown> = {};
    for (const name of Object.keys(descriptors)) result[name] = copy(descriptors[name]!.value, name, depth + 1);
    return result;
  }
  return copy(value, "", 0) as Record<string, unknown>;
}
export interface AssetEvidenceReport extends QualificationEvidenceReport {
  observations: Record<string, unknown>[]; failureTypes?: string[];
}
export function createAssetEvidenceReport(identity: AssetQualificationIdentity): AssetEvidenceReport {
  admitted(identity); return {status: "running", observations: []};
}
export function assetEvidenceBody(identity: AssetQualificationIdentity, report: AssetEvidenceReport): string {
  admitted(identity);
  const data = fields(report, new Set(["status", "observations", "failureStage", "finalizationStage", "failureTypes"]));
  if (!data.status || !data.observations || !["running", "passed", "failed"].includes(data.status.value)) throw new Error(INVALID);
  const observations = assetObservation({failures: data.observations.value}).failures as unknown[];
  if (observations.length > 256) throw new Error(INVALID);
  const optional: Record<string, unknown> = {};
  for (const key of ["failureStage", "finalizationStage"] as const) if (data[key]) {
    if (!stages.has(data[key]!.value)) throw new Error(INVALID); optional[key] = data[key]!.value;
  }
  if (data.failureTypes) {
    const raw = data.failureTypes.value;
    if (types.isProxy(raw) || !Array.isArray(raw) || Object.getPrototypeOf(raw) !== Array.prototype) throw new Error(INVALID);
    const length = Object.getOwnPropertyDescriptor(raw, "length")?.value;
    if (!Number.isSafeInteger(length) || length > 16) throw new Error(INVALID);
    const descriptors = Object.getOwnPropertyDescriptors(raw) as Record<string, PropertyDescriptor>;
    if (Reflect.ownKeys(descriptors).length !== length + 1) throw new Error(INVALID);
    optional.failureTypes = Array.from({length}, (_, index) => {
      const field = descriptors[String(index)];
      if (!field || !("value" in field) || !["Error", "TypeError", "RangeError", "ReferenceError", "SyntaxError", "AggregateError", "AssertionError", "TimeoutError", "Unknown"].includes(field.value)) throw new Error(INVALID);
      return field.value;
    });
  }
  const body = JSON.stringify({schemaVersion: "asset-accessibility-v2", source: identity.source, runId: identity.runId,
    host: identity.host, nativeZoom: identity.nativeZoom, status: data.status.value, observations, ...optional}, null, 2) + "\n";
  if (Buffer.byteLength(body) > ASSET_REPORT_MAX_BYTES) throw new Error("Assets evidence exceeded its fixed bound.");
  return body;
}
export async function finalizeAssetEvidence(report: AssetEvidenceReport, failures: unknown[], restore: () => Promise<unknown>, save: () => Promise<void>, attach: () => Promise<unknown>) {
  try {await restore();} catch (error) {failures.push(error); report.status = "failed"; report.failureStage ??= "restore";}
  if (failures.length) report.failureTypes = failures.slice(0, 16).map(safeQualificationFailureType);
  await finalizeQualificationEvidence(report, failures, save, attach);
}
export async function assetAdmissionFailure(identity: AssetQualificationIdentity, error: unknown, save: (body: string) => Promise<void>, attach: (body: string) => Promise<unknown>) {
  admitted(identity);
  const report: QualificationEvidenceReport = {status: "failed", failureStage: "admission"};
  const serialize = () => JSON.stringify({schemaVersion: "asset-admission-failure-v1", source: identity.source,
    host: identity.host, nativeZoom: identity.nativeZoom, status: report.status, failureStage: report.failureStage,
    finalizationStage: report.finalizationStage, failureType: safeQualificationFailureType(error)}) + "\n";
  await finalizeQualificationEvidence(report, [error], () => save(serialize()), () => attach(serialize()));
}
/** Raw caught reasons remain internal; ordinary Playwright reporters get fixed copy. */
export async function runAssetQualificationCase(work: () => Promise<void>, retire: () => Promise<unknown>) {
  try {await runOwnedRestartPhase(work, retire);}
  catch {throw new Error("Assets qualification failed. Check the bounded stage evidence.");}
}
export interface AssetOwnedApplication {
  close(): Promise<void>;
  process(): {exitCode: number | null};
}
/** Four workflow restarts; close and confirm each previous app before relaunch. */
export function assetApplicationLifetime<T extends AssetOwnedApplication>() {
  let current: T | undefined, process: {exitCode: number | null} | undefined;
  let launching = false, retiring: Promise<void> | undefined, failed = false, launches = 0;
  return {
    async launch(factory: () => Promise<T>): Promise<T> {
      if (launching || current || retiring || failed || launches >= 5) throw new Error("An Assets app cannot be launched in this phase.");
      launching = true; launches++;
      try {current = await factory(); process = current.process(); return current;}
      catch (error) {failed = true; throw error;}
      finally {launching = false;}
    },
    retire(): Promise<void> {
      if (retiring) return retiring;
      if (launching) return Promise.reject(new Error("Assets startup has not settled."));
      if (!current) return failed ? Promise.reject(new Error("Assets app retirement is unconfirmed.")) : Promise.resolve();
      const app = current, observed = process; current = undefined; process = undefined;
      retiring = runOwnedRestartPhase(() => app.close(), async () => {
        if (!observed || observed.exitCode !== 0) throw new Error("Assets app exit is unconfirmed.");
      }).catch(error => {failed = true; throw error;}).finally(() => {retiring = undefined;});
      return retiring;
    },
  };
}
/** Public CDP screenshot bytes only, with finite encoded and decoded dimensions. */
export function assetViewportPng(value: unknown): Buffer {
  if (typeof value !== "string" || value.length === 0 || value.length > Math.ceil(ASSET_PNG_MAX_BYTES / 3) * 4 || value.length % 4 !== 0) throw new Error(INVALID);
  let padding = 0;
  for (let i = 0; i < value.length; i++) {
    const c = value.charCodeAt(i);
    if (c === 61) {if (i < value.length - 2 || ++padding > 2) throw new Error(INVALID);}
    else if (padding || !((c >= 65 && c <= 90) || (c >= 97 && c <= 122) || (c >= 48 && c <= 57) || c === 43 || c === 47)) throw new Error(INVALID);
  }
  const bytes = Buffer.from(value, "base64");
  if (bytes.length < 33 || bytes.length > ASSET_PNG_MAX_BYTES || bytes.subarray(0, 8).toString("hex") !== "89504e470d0a1a0a" || bytes.readUInt32BE(8) !== 13 || bytes.subarray(12, 16).toString("ascii") !== "IHDR") throw new Error(INVALID);
  const width = bytes.readUInt32BE(16), height = bytes.readUInt32BE(20);
  if (width < 1 || height < 1 || width > 6000 || height > 4200 || width * height > 24000000) throw new Error(INVALID);
  return bytes;
}
export function assetCaptureBudget(identity: AssetQualificationIdentity) {
  admitted(identity); const names = new Set<string>(); let total = 0;
  return (name: string, png: Buffer) => {
    if (types.isProxy(png) || !Buffer.isBuffer(png)) throw new Error(INVALID);
    if (typeof name !== "string" || !imageName.test(name) || names.has(name) || names.size >= (identity.nativeZoom ? 4 : 8) ||
        (identity.nativeZoom ? !name.includes("-native") : !/(?:-1440|-320)/.test(name))) throw new Error(INVALID);
    const byteLength = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(Uint8Array.prototype), "byteLength")!.get!.call(png) as number;
    if (byteLength > ASSET_PNG_MAX_BYTES) throw new Error(INVALID);
    const owned = Buffer.alloc(byteLength);
    for (let i = 0; i < byteLength; i++) owned[i] = png[i]!;
    const verified = assetViewportPng(owned.toString("base64"));
    if (total + verified.byteLength > 64 * 1024 * 1024) throw new Error(INVALID);
    names.add(name); total += verified.byteLength;
    return Object.freeze({screenshot: name, screenshotSha256: createHash("sha256").update(verified).digest("hex")});
  };
}
