// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Page } from "@playwright/test";
const io = vi.hoisted(() => ({ failure: "", saved: [] as string[] }));
vi.mock("node:fs/promises", () => {
  const readFile = async () => {
    if (io.failure === "read") throw new Error("synthetic-private-read-path");
    if (io.failure === "parse") return Buffer.from("synthetic-private-invalid-json");
    return Buffer.from(JSON.stringify({ platform: process.platform, architecture: process.arch, logicalProcessors: 20, installedMemoryGiB: 16, deviceScaleFactor: 1, environmentId: "synthetic-reference" }));
  };
  const mkdir = async () => { if (io.failure === "mkdir") throw new Error("synthetic-private-directory"); };
  const writeFile = async (_name: unknown, body: string) => { io.saved.push(body); };
  return { readFile, mkdir, writeFile, default: { readFile, mkdir, writeFile } };
});
vi.mock("node:os", () => { const methods = { cpus: () => new Array(20).fill({}), totalmem: () => 16 * 1024 ** 3 }; return { ...methods, default: methods }; });
import { readTechnicalAccessibilityAudit, readContrastRetryDiagnostics, readTechnicalAccessibilityObservation, readNativeAccessibilityObservation, readNative400Frame, readNativeAccessibilityAudit, readCriticalAccessibilityMode,
  qualifyNativeCriticalAccessibilityReport } from "../visual-composer/technical-accessibility-observation";
import { collectSystemBuilderAccessibilityAudit, collectRuntimeAccessibilityAudit, collectDocumentAccessibilityAudit, collectDocumentAccessibilityObservation,
  collectRuntimeAccessibilityObservation, collectNativeDocumentAccessibilityObservation, collectNativeRuntimeAccessibilityObservation, finalizeTechnicalAccessibilityEvidence, qualifyTechnicalAccessibility } from "../visual-composer/e2e/technical-accessibility";
const base = () => ({ schemaVersion: "technical-accessibility-audit-v1", width: 320, violations: [] as Array<{ rule: string; nodes: number }>, incomplete: [] as Array<{ rule: string; nodes: number }>, contrastPassedNodes: 3, retries: { attempted: 0, passed: 0 } });
const invalid = "Invalid technical accessibility observation.";
const diagnostic = () => ({ schemaVersion: "contrast-retry-diagnostics-v1", attempted: 1, passed: 0,
  outcomes: { violation: 0, unresolved: 1, noPositiveSample: 0 },
  reasons: { bgGradient: 1, bgImage: 0, imgNode: 0, outsideViewport: 0, elmPartiallyObscuring: 0, elmPartiallyObscured: 0,
    bgOverlap: 0, colorParse: 0, equalRatio: 0, shortTextContent: 0, other: 0 },
  hints: { backgroundImage: 1, reducedOpacity: 0, clippedAncestor: 0, nonRgbColor: 0, ancestorLimit: 0, reasonScanLimit: 0 } });
const addedReasons = ["nonBmp", "pseudoContent", "complexTextShadows", "shadowOnBgColor", "fgOnShadowColor"] as const;
const diagnosticV2 = (reason: typeof addedReasons[number] = "pseudoContent") => {
  const reasons: Record<string, number> = { ...diagnostic().reasons, bgGradient: 0, ...Object.fromEntries(addedReasons.map(key => [key, 0])), [reason]: 1 };
  return { ...diagnostic(), schemaVersion: "contrast-retry-diagnostics-v2", reasons };
};

