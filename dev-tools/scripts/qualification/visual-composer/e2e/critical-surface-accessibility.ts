import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import type { Page, TestInfo } from "@playwright/test";
import { qualifyCriticalAccessibilityReport, qualifyNativeCriticalAccessibilityReport, readCriticalAccessibilityMode, readCriticalAccessibilityContext, readReducedMotionObservation, readControlAccessObservation,
  type CriticalAccessibilityContext, type CriticalAccessibilityMode, type CriticalAccessibilitySurface, type TechnicalAccessibilityAudit, type NativeAccessibilityAudit } from "../technical-accessibility-observation";
import { collectDocumentAccessibilityAudit, collectRuntimeAccessibilityAudit, collectNative400Frame, rawNativeFrame, collectNativeDocumentAccessibilityAudit,
  collectNativeRuntimeAccessibilityAudit, finalizeTechnicalAccessibilityEvidence, loadTechnicalAccessibilityReference } from "./technical-accessibility";

const rawAudit = (audit: TechnicalAccessibilityAudit) => ({ schemaVersion: audit.schemaVersion, width: audit.width, violations: audit.violations,
  incomplete: audit.incomplete, contrastPassedNodes: audit.contrastPassedNodes, retries: audit.retries });

/** Actual Page assertions. Synthetic callback tests do not qualify a real host. */
export async function qualifyCriticalSurfaceAccessibility(page: Page, info: TestInfo, surface: CriticalAccessibilitySurface, mode: CriticalAccessibilityMode = "standard") {
  readCriticalAccessibilityMode(mode);
  if (typeof info.title !== "string" || !info.title.length || info.title.length > 256) throw new Error("Invalid critical accessibility context.");
  const context = readCriticalAccessibilityContext({ schemaVersion: "critical-accessibility-context-v1", surface, host: info.project.name,
    runId: process.env.VISUAL_COMPOSER_QUALIFICATION_RUN_ID, sourceRevision: process.env.VISUAL_COMPOSER_QUALIFICATION_SOURCE_REVISION,
    testKey: createHash("sha256").update(info.title).digest("hex") });
  if (mode === "native400") return qualifyNativeSurface(page, info, context);
  const folder = path.resolve("artifacts/qualification/visual-composer/runs", context.runId, "critical-accessibility", context.host, context.testKey, context.surface);
  const audits: ReturnType<typeof rawAudit>[] = [];
  const forcedColorsAudits: ReturnType<typeof rawAudit>[] = [];
  const report: Record<string, unknown> = { ...context, schemaVersion: "critical-surface-accessibility-v1", contextSchemaVersion: context.schemaVersion,
    status: "running", scope: "ui-accessibility-observation-only", audits, forcedColorsAudits };
  let created = false, stage = "reference-profile";
  async function save() {
    const body = JSON.stringify(report, null, 2) + "\n";
    if (Buffer.byteLength(body) > 262144) throw new Error("Critical accessibility evidence exceeded its bound.");
    await writeFile(path.join(folder, "evidence.json"), body, { flag: created ? "w" : "wx" });
    created = true;
  }
  async function controlAccess(width: 320 | 1440, key: string) {
    const observation = await page.evaluate(({ width }) => {
      try {
        const candidates = document.body.querySelectorAll('button,input:not([type="hidden"]),select,textarea,a[href],[role="button"],[tabindex]');
        if (candidates.length > 10000) throw new Error();
        const viewportWidth = document.documentElement.clientWidth;
        if (!Number.isFinite(viewportWidth) || viewportWidth <= 0) throw new Error();
        let controls = 0, inaccessible = 0;
        for (const element of candidates) {
          if (!(element instanceof HTMLElement) || element.closest('[inert],[aria-hidden="true"]') ||
            !element.getClientRects().length || getComputedStyle(element).visibility !== "visible") continue;
          controls++;
          element.scrollIntoView({ block: "nearest", inline: "nearest", behavior: "instant" });
          const box = element.getBoundingClientRect();
          if (![box.width, box.height, box.left, box.right].every(Number.isFinite) || box.width <= 0 || box.height <= 0 || box.left < -1 || box.right > viewportWidth + 1) inaccessible++;
        }
        return { width, controls, inaccessible };
      } catch { throw new Error("Critical control access observation failed."); }
    }, { width });
    const result = readControlAccessObservation(observation); report[key] = result;
    if (result.status !== "passed") throw new Error();
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
    const runtime = context.surface === "runtime-conversation";
    const mounted = await page.evaluate(runtime => document.querySelectorAll(runtime ? "main.system-runtime-app" : "main.ui-shell").length === 1, runtime);
    if (mounted !== true) throw new Error();
    stage = "audit-engine";
    await page.evaluate(await readFile(path.resolve("node_modules/axe-core/axe.min.js"), "utf8"));
    await page.emulateMedia({ reducedMotion: "reduce", forcedColors: "none" });
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
      stage = `control-access-${width}`; await controlAccess(width, stage);
      stage = `audit-${width}`;
      const audit = await (runtime ? collectRuntimeAccessibilityAudit : collectDocumentAccessibilityAudit)(page, width); audits.push(rawAudit(audit)); await save();
      if (audit.status !== "passed") throw new Error();
    }
    stage = "forced-colors-media";
    await page.emulateMedia({ reducedMotion: "reduce", forcedColors: "active" });
    if (await page.evaluate(() => matchMedia("(forced-colors: active)").matches) !== true) throw new Error();
    if (await page.evaluate(() => matchMedia("(prefers-reduced-motion: reduce)").matches) !== true) throw new Error();
    for (const width of [1440, 320] as const) {
      stage = `forced-colors-reflow-${width}`; await page.setViewportSize({ width, height: 1000 });
      const overflow: unknown = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      if (typeof overflow !== "number" || !Number.isFinite(overflow) || overflow < 0 || overflow > 1) throw new Error();
      stage = `forced-colors-control-access-${width}`; await controlAccess(width, stage);
      stage = `forced-colors-audit-${width}`;
      const audit = await (runtime ? collectRuntimeAccessibilityAudit : collectDocumentAccessibilityAudit)(page, width);
      forcedColorsAudits.push(rawAudit(audit)); await save();
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
        try { await page.emulateMedia({ reducedMotion: "no-preference", forcedColors: "none" }); }
        finally { await page.setViewportSize({ width: 1440, height: 1000 }); }
      });
  }
}

