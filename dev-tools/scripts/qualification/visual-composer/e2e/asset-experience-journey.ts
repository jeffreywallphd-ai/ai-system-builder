import {requireAssetQualificationIdentity, assetObservation, createAssetEvidenceReport, assetEvidenceBody, finalizeAssetEvidence, assetAdmissionFailure, assetCaptureBudget, assetViewportPng, type AssetFailureStage, type AssetQualificationIdentity} from "../asset-experience-oracles";
import {runOwnedRestartPhase} from "../asset-authoring-oracles";
import {collectDocumentAccessibilityAudit, collectNativeDocumentAccessibilityAudit} from "./technical-accessibility";
import type {AssetAiContext} from "../../../../../modules/contracts/asset/asset-ai-context";
import assert from "node:assert/strict";
import {createHash} from "node:crypto";
import { assertNative400PercentZoom } from "../native-browser-zoom.mjs";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { expect, type Page, type TestInfo } from "@playwright/test";
import { SYSTEM_FOUNDATION_PACK_MANIFEST } from "../../../../../modules/application/services/asset-packs/system-packs";
import { createPackageFixture } from "../../../../../modules/testing/fixtures/asset-package-fixture";

/** Public UI only: actual HTTP or preload/IPC, inert resources, no source execution. */
export async function completeAssetExperienceJourney(page: Page, restart: () => Promise<Page>, info: TestInfo, identity: AssetQualificationIdentity) {
  requireAssetQualificationIdentity(identity);
  const nativeZoom = identity.nativeZoom;
  const boundActions = (current: Page) => {current.setDefaultTimeout(10000); current.setDefaultNavigationTimeout(30000);};
  boundActions(page);
  const restartBounded = async () => {const current = await restart(); boundActions(current); return current;};
  // Both managed cases share one owned host, so each publishes distinct identities.
  const suffix = identity.suffix;
  const identities = {
    foundation: `asset.qualification-foundation-copy${suffix}`,
    imported: `asset.qualification-import-copy${suffix}`,
    studio: `asset.qualification-status-summary${suffix}`,
  };
  const names = {foundation: `Qualification Foundation Copy${suffix}`, imported: `Qualification Imported Copy${suffix}`, studio: `Qualification Status Summary${suffix}`};
  const tabs = () => page.getByRole("tablist", {name: "Assets sections"});
  const select = async (name: string) => {await tabs().getByRole("tab", {name, exact: true}).focus(); await page.keyboard.press("Enter");};
  if (!nativeZoom) {
    await select("Saved");
    const saved = page.locator(".asset-studio--saved");
    await expect(saved).toHaveAttribute("aria-busy", "false", {timeout: 60000});
    await expect(saved.locator(".ui-empty-state")).toBeVisible();
    await page.evaluate(await readFile(path.resolve("node_modules/axe-core/axe.min.js"), "utf8"));
    const emptyContrast = await page.evaluate(async () => {
      const result = await (window as any).axe.run({include: [[".asset-studio--saved .ui-empty-state"]]}, {runOnly: {type: "rule", values: ["color-contrast"]}});
      return {violations: result.violations.length, incomplete: result.incomplete.length, passed: result.passes.reduce((sum: number, row: any) => sum + row.nodes.length, 0)};
    });
    await info.attach("empty-saved-contrast", {body: JSON.stringify({source: identity.source, host: identity.host, ...emptyContrast}), contentType: "application/json"});
    expect(emptyContrast.violations).toBe(0); expect(emptyContrast.incomplete).toBe(0); expect(emptyContrast.passed).toBeGreaterThan(0);
  }
  await select("Import Assets");
  const pack = await createPackageFixture();
  await page.locator('.asset-package-manager input[type="file"]').setInputFiles({name: "qualification.aisb-package", mimeType: "application/vnd.ai-system-builder.package.v1+json", buffer: pack.bytes});
  try {await expect(page.getByRole("button", {name: "Install package", exact: true})).toBeEnabled({timeout: 60000});}
  catch (error) {
    const folder = path.resolve("artifacts/qualification/visual-composer/runs", identity.runId, "asset-admission");
    await assetAdmissionFailure(identity, error, async body => {
      await mkdir(folder, {recursive: true});
      await writeFile(path.join(folder, `${identity.host}-${nativeZoom ? "native400" : "workflow"}.json`), body, {flag: "wx"});
    }, body => info.attach("asset-admission-diagnostic", {body, contentType: "application/json"}));
    throw new Error("Assets package admission failed.");
  }
  await page.getByRole("button", {name: "Install package", exact: true}).click();
  await expect(page.locator(".asset-package-manager__installed")).toContainText(/installed/i);
  // Do not activate: import, customization and publication grant no execution authority.
  const foundation = SYSTEM_FOUNDATION_PACK_MANIFEST.assets.find(entry => entry.definitionRef.id === "builtin.form.submit-action")!.definitionRef;
  const imported = pack.container.manifest.implementations[0]!.definitionRef;
  const originalBases = new Map<string, string>();
  for (const [search, version, id, name] of [[String(foundation.id), foundation.version!, identities.foundation, names.foundation], [String(imported.id), imported.version!, identities.imported, names.imported]]) {
    await select("Customizations");
    const customizer = page.locator(".asset-customizer");
    await customizer.getByLabel("Search assets", {exact: true}).fill(search!);
    await customizer.getByRole("button", {name: "Search", exact: true}).click();
    await expect(customizer.getByText("Loading customization targets...", {exact: true})).toBeHidden({timeout: 60000});
    const target = customizer.locator(".asset-customizer__target:enabled").filter({hasText: `${search} - v${version}`});
    await expect(target).toHaveCount(1);
    await expect(target).toContainText(search === "builtin.form.submit-action" ? "system-owned-asset" : "workspace-imported-asset");
    await expect(target).toBeVisible();
    await target.focus(); await page.keyboard.press("Enter");
    const change = page.getByRole("dialog", {name: "Change customization target?"});
    if (await change.isVisible()) await change.getByRole("button", {name: "Change asset", exact: true}).click();
    await expect(customizer.locator(".ui-status").filter({hasText: "Base:"})).toContainText(`${search} - v${version}`);
    await expect(customizer.locator(".asset-customizer__resources details").first()).toBeVisible();
    const baseSnapshot = await captureCustomizationBase(page);
    originalBases.set(search!, baseSnapshot);
    await customizer.getByLabel("Relative path", {exact: true}).fill("frontend/qualification-status.css");
    await customizer.getByLabel("Role", {exact: true}).selectOption("frontend-style");
    await customizer.getByLabel("Media type", {exact: true}).fill("text/css");
    await customizer.getByLabel("Resource content", {exact: true}).fill(".qualification-status { border: 2px solid #176325; }");
    await customizer.getByRole("button", {name: "Add resource to draft", exact: true}).click();
    await customizer.getByLabel("Derived definition ID", {exact: true}).fill(id!);
    await customizer.getByLabel("Display name", {exact: true}).fill(name!);
    await customizer.getByRole("button", {name: "Create customization draft", exact: true}).click();
    await expect(customizer.getByRole("button", {name: "Save changes", exact: true})).toBeEnabled();
    await customizer.getByLabel("Description", {exact: true}).fill("Status summary with an emphasized status border.");
    await customizer.getByRole("button", {name: "Save changes", exact: true}).click();
    await expect(customizer.locator(".ui-status").filter({hasText: "Status:"})).toContainText("revision 2");
    await customizer.getByRole("button", {name: "Materialize review snapshot", exact: true}).click();
    await expect(customizer.getByRole("button", {name: "Publish customized copy", exact: true})).toBeEnabled();
    await customizer.getByRole("button", {name: "Publish customized copy", exact: true}).click();
    await expect(customizer.locator(".asset-customizer__history")).toContainText(name!);
    await expect(customizer.locator(".ui-status").filter({hasText: "Status:"})).toContainText("published");
    // Recreate the application, then reselect the exact base and compare all visible source/semantic values.
    page = await restartBounded();
    await select("Customizations");
    const reopened = page.locator(".asset-customizer");
    await reopened.getByLabel("Search assets", {exact: true}).fill(search!);
    await reopened.getByRole("button", {name: "Search", exact: true}).click();
    await expect(reopened.getByText("Loading customization targets...", {exact: true})).toBeHidden({timeout: 60000});
    const reopenedTarget = reopened.locator(".asset-customizer__target:enabled").filter({hasText: `${search} - v${version}`});
    await expect(reopenedTarget).toHaveCount(1);
    await reopenedTarget.click();
    await expect(reopened.getByLabel("Derived definition ID", {exact: true})).toBeVisible();
    await expect(reopened.locator(".ui-status").filter({hasText: "Base:"})).toContainText(`${search} - v${version}`);
    await expect(reopened.locator(".asset-customizer__resources details").first()).toBeVisible();
    expect(await captureCustomizationBase(page)).toEqual(baseSnapshot);
    await expect(reopened.locator(".asset-customizer__history")).toContainText(name!);
  }
  await select("Studio");
  let studio = page.locator(".asset-studio--unified");
  await studio.getByLabel("Asset ID", {exact: true}).fill(identities.studio);
  await studio.getByLabel("Display name", {exact: true}).fill(names.studio);
  await studio.getByLabel(/^Asset type/).selectOption("tool");
  await studio.getByLabel(/^Asset family/).selectOption("behavioral");
  await studio.getByLabel("Definition", {exact: true}).fill("Summarize selected system status records for the user.");
  const aiContext: AssetAiContext = {purpose: "Summarize system status.", userFacingSummary: "A status summary.", developerFacingSummary: "Inert qualification resource bundle.", capabilities: [{summary: "status-summary"}], limitations: [{summary: "Synthetic fixture only."}]};
  await studio.getByLabel("AI context", {exact: true}).fill(JSON.stringify(aiContext));
  let source = studio.getByLabel("Resource content", {exact: true});
  await expect(source).toHaveCount(3);
  const resourceValues = ["export const View = () => <output>Status ready</output>;", "output { color: #176325; }", "export const summarize = (rows: unknown[]) => ({ count: rows.length });"];
  for (let index = 0; index < 3; index++) await source.nth(index).fill(resourceValues[index]!);
  await studio.getByRole("button", {name: "Save new draft", exact: true}).click();
  await expect(studio.locator(".ui-badge").first()).toHaveText("draft - revision 1");
  page = await restartBounded();
  studio = page.locator(".asset-studio--unified"); source = studio.getByLabel("Resource content", {exact: true});
  await select("Saved");
  const saved = page.locator(".asset-studio__saved-card").filter({hasText: names.studio});
  await expect(page.locator(".asset-studio--saved")).toHaveAttribute("aria-busy", "false", {timeout: 60000});
  await expect(saved).toBeVisible();
  await saved.getByRole("button", {name: "Open in Studio", exact: true}).focus(); await page.keyboard.press("Enter");
  await expect(studio.getByLabel("Display name", {exact: true})).toHaveValue(names.studio);
  await expect(studio.getByLabel("Asset ID", {exact: true})).toHaveValue(identities.studio);
  await expect(studio.getByLabel("Version", {exact: true})).toHaveValue("1.0.0");
  await expect(studio.getByLabel("Asset type", {exact: true})).toHaveValue("tool");
  await expect(studio.getByLabel("Asset family", {exact: true})).toHaveValue("behavioral");
  await expect(studio.getByLabel("Definition", {exact: true})).toHaveValue("Summarize selected system status records for the user.");
  expect(JSON.parse(await studio.getByLabel("AI context", {exact: true}).inputValue())).toEqual(aiContext);
  for (const [index, resourcePath] of ["frontend/AssetView.tsx", "frontend/asset.css", "backend/handleAssetRequest.ts"].entries()) {
    const resource = studio.locator(".asset-studio__resource").nth(index);
    await expect(resource.getByLabel("Resource path", {exact: true})).toHaveValue(resourcePath);
    await expect(resource.getByLabel("Media type", {exact: true})).toHaveValue(index === 1 ? "text/css" : "text/typescript");
    await expect(source.nth(index)).toHaveValue(resourceValues[index]!);
  }
  await studio.getByRole("button", {name: "Review draft", exact: true}).click();
  await expect(studio.locator(".ui-badge").first()).toHaveText("reviewed - revision 2");
  await studio.getByRole("button", {name: "Publish asset", exact: true}).click();
  await expect(studio.locator(".ui-badge").first()).toHaveText("published - revision 3");
  page = await restartBounded();
  await select("Customizations");
  await expect(page.locator(".asset-customizer__history")).toContainText(names.foundation);
  await expect(page.locator(".asset-customizer__history")).toContainText(names.imported);
  await select("Browse");
  await page.getByLabel("Search assets", {exact: true}).fill(names.studio);
  // Search may be immediate or submitted, depending on the composed browse surface.
  const searchButton = page.getByRole("button", {name: "Search", exact: true});
  if (await searchButton.count()) await searchButton.click();
  await expect(page.getByText(names.studio, {exact: true}).first()).toBeVisible();
  for (const [id, name] of [[identities.foundation, names.foundation], [identities.imported, names.imported]]) {
    await page.getByLabel("Search assets", {exact: true}).fill(id!);
    if (await searchButton.count()) await searchButton.click();
    const card = page.locator(".asset-definition-card").filter({hasText: name!});
    await expect(card).toHaveCount(1);
    await expect(card).toContainText("v1.0.0");
    await card.locator(".asset-definition-card__preview").click();
    const detail = page.getByRole("dialog", {name: name!, exact: true});
    await expect(detail.getByRole("heading", {name: name!, exact: true}).first()).toBeVisible();
    await expect(detail).toContainText("Status summary with an emphasized status border.");
    await expect(detail.getByText("Published", {exact: true})).toBeVisible();
    await expect(detail.getByText("v1.0.0", {exact: true})).toBeVisible();
    await detail.getByRole("button", {name: "Close asset details", exact: true}).click();
    await select("Customizations");
    const history = page.locator(".asset-customizer__history li").filter({hasText: id!});
    await expect(history).toHaveCount(1);
    await expect(history).toContainText(name!);
    await expect(history).toContainText("published - revision 4");
    await expect(history).toContainText(`${id} v1.0.0`);
    await select("Browse");
  }
  // Publication does not release/activate an implementation. Re-derivation is
  // intentionally unavailable; verify the original bases, not invented targets.
  // Exact postrestart reviewed overlay/source bytes have separate repository +
  // verified-artifact recomposition coverage, not a claimed history-reopen UI.
  for (const original of [foundation, imported]) {
    await select("Customizations");
    const customizer = page.locator(".asset-customizer");
    await customizer.getByLabel("Search assets", {exact: true}).fill(String(original.id));
    await customizer.getByRole("button", {name: "Search", exact: true}).click();
    await expect(customizer.getByText("Loading customization targets...", {exact: true})).toBeHidden({timeout: 60000});
    const target = customizer.locator(".asset-customizer__target:enabled").filter({hasText: `${original.id} - v${original.version}`});
    await expect(target).toHaveCount(1);
    await target.click();
    const change = page.getByRole("dialog", {name: "Change customization target?"});
    if (await change.isVisible()) await change.getByRole("button", {name: "Change asset", exact: true}).click();
    await expect(customizer.locator(".ui-status").filter({hasText: "Base:"})).toContainText(`${original.id} - v${original.version}`);
    expect(await captureCustomizationBase(page)).toBe(originalBases.get(String(original.id)));
  }
  await info.attach("asset-journey", {body: JSON.stringify({source: identity.source, host: identity.host, status: "passed", completed: ["inert-import-install", "foundation-copy", "imported-copy", "studio-three-resources", "saved-exact-reopen", "review-publish", "reload-rediscovery"], scope: "real local UI; no native storage-race, provider, model or production profile qualification"}), contentType: "application/json"});
}