describe("closed failed-contrast diagnostic projection", () => {
  it("preserves original v1 serialized shape without inserting newer reason keys", () => {
    const original = diagnostic(), serialized = JSON.stringify(original), value = readContrastRetryDiagnostics(JSON.parse(serialized));
    expect(JSON.stringify(value)).toBe(serialized); expect(Object.keys(value.reasons)).toEqual(Object.keys(original.reasons));
    expect(value.reasons).not.toHaveProperty("pseudoContent"); expect(value.schemaVersion).toBe("contrast-retry-diagnostics-v1");
  });
  it.each(addedReasons)("retains the installed %s reason only in the new diagnostic version", reason => {
    const input = diagnosticV2(reason), value = readContrastRetryDiagnostics(input);
    expect(value.schemaVersion).toBe("contrast-retry-diagnostics-v2");
    if (value.schemaVersion !== "contrast-retry-diagnostics-v2") throw new Error("Expected current diagnostic version.");
    expect(value.reasons[reason]).toBe(1); expect(value.reasons.other).toBe(0); expect(Object.keys(value.reasons)).toHaveLength(16);
    for (const part of [value, value.outcomes, value.reasons, value.hints]) expect(Object.isFrozen(part)).toBe(true);
    input.reasons[reason] = 0; expect(value.reasons[reason]).toBe(1); expect(value).not.toHaveProperty("status");
  });
  it.each(["v1-with-v2-keys", "v2-with-v1-keys", "missing-current-key", "foreign-key", "non-engine-contributor", "successful-only-reason", "oversized-partition", "future-version"])("refuses %s instead of mixing diagnostic versions", kind => {
    let value: Record<string, unknown> = diagnosticV2();
    if (kind === "v1-with-v2-keys") value = { ...value, schemaVersion: "contrast-retry-diagnostics-v1" };
    if (kind === "v2-with-v1-keys") value = { ...value, reasons: diagnostic().reasons };
    if (kind === "missing-current-key") { const reasons = { ...diagnosticV2().reasons }; Reflect.deleteProperty(reasons, "complexTextShadows"); value = { ...value, reasons }; }
    if (kind === "foreign-key") value = { ...value, reasons: { ...diagnosticV2().reasons, privateCss: 0 } };
    if (kind === "non-engine-contributor") value = { ...value, reasons: { ...diagnosticV2().reasons, fgOnBgColor: 0 } };
    if (kind === "successful-only-reason") value = { ...value, reasons: { ...diagnosticV2().reasons, hidden: 0 } };
    if (kind === "oversized-partition") value = { ...value, reasons: { ...diagnosticV2().reasons, pseudoContent: 2 } };
    if (kind === "future-version") value = { ...value, schemaVersion: "contrast-retry-diagnostics-v3" };
    expect(() => readContrastRetryDiagnostics(value)).toThrow("Invalid contrast retry diagnostics.");
  });
  it.each(["getter", "proxy"])("rejects a current-version %s without reading private hooks", kind => {
    const input = diagnosticV2(); let hooks = 0;
    if (kind === "getter") Object.defineProperty(input.reasons, "pseudoContent", { get() { hooks++; return 1; } });
    else input.reasons = new Proxy(input.reasons, { getPrototypeOf() { hooks++; return Object.prototype; } });
    expect(() => readContrastRetryDiagnostics(input)).toThrow("Invalid contrast retry diagnostics."); expect(hooks).toBe(0);
  });
  it("keeps current-version observations failed when their original core retry is unresolved", () => {
    const core = { ...base(), incomplete: [{ rule: "color-contrast", nodes: 1 }], retries: { attempted: 1, passed: 0 } };
    const result = readTechnicalAccessibilityObservation({ audit: core, diagnostics: diagnosticV2() });
    expect(result.audit.status).toBe("failed"); expect(result.audit.failures).toContain("unresolved-contrast-retry");
    expect(() => readTechnicalAccessibilityObservation({ audit: base(), diagnostics: diagnosticV2() })).toThrow(invalid);
    const native = readNativeAccessibilityObservation({ audit: { ...nativeAudit().facts, incomplete: core.incomplete, retries: core.retries }, diagnostics: diagnosticV2() }, "normal", nativeFrame());
    expect(native.audit.status).toBe("failed"); expect(native.diagnostics.schemaVersion).toBe("contrast-retry-diagnostics-v2");
  });
  it("copies and freezes only finite partitioned counts without qualifying an audit", () => {
    const raw = diagnostic(), value = readContrastRetryDiagnostics(raw);
    raw.reasons.bgGradient = 0; raw.hints.backgroundImage = 0;
    expect(value.reasons.bgGradient).toBe(1); expect(value.hints.backgroundImage).toBe(1);
    for (const part of [value, value.outcomes, value.reasons, value.hints]) expect(Object.isFrozen(part)).toBe(true);
    expect(value).not.toHaveProperty("status"); expect(value).not.toHaveProperty("failures");
  });
  it.each([
    { schemaVersion: "other" }, { attempted: 1001 }, { passed: 2 }, { attempted: 1.5 }, { attempted: NaN },
    { outcomes: { violation: 0, unresolved: 0, noPositiveSample: 0 } },
    { reasons: { ...diagnostic().reasons, bgGradient: 2 } }, { reasons: { ...diagnostic().reasons, other: 1 } },
    { hints: { ...diagnostic().hints, backgroundImage: Infinity } }, { hints: { ...diagnostic().hints, reasonScanLimit: -1 } },
    { selector: "synthetic-private-selector" }, { hints: { ...diagnostic().hints, css: "synthetic-private-css" } },
  ])("rejects excessive, inconsistent and private diagnostic input %#", change => {
    expect(() => readContrastRetryDiagnostics({ ...diagnostic(), ...change })).toThrow("Invalid contrast retry diagnostics.");
  });
  it.each(["getter", "nested-getter", "proxy", "nested-proxy", "revoked", "symbol"])("rejects %s without executing its hooks", kind => {
    const raw = diagnostic(); let value: unknown = raw, hooks = 0;
    if (kind === "getter") Object.defineProperty(raw, "attempted", { get() { hooks++; return 1; } });
    if (kind === "nested-getter") Object.defineProperty(raw.hints, "backgroundImage", { get() { hooks++; return 1; } });
    if (kind === "proxy") value = new Proxy(raw, { ownKeys() { hooks++; return []; } });
    if (kind === "nested-proxy") raw.reasons = new Proxy(raw.reasons, { getPrototypeOf() { hooks++; return Object.prototype; } });
    if (kind === "revoked") { const p = Proxy.revocable(raw, {}); p.revoke(); value = p.proxy; }
    if (kind === "symbol") Object.defineProperty(raw, Symbol("synthetic-private"), { value: 1 });
    expect(() => readContrastRetryDiagnostics(value)).toThrow("Invalid contrast retry diagnostics."); expect(hooks).toBe(0);
  });
  it("requires the diagnostic counts to match the independently read core audit", () => {
    const core = { ...base(), incomplete: [{ rule: "color-contrast", nodes: 1 }], retries: { attempted: 1, passed: 0 } };
    const value = readTechnicalAccessibilityObservation({ audit: core, diagnostics: diagnostic() });
    expect(value.audit.status).toBe("failed"); expect(value.audit).not.toHaveProperty("diagnostics"); expect(Object.isFrozen(value)).toBe(true);
    expect(() => readTechnicalAccessibilityObservation({ audit: base(), diagnostics: diagnostic() })).toThrow(invalid);
    const native = readNativeAccessibilityObservation({ audit: { ...nativeAudit().facts, incomplete: core.incomplete, retries: core.retries }, diagnostics: diagnostic() }, "normal", nativeFrame());
    expect(native.audit.status).toBe("failed"); expect(native.audit.frame.innerWidth).toBe(356);
  });
  it.each(["missing", "extra", "getter", "proxy"])("rejects %s observation envelope without a fallback or executable hook", kind => {
    let hooks = 0; let raw: unknown = { audit: base(), diagnostics: diagnostic() };
    if (kind === "missing") raw = { audit: base() };
    if (kind === "extra") raw = { audit: base(), diagnostics: diagnostic(), private: "synthetic-private" };
    if (kind === "getter") Object.defineProperty(raw, "audit", { get() { hooks++; return base(); } });
    if (kind === "proxy") raw = new Proxy(raw as object, { getPrototypeOf() { hooks++; return Object.prototype; } });
    expect(() => readTechnicalAccessibilityObservation(raw)).toThrow(invalid); expect(hooks).toBe(0);
  });
});

