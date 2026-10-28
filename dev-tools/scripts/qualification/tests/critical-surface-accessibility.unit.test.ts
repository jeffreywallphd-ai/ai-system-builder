// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Page, TestInfo } from "@playwright/test";
const probe = vi.hoisted(() => ({ exists: false, readFails: false, attachFails: false, restoreFails: false, auditFails: false, calls: 0,
  forcedAuditFails: false, forcedMediaFails: false, forcedColors: "none",
  writes: [] as string[], flags: [] as string[], attachments: [] as string[], widths: [] as number[], motion: "no-preference" }));
vi.mock("node:fs/promises", () => {
  const readFile = async (name: string) => {
    if (probe.readFails) throw new Error("synthetic-private-reference-path");
    if (name.endsWith("axe.min.js")) return "synthetic-audit-engine";
    return Buffer.from(JSON.stringify({ platform: process.platform, architecture: process.arch, logicalProcessors: 20, installedMemoryGiB: 16, deviceScaleFactor: 1, environmentId: "synthetic-reference" }));
  };
  const mkdir = async () => undefined;
  const writeFile = async (_name: string, body: string, options: { flag: string }) => {
    probe.flags.push(options.flag);
    if (options.flag === "wx" && probe.exists) throw new Error("synthetic-private-retained-path");
    probe.exists = true; probe.writes.push(body);
  };
  const unexpectedOcrIo = async () => { throw new Error("synthetic-private-unexpected-ocr-io"); };
  return { readFile, mkdir, writeFile, lstat: unexpectedOcrIo, realpath: unexpectedOcrIo, default: { readFile, mkdir, writeFile } };
});
vi.mock("node:os", () => { const methods = { cpus: () => new Array(20).fill({}), totalmem: () => 16 * 1024 ** 3 }; return { ...methods, default: methods }; });
import { qualifyCriticalAccessibilityReport, readCriticalAccessibilityContext, readReducedMotionObservation, readControlAccessObservation } from "../visual-composer/technical-accessibility-observation";
import { qualifyCriticalSurfaceAccessibility } from "../visual-composer/e2e/critical-surface-accessibility";
import { prepareGuidedSystemLifecycle } from "../visual-composer/e2e/guided-system-lifecycle";
import { qualifyOcrDatasetJourney } from "../visual-composer/e2e/ocr-dataset-journey";

const context = () => ({ schemaVersion: "critical-accessibility-context-v1", runId: "critical-fixture-1234567890", sourceRevision: `source.${"a".repeat(64)}`, host: "thin-chrome", surface: "settings", testKey: "b".repeat(64) });
const audit = (width: number) => ({ schemaVersion: "technical-accessibility-audit-v1", width, violations: [], incomplete: [], contrastPassedNodes: 1, retries: { attempted: 0, passed: 0 } });

