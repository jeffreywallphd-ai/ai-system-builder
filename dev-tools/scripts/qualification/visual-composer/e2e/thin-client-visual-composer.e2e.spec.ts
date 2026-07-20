import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Locator, type Page } from "@playwright/test";

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
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Asset Palette", level: 3 }),
  ).toBeVisible();
  await expect(page.getByLabel("Search assets")).toBeVisible();
  const card = page.getByRole("button", { name: "Drag Card", exact: true });
  await expect(card).toBeVisible();
  const activeRegion = page.locator(
    '.system-composer__slot[data-target="true"]',
  );
  await expect(activeRegion).toHaveCount(1);
  await pointerDrag(page, card, activeRegion);
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
  await properties.getByLabel("Title").fill("Qualification summary");
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
  await expect(systemRow).toBeVisible();
  await systemRow.getByRole("button", { name: "Preview" }).click();
  const managePreview = page.getByRole("dialog", {
    name: "Preview: Qualified portal",
  });
  await expect(managePreview.getByText("Qualification summary")).toBeVisible();
  await managePreview.getByRole("button", { name: "Close dialog" }).click();
  await systemRow.getByRole("button", { name: "Open in Compose" }).click();
  await expect(page.getByRole("tab", { name: "Compose" })).toHaveAttribute(
    "aria-selected",
    "true",
  );
  await page.getByRole("button", { name: "Build & test" }).click();
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
  ).toBeVisible();
  const pageOverflow = await page.evaluate(
    () =>
      document.documentElement.scrollWidth -
      document.documentElement.clientWidth,
  );
  expect(pageOverflow).toBeLessThanOrEqual(1);
  expect(browserErrors).toEqual([]);
});

async function pointerDrag(
  page: Page,
  source: Locator,
  destination: Locator,
): Promise<void> {
  const sourceBox = await source.boundingBox();
  const destinationBox = await destination.boundingBox();
  if (!sourceBox || !destinationBox) {
    throw new Error("Drag source or destination is not visible.");
  }
  const sourcePoint = {
    x: sourceBox.x + sourceBox.width / 2,
    y: sourceBox.y + sourceBox.height / 2,
  };
  const destinationPoint = {
    x: destinationBox.x + destinationBox.width / 2,
    y: destinationBox.y + Math.min(destinationBox.height / 2, 80),
  };
  await page.mouse.move(sourcePoint.x, sourcePoint.y);
  await page.mouse.down();
  await page.mouse.move(sourcePoint.x + 10, sourcePoint.y + 10, { steps: 3 });
  await page.mouse.move(destinationPoint.x, destinationPoint.y, { steps: 12 });
  await page.waitForTimeout(250);
  await page.mouse.up();
}

function requiredEnvironment(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required.`);
  return value;
}
