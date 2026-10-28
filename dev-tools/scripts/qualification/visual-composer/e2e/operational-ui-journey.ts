import { expect, type Page, type TestInfo } from "@playwright/test";
import { failedOperationalObservation, operationalPhases, operationalStatusUrl, OPERATIONAL_PHASE_TIMEOUT_MS, qualifyOperationalObservation, type OperationalHost, type OperationalUiReport } from "../operational-ui-oracles";
import { qualifyCriticalSurfaceAccessibility } from "./critical-surface-accessibility";

/** Actual host UI assertions. Unit/oracle checks alone do not qualify this journey. */
export async function qualifyOperationalUiJourney(page: Page, info: TestInfo, host: OperationalHost): Promise<OperationalUiReport> {
  const phases: string[] = [];
  const input = () => ({ schemaVersion: "operational-ui-observation-v1", host, runId: process.env.VISUAL_COMPOSER_QUALIFICATION_RUN_ID, sourceRevision: process.env.VISUAL_COMPOSER_QUALIFICATION_SOURCE_REVISION, phases });
  failedOperationalObservation(input()); // Refuse invalid identity before any UI effect.
  if (info.project.name !== host) throw new Error("Operational UI host identity does not match its project.");
  const expected = operationalPhases(host);
  async function step(phase: string, action: () => Promise<void>) {
    if (expected[phases.length] !== phase) throw new Error("Unexpected operational UI step.");
    await action(); phases.push(phase);
  }
  let failed = false;
  try {
    await step("sidebar-collapsed", async () => {
      await page.getByRole("button", { name: "Collapse sidebar", exact: true }).click();
      await expect(page.getByRole("button", { name: "Expand sidebar", exact: true })).toBeVisible();
    });
    await step("sidebar-restored", async () => {
      await page.getByRole("button", { name: "Expand sidebar", exact: true }).click();
      await expect(page.getByRole("button", { name: "Collapse sidebar", exact: true })).toBeVisible();
    });
    await step("settings-opened", async () => {
      await page.getByRole("button", { name: "Settings", exact: true }).click();
      await expect(page.getByRole("heading", { name: "Settings", level: 1, exact: true })).toBeVisible();
      await qualifyCriticalSurfaceAccessibility(page, info, "settings");
    });
    if (host === "packaged-desktop") {
      const footer = page.locator('footer[aria-label="Python runtime controls"]');
      const software = page.locator('section[aria-label="Software status controls"]');
      async function runtimeStatus(status: "ready" | "stopped") {
        // Observe the committed UI after its event, including fast batched replies.
        // This is a paint opportunity, not a native process or timing guarantee.
        await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
        await expect(footer).toHaveAttribute("aria-busy", "false", { timeout: OPERATIONAL_PHASE_TIMEOUT_MS });
        await expect(footer.getByRole("alert")).toHaveCount(0);
        await expect(footer).toContainText(`Status: ${status}`, { timeout: OPERATIONAL_PHASE_TIMEOUT_MS });
      }
      await step("runtime-deferred", async () => {
        await expect(footer).toHaveCount(0);
        await page.getByRole("button", { name: /^Software status\b/ }).press("Enter");
        await expect(software).toBeVisible(); await expect(footer).toHaveCount(0);
      });
      await step("runtime-initially-stopped", async () => {
        await software.getByRole("button", { name: /^Python runtime controls\b/ }).press("Enter");
        await runtimeStatus("stopped");
      });
      // The settled display does not prove a new IPC read by itself. Focused
      // footer tests separately assert exact foreground read dispatch/ownership.
      await step("runtime-refresh-display-stopped", async () => { await footer.getByRole("button", { name: "Refresh", exact: true }).click(); await runtimeStatus("stopped"); });
      await step("runtime-start-ready", async () => { await footer.getByRole("button", { name: "Start", exact: true }).click(); await runtimeStatus("ready"); });
      await step("runtime-view-reopened-ready", async () => {
        const toggle = software.getByRole("button", { name: /^Python runtime controls\b/ });
        await toggle.click(); await expect(footer).toHaveCount(0);
        await toggle.click(); await runtimeStatus("ready");
      });
      const stoppedLog = footer.getByRole("listitem").filter({ hasText: "Python runtime process stopped." });
      const spawnedLog = footer.getByRole("listitem").filter({ hasText: "Python runtime process spawned." });
      await step("runtime-restart-ready", async () => {
        const details = footer.locator("details");
        if (!await details.evaluate(node => (node as HTMLDetailsElement).open)) await details.locator("summary").press("Enter");
        await expect(details).toHaveJSProperty("open", true);
        const beforeStopped = await stoppedLog.count(), beforeSpawned = await spawnedLog.count();
        await footer.getByRole("button", { name: "Restart", exact: true }).click(); await runtimeStatus("ready");
        await expect(stoppedLog).toHaveCount(beforeStopped + 1);
        await expect(spawnedLog).toHaveCount(beforeSpawned + 1);
        const lifecycle = await footer.getByRole("listitem").evaluateAll(nodes => nodes.flatMap(node => {
          const text = node.textContent ?? "";
          if (text.endsWith("Python runtime process stopped.")) return ["stopped"];
          if (text.endsWith("Python runtime process spawned.")) return ["spawned"];
          return [];
        }));
        expect(lifecycle.slice(-2)).toEqual(["stopped", "spawned"]);
      });
      await step("runtime-log-cleared", async () => {
        const details = footer.locator("details");
        if (!await details.evaluate(node => (node as HTMLDetailsElement).open)) await details.locator("summary").press("Enter");
        await expect(details).toHaveJSProperty("open", true);
        await footer.getByRole("button", { name: "Clear log", exact: true }).click(); await runtimeStatus("ready");
        await expect(footer.getByRole("listitem").filter({ hasText: "Cleared Python runtime activity log." })).toHaveCount(1);
        await expect(stoppedLog).toHaveCount(0); await expect(spawnedLog).toHaveCount(0);
      });
      await step("runtime-stop-reported", async () => { await footer.getByRole("button", { name: "Stop", exact: true }).click(); await runtimeStatus("stopped"); });
    } else {
      await page.getByRole("button", { name: "Security", exact: true }).click();
      const refresh = page.getByRole("button", { name: "Refresh status", exact: true });
      const panel = refresh.locator("..");
      async function knownStatus() {
        await expect(refresh).toBeEnabled({ timeout: OPERATIONAL_PHASE_TIMEOUT_MS });
        await expect(panel.getByRole("alert")).toHaveCount(0);
        await expect(panel.locator("p").filter({ hasText: /^Server mode:/ })).toHaveText(/^Server mode: (?:disabled-dev|lan-https-token|oidc-bearer|external-tls|mtls|api-key)$/);
        await expect(panel.locator("p").filter({ hasText: /^Current listener:/ })).toHaveText(/^Current listener: (?:HTTP only|HTTPS enabled)$/);
      }
      await step("security-known", async () => { await expect(refresh).toBeEnabled(); await refresh.click(); await knownStatus(); await qualifyCriticalSurfaceAccessibility(page, info, "security"); });
      const url = operationalStatusUrl(page.url());
      const fault: Parameters<Page["route"]>[1] = async route => {
        if (route.request().method() !== "GET") return route.continue();
        await route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ ok: false, error: { code: "unavailable", message: "synthetic-operational-hidden-detail" } }) });
      };
      await page.route(url, fault);
      try {
        await step("security-fault-visible", async () => { await refresh.click(); await expect(panel.getByRole("alert")).toBeVisible(); await expect(refresh).toBeEnabled(); });
        await step("security-fault-safe", async () => { await expect(panel).not.toContainText("synthetic-operational-hidden-detail"); });
      } finally { await page.unroute(url, fault); }
      await step("security-retry-known", async () => { await refresh.click(); await knownStatus(); });
      await step("security-controls-restricted", async () => { await expect(panel.locator("input")).toHaveCount(0); await expect(panel.getByRole("button")).toHaveCount(1); });
    }
    const bell = page.getByRole("button", { name: /^Notifications(?:,|$)/ });
    const notifications = page.getByRole("dialog", { name: "Notifications", exact: true });
    await step("notifications-empty", async () => {
      await bell.click(); await expect(notifications.getByText("No notifications yet.", { exact: true })).toBeVisible();
      await expect(notifications.getByRole("button", { name: "Clear completed", exact: true })).toBeDisabled();
      await qualifyCriticalSurfaceAccessibility(page, info, "notifications");
    });
    await step("notifications-focus-returned", async () => {
      await expect(notifications.getByRole("button", { name: "Close notifications", exact: true })).toBeFocused();
      await notifications.press("Escape"); await expect(notifications).toBeHidden(); await expect(bell).toBeFocused();
    });
    await step("models-discovery-opened", async () => {
      await page.getByRole("button", { name: "Models", exact: true }).click();
      await expect(page.getByRole("heading", { name: "Model Management", level: 1, exact: true })).toBeVisible();
      if (host === "packaged-desktop") {
        await page.getByRole("tab", { name: "Find Models", exact: true }).press("Enter");
        await expect(page.getByRole("textbox", { name: /^Query\b/ })).toBeVisible();
        await page.getByRole("combobox", { name: /^Task\b/ }).selectOption("other");
        await page.getByRole("textbox", { name: "Other task tag", exact: true }).fill("qualification-config-only");
      } else {
        await expect(page.getByRole("tab", { name: "Train Model", exact: true })).toHaveCount(0);
        await page.getByRole("textbox", { name: /^Search\b/ }).fill("qualification-config-only");
      }
      // Edit local form state only. Search, download and save remain explicit.
      await qualifyCriticalSurfaceAccessibility(page, info, "models-discovery");
    });
    await step("models-inventory-opened", async () => {
      if (host === "packaged-desktop") {
        await page.getByRole("tab", { name: "Manage Models", exact: true }).press("Enter");
        await expect(page.getByRole("button", { name: "Refresh Models", exact: true })).toBeEnabled({ timeout: OPERATIONAL_PHASE_TIMEOUT_MS });
        await expect(page.getByRole("combobox", { name: /^Lifecycle\b/ })).toBeVisible();
      } else {
        await expect(page.getByRole("heading", { name: "Server model inventory", exact: true })).toBeVisible();
        await expect(page.getByRole("button", { name: "Refresh", exact: true })).toBeEnabled({ timeout: OPERATIONAL_PHASE_TIMEOUT_MS });
      }
      await qualifyCriticalSurfaceAccessibility(page, info, "models-inventory");
    });
    if (host === "packaged-desktop") await step("model-training-opened", async () => {
      await page.getByRole("tab", { name: "Train Model", exact: true }).press("Enter");
      await expect(page.getByRole("list", { name: "Model training workflow", exact: true })).toBeVisible();
      await expect(page.getByRole("combobox", { name: /^Base model\b/ })).toBeVisible();
      const method = page.getByRole("combobox", { name: /^Method\b/ });
      await method.selectOption("lora"); await expect(method).toHaveValue("lora");
      await qualifyCriticalSurfaceAccessibility(page, info, "model-training");
    });
    await step("image-configuration-opened", async () => {
      await page.getByRole("button", { name: "Image Generation", exact: true }).click();
      await expect(page.getByRole("heading", { name: "Image Generation", level: 1, exact: true })).toBeVisible();
      await expect(page.getByRole("list", { name: "Image generation workflow", exact: true })).toBeVisible();
      const prompt = page.getByRole("textbox", { name: /^Prompt\b/ });
      await prompt.fill("Local configuration check."); await expect(prompt).toHaveValue("Local configuration check.");
      // Do not submit generation, alter runtime settings or repair an install.
      await qualifyCriticalSurfaceAccessibility(page, info, "image-configuration");
    });
    await step("home-returned", async () => {
      await page.getByRole("button", { name: "Home", exact: true }).click();
      await expect(page.getByRole("heading", { name: "Home", level: 1, exact: true })).toBeVisible();
    });
  } catch { failed = true; }
  const report = failed ? failedOperationalObservation(input()) : qualifyOperationalObservation(input());
  const body = JSON.stringify(report); if (Buffer.byteLength(body) > 8192) throw new Error("Operational UI report exceeded its fixed bound.");
  try { await info.attach("operational-ui", { body, contentType: "application/json" }); }
  catch { throw new Error("Operational UI report could not be saved."); }
  if (report.status !== "passed") throw new Error(`Operational UI step failed: ${report.nextPhase}.`);
  return report;
}
