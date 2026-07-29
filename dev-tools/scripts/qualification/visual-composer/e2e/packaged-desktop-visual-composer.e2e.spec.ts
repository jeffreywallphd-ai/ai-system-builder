import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { expect, test } from "@playwright/test";
import { _electron as electron } from "playwright";
import {
  assertGuidedLifecycleReflow,
  completeGuidedSystemLifecycle,
} from "./guided-system-lifecycle";

test.setTimeout(240_000);
const QUALIFICATION_MODEL_NAME = "Controlled qualification model";
const FIRST_QUALIFICATION_MESSAGE = "Button qualification turn";
const SECOND_QUALIFICATION_MESSAGE = "Keyboard qualification turn";
const axeSource = readFileSync(
  path.resolve(process.cwd(), "node_modules", "axe-core", "axe.min.js"),
  "utf8",
);

test("packaged desktop completes the guided build and publication lifecycle", async () => {
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
  const featureLoadDiagnostics: Array<Record<string, string>> = [];
  const captureFeatureLoadDiagnostics = (value: Buffer | string) => {
    for (const line of String(value).split(/\r?\n/)) {
      if (
        !line.includes('"event":"desktop.host.feature.load.failed"') &&
        !line.includes('"event":"desktop.host.model.operation.failed"')
      )
        continue;
      try {
        const parsed = JSON.parse(line) as {
          readonly event?: unknown;
          readonly data?: Readonly<Record<string, unknown>>;
        };
        if (
          ![
            "desktop.host.feature.load.failed",
            "desktop.host.model.operation.failed",
          ].includes(String(parsed.event)) ||
          !parsed.data
        )
          continue;
        featureLoadDiagnostics.push(
          Object.fromEntries([
            ["event", String(parsed.event)],
            ...["featureKey", "stage", "errorName", "errorCode"]
              .filter((key) => typeof parsed.data?.[key] === "string")
              .map((key) => [key, String(parsed.data?.[key])]),
          ]),
        );
      } catch {
        // Only valid bounded structured diagnostics are retained.
      }
    }
  };
  electronApp.process().stdout?.on("data", captureFeatureLoadDiagnostics);
  electronApp.process().stderr?.on("data", captureFeatureLoadDiagnostics);
  let qualificationWorkspaceId = "";

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
      .fill("Desktop lifecycle qualification");
    await page.getByRole("button", { name: "Create workspace" }).click();
    const workspaceSelector = page.getByLabel("Select current workspace");
    await expect(workspaceSelector).toHaveValue(/^workspace\./, {
      timeout: 30_000,
    });
    qualificationWorkspaceId = await workspaceSelector.inputValue();
    await seedDesktopQualificationModel(
      page,
      qualificationWorkspaceId,
      featureLoadDiagnostics,
    );
    await page.getByRole("button", { name: "Systems", exact: true }).click();
    await expect(
      page.getByRole("heading", { name: "Systems", level: 1 }),
    ).toBeVisible();

    await completeGuidedSystemLifecycle(page, "Packaged portal", {
      modelDisplayName: QUALIFICATION_MODEL_NAME,
      restartRuntime: true,
      exerciseStartedRuntime: async (attempt) => {
        await expect
          .poll(
            () =>
              electronApp.windows().filter((candidate) => candidate !== page)
                .length,
            { timeout: 30_000 },
          )
          .toBe(1);
        const runtimePage = electronApp
          .windows()
          .find((candidate) => candidate !== page);
        if (!runtimePage)
          throw new Error("Published runtime window is unavailable.");
        runtimePage.on("console", (message) => {
          if (message.type() === "error") rendererErrors.push(message.text());
        });
        runtimePage.on("pageerror", (error) =>
          rendererErrors.push(error.message),
        );
        await expect(
          runtimePage.getByRole("heading", {
            name: "Packaged portal",
            level: 1,
          }),
        ).toBeVisible({ timeout: 30_000 });
        const transcript = runtimePage.getByRole("log", {
          name: "Conversation history",
        });
        if (attempt === 1) {
          await expect(
            runtimePage.getByText("Start a conversation"),
          ).toBeVisible();
          await expect(transcript.locator("li")).toHaveCount(0);
          await runtimePage.evaluate(axeSource);
          const runtimeViolations = await runtimePage.evaluate(async () => {
            const result = await (
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
            ).axe.run(".system-runtime-app");
            return result.violations.map(({ id, impact }) => ({
              id,
              impact: impact ?? null,
            }));
          });
          expect(
            runtimeViolations.filter(({ impact }) =>
              ["serious", "critical"].includes(impact ?? ""),
            ),
          ).toEqual([]);
          await runtimePage
            .getByLabel("Message")
            .fill(FIRST_QUALIFICATION_MESSAGE);
          await runtimePage.getByRole("button", { name: "Send" }).click();
          await expect(
            transcript.getByText(FIRST_QUALIFICATION_MESSAGE, { exact: true }),
          ).toBeVisible({ timeout: 30_000 });
          await expect(
            transcript.getByText(
              `Controlled response to: ${FIRST_QUALIFICATION_MESSAGE}`,
              { exact: true },
            ),
          ).toBeVisible({ timeout: 30_000 });
          return;
        }
        await expect(
          transcript.getByText(FIRST_QUALIFICATION_MESSAGE, { exact: true }),
        ).toBeVisible({ timeout: 30_000 });
        await expect(
          transcript.getByText(
            `Controlled response to: ${FIRST_QUALIFICATION_MESSAGE}`,
            { exact: true },
          ),
        ).toBeVisible();
        await runtimePage
          .getByLabel("Message")
          .fill(SECOND_QUALIFICATION_MESSAGE);
        await runtimePage.getByLabel("Message").press("Enter");
        await expect(
          transcript.getByText(SECOND_QUALIFICATION_MESSAGE, { exact: true }),
        ).toBeVisible({ timeout: 30_000 });
        await expect(
          transcript.getByText(
            `Controlled response to: ${SECOND_QUALIFICATION_MESSAGE}`,
            { exact: true },
          ),
        ).toBeVisible({ timeout: 30_000 });
        expect(electronApp.windows()).toHaveLength(2);
      },
    });
    await page.evaluate(axeSource);
    const axeViolations = await page.evaluate(async () => {
      const result = await (
        globalThis as unknown as {
          axe: {
            run: (target: string) => Promise<{
              violations: readonly { id: string; impact?: string | null }[];
            }>;
          };
        }
      ).axe.run(".system-build");
      return result.violations.map(({ id, impact }) => ({
        id,
        impact: impact ?? null,
      }));
    });
    expect(
      axeViolations.filter(({ impact }) =>
        ["serious", "critical"].includes(impact ?? ""),
      ),
    ).toEqual([]);

    await page.emulateMedia({
      colorScheme: "dark",
      reducedMotion: "reduce",
      forcedColors: "active",
    });
    await assertGuidedLifecycleReflow(page);
    expect(rendererErrors).toEqual([]);
  } finally {
    await electronApp.close();
  }
  verifyIsolatedRuntimeData(dataRoot, qualificationWorkspaceId);
});