describe("closed critical accessibility qualification", () => {
  it.each(["settings", "security", "notifications", "data-ingestion", "dataset-preparation", "dataset-versions", "dataset-review", "dataset-row-edit",
    "dataset-output-shape", "context-rag", "context-pack", "manual-context-review", "context-browser", "asset-import", "asset-customization", "asset-studio", "asset-saved", "asset-detail",
    "system-element-picker", "system-preview", "system-properties", "system-layers", "workspace-create", "system-manage",
    "system-build-dialog", "system-publish", "system-publication-confirm", "models-discovery", "models-inventory", "image-configuration",
    "ocr-configuration", "ocr-output-review"])("copies supported %s context and requires both exact ordered widths", surface => {
    const value = { ...context(), surface }, result = qualifyCriticalAccessibilityReport(value, [audit(1440), audit(320)]);
    value.surface = "synthetic-private-context";
    expect(result.schemaVersion).toBe("critical-surface-accessibility-v1"); expect(result.contextSchemaVersion).toBe("critical-accessibility-context-v1");
    expect(result.surface).toBe(surface); expect(result.status).toBe("passed"); expect(Object.isFrozen(result.audits)).toBe(true);
  });
  it.each([{ surface: "../outside" }, { surface: ".private-selector" }, { host: "unknown" }, { host: "packaged-desktop", surface: "security" },
    { host: "thin-chrome", surface: "runtime-conversation" }, { host: "managed-thin-chrome", surface: "runtime-conversation" },
    { host: "thin-chrome", surface: "model-training" }, { host: "managed-thin-chrome", surface: "model-training" },
    { host: "managed-thin-chrome", surface: "ocr-configuration" }, { host: "managed-thin-chrome", surface: "ocr-output-review" },
    { runId: "short" }, { sourceRevision: "worktree" }, { testKey: "private-test-name" }, { token: "synthetic-private-token" }])("rejects unsupported or private context %#", change => {
    expect(() => readCriticalAccessibilityContext({ ...context(), ...change })).toThrow("Invalid critical accessibility context.");
  });
  it.each(["runtime-conversation", "model-training"])("admits %s only for the desktop host", surface => {
    const report = qualifyCriticalAccessibilityReport({ ...context(), host: "packaged-desktop", surface }, [audit(1440), audit(320)]);
    expect(report.surface).toBe(surface); expect(report.host).toBe("packaged-desktop"); expect(report.status).toBe("passed");
  });
  it.each(["ocr-configuration", "ocr-output-review"])("accepts the supported desktop %s observation", surface => {
    expect(qualifyCriticalAccessibilityReport({ ...context(), host: "packaged-desktop", surface }, [audit(1440), audit(320)]).status).toBe("passed");
  });
  it.each([[], [audit(1440)], [audit(320), audit(1440)], [audit(1440), audit(1440)], [audit(1440), { ...audit(320), contrastPassedNodes: 0 }],
    [audit(1440), { ...audit(320), violations: [{ rule: "button-name", nodes: 1 }] }], new Array(2)])("never qualifies missing, reordered, sparse or failed audits %#", values => {
    expect(() => qualifyCriticalAccessibilityReport(context(), values)).toThrow("Invalid critical accessibility qualification.");
  });
  it("refuses executable context and array hooks without invoking them", () => {
    let calls = 0; const data = context(); Object.defineProperty(data, "runId", { get: () => { calls++; return "private"; } });
    expect(() => readCriticalAccessibilityContext(data)).toThrow("Invalid critical accessibility context.");
    const values = new Proxy([audit(1440), audit(320)], { ownKeys: target => { calls++; return Reflect.ownKeys(target); } });
    expect(() => qualifyCriticalAccessibilityReport(context(), values)).toThrow("Invalid critical accessibility qualification."); expect(calls).toBe(0);
  });
  it("refuses an over-cap array before enumerating its descriptors", () => {
    const values = new Array(1000).fill(audit(1440)); let enumerations = 0;
    const original = Object.getOwnPropertyDescriptors;
    const spy = vi.spyOn(Object, "getOwnPropertyDescriptors").mockImplementation(((target: object) => {
      if (target === values) { enumerations++; throw new Error("synthetic-private-array"); }
      return original(target);
    }) as typeof Object.getOwnPropertyDescriptors);
    try {
      expect(() => qualifyCriticalAccessibilityReport(context(), values)).toThrow("Invalid critical accessibility qualification.");
      expect(enumerations).toBe(0);
    } finally { spy.mockRestore(); }
  });
  it.each([{ elements: 0 }, { elements: 100001 }, { maximumTransitionMilliseconds: 1 }, { maximumAnimationMilliseconds: NaN },
    { maximumAnimationMilliseconds: Infinity }, { maximumAnimationMilliseconds: -1 }, { selector: "synthetic-private-selector" }])("rejects invalid or excessive reduced motion facts %#", change => {
    expect(() => readReducedMotionObservation({ elements: 2, maximumTransitionMilliseconds: 0, maximumAnimationMilliseconds: 0, ...change })).toThrow("Invalid reduced motion observation.");
  });
});

