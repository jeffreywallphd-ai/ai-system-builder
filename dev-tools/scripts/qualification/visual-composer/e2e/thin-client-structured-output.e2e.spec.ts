import { expect, test } from "@playwright/test";
import { uploadLowMemorySource } from "./low-memory-dataset-journey";
import { taskOperation } from "./owned-task-journey";
import { qualifyStructuredOutputControls } from "./structured-output-controls-journey";

process.env.PLAYWRIGHT_NO_COPY_PROMPT = "1";
test.use({ trace: "off", screenshot: "off" });

test("thin client reports available RAM and restores edited output shapes and explicit choices", async ({ page }) => {
  test.setTimeout(180000);
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
        availableRamWithinTotal: body.value?.availableSystemMemoryBytes <= body.value?.totalSystemMemoryBytes };
    }, workspaceId);
    await test.info().attach("safe-generation-capacity", { body: JSON.stringify(capacity), contentType: "application/json" });
    expect(capacity).toEqual({ status: 200, ok: true, decoderAvailable: true, availableRamReported: true, availableRamWithinTotal: true });
    await page.goto(new URL("/artifacts", process.env.VISUAL_COMPOSER_THIN_CLIENT_ORIGIN!).href);
    await uploadLowMemorySource(page, "thin");
    await qualifyStructuredOutputControls(page, test.info(), "thin", async () => {
      await page.reload();
      await expect(page.getByLabel("Select current workspace")).toHaveValue(/^workspace\./, { timeout: 30000 });
      return page;
    });
  } finally {
    await page.close();
  }
});
