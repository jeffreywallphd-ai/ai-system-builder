import { expect, type Page, type TestInfo } from "@playwright/test";
import { readWebsiteHostFixture, websiteArtifactPair, websiteWorkspace, websiteHostReport, WEBSITE_HOST_PHASES, WEBSITE_PHASE_TIMEOUT_MS } from "../website-acquisition-oracles";

export async function createWebsiteQualificationWorkspace(page: Page, name: "Website acquisition fixture" | "Website isolation fixture") {
  if (name !== "Website acquisition fixture" && name !== "Website isolation fixture") throw new Error("Unsupported website test workspace.");
  await page.getByRole("button", { name: "Home", exact: true }).click();
  const create = page.getByRole("button", { name: "Create new workspace", exact: true });
  await expect(create).toBeEnabled();
  const switcher = page.getByLabel("Select current workspace", { exact: true });
  const previous = await switcher.count() ? await switcher.inputValue() : "";
  await create.click();
  await page.locator('input[name="workspaceName"]').fill(name);
  await page.getByRole("button", { name: "Create workspace", exact: true }).click();
  // The Home heading reads the committed workspace, unlike the select's draft value.
  await expect(page.getByRole("heading", { name, exact: true })).toBeVisible({ timeout: WEBSITE_PHASE_TIMEOUT_MS });
  await expect(switcher).toHaveValue(/^workspace\./);
  if (previous) await expect(switcher).not.toHaveValue(previous);
  const workspace = websiteWorkspace(await switcher.inputValue());
  if (workspace === previous) throw new Error("The website test workspace was not freshly created.");
  return workspace;
}

/** Real app-shell workflow; no capture/transport success interception. */
export async function qualifyWebsiteAcquisitionJourney(page: Page, info: TestInfo, declaration: unknown) {
  const fixture = readWebsiteHostFixture(declaration);
  if (!fixture || info.project.name !== "thin-chrome") throw new Error("The website host test prerequisites are invalid.");
  const phases: string[] = [];
  let failed = false;
  async function step(phase: typeof WEBSITE_HOST_PHASES[number], action: () => Promise<void>) {
    if (WEBSITE_HOST_PHASES[phases.length] !== phase) throw new Error("Unexpected website host test phase.");
    await action(); phases.push(phase);
  }
  try {
    const switcher = page.getByLabel("Select current workspace", { exact: true });
    let workspace = "", keys: ReturnType<typeof websiteArtifactPair>;
    const rawButton = page.getByRole("button", { name: "page-001.html", exact: true });
    const textButton = page.getByRole("button", { name: "page-001.txt", exact: true });
    const selectedKey = page.locator("dt").filter({ hasText: /^Selected key/ }).locator("xpath=following-sibling::dd[1]");
    const preview = page.getByRole("region", { name: "Artifact preview", exact: true });
    async function reopen() {
      await page.getByRole("button", { name: "Artifacts", exact: true }).click();
      await page.getByRole("tab", { name: "Artifact Browser", exact: true }).click();
      await expect(page.getByRole("alert")).toHaveCount(0);
      await expect(rawButton).toHaveCount(1, { timeout: WEBSITE_PHASE_TIMEOUT_MS });
      await expect(textButton).toHaveCount(1);
      await rawButton.click(); await expect(selectedKey).toHaveText(/\.html$/);
      const raw = await selectedKey.innerText();
      await expect(preview.locator("pre")).toContainText(fixture!.expectedText);
      await textButton.click(); await expect(selectedKey).toHaveText(/\.txt$/);
      const text = await selectedKey.innerText();
      await expect(preview.locator("pre")).toContainText(fixture!.expectedText);
      return websiteArtifactPair(workspace, [raw, text]);
    }
    await step("workspace-owned", async () => {
      workspace = websiteWorkspace(await switcher.inputValue());
      await page.getByRole("button", { name: "Artifacts", exact: true }).click();
      await page.getByRole("tab", { name: "Artifact Browser", exact: true }).click();
      await expect(page.getByRole("status").filter({ hasText: /^No data artifacts found yet\.$/ })).toBeVisible();
      await expect(page.getByRole("alert")).toHaveCount(0);
      await expect(rawButton).toHaveCount(0); await expect(textButton).toHaveCount(0);
      await page.getByRole("tab", { name: "Artifact Ingestion", exact: true }).click();
    });
    const workflow = page.getByRole("list", { name: "Add data workflow", exact: true });
    await step("single-page-submitted", async () => {
      await workflow.getByRole("radio", { name: "Website pages", exact: true }).check();
      await workflow.getByRole("radio", { name: "Specific pages", exact: true }).check();
      await workflow.getByRole("textbox", { name: "Page addresses, one per line", exact: true }).fill(fixture.pageUrl);
      await workflow.locator("summary").filter({ hasText: "Advanced settings" }).click();
      await workflow.getByRole("spinbutton", { name: "Maximum pages", exact: true }).fill("1");
      await expect(workflow.getByRole("button", { name: "Add data", exact: true })).toBeEnabled();
      await workflow.getByRole("button", { name: "Add data", exact: true }).click();
    });
    await step("task-completed", async () => {
      const center = page.getByRole("dialog", { name: "Notifications", exact: true });
      await expect(center).toBeVisible({ timeout: 90_000 });
      await expect(center.locator(".ui-notification__item").filter({ hasText: "Website capture is ready." })).toHaveCount(1, { timeout: 90_000 });
      await center.getByRole("button", { name: "Close notifications", exact: true }).click();
      await expect(workflow.getByRole("alert")).toHaveCount(0);
    });
    await step("raw-and-readable-reopened", async () => { keys = await reopen(); });
    await step("renderer-reload-preserved-identities", async () => {
      await page.reload(); await expect(switcher).toHaveValue(workspace, { timeout: WEBSITE_PHASE_TIMEOUT_MS });
      expect(await reopen()).toEqual(keys!);
    });
    await step("other-workspace-empty", async () => {
      const other = await createWebsiteQualificationWorkspace(page, "Website isolation fixture");
      if (other === workspace) throw new Error("The isolation workspace is not distinct.");
      await page.getByRole("button", { name: "Artifacts", exact: true }).click();
      await page.getByRole("tab", { name: "Artifact Browser", exact: true }).click();
      await expect(switcher).toHaveValue(other);
      await expect(page.getByRole("status").filter({ hasText: /^No data artifacts found yet\.$/ })).toBeVisible();
      await expect(page.getByRole("alert")).toHaveCount(0);
      await expect(rawButton).toHaveCount(0); await expect(textButton).toHaveCount(0);
      await expect(selectedKey).toHaveCount(0);
    });
    await step("original-workspace-restored", async () => {
      await switcher.selectOption(workspace);
      await page.getByRole("region", { name: "Current workspace", exact: true }).getByRole("button", { name: "Change", exact: true }).click();
      await expect(switcher).toHaveValue(workspace);
      await page.getByRole("button", { name: "Home", exact: true }).click();
      await expect(page.getByRole("heading", { name: "Website acquisition fixture", exact: true })).toBeVisible();
      expect(await reopen()).toEqual(keys!);
    });
  } catch { failed = true; }
  const report = websiteHostReport(phases, failed);
  const body = JSON.stringify(report);
  if (Buffer.byteLength(body) > 4096) throw new Error("The website host report exceeded its bound.");
  try { await info.attach("website-host-ui", { body, contentType: "application/json" }); }
  catch { throw new Error(`Website host report unavailable; last phase: ${report.nextPhase}.`); }
  if (report.status !== "passed") throw new Error(`Website host phase did not complete: ${report.nextPhase}.`);
}
