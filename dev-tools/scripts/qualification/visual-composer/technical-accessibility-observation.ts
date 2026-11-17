import { types } from "node:util";
import axe from "axe-core";

export const ACCESSIBILITY_RETRY_NODE_LIMIT = 1000;
const RULE_LIMIT = 512;
const NODE_LIMIT = 10000;
const INVALID = "Invalid technical accessibility observation.";
// The vocabulary comes from the installed, locked test dependency, never the DOM.
export const TECHNICAL_ACCESSIBILITY_RULE_IDS = Object.freeze(axe.getRules().map(rule => rule.ruleId));
const RULE_IDS = new Set(TECHNICAL_ACCESSIBILITY_RULE_IDS);
if (RULE_IDS.size === 0 || RULE_IDS.size > RULE_LIMIT) throw new Error(INVALID);
type RuleCount = Readonly<{ rule: string; nodes: number }>;
export interface TechnicalAccessibilityAudit {
  readonly schemaVersion: "technical-accessibility-audit-v1";
  readonly width: 320 | 1440;
  readonly violations: readonly RuleCount[];
  readonly incomplete: readonly RuleCount[];
  readonly contrastPassedNodes: number;
  readonly retries: Readonly<{ attempted: number; passed: number }>;
  readonly status: "passed" | "failed";
  readonly failures: readonly string[];
}
function record(value: unknown, keys: readonly string[]): Record<string, unknown> {
  if (!value || typeof value !== "object" || types.isProxy(value) || Object.getPrototypeOf(value) !== Object.prototype) throw new Error(INVALID);
  const fields = Object.getOwnPropertyDescriptors(value);
  if (Reflect.ownKeys(fields).length !== keys.length) throw new Error(INVALID);
  const result: Record<string, unknown> = {};
  for (const key of keys) {
    const field = fields[key];
    if (!field || !("value" in field)) throw new Error(INVALID);
    result[key] = field.value;
  }
  return result;
}
function count(value: unknown, limit: number, minimum = 0): number {
  if (!Number.isSafeInteger(value) || (value as number) < minimum || (value as number) > limit) throw new Error(INVALID);
  return value as number;
}
export const CONTRAST_RETRY_REASON_IDS = Object.freeze(["bgGradient", "bgImage", "imgNode", "outsideViewport", "elmPartiallyObscuring",
  "elmPartiallyObscured", "bgOverlap", "colorParse", "equalRatio", "shortTextContent", "other"] as const);
export const CONTRAST_RETRY_V2_REASON_IDS = Object.freeze([...CONTRAST_RETRY_REASON_IDS,
  "nonBmp", "pseudoContent", "complexTextShadows", "shadowOnBgColor", "fgOnShadowColor"] as const);