async function qualifyNativeSurface(page: Page, info: TestInfo, context: CriticalAccessibilityContext) {
  if (context.host === "managed-thin-chrome") throw new Error("Unsupported native accessibility host.");
  const runtime = context.surface === "runtime-conversation";
  // Admit the fixed native frame before creating evidence or changing media.
  const initialFrame = await collectNative400Frame(page, runtime);
  if (initialFrame.status !== "passed") throw new Error("Native accessibility frame admission failed.");
  const folder = path.resolve("artifacts/qualification/visual-composer/runs", context.runId, "native-critical-accessibility", context.host, context.testKey, context.surface);
  const audits: Array<{schemaVersion: string; media: string; frame: ReturnType<typeof rawNativeFrame>; facts: Omit<ReturnType<typeof rawAudit>, "schemaVersion" | "width">}> = [];
  const report: Record<string, unknown> = {...context, schemaVersion:"native-critical-surface-accessibility-v1", contextSchemaVersion:context.schemaVersion,
    status:"running", scope:"native-ui-observation-only", audits, initialFrame:rawNativeFrame(initialFrame)};
  let created = false, stage = "reference-profile";
  async function save() {
    const body = JSON.stringify(report, null, 2) + "\n";
    if (Buffer.byteLength(body) > 262144) throw new Error("Native accessibility evidence exceeded its bound.");
    await writeFile(path.join(folder,"evidence.json"),body,{flag:created ? "w" : "wx"}); created=true;
  }
  function raw(audit: NativeAccessibilityAudit) {
    return {schemaVersion:audit.schemaVersion,media:audit.media,frame:rawNativeFrame(audit.frame),facts:{violations:audit.violations,
      incomplete:audit.incomplete,contrastPassedNodes:audit.contrastPassedNodes,retries:audit.retries}};
  }
  try {
    const reference=await loadTechnicalAccessibilityReference();
    if (reference.profile.deviceScaleFactor !== 1) throw new Error();
    report.profile=reference.profile.environmentId;report.profileSha256=reference.profileSha256;report.hardware=reference.hardware;
    stage="evidence-setup";await mkdir(folder,{recursive:true});stage="evidence-create";await save();
    stage="audit-engine";await page.evaluate(await readFile(path.resolve("node_modules/axe-core/axe.min.js"),"utf8"));
    for (const media of ["normal","forced-colors"] as const) {
      stage=`native-${media}-media`;await page.emulateMedia({reducedMotion:"reduce",forcedColors:media==="normal"?"none":"active"});
      if (await page.evaluate(expected=>matchMedia("(prefers-reduced-motion: reduce)").matches &&
        matchMedia("(forced-colors: active)").matches===(expected==="forced-colors"),media)!==true) throw new Error();
      stage=`native-${media}-motion`;
      report[stage]=readReducedMotionObservation(await page.evaluate(()=>{
        try {
          const candidates=document.body.querySelectorAll("*");if(candidates.length>100000)throw new Error();
          let elements=0,maximumTransitionMilliseconds=0,maximumAnimationMilliseconds=0;
          for(const element of candidates){const style=getComputedStyle(element),box=element.getBoundingClientRect();
            if(!element.getClientRects().length||style.visibility!=="visible"||!Number.isFinite(box.width)||!Number.isFinite(box.height)||box.width<=0||box.height<=0)continue;
            elements++;
            for(const duration of style.transitionDuration.split(","))maximumTransitionMilliseconds=Math.max(maximumTransitionMilliseconds,Number.parseFloat(duration)*(duration.trim().endsWith("ms")?1:1000));
            if(style.animationName!=="none")for(const duration of style.animationDuration.split(","))maximumAnimationMilliseconds=Math.max(maximumAnimationMilliseconds,Number.parseFloat(duration)*(duration.trim().endsWith("ms")?1:1000));
          }
          return {elements,maximumTransitionMilliseconds,maximumAnimationMilliseconds};
        }catch{throw new Error("Native reduced motion observation failed.");}
      }));
      stage=`native-${media}-audit`;
      const audit=await(runtime?collectNativeRuntimeAccessibilityAudit:collectNativeDocumentAccessibilityAudit)(page,media);
      audits.push(raw(audit));await save();if(audit.status!=="passed")throw new Error();
    }
    const result=qualifyNativeCriticalAccessibilityReport(context,audits);Object.assign(report,result);return result;
  }catch{report.status="failed";report.failureStage=stage;throw new Error(`Native accessibility check failed at ${stage}.`);}
  finally{if(created)await finalizeTechnicalAccessibilityEvidence(report,save,
    ()=>info.attach(`native-critical-accessibility-${context.surface}`,{body:JSON.stringify(report),contentType:"application/json"}),
    ()=>page.emulateMedia({reducedMotion:"no-preference",forcedColors:"none"}));}
}