describe("bounded control access observations", () => {
  it("copies finite facts and retains a legitimate inaccessible-control failure", () => {
    const input = { width: 320, controls: 3, inaccessible: 1 };
    const result = readControlAccessObservation(input); input.inaccessible = 0;
    expect(result).toEqual({ width: 320, controls: 3, inaccessible: 1, status: "failed" }); expect(Object.isFrozen(result)).toBe(true);
    expect(readControlAccessObservation({ width: 1440, controls: 1, inaccessible: 0 }).status).toBe("passed");
  });
  it.each([{ width: 0 }, { width: 400 }, { controls: 0 }, { controls: 10001 }, { controls: NaN }, { inaccessible: -1 },
    { inaccessible: 4 }, { inaccessible: Infinity }, { inaccessible: 0.5 }, { label: "synthetic-private-control" }])("refuses malformed or private control facts %#", change => {
    expect(() => readControlAccessObservation({ width: 320, controls: 3, inaccessible: 0, ...change })).toThrow("Invalid control access observation.");
  });
  it("refuses executable observation hooks without invoking them", () => {
    let calls = 0; const input = { width: 320, controls: 1, inaccessible: 0 };
    Object.defineProperty(input, "controls", { get() { calls++; return 1; } });
    expect(() => readControlAccessObservation(input)).toThrow("Invalid control access observation.");
    const proxy = new Proxy({}, { getPrototypeOf() { calls++; return Object.prototype; } });
    expect(() => readControlAccessObservation(proxy)).toThrow("Invalid control access observation."); expect(calls).toBe(0);
  });
});