// These source-owned markers classify location, never user labels or the reason for obscuring.
export const CONTRAST_RETRY_REGION_MARKERS = Object.freeze({
  glossaryHelp: "ui-glossary-hint",
  notificationBadge: "ui-notification__badge",
  workspaceControl: "workspace-switcher--header",
  pageDashboard: "page-dashboard",
  shellMenu: "ui-shell__menu",
  shellHeader: "ui-shell__header",
  shellSidebar: "ui-shell__sidebar",
  homeCard: "home-area-card",
  homeContent: "home-page",
} as const);
type ContrastRetryRegion = keyof typeof CONTRAST_RETRY_REGION_MARKERS | "other";
const CONTRAST_RETRY_REGION_IDS: readonly ContrastRetryRegion[] = Object.freeze([
  ...Object.keys(CONTRAST_RETRY_REGION_MARKERS) as Array<keyof typeof CONTRAST_RETRY_REGION_MARKERS>, "other",
]);
export const CONTRAST_RETRY_V4_REGION_MARKERS = Object.freeze({
  ...CONTRAST_RETRY_REGION_MARKERS,
  notificationToast: "ui-notification__toast",
  notificationPanel: "ui-notification__panel",
  modalDialog: "ui-modal-dialog",
  shellContent: "ui-shell__content",
  shellMain: "ui-shell__main",
} as const);
type ContrastRetryV4Region = keyof typeof CONTRAST_RETRY_V4_REGION_MARKERS | "other";
const CONTRAST_RETRY_V4_REGION_IDS: readonly ContrastRetryV4Region[] = Object.freeze([
  ...Object.keys(CONTRAST_RETRY_V4_REGION_MARKERS) as Array<keyof typeof CONTRAST_RETRY_V4_REGION_MARKERS>, "other",
]);
type ContrastRetryV2Reason = typeof CONTRAST_RETRY_V2_REASON_IDS[number];
type ContrastRetryReasonRegions<Region extends string> = Readonly<Record<ContrastRetryV2Reason, Readonly<Record<Region, number>>>>;
export const CONTRAST_RETRY_HINT_IDS = Object.freeze(["backgroundImage", "reducedOpacity", "clippedAncestor", "nonRgbColor", "ancestorLimit", "reasonScanLimit"] as const);
const CONTRAST_RETRY_OUTCOMES = ["violation", "unresolved", "noPositiveSample"] as const;
interface ContrastRetryCounts {
  readonly attempted: number; readonly passed: number;
  readonly outcomes: Readonly<Record<typeof CONTRAST_RETRY_OUTCOMES[number], number>>;
  readonly hints: Readonly<Record<typeof CONTRAST_RETRY_HINT_IDS[number], number>>;
}
export type ContrastRetryDiagnostics = ContrastRetryCounts & (
  { readonly schemaVersion: "contrast-retry-diagnostics-v1"; readonly reasons: Readonly<Record<typeof CONTRAST_RETRY_REASON_IDS[number], number>> }
  | { readonly schemaVersion: "contrast-retry-diagnostics-v2"; readonly reasons: Readonly<Record<ContrastRetryV2Reason, number>> }
  | { readonly schemaVersion: "contrast-retry-diagnostics-v3"; readonly reasons: Readonly<Record<ContrastRetryV2Reason, number>>;
      readonly reasonRegions: ContrastRetryReasonRegions<ContrastRetryRegion> }
  | { readonly schemaVersion: "contrast-retry-diagnostics-v4"; readonly reasons: Readonly<Record<ContrastRetryV2Reason, number>>;
      readonly reasonRegions: ContrastRetryReasonRegions<ContrastRetryV4Region> }
);
/** A diagnostic projection supplies no accessibility status or qualification. */
export function readContrastRetryDiagnostics(value: unknown): ContrastRetryDiagnostics {
  try {
    if (!value || typeof value !== "object" || types.isProxy(value) || Object.getPrototypeOf(value) !== Object.prototype) throw new Error();
    const version: unknown = Object.getOwnPropertyDescriptor(value, "schemaVersion")?.value;
    const hasRegions = version === "contrast-retry-diagnostics-v3" || version === "contrast-retry-diagnostics-v4";
    if (version !== "contrast-retry-diagnostics-v1" && version !== "contrast-retry-diagnostics-v2" && !hasRegions) throw new Error();
    const keys = ["schemaVersion", "attempted", "passed", "outcomes", "reasons", "hints"];
    const data = record(value, hasRegions ? [...keys, "reasonRegions"] : keys);
    const attempted = count(data.attempted, ACCESSIBILITY_RETRY_NODE_LIMIT), passed = count(data.passed, attempted), failed = attempted - passed;
    function counters<K extends string>(value: unknown, keys: readonly K[], limit = failed) {
      const fields = record(value, keys);
      return Object.freeze(Object.fromEntries(keys.map(key => [key, count(fields[key], limit)]))) as Readonly<Record<K, number>>;
    }
    const outcomes = counters(data.outcomes, CONTRAST_RETRY_OUTCOMES), hints = counters(data.hints, CONTRAST_RETRY_HINT_IDS);
    if (Object.values(outcomes).reduce((a, b) => a + b, 0) !== failed) throw new Error();
    function versioned<V extends ContrastRetryDiagnostics["schemaVersion"], K extends string>(schemaVersion: V, keys: readonly K[]) {
      const reasons = counters(data.reasons, keys);
      if (keys.reduce((sum, key) => sum + reasons[key], 0) !== failed) throw new Error();
      return Object.freeze({ schemaVersion, attempted, passed, outcomes, reasons, hints });
    }
    if (version === "contrast-retry-diagnostics-v1") return versioned(version, CONTRAST_RETRY_REASON_IDS);
    if (version === "contrast-retry-diagnostics-v2") return versioned(version, CONTRAST_RETRY_V2_REASON_IDS);
    const core = versioned(version, CONTRAST_RETRY_V2_REASON_IDS);
    const regions = record(data.reasonRegions, CONTRAST_RETRY_V2_REASON_IDS);
    function regionCounts<Region extends string>(keys: readonly Region[]): ContrastRetryReasonRegions<Region> {
      const rows = CONTRAST_RETRY_V2_REASON_IDS.map(reason => {
        const row = counters(regions[reason], keys, core.reasons[reason]);
        if (keys.reduce((sum, key) => sum + row[key], 0) !== core.reasons[reason]) throw new Error();
        return [reason, row] as const;
      });
      return Object.freeze(Object.fromEntries(rows)) as ContrastRetryReasonRegions<Region>;
    }
    return version === "contrast-retry-diagnostics-v3"
      ? Object.freeze({ ...core, schemaVersion: version, reasonRegions: regionCounts(CONTRAST_RETRY_REGION_IDS) })
      : Object.freeze({ ...core, schemaVersion: version, reasonRegions: regionCounts(CONTRAST_RETRY_V4_REGION_IDS) });
  } catch { throw new Error("Invalid contrast retry diagnostics."); }
}
function observedAudit<T extends { retries: { attempted: number; passed: number } }>(value: unknown, read: (audit: unknown) => T) {
  const envelope = record(value, ["audit", "diagnostics"]), audit = read(envelope.audit), diagnostics = readContrastRetryDiagnostics(envelope.diagnostics);
  if (diagnostics.attempted !== audit.retries.attempted || diagnostics.passed !== audit.retries.passed) throw new Error(INVALID);
  return Object.freeze({ audit, diagnostics });
}
/** Keep the strict v1 audit unchanged; diagnostics are a separate bounded value. */
export function readTechnicalAccessibilityObservation(value: unknown) {
  try { return observedAudit(value, readTechnicalAccessibilityAudit); }
  catch { throw new Error(INVALID); }
}
export function readNativeAccessibilityObservation(value: unknown, media: unknown, frame: unknown) {
  try { return observedAudit(value, facts => readNativeAccessibilityAudit({schemaVersion: "native-technical-accessibility-audit-v1", media, frame, facts})); }
  catch { throw new Error("Invalid native accessibility observation."); }
}
function rules(value: unknown): readonly RuleCount[] {
  if (types.isProxy(value) || !Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype) throw new Error(INVALID);
  const length = count(Object.getOwnPropertyDescriptor(value, "length")?.value, RULE_LIMIT);
  const fields = Object.getOwnPropertyDescriptors(value);
  if (Reflect.ownKeys(fields).length !== length + 1) throw new Error(INVALID);
  const result: RuleCount[] = [], seen = new Set<string>();
  for (let index = 0; index < length; index++) {
    const field = fields[String(index)];
    if (!field || !("value" in field)) throw new Error(INVALID);
    const item = record(field.value, ["rule", "nodes"]);
    if (typeof item.rule !== "string" || !RULE_IDS.has(item.rule) || seen.has(item.rule)) throw new Error(INVALID);
    seen.add(item.rule); result.push(Object.freeze({ rule: item.rule, nodes: count(item.nodes, NODE_LIMIT, 1) }));
  }
  return Object.freeze(result);
}
function computedAuditFacts(data: Record<string, unknown>) {
  const violations = rules(data.violations), incomplete = rules(data.incomplete);
  const contrastPassedNodes = count(data.contrastPassedNodes, NODE_LIMIT);
  const retry = record(data.retries, ["attempted", "passed"]);
  const attempted = count(retry.attempted, ACCESSIBILITY_RETRY_NODE_LIMIT), passed = count(retry.passed, attempted);
  const contrastIncomplete = incomplete.find(item => item.rule === "color-contrast")?.nodes ?? 0;
  if (contrastIncomplete > ACCESSIBILITY_RETRY_NODE_LIMIT || attempted > contrastIncomplete) throw new Error(INVALID);
  const failures: string[] = [];
  if (violations.length) failures.push("rule-violation");
  if (incomplete.some(item => item.rule !== "color-contrast")) failures.push("unresolved-rule");
  if (attempted !== contrastIncomplete || passed !== attempted) failures.push("unresolved-contrast-retry");
  if (contrastPassedNodes === 0) failures.push("missing-contrast-sample");
  return Object.freeze({ violations, incomplete, contrastPassedNodes, retries: Object.freeze({ attempted, passed }),
    status: failures.length ? "failed" as const : "passed" as const, failures: Object.freeze(failures) });
}
/** Structural/local evidence only. Actual browser execution supplies these facts. */
export function readTechnicalAccessibilityAudit(value: unknown): TechnicalAccessibilityAudit {
  try {
    const data = record(value, ["schemaVersion", "width", "violations", "incomplete", "contrastPassedNodes", "retries"]);
    if (data.schemaVersion !== "technical-accessibility-audit-v1" || (data.width !== 320 && data.width !== 1440)) throw new Error(INVALID);
    return Object.freeze({ schemaVersion: "technical-accessibility-audit-v1", width: data.width, ...computedAuditFacts(data) });
  } catch { throw new Error(INVALID); }
}

