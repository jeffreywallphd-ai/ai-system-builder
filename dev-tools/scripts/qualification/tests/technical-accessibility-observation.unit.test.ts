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
import { readTechnicalAccessibilityAudit } from "../visual-composer/technical-accessibility-observation";
import { collectSystemBuilderAccessibilityAudit, finalizeTechnicalAccessibilityEvidence, qualifyTechnicalAccessibility } from "../visual-composer/e2e/technical-accessibility";
const base = () => ({ schemaVersion: "technical-accessibility-audit-v1", width: 320, violations: [] as Array<{ rule: string; nodes: number }>, incomplete: [] as Array<{ rule: string; nodes: number }>, contrastPassedNodes: 3, retries: { attempted: 0, passed: 0 } });
const invalid = "Invalid technical accessibility observation.";

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
  it("refuses an unsupported viewport before browser evaluation", async () => {
    const evaluate = vi.fn();
    await expect(collectSystemBuilderAccessibilityAudit({ evaluate } as unknown as Page, 400 as never)).rejects.toThrow(invalid);
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