export async function qualifyAssetSurfaces(page: Page, info: TestInfo, identity: AssetQualificationIdentity) {
  requireAssetQualificationIdentity(identity);
  const nativeZoom = identity.nativeZoom;
  const report = createAssetEvidenceReport(identity), captures = assetCaptureBudget(identity);
  const folder = path.resolve("artifacts/qualification/visual-composer/runs", identity.runId, "asset-accessibility", identity.host, nativeZoom ? "native-400" : "standard");
  let created = false, mediaTouched = false, viewportTouched = false;
  let originalViewport: {width: number; height: number} | null = null;
  let stage: AssetFailureStage = "admission";
  const failures: unknown[] = [];
  const save = async () => {
    const body = assetEvidenceBody(identity, report);
    await writeFile(path.join(folder, "evidence.json"), body, {flag: created ? "w" : "wx"});
    created = true;
  };
  try {
    await mkdir(folder, {recursive: true}); await save();
    stage = "media";
    const previous = page.viewportSize();
    originalViewport = previous ? {width: previous.width, height: previous.height} : null;
    mediaTouched = true;
    await page.emulateMedia({reducedMotion: "reduce", forcedColors: "none"});
    expect(await page.evaluate(() => matchMedia("(prefers-reduced-motion: reduce)").matches)).toBe(true);
    await page.evaluate(await readFile(path.resolve("node_modules/axe-core/axe.min.js"), "utf8"));
    for (const width of nativeZoom ? [undefined] : [1440, 320]) {
      if (width) {viewportTouched = true; await page.setViewportSize({width, height: 1000});}
      stage = "keyboard";
      await qualifyAssetKeyboardModal(page, async (observation, png) => {
        const screenshot = `keyboard-focus-${width ?? "native"}.png`;
        const captured = png ? captures(screenshot, png) : undefined;
        if (png) await writeFile(path.join(folder, screenshot), png, {flag: "wx"});
        report.observations.push(assetObservation({surface: "Customizations", width: width ?? "native", ...observation,
          ...(captured ?? {})}));
        await save();
      });
      stage = "numbers";
      await qualifyWorkflowNumbers(page, async (observation, png, state) => {
        const screenshot = `workflow-number-${width ?? "native"}-${state}.png`;
        const captured = captures(screenshot, png);
        await writeFile(path.join(folder, screenshot), png, {flag: "wx"});
        report.observations.push(assetObservation({surface: "Customizations", width: width ?? "native", kind: "numbered-step-background", ...observation, ...captured})); await save();
      });
      for (const surface of ["Browse", "Import Assets", "Studio", "Saved", "Customizations"]) {
        stage = "surface";
        const tab = page.getByRole("tablist", {name: "Assets sections"}).getByRole("tab", {name: surface, exact: true});
        await tab.focus(); await page.keyboard.press("Enter"); await expect(tab).toHaveAttribute("aria-selected", "true");
        await page.keyboard.press("ArrowRight"); await page.keyboard.press("ArrowLeft"); await expect(tab).toBeFocused();
        if (surface === "Browse") {
          // The tab mounts a fresh asynchronous catalog read. Measure populated
          // cards after bounded readiness, never an intermediate empty frame.
          await expect(page.locator(".asset-definition-card__header").first()).toBeVisible({timeout: 60000});
          const cards = await page.locator(".asset-definition-card__header").evaluateAll(headers => headers.map(header => {
            const label = header.querySelector(".asset-definition-card__title")!.getBoundingClientRect();
            const badge = header.querySelector(".asset-library-badge")!.getBoundingClientRect();
            const frame = header.getBoundingClientRect();
            return {overlap: Math.max(0, Math.min(label.right, badge.right) - Math.max(label.left, badge.left)) * Math.max(0, Math.min(label.bottom, badge.bottom) - Math.max(label.top, badge.top)), overflow: Math.max(0, frame.left - label.left, label.right - frame.right, frame.left - badge.left, badge.right - frame.right)};
          }));
          const layout = {cards: cards.length, maximumTitleBadgeOverlap: Math.max(0, ...cards.map(card => card.overlap)), maximumLabelOverflow: Math.max(0, ...cards.map(card => card.overflow))};
          report.observations.push(assetObservation({surface, width: width ?? "native", kind: "title-badge-layout", ...layout})); await save();
          expect(layout.cards).toBeGreaterThan(0); expect(layout.maximumTitleBadgeOverlap).toBeLessThanOrEqual(1); expect(layout.maximumLabelOverflow).toBeLessThanOrEqual(1);
        }
        if (surface === "Import Assets") {
          const input = page.getByLabel("Choose package", {exact: true});
          await expect(input).toHaveCount(1); await input.focus();
          const visibleFocus = await page.locator(".asset-package-manager__file").evaluate(element => {
            const style = getComputedStyle(element);
            return {within: element.matches(":focus-within"), outline: Number.parseFloat(style.outlineWidth), offset: Number.parseFloat(style.outlineOffset)};
          });
          report.observations.push(assetObservation({surface, width: width ?? "native", kind: "file-choose-keyboard-focus", ...visibleFocus})); await save();
          expect(visibleFocus.within).toBe(true); expect(visibleFocus.outline).toBeGreaterThanOrEqual(2); expect(visibleFocus.offset).toBeGreaterThanOrEqual(2);
        }
        if (surface === "Customizations") {
          const search = page.locator(".asset-customizer").getByRole("button", {name: "Search", exact: true});
          await search.hover();
          const hovered = await search.evaluate(async element => {
            const style = getComputedStyle(element);
            const result = await (window as any).axe.run(element, {runOnly: {type: "rule", values: ["color-contrast"]}});
            return {violations: result.violations.length, incomplete: result.incomplete.length, passed: result.passes.reduce((sum: number, row: any) => sum + row.nodes.length, 0)};
          });
          report.observations.push(assetObservation({surface, width: width ?? "native", kind: "actual-primary-hover-contrast", ...hovered})); await save();
          expect(hovered.violations).toBe(0); expect(hovered.incomplete).toBe(0); expect(hovered.passed).toBeGreaterThan(0);
        }
        const measurements = await page.evaluate(() => ({innerWidth, outerWidth, dpr: devicePixelRatio, cssZoom: getComputedStyle(document.documentElement).zoom, visualScale: visualViewport!.scale, overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth}));
        stage = "audit";
        const result = await (async () => {
          if (nativeZoom) return collectNativeDocumentAccessibilityAudit(page, "normal");
          if (width !== 1440 && width !== 320) throw new Error("Invalid Assets viewport.");
          return collectDocumentAccessibilityAudit(page, width);
        })();
        report.observations.push(assetObservation({surface, width: width ?? "native", measurements, ...result})); await save();
        expect(measurements.overflow).toBeLessThanOrEqual(1);
        if (nativeZoom) assertNative400PercentZoom(measurements);
        expect(result.violations).toEqual([]); expect(result.contrastPassedNodes).toBeGreaterThan(0);
        expect(result.status).toBe("passed"); expect(result.retries.passed).toBe(result.retries.attempted);
        stage = "motion";
        const motion = await page.locator("main").evaluate(root => [...root.querySelectorAll("*")].filter(element => element.getClientRects().length && getComputedStyle(element).visibility !== "hidden").map(element => {const style = getComputedStyle(element); return [...style.transitionDuration.split(","), ...(style.animationName === "none" ? [] : style.animationDuration.split(","))].map(value => Number.parseFloat(value) * (value.trim().endsWith("ms") ? 1 : 1000));}).flat());
        expect(motion.length).toBeGreaterThan(0);
        const status = await page.locator("main .ui-badge:visible, main [role=status]:visible").allTextContents();
        expect(status.every(value => value.trim().length > 0)).toBe(true);
        report.observations.push(assetObservation({surface, width: width ?? "native", motionElements: motion.length, maximumMotionMs: Math.max(0, ...motion), textualStatusCount: status.length})); await save();
        expect(motion.every(value => Number.isFinite(value) && value <= 0.01)).toBe(true);
        // The shared collector keeps selectors browser-local and resolves every
        // contrast retry; noncontrast incomplete rules remain failed observations.

      }
    }
    expect(report.observations.reduce((count: number, row: any) => count + (row.textualStatusCount ?? 0), 0)).toBeGreaterThan(0);
    report.status = "passed";
  } catch (error) {
    failures.push(error); report.status = "failed"; report.failureStage ??= stage;
  } finally {
    await finalizeAssetEvidence(report, failures, () => runOwnedRestartPhase(async () => {
      if (mediaTouched) await page.emulateMedia({reducedMotion: "no-preference", forcedColors: "none"});
    }, async () => {
      if (viewportTouched) await page.setViewportSize(originalViewport ?? {width: 1440, height: 1000});
    }), save, () => info.attach("asset-accessibility", {body: assetEvidenceBody(identity, report), contentType: "application/json"}));
  }
}