export interface NotificationPopupReference {
  readonly schemaVersion: "notification-popup-reference-v1";
  readonly width: 320 | 1440;
  readonly sharedShells: 1; readonly bells: 1; readonly dialogs: 1; readonly headings: 1;
  readonly namedBells: 1; readonly buttonOpeners: 1;
  readonly matchedIdReferences: 2; readonly visibleElements: 3; readonly stableElements: 3;
  readonly engineReviewNodes: 1;
  readonly engineRule: "aria-valid-attr-value";
  readonly engineMessageKey: "controlsWithinPopup";
}
/** Closed structural evidence, not proof that a browser or a host actually ran. */
export function readNotificationPopupReference(value: unknown): NotificationPopupReference {
  try {
    const data = record(value, ["schemaVersion", "width", "sharedShells", "bells", "dialogs", "headings", "namedBells", "buttonOpeners", "matchedIdReferences",
      "visibleElements", "stableElements", "engineReviewNodes", "engineRule", "engineMessageKey"]);
    if (data.schemaVersion !== "notification-popup-reference-v1" || (data.width !== 320 && data.width !== 1440) ||
        data.engineRule !== "aria-valid-attr-value" || data.engineMessageKey !== "controlsWithinPopup") throw new Error();
    for (const key of ["sharedShells", "bells", "dialogs", "headings", "namedBells", "buttonOpeners", "engineReviewNodes"]) count(data[key], 1, 1);
    count(data.matchedIdReferences, 2, 2); count(data.visibleElements, 3, 3); count(data.stableElements, 3, 3);
    return Object.freeze({schemaVersion: "notification-popup-reference-v1", width: data.width,
      sharedShells: 1, bells: 1, dialogs: 1, headings: 1, namedBells: 1, buttonOpeners: 1, matchedIdReferences: 2, visibleElements: 3, stableElements: 3,
      engineReviewNodes: 1, engineRule: "aria-valid-attr-value", engineMessageKey: "controlsWithinPopup"});
  } catch { throw new Error("Invalid notification popup reference."); }
}
/** Keep the failed generic audit intact beside one additional, fixed DOM check. */
export function qualifyNotificationPopupAccessibilityAudit(value: unknown, referenceValue: unknown) {
  const audit = readTechnicalAccessibilityAudit(value), reference = readNotificationPopupReference(referenceValue);
  if (audit.width !== reference.width) throw new Error("Invalid notification popup reference.");
  const unresolved = audit.incomplete.filter(item => item.rule !== "color-contrast");
  const matched = unresolved.length === 1 && unresolved[0]!.rule === reference.engineRule && unresolved[0]!.nodes === reference.engineReviewNodes;
  const qualified = matched && audit.status === "failed" && audit.failures.length === 1 && audit.failures[0] === "unresolved-rule";
  return Object.freeze({schemaVersion: "notification-popup-qualification-v1" as const, width: audit.width,
    rawAudit: audit, reference, status: qualified ? "passed" as const : "failed" as const,
    failures: Object.freeze(qualified ? [] : [...audit.failures, "notification-reference-unresolved"])});
}
export function readNotificationPopupAccessibilityObservation(value: unknown) {
  try {
    const data = record(value, ["audit", "diagnostics", "reference"]);
    const observation = readTechnicalAccessibilityObservation({audit: data.audit, diagnostics: data.diagnostics});
    const qualification = qualifyNotificationPopupAccessibilityAudit(data.audit, data.reference);
    return Object.freeze({...observation, reference: qualification.reference, qualification});
  } catch { throw new Error("Invalid notification popup observation."); }
}