describe("critical surface Page definition with inert IO and synthetic DOM", () => {
  let oldAxe: PropertyDescriptor | undefined;
  let oldClientWidth: PropertyDescriptor | undefined, oldScrollWidth: PropertyDescriptor | undefined;
  const page = {
    evaluate: async (callback: ((value: unknown) => unknown) | string, value: unknown) => typeof callback === "string" ? undefined : callback(value),
    emulateMedia: async (options: { reducedMotion?: string; forcedColors?: string }) => {
      if (probe.restoreFails && options.reducedMotion === "no-preference") throw new Error("synthetic-private-browser-error");
      if (options.reducedMotion) probe.motion = options.reducedMotion;
      if (options.forcedColors) probe.forcedColors = options.forcedColors;
    },
    setViewportSize: async (value: { width: number }) => { probe.widths.push(value.width); },
  } as unknown as Page;
  const info = { title: "Fixed critical UI fixture", project: { name: "thin-chrome" }, attach: async (_name: string, value: { body: string }) => {
    if (probe.attachFails) throw new Error("synthetic-private-attachment"); probe.attachments.push(value.body);
  } } as unknown as TestInfo;
  beforeEach(() => {
    Object.assign(probe, { exists: false, readFails: false, attachFails: false, restoreFails: false, auditFails: false, calls: 0, motion: "no-preference", forcedAuditFails: false, forcedMediaFails: false, forcedColors: "none" });
    probe.writes.length = probe.flags.length = probe.attachments.length = probe.widths.length = 0;
    vi.stubEnv("VISUAL_COMPOSER_QUALIFICATION_RUN_ID", context().runId); vi.stubEnv("VISUAL_COMPOSER_QUALIFICATION_SOURCE_REVISION", context().sourceRevision);
    vi.stubGlobal("devicePixelRatio", 1); vi.stubGlobal("matchMedia", (query: string) => ({ matches: query === "(forced-colors: active)" ? !probe.forcedMediaFails && probe.forcedColors === "active" : probe.motion === "reduce" }));
    oldClientWidth = Object.getOwnPropertyDescriptor(document.documentElement, "clientWidth");
    oldScrollWidth = Object.getOwnPropertyDescriptor(document.documentElement, "scrollWidth");
    for (const key of ["clientWidth", "scrollWidth"]) Object.defineProperty(document.documentElement, key, { configurable: true, get: () => probe.widths[probe.widths.length - 1] ?? 1440 });
    oldAxe = Object.getOwnPropertyDescriptor(window, "axe");
    Object.defineProperty(window, "axe", { configurable: true, value: { run: async (root: string) => {
      expect(root).toBe("body"); probe.calls++;
      return { violations: probe.auditFails || (probe.forcedAuditFails && probe.forcedColors === "active") ? [{ id: "button-name", nodes: [{}] }] : [], incomplete: [], passes: [{ id: "color-contrast", nodes: [{}] }] };
    } } });
    document.body.innerHTML = '<main class="ui-shell" style="visibility:visible;transition-duration:0s;animation-name:none"><button style="visibility:visible;transition-duration:0s;animation-name:none">Synthetic private label</button></main>';
    for (const element of document.body.querySelectorAll("*")) {
      Object.defineProperty(element, "getClientRects", { value: () => [{ width: 1, height: 1 }] });
      Object.defineProperty(element, "getBoundingClientRect", { configurable: true, value: () => ({ width: 1, height: 1, left: 0, right: 1 }) });
      Object.defineProperty(element, "scrollIntoView", { configurable: true, value: vi.fn() });
    }
  });
  afterEach(() => {
    if (oldAxe) Object.defineProperty(window, "axe", oldAxe); else Reflect.deleteProperty(window, "axe");
    for (const [key, old] of [["clientWidth", oldClientWidth], ["scrollWidth", oldScrollWidth]] as const) {
      if (old) Object.defineProperty(document.documentElement, key, old); else Reflect.deleteProperty(document.documentElement, key);
    }
    document.body.replaceChildren(); vi.unstubAllEnvs(); vi.unstubAllGlobals();
  });
  it("audits both declared widths and finalizes only bounded context/rule/count facts", async () => {
    const report = await qualifyCriticalSurfaceAccessibility(page, info, "settings");
    expect(report.status).toBe("passed"); expect(probe.calls).toBe(4); expect(probe.widths).toEqual([1440, 320, 1440, 320, 1440]);
    expect(probe.flags).toEqual(["wx", "w", "w", "w", "w", "w"]); expect(probe.motion).toBe("no-preference"); expect(probe.forcedColors).toBe("none");
    const saved = JSON.parse(probe.writes[probe.writes.length - 1]!); expect(saved.status).toBe("passed"); expect(saved.audits.map((v: { width: number }) => v.width)).toEqual([1440, 320]);
    expect(saved.forcedColorsAudits.map((v: { width: number }) => v.width)).toEqual([1440, 320]);
    expect(saved["control-access-320"]).toEqual({ width: 320, controls: 1, inaccessible: 0, status: "passed" });
    expect(probe.writes.join("")).not.toMatch(/Synthetic private|synthetic-private|userAgent|selector|message/);
  });
  it("audits the actual standalone mount without requiring the builder shell", async () => {
    document.querySelector("main")!.className = "system-runtime-app";
    const runtimeInfo = { ...info, project: { name: "packaged-desktop" } } as TestInfo;
    const result = await qualifyCriticalSurfaceAccessibility(page, runtimeInfo, "runtime-conversation");
    expect(result.status).toBe("passed"); expect(probe.calls).toBe(4); expect(probe.widths).toEqual([1440, 320, 1440, 320, 1440]);
    expect(probe.motion).toBe("no-preference"); expect(probe.attachments).toHaveLength(1);
    expect(probe.writes.join("")).not.toMatch(/Synthetic private|synthetic-private|selector|message/);
  });
  it.each(["builder-only", "duplicate-runtime", "missing-runtime"] as const)("refuses %s instead of auditing a different page", async fault => {
    const main = document.querySelector("main")!;
    if (fault !== "builder-only") main.className = "system-runtime-app";
    if (fault === "duplicate-runtime") document.body.append(main.cloneNode(true));
    if (fault === "missing-runtime") main.remove();
    const runtimeInfo = { ...info, project: { name: "packaged-desktop" } } as TestInfo;
    await expect(qualifyCriticalSurfaceAccessibility(page, runtimeInfo, "runtime-conversation")).rejects.toThrow("Critical accessibility check failed at browser-profile.");
    expect(probe.calls).toBe(0); expect(JSON.parse(probe.writes[probe.writes.length - 1]!).status).toBe("failed");
  });
  it("rejects a thin runtime before any file or Page effect", async () => {
    const evaluate = vi.fn();
    await expect(qualifyCriticalSurfaceAccessibility({ evaluate } as unknown as Page, info, "runtime-conversation")).rejects.toThrow("Invalid critical accessibility context.");
    expect(evaluate).not.toHaveBeenCalled(); expect(probe.flags).toEqual([]);
  });
  it("rechecks runtime identity if the document changes after initial admission", async () => {
    document.querySelector("main")!.className = "system-runtime-app";
    const changingPage = { ...page, evaluate: async (callback: ((value: unknown) => unknown) | string, value: unknown) => {
      if (value && typeof value === "object" && "scope" in value && value.scope === "runtime") document.querySelector("main")!.className = "ui-shell";
      return typeof callback === "string" ? undefined : callback(value);
    } } as unknown as Page;
    const runtimeInfo = { ...info, project: { name: "packaged-desktop" } } as TestInfo;
    await expect(qualifyCriticalSurfaceAccessibility(changingPage, runtimeInfo, "runtime-conversation")).rejects.toThrow("Critical accessibility check failed at audit-1440.");
    expect(probe.calls).toBe(0); expect(JSON.parse(probe.writes[probe.writes.length - 1]!).status).toBe("failed");
  });
  it.each(["outside-left", "outside-right", "zero-width", "nonfinite"] as const)("refuses a visible %s control even without document overflow", async fault => {
    Object.defineProperty(document.querySelector("button")!, "getBoundingClientRect", { configurable: true, value: () => ({
      width: fault === "zero-width" ? 0 : fault === "nonfinite" ? NaN : 10, height: 10,
      left: fault === "outside-left" ? -20 : 0, right: fault === "outside-right" ? 2000 : 10,
    }) });
    await expect(qualifyCriticalSurfaceAccessibility(page, info, "settings")).rejects.toThrow("Critical accessibility check failed at control-access-1440.");
    const saved = JSON.parse(probe.writes[probe.writes.length - 1]!); expect(saved.status).toBe("failed");
    expect(saved["control-access-1440"].inaccessible).toBe(1); expect(probe.forcedColors).toBe("none");
  });
  it("scrolls visible controls before measurement and excludes hidden or inert controls", async () => {
    const button = document.querySelector("button")!; let scrolled = false;
    Object.defineProperty(button, "scrollIntoView", { configurable: true, value: () => { scrolled = true; } });
    Object.defineProperty(button, "getBoundingClientRect", { configurable: true, value: () => ({ width: 1, height: 1, left: scrolled ? 0 : -20, right: 1 }) });
    const hidden = document.createElement("button"); hidden.style.visibility = "hidden"; document.body.append(hidden);
    const inert = document.createElement("div"); inert.setAttribute("inert", ""); inert.append(document.createElement("button")); document.body.append(inert);
    for (const element of [hidden, inert.firstElementChild!]) {
      Object.assign((element as HTMLElement).style, { transitionDuration: "0s", animationName: "none" });
      if (element !== hidden) (element as HTMLElement).style.visibility = "visible";
      Object.defineProperty(element, "getClientRects", { value: () => [{ width: 10, height: 10 }] });
      Object.defineProperty(element, "getBoundingClientRect", { value: () => ({ width: 10, height: 10, left: -100, right: -90 }) });
      Object.defineProperty(element, "scrollIntoView", { value: () => { throw new Error("Excluded controls must not be inspected."); } });
    }
    expect((await qualifyCriticalSurfaceAccessibility(page, info, "settings")).status).toBe("passed");
    const saved = JSON.parse(probe.writes[probe.writes.length - 1]!); expect(saved["control-access-320"].controls).toBe(1); expect(scrolled).toBe(true);
  });
  it.each(["media", "contrast"] as const)("retains a failed forced-colors %s check after both baseline widths passed", async fault => {
    probe.forcedMediaFails = fault === "media"; probe.forcedAuditFails = fault === "contrast";
    await expect(qualifyCriticalSurfaceAccessibility(page, info, "settings")).rejects.toThrow(`Critical accessibility check failed at ${fault === "media" ? "forced-colors-media" : "forced-colors-audit-1440"}.`);
    const saved = JSON.parse(probe.writes[probe.writes.length - 1]!); expect(saved.status).toBe("failed"); expect(saved.audits).toHaveLength(2);
    expect(probe.forcedColors).toBe("none"); expect(probe.motion).toBe("no-preference"); expect(probe.widths[probe.widths.length - 1]).toBe(1440);
    expect(probe.writes.join("")).not.toContain("synthetic-private");
  });
  it("refuses a mounted document without any observable controls", async () => {
    document.querySelector("button")!.remove();
    await expect(qualifyCriticalSurfaceAccessibility(page, info, "settings")).rejects.toThrow("Critical accessibility check failed at control-access-1440.");
    expect(JSON.parse(probe.writes[probe.writes.length - 1]!).status).toBe("failed"); expect(probe.calls).toBe(0);
  });
  it("refuses an excessive control collection before inspecting its entries", async () => {
    const query = document.body.querySelectorAll.bind(document.body);
    const spy = vi.spyOn(document.body, "querySelectorAll").mockImplementation(((selector: string) => selector === "*" ? query(selector) : new Array(10001)) as typeof document.body.querySelectorAll);
    try {
      await expect(qualifyCriticalSurfaceAccessibility(page, info, "settings")).rejects.toThrow("Critical accessibility check failed at control-access-1440.");
      expect(JSON.parse(probe.writes[probe.writes.length - 1]!).status).toBe("failed"); expect(probe.calls).toBe(0);
    } finally { spy.mockRestore(); }
  });
  it("denies an existing report without overwriting, inspecting or adopting its bytes", async () => {
    probe.exists = true;
    await expect(qualifyCriticalSurfaceAccessibility(page, info, "settings")).rejects.toThrow("Critical accessibility check failed at evidence-create.");
    expect(probe.flags).toEqual(["wx"]); expect(probe.writes).toEqual([]); expect(probe.calls).toBe(0); expect(probe.widths).toEqual([]);
  });
  it("rejects unknown context before any file or Page effect", async () => {
    await expect(qualifyCriticalSurfaceAccessibility(page, info, "../private" as never)).rejects.toThrow("Invalid critical accessibility context.");
    expect(probe.flags).toEqual([]); expect(probe.calls).toBe(0); expect(probe.widths).toEqual([]);
  });
  it.each(["profile", "scale", "unmounted", "motion", "audit", "attachment", "restore"] as const)("preserves failed %s evidence and fixed diagnostics", async fault => {
    if (fault === "profile") probe.readFails = true;
    if (fault === "scale") vi.stubGlobal("devicePixelRatio", { private: "synthetic-private-scale" });
    if (fault === "unmounted") document.body.replaceChildren();
    if (fault === "motion") (document.querySelector("button") as HTMLElement).style.transitionDuration = "1s";
    if (fault === "audit") probe.auditFails = true;
    if (fault === "attachment") probe.attachFails = true;
    if (fault === "restore") probe.restoreFails = true;
    await expect(qualifyCriticalSurfaceAccessibility(page, info, "settings")).rejects.toThrow(/^(Critical accessibility check|Technical accessibility finalization) failed at [a-z0-9-]+\.$/);
    if (fault === "profile") expect(probe.writes).toEqual([]);
    else expect(JSON.parse(probe.writes[probe.writes.length - 1]!).status).toBe("failed");
    expect(probe.writes.join("")).not.toContain("synthetic-private");
    if (fault === "scale") expect(JSON.parse(probe.writes[probe.writes.length - 1]!).browser).toBeUndefined();
  });
});