async function captureCustomizationBase(page: Page) {
  const customizer = page.locator(".asset-customizer");
  const values = await customizer.locator(".asset-customizer__resources details").evaluateAll(elements => elements.map(element => ({
    declaration: element.querySelector("summary")!.textContent,
    content: element.querySelector("textarea")?.value ?? element.querySelector("pre")?.textContent,
  })));
  expect(values.length).toBeGreaterThan(0);
  const semantic = {} as Record<string, string>;
  for (const label of ["Display name", "Description", "Summary", "Classification", "Tags (comma separated)", "Safe metadata additions", "AI context", "Configuration schema", "Default configuration", "Ports", "Requirements", "Composition rules", "Dependencies"]) semantic[label] = await customizer.getByLabel(label, {exact: true}).inputValue();
  return createHash("sha256").update(JSON.stringify({values, semantic})).digest("hex");
}

async function qualifyAssetKeyboardModal(page: Page, record: (observation: Record<string, unknown>, png?: Buffer) => Promise<void>) {
  await page.getByRole("tablist", {name: "Assets sections"}).getByRole("tab", {name: "Customizations", exact: true}).click();
  const customizer = page.locator(".asset-customizer");
  // Reestablish the exact starting base for each viewport. Switching tabs can
  // remount this editor; a previous viewport's selection is not a fixture.
  const imported = (await createPackageFixture()).container.manifest.implementations[0]!.definitionRef;
  await customizer.getByLabel("Search assets", {exact: true}).fill(String(imported.id));
  await customizer.getByRole("button", {name: "Search", exact: true}).click();
  await expect(customizer.getByText("Loading customization targets...", {exact: true})).toBeHidden({timeout: 60000});
  const initial = customizer.locator(".asset-customizer__target:enabled").filter({hasText: `${imported.id} - v${imported.version}`});
  await expect(initial).toHaveCount(1); await initial.focus(); await page.keyboard.press("Enter");
  const reset = page.getByRole("dialog", {name: "Change customization target?"});
  if (await reset.isVisible()) await reset.getByRole("button", {name: "Change asset", exact: true}).click();
  await expect(customizer.getByLabel("Description", {exact: true})).toBeVisible();
  await customizer.getByLabel("Description", {exact: true}).fill("Unsaved modal focus qualification.");
  await customizer.getByLabel("Search assets", {exact: true}).fill("builtin.form.submit-action");
  await customizer.getByRole("button", {name: "Search", exact: true}).click();
    await expect(customizer.getByText("Loading customization targets...", {exact: true})).toBeHidden({timeout: 60000});
  const foundation = SYSTEM_FOUNDATION_PACK_MANIFEST.assets.find(entry => entry.definitionRef.id === "builtin.form.submit-action")!.definitionRef;
  const target = customizer.locator(".asset-customizer__target:enabled").filter({hasText: `${foundation.id} - v${foundation.version}`});
  await expect(target).toHaveCount(1); await target.scrollIntoViewIfNeeded(); await target.focus(); await page.keyboard.press("Enter");
  const dialog = page.getByRole("dialog", {name: "Change customization target?"});
  await expect(dialog).toBeVisible();
  expect(await dialog.evaluate(element => element.contains(document.activeElement))).toBe(true);
  const controls = [];
  for (const control of await dialog.locator("button, input, select, textarea, a[href], [tabindex]").all()) if (await control.isVisible() && await control.isEnabled() && await control.evaluate(element => (element as HTMLElement).tabIndex >= 0)) controls.push(control);
  expect(controls.length).toBeGreaterThan(1);
  await controls[0]!.focus(); await page.keyboard.press("Shift+Tab"); await expect(controls[controls.length - 1]!).toBeFocused();
  await page.keyboard.press("Tab"); await expect(controls[0]!).toBeFocused();
  for (let index = 1; index < controls.length; index++) {await page.keyboard.press("Tab"); await expect(controls[index]!).toBeFocused();}
  await page.keyboard.press("Escape"); await expect(dialog).toBeHidden(); await expect(target).toBeFocused();
  const focus = await target.evaluate(element => {const style = getComputedStyle(element); const box = element.getBoundingClientRect(); return {visible: element.matches(":focus-visible"), outline: Number.parseFloat(style.outlineWidth), shadow: style.boxShadow !== "none", x: box.x, right: box.right, y: box.y, bottom: box.bottom, width: innerWidth, height: innerHeight};});
  expect(focus.visible).toBe(true); expect(focus.outline > 0 || focus.shadow).toBe(true);
  expect(focus.x).toBeGreaterThanOrEqual(0); expect(focus.right).toBeLessThanOrEqual(focus.width); expect(focus.y).toBeGreaterThanOrEqual(0); expect(focus.bottom).toBeLessThanOrEqual(focus.height);
  const outline = await target.evaluate(element => {
    const style = getComputedStyle(element), box = element.getBoundingClientRect();
    return {x: box.x, y: box.y, right: box.right, bottom: box.bottom, width: box.width, height: box.height,
      thickness: Number.parseFloat(style.outlineWidth), offset: Number.parseFloat(style.outlineOffset),
      solid: style.outlineStyle === "solid", viewportWidth: innerWidth, viewportHeight: innerHeight, viewportHeightExact: visualViewport!.height, dpr: devicePixelRatio};
  });
  await record({kind: "keyboard-focus", focus, outline});
  expect(outline.solid).toBe(true); expect(outline.thickness).toBeGreaterThanOrEqual(2); expect(outline.offset).toBeGreaterThanOrEqual(2);
  // Sample real device pixels, including gradients/transparency, with a proven
  // CSS-to-device mapping. Native Electron zoom does not change the Playwright
  // context scale, so scale:"css" alone cannot establish that mapping.
  const screenshot = await captureActualViewport(page);
  await record({kind: "focus-image", outline, screenshotScale: "actual-device-viewport"}, screenshot);
  const png = screenshot.toString("base64");
  const contrast = await page.evaluate(async ({png, outline}) => {
    const image = new Image();
    await new Promise<void>((resolve, reject) => {image.onload = () => resolve(); image.onerror = () => reject(new Error("Focus screenshot decode failed.")); image.src = `data:image/png;base64,${png}`;});
    if (!Number.isFinite(outline.dpr) || outline.dpr < 1 || outline.dpr > 4 + 1e-8 ||
        Math.abs(outline.viewportHeightExact - outline.viewportHeight) > 1 ||
        Math.abs(image.width - outline.viewportWidth * outline.dpr) > 1 ||
        Math.abs(image.height - outline.viewportHeightExact * outline.dpr) > 1) throw new Error(`Focus screenshot coordinate system is unverified (${image.width}x${image.height}; CSS ${outline.viewportWidth}x${outline.viewportHeightExact}; DPR ${outline.dpr}).`);
    const canvas = document.createElement("canvas"); canvas.width = image.width; canvas.height = image.height;
    const context = canvas.getContext("2d", {willReadFrequently: true}); if (!context) throw new Error("Focus screenshot pixels are unavailable.");
    context.drawImage(image, 0, 0);
    const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
    const luminance = (x: number, y: number) => {
      x = Math.floor(x * outline.dpr); y = Math.floor(y * outline.dpr);
      if (x < 0 || y < 0 || x >= canvas.width || y >= canvas.height) throw new Error("Focus outline or adjacent backdrop is clipped.");
      const offset = (y * canvas.width + x) * 4;
      if (pixels[offset + 3] !== 255) throw new Error("Focus screenshot has unresolved transparency.");
      return [0.2126, 0.7152, 0.0722].reduce((sum, weight, channel) => {
        const value = pixels[offset + channel]! / 255;
        return sum + weight * (value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4);
      }, 0);
    };
    const ratio = (a: number, b: number) => (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
    const samples: number[] = [];
    for (const fraction of [0.25, 0.5, 0.75]) {
      const x = outline.x + outline.width * fraction, y = outline.y + outline.height * fraction;
      for (const [edge, direction, horizontal] of [[outline.x, -1, true], [outline.right, 1, true], [outline.y, -1, false], [outline.bottom, 1, false]] as const) {
        const point = (distance: number) => horizontal ? luminance(edge + direction * distance, y) : luminance(x, edge + direction * distance);
        const ring = point(outline.offset + outline.thickness / 2);
        samples.push(ratio(ring, point(outline.offset / 2)), ratio(ring, point(outline.offset + outline.thickness + 2)));
      }
    }
    return {samples: samples.length, ratios: samples, minimum: Math.min(...samples), imageWidth: image.width, imageHeight: image.height, cssToDeviceScale: outline.dpr};
  }, {png, outline});
  await record({kind: "rendered-focus-contrast", outline, contrast});
  expect(contrast.samples).toBe(24); expect(contrast.minimum).toBeGreaterThanOrEqual(3);
}


async function captureActualViewport(page: Page): Promise<Buffer> {
  const capture = await page.context().newCDPSession(page);
  let png: Buffer | undefined;
  await runOwnedRestartPhase(async () => {
    const result = await capture.send("Page.captureScreenshot", {format: "png", fromSurface: true, captureBeyondViewport: false});
    png = assetViewportPng(result.data);
  }, () => capture.detach());
  return png!;
}

async function qualifyWorkflowNumbers(page: Page, record: (observation: Record<string, unknown>, png: Buffer, state: string) => Promise<void>) {
  const steps = page.locator(".asset-customizer .ui-workflow__step");
  expect(await steps.count()).toBeGreaterThan(2);
  for (const [state, index] of [["first", 0], ["active", 1], ["default", (await steps.count()) - 1]] as const) {
    const step = steps.nth(index);
    await step.locator(".ui-workflow__step-title").scrollIntoViewIfNeeded();
    expect(await step.getAttribute("data-active")).toBe(state === "active" ? "true" : null);
    const facts = await step.evaluate(element => {
      const box = element.getBoundingClientRect(), style = getComputedStyle(element), number = getComputedStyle(element, "::before");
      return {stateBackground: style.backgroundColor, stepZ: style.zIndex, numberBackground: number.backgroundColor, numberImage: number.backgroundImage, foreground: number.color,
        x: box.x + Number.parseFloat(style.borderLeftWidth) + Number.parseFloat(number.left), y: box.y + Number.parseFloat(style.borderTopWidth) + Number.parseFloat(number.top),
        width: Number.parseFloat(number.width), height: Number.parseFloat(number.height), font: Number.parseFloat(number.fontSize), opacity: number.opacity,
        viewportWidth: innerWidth, viewportHeight: visualViewport!.height, dpr: devicePixelRatio};
    });
    const screenshot = await captureActualViewport(page);
    const observation = await page.evaluate(async ({facts, png}) => {
      const image = new Image();
      await new Promise<void>((resolve, reject) => {image.onload = () => resolve(); image.onerror = () => reject(new Error("Number screenshot decode failed.")); image.src = `data:image/png;base64,${png}`;});
      if (Math.abs(image.width - facts.viewportWidth * facts.dpr) > 1 || Math.abs(image.height - facts.viewportHeight * facts.dpr) > 1) throw new Error("Number screenshot mapping is unverified.");
      const canvas = document.createElement("canvas"); canvas.width = image.width; canvas.height = image.height;
      const ctx = canvas.getContext("2d", {willReadFrequently: true})!; ctx.drawImage(image, 0, 0);
      const bytes = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
      const color = (css: string) => {const one = document.createElement("canvas"); one.width = one.height = 1; const context = one.getContext("2d")!; context.fillStyle = css; context.fillRect(0, 0, 1, 1); return Array.from(context.getImageData(0, 0, 1, 1).data);};
      const background = color(facts.stateBackground), foreground = color(facts.foreground), decoration = color(facts.numberBackground);
      if (background[3] !== 255 || foreground[3] !== 255 || decoration[3] !== 0 || facts.numberImage !== "none" || facts.opacity !== "1" || facts.stepZ !== "auto") throw new Error("Number reading background or stacking is ambiguous.");
      const samples = [];
      for (const offset of [-12, -11, -10, 10, 11, 12]) for (const column of [-1, 0, 1]) {
        const x = Math.floor((facts.x + facts.width / 2 + column) * facts.dpr), y = Math.floor((facts.y + facts.height / 2 + offset) * facts.dpr);
        if (x < 0 || y < 0 || x >= image.width || y >= image.height) throw new Error("Number background sample is clipped.");
        const at = (y * image.width + x) * 4; if (bytes[at + 3] !== 255) throw new Error("Number background has unresolved transparency.");
        samples.push(Math.max(...background.slice(0, 3).map((value, index) => Math.abs(value - bytes[at + index]!))));
      }
      const lum = (rgb: number[]) => rgb.slice(0, 3).reduce((sum, value, index) => {const c = value / 255; return sum + [0.2126, 0.7152, 0.0722][index]! * (c <= .04045 ? c / 12.92 : ((c + .055) / 1.055) ** 2.4);}, 0);
      const a = lum(foreground), b = lum(background);
      return {facts: {...facts, stateBackground: background, foreground, numberBackground: decoration}, samples: samples.length, maximumBackdropDeviation: Math.max(...samples), textContrast: (Math.max(a, b) + .05) / (Math.min(a, b) + .05), imageWidth: image.width, imageHeight: image.height};
    }, {facts, png: screenshot.toString("base64")});
    await record({state, ...observation}, screenshot, state);
    expect(observation.samples).toBe(18); expect(observation.maximumBackdropDeviation).toBeLessThanOrEqual(3); expect(observation.textContrast).toBeGreaterThanOrEqual(4.5);
  }
}
