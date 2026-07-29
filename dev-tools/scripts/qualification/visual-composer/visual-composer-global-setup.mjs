import {
  createVisualComposerHostLaunchPlan,
  startVisualComposerHostLifecycle,
} from "./visual-composer-host-lifecycle.mjs";
import { createHmac, randomBytes } from "node:crypto";
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import path from "node:path";
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
  process.env.VISUAL_COMPOSER_ELECTRON_NODE_EXECUTABLE =
    launchPlan.desktop.seed.command;
  for (const name of [
    "PYTHON_RUNTIME_BASE_URL",
    "PYTHON_RUNTIME_HOST",
    "PYTHON_RUNTIME_PORT",
    "PYTHON_RUNTIME_COMMAND",
    "PYTHON_RUNTIME_ARGS",
    "PYTHON_RUNTIME_WORKER_DIR",
    "PYTHON_RUNTIME_STARTUP_TIMEOUT_MS",
  ]) {
    process.env[name] = launchPlan.desktop.env[name];
  }

  const projects = resolveRequestedProjects(
    config.projects.map((project) => project.name),
  );
  if (projects.has("packaged-desktop")) {
    buildPackagedDesktopFromCurrentWorktree(launchPlan);
    preparePackagedDesktop(launchPlan);
  }
  if (!projects.has("thin-chrome")) return undefined;

  const qualificationIdentity =
    prepareThinClientQualificationIdentity(launchPlan);
  const lifecycle = await startVisualComposerHostLifecycle({ launchPlan });
  process.env.VISUAL_COMPOSER_THIN_CLIENT_ORIGIN =
    lifecycle.thinClientOrigin.origin;
  process.env.VISUAL_COMPOSER_SERVER_ORIGIN = lifecycle.serverOrigin.origin;
  process.env.VISUAL_COMPOSER_THIN_CLIENT_BEARER_TOKEN =
    qualificationIdentity.bearerToken;
  return async () => {
    await lifecycle.stop();
    rmSync(qualificationIdentity.credentialPath, { force: true });
    delete process.env.VISUAL_COMPOSER_THIN_CLIENT_BEARER_TOKEN;
  };
}

export function resolveRequestedProjects(
  configuredProjects,
  commandLine = process.argv.slice(2),
) {
  const requested = new Set();
  for (let index = 0; index < commandLine.length; index += 1) {
    const value = String(commandLine[index]);
    if (value === "--project" && commandLine[index + 1]) {
      requested.add(String(commandLine[index + 1]));
      index += 1;
    } else if (value.startsWith("--project=")) {
      requested.add(value.slice("--project=".length));
    }
  }
  if (requested.size === 0) return new Set(configuredProjects);
  return new Set(configuredProjects.filter((project) => requested.has(project)));
}

export function buildPackagedDesktopFromCurrentWorktree(
  launchPlan,
  options = {},
) {
  const platform = options.platform ?? process.platform;
  if (platform !== "win32") {
    throw new Error(
      "Packaged desktop visual composer qualification currently requires Windows.",
    );
  }
  const npmExecPath = String(
    options.npmExecPath ?? process.env.npm_execpath ?? "",
  ).trim();
  const pathApi = platform === "win32" ? path.win32 : path.posix;
  if (!npmExecPath || !pathApi.isAbsolute(npmExecPath)) {
    throw new Error(
      "Packaged desktop qualification requires an absolute npm executable path.",
    );
  }
  const spawnProcess = options.spawnProcess ?? spawnSync;
  const nodeExecutable = options.nodeExecutable ?? process.execPath;
  const result = spawnProcess(nodeExecutable, [npmExecPath, "run", "package"], {
    cwd: launchPlan.repoRoot,
    env: launchPlan.desktop.env,
    windowsHide: true,
    encoding: "utf8",
    timeout: 300_000,
    maxBuffer: 2 * 1024 * 1024,
  });
  if (result.status === 0) return;
  throw new Error(
    sanitizeVisualComposerQualificationDiagnostic(
      `Unable to build the current packaged desktop. ${result.error?.message ?? ""} ${result.stderr ?? ""}`,
      {
        repoRoot: launchPlan.repoRoot,
        userRoot: process.env.USERPROFILE ?? process.env.HOME,
        maximumCharacters: 900,
      },
    ),
  );
}

function prepareThinClientQualificationIdentity(launchPlan) {
  const bearerToken = randomBytes(32).toString("base64url");
  const tokenHashSecret = randomBytes(32).toString("base64url");
  const credentialPath = path.join(
    launchPlan.paths.thinStorageRoot,
    "config",
    "security",
    "device-credentials.json",
  );
  const now = new Date();
  const expiresAt = new Date(now.getTime() + 30 * 60 * 1_000);
  mkdirSync(path.dirname(credentialPath), { recursive: true });
  writeFileSync(
    credentialPath,
    `${JSON.stringify(
      {
        records: [
          {
            deviceId: `qualification-${launchPlan.runId}`,
            deviceName: "Controlled visual lifecycle qualification",
            tokenHash: createHmac("sha256", tokenHashSecret)
              .update(bearerToken)
              .digest("hex"),
            tokenHashAlgorithm: "sha256",
            scopes: [
              "asset:read",
              "asset:write",
              "model:read",
              "model:write",
              "workspace:read",
              "workspace:write",
            ],
            createdAt: now.toISOString(),
            expiresAt: expiresAt.toISOString(),
          },
        ],
      },
      null,
      2,
    )}\n`,
    { encoding: "utf8", flag: "wx" },
  );
  launchPlan.server.env.SERVER_TOKEN_HASH_SECRET = tokenHashSecret;
  return { bearerToken, credentialPath };
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
