import { expect, test, type Page } from "@playwright/test";
import { uploadLowMemorySource } from "./low-memory-dataset-journey";
import { taskOperation } from "./owned-task-journey";
import { qualifyStructuredOutputControls } from "./structured-output-controls-journey";
import { launchOwnedNativeZoomContext } from "../native-browser-zoom.mjs";
import { operationalStatusUrl } from "../operational-ui-oracles";
import { readCriticalAccessibilityMode, type CriticalAccessibilityMode } from "../technical-accessibility-observation";

process.env.PLAYWRIGHT_NO_COPY_PROMPT = "1";
test.use({ trace: "off", screenshot: "off", video: "off" });

async function runBrowserOutputControls(page: Page, mode: CriticalAccessibilityMode = "standard") {
  readCriticalAccessibilityMode(mode);
  expect(process.env.PYTHON_RUNTIME_QUALIFICATION_SCENARIO).toBe("structured-output-controls");
  try {
    await page.addInitScript(token => localStorage.setItem("ai-system-builder.paired-device-token", token), process.env.VISUAL_COMPOSER_THIN_CLIENT_BEARER_TOKEN!);
    await page.goto(new URL("/", process.env.VISUAL_COMPOSER_THIN_CLIENT_ORIGIN!).href);
    await page.getByRole("button", { name: "Create new workspace", exact: true }).click();
    await page.locator('input[name="workspaceName"]').fill("Structured output browser fixture");
    await page.getByRole("button", { name: "Create workspace", exact: true }).click();
    await expect(page.getByLabel("Select current workspace")).toHaveValue(/^workspace\./);
    const workspaceId = await page.getByLabel("Select current workspace").inputValue();
    const started = await taskOperation(page, "start", { workspaceId, provider: "huggingface", modelId: "qualification/controlled-chat", displayName: "Synthetic controls transport bootstrap", inferenceMode: "chat", taskTags: ["text-generation"], artifactForm: "full-model" });
    await expect.poll(async () => (await taskOperation(page, "read", { workspaceId, requestId: started.activity.requestId })).activity.status, { timeout: 15000 }).toBe("succeeded");
    await taskOperation(page, "complete", { workspaceId, requestId: started.activity.requestId });
    const capacity = await page.evaluate(async workspaceId => {
      const response = await fetch(`/api/dataset-preparation/generation-capacity?workspaceId=${encodeURIComponent(workspaceId)}`, {
        headers: { authorization: `Bearer ${localStorage.getItem("ai-system-builder.paired-device-token")}` },
      });
      const body = await response.json();
      return { status: response.status, ok: body.ok, decoderAvailable: body.value?.decoderAvailable === true,
        availableRamReported: Number.isSafeInteger(body.value?.availableSystemMemoryBytes) && body.value.availableSystemMemoryBytes > 0,
        declaredAcceleratorForwarded: body.value?.totalAcceleratorMemoryBytes === 8 * 1024 ** 3,
        availableRamWithinTotal: body.value?.availableSystemMemoryBytes <= body.value?.totalSystemMemoryBytes };
    }, workspaceId);
    await test.info().attach("safe-generation-capacity", { body: JSON.stringify(capacity), contentType: "application/json" });
    expect(capacity).toEqual({ status: 200, ok: true, decoderAvailable: true, availableRamReported: true, availableRamWithinTotal: true, declaredAcceleratorForwarded: true });
    await page.goto(new URL("/artifacts", process.env.VISUAL_COMPOSER_THIN_CLIENT_ORIGIN!).href);
    await uploadLowMemorySource(page, "thin");
    await qualifyStructuredOutputControls(page, test.info(), "thin", async () => {
      await page.reload();
      await expect(page.getByLabel("Select current workspace")).toHaveValue(/^workspace\./, { timeout: 30000 });
      return page;
    }, mode);
  } finally {
    await page.close();
  }
}

test("thin client reports available RAM and restores edited output shapes and explicit choices", async ({ page }) => {
  test.setTimeout(180000);
  await runBrowserOutputControls(page);
});

test("browser edits and reloads output shapes at native 400 percent zoom", async () => {
  test.setTimeout(180000);
  if (test.info().project.name !== "thin-chrome") throw new Error("Unsupported native Data host.");
  operationalStatusUrl(process.env.VISUAL_COMPOSER_THIN_CLIENT_ORIGIN ?? "");
  if (!process.env.VISUAL_COMPOSER_THIN_CLIENT_BEARER_TOKEN) throw new Error("The isolated thin-client test credential is unavailable.");
  expect(process.env.PYTHON_RUNTIME_QUALIFICATION_SCENARIO).toBe("structured-output-controls");
  const owned = await launchOwnedNativeZoomContext(4), failures: unknown[] = [];
  try { await runBrowserOutputControls(owned.context.pages()[0] ?? await owned.context.newPage(), "native400"); }
  catch (error) { failures.push(error); }
  try { await owned.close(); } catch (error) { failures.push(error); }
  if (failures.length) throw new AggregateError(failures, "Native output controls or browser retirement failed.");
});
