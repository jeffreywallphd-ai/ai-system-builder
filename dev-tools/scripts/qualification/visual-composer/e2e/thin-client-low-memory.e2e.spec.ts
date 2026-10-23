import { expect, test } from "@playwright/test";
import { qualifyLowMemoryDatasetJourney, uploadLowMemorySource } from "./low-memory-dataset-journey";
import { taskOperation } from "./owned-task-journey";

test("thin client retains optional profile through resource denial, cancellation observation and approved dataset persistence", async ({ page }) => {
  test.setTimeout(180000);
  // Record only fixed synthetic API operation names and browser error codes.
  // Never retain bearer headers, query strings, request bodies or page storage.
  let recordedFailures = 0;
  page.on("requestfailed", request => {
    if (recordedFailures >= 5) return;
    const operation = /^\/api\/model\/download\/(start|read|complete)$/.exec(new URL(request.url()).pathname)?.[1];
    if (!operation) return;
    recordedFailures += 1;
    const observedCode = request.failure()?.errorText ?? "unavailable";
    const errorCode = observedCode.length <= 80 && /^net::ERR_[A-Z_]+$/.test(observedCode) ? observedCode : "unavailable";
    console.warn(JSON.stringify({ diagnostic: "synthetic-task-request-failed", operation, errorCode }));
  });
  expect(process.env.PYTHON_RUNTIME_QUALIFICATION_SCENARIO).toBe("dataset-profile");
  await page.addInitScript(token => localStorage.setItem("ai-system-builder.paired-device-token", token), process.env.VISUAL_COMPOSER_THIN_CLIENT_BEARER_TOKEN!);
  // Another serial spec may already have created a workspace in this server.
  // Create an independent one through the normal Home controls in either case.
  await page.goto(new URL("/", process.env.VISUAL_COMPOSER_THIN_CLIENT_ORIGIN!).href);
  await page.getByRole("button", { name: "Create new workspace", exact: true }).click();
  await page.locator('input[name="workspaceName"]').fill("Low memory browser fixture");
  await page.getByRole("button", { name: "Create workspace", exact: true }).click();
  await page.getByRole("button", { name: "Systems", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Systems", exact: true })).toBeVisible();
  await expect(page.getByLabel("Select current workspace")).toHaveValue(/^workspace\./);
  const workspaceId = await page.getByLabel("Select current workspace").inputValue();
  const started = await taskOperation(page, "start", { workspaceId, provider: "huggingface", modelId: "qualification/controlled-chat", displayName: "Synthetic dataset transport bootstrap", inferenceMode: "chat", taskTags: ["text-generation"], artifactForm: "full-model" });
  await expect.poll(async () => (await taskOperation(page, "read", { workspaceId, requestId: started.activity.requestId })).activity.status, { timeout: 15000 }).toBe("succeeded");
  await taskOperation(page, "complete", { workspaceId, requestId: started.activity.requestId });
  await page.goto(new URL("/artifacts", process.env.VISUAL_COMPOSER_THIN_CLIENT_ORIGIN!).href);
  await uploadLowMemorySource(page, "thin");
  await qualifyLowMemoryDatasetJourney(page, test.info(), "thin");
});
