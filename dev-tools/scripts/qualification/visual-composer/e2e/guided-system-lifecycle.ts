import { readCriticalAccessibilityMode, type CriticalAccessibilityMode } from "../technical-accessibility-observation";
import { collectNative400Frame } from "./technical-accessibility";
import { expect, type Page, type Locator, type TestInfo } from "@playwright/test";
import { qualifyCriticalSurfaceAccessibility } from "./critical-surface-accessibility";
import { readRuntimeReleaseContext, runObservedRuntimeLifecycle, type RuntimeReleaseContext } from "../runtime-lifecycle-oracles";

export interface GuidedSystemLifecycleOptions {
  readonly modelDisplayName: string;
  readonly zoomMode?: CriticalAccessibilityMode;
  readonly accessibility: { readonly mode: "initial"; readonly info: TestInfo } | { readonly mode: "repeat"; readonly info?: TestInfo };
  readonly exerciseStartedRuntime?: (attempt: 1 | 2) => Promise<void>;
  readonly restartRuntime?: boolean;
  readonly exerciseStoppedRuntime?: (attempt: 1 | 2) => Promise<void>;
}

export async function prepareGuidedSystemLifecycle(
  page: Page,
  systemName: string,
  options: GuidedSystemLifecycleOptions,
): Promise<GuidedSystemRuntimeHandle> {
  const zoomMode = readCriticalAccessibilityMode(options.zoomMode === undefined ? "standard" : options.zoomMode);
  const accessibility = options.accessibility;
  if (!accessibility || typeof accessibility !== "object" ||
      (accessibility.mode !== "initial" && accessibility.mode !== "repeat") ||
      (accessibility.mode === "initial" && (!accessibility.info || typeof accessibility.info !== "object"))) {
    throw new Error("Unknown lifecycle accessibility mode.");
  }
  if (zoomMode === "native400" && (!accessibility.info?.project || !["thin-chrome", "packaged-desktop"].includes(accessibility.info.project.name))) throw new Error("Unsupported native lifecycle host.");
  const auditInfo = accessibility.mode === "initial" ? accessibility.info : undefined;
  await page.getByRole("tab", { name: "Compose", exact: true }).click();
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
  if (auditInfo) await qualifyCriticalSurfaceAccessibility(page, auditInfo, "system-manage", zoomMode);
  await systemRow.getByRole("button", { name: "Open in Compose" }).click();
  await expect(page.getByRole("tab", { name: "Compose" })).toHaveAttribute(
    "aria-selected",
    "true",
  );

  const composedSystem = page.getByRole("group", { name: "1. Edit an existing system", exact: true })
    .getByRole("combobox", { name: "System", exact: true });
  await expect(composedSystem.locator("option:checked")).toHaveText(systemName, { timeout: 30_000 });
  const composedSystemId = await composedSystem.inputValue();
  if (!composedSystemId) throw new Error("The composed system identity is unavailable.");
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
  if (auditInfo) await qualifyCriticalSurfaceAccessibility(page, auditInfo, "system-build-dialog", zoomMode);
  await modalBuildAction.press("Enter");
  await expect(
    buildDialog.getByRole("heading", { name: "Build and checks completed" }),
  ).toBeVisible({ timeout: 60_000 });
  await expect(
    buildDialog.getByText("ready to review in Publish", { exact: false }),
  ).toBeVisible();
  await expect(buildDialog.locator("details")).not.toHaveAttribute("open", "");
  const checkedDetail = (label: string) => buildDialog.locator("dt")
    .filter({ hasText: new RegExp(`^${label}$`) }).locator("..").locator("dd").textContent();
  const checkedBuildId = await checkedDetail("Build reference");
  const checkedRevisionId = await checkedDetail("Saved version reference");
  if (!checkedBuildId || !checkedRevisionId) throw new Error("The checked build identity is unavailable.");
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
  await publishWorkspace.getByRole("combobox", { name: "System", exact: true }).selectOption(composedSystemId);
  await publishWorkspace.getByRole("combobox", { name: "Build version", exact: true }).selectOption(checkedBuildId);
  await expect(publishWorkspace.getByRole("combobox", { name: "System", exact: true })).toHaveValue(composedSystemId);
  await expect(publishWorkspace.getByRole("combobox", { name: "Build version", exact: true })).toHaveValue(checkedBuildId);
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
  if (auditInfo) await qualifyCriticalSurfaceAccessibility(page, auditInfo, "system-publish", zoomMode);
  const selectedSystem = await publishWorkspace.getByRole("combobox", { name: "System", exact: true }).inputValue();
  const selectedBuild = await publishWorkspace.getByRole("combobox", { name: "Build version", exact: true }).inputValue();

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
  if (auditInfo) await qualifyCriticalSurfaceAccessibility(page, auditInfo, "system-publication-confirm", zoomMode);
  await page.keyboard.press("Escape");
  await expect(publishDialog).toBeHidden();
  await expect(publishBuild).toBeFocused();

  await publishBuild.press("Enter");
  publishDialog = page.getByRole("dialog", { name: "Publish this build?" });
  await publishDialog
    .getByRole("button", { name: "Publish", exact: true })
    .press("Enter");
  const published = publishWorkspace.getByRole("region", { name: "Published builds", exact: true }).getByRole("article");
  await expect(published).toHaveCount(1, { timeout: 30_000 });
  await expect(published).toHaveAttribute("aria-labelledby", `published-build-${selectedBuild}`);
  await expect(publishWorkspace.getByRole("combobox", { name: "System", exact: true })).toHaveValue(selectedSystem);
  await expect(publishWorkspace.getByRole("combobox", { name: "System", exact: true }).locator("option:checked")).toHaveText(systemName);
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

  async function readContext(article: Locator): Promise<RuntimeReleaseContext> {
    const detail = (label: string) => article.locator("dt").filter({ hasText: new RegExp(`^${label}$`) }).locator("..").locator("dd").textContent();
    return readRuntimeReleaseContext({
      workspaceId: await page.getByLabel("Select current workspace").inputValue(),
      systemId: await publishWorkspace.getByRole("combobox", { name: "System", exact: true }).inputValue(),
      buildId: await publishWorkspace.getByRole("combobox", { name: "Build version", exact: true }).inputValue(),
      revisionId: await detail("Saved version"), releaseId: await detail("Release"),
    });
  }
  const context = await readContext(published);
  expect(context.systemId).toBe(composedSystemId);
  expect(context.buildId).toBe(checkedBuildId);
  expect(context.revisionId).toBe(checkedRevisionId);
  const article = publishWorkspace.getByRole("region", { name: "Published builds", exact: true })
    .locator(`article[aria-labelledby="published-build-${context.buildId}"]`);
  async function selectPublished(): Promise<void> {
    await expect(page.getByLabel("Select current workspace")).toHaveValue(context.workspaceId);
    await page.getByRole("tab", { name: "Publish", exact: true }).click();
    const system = publishWorkspace.getByRole("combobox", { name: "System", exact: true });
    if (await system.inputValue() !== context.systemId) await system.selectOption(context.systemId);
    const build = publishWorkspace.getByRole("combobox", { name: "Build version", exact: true });
    await expect(build.locator(`option[value="${context.buildId}"]`)).toHaveCount(1);
    if (await build.inputValue() !== context.buildId) await build.selectOption(context.buildId);
    await expect(article).toHaveCount(1);
    expect(await readContext(article)).toEqual(context);
  }
  await expect(article.getByRole("button", { name: "Install", exact: true })).toBeVisible({ timeout: 30_000 });
  await article.getByRole("button", { name: "Install", exact: true }).click();
  await expect(article.getByText("Active and stopped", { exact: true })).toBeVisible({ timeout: 30_000 });
  await expect(article.getByRole("button", { name: "Start", exact: true })).toBeVisible();
  await expect(article.getByRole("button", { name: "Deactivate", exact: true })).toBeVisible();
  await expect(article.getByRole("button", { name: "Uninstall", exact: true })).toBeVisible();
  return {
    context,
    async start() {
      await selectPublished();
      await article.getByRole("button", { name: "Start", exact: true }).click();
      await expect(article.getByRole("button", { name: "Stop", exact: true })).toBeVisible();
      await expect(article.getByRole("button", { name: "Start", exact: true })).toHaveCount(0);
      await expect(article.getByRole("button", { name: "Uninstall", exact: true })).toHaveCount(0);
    },
    async stop() {
      await selectPublished();
      await article.getByRole("button", { name: "Stop", exact: true }).click();
      await expect(article.getByRole("button", { name: "Start", exact: true })).toBeVisible();
      await expect(article.getByRole("button", { name: "Uninstall", exact: true })).toBeVisible();
    },
    async uninstall() {
      await selectPublished();
      await article.getByRole("button", { name: "Uninstall", exact: true }).click();
      await expect(article.getByText("Not installed", { exact: true })).toBeVisible();
      await expect(article.getByRole("button", { name: "Install", exact: true })).toBeVisible();
    },
  };
}

export interface GuidedSystemRuntimeHandle {
  readonly context: RuntimeReleaseContext;
  start(): Promise<void>;
  stop(): Promise<void>;
  uninstall(): Promise<void>;
}

export async function completeGuidedSystemLifecycle(page: Page, systemName: string, options: GuidedSystemLifecycleOptions): Promise<void> {
  const runtime = await prepareGuidedSystemLifecycle(page, systemName, options);
  await runObservedRuntimeLifecycle({
    start: () => runtime.start(), stop: () => runtime.stop(), uninstall: () => runtime.uninstall(),
    exercise: async attempt => { await options.exerciseStartedRuntime?.(attempt); },
    afterStop: async attempt => { await options.exerciseStoppedRuntime?.(attempt); },
  }, options.restartRuntime);
}

export async function assertGuidedLifecycleReflow(page: Page, mode: CriticalAccessibilityMode = "standard"): Promise<void> {
  readCriticalAccessibilityMode(mode);
  if (mode === "standard") await page.setViewportSize({ width: 320, height: 1_000 });
  else expect((await collectNative400Frame(page)).status).toBe("passed");
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
