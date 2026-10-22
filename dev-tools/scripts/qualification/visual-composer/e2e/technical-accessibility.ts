import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { expect, type Page, type TestInfo } from "@playwright/test";

/** Real browser assertions; retain counts and fixed rule IDs, never DOM/user payloads. */
export async function qualifyTechnicalAccessibility(page: Page, info: TestInfo) {
  const runId = process.env.VISUAL_COMPOSER_QUALIFICATION_RUN_ID;
  const source = process.env.VISUAL_COMPOSER_QUALIFICATION_SOURCE_REVISION;
  if (!runId || !/^[a-z0-9-]{20,80}$/.test(runId) || !source || !/^source\.[a-f0-9]{64}$/.test(source) ||
      !["thin-chrome", "packaged-desktop", "managed-thin-chrome"].includes(info.project.name)) throw new Error("Invalid accessibility qualification identity.");
  const profileBytes = await readFile(path.resolve("dev-tools/config/technical-reference-profiles.json"));
  const profile = JSON.parse(profileBytes.toString("utf8"));
  expect(process.platform).toBe(profile.platform);
  expect(process.arch).toBe(profile.architecture);
  expect(os.cpus().length).toBe(profile.logicalProcessors);
  expect(Math.abs(os.totalmem() / (1024 ** 3) - profile.installedMemoryGiB)).toBeLessThan(1);
  const folder = path.resolve("artifacts/qualification/visual-composer/runs", runId, "technical-accessibility", info.project.name);
  await mkdir(folder, { recursive: true });
  const report: Record<string, unknown> = { schemaVersion: "technical-accessibility-v1", sourceRevision: source,
    profile: profile.environmentId, profileSha256: createHash("sha256").update(profileBytes).digest("hex"),
    host: info.project.name, hardware: { platform: process.platform, architecture: process.arch,
      logicalProcessors: os.cpus().length, memoryBytes: os.totalmem() }, status: "running", checks: [] as string[] };
  const checks = report.checks as string[];
  async function save() { await writeFile(path.join(folder, "evidence.json"), JSON.stringify(report, null, 2) + "\n"); }
  await save();
  try {
    report.browser = await page.evaluate(() => ({ userAgent: navigator.userAgent, deviceScaleFactor: devicePixelRatio }));
    expect((report.browser as {deviceScaleFactor: number}).deviceScaleFactor).toBe(profile.deviceScaleFactor);
    await page.emulateMedia({ reducedMotion: "reduce" });
    expect(await page.evaluate(() => matchMedia("(prefers-reduced-motion: reduce)").matches)).toBe(true);
    const motion = await page.locator(".system-builder").evaluate(root => [...root.querySelectorAll("*")]
      .filter(element => element.getClientRects().length && getComputedStyle(element).visibility !== "hidden")
      .map(element => { const style = getComputedStyle(element); return {
        transitions: style.transitionDuration.split(",").map(value => Number.parseFloat(value) * (value.trim().endsWith("ms") ? 1 : 1000)),
        animations: style.animationName === "none" ? [0] : style.animationDuration.split(",").map(value => Number.parseFloat(value) * (value.trim().endsWith("ms") ? 1 : 1000)),
      }; }));
    expect(motion.length).toBeGreaterThan(0);
    report.motion = { elements: motion.length,
      maximumTransitionMilliseconds: Math.max(...motion.flatMap(item => item.transitions)),
      maximumAnimationMilliseconds: Math.max(...motion.flatMap(item => item.animations)) };
    await save();
    expect(motion.every(item => [...item.transitions, ...item.animations].every(ms => Number.isFinite(ms) && ms <= 0.01))).toBe(true);
    checks.push("computed-reduced-motion");
    const badges = page.locator(".system-builder__status .ui-badge");
    expect(await badges.count()).toBeGreaterThan(0);
    for (const badge of await badges.all()) expect((await badge.innerText()).trim().length).toBeGreaterThan(0);
    checks.push("status-meaning-independent-of-color");
    await page.setViewportSize({ width: 1440, height: 1000 });
    const axeSource = await readFile(path.resolve("node_modules/axe-core/axe.min.js"), "utf8");
    await page.evaluate(axeSource);
    for (const width of [1440, 320]) {
      await page.setViewportSize({ width, height: 1000 });
      expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(1);
      const result = await page.evaluate(async () => {
        const axe = (window as unknown as { axe: { run(context: string, options: unknown): Promise<{
          violations: Array<{id: string; nodes: Array<{target: string[]; any: Array<{message: string}>}>}>; incomplete: Array<{id: string; nodes: Array<{target: string[]; any: Array<{id: string; message: string}>}>}>;
          passes: Array<{id: string; nodes: unknown[]}>;
        }> } }).axe;
        const value = await axe.run(".system-builder", { runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21aa"] } });
        return { violations: value.violations.map(item => ({ rule: item.id, nodes: item.nodes.length,
          details: item.nodes.slice(0, 12).map(node => ({ selectors: node.target, messages: node.any.map(check => check.message.slice(0, 400)) })) })),
          incomplete: value.incomplete.map(item => ({ rule: item.id, nodes: item.nodes.length,
            details: item.nodes.slice(0, 1000).map(node => ({ selectors: node.target, messages: node.any.map(check => check.message.slice(0, 300)) })) })),
          incompleteContrast: value.incomplete.filter(item => item.id === "color-contrast").reduce((sum, item) => sum + item.nodes.length, 0),
          incompleteReasons: [...new Set(value.incomplete.filter(item => item.id === "color-contrast").flatMap(item => item.nodes.flatMap(node => node.any.map(check => check.id))))],
          incompleteMessages: [...new Set(value.incomplete.filter(item => item.id === "color-contrast").flatMap(item => item.nodes.flatMap(node => node.any.map(check => check.message.slice(0, 300)))))].slice(0, 8),
          contrastNodes: value.passes.filter(item => item.id === "color-contrast").reduce((sum, item) => sum + item.nodes.length, 0) };
      });
      report[`wcag-${width}`] = result;
      await save();
      expect(result.violations).toEqual([]);
      expect(result.incomplete.filter(item => item.rule !== "color-contrast")).toEqual([]);
      const retries: unknown[] = [];
      report[`contrast-scrolled-${width}`] = retries;
      for (const group of result.incomplete) {
        expect(group.nodes).toBeLessThanOrEqual(1000);
        for (const node of group.details) {
          expect(node.selectors).toHaveLength(1);
          const selector = node.selectors[0]!;
          const target = page.locator(selector);
          await expect(target).toHaveCount(1);
          await target.evaluate(element => element.scrollIntoView({ block: "center", inline: "nearest", behavior: "instant" }));
          await expect(target).toBeVisible();
          const measured = await page.evaluate(async selector => {
            const axe = (window as any).axe;
            const value = await axe.run({ include: [[selector]] }, { runOnly: { type: "rule", values: ["color-contrast"] } });
            return { selector, violations: value.violations.map((item: any) => ({ rule: item.id, nodes: item.nodes.length })),
              incomplete: value.incomplete.map((item: any) => ({ rule: item.id, nodes: item.nodes.length,
                messages: item.nodes.flatMap((node: any) => node.any.map((check: any) => check.message.slice(0, 300))) })),
              passedNodes: value.passes.reduce((sum: number, item: any) => sum + item.nodes.length, 0) };
          }, selector);
          retries.push(measured); await save();
          expect(measured.violations).toEqual([]);
          expect(measured.incomplete).toEqual([]);
          expect(measured.passedNodes).toBeGreaterThan(0);
        }
      }
      expect(result.contrastNodes).toBeGreaterThan(0);
      checks.push(`computed-contrast-and-semantics-${width}`, `reflow-${width}`);
    }
    // Exercise native keyboard activation, modal containment and focus return.
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
    await controls[0]!.focus(); await page.keyboard.press("Shift+Tab"); await expect(controls.at(-1)!).toBeFocused();
    await controls.at(-1)!.focus(); await page.keyboard.press("Tab"); await expect(controls[0]!).toBeFocused();
    await dialog.press("Escape"); await expect(dialog).toBeHidden(); await expect(add).toBeFocused();
    checks.push("keyboard-activation-and-modal-focus-return", "modal-keyboard-containment");
    report.status = "passed";
    return { checks, profile: profile.environmentId };
  } finally {
    if (report.status === "running") report.status = "failed";
    await save();
    await info.attach("technical-accessibility", { body: JSON.stringify(report), contentType: "application/json" });
    await page.emulateMedia({ reducedMotion: "no-preference" });
  }
}