const nativeFrame = () => ({dpr:4,cssZoom:"1",visualScale:1,outerWidth:1440,innerWidth:356,layoutWidth:356,overflow:0,controls:2,inaccessible:0});
const nativeAudit = (media = "normal") => ({schemaVersion:"native-technical-accessibility-audit-v1",media,frame:nativeFrame(),
  facts:{violations:[],incomplete:[],contrastPassedNodes:3,retries:{attempted:0,passed:0}}});
const nativeContext = () => ({schemaVersion:"critical-accessibility-context-v1",host:"thin-chrome",surface:"settings",
  runId:"native-fixture-1234567890",sourceRevision:`source.${"a".repeat(64)}`,testKey:"b".repeat(64)});

describe("separate inert native zoom evidence", () => {
  it("retains the actual CSS width and both ordered media checks without inventing a standard width", () => {
    const raw=nativeAudit(), frame=readNative400Frame(raw.frame), audit=readNativeAccessibilityAudit(raw);
    raw.frame.innerWidth=320;
    expect(frame.innerWidth).toBe(356);expect(audit.frame.innerWidth).toBe(356);expect(audit.status).toBe("passed");
    expect(audit).not.toHaveProperty("width");expect(Object.isFrozen(audit.frame)).toBe(true);
    const report=qualifyNativeCriticalAccessibilityReport(nativeContext(),[nativeAudit(),nativeAudit("forced-colors")]);
    expect(report.schemaVersion).toBe("native-critical-surface-accessibility-v1");expect(report.scope).toBe("native-ui-observation-only");
    expect(Object.isFrozen(report.audits)).toBe(true);expect(report.audits.map(item=>item.frame.innerWidth)).toEqual([356,356]);
    expect(()=>readTechnicalAccessibilityAudit(nativeAudit())).toThrow(invalid);
    expect(()=>readNativeAccessibilityAudit(base())).toThrow("Invalid native accessibility observation.");
  });
  it.each(["standard","native400"])("admits only the declared %s mode",mode=>expect(readCriticalAccessibilityMode(mode)).toBe(mode));
  it.each([null,undefined,{},"",4,"native","STANDARD"])("rejects unknown mode %#",mode=>expect(()=>readCriticalAccessibilityMode(mode)).toThrow("Invalid critical accessibility mode."));
  it.each([{dpr:1},{dpr:3.99},{dpr:NaN},{dpr:Infinity},{cssZoom:"4"},{visualScale:4},{outerWidth:1399},{outerWidth:1461},
    {innerWidth:319},{innerWidth:361},{layoutWidth:357},{layoutWidth:0},{overflow:-1},{overflow:100001},{controls:0},{controls:10001},
    {inaccessible:3},{controls:1.5},{selector:"synthetic-private"},{status:"passed"}])("rejects frame substitutes, malformed bounds and private extras %#",change=>{
    expect(()=>readNative400Frame({...nativeFrame(),...change})).toThrow("Invalid native accessibility observation.");
  });
  it.each([{overflow:2},{inaccessible:1}])("retains valid failed frame facts %#",change=>{
    const result=readNative400Frame({...nativeFrame(),...change});expect(result.status).toBe("failed");expect(result.failures).toHaveLength(1);
    expect(readNativeAccessibilityAudit({...nativeAudit(),frame:{...nativeFrame(),...change}}).status).toBe("failed");
  });
  it.each([{media:"unknown"},{schemaVersion:"technical-accessibility-audit-v1"},{width:320},{facts:{...nativeAudit().facts,source:"synthetic-private"}},
    {facts:{...nativeAudit().facts,retries:{attempted:1,passed:1}}}, {facts:{...nativeAudit().facts,violations:[{rule:"synthetic-private",nodes:1}]}}])("rejects unsupported audit fields %#",change=>{
    expect(()=>readNativeAccessibilityAudit({...nativeAudit(),...change})).toThrow("Invalid native accessibility observation.");
  });
  it("retains rule, contrast and retry failures rather than treating a valid frame as a pass",()=>{
    const raw=nativeAudit();const result=readNativeAccessibilityAudit({...raw,facts:{...raw.facts,contrastPassedNodes:0,violations:[{rule:"button-name",nodes:1}]}});
    expect(result.failures).toEqual(["rule-violation","missing-contrast-sample"]);expect(result.status).toBe("failed");
  });
  it.each(["frame-getter","frame-proxy","facts-getter","audit-proxy","array-proxy","array-getter","array-symbol","revoked"] as const)("rejects %s without running hooks",kind=>{
    let calls=0;const raw=nativeAudit();let value:unknown=raw;
    if(kind==="frame-getter")Object.defineProperty(raw.frame,"innerWidth",{get(){calls++;return 356;}});
    if(kind==="frame-proxy")raw.frame=new Proxy(raw.frame,{getPrototypeOf(target){calls++;return Reflect.getPrototypeOf(target);}});
    if(kind==="facts-getter")Object.defineProperty(raw,"facts",{get(){calls++;return {};}});
    if(kind==="audit-proxy")value=new Proxy(raw,{ownKeys(target){calls++;return Reflect.ownKeys(target);}});
    if(kind==="revoked"){const p=Proxy.revocable(raw,{});p.revoke();value=p.proxy;}
    if(kind.startsWith("array-")){
      const values=[nativeAudit(),nativeAudit("forced-colors")];let array:unknown=values;
      if(kind==="array-getter")Object.defineProperty(values,"0",{get(){calls++;return raw;}});
      if(kind==="array-symbol")Object.defineProperty(values,Symbol.iterator,{value:function*(){calls++;yield raw;}});
      if(kind==="array-proxy")array=new Proxy(values,{ownKeys(target){calls++;return Reflect.ownKeys(target);}});
      expect(()=>qualifyNativeCriticalAccessibilityReport(nativeContext(),array)).toThrow("Invalid native critical accessibility qualification.");
    }else expect(()=>readNativeAccessibilityAudit(value)).toThrow("Invalid native accessibility observation.");
    expect(calls).toBe(0);
  });
  it.each([[],[nativeAudit()],[nativeAudit("forced-colors"),nativeAudit()],[nativeAudit(),nativeAudit()],new Array(2),
    [nativeAudit(),{...nativeAudit("forced-colors"),frame:{...nativeFrame(),inaccessible:1}}]])("requires exactly two successful ordered media observations %#",value=>{
    expect(()=>qualifyNativeCriticalAccessibilityReport(nativeContext(),value)).toThrow("Invalid native critical accessibility qualification.");
  });
  it("does not qualify the separate managed-host/native path",()=>{
    expect(()=>qualifyNativeCriticalAccessibilityReport({...nativeContext(),host:"managed-thin-chrome"},[nativeAudit(),nativeAudit("forced-colors")])).toThrow("Invalid native critical accessibility qualification.");
  });
});

