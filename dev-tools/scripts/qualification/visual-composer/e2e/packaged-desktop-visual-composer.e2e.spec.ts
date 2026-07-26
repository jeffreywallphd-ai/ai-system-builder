import { readFileSync } from "node:fs";
import path from "node:path";
import { expect, test } from "@playwright/test";
import { _electron as electron } from "playwright";

test.setTimeout(180_000);
const axeSource = readFileSync(
  path.resolve(process.cwd(), "node_modules", "axe-core", "axe.min.js"),
  "utf8",
);

test("packaged desktop completes the real visual composer workflow", async () => {
  const executablePath = requiredEnvironment(
    "VISUAL_COMPOSER_DESKTOP_EXECUTABLE",
  );
  const dataRoot = requiredEnvironment("VISUAL_COMPOSER_DESKTOP_DATA_ROOT");
  const electronApp = await electron.launch({
    executablePath,
    args: [`--user-data-dir=${dataRoot}`, "--disable-gpu"],
    env: { ...process.env, VISUAL_COMPOSER_DESKTOP_DATA_ROOT: dataRoot },
    timeout: 60_000,
  });

  try {
    const page = await electronApp.firstWindow({ timeout: 60_000 });
    const rendererErrors: string[] = [];
    page.on("console", (message) => {
      if (message.type() === "error") rendererErrors.push(message.text());
    });
    page.on("pageerror", (error) => rendererErrors.push(error.message));

    await expect(
      page.getByRole("heading", { name: "Create a Workspace", level: 1 }),
    ).toBeVisible({ timeout: 60_000 });
    await page.getByRole("button", { name: "Create new workspace" }).click();
    await page
      .locator('input[name="workspaceName"]')
      .fill("Desktop composer qualification");
    await page.getByRole("button", { name: "Create workspace" }).click();
    await page.getByRole("button", { name: "Systems", exact: true }).click();

    await expect(
      page.getByRole("heading", { name: "Systems", level: 1 }),
    ).toBeVisible({ timeout: 30_000 });
    const standardLayout = page.getByRole("radio", { name: /Standard/ });
    await expect(standardLayout).toBeVisible({ timeout: 30_000 });
    await standardLayout.check();
    await page.getByLabel("New system name").fill("Packaged portal");
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
    await expect(
      page.getByText("Last composition change undone."),
    ).toBeVisible();
    await page.getByRole("button", { name: "Redo" }).click();
    await expect(page.getByText("Composition change restored.")).toBeVisible();
    await expect(
      properties.getByRole("heading", { name: "Configure Card" }),
    ).toBeVisible();
    await properties
      .getByRole("textbox", { name: "Title", exact: true })
      .fill("Packaged summary");
    await page.getByRole("button", { name: "Preview UI" }).click();
    const preview = page.getByRole("dialog", {
      name: "Packaged portal UI preview",
    });
    await expect(preview.getByText("Packaged summary")).toBeVisible();
    await preview
      .getByRole("button", { name: "Close system UI preview" })
      .click();

    await page
      .getByRole("button", { name: "Save and validate revision" })
      .click();
    await expect(page.getByText("Revision saved and validated.")).toBeVisible();

    await page.getByRole("tab", { name: "Manage" }).click();
    const systemRow = page.getByRole("row", { name: /Packaged portal/ });
    await expect(systemRow).toBeVisible({ timeout: 30_000 });
    await systemRow.getByRole("button", { name: "Preview" }).click();
    const managePreview = page.getByRole("dialog", {
      name: "Preview: Packaged portal",
    });
    await expect(managePreview.getByText("Packaged summary")).toBeVisible({
      timeout: 30_000,
    });
    await managePreview.getByRole("button", { name: "Close dialog" }).click();
    await systemRow.getByRole("button", { name: "Open in Compose" }).click();
    const buildAndTest = page.getByRole("button", { name: "Build & test" });
    await expect(buildAndTest).toBeVisible({ timeout: 30_000 });
    await buildAndTest.click();
    await expect(
      page.getByRole("tab", { name: "Build & Release" }),
    ).toHaveAttribute("aria-selected", "true");

    await page.getByRole("tab", { name: "Compose" }).click();
    await expect(
      page.getByRole("heading", { name: "Canvas", level: 3 }),
    ).toBeVisible({ timeout: 30_000 });
    await page.evaluate(axeSource);
    const axeViolations = await page.evaluate(async () => {
      const axe = (
        globalThis as unknown as {
          axe: {
            run: (target: string) => Promise<{
              violations: readonly {
                id: string;
                impact?: string | null;
              }[];
            }>;
          };
        }
      ).axe;
      const result = await axe.run(".system-builder");
      return result.violations.map((violation) => ({
        id: violation.id,
        impact: violation.impact ?? null,
      }));
    });
    expect(
      axeViolations.filter((violation) =>
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
    expect(rendererErrors).toEqual([]);
  } finally {
    await electronApp.close();
  }
});

function requiredEnvironment(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required.`);
  return value;
}
