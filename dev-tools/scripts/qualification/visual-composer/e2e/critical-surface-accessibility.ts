import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import type { Page, TestInfo } from "@playwright/test";
import { qualifyCriticalAccessibilityReport, readCriticalAccessibilityContext, readReducedMotionObservation, type CriticalAccessibilitySurface, type TechnicalAccessibilityAudit } from "../technical-accessibility-observation";
import { collectDocumentAccessibilityAudit, finalizeTechnicalAccessibilityEvidence, loadTechnicalAccessibilityReference } from "./technical-accessibility";

const rawAudit = (audit: TechnicalAccessibilityAudit) => ({ schemaVersion: audit.schemaVersion, width: audit.width, violations: audit.violations,
  incomplete: audit.incomplete, contrastPassedNodes: audit.contrastPassedNodes, retries: audit.retries });

/** Actual Page assertions. Synthetic callback tests do not qualify a real host. */
export async function qualifyCriticalSurfaceAccessibility(page: Page, info: TestInfo, surface: CriticalAccessibilitySurface) {
  if (typeof info.title !== "string" || !info.title.length || info.title.length > 256) throw new Error("Invalid critical accessibility context.");
  const context = readCriticalAccessibilityContext({ schemaVersion: "critical-accessibility-context-v1", surface, host: info.project.name,
    runId: process.env.VISUAL_COMPOSER_QUALIFICATION_RUN_ID, sourceRevision: process.env.VISUAL_COMPOSER_QUALIFICATION_SOURCE_REVISION,
    testKey: createHash("sha256").update(info.title).digest("hex") });
  const folder = path.resolve("artifacts/qualification/visual-composer/runs", context.runId, "critical-accessibility", context.host, context.testKey, context.surface);
  const audits: ReturnType<typeof rawAudit>[] = [];
  const report: Record<string, unknown> = { ...context, schemaVersion: "critical-surface-accessibility-v1", contextSchemaVersion: context.schemaVersion,
    status: "running", scope: "ui-accessibility-observation-only", audits };
  let created = false, stage = "reference-profile";
  async function save() {
    const body = JSON.stringify(report, null, 2) + "\n";
    if (Buffer.byteLength(body) > 262144) throw new Error("Critical accessibility evidence exceeded its bound.");
    await writeFile(path.join(folder, "evidence.json"), body, { flag: created ? "w" : "wx" });
    created = true;
  }
  try {
    const reference = await loadTechnicalAccessibilityReference();
    report.profile = reference.profile.environmentId; report.profileSha256 = reference.profileSha256; report.hardware = reference.hardware;
    stage = "evidence-setup"; await mkdir(folder, { recursive: true });
    stage = "evidence-create"; await save();
    stage = "browser-profile";
    const scale: unknown = await page.evaluate(() => devicePixelRatio);
    if (typeof scale !== "number" || !Number.isFinite(scale) || scale !== reference.profile.deviceScaleFactor) throw new Error();
    report.browser = { deviceScaleFactor: scale };
    const mounted = await page.evaluate(() => document.querySelectorAll("main.ui-shell").length === 1);
    if (mounted !== true) throw new Error();
    stage = "audit-engine";
    await page.evaluate(await readFile(path.resolve("node_modules/axe-core/axe.min.js"), "utf8"));
    await page.emulateMedia({ reducedMotion: "reduce" });
    if (await page.evaluate(() => matchMedia("(prefers-reduced-motion: reduce)").matches) !== true) throw new Error();
    for (const width of [1440, 320] as const) {
      stage = `reflow-${width}`; await page.setViewportSize({ width, height: 1000 });
      const overflow: unknown = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      if (typeof overflow !== "number" || !Number.isFinite(overflow) || overflow < 0 || overflow > 1) throw new Error();
      stage = `motion-${width}`;
      const motion = await page.evaluate(() => {
        try {
          let elements = 0, maximumTransitionMilliseconds = 0, maximumAnimationMilliseconds = 0;
          const candidates = document.body.querySelectorAll("*");
          if (candidates.length > 100000) throw new Error();
          for (const element of candidates) {
            const style = getComputedStyle(element), box = element.getBoundingClientRect();
            if (!element.getClientRects().length || style.visibility !== "visible" || !Number.isFinite(box.width) || !Number.isFinite(box.height) || box.width <= 0 || box.height <= 0) continue;
            elements++;
            for (const duration of style.transitionDuration.split(",")) maximumTransitionMilliseconds = Math.max(maximumTransitionMilliseconds, Number.parseFloat(duration) * (duration.trim().endsWith("ms") ? 1 : 1000));
            if (style.animationName !== "none") for (const duration of style.animationDuration.split(",")) maximumAnimationMilliseconds = Math.max(maximumAnimationMilliseconds, Number.parseFloat(duration) * (duration.trim().endsWith("ms") ? 1 : 1000));
          }
          return { elements, maximumTransitionMilliseconds, maximumAnimationMilliseconds };
        } catch { throw new Error("Critical reduced motion observation failed."); }
      });
      report[`motion-${width}`] = readReducedMotionObservation(motion);
      stage = `audit-${width}`;
      const audit = await collectDocumentAccessibilityAudit(page, width); audits.push(rawAudit(audit)); await save();
      if (audit.status !== "passed") throw new Error();
    }
    const result = qualifyCriticalAccessibilityReport(context, audits);
    Object.assign(report, result); return result;
  } catch {
    report.status = "failed"; report.failureStage = stage;
    throw new Error(`Critical accessibility check failed at ${stage}.`);
  } finally {
    if (created) await finalizeTechnicalAccessibilityEvidence(report, save,
      () => info.attach(`critical-accessibility-${context.surface}`, { body: JSON.stringify(report), contentType: "application/json" }),
      async () => {
        try { await page.emulateMedia({ reducedMotion: "no-preference" }); }
        finally { await page.setViewportSize({ width: 1440, height: 1000 }); }
      });
  }
}
