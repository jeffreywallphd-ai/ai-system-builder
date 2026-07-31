import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import {
  assertGuidedLifecycleReflow,
  completeGuidedSystemLifecycle,
} from "./guided-system-lifecycle";

test.setTimeout(180_000);
const QUALIFICATION_MODEL_NAME = "Controlled qualification model";

test("thin client completes the guided build and publication lifecycle", async ({
  page,
  request,
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
  const serverOrigin = requiredEnvironment("VISUAL_COMPOSER_SERVER_ORIGIN");
  const bearerToken = requiredEnvironment(
    "VISUAL_COMPOSER_THIN_CLIENT_BEARER_TOKEN",
  );
  const denied = await request.get(
    new URL("/api/workspaces", serverOrigin).href,
  );
  expect(denied.status()).toBe(401);
  await page.addInitScript(
    ({ token }) =>
      localStorage.setItem("ai-system-builder.paired-device-token", token),
    { token: bearerToken },
  );
  await page.setViewportSize({ width: 1_440, height: 1_000 });
  await page.goto(new URL("/systems", origin).href);
  await expect(
    page.getByRole("region", { name: "Workspace required" }),
  ).toBeVisible();
  await page
    .locator('input[name="workspaceName"]')
    .fill("Browser lifecycle qualification");
  await page.getByRole("button", { name: "Create workspace" }).click();
  await expect(
    page.getByRole("heading", { name: "Systems", level: 1 }),
  ).toBeVisible();
  const workspaceId = await page
    .getByLabel("Select current workspace")
    .inputValue();
  const authorization = { authorization: `Bearer ${bearerToken}` };
  const savedModelResponse = await request.post(
    new URL("/api/model/reference/save", serverOrigin).href,
    {
      headers: authorization,
      data: {
        workspaceId,
        provider: "huggingface",
        modelId: "qualification/controlled-chat",
        displayName: QUALIFICATION_MODEL_NAME,
        inferenceMode: "chat",
        taskTags: ["text-generation"],
        artifactForm: "full-model",
      },
    },
  );
  expect(savedModelResponse.ok()).toBe(true);
  const savedModel = await savedModelResponse.json();
  const modelRecordId = savedModel?.value?.model?.modelRecordId;
  expect(typeof modelRecordId).toBe("string");
  const updatedModelResponse = await request.post(
    new URL("/api/model/record/update", serverOrigin).href,
    {
      headers: authorization,
      data: {
        workspaceId,
        modelRecordId,
        patch: { lifecycleStatus: "downloaded", validationStatus: "valid" },
      },
    },
  );
  expect(updatedModelResponse.ok()).toBe(true);

  await completeGuidedSystemLifecycle(page, "Browser portal", {
    modelDisplayName: QUALIFICATION_MODEL_NAME,
  });
  const axe = await new AxeBuilder({ page }).include(".system-build").analyze();
  expect(
    axe.violations.filter(({ impact }) =>
      ["serious", "critical"].includes(impact ?? ""),
    ),
  ).toEqual([]);

  await page.emulateMedia({
    colorScheme: "dark",
    reducedMotion: "reduce",
    forcedColors: "active",
  });
  await assertGuidedLifecycleReflow(page);
  expect(browserErrors).toEqual([]);
});

function requiredEnvironment(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required.`);
  return value;
}