async function seedDesktopQualificationModel(
  page: import("@playwright/test").Page,
  workspaceId: string,
  featureLoadDiagnostics: readonly Readonly<Record<string, string>>[],
): Promise<void> {
  const result = await page.evaluate(
    async ({ modelName, workspaceId: currentWorkspaceId }) => {
      const api = (
        globalThis as unknown as {
          desktopApi?: {
            listModels?: (
              input: Record<string, unknown>,
            ) => Promise<any>;
            saveModelReference?: (
              input: Record<string, unknown>,
            ) => Promise<any>;
            updateModelRecord?: (
              input: Record<string, unknown>,
            ) => Promise<any>;
          };
        }
      ).desktopApi;
      if (!api?.listModels || !api.saveModelReference || !api.updateModelRecord)
        return { ok: false as const, stage: "bridge" };
      const listed = await api.listModels({
        workspaceId: currentWorkspaceId,
        includeDiscovered: false,
      });
      if (!listed?.ok)
        return {
          ok: false as const,
          stage: "list",
          code: listed?.error?.code ?? "model.list.invalid",
          message:
            listed?.error?.message ??
            "The qualification model registry was not ready.",
        };
      const saved = await api?.saveModelReference?.({
        workspaceId: currentWorkspaceId,
        provider: "huggingface",
        modelId: "qualification/controlled-chat",
        displayName: modelName,
        inferenceMode: "chat",
        taskTags: ["text-generation"],
        artifactForm: "full-model",
      });
      const modelRecordId = saved?.ok
        ? saved.value?.model?.modelRecordId
        : undefined;
      if (typeof modelRecordId !== "string")
        return {
          ok: false as const,
          stage: "save",
          code: saved?.error?.code ?? "model.reference-save.invalid",
          message:
            saved?.error?.message ??
            "The qualification model reference was not saved.",
        };
      const updated = await api?.updateModelRecord?.({
        workspaceId: currentWorkspaceId,
        modelRecordId,
        patch: {
          lifecycleStatus: "downloaded",
          validationStatus: "valid",
        },
      });
      return updated?.ok
        ? { ok: true as const }
        : {
            ok: false as const,
            stage: "update",
            code: updated?.error?.code ?? "model.record-update.invalid",
            message:
              updated?.error?.message ??
              "The qualification model record was not updated.",
          };
    },
    { modelName: QUALIFICATION_MODEL_NAME, workspaceId },
  );
  expect(
    result,
    JSON.stringify({ result, featureLoadDiagnostics }),
  ).toEqual({ ok: true });
}

function verifyIsolatedRuntimeData(
  dataRoot: string,
  workspaceId: string,
): void {
  const executable = requiredEnvironment(
    "VISUAL_COMPOSER_ELECTRON_NODE_EXECUTABLE",
  );
  const result = spawnSync(
    executable,
    [
      "--preserve-symlinks",
      "--preserve-symlinks-main",
      "--import",
      "tsx",
      path.resolve(
        "dev-tools/scripts/qualification/visual-composer/visual-composer-runtime-data-verify.ts",
      ),
    ],
    {
      cwd: process.cwd(),
      env: {
        ...process.env,
        ELECTRON_RUN_AS_NODE: "1",
        VISUAL_COMPOSER_DESKTOP_DATA_ROOT: dataRoot,
        VISUAL_COMPOSER_QUALIFICATION_WORKSPACE_ID: workspaceId,
      },
      windowsHide: true,
      encoding: "utf8",
      timeout: 30_000,
    },
  );
  if (result.status !== 0) {
    throw new Error("Isolated runtime data qualification failed.");
  }
}

function requiredEnvironment(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required.`);
  return value;
}
