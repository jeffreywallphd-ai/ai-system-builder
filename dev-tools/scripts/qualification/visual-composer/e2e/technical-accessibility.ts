import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { expect, type Page, type TestInfo } from "@playwright/test";
import { readTechnicalAccessibilityAudit, readNative400Frame, readNativeAccessibilityAudit, TECHNICAL_ACCESSIBILITY_RULE_IDS,
  type TechnicalAccessibilityAudit, type NativeAccessibilityAudit, type Native400Frame } from "../technical-accessibility-observation";

/** Read-only frame/fit facts from a fixed native host case, never caller selectors. */
export async function collectNative400Frame(page: Page, runtime = false): Promise<Native400Frame> {
  if (typeof runtime !== "boolean") throw new Error("Invalid native accessibility observation.");
  try {
    const value = await page.evaluate(runtime => {
      try {
        if (document.querySelectorAll(runtime ? "main.system-runtime-app" : "main.ui-shell").length !== 1) throw new Error();
        const dpr = devicePixelRatio, cssZoom = getComputedStyle(document.documentElement).zoom, visualScale = visualViewport?.scale;
        const outer = outerWidth, inner = innerWidth, layoutWidth = document.documentElement.clientWidth;
        // Refuse scale substitutes before scrolling controls or running an audit.
        if (!Number.isFinite(dpr) || Math.abs(dpr - 4) >= 1e-8 || cssZoom !== "1" || visualScale !== 1 ||
            !Number.isInteger(outer) || outer < 1400 || outer > 1460 || !Number.isInteger(inner) || inner < 320 || inner > 360 ||
            !Number.isInteger(layoutWidth) || layoutWidth < 1 || layoutWidth > inner) throw new Error();
        const candidates = document.body.querySelectorAll('button,input:not([type="hidden"]),select,textarea,a[href],[role="button"],[tabindex]');
        if (candidates.length > 10000) throw new Error();
        let controls = 0, inaccessible = 0;
        for (const element of candidates) {
          if (!(element instanceof HTMLElement) || element.closest('[inert],[aria-hidden="true"]') ||
              !element.getClientRects().length || getComputedStyle(element).visibility !== "visible") continue;
          controls++;
          element.scrollIntoView({block:"nearest",inline:"nearest",behavior:"instant"});
          const box = element.getBoundingClientRect();
          if (![box.width,box.height,box.left,box.right].every(Number.isFinite) || box.width <= 0 || box.height <= 0 || box.left < -1 || box.right > layoutWidth + 1) inaccessible++;
        }
        return {dpr,cssZoom,visualScale,outerWidth:outer,innerWidth:inner,layoutWidth,
          overflow:document.documentElement.scrollWidth-document.documentElement.clientWidth,controls,inaccessible};
    } catch { throw new Error("Native frame collection failed."); }
  }, runtime);
  return readNative400Frame(value);
  } catch { throw new Error("Native frame collection failed."); }
}
export const rawNativeFrame = (frame: Native400Frame) => ({dpr:frame.dpr,cssZoom:frame.cssZoom,visualScale:frame.visualScale,
  outerWidth:frame.outerWidth,innerWidth:frame.innerWidth,layoutWidth:frame.layoutWidth,overflow:frame.overflow,controls:frame.controls,inaccessible:frame.inaccessible});