describe("private-free computed accessibility observations", () => {
  it.each([320, 1440])("requires actual contrast samples at the declared %ipx width", width => {
    const report = readTechnicalAccessibilityAudit({ ...base(), width });
    expect(report.status).toBe("passed"); expect(report.failures).toEqual([]);
    expect(Object.isFrozen(report)).toBe(true); expect(Object.isFrozen(report.retries)).toBe(true);
    expect(Object.keys(report).sort()).toEqual(["schemaVersion", "width", "violations", "incomplete", "contrastPassedNodes", "retries", "status", "failures"].sort());
  });
  it("requires every offscreen contrast retry to resolve and copies only trusted rules/counts", () => {
    const value = { ...base(), incomplete: [{ rule: "color-contrast", nodes: 2 }], retries: { attempted: 2, passed: 2 } };
    const report = readTechnicalAccessibilityAudit(value); value.incomplete[0]!.rule = "synthetic-private-selector"; value.retries.passed = 0;
    expect(report.status).toBe("passed"); expect(report.incomplete).toEqual([{ rule: "color-contrast", nodes: 2 }]);
    expect(Object.isFrozen(report.incomplete)).toBe(true); expect(Object.isFrozen(report.incomplete[0])).toBe(true);
    expect(JSON.stringify(report)).not.toContain("synthetic-private-selector");
  });
  it.each([
    [{ violations: [{ rule: "button-name", nodes: 1 }] }, "rule-violation"],
    [{ incomplete: [{ rule: "aria-roles", nodes: 1 }] }, "unresolved-rule"],
    [{ incomplete: [{ rule: "color-contrast", nodes: 2 }], retries: { attempted: 1, passed: 1 } }, "unresolved-contrast-retry"],
    [{ incomplete: [{ rule: "color-contrast", nodes: 2 }], retries: { attempted: 2, passed: 1 } }, "unresolved-contrast-retry"],
    [{ contrastPassedNodes: 0 }, "missing-contrast-sample"],
  ] as const)("retains a legitimate failed observation instead of granting a pass %#", (change, failure) => {
    const report = readTechnicalAccessibilityAudit({ ...base(), ...change });
    expect(report.status).toBe("failed"); expect(report.failures).toContain(failure);
  });
  it.each([
    { width: 400 }, { schemaVersion: "other" }, { source: "synthetic-private-content" },
    { violations: [{ rule: "synthetic-private-payload", nodes: 1 }] },
    { violations: [{ rule: "button-name", nodes: 1, selector: "synthetic-private-selector" }] },
    { incomplete: [{ rule: "color-contrast", nodes: 1, messages: ["synthetic-private-message"] }] },
    { violations: [{ rule: "button-name", nodes: 0 }] },
    { violations: [{ rule: "button-name", nodes: 10001 }] },
    { violations: [{ rule: "button-name", nodes: 1 }, { rule: "button-name", nodes: 1 }] },
    { violations: new Array(1) }, { violations: new Array(513) },
    { contrastPassedNodes: NaN }, { contrastPassedNodes: Infinity }, { contrastPassedNodes: -1 }, { contrastPassedNodes: 1.5 },
    { retries: { attempted: 1, passed: 1 } }, { retries: { attempted: 0, passed: 1 } },
    { incomplete: [{ rule: "color-contrast", nodes: 1001 }], retries: { attempted: 1001, passed: 1001 } },
    { retries: { attempted: 0, passed: 0, selector: "synthetic-private-selector" } },
  ])("rejects malformed, excessive, inconsistent or private data with fixed diagnostics %#", change => {
    expect(() => readTechnicalAccessibilityAudit({ ...base(), ...change })).toThrow(invalid);
  });
  it.each(["record-accessor", "array-accessor", "custom-iterator", "extra-symbol", "record-proxy", "array-proxy", "revoked-proxy"] as const)("never executes %s observation hooks", kind => {
    const input = base(); let value: unknown = input, calls = 0;
    if (kind === "record-accessor") Object.defineProperty(input, "width", { get: () => { calls++; return 320; } });
    if (kind === "array-accessor") { input.violations.length = 1; Object.defineProperty(input.violations, "0", { get: () => { calls++; return { rule: "button-name", nodes: 1 }; } }); }
    if (kind === "custom-iterator") Object.defineProperty(input.violations, Symbol.iterator, { value: function* () { calls++; yield "synthetic-private-payload"; } });
    if (kind === "extra-symbol") Object.defineProperty(input, Symbol("synthetic-private-payload"), { value: 1 });
    if (kind === "record-proxy") value = new Proxy(input, { ownKeys: target => { calls++; return Reflect.ownKeys(target); } });
    if (kind === "array-proxy") input.violations = new Proxy(input.violations, { getPrototypeOf: target => { calls++; return Reflect.getPrototypeOf(target); } });
    if (kind === "revoked-proxy") { const proxy = Proxy.revocable(input, {}); proxy.revoke(); value = proxy.proxy; }
    expect(() => readTechnicalAccessibilityAudit(value)).toThrow(invalid); expect(calls).toBe(0);
  });
  it("retains the prior requirement for a direct contrast sample even if all retries passed", () => {
    const report = readTechnicalAccessibilityAudit({ ...base(), contrastPassedNodes: 0, incomplete: [{ rule: "color-contrast", nodes: 1 }], retries: { attempted: 1, passed: 1 } });
    expect(report.status).toBe("failed"); expect(report.failures).toEqual(["missing-contrast-sample"]);
  });
});

