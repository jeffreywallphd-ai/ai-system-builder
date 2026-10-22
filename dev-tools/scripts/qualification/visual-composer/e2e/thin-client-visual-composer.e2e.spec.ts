import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { observeComposerProtocol } from "./meaningful-system-journeys";
import {
  assertGuidedLifecycleReflow,
  completeGuidedSystemLifecycle,
} from "./guided-system-lifecycle";

test.setTimeout(180_000);
const QUALIFICATION_MODEL_NAME = "Controlled qualification model";
const protocol = new WeakMap<Page, () => Promise<void>>();
test.beforeEach(async ({ page }, info) => { protocol.set(page, observeComposerProtocol(page, info)); });
test.afterEach(async ({ page }) => { await protocol.get(page)?.(); });

test("thin client completes the guided build and publication lifecycle", async ({
  page,
  request,
}) => {
  const browserErrors: string[] = [];
  const summaryFailures: Promise<void>[] = [];
  const summaryConsoleUrls: string[] = [];
  const verifiedSummaryUrls = new Set<string>();
  page.on("console", (message) => {
    if (message.type() !== "error") return;
    const location = message.location().url;
    if (message.text() === "Failed to load resource: the server responded with a status of 503 (Service Unavailable)" &&
        location && new URL(location).pathname === "/api/workspaces/summary") {
      summaryConsoleUrls.push(location);
      return;
    }
    browserErrors.push(message.text());
  });
  page.on("pageerror", (error) => browserErrors.push(error.message));
  page.on("response", (response) => {
    if (response.url().includes("/api/") && response.status() >= 400) {
      if (new URL(response.url()).pathname === "/api/workspaces/summary" && response.status() === 503) {
        // This nonmanaged fixture has no organization summary authority. Assert
        // its existing explicit unavailability; never fabricate counts/authority.
        summaryFailures.push((async () => {
          expect(await response.json()).toMatchObject({ ok: false, error: {
            operation: "workspace.summary", code: "unavailable", message: "Workspace summary is unavailable.",
          } });
          verifiedSummaryUrls.add(response.url());
        })());
        return;
      }
      browserErrors.push(
        `API ${response.status()} ${new URL(response.url()).pathname}`,
      );
    }
  });

  const origin = requiredEnvironment("VISUAL_COMPOSER_THIN_CLIENT_ORIGIN");
  const serverOrigin = requiredEnvironment("VISUAL_COMPOSER_SERVER_ORIGIN");
  const bearerToken = requiredEnvironment(
    "VISUAL_COMPOSER_THIN_CLIENT_BEARER_TOKEN",
  );
  const denied = await request.get(
    new URL("/api/workspaces", serverOrigin).href,
  );
  expect(denied.status()).toBe(401);
  await page.addInitScript(
    ({ token }) =>
      localStorage.setItem("ai-system-builder.paired-device-token", token),
    { token: bearerToken },
  );
  await page.setViewportSize({ width: 1_440, height: 1_000 });
  await page.goto(new URL("/systems", origin).href);
  const workspaceRequired = page.getByRole("region", { name: "Workspace required" });
  await expect(workspaceRequired.or(page.getByRole("heading", { name: "Systems", exact: true }))).toBeVisible();
  if (!(await workspaceRequired.isVisible())) {
    await page.getByRole("button", { name: "Home", exact: true }).click();
    await page.getByRole("button", { name: "Create new workspace", exact: true }).click();
  }
  await page
    .locator('input[name="workspaceName"]')
    .fill("Browser lifecycle qualification");
  await page.getByRole("button", { name: "Create workspace" }).click();
  await page.getByRole("button", { name: "Systems", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Systems", level: 1 }),
  ).toBeVisible();
  const workspaceId = await page
    .getByLabel("Select current workspace")
    .inputValue();
  const authorization = { authorization: `Bearer ${bearerToken}` };
  const savedModelResponse = await request.post(
    new URL("/api/model/reference/save", serverOrigin).href,
    {
      headers: authorization,
      data: {
        workspaceId,
        provider: "huggingface",
        modelId: "qualification/controlled-chat",
        displayName: QUALIFICATION_MODEL_NAME,
        inferenceMode: "chat",
        taskTags: ["text-generation"],
        artifactForm: "full-model",
      },
    },
  );
  expect(savedModelResponse.ok()).toBe(true);
  const savedModel = await savedModelResponse.json();
  const modelRecordId = savedModel?.value?.model?.modelRecordId;
  expect(typeof modelRecordId).toBe("string");
  const deniedPatch = await request.post(new URL("/api/model/record/update", serverOrigin).href, {
    headers: authorization,
    data: { workspaceId, modelRecordId, patch: { lifecycleStatus: "downloaded", validationStatus: "valid" } },
  });
  expect(deniedPatch.ok()).toBe(false);
  const downloadedModelResponse = await request.post(
    new URL("/api/model/download", serverOrigin).href,
    {
      headers: authorization,
      data: {
        workspaceId,
        modelRecordId,
        provider: "huggingface", modelId: "qualification/controlled-chat",
        displayName: QUALIFICATION_MODEL_NAME, inferenceMode: "chat",
        taskTags: ["text-generation"], artifactForm: "full-model",
      },
    },
  );
  expect(downloadedModelResponse.ok()).toBe(true);

  await completeGuidedSystemLifecycle(page, "Browser portal", {
    modelDisplayName: QUALIFICATION_MODEL_NAME,
  });
  const summary = page.getByRole("region", { name: "Page summary", exact: true });
  await expect(summary.getByText("Summary unavailable.", { exact: true })).toBeVisible();
  await expect(summary).not.toHaveAttribute("aria-busy", "true");
  expect(await summary.locator("dd").allTextContents()).toEqual(["—", "—"]);
  const axe = await new AxeBuilder({ page }).include(".system-build").analyze();
  expect(
    axe.violations.filter(({ impact }) =>
      ["serious", "critical"].includes(impact ?? ""),
    ),
  ).toEqual([]);

  await page.emulateMedia({
    colorScheme: "dark",
    reducedMotion: "reduce",
    forcedColors: "active",
  });
  await assertGuidedLifecycleReflow(page);
  await Promise.all(summaryFailures);
  expect(summaryFailures.length).toBeGreaterThan(0);
  expect(summaryConsoleUrls.every(url => verifiedSummaryUrls.has(url))).toBe(true);
  await test.info().attach("nonmanaged-summary-boundary", { contentType: "application/json",
    body: JSON.stringify({ status: "unavailable", reason: "nonmanaged-fixture-has-no-summary-authority", countsQualified: false }) });
  expect(browserErrors).toEqual([]);
});

function requiredEnvironment(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required.`);
  return value;
}