/** Selectors/messages remain browser-local, including failed contrast retries. */
function collectAccessibilityAudit(page: Page, width: 320 | 1440, scope: "canvas" | "shell" | "runtime"): Promise<TechnicalAccessibilityAudit>;
function collectAccessibilityAudit(page: Page, width: "native400", scope: "shell" | "runtime", media: "normal" | "forced-colors"): Promise<NativeAccessibilityAudit>;
async function collectAccessibilityAudit(page: Page, width: 320 | 1440 | "native400", scope: "canvas" | "shell" | "runtime", media: "normal" | "forced-colors" = "normal") {
  if (width !== 320 && width !== 1440 && width !== "native400") throw new Error("Invalid technical accessibility observation.");
  if (width === "native400") {
    if (media !== "normal" && media !== "forced-colors") throw new Error("Invalid native accessibility observation.");
    const frame = await collectNative400Frame(page, scope === "runtime");
    if (frame.status !== "passed" || await page.evaluate(expected => matchMedia("(prefers-reduced-motion: reduce)").matches &&
      matchMedia("(forced-colors: active)").matches === (expected === "forced-colors"), media) !== true) throw new Error("Native audit admission failed.");
  }
  const observation = await page.evaluate(async ({ width, ruleIds, scope }) => {
    try {
      type Item = { id: string; nodes: Array<{ target: string[] }> };
      type Result = { violations: Item[]; incomplete: Item[]; passes: Item[] };
      const axe = (window as unknown as { axe: { run(context: unknown, options: unknown): Promise<Result> } }).axe;
      const allowed = new Set(ruleIds);
      function groups(items: Item[]) {
        if (!Array.isArray(items) || items.length > 512) throw new Error();
        const seen = new Set<string>();
        return items.map(item => {
          if (!item || !allowed.has(item.id) || seen.has(item.id) || !Array.isArray(item.nodes) || item.nodes.length > 10000) throw new Error();
          seen.add(item.id);
          return { rule: item.id, nodes: item.nodes.length };
        });
      }
      if (scope === "shell" && document.querySelectorAll("main.ui-shell").length !== 1) throw new Error();
      if (scope === "runtime" && document.querySelectorAll("main.system-runtime-app").length !== 1) throw new Error();
      const result = await axe.run(scope === "canvas" ? ".system-builder" : "body", { runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21aa"] } });
      const violations = groups(result.violations), incomplete = groups(result.incomplete), passes = groups(result.passes);
      let attempted = 0, passed = 0;
      for (const group of result.incomplete) {
        if (group.id !== "color-contrast") continue;
        if (group.nodes.length > 1000) throw new Error();
        for (const node of group.nodes) {
          if (!Array.isArray(node.target) || node.target.length !== 1 || typeof node.target[0] !== "string" || node.target[0].length > 4096) throw new Error();
          const selector = node.target[0], matches = document.querySelectorAll(selector);
          if (matches.length !== 1) throw new Error();
          const target = matches[0]!;
          target.scrollIntoView({ block: "center", inline: "nearest", behavior: "instant" });
          await new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
          if (!target.isConnected || document.querySelector(selector) !== target || !target.getClientRects().length || getComputedStyle(target).visibility !== "visible") throw new Error();
          const box = target.getBoundingClientRect();
          if (!Number.isFinite(box.width) || !Number.isFinite(box.height) || box.width <= 0 || box.height <= 0) throw new Error();
          const measured = await axe.run({ include: [[selector]] }, { runOnly: { type: "rule", values: ["color-contrast"] } });
          const bad = groups(measured.violations), unresolved = groups(measured.incomplete), good = groups(measured.passes);
          if (!target.isConnected || document.querySelector(selector) !== target) throw new Error();
          attempted++;
          if (!bad.length && !unresolved.length && good.some(item => item.rule === "color-contrast" && item.nodes > 0)) passed++;
        }
      }
      const facts = { violations, incomplete, contrastPassedNodes: passes.find(item => item.rule === "color-contrast")?.nodes ?? 0, retries: { attempted, passed } };
      return width === "native400" ? facts : { schemaVersion: "technical-accessibility-audit-v1", width, ...facts };
    } catch { throw new Error("Computed accessibility audit failed."); }
  }, { width, ruleIds: [...TECHNICAL_ACCESSIBILITY_RULE_IDS], scope });
  if (width === "native400") {
    const frame = await collectNative400Frame(page, scope === "runtime");
    return readNativeAccessibilityAudit({schemaVersion:"native-technical-accessibility-audit-v1",media,frame:rawNativeFrame(frame),facts:observation});
  }
  return readTechnicalAccessibilityAudit(observation);
}
function collectStandardAudit(page: Page, width: 320 | 1440, scope: "canvas" | "shell" | "runtime") {
  if (width !== 320 && width !== 1440) return Promise.reject(new Error("Invalid technical accessibility observation."));
  return collectAccessibilityAudit(page, width, scope);
}
export function collectSystemBuilderAccessibilityAudit(page: Page, width: 320 | 1440) { return collectStandardAudit(page, width, "canvas"); }
export function collectDocumentAccessibilityAudit(page: Page, width: 320 | 1440) { return collectStandardAudit(page, width, "shell"); }
export function collectRuntimeAccessibilityAudit(page: Page, width: 320 | 1440) { return collectStandardAudit(page, width, "runtime"); }
export function collectNativeDocumentAccessibilityAudit(page: Page, media: "normal" | "forced-colors") { return collectAccessibilityAudit(page, "native400", "shell", media); }
export function collectNativeRuntimeAccessibilityAudit(page: Page, media: "normal" | "forced-colors") { return collectAccessibilityAudit(page, "native400", "runtime", media); }

/** Same named host constraints for Canvas and other critical mounted surfaces. */
export async function loadTechnicalAccessibilityReference() {
  try {
    const bytes = await readFile(path.resolve("dev-tools/config/technical-reference-profiles.json"));
    const value = JSON.parse(bytes.toString("utf8"));
    if (typeof value.environmentId !== "string" || !/^[a-z0-9-]{1,100}$/.test(value.environmentId)
      || typeof value.deviceScaleFactor !== "number" || !Number.isFinite(value.deviceScaleFactor) || value.deviceScaleFactor <= 0) throw new Error();
    expect(process.platform).toBe(value.platform); expect(process.arch).toBe(value.architecture);
    const logicalProcessors = os.cpus().length, memoryBytes = os.totalmem();
    expect(logicalProcessors).toBe(value.logicalProcessors);
    expect(Math.abs(memoryBytes / (1024 ** 3) - value.installedMemoryGiB)).toBeLessThan(1);
    return Object.freeze({ profile: Object.freeze({ environmentId: value.environmentId as string, deviceScaleFactor: value.deviceScaleFactor as number }),
      profileSha256: createHash("sha256").update(bytes).digest("hex"), hardware: Object.freeze({ platform: process.platform, architecture: process.arch, logicalProcessors, memoryBytes }) });
  } catch { throw new Error("Technical accessibility setup failed at reference-profile."); }
}

/** A failed finalization cannot leave the last writable report marked passed. */
export async function finalizeTechnicalAccessibilityEvidence(report: Record<string, unknown>, save: () => Promise<void>, attach: () => Promise<unknown>, restore: () => Promise<void>) {
  let stage = "media-restore";
  try {
    await restore();
    stage = "evidence-save"; await save();
    stage = "evidence-attach"; await attach();
  } catch {
    report.status = "failed";
    report.failureStage ??= stage;
    report.finalizationStage = stage;
    try { await save(); } catch { /* The failed test receipt remains authoritative if storage is unavailable. */ }
    throw new Error(`Technical accessibility finalization failed at ${stage}.`);
  }
}

/** Real browser assertions; retain counts and fixed rule IDs, never DOM/user payloads. */
export async function qualifyTechnicalAccessibility(page: Page, info: TestInfo) {
  const runId = process.env.VISUAL_COMPOSER_QUALIFICATION_RUN_ID;
  const source = process.env.VISUAL_COMPOSER_QUALIFICATION_SOURCE_REVISION;
  if (!runId || !/^[a-z0-9-]{20,80}$/.test(runId) || !source || !/^source\.[a-f0-9]{64}$/.test(source) ||
      !["thin-chrome", "packaged-desktop", "managed-thin-chrome"].includes(info.project.name)) throw new Error("Invalid accessibility qualification identity.");
  const { reference, folder } = await (async () => {
    let stage = "reference-profile";
    try {
      const reference = await loadTechnicalAccessibilityReference();
      stage = "evidence-setup";
      const folder = path.resolve("artifacts/qualification/visual-composer/runs", runId, "technical-accessibility", info.project.name);
      await mkdir(folder, { recursive: true });
      return { reference, folder };
    } catch { throw new Error(`Technical accessibility setup failed at ${stage}.`); }
  })();
  const profile = reference.profile;
  const report: Record<string, unknown> = { schemaVersion: "technical-accessibility-v2", sourceRevision: source,
    profile: profile.environmentId, profileSha256: reference.profileSha256,
    host: info.project.name, hardware: reference.hardware, status: "running", checks: [] as string[] };
  const checks = report.checks as string[];
  async function save() {
    const body = JSON.stringify(report, null, 2) + "\n";
    if (Buffer.byteLength(body) > 262144) throw new Error("Technical accessibility evidence exceeded its bound.");
    try { await writeFile(path.join(folder, "evidence.json"), body); }
    catch { throw new Error("Technical accessibility evidence could not be saved."); }
  }
  let stage = "browser-profile";
  await save();
  try {
    const deviceScaleFactor: unknown = await page.evaluate(() => devicePixelRatio);
    if (typeof deviceScaleFactor !== "number" || !Number.isFinite(deviceScaleFactor) || deviceScaleFactor !== profile.deviceScaleFactor) throw new Error();
    report.browser = { deviceScaleFactor };
    stage = "computed-reduced-motion";
    await page.emulateMedia({ reducedMotion: "reduce" });
    expect(await page.evaluate(() => matchMedia("(prefers-reduced-motion: reduce)").matches)).toBe(true);
    const motion = await page.locator(".system-builder").evaluate(root => [...root.querySelectorAll("*")]
      .filter(element => element.getClientRects().length && getComputedStyle(element).visibility !== "hidden")
      .map(element => { const style = getComputedStyle(element); return {
        transitions: style.transitionDuration.split(",").map(value => Number.parseFloat(value) * (value.trim().endsWith("ms") ? 1 : 1000)),
        animations: style.animationName === "none" ? [0] : style.animationDuration.split(",").map(value => Number.parseFloat(value) * (value.trim().endsWith("ms") ? 1 : 1000)),
      }; }));
    expect(motion.length).toBeGreaterThan(0);
    expect(motion.every(item => [...item.transitions, ...item.animations].every(ms => Number.isFinite(ms) && ms >= 0 && ms <= 0.01))).toBe(true);
    report.motion = { elements: motion.length,
      maximumTransitionMilliseconds: Math.max(...motion.flatMap(item => item.transitions)),
      maximumAnimationMilliseconds: Math.max(...motion.flatMap(item => item.animations)) };
    await save();
    checks.push("computed-reduced-motion");
    stage = "status-meaning";
    const badges = page.locator(".system-builder__status .ui-badge");
    expect(await badges.count()).toBeGreaterThan(0);
    for (const badge of await badges.all()) expect((await badge.innerText()).trim().length).toBeGreaterThan(0);
    checks.push("status-meaning-independent-of-color");
    await page.setViewportSize({ width: 1440, height: 1000 });
    stage = "audit-engine";
    const axeSource = await readFile(path.resolve("node_modules/axe-core/axe.min.js"), "utf8");
    await page.evaluate(axeSource);
    for (const width of [1440, 320] as const) {
      stage = `computed-audit-${width}`;
      await page.setViewportSize({ width, height: 1000 });
      expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(1);
      const result = await collectSystemBuilderAccessibilityAudit(page, width);
      report[`wcag-${width}`] = result;
      await save();
      expect(result.status).toBe("passed");
      checks.push(`computed-contrast-and-semantics-${width}`, `reflow-${width}`);
    }
    // Exercise native keyboard activation, modal containment and focus return.
    stage = "keyboard-modal-focus";
    const add = page.getByRole("button", { name: /^Add an element inside / }).last();
    await add.scrollIntoViewIfNeeded(); await add.focus(); await add.press("Enter");
    const dialog = page.getByRole("dialog", { name: /^Add an element to / });
    await expect(dialog.getByLabel("Search compatible elements")).toBeFocused();
    await dialog.getByLabel("Search compatible elements").fill("no-matching-qualification-element");
    await expect(dialog.locator(".system-composer__asset-picker-card")).toHaveCount(0);
    const controls = [];
    for (const control of await dialog.locator("button, input, select, textarea, a[href], [tabindex]").all()) {
      if (await control.isVisible() && await control.isEnabled() && await control.evaluate(element => (element as HTMLElement).tabIndex >= 0)) controls.push(control);
    }
    expect(controls.length).toBeGreaterThan(1);
    await controls[0]!.focus(); await page.keyboard.press("Shift+Tab"); await expect(controls[controls.length - 1]!).toBeFocused();
    await controls[controls.length - 1]!.focus(); await page.keyboard.press("Tab"); await expect(controls[0]!).toBeFocused();
    await dialog.press("Escape"); await expect(dialog).toBeHidden(); await expect(add).toBeFocused();
    checks.push("keyboard-activation-and-modal-focus-return", "modal-keyboard-containment");
    report.status = "passed";
    return { checks, profile: profile.environmentId };
  } catch {
    report.failureStage = stage;
    throw new Error(`Technical accessibility check failed at ${stage}.`);
  } finally {
    if (report.status === "running") report.status = "failed";
    await finalizeTechnicalAccessibilityEvidence(report, save,
      () => info.attach("technical-accessibility", { body: JSON.stringify(report), contentType: "application/json" }),
      () => page.emulateMedia({ reducedMotion: "no-preference" }));
  }
}