describe("truthful accessibility finalization", () => {
  it("restores media before publishing passed evidence and attaching it", async () => {
    const steps: string[] = [], report = { status: "passed" };
    await finalizeTechnicalAccessibilityEvidence(report, async () => { steps.push(`save:${report.status}`); }, async () => { steps.push("attach"); }, async () => { steps.push("restore"); });
    expect(steps).toEqual(["restore", "save:passed", "attach"]);
  });
  it.each(["media-restore", "evidence-save", "evidence-attach"] as const)("records failed evidence for %s without retaining raw exceptions", async failure => {
    const report: Record<string, unknown> = { status: "passed" }, writes: string[] = [];
    const save = async () => { if (failure === "evidence-save" && report.status === "passed") throw new Error("synthetic-private-disk"); writes.push(JSON.stringify(report)); };
    const attach = async () => { if (failure === "evidence-attach") throw new Error("synthetic-private-attachment"); };
    const restore = async () => { if (failure === "media-restore") throw new Error("synthetic-private-browser"); };
    await expect(finalizeTechnicalAccessibilityEvidence(report, save, attach, restore)).rejects.toThrow(`Technical accessibility finalization failed at ${failure}.`);
    expect(report.status).toBe("failed"); expect(report.failureStage).toBe(failure);
    expect(JSON.parse(writes[writes.length - 1]!).status).toBe("failed"); expect(writes.join("")).not.toContain("synthetic-private");
  });
  it("retains the original failed check when media restoration also fails", async () => {
    const report: Record<string, unknown> = { status: "failed", failureStage: "keyboard-modal-focus" };
    await expect(finalizeTechnicalAccessibilityEvidence(report, async () => undefined, async () => undefined, async () => { throw new Error("synthetic-private-restore"); })).rejects.toThrow("Technical accessibility finalization failed at media-restore.");
    expect(report.failureStage).toBe("keyboard-modal-focus"); expect(report.finalizationStage).toBe("media-restore");
  });
  it("fails the test even if failed evidence cannot be written", async () => {
    const report: Record<string, unknown> = { status: "passed" };
    await expect(finalizeTechnicalAccessibilityEvidence(report, async () => { throw new Error("synthetic-private-storage"); }, async () => undefined, async () => undefined)).rejects.toThrow("Technical accessibility finalization failed at evidence-save.");
    expect(report.status).toBe("failed");
  });
});

