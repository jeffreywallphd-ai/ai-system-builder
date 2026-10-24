import { expect, test } from "@playwright/test";
import { qualifyIngestionSourceJourney } from "./ingestion-source-journey";

test.use({ trace: "off", video: "off", screenshot: "off" });
test("browser imports distinct multi-chunk files through Add data and retains their source records", async ({ page }) => {
  test.setTimeout(180_000);
  await page.addInitScript(token => localStorage.setItem("ai-system-builder.paired-device-token", token), process.env.VISUAL_COMPOSER_THIN_CLIENT_BEARER_TOKEN!);
  await page.goto(new URL("/", process.env.VISUAL_COMPOSER_THIN_CLIENT_ORIGIN!).href);
  await page.getByRole("button", { name: "Create new workspace", exact: true }).click();
  await page.locator('input[name="workspaceName"]').fill("Synthetic browser file import");
  await page.getByRole("button", { name: "Create workspace", exact: true }).click();
  await expect(page.getByLabel("Select current workspace")).toHaveValue(/^workspace\./);
  await page.getByRole("button", { name: "Artifacts", exact: true }).click();
  await qualifyIngestionSourceJourney(page, test.info(), "thin");
});
