import { launchOwnedNativeZoomContext } from "../native-browser-zoom.mjs";
import { operationalStatusUrl } from "../operational-ui-oracles";
import { expect, test } from "@playwright/test";
import { completeBrowseAuthoringJourney } from "./browse-authoring-journey";
import { completeAssetAuthoringJourney, readBrowserPublishedDefinition } from "./asset-authoring-journey";
import { AUTHORING_PHASE_BUDGET_MS } from "../asset-authoring-oracles";

test.use({trace: "off", screenshot: "off", video: "off"});

test("thin client preserves the complete browse authoring journey", async ({page}) => {
  // Existing browse120s plus five bounded Assets60s phases; no server restart claim.
  test.setTimeout(120_000 + AUTHORING_PHASE_BUDGET_MS);
  const origin = process.env.VISUAL_COMPOSER_THIN_CLIENT_ORIGIN!;
  const token = process.env.VISUAL_COMPOSER_THIN_CLIENT_BEARER_TOKEN!;
  await page.addInitScript(value => localStorage.setItem("ai-system-builder.paired-device-token", value), token);
  await page.goto(new URL("/", origin).href);
  const selectedWorkspace = page.getByLabel("Select current workspace");
  await expect(selectedWorkspace).toBeVisible();
  const previousWorkspaceId = await selectedWorkspace.inputValue();
  await page.getByRole("button", {name: "Create new workspace", exact: true}).click();
  await page.locator('input[name="workspaceName"]').fill("Browse journey fixture");
  await page.getByRole("button", {name: "Create workspace", exact: true}).click();
  await expect(page.locator(".workspace-create-form")).toHaveCount(0);
  await expect(selectedWorkspace).toHaveValue(/^workspace\./);
  await expect(selectedWorkspace).not.toHaveValue(previousWorkspaceId);
  const createdWorkspaceId = await selectedWorkspace.inputValue();
  await expect(page.getByRole("heading", {name: "Browse journey fixture", exact: true})).toBeVisible();
  await page.goto(new URL("/systems", origin).href);
  await expect(selectedWorkspace).toHaveValue(createdWorkspaceId);
  await expect(page.getByRole("heading", {name: "Systems", exact: true})).toBeVisible();
  const result = await completeBrowseAuthoringJourney(page, "Browser browse fixture", async () => {
    await page.reload(); await expect(page.getByRole("heading", {name: "Systems", exact: true})).toBeVisible();
  }, test.info());
  await test.info().attach("browse-journey", {body: JSON.stringify({...result, sourceRevision: process.env.VISUAL_COMPOSER_QUALIFICATION_SOURCE_REVISION, qualification: "local-browser-fixture"}), contentType: "application/json"});
  await page.setViewportSize({width: 1440, height: 1000});
  await page.goto(new URL("/assets", origin).href);
  await expect(page.getByRole("heading", {name: "Assets", exact: true})).toBeVisible();
  await completeAssetAuthoringJourney(page, "thin-chrome", {kind: "document-reload", reload: async () => {
    await page.reload();
  }}, async (input, currentPage) => currentPage.evaluate(readBrowserPublishedDefinition, input), test.info());
});


test("thin client completes Assets and System editing at native 400 percent zoom", async () => {
  test.setTimeout(120_000 + AUTHORING_PHASE_BUDGET_MS);
  if (test.info().project.name !== "thin-chrome") throw new Error("Unsupported native Assets and System host.");
  const origin = process.env.VISUAL_COMPOSER_THIN_CLIENT_ORIGIN ?? "";
  operationalStatusUrl(origin);
  const token = process.env.VISUAL_COMPOSER_THIN_CLIENT_BEARER_TOKEN;
  if (!token) throw new Error("The isolated thin-client test credential is unavailable.");
  const owned = await launchOwnedNativeZoomContext(4), failures: unknown[] = [];
  try {
    const page = owned.context.pages()[0] ?? await owned.context.newPage();
    await page.addInitScript(value => localStorage.setItem("ai-system-builder.paired-device-token", value), token);
    await page.goto(new URL("/", origin).href);
    const selectedWorkspace = page.getByLabel("Select current workspace");
    await expect(selectedWorkspace).toBeVisible();
    const createWorkspace = page.getByRole("button", {name: "Create new workspace", exact: true});
    await expect(createWorkspace).toBeVisible();
    const previousWorkspaceId = await selectedWorkspace.inputValue();
    await createWorkspace.click();
    await page.locator('input[name="workspaceName"]').fill("Native browser browse fixture");
    await page.getByRole("button", {name: "Create workspace", exact: true}).click();
    await expect(page.locator(".workspace-create-form")).toHaveCount(0);
    await expect(selectedWorkspace).toHaveValue(/^workspace\./);
    await expect(selectedWorkspace).not.toHaveValue(previousWorkspaceId);
    const createdWorkspaceId = await selectedWorkspace.inputValue();
    await expect(page.getByRole("heading", {name: "Native browser browse fixture", exact: true})).toBeVisible();
    await page.goto(new URL("/systems", origin).href);
    await expect(selectedWorkspace).toHaveValue(createdWorkspaceId);
    await expect(page.getByRole("heading", {name: "Systems", exact: true})).toBeVisible();
    const result = await completeBrowseAuthoringJourney(page, "Native browser browse fixture", async () => {
      await page.reload(); await expect(page.getByRole("heading", {name: "Systems", exact: true})).toBeVisible();
    }, test.info(), "native400");
    await test.info().attach("browse-journey-native400", {body: JSON.stringify({...result, sourceRevision: process.env.VISUAL_COMPOSER_QUALIFICATION_SOURCE_REVISION, qualification: "local-browser-fixture-native400"}), contentType: "application/json"});
    await page.goto(new URL("/assets", origin).href);
    await expect(page.getByRole("heading", {name: "Assets", exact: true})).toBeVisible();
    await completeAssetAuthoringJourney(page, "thin-chrome", {kind: "document-reload", reload: async () => { await page.reload(); }},
      async (input, currentPage) => currentPage.evaluate(readBrowserPublishedDefinition, input), test.info(), "native400");
  } catch (error) { failures.push(error); }
  try { await owned.close(); } catch (error) { failures.push(error); }
  if (failures.length) throw new AggregateError(failures, "Native Assets/System checks or browser retirement failed.");
});