describe("browser-local contrast retry projection (synthetic DOM only)", () => {
  let oldAxe: PropertyDescriptor | undefined;
  const page = { evaluate: async (callback: (value: unknown) => unknown, value: unknown) => callback(value) } as unknown as Page;
  const node = () => ({ target: ["#synthetic-private-selector"], any: [{ message: "synthetic-private-message" }] });
  const result = () => ({ violations: [] as unknown[], incomplete: [] as unknown[], passes: [{ id: "color-contrast", nodes: [node()] }] });
  const install = (run: (...args: unknown[]) => unknown) => Object.defineProperty(window, "axe", { configurable: true, value: { run } });
  beforeEach(() => {
    oldAxe = Object.getOwnPropertyDescriptor(window, "axe");
    document.body.innerHTML = '<div class="system-builder"><button id="synthetic-private-selector">Synthetic private text</button></div>';
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => { callback(0); return 1; });
    const target = document.getElementById("synthetic-private-selector")!;
    Object.defineProperty(target, "scrollIntoView", { value: vi.fn() });
    Object.defineProperty(target, "getClientRects", { configurable: true, value: () => [{ width: 1, height: 1 }] });
    Object.defineProperty(target, "getBoundingClientRect", { configurable: true, value: () => ({ width: 1, height: 1 }) });
  });
  afterEach(() => {
    if (oldAxe) Object.defineProperty(window, "axe", oldAxe); else Reflect.deleteProperty(window, "axe");
    document.body.replaceChildren(); vi.unstubAllGlobals();
  });
  it("uses each unique visible retry target without returning its selector/message/text", async () => {
    let calls = 0;
    install(async context => {
      calls++;
      if (calls === 1) return { ...result(), incomplete: [{ id: "color-contrast", nodes: [node()] }] };
      expect(context).toEqual({ include: [["#synthetic-private-selector"]] }); return result();
    });
    const report = await collectSystemBuilderAccessibilityAudit(page, 320);
    expect(calls).toBe(2); expect(report.status).toBe("passed"); expect(report.retries).toEqual({ attempted: 1, passed: 1 });
    expect(JSON.stringify(report)).not.toMatch(/synthetic-private|Synthetic private|selector|message|target/);
  });
  it("uses the complete runtime document and retains browser-local contrast retries", async () => {
    const main = document.createElement("main"); main.className = "system-runtime-app";
    const content = document.body.firstElementChild!; content.replaceWith(main); main.append(content);
    let calls = 0;
    install(async context => {
      if (++calls === 1) { expect(context).toBe("body"); return { ...result(), incomplete: [{ id: "color-contrast", nodes: [node()] }] }; }
      expect(context).toEqual({ include: [["#synthetic-private-selector"]] }); return result();
    });
    const report = await collectRuntimeAccessibilityAudit(page, 320);
    expect(calls).toBe(2); expect(report.status).toBe("passed"); expect(report.retries).toEqual({ attempted: 1, passed: 1 });
    expect(JSON.stringify(report)).not.toContain("synthetic-private");
  });
  it.each(["missing", "wrong-shell", "duplicate"] as const)("refuses runtime %s at the actual browser collection boundary", async fault => {
    if (fault !== "missing") {
      const main = document.createElement("main"); main.className = fault === "wrong-shell" ? "ui-shell" : "system-runtime-app"; document.body.append(main);
      if (fault === "duplicate") document.body.append(main.cloneNode(true));
    }
    const run = vi.fn(); install(run);
    await expect(collectRuntimeAccessibilityAudit(page, 1440)).rejects.toThrow("Computed accessibility audit failed.");
    expect(run).not.toHaveBeenCalled();
  });
  it("keeps builder-shell admission separate from the standalone runtime", async () => {
    const main = document.createElement("main"); main.className = "system-runtime-app"; document.body.append(main);
    const run = vi.fn(); install(run);
    await expect(collectDocumentAccessibilityAudit(page, 320)).rejects.toThrow("Computed accessibility audit failed.");
    expect(run).not.toHaveBeenCalled();
  });
  it("refuses an unsupported viewport before browser evaluation", async () => {
    const evaluate = vi.fn();
    await expect(collectSystemBuilderAccessibilityAudit({ evaluate } as unknown as Page, 400 as never)).rejects.toThrow(invalid);
    expect(evaluate).not.toHaveBeenCalled();
  });
  it.each([collectSystemBuilderAccessibilityAudit,collectDocumentAccessibilityAudit,collectRuntimeAccessibilityAudit])("keeps native mode out of standard collector entry points %#",async collect=>{
    const evaluate=vi.fn();await expect(collect({evaluate} as unknown as Page,"native400" as never)).rejects.toThrow(invalid);
    expect(evaluate).not.toHaveBeenCalled();
  });
  it.each(["violation", "incomplete", "no-passed-node"] as const)("retains failed retry evidence for %s", async kind => {
    let calls = 0;
    install(async () => {
      if (++calls === 1) return { ...result(), incomplete: [{ id: "color-contrast", nodes: [node()] }] };
      if (kind === "violation") return { ...result(), violations: [{ id: "color-contrast", nodes: [node()] }] };
      if (kind === "incomplete") return { ...result(), incomplete: [{ id: "color-contrast", nodes: [node()] }] };
      return { ...result(), passes: [] };
    });
    const report = await collectSystemBuilderAccessibilityAudit(page, 1440);
    expect(report.status).toBe("failed"); expect(report.retries).toEqual({ attempted: 1, passed: 0 });
    expect(report.failures).toContain("unresolved-contrast-retry"); expect(JSON.stringify(report)).not.toContain("synthetic-private");
  });
  it.each(["bgGradient", "bgImage", "imgNode", "outsideViewport", "elmPartiallyObscuring", "elmPartiallyObscured", "bgOverlap", "colorParse", "equalRatio", "shortTextContent", "synthetic-private-reason"])("projects only the fixed engine reason for %s", async messageKey => {
    const main = document.createElement("main"); main.className = "ui-shell";
    const content = document.body.firstElementChild!; content.replaceWith(main); main.append(content);
    main.style.backgroundImage = 'linear-gradient(red, blue)'; main.style.opacity = '0.5'; main.style.overflowX = 'hidden';
    let calls = 0;
    install(async () => {
      const retry = { ...node(), any: [{ id: "color-contrast", message: "synthetic-private-message", data: { messageKey, fgColor: "synthetic-private-color" } }] };
      return ++calls === 1 ? { ...result(), incomplete: [{ id: "color-contrast", nodes: [node()] }] }
        : { ...result(), incomplete: [{ id: "color-contrast", nodes: [retry] }] };
    });
    const value = await collectDocumentAccessibilityObservation(page, 1440);
    expect(calls).toBe(2); expect(value.audit.status).toBe("failed"); expect(value.audit.retries).toEqual({ attempted: 1, passed: 0 });
    expect(value.diagnostics.reasons[messageKey.startsWith("synthetic") ? "other" : messageKey as keyof typeof value.diagnostics.reasons]).toBe(1);
    expect(value.diagnostics.outcomes).toEqual({ violation: 0, unresolved: 1, noPositiveSample: 0 });
    expect(value.diagnostics.hints).toMatchObject({ backgroundImage: 1, reducedOpacity: 1, clippedAncestor: 1, ancestorLimit: 0, reasonScanLimit: 0 });
    expect(Object.isFrozen(value.diagnostics.hints)).toBe(true);
    expect(JSON.stringify(value)).not.toMatch(/synthetic-private|Synthetic private|selector|messageKey|fgColor|linear-gradient/);
  });
  it.each(["violation", "unresolved", "noPositiveSample"] as const)("partitions the actual %s retry without adding an audit, scroll or wait", async outcome => {
    const main = document.createElement("main"); main.className = "ui-shell"; document.body.append(main); main.append(document.querySelector(".system-builder")!);
    let calls = 0; const frames = vi.fn((callback: FrameRequestCallback) => { callback(0); return 1; }); vi.stubGlobal("requestAnimationFrame", frames);
    install(async () => {
      if (++calls === 1) return { ...result(), incomplete: [{ id: "color-contrast", nodes: [node()] }] };
      return { violations: outcome === "violation" ? [{ id: "color-contrast", nodes: [node()] }] : [],
        incomplete: outcome === "unresolved" ? [{ id: "color-contrast", nodes: [node()] }] : [], passes: [] };
    });
    const value = await collectDocumentAccessibilityObservation(page, 320);
    expect(value.diagnostics.outcomes[outcome]).toBe(1); expect(value.diagnostics.reasons.other).toBe(1);
    expect(calls).toBe(2); expect(frames).toHaveBeenCalledTimes(2);
    expect(document.getElementById("synthetic-private-selector")!.scrollIntoView).toHaveBeenCalledTimes(1);
    expect(value.audit.status).toBe("failed");
  });
  it("bounds diagnostic ancestry and engine-check inspection without suppressing the failed retry", async () => {
    const main = document.createElement("main"); main.className = "ui-shell"; document.body.append(main);
    let parent: Element = main;
    for (let depth = 0; depth < 80; depth++) { const child = document.createElement("div"); parent.append(child); parent = child; }
    parent.append(document.querySelector(".system-builder")!);
    let calls = 0;
    install(async () => ++calls === 1 ? { ...result(), incomplete: [{ id: "color-contrast", nodes: [node()] }] }
      : { ...result(), incomplete: [{ id: "color-contrast", nodes: [{ ...node(), any: new Array(65).fill({ id: "color-contrast", data: { messageKey: "bgGradient" } }) }] }] });
    const value = await collectDocumentAccessibilityObservation(page, 320);
    expect(value.diagnostics.hints.ancestorLimit).toBe(1); expect(value.diagnostics.hints.reasonScanLimit).toBe(1);
    expect(value.diagnostics.reasons.other).toBe(1); expect(value.audit.status).toBe("failed"); expect(calls).toBe(2);
  });
  it("retains the exact successful core audit and an independent zero-count projection", async () => {
    const main = document.createElement("main"); main.className = "ui-shell"; document.body.append(main);
    install(async () => result());
    const original = await collectDocumentAccessibilityAudit(page, 1440), value = await collectDocumentAccessibilityObservation(page, 1440);
    expect(JSON.stringify(value.audit)).toBe(JSON.stringify(original)); expect(value.audit).not.toHaveProperty("diagnostics");
    expect(value.diagnostics.attempted).toBe(0); expect(Object.values(value.diagnostics.reasons).every(n => n === 0)).toBe(true);
  });
  it.each([
    { collect: collectDocumentAccessibilityObservation, argument: 1440 }, { collect: collectRuntimeAccessibilityObservation, argument: 1440 },
    { collect: collectNativeDocumentAccessibilityObservation, argument: "normal" }, { collect: collectNativeRuntimeAccessibilityObservation, argument: "normal" },
  ])("rejects extra observer arguments before Page effects %#", async ({ collect, argument }) => {
    let calls = 0; const callback = new Proxy(() => undefined, { apply() { calls++; throw new Error("synthetic-private-callback"); } });
    const evaluate = vi.fn();
    await expect((collect as (...args: unknown[]) => Promise<unknown>)({ evaluate }, argument, callback)).rejects.toThrow(/Invalid .* accessibility observation\./);
    expect(evaluate).not.toHaveBeenCalled(); expect(calls).toBe(0);
  });
  it.each(["missing-target", "unknown-rule", "throw-private", "duplicate-rule", "excess-retry-nodes", "hidden-target", "replaced-target", "zero-width", "zero-height"] as const)("reports a fixed browser-stage failure for %s", async kind => {
    let calls = 0;
    install(async () => {
      calls++;
      if (kind === "throw-private") throw new Error("synthetic-private-exception");
      if (kind === "unknown-rule") return { ...result(), violations: [{ id: "synthetic-private-rule", nodes: [node()] }] };
      if (kind === "duplicate-rule") return { ...result(), incomplete: [{ id: "color-contrast", nodes: [node()] }, { id: "color-contrast", nodes: [node()] }] };
      if (kind === "excess-retry-nodes") return { ...result(), incomplete: [{ id: "color-contrast", nodes: new Array(1001).fill(node()) }] };
      if (kind === "hidden-target") { document.getElementById("synthetic-private-selector")!.style.visibility = "hidden"; return { ...result(), incomplete: [{ id: "color-contrast", nodes: [node()] }] }; }
      if (kind === "zero-width" || kind === "zero-height") {
        Object.defineProperty(document.getElementById("synthetic-private-selector")!, "getBoundingClientRect", { value: () => ({ width: kind === "zero-width" ? 0 : 1, height: kind === "zero-height" ? 0 : 1 }) });
        return calls === 1 ? { ...result(), incomplete: [{ id: "color-contrast", nodes: [node()] }] } : result();
      }
      if (kind === "replaced-target") {
        if (calls === 1) return { ...result(), incomplete: [{ id: "color-contrast", nodes: [node()] }] };
        document.getElementById("synthetic-private-selector")!.remove(); return result();
      }
      return { ...result(), incomplete: [{ id: "color-contrast", nodes: [{ target: ["#synthetic-private-absent"] }] }] };
    });
    await expect(collectSystemBuilderAccessibilityAudit(page, 320)).rejects.toThrow("Computed accessibility audit failed.");
    expect(calls).toBe(kind === "replaced-target" ? 2 : 1);
  });
});

