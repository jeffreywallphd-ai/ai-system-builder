import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import type { CDPSession, Page, TestInfo } from "@playwright/test";
import { qualifyCriticalAccessibilityReport, qualifyNativeCriticalAccessibilityReport, readCriticalAccessibilityMode, readCriticalAccessibilityContext, readReducedMotionObservation, readControlAccessObservation,
  type CriticalAccessibilityContext, type CriticalAccessibilityMode, type CriticalAccessibilitySurface, type TechnicalAccessibilityAudit, type NativeAccessibilityAudit, type ContrastRetryDiagnostics } from "../technical-accessibility-observation";
import { collectDocumentAccessibilityObservation, collectExpandedNavigationAccessibilityObservation, collectRuntimeAccessibilityObservation, collectNative400Frame, rawNativeFrame, collectNativeDocumentAccessibilityObservation,
  collectNativeRuntimeAccessibilityObservation, finalizeTechnicalAccessibilityEvidence, loadTechnicalAccessibilityReference, readTechnicalAccessibilityEngine } from "./technical-accessibility";

const rawAudit = (audit: TechnicalAccessibilityAudit) => ({ schemaVersion: audit.schemaVersion, width: audit.width, violations: audit.violations,
  incomplete: audit.incomplete, contrastPassedNodes: audit.contrastPassedNodes, retries: audit.retries });

type OwnedBrowserRoleObservation = {schemaVersion:string;status:"collected"|"unavailable";source:"owned-browser-cdp";nativeAuthority:false;
  observer:{role:"playwright-worker";pid:number;parentPid:number};processes:Array<{pid:number;role:string}>};

/** The existing owned browser reports these roles. They are never native authority. */
export async function observeOwnedBrowserProcessRoles(page: Page) {
  const unavailable = (): OwnedBrowserRoleObservation => ({ schemaVersion: "owned-browser-role-observation-v1", status: "unavailable",
    source: "owned-browser-cdp", nativeAuthority: false,
    observer:{role:"playwright-worker",pid:process.pid,parentPid:process.ppid}, processes: [] });
  let session: CDPSession | undefined;
  let observation = unavailable();
  try {
    const browser = page.context().browser();
    if (!browser) return observation;
    session = await browser.newBrowserCDPSession();
    const result: unknown = await session.send("SystemInfo.getProcessInfo");
    const rows = result && typeof result === "object" ? (result as {processInfo?:unknown}).processInfo : undefined;
    if (!Array.isArray(rows) || rows.length === 0 || rows.length > 32) throw new Error();
    const seen = new Set<number>();
    const processes = rows.map((row: unknown) => {
      if (!row || typeof row !== "object") throw new Error();
      const {id, type} = row as {id?:unknown;type?:unknown};
      if (typeof id !== "number" || !Number.isSafeInteger(id) || id <= 0 || id > 0xffffffff || seen.has(id) || typeof type !== "string" || type.length > 64) throw new Error();
      seen.add(id);
      return {pid:id,role:["browser","renderer","GPU","utility","service_worker","zygote"].includes(type) ? type : "other"};
    });
    observation = {...unavailable(),status:"collected",processes};
  } catch { observation = unavailable(); }
  finally {
    if (session) { try { await session.detach(); } catch { observation = unavailable(); } }
  }
  return observation;
}