export type CriticalAccessibilityMode = "standard" | "native400";
export function readCriticalAccessibilityMode(value: unknown): CriticalAccessibilityMode {
  if (value !== "standard" && value !== "native400") throw new Error("Invalid critical accessibility mode.");
  return value;
}
const NATIVE_INVALID = "Invalid native accessibility observation.";
export interface Native400Frame {
  readonly dpr: number; readonly cssZoom: "1"; readonly visualScale: 1;
  readonly outerWidth: number; readonly innerWidth: number; readonly layoutWidth: number;
  readonly overflow: number; readonly controls: number; readonly inaccessible: number;
  readonly status: "passed" | "failed"; readonly failures: readonly string[];
}
/** Frame facts alone do not establish how zoom was applied; the fixed host case supplies that proof. */
export function readNative400Frame(value: unknown): Native400Frame {
  try {
    const data = record(value, ["dpr", "cssZoom", "visualScale", "outerWidth", "innerWidth", "layoutWidth", "overflow", "controls", "inaccessible"]);
    if (typeof data.dpr !== "number" || !Number.isFinite(data.dpr) || Math.abs(data.dpr - 4) >= 1e-8 || data.cssZoom !== "1" || data.visualScale !== 1) throw new Error(NATIVE_INVALID);
    const outerWidth = count(data.outerWidth, 1460, 1400), innerWidth = count(data.innerWidth, 360, 320);
    const layoutWidth = count(data.layoutWidth, innerWidth, 1), overflow = count(data.overflow, 100000);
    const controls = count(data.controls, NODE_LIMIT, 1), inaccessible = count(data.inaccessible, controls);
    const failures: string[] = [];
    if (overflow > 1) failures.push("native-reflow-overflow");
    if (inaccessible) failures.push("native-control-inaccessible");
    return Object.freeze({ dpr: data.dpr, cssZoom: "1", visualScale: 1, outerWidth, innerWidth, layoutWidth, overflow, controls, inaccessible,
      status: failures.length ? "failed" : "passed", failures: Object.freeze(failures) });
  } catch { throw new Error(NATIVE_INVALID); }
}
export interface NativeAccessibilityAudit extends Omit<TechnicalAccessibilityAudit, "schemaVersion" | "width"> {
  readonly schemaVersion: "native-technical-accessibility-audit-v1";
  readonly media: "normal" | "forced-colors";
  readonly frame: Native400Frame;
}
export function readNativeAccessibilityAudit(value: unknown): NativeAccessibilityAudit {
  try {
    const data = record(value, ["schemaVersion", "media", "frame", "facts"]);
    if (data.schemaVersion !== "native-technical-accessibility-audit-v1" || (data.media !== "normal" && data.media !== "forced-colors")) throw new Error(NATIVE_INVALID);
    const frame = readNative400Frame(data.frame), facts = computedAuditFacts(record(data.facts, ["violations", "incomplete", "contrastPassedNodes", "retries"]));
    const failures = Object.freeze([...frame.failures, ...facts.failures]);
    return Object.freeze({ schemaVersion: "native-technical-accessibility-audit-v1", media: data.media, frame, ...facts,
      status: failures.length ? "failed" : "passed", failures });
  } catch { throw new Error(NATIVE_INVALID); }
}

