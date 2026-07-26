import {
  createVisualComposerHostLaunchPlan,
  startVisualComposerHostLifecycle,
} from "./visual-composer-host-lifecycle.mjs";
import { existsSync, mkdirSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { sanitizeVisualComposerQualificationDiagnostic } from "./visual-composer-qualification-core.mjs";

export default async function visualComposerGlobalSetup(config) {
  const launchPlan = createVisualComposerHostLaunchPlan();
  process.env.VISUAL_COMPOSER_QUALIFICATION_RUN_ID = launchPlan.runId;
  process.env.VISUAL_COMPOSER_QUALIFICATION_ENVIRONMENT_ID = `local-${process.platform}-${process.arch}`;
  process.env.VISUAL_COMPOSER_QUALIFICATION_SOURCE_REVISION =
    process.env.GITHUB_SHA?.trim() || "worktree";
  process.env.VISUAL_COMPOSER_DESKTOP_EXECUTABLE =
    launchPlan.desktop.executablePath;
  process.env.VISUAL_COMPOSER_DESKTOP_DATA_ROOT =
    launchPlan.paths.desktopDataRoot;

  const projects = new Set(config.projects.map((project) => project.name));
  if (projects.has("packaged-desktop")) {
    preparePackagedDesktop(launchPlan);
  }
  if (!projects.has("thin-chrome")) return undefined;

  const lifecycle = await startVisualComposerHostLifecycle({ launchPlan });
  process.env.VISUAL_COMPOSER_THIN_CLIENT_ORIGIN =
    lifecycle.thinClientOrigin.origin;
  process.env.VISUAL_COMPOSER_SERVER_ORIGIN = lifecycle.serverOrigin.origin;
  return async () => lifecycle.stop();
}

function preparePackagedDesktop(launchPlan) {
  if (process.platform !== "win32") {
    throw new Error(
      "Packaged desktop visual composer qualification currently requires Windows.",
    );
  }
  for (const executablePath of [
    launchPlan.desktop.executablePath,
    launchPlan.desktop.seed.command,
  ]) {
    if (!existsSync(executablePath)) {
      throw new Error(
        sanitizeVisualComposerQualificationDiagnostic(
          `Packaged desktop qualification executable is unavailable: ${executablePath}`,
          {
            repoRoot: launchPlan.repoRoot,
            userRoot: process.env.USERPROFILE ?? process.env.HOME,
          },
        ),
      );
    }
  }
  mkdirSync(launchPlan.paths.desktopDataRoot, { recursive: true });
  const result = spawnSync(
    launchPlan.desktop.seed.command,
    launchPlan.desktop.seed.args,
    {
      cwd: launchPlan.desktop.seed.cwd,
      env: launchPlan.desktop.seed.env,
      windowsHide: true,
      encoding: "utf8",
      timeout: 30_000,
    },
  );
  if (result.status === 0) return;
  throw new Error(
    sanitizeVisualComposerQualificationDiagnostic(
      `Unable to seed packaged desktop identity. ${result.error?.message ?? ""} ${result.stderr ?? ""}`,
      {
        repoRoot: launchPlan.repoRoot,
        userRoot: process.env.USERPROFILE ?? process.env.HOME,
        maximumCharacters: 900,
      },
    ),
  );
}