/** Use the mounted navigation layout. Never force a hidden sidebar control. */
export async function navigateCriticalApplicationArea(page: Page, area: "Home" | "Data" | "Artifacts" | "Context") {
  let stage = "target-admission";
  try {
    if (!["Home", "Data", "Artifacts", "Context"].includes(area)) throw new Error();
    stage = "sidebar-admission";
    const sidebar = page.locator("aside.ui-shell__sidebar");
    if (await sidebar.count() !== 1) throw new Error();
    if (await sidebar.isVisible()) {
      stage = "sidebar-target-admission";
      const target = sidebar.getByRole("button", { name: area, exact: true });
      if (await target.count() !== 1) throw new Error();
      stage = "sidebar-target-visibility";
      await target.waitFor({ state: "visible" });
      stage = "sidebar-target-activation";
      await target.click();
      return;
    }
    stage = "menu-trigger-admission";
    // SUMMARY is a native disclosure control. Playwright does not give it the
    // same implicit role as BUTTON; retain its actual markup and keyboard use.
    const trigger = page.locator('summary.ui-shell__menu-trigger[aria-label="Open navigation menu"]');
    const menu = page.getByRole("menu", { name: "Application navigation", exact: true, includeHidden: true });
    if (await trigger.count() !== 1 || await menu.count() !== 1) throw new Error();
    stage = "menu-trigger-visibility";
    await trigger.waitFor({ state: "visible" });
    stage = "menu-trigger-state";
    const expanded = await trigger.getAttribute("aria-expanded");
    if (expanded !== "true" && expanded !== "false") throw new Error();
    stage = "menu-trigger-activation";
    if (expanded === "false") await trigger.press("Enter");
    stage = "menu-visibility";
    await menu.waitFor({ state: "visible" });
    stage = "menu-target-admission";
    const target = menu.getByRole("menuitem", { name: area, exact: true });
    if (await target.count() !== 1) throw new Error();
    stage = "menu-target-visibility";
    await target.waitFor({ state: "visible" });
    stage = "menu-target-activation";
    await target.press("Enter");
    stage = "menu-closure";
    await menu.waitFor({ state: "hidden" });
  } catch { throw new Error(`Critical application navigation failed. Stage: ${stage}.`); }
}

/** Owning test launchers prepare standard Pages. Native zoom stays unmodified. */
export async function prepareCriticalAccessibilityViewport(page: Page, mode: CriticalAccessibilityMode = "standard") {
  readCriticalAccessibilityMode(mode);
  if (mode === "native400") return;
  try {
    // Playwright caches requested dimensions before its channel completes.
    // A failed setter must never be rescued by reading that cached value.
    await page.setViewportSize({ width: 1440, height: 1000 });
    const viewport = page.viewportSize();
    if (!viewport || viewport.width !== 1440 || viewport.height !== 1000) throw new Error();
  } catch { throw new Error("Standard accessibility viewport setup failed."); }
}

async function requireNavigationLayout(page: Page, narrow: boolean) {
  const observed = await page.evaluate(narrow => {
    const sidebar = document.querySelectorAll(".ui-shell__sidebar"), trigger = document.querySelectorAll(".ui-shell__menu-trigger"), panel = document.querySelectorAll(".ui-shell__menu-panel");
    if (sidebar.length !== 1 || trigger.length !== 1 || panel.length !== 1) return false;
    const visible = (node: Element) => node.getClientRects().length > 0 && getComputedStyle(node).visibility === "visible";
    return narrow ? !visible(sidebar[0]!) && visible(trigger[0]!) && visible(panel[0]!) && trigger[0]!.getAttribute("aria-expanded") === "true"
      : visible(sidebar[0]!) && !visible(trigger[0]!) && !visible(panel[0]!);
  }, narrow);
  if (observed !== true) throw new Error("Critical navigation layout observation failed.");
}