export const CRITICAL_ACCESSIBILITY_SURFACES = Object.freeze(["settings", "security", "notifications", "navigation-menu", "data-ingestion", "dataset-preparation",
  "dataset-versions", "dataset-review", "dataset-row-edit", "dataset-output-shape", "context-rag", "context-pack", "manual-context-review", "context-browser",
  "asset-import", "asset-customization", "asset-studio", "asset-saved", "asset-detail",
  "system-element-picker", "system-preview", "system-properties", "system-layers",
  "workspace-create", "system-manage", "system-build-dialog", "system-publish", "system-publication-confirm", "runtime-conversation",
  "models-discovery", "models-inventory", "model-training", "image-configuration", "ocr-configuration", "ocr-output-review"] as const);
export type CriticalAccessibilitySurface = typeof CRITICAL_ACCESSIBILITY_SURFACES[number];
export interface CriticalAccessibilityContext {
  readonly schemaVersion: "critical-accessibility-context-v1";
  readonly runId: string;
  readonly sourceRevision: string;
  readonly host: "packaged-desktop" | "thin-chrome" | "managed-thin-chrome";
  readonly surface: CriticalAccessibilitySurface;
  readonly testKey: string;
}
export function readCriticalAccessibilityContext(value: unknown): CriticalAccessibilityContext {
  try {
    const data = record(value, ["schemaVersion", "runId", "sourceRevision", "host", "surface", "testKey"]);
    if (data.schemaVersion !== "critical-accessibility-context-v1" || typeof data.runId !== "string" || !/^[a-z0-9-]{20,80}$/.test(data.runId)
      || typeof data.sourceRevision !== "string" || !/^source\.[a-f0-9]{64}$/.test(data.sourceRevision)
      || (data.host !== "packaged-desktop" && data.host !== "thin-chrome" && data.host !== "managed-thin-chrome")
      || typeof data.surface !== "string" || !CRITICAL_ACCESSIBILITY_SURFACES.includes(data.surface as CriticalAccessibilitySurface)
      || (data.surface === "security" && data.host === "packaged-desktop")
       || (data.surface === "runtime-conversation" && data.host !== "packaged-desktop")
       || (data.surface === "model-training" && data.host !== "packaged-desktop")
       || ((data.surface === "ocr-configuration" || data.surface === "ocr-output-review") && data.host === "managed-thin-chrome")
      || typeof data.testKey !== "string" || !/^[a-f0-9]{64}$/.test(data.testKey)) throw new Error();
    return Object.freeze({ schemaVersion: "critical-accessibility-context-v1", runId: data.runId, sourceRevision: data.sourceRevision, host: data.host, surface: data.surface as CriticalAccessibilitySurface, testKey: data.testKey });
  } catch { throw new Error("Invalid critical accessibility context."); }
}
/** Actual execution still needs its owning test receipt; fixtures qualify only this gate. */
export function qualifyCriticalAccessibilityReport(context: unknown, value: unknown) {
  try {
    const identity = readCriticalAccessibilityContext(context);
    if (types.isProxy(value) || !Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype) throw new Error();
    if (Object.getOwnPropertyDescriptor(value, "length")?.value !== 2) throw new Error();
    const fields = Object.getOwnPropertyDescriptors(value);
    if (Reflect.ownKeys(fields).length !== 3) throw new Error();
    const audits: TechnicalAccessibilityAudit[] = [];
    for (let index = 0; index < 2; index++) {
      const field = fields[String(index)];
      if (!field || !("value" in field)) throw new Error();
      const audit = readTechnicalAccessibilityAudit(field.value);
      if (audit.width !== [1440, 320][index] || audit.status !== "passed") throw new Error();
      audits.push(audit);
    }
    return Object.freeze({ ...identity, schemaVersion: "critical-surface-accessibility-v1", contextSchemaVersion: identity.schemaVersion,
      audits: Object.freeze(audits), status: "passed", scope: "ui-accessibility-observation-only" });
  } catch { throw new Error("Invalid critical accessibility qualification."); }
}
/** Native viewport facts stay separate from the fixed-width standard report. */
export function qualifyNativeCriticalAccessibilityReport(context: unknown, value: unknown) {
  try {
    const identity = readCriticalAccessibilityContext(context);
    if (identity.host === "managed-thin-chrome" || types.isProxy(value) || !Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype
      || Object.getOwnPropertyDescriptor(value, "length")?.value !== 2) throw new Error();
    const fields = Object.getOwnPropertyDescriptors(value);
    if (Reflect.ownKeys(fields).length !== 3) throw new Error();
    const audits: NativeAccessibilityAudit[] = [];
    for (let index = 0; index < 2; index++) {
      const field = fields[String(index)];
      if (!field || !("value" in field)) throw new Error();
      const audit = readNativeAccessibilityAudit(field.value);
      if (audit.media !== ["normal", "forced-colors"][index] || audit.status !== "passed") throw new Error();
      audits.push(audit);
    }
    return Object.freeze({ ...identity, schemaVersion: "native-critical-surface-accessibility-v1", contextSchemaVersion: identity.schemaVersion,
      audits: Object.freeze(audits), status: "passed", scope: "native-ui-observation-only" });
  } catch { throw new Error("Invalid native critical accessibility qualification."); }
}
export function readReducedMotionObservation(value: unknown) {
  try {
    const data = record(value, ["elements", "maximumTransitionMilliseconds", "maximumAnimationMilliseconds"]);
    const elements = count(data.elements, 100000, 1);
    for (const field of [data.maximumTransitionMilliseconds, data.maximumAnimationMilliseconds]) {
      if (typeof field !== "number" || !Number.isFinite(field) || field < 0 || field > 0.01) throw new Error();
    }
    return Object.freeze({ elements, maximumTransitionMilliseconds: data.maximumTransitionMilliseconds as number, maximumAnimationMilliseconds: data.maximumAnimationMilliseconds as number });
  } catch { throw new Error("Invalid reduced motion observation."); }
}

/** Geometry is measured in the browser; only finite counts cross this boundary. */
export function readControlAccessObservation(value: unknown) {
  try {
    const data = record(value, ["width", "controls", "inaccessible"]);
    if (data.width !== 320 && data.width !== 1440) throw new Error();
    const controls = count(data.controls, 10000, 1), inaccessible = count(data.inaccessible, controls);
    return Object.freeze({ width: data.width, controls, inaccessible, status: inaccessible === 0 ? "passed" : "failed" });
  } catch { throw new Error("Invalid control access observation."); }
}
