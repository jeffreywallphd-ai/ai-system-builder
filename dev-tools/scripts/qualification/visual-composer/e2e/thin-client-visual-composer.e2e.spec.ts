import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

test.setTimeout(120_000);

test("thin client completes the real visual composer workflow", async ({
  page,
}) => {
  const browserErrors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") browserErrors.push(message.text());
  });
  page.on("pageerror", (error) => browserErrors.push(error.message));
  page.on("response", (response) => {
    if (response.url().includes("/api/") && response.status() >= 500) {
      browserErrors.push(
        `API ${response.status()} ${new URL(response.url()).pathname}`,
      );
    }
  });

  const origin = requiredEnvironment("VISUAL_COMPOSER_THIN_CLIENT_ORIGIN");
  await page.setViewportSize({ width: 1_440, height: 1_000 });
  await page.goto(new URL("/systems", origin).href);

  await expect(
    page.getByRole("region", { name: "Workspace required" }),
  ).toBeVisible();
  await page
    .locator('input[name="workspaceName"]')
    .fill("Composer qualification");
  await page.getByRole("button", { name: "Create workspace" }).click();

  await expect(
    page.getByRole("heading", { name: "Systems", level: 1 }),
  ).toBeVisible();
  await expect(page.getByRole("tab", { name: "Compose" })).toHaveAttribute(
    "aria-selected",
    "true",
  );
  const standardLayout = page.getByRole("radio", { name: /Standard/ });
  await expect(standardLayout).toBeVisible({ timeout: 30_000 });
  await standardLayout.check();
  await page.getByLabel("New system name").fill("Qualified portal");
  await page.getByRole("button", { name: "Create system" }).click();

  await expect(
    page.getByText("Standard system created", { exact: false }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Canvas", level: 3 }),
  ).toBeVisible({ timeout: 30_000 });
  await expect(
    page.getByRole("heading", { name: "Asset Palette", level: 3 }),
  ).toBeVisible();
  await expect(page.getByLabel("Search compatible assets")).toBeVisible();
  const card = page.getByRole("button", { name: "Drag Card", exact: true });
  await expect(card).toBeVisible({ timeout: 30_000 });
  const activeRegion = page.locator(
    '.system-composer__slot[data-target="true"]',
  );
  await expect(activeRegion).toHaveCount(1);
  await card.focus();
  await card.press("Space");
  await card.press("Escape");
  await expect(
    page.getByText("Drag cancelled. No composition changes were made."),
  ).toBeVisible();
  await card.dragTo(activeRegion);
  await expect(
    page.getByText(
      "Asset added locally. Save the revision to validate and persist it.",
      { exact: true },
    ),
  ).toBeVisible();

  const properties = page.locator("#system-composer-properties-panel");
  await expect(
    properties.getByRole("heading", { name: "Configure Card" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Undo" }).click();
  await expect(page.getByText("Last composition change undone.")).toBeVisible();
  await page.getByRole("button", { name: "Redo" }).click();
  await expect(page.getByText("Composition change restored.")).toBeVisible();
  await expect(
    properties.getByRole("heading", { name: "Configure Card" }),
  ).toBeVisible();
  await properties
    .getByRole("textbox", { name: "Title", exact: true })
    .fill("Qualification summary");
  await expect(
    page.getByText("Unsaved changes", { exact: true }),
  ).toBeVisible();

  await page.getByRole("button", { name: "Preview UI" }).click();
  const preview = page.getByRole("dialog", {
    name: "Qualified portal UI preview",
  });
  await expect(preview).toBeVisible();
  await expect(preview.getByText("Qualification summary")).toBeVisible();
  await preview
    .getByRole("button", { name: "Close system UI preview" })
    .click();

  await page
    .getByRole("button", { name: "Save and validate revision" })
    .click();
  await expect(page.getByText("Revision saved and validated.")).toBeVisible();

  await page.getByRole("tab", { name: "Manage" }).click();
  const systemRow = page.getByRole("row", { name: /Qualified portal/ });
  await expect(systemRow).toBeVisible({ timeout: 30_000 });
  await systemRow.getByRole("button", { name: "Preview" }).click();
  const managePreview = page.getByRole("dialog", {
    name: "Preview: Qualified portal",
  });
  await expect(managePreview.getByText("Qualification summary")).toBeVisible({
    timeout: 30_000,
  });
  await managePreview.getByRole("button", { name: "Close dialog" }).click();
  await systemRow.getByRole("button", { name: "Open in Compose" }).click();
  await expect(page.getByRole("tab", { name: "Compose" })).toHaveAttribute(
    "aria-selected",
    "true",
  );
  const buildAndTest = page.getByRole("button", { name: "Build & test" });
  await expect(buildAndTest).toBeVisible({ timeout: 30_000 });
  await buildAndTest.click();
  await expect(
    page.getByRole("tab", { name: "Build & Release" }),
  ).toHaveAttribute("aria-selected", "true");

  await page.getByRole("tab", { name: "Compose" }).click();
  const axe = await new AxeBuilder({ page })
    .include(".system-builder")
    .analyze();
  expect(
    axe.violations.filter((violation) =>
      ["serious", "critical"].includes(violation.impact ?? ""),
    ),
  ).toEqual([]);

  await page.emulateMedia({
    colorScheme: "dark",
    reducedMotion: "reduce",
    forcedColors: "active",
  });
  await page.setViewportSize({ width: 320, height: 1_000 });
  await expect(
    page.getByRole("heading", { name: "Canvas", level: 3 }),
  ).toBeVisible({ timeout: 30_000 });
  const pageOverflow = await page.evaluate(
    () =>
      document.documentElement.scrollWidth -
      document.documentElement.clientWidth,
  );
  expect(pageOverflow).toBeLessThanOrEqual(1);
  expect(browserErrors).toEqual([]);
});

function requiredEnvironment(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required.`);
  return value;
}