describe("outer accessibility evidence boundary (inert IO)", () => {
  beforeEach(() => {
    io.failure = ""; io.saved.length = 0;
    vi.stubEnv("VISUAL_COMPOSER_QUALIFICATION_RUN_ID", "accessibility-fixture-1234567890");
    vi.stubEnv("VISUAL_COMPOSER_QUALIFICATION_SOURCE_REVISION", `source.${"a".repeat(64)}`);
  });
  afterEach(() => { io.failure = ""; vi.unstubAllEnvs(); });
  const info = { project: { name: "thin-chrome" }, attach: async () => undefined } as unknown as import("@playwright/test").TestInfo;
  it.each(["read", "parse", "mkdir"])("normalizes %s setup errors without opening a browser", async failure => {
    io.failure = failure; const evaluate = vi.fn();
    await expect(qualifyTechnicalAccessibility({ evaluate } as unknown as Page, info)).rejects.toThrow(/^Technical accessibility setup failed at (reference-profile|evidence-setup)\.$/);
    expect(evaluate).not.toHaveBeenCalled(); expect(io.saved.join("")).not.toContain("synthetic-private");
  });
  it.each(["synthetic-private-scale", { deviceScaleFactor: "synthetic-private-scale", extra: "synthetic-private-extra" }, NaN])("does not persist invalid browser scale data %#", async scale => {
    const page = { evaluate: async () => scale, emulateMedia: async () => undefined } as unknown as Page;
    await expect(qualifyTechnicalAccessibility(page, info)).rejects.toThrow("Technical accessibility check failed at browser-profile.");
    const report = JSON.parse(io.saved[io.saved.length - 1]!);
    expect(report.status).toBe("failed"); expect(report.browser).toBeUndefined(); expect(io.saved.join("")).not.toContain("synthetic-private");
  });
});