describe("explicit lifecycle audit admission", () => {
  it.each([undefined, null, {}, { mode: "unknown" }, { mode: "" }, { mode: "initial", info: undefined }])("rejects missing or invalid mode before Page access %#", async accessibility => {
    const page = new Proxy({}, { get() { throw new Error("Page must not be accessed."); } });
    await expect(prepareGuidedSystemLifecycle(page as Page, "Synthetic lifecycle", { modelDisplayName: "Synthetic model", accessibility } as never))
      .rejects.toThrow("Unknown lifecycle accessibility mode.");
  });
});

describe("explicit OCR host admission", () => {
  it.each([
    { host: "unknown", project: "packaged-desktop" }, { host: "desktop", project: "thin-chrome" },
    { host: "thin", project: "packaged-desktop" }, { host: "thin", project: "managed-thin-chrome" },
    { host: "desktop", project: undefined }, { host: "thin", project: undefined },
  ])("refuses unsupported or mismatched transport/project before file or Page work %#", async ({ host, project }) => {
    const page = new Proxy({}, { get() { throw new Error("Page must not be accessed."); } });
    const info = project === undefined ? undefined : { project: { name: project } };
    await expect(qualifyOcrDatasetJourney(page as Page, info as TestInfo, host as "desktop" | "thin")).rejects.toThrow("Unknown OCR host context.");
  });
});
