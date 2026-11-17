import { expect, test } from "@playwright/test";
import { qualifyReferenceBrowsePerformance } from "./reference-browse-performance";
test("managed reference browse budgets retain exact large and sparse results", async({page})=>{
  test.setTimeout(240000);
  expect(process.env.MANAGED_REFERENCE_WORKSPACE_ID).toMatch(/^workspace\./);
  await page.addInitScript(token=>localStorage.setItem("ai-system-builder.paired-device-token",token),process.env.VISUAL_COMPOSER_THIN_CLIENT_BEARER_TOKEN!);
  await page.goto(new URL("/",process.env.VISUAL_COMPOSER_THIN_CLIENT_ORIGIN!).href);
  await expect(page.getByLabel("Select current workspace")).toHaveValue(process.env.MANAGED_REFERENCE_WORKSPACE_ID!);
  await qualifyReferenceBrowsePerformance(page,test.info());
});
