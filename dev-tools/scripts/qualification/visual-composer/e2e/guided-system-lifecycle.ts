import { expect, type Page } from "@playwright/test";

export interface GuidedSystemLifecycleOptions {
  readonly modelDisplayName: string;
  readonly exerciseStartedRuntime?: (attempt: 1 | 2) => Promise<void>;
  readonly restartRuntime?: boolean;
}

export async function completeGuidedSystemLifecycle(
  page: Page,
  systemName: string,
  options: GuidedSystemLifecycleOptions,
): Promise<void> {
  await expect(page.getByRole("tab", { name: "Compose" })).toHaveAttribute(
    "aria-selected",
    "true",
  );
  await expect(page.getByRole("tab", { name: "Plans" })).toHaveCount(0);
  await expect(page.getByRole("tab", { name: "Build & Release" })).toHaveCount(
    0,
  );
  await expect(page.getByRole("tab", { name: "Publish" })).toBeVisible();
  await expect(page.getByRole("tab", { name: "Run & Test" })).toHaveCount(0);

  await page
    .getByLabel("System template")
    .selectOption({ label: "Controlled chatbot" });
  await page.getByLabel("Template system name").fill(systemName);
  await page.getByRole("button", { name: "Create from template" }).click();
  await expect(
    page.getByRole("heading", { name: "Canvas", level: 3 }),
  ).toBeVisible({ timeout: 30_000 });

  await page.getByRole("tab", { name: "Layers", exact: true }).click();
  const messageComposer = page
    .getByRole("treeitem")
    .filter({ hasText: "Message composer" })
    .last();
  await expect(messageComposer).toBeVisible({ timeout: 30_000 });
  await messageComposer.click();
  const composerDetails = page.getByRole("complementary", {
    name: "Composer details",
  });
  await composerDetails
    .getByRole("tab", { name: "Properties", exact: true })
    .click();
  await composerDetails.getByRole("tab", { name: "Data", exact: true }).click();
  const modelPicker = composerDetails.getByLabel("Text generation model");
  await expect(modelPicker).toBeVisible({ timeout: 30_000 });
  await modelPicker.selectOption({ label: options.modelDisplayName });
  await expect(modelPicker).not.toHaveValue("");

  await page.getByRole("button", { name: "Layouts" }).click();
  const standardLayout = page.getByRole("radio", { name: /Standard/ });
  await expect(standardLayout).toBeVisible({ timeout: 30_000 });
  await standardLayout.focus();
  await standardLayout.press("Space");
  await expect(standardLayout).toBeChecked();
  await expect(
    page.getByText("Unsaved changes", { exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Save and validate revision" })
    .click();
  await expect(page.getByText("Revision saved and validated.")).toBeVisible();

  await page.getByRole("tab", { name: "Manage" }).click();
  const systemRow = page.getByRole("row", { name: new RegExp(systemName) });
  await expect(systemRow).toBeVisible({ timeout: 30_000 });
  await systemRow.getByRole("button", { name: "Open in Compose" }).click();
  await expect(page.getByRole("tab", { name: "Compose" })).toHaveAttribute(
    "aria-selected",
    "true",
  );

  const buildAndTest = page.getByRole("button", {
    name: "Build & test",
    exact: true,
  });
  await buildAndTest.focus();
  await buildAndTest.press("Enter");
  const buildDialog = page.getByRole("dialog", {
    name: `Build & test ${systemName}`,
  });
  await expect(buildDialog).toBeVisible();
  await expect(
    buildDialog.getByText("Create a checked build", { exact: false }),
  ).toBeVisible();
  await expect(buildDialog.getByText("Yes", { exact: true })).toBeVisible({
    timeout: 30_000,
  });
  await expect(
    buildDialog.getByText(/\b(?:API|ABI|toolchain|trust level)\b/i),
  ).toHaveCount(0);
  await expect(buildDialog.locator("details")).toHaveCount(0);
  const modalBuildAction = buildDialog.getByRole("button", {
    name: "Build & test",
    exact: true,
  });
  await expect(modalBuildAction).toBeFocused();
  await modalBuildAction.press("Enter");
  await expect(
    buildDialog.getByRole("heading", { name: "Build and checks completed" }),
  ).toBeVisible({ timeout: 60_000 });
  await expect(
    buildDialog.getByText("ready to review in Publish", { exact: false }),
  ).toBeVisible();
  await expect(buildDialog.locator("details")).not.toHaveAttribute("open", "");
  await buildDialog.getByRole("button", { name: "Close", exact: true }).click();
  await expect(buildAndTest).toBeFocused();

  await page.getByRole("tab", { name: "Publish" }).click();
  const publishWorkspace = page.getByRole("tabpanel", {
    name: "Publish",
    exact: true,
  });
  await expect(
    publishWorkspace.getByRole("heading", { name: "Publish", level: 2 }),
  ).toBeVisible();
  await expect(
    publishWorkspace.getByRole("combobox", { name: "System", exact: true }),
  ).toHaveValue(/.+/);
  await expect(
    publishWorkspace.getByRole("combobox", {
      name: "Build version",
      exact: true,
    }),
  ).toHaveValue(/.+/);
  await expect(
    publishWorkspace.getByText("Ready to publish", { exact: true }).first(),
  ).toBeVisible();

  const publishBuild = publishWorkspace.getByRole("button", {
    name: "Publish build",
  });
  await publishBuild.click();
  let publishDialog = page.getByRole("dialog", { name: "Publish this build?" });
  await expect(publishDialog).toContainText(systemName);
  await expect(publishDialog).toContainText("cannot be changed");
  await expect(
    publishDialog.getByRole("button", { name: "Publish", exact: true }),
  ).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(publishDialog).toBeHidden();
  await expect(publishBuild).toBeFocused();

  await publishBuild.press("Enter");
  publishDialog = page.getByRole("dialog", { name: "Publish this build?" });
  await publishDialog
    .getByRole("button", { name: "Publish", exact: true })
    .press("Enter");
  await expect(
    publishWorkspace.getByText(`${systemName}, build`, { exact: false }),
  ).toBeVisible({
    timeout: 30_000,
  });
  await expect(
    publishWorkspace.getByRole("heading", { name: "Published builds" }),
  ).toBeVisible();
  await expect(
    publishWorkspace.getByText("Published", { exact: true }).first(),
  ).toBeVisible();
  await expect(publishWorkspace.getByText("Deployment identifier")).toHaveCount(
    0,
  );
  await expect(
    publishWorkspace.getByRole("button", { name: "Open System" }),
  ).toHaveCount(0);

  const install = publishWorkspace.getByRole("button", { name: "Install" });
  await expect(install).toBeVisible({ timeout: 30_000 });
  await install.click();
  await expect(
    publishWorkspace.getByText("Installed and activated."),
  ).toBeVisible({
    timeout: 30_000,
  });
  await expect(
    publishWorkspace.getByRole("button", { name: "Start" }),
  ).toBeVisible();
  await expect(
    publishWorkspace.getByRole("button", { name: "Deactivate" }),
  ).toBeVisible();
  await expect(
    publishWorkspace.getByRole("button", { name: "Uninstall" }),
  ).toBeVisible();

  await publishWorkspace.getByRole("button", { name: "Start" }).click();
  await expect(
    publishWorkspace.getByRole("button", { name: "Stop" }),
  ).toBeVisible();
  await expect(
    publishWorkspace.getByRole("button", { name: "Start" }),
  ).toHaveCount(0);
  await expect(
    publishWorkspace.getByRole("button", { name: "Uninstall" }),
  ).toHaveCount(0);
  await options.exerciseStartedRuntime?.(1);
  await publishWorkspace.getByRole("button", { name: "Stop" }).click();
  await expect(
    publishWorkspace.getByRole("button", { name: "Start" }),
  ).toBeVisible();
  await expect(
    publishWorkspace.getByRole("button", { name: "Uninstall" }),
  ).toBeVisible();
  if (options.restartRuntime) {
    await publishWorkspace.getByRole("button", { name: "Start" }).click();
    await expect(
      publishWorkspace.getByRole("button", { name: "Stop" }),
    ).toBeVisible();
    await options.exerciseStartedRuntime?.(2);
    await publishWorkspace.getByRole("button", { name: "Stop" }).click();
    await expect(
      publishWorkspace.getByRole("button", { name: "Start" }),
    ).toBeVisible();
    await expect(
      publishWorkspace.getByRole("button", { name: "Uninstall" }),
    ).toBeVisible();
  }
  await publishWorkspace.getByRole("button", { name: "Uninstall" }).click();
  await expect(
    publishWorkspace.getByRole("button", { name: "Install" }),
  ).toBeVisible();
}

export async function assertGuidedLifecycleReflow(page: Page): Promise<void> {
  await page.setViewportSize({ width: 320, height: 1_000 });
  await expect(
    page.getByRole("heading", { name: "Publish", level: 2 }),
  ).toBeVisible();
  const pageOverflow = await page.evaluate(
    () =>
      document.documentElement.scrollWidth -
      document.documentElement.clientWidth,
  );
  expect(pageOverflow).toBeLessThanOrEqual(1);
}
