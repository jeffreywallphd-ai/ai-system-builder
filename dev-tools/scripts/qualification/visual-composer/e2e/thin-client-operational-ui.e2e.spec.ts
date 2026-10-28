import { expect, test } from "@playwright/test";
import { qualifyOperationalUiJourney } from "./operational-ui-journey";
import { OPERATIONAL_HOST_TIMEOUT_MS, operationalStatusUrl } from "../operational-ui-oracles";

test.use({ screenshot: "off", trace: "off", video: "off" });
test("thin client preserves Security refresh recovery and shell controls", async ({ page }) => {
  test.setTimeout(OPERATIONAL_HOST_TIMEOUT_MS);
  const statusUrl = operationalStatusUrl(process.env.VISUAL_COMPOSER_THIN_CLIENT_ORIGIN ?? "");
  const token = process.env.VISUAL_COMPOSER_THIN_CLIENT_BEARER_TOKEN;
  if (!token) throw new Error("The isolated thin-client test credential is unavailable.");
  await page.addInitScript(value => localStorage.setItem("ai-system-builder.paired-device-token", value), token);
  await page.goto(new URL("/systems", statusUrl).href);
  await expect(page.getByRole("heading", { name: "Create a Workspace", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Create new workspace", exact: true }).click();
  await page.locator('input[name="workspaceName"]').fill("Operational browser fixture");
  await page.getByRole("button", { name: "Create workspace", exact: true }).click();
  await expect(page.getByLabel("Select current workspace")).toHaveValue(/^workspace\./);
  await qualifyOperationalUiJourney(page, test.info(), "thin-chrome");
});
