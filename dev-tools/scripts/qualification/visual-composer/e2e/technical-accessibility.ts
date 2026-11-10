import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { expect, type Page, type TestInfo } from "@playwright/test";
import { readTechnicalAccessibilityAudit, readTechnicalAccessibilityObservation, readNativeAccessibilityObservation, readNative400Frame, readNativeAccessibilityAudit, TECHNICAL_ACCESSIBILITY_RULE_IDS,
  readNotificationPopupAccessibilityObservation,
  CONTRAST_RETRY_V2_REASON_IDS, CONTRAST_RETRY_HINT_IDS, CONTRAST_RETRY_V4_REGION_MARKERS,
  type TechnicalAccessibilityAudit, type NativeAccessibilityAudit, type Native400Frame } from "../technical-accessibility-observation";

// Inputs belong to this source checkout. Output paths remain case-owned CWD paths.
const ACCESSIBILITY_SOURCE_ROOT = path.resolve(__dirname, "../../../../..");
export async function readTechnicalAccessibilityEngine(): Promise<string> {
  return readFile(path.join(ACCESSIBILITY_SOURCE_ROOT, "node_modules/axe-core/axe.min.js"), "utf8");
}

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
function collectAccessibilityObservation(page: Page, width: 320 | 1440, scope: "canvas" | "shell" | "runtime" | "navigation"): Promise<ReturnType<typeof readTechnicalAccessibilityObservation>>;
function collectAccessibilityObservation(page: Page, width: 320 | 1440, scope: "notifications"): Promise<ReturnType<typeof readNotificationPopupAccessibilityObservation>>;
function collectAccessibilityObservation(page: Page, width: "native400", scope: "shell" | "runtime", media: "normal" | "forced-colors"): Promise<ReturnType<typeof readNativeAccessibilityObservation>>;
async function collectAccessibilityObservation(page: Page, width: 320 | 1440 | "native400", scope: "canvas" | "shell" | "runtime" | "navigation" | "notifications", media: "normal" | "forced-colors" = "normal") {
  if (width !== 320 && width !== 1440 && width !== "native400") throw new Error("Invalid technical accessibility observation.");
  if (scope === "notifications" && width === "native400") throw new Error("Invalid notification popup observation.");
  if (width === "native400") {
    if (media !== "normal" && media !== "forced-colors") throw new Error("Invalid native accessibility observation.");
    const frame = await collectNative400Frame(page, scope === "runtime");
    if (frame.status !== "passed" || await page.evaluate(expected => matchMedia("(prefers-reduced-motion: reduce)").matches &&
      matchMedia("(forced-colors: active)").matches === (expected === "forced-colors"), media) !== true) throw new Error("Native audit admission failed.");
  }
  const observation = await page.evaluate(async ({ width, ruleIds, scope, reasonIds, hintIds, regionMarkers }) => {
    try {
      type Item = { id: string; nodes: Array<{ target: string[]; any?: unknown[]; all?: unknown[]; none?: unknown[] }> };
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
      let navigationShell: Element | undefined, navigationContainer: Element | undefined, navigationTrigger: Element | undefined, navigationPanel: Element | undefined;
      if (scope === "navigation") {
        const shells = document.querySelectorAll("main.ui-shell"), containers = document.querySelectorAll(".ui-shell__menu"), triggers = document.querySelectorAll("summary.ui-shell__menu-trigger"), panels = document.querySelectorAll(".ui-shell__menu-panel");
        const visible = (node: Element) => node.getClientRects().length > 0 && getComputedStyle(node).visibility === "visible";
        if (width !== 320 || shells.length !== 1 || containers.length !== 1 || triggers.length !== 1 || panels.length !== 1 ||
            containers[0]!.tagName !== "DETAILS" || !containers[0]!.hasAttribute("open") || !shells[0]!.contains(containers[0]!) ||
            !containers[0]!.contains(triggers[0]!) || !containers[0]!.contains(panels[0]!) ||
            triggers[0]!.getAttribute("aria-expanded") !== "true" || !visible(triggers[0]!) || !visible(panels[0]!) ||
            panels[0]!.getAttribute("role") !== "menu" || panels[0]!.getAttribute("aria-label") !== "Application navigation") throw new Error();
        [navigationShell, navigationContainer, navigationTrigger, navigationPanel] = [shells[0]!, containers[0]!, triggers[0]!, panels[0]!];
      }
      function requireNavigationScope(target?: Element) {
        if (scope !== "navigation") return;
        if (!navigationShell?.isConnected || !navigationContainer?.isConnected || !navigationTrigger?.isConnected || !navigationPanel?.isConnected ||
            document.querySelectorAll("main.ui-shell").length !== 1 || document.querySelector("main.ui-shell") !== navigationShell ||
            document.querySelectorAll(".ui-shell__menu").length !== 1 || document.querySelector(".ui-shell__menu") !== navigationContainer ||
            document.querySelectorAll("summary.ui-shell__menu-trigger").length !== 1 || document.querySelector("summary.ui-shell__menu-trigger") !== navigationTrigger ||
            document.querySelectorAll(".ui-shell__menu-panel").length !== 1 || document.querySelector(".ui-shell__menu-panel") !== navigationPanel ||
            !navigationShell.contains(navigationContainer) || !navigationContainer.contains(navigationTrigger) || !navigationContainer.contains(navigationPanel) ||
            !navigationContainer.hasAttribute("open") ||
            navigationTrigger.getAttribute("aria-expanded") !== "true" || !navigationTrigger.getClientRects().length || !navigationPanel.getClientRects().length ||
            getComputedStyle(navigationTrigger).visibility !== "visible" || getComputedStyle(navigationPanel).visibility !== "visible" ||
            navigationPanel.getAttribute("role") !== "menu" || navigationPanel.getAttribute("aria-label") !== "Application navigation" ||
            target !== undefined && !navigationContainer.contains(target)) throw new Error();
      }
      const notification = scope === "notifications" ? (() => {
        if (width !== 320 && width !== 1440) throw new Error();
        const unique = (selector: string) => { const nodes = document.querySelectorAll(selector); if (nodes.length !== 1) throw new Error(); return nodes[0]!; };
        return {shell: unique("main.ui-shell"), header: unique("header.ui-shell__header"), main: unique(".ui-shell__main"),
          bell: unique('[id="application-notification-bell"]'), panel: unique('[id="application-notification-panel"]'), heading: unique('[id="application-notification-heading"]')};
      })() : undefined;
      function requireNotificationScope(target?: Element) {
        if (scope !== "notifications") return;
        if (!notification) throw new Error();
        const {shell, header, main, bell, panel, heading} = notification;
        for (const [selector, expected] of [["main.ui-shell", shell], ["header.ui-shell__header", header], [".ui-shell__main", main],
          ['[id="application-notification-bell"]', bell], ['[id="application-notification-panel"]', panel], ['[id="application-notification-heading"]', heading]] as const) {
          const nodes = document.querySelectorAll(selector); if (nodes.length !== 1 || nodes[0] !== expected || !expected.isConnected) throw new Error();
        }
        if (!shell.contains(header) || !shell.contains(main) || !header.contains(bell) || !main.contains(panel) || !panel.contains(heading) ||
            !(bell instanceof HTMLButtonElement) || bell.disabled || bell.type !== "button" || !bell.classList.contains("ui-shell__notification-button") ||
            bell.getAttribute("aria-label") !== "Notifications" || bell.hasAttribute("role") || bell.hasAttribute("aria-labelledby") || bell.hasAttribute("aria-roledescription") ||
            !panel.classList.contains("ui-notification__panel") || heading.tagName !== "H2" || heading.textContent !== "Notifications" ||
            bell.getAttribute("aria-haspopup") !== "dialog" || bell.getAttribute("aria-expanded") !== "true" || bell.getAttribute("aria-controls") !== "application-notification-panel" ||
            panel.getAttribute("role") !== "dialog" || panel.getAttribute("aria-modal") !== "false" || panel.getAttribute("aria-labelledby") !== "application-notification-heading" ||
            target !== undefined && target !== bell && !panel.contains(target)) throw new Error();
        for (const node of [bell, panel, heading]) {
          const box = node.getBoundingClientRect();
          if (!(node instanceof HTMLElement) || node.closest('[inert],[aria-hidden="true"]') || !node.getClientRects().length ||
              ![box.left, box.right, box.top, box.bottom, box.width, box.height].every(Number.isFinite) || box.width <= 0 || box.height <= 0) throw new Error();
          let ancestor: Element | null = node, depth = 0;
          while (ancestor && depth++ < 64) {
            const style = getComputedStyle(ancestor), opacity = Number.parseFloat(style.opacity);
            if (style.display === "none" || style.visibility !== "visible" || !Number.isFinite(opacity) || opacity <= 0 || style.contentVisibility === "hidden") throw new Error();
            ancestor = ancestor.parentElement;
          }
          if (ancestor) throw new Error();
        }
      }
      requireNotificationScope();
      const result = await axe.run(scope === "canvas" ? ".system-builder" : scope === "navigation" ? ".ui-shell__menu"
        : scope === "notifications" ? {include: [["#application-notification-bell"], ["#application-notification-panel"]]} : "body",
        { runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21aa"] } });
      requireNavigationScope();
      requireNotificationScope();
      if (scope === "notifications") {
        if (!notification || !Array.isArray(result.incomplete) || result.incomplete.length > 512) throw new Error();
        const reviews = result.incomplete.filter(group => group?.id === "aria-valid-attr-value");
        if (reviews.length !== 1 || !Array.isArray(reviews[0]!.nodes) || reviews[0]!.nodes.length !== 1) throw new Error();
        const node = reviews[0]!.nodes[0]!;
        if (!Array.isArray(node.target) || node.target.length !== 1 || typeof node.target[0] !== "string" || !node.target[0].length || node.target[0].length > 4096) throw new Error();
        const targets = document.querySelectorAll(node.target[0]); if (targets.length !== 1 || targets[0] !== notification.bell) throw new Error();
        const checks: unknown[] = [];
        for (const slot of [node.any, node.all, node.none]) { if (!Array.isArray(slot) || slot.length > 64) throw new Error(); checks.push(...slot); }
        if (checks.length !== 1) throw new Error();
        const check = checks[0] as {id?: unknown; data?: unknown} | null;
        if (check?.id !== "aria-valid-attr-value" || !check.data || typeof check.data !== "object" || Object.getPrototypeOf(check.data) !== Object.prototype) throw new Error();
        const fields = Object.getOwnPropertyDescriptors(check.data);
        if (Reflect.ownKeys(fields).length !== 2 || !fields.messageKey || !("value" in fields.messageKey) || fields.messageKey.value !== "controlsWithinPopup" ||
            !fields.needsReview || !("value" in fields.needsReview) || fields.needsReview.value !== 'aria-controls="application-notification-panel"') throw new Error();
        if (!Array.isArray(result.passes) || result.passes.length > 512) throw new Error();
        for (const group of result.passes) if (group?.id === "color-contrast") {
          if (!Array.isArray(group.nodes) || group.nodes.length > 10000) throw new Error();
          for (const sample of group.nodes) {
            if (!Array.isArray(sample.target) || sample.target.length !== 1 || typeof sample.target[0] !== "string" || !sample.target[0].length || sample.target[0].length > 4096) throw new Error();
            const matches = document.querySelectorAll(sample.target[0]); if (matches.length !== 1) throw new Error(); requireNotificationScope(matches[0]);
          }
        }
      }
      const violations = groups(result.violations), incomplete = groups(result.incomplete), passes = groups(result.passes);
      let attempted = 0, passed = 0;
      const outcomes = { violation: 0, unresolved: 0, noPositiveSample: 0 };
      const reasons = Object.fromEntries(reasonIds.map(key => [key, 0]));
      const hints = Object.fromEntries(hintIds.map(key => [key, 0]));
      const markers = Object.entries(regionMarkers);
      const regionIds = [...Object.keys(regionMarkers), "other"];
      const reasonRegions = Object.fromEntries(reasonIds.map(reason => [reason, Object.fromEntries(regionIds.map(region => [region, 0]))]));
      function diagnose(target: Element, measured: Result) {
        // Bound inspection independently of the engine's larger rule/node bounds.
        // A reason is one allowlisted messageKey, never a message or CSS value.
        let reason = "other", inspected = 0, limited = false;
        outer: for (const group of [...measured.violations, ...measured.incomplete]) {
          for (const node of group.nodes) {
            if (++inspected > 64) { limited = true; break outer; }
            for (const slot of [node.any, node.all, node.none]) {
              if (slot === undefined) continue;
              if (!Array.isArray(slot) || slot.length > 64) { limited = true; continue; }
              for (const check of slot) {
                if (++inspected > 64) { limited = true; break outer; }
                const item = check as { id?: unknown; data?: { messageKey?: unknown } } | null;
                if (item?.id !== "color-contrast") continue;
                const key = item.data?.messageKey;
                if (typeof key === "string" && reasonIds.includes(key as typeof reasonIds[number]) && key !== "other") { reason = key; break outer; }
              }
            }
          }
        }
        reasons[reason]!++; if (limited) hints.reasonScanLimit!++;
        let ancestor: Element | null = target, depth = 0, region = "other";
        const found = { backgroundImage: false, reducedOpacity: false, clippedAncestor: false, nonRgbColor: false };
        while (ancestor && depth++ < 64) {
          if (region === "other") {
            for (const [id, marker] of markers) {
              if (ancestor.classList.contains(marker)) { region = id; break; }
            }
          }
          const style = getComputedStyle(ancestor);
          if (style.backgroundImage && style.backgroundImage !== "none") found.backgroundImage = true;
          const opacity = Number(style.opacity); if (style.opacity && Number.isFinite(opacity) && opacity < 1) found.reducedOpacity = true;
          if ([style.overflowX, style.overflowY].some(value => value === "hidden" || value === "clip")) found.clippedAncestor = true;
          if (style.color && !/^rgba?\(/i.test(style.color)) found.nonRgbColor = true;
          ancestor = ancestor.parentElement;
        }
        reasonRegions[reason]![region]!++;
        if (ancestor) hints.ancestorLimit!++;
        for (const key of Object.keys(found) as Array<keyof typeof found>) if (found[key]) hints[key]!++;
      }
      for (const group of result.incomplete) {
        if (group.id !== "color-contrast") continue;
        if (group.nodes.length > 1000) throw new Error();
        for (const node of group.nodes) {
          if (!Array.isArray(node.target) || node.target.length !== 1 || typeof node.target[0] !== "string" || node.target[0].length > 4096) throw new Error();
          const selector = node.target[0], matches = document.querySelectorAll(selector);
          if (matches.length !== 1) throw new Error();
          const target = matches[0]!;
          requireNavigationScope(target);
          requireNotificationScope(target);
          target.scrollIntoView({ block: "center", inline: "nearest", behavior: "instant" });
          await new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
          if (!target.isConnected || document.querySelector(selector) !== target || !target.getClientRects().length || getComputedStyle(target).visibility !== "visible") throw new Error();
          requireNavigationScope(target);
          requireNotificationScope(target);
          const box = target.getBoundingClientRect();
          if (!Number.isFinite(box.width) || !Number.isFinite(box.height) || box.width <= 0 || box.height <= 0) throw new Error();
          const measured = await axe.run({ include: [[selector]] }, { runOnly: { type: "rule", values: ["color-contrast"] } });
          const bad = groups(measured.violations), unresolved = groups(measured.incomplete), good = groups(measured.passes);
          if (!target.isConnected || document.querySelector(selector) !== target) throw new Error();
          requireNavigationScope(target);
          requireNotificationScope(target);
          attempted++;
          if (!bad.length && !unresolved.length && good.some(item => item.rule === "color-contrast" && item.nodes > 0)) passed++;
          else {
            outcomes[bad.length ? "violation" : unresolved.length ? "unresolved" : "noPositiveSample"]++;
            diagnose(target, measured);
          }
        }
      }
      const facts = { violations, incomplete, contrastPassedNodes: passes.find(item => item.rule === "color-contrast")?.nodes ?? 0, retries: { attempted, passed } };
      requireNotificationScope();
      return { audit: width === "native400" ? facts : { schemaVersion: "technical-accessibility-audit-v1", width, ...facts },
        ...(scope === "notifications" ? {reference: {schemaVersion: "notification-popup-reference-v1", width, sharedShells: 1, bells: 1, dialogs: 1, headings: 1, namedBells: 1, buttonOpeners: 1,
          matchedIdReferences: 2, visibleElements: 3, stableElements: 3, engineReviewNodes: 1, engineRule: "aria-valid-attr-value", engineMessageKey: "controlsWithinPopup"}} : {}),
        diagnostics: { schemaVersion: "contrast-retry-diagnostics-v4", attempted, passed, outcomes, reasons, hints, reasonRegions } };
    } catch { throw new Error("Computed accessibility audit failed."); }
  }, { width, ruleIds: [...TECHNICAL_ACCESSIBILITY_RULE_IDS], scope, reasonIds: [...CONTRAST_RETRY_V2_REASON_IDS], hintIds: [...CONTRAST_RETRY_HINT_IDS], regionMarkers: CONTRAST_RETRY_V4_REGION_MARKERS });
  if (scope === "notifications") return readNotificationPopupAccessibilityObservation(observation);
  if (width === "native400") {
    const frame = await collectNative400Frame(page, scope === "runtime");
    return readNativeAccessibilityObservation(observation, media, rawNativeFrame(frame));
  }
  return readTechnicalAccessibilityObservation(observation);
}
/** Fixed foreground union; the separate closed-document audit remains mandatory. */
export function collectNotificationPopupAccessibilityObservation(page: Page, width: 320 | 1440) {
  if (arguments.length !== 2 || (width !== 320 && width !== 1440)) return Promise.reject(new Error("Invalid notification popup observation."));
  return collectAccessibilityObservation(page, width, "notifications");
}
function collectStandardAudit(page: Page, width: 320 | 1440, scope: "canvas" | "shell" | "runtime") {
  if (width !== 320 && width !== 1440) return Promise.reject(new Error("Invalid technical accessibility observation."));
  return collectAccessibilityObservation(page, width, scope).then(value => value.audit);
}
export function collectSystemBuilderAccessibilityAudit(page: Page, width: 320 | 1440) { return collectStandardAudit(page, width, "canvas"); }
export function collectDocumentAccessibilityAudit(page: Page, width: 320 | 1440) { return collectStandardAudit(page, width, "shell"); }
export function collectRuntimeAccessibilityAudit(page: Page, width: 320 | 1440) { return collectStandardAudit(page, width, "runtime"); }
export function collectNativeDocumentAccessibilityAudit(page: Page, media: "normal" | "forced-colors") { return collectAccessibilityObservation(page, "native400", "shell", media).then(value => value.audit); }
export function collectNativeRuntimeAccessibilityAudit(page: Page, media: "normal" | "forced-colors") { return collectAccessibilityObservation(page, "native400", "runtime", media).then(value => value.audit); }
/** Fixed collectors accept no observer or caller selector. */
export function collectDocumentAccessibilityObservation(page: Page, width: 320 | 1440, ...extra: unknown[]) {
  if (extra.length || (width !== 320 && width !== 1440)) return Promise.reject(new Error("Invalid technical accessibility observation."));
  return collectAccessibilityObservation(page, width, "shell");
}
/** Expanded opener and panel; callers also require the complete closed-page audit. */
export function collectExpandedNavigationAccessibilityObservation(page: Page, width: 320, ...extra: unknown[]) {
  if (extra.length || width !== 320) return Promise.reject(new Error("Invalid technical accessibility observation."));
  return collectAccessibilityObservation(page, width, "navigation");
}
export function collectRuntimeAccessibilityObservation(page: Page, width: 320 | 1440, ...extra: unknown[]) {
  if (extra.length || (width !== 320 && width !== 1440)) return Promise.reject(new Error("Invalid technical accessibility observation."));
  return collectAccessibilityObservation(page, width, "runtime");
}
export function collectNativeDocumentAccessibilityObservation(page: Page, media: "normal" | "forced-colors", ...extra: unknown[]) {
  if (extra.length) return Promise.reject(new Error("Invalid native accessibility observation."));
  return collectAccessibilityObservation(page, "native400", "shell", media);
}
export function collectNativeRuntimeAccessibilityObservation(page: Page, media: "normal" | "forced-colors", ...extra: unknown[]) {
  if (extra.length) return Promise.reject(new Error("Invalid native accessibility observation."));
  return collectAccessibilityObservation(page, "native400", "runtime", media);
}

/** Same named host constraints for Canvas and other critical mounted surfaces. */
export async function loadTechnicalAccessibilityReference() {
  try {
    const bytes = await readFile(path.join(ACCESSIBILITY_SOURCE_ROOT, "dev-tools/config/technical-reference-profiles.json"));
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
    const axeSource = await readTechnicalAccessibilityEngine();
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