/** Measure the whole page without covered text, then restore the actual menu. */
async function collectClosedNavigationDocument(page: Page) {
  const trigger = page.locator("summary.ui-shell__menu-trigger");
  const panel = page.locator('.ui-shell__menu-panel[role="menu"]');
  await trigger.press("Escape");
  await panel.waitFor({ state: "hidden" });
  if (await trigger.getAttribute("aria-expanded") !== "false") throw new Error();
  try { return await collectDocumentAccessibilityObservation(page, 320); }
  finally {
    await trigger.press("ArrowDown");
    await panel.waitFor({ state: "visible" });
    if (await trigger.getAttribute("aria-expanded") !== "true") throw new Error();
  }
}

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
  const navigationMenuAudits: Array<{ media: "normal" | "forced-colors"; audit: ReturnType<typeof rawAudit> }> = [];
  const report: Record<string, unknown> = { ...context, schemaVersion: "critical-surface-accessibility-v1", contextSchemaVersion: context.schemaVersion,
    status: "running", scope: "ui-accessibility-observation-only", audits, forcedColorsAudits };
  if (context.surface === "navigation-menu") report.navigationMenuAudits = navigationMenuAudits;
  let created = false, stage = "reference-profile";
  let failedContrast: { stage: string; observation: ContrastRetryDiagnostics } | undefined;
  let originalViewport: { width: number; height: number } | undefined;
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
    stage = "viewport-admission";
    const viewport = page.viewportSize();
    if (!viewport || !Number.isSafeInteger(viewport.width) || viewport.width <= 0 || !Number.isSafeInteger(viewport.height) || viewport.height <= 0) throw new Error();
    originalViewport = { width: viewport.width, height: viewport.height };
    if (context.host === "thin-chrome" && process.env.PYTHON_RUNTIME_QUALIFICATION_SCENARIO === "dataset-profile") {
      report.browserProcessRolesBefore = await observeOwnedBrowserProcessRoles(page);
    }
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
    await page.evaluate(await readTechnicalAccessibilityEngine());
    await page.emulateMedia({ reducedMotion: "reduce", forcedColors: "none" });
    if (await page.evaluate(() => matchMedia("(prefers-reduced-motion: reduce)").matches) !== true) throw new Error();
    for (const width of [1440, 320] as const) {
      stage = `reflow-${width}`; await page.setViewportSize({ width, height: 1000 });
      const overflow: unknown = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      if (typeof overflow !== "number" || !Number.isFinite(overflow) || overflow < 0 || overflow > 1) throw new Error();
      if (context.surface === "navigation-menu") { stage = `navigation-layout-${width}`; await requireNavigationLayout(page, width === 320); }
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
      const { audit, diagnostics } = await (context.surface === "navigation-menu" && width === 320 ? collectClosedNavigationDocument(page)
        : (runtime ? collectRuntimeAccessibilityObservation : collectDocumentAccessibilityObservation)(page, width));
      if (audit.status === "failed") failedContrast = { stage, observation: diagnostics };
      audits.push(rawAudit(audit)); await save();
      if (audit.status !== "passed") throw new Error();
      if (context.surface === "navigation-menu" && width === 320) {
        stage = "expanded-navigation-audit-320";
        const expanded = await collectExpandedNavigationAccessibilityObservation(page, width);
        navigationMenuAudits.push({ media: "normal", audit: rawAudit(expanded.audit) });
        if (expanded.audit.status === "failed") failedContrast = { stage, observation: expanded.diagnostics };
        await save(); if (expanded.audit.status !== "passed") throw new Error();
      }
    }
    stage = "forced-colors-media";
    await page.emulateMedia({ reducedMotion: "reduce", forcedColors: "active" });
    if (await page.evaluate(() => matchMedia("(forced-colors: active)").matches) !== true) throw new Error();
    if (await page.evaluate(() => matchMedia("(prefers-reduced-motion: reduce)").matches) !== true) throw new Error();
    for (const width of [1440, 320] as const) {
      stage = `forced-colors-reflow-${width}`; await page.setViewportSize({ width, height: 1000 });
      const overflow: unknown = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      if (typeof overflow !== "number" || !Number.isFinite(overflow) || overflow < 0 || overflow > 1) throw new Error();
      if (context.surface === "navigation-menu") { stage = `forced-colors-navigation-layout-${width}`; await requireNavigationLayout(page, width === 320); }
      stage = `forced-colors-control-access-${width}`; await controlAccess(width, stage);
      stage = `forced-colors-audit-${width}`;
      const { audit, diagnostics } = await (context.surface === "navigation-menu" && width === 320 ? collectClosedNavigationDocument(page)
        : (runtime ? collectRuntimeAccessibilityObservation : collectDocumentAccessibilityObservation)(page, width));
      if (audit.status === "failed") failedContrast = { stage, observation: diagnostics };
      forcedColorsAudits.push(rawAudit(audit)); await save();
      if (audit.status !== "passed") throw new Error();
      if (context.surface === "navigation-menu" && width === 320) {
        stage = "forced-colors-expanded-navigation-audit-320";
        const expanded = await collectExpandedNavigationAccessibilityObservation(page, width);
        navigationMenuAudits.push({ media: "forced-colors", audit: rawAudit(expanded.audit) });
        if (expanded.audit.status === "failed") failedContrast = { stage, observation: expanded.diagnostics };
        await save(); if (expanded.audit.status !== "passed") throw new Error();
      }
    }
    if (context.host === "thin-chrome" && process.env.PYTHON_RUNTIME_QUALIFICATION_SCENARIO === "dataset-profile") {
      report.browserProcessRolesAfter = await observeOwnedBrowserProcessRoles(page);
    }
    const result = qualifyCriticalAccessibilityReport(context, audits);
    Object.assign(report, result); return result;
  } catch {
    report.status = "failed"; report.failureStage = stage;
    if (failedContrast) report.contrastRetryDiagnostics = failedContrast;
    throw new Error(`Critical accessibility check failed at ${stage}.`);
  } finally {
    if (created) await finalizeTechnicalAccessibilityEvidence(report, save,
      () => info.attach(`critical-accessibility-${context.surface}`, { body: JSON.stringify(report), contentType: "application/json" }),
      async () => {
        try { await page.emulateMedia({ reducedMotion: "no-preference", forcedColors: "none" }); }
        finally { if (originalViewport) await page.setViewportSize(originalViewport); }
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
  let failedContrast: { stage: string; observation: ContrastRetryDiagnostics } | undefined;
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
    if (context.host === "thin-chrome" && process.env.PYTHON_RUNTIME_QUALIFICATION_SCENARIO === "dataset-profile") {
      report.browserProcessRolesBefore = await observeOwnedBrowserProcessRoles(page);
    }
    stage="evidence-setup";await mkdir(folder,{recursive:true});stage="evidence-create";await save();
    stage="audit-engine";await page.evaluate(await readTechnicalAccessibilityEngine());
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
      if(context.surface === "navigation-menu") { stage=`native-${media}-navigation-layout`;await requireNavigationLayout(page,true); }
      stage=`native-${media}-audit`;
      const {audit,diagnostics}=await(runtime?collectNativeRuntimeAccessibilityObservation:collectNativeDocumentAccessibilityObservation)(page,media);
      if(audit.status==="failed")failedContrast={stage,observation:diagnostics};
      audits.push(raw(audit));await save();if(audit.status!=="passed")throw new Error();
    }
    if (context.host === "thin-chrome" && process.env.PYTHON_RUNTIME_QUALIFICATION_SCENARIO === "dataset-profile") {
      report.browserProcessRolesAfter = await observeOwnedBrowserProcessRoles(page);
    }
    const result=qualifyNativeCriticalAccessibilityReport(context,audits);Object.assign(report,result);return result;
  }catch{report.status="failed";report.failureStage=stage;if(failedContrast)report.contrastRetryDiagnostics=failedContrast;throw new Error(`Native accessibility check failed at ${stage}.`);}
  finally{if(created)await finalizeTechnicalAccessibilityEvidence(report,save,
    ()=>info.attach(`native-critical-accessibility-${context.surface}`,{body:JSON.stringify(report),contentType:"application/json"}),
    ()=>page.emulateMedia({reducedMotion:"no-preference",forcedColors:"none"}));}
}
