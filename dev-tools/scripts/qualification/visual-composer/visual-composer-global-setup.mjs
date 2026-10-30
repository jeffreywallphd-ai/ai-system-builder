import {
  createVisualComposerHostLaunchPlan,
  startVisualComposerHostLifecycle,
} from "./visual-composer-host-lifecycle.mjs";
import { createHash, createHmac, randomBytes } from "node:crypto";
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { sanitizeVisualComposerQualificationDiagnostic } from "./visual-composer-qualification-core.mjs";
import { readAssetSystemSourceIdentity, assertAssetSystemSourceIdentity } from "../asset-system-source-identity.mjs";
import { resolveVisualComposerQualificationEnvironment } from "./visual-composer-qualification-environment.mjs";

// Compare only bounded inventory values from the fixed regular-file reader.
// Physical identity, realpath and reparse checks remain that reader's job.
export function compareFixedOcrPackageInventories(before, after) {
  const fail = () => { throw new Error("Fixed OCR package inventory comparison failed."); };
  const requireValue = (condition) => { if (!condition) fail(); };
  const caps = { files: 4096, directories: 1024, totalBytes: 2 * 1024 ** 3,
    fileBytes: 512 * 1024 ** 2, depth: 24, pathBytes: 768 };
  const allowedParent = "resources/worker/ocr/native/build/NVIDIA Corporation";
  const allowedLeaf = `${allowedParent}/umdlogs`;
  const record = (value, keys) => {
    requireValue(value !== null && typeof value === "object" && Object.getPrototypeOf(value) === Object.prototype);
    const descriptors = Object.getOwnPropertyDescriptors(value);
    requireValue(Reflect.ownKeys(descriptors).length === keys.length);
    for (const key of keys) requireValue(Object.hasOwn(descriptors, key) && Object.hasOwn(descriptors[key], "value"));
  };
  const list = (value, maximum) => {
    requireValue(Array.isArray(value) && value.length <= maximum && Reflect.ownKeys(value).length === value.length + 1);
    for (let i = 0; i < value.length; i += 1) requireValue(Object.hasOwn(Object.getOwnPropertyDescriptor(value, String(i)) ?? {}, "value"));
  };
  const relative = (value, directory) => {
    requireValue(typeof value === "string" && value.length > 0 && Buffer.byteLength(value) <= caps.pathBytes);
    if (directory && value === ".") return;
    requireValue(!/[\\<>:"|?*\x00-\x1f\x7f]/u.test(value));
    const segments = value.split("/");
    requireValue(segments.length <= caps.depth + (directory ? 0 : 1));
    for (const segment of segments) {
      requireValue(segment !== "" && segment !== "." && segment !== ".." && !/[. ]$/u.test(segment));
      requireValue(!/^(?:con|prn|aux|nul|com[1-9]|lpt[1-9]|conin\$|conout\$)(?:\.|$)/iu.test(segment));
    }
  };
  const validate = (value) => {
    record(value, ["schema_version", "root", "caps", "files", "directories", "total_bytes", "framed_sha256"]);
    requireValue(value.schema_version === "fixed-packaged-desktop-tree-v1");
    requireValue(typeof value.root === "string" && value.root.length <= 32768 && !/[\x00-\x1f\x7f]/u.test(value.root));
    requireValue(path.isAbsolute(value.root) && path.normalize(value.root) === value.root && value.root.endsWith(path.join("out", "ai-system-builder-win32-x64")));
    record(value.caps, Object.keys(caps));
    for (const key of Object.keys(caps)) requireValue(value.caps[key] === caps[key]);
    list(value.files, caps.files); list(value.directories, caps.directories);
    requireValue(value.files.length > 0 && value.directories.length > 0 && value.directories[0] === ".");
    const identities = new Set(), directories = new Set();
    let previous = "", total = 0;
    for (const directory of value.directories) {
      relative(directory, true); requireValue(previous === "" || previous < directory); previous = directory;
      const identity = directory.toLowerCase(); requireValue(!identities.has(identity)); identities.add(identity); directories.add(directory);
      if (identity === allowedParent.toLowerCase() || identity.startsWith(`${allowedParent.toLowerCase()}/`)) {
        requireValue(directory === allowedParent || directory === allowedLeaf);
      }
    }
    for (const directory of value.directories) {
      if (directory !== ".") requireValue(directories.has(directory.includes("/") ? directory.slice(0, directory.lastIndexOf("/")) : "."));
    }
    previous = "";
    for (const file of value.files) {
      record(file, ["path", "bytes", "sha256"]); relative(file.path, false);
      requireValue(previous === "" || previous < file.path); previous = file.path;
      const identity = file.path.toLowerCase(); requireValue(!identities.has(identity)); identities.add(identity);
      requireValue(identity !== allowedParent.toLowerCase() && !identity.startsWith(`${allowedParent.toLowerCase()}/`));
      requireValue(directories.has(file.path.includes("/") ? file.path.slice(0, file.path.lastIndexOf("/")) : "."));
      requireValue(Number.isSafeInteger(file.bytes) && file.bytes >= 0 && file.bytes <= caps.fileBytes);
      requireValue(typeof file.sha256 === "string" && /^[a-f0-9]{64}$/u.test(file.sha256));
      total += file.bytes; requireValue(Number.isSafeInteger(total) && total <= caps.totalBytes);
    }
    requireValue(value.total_bytes === total && typeof value.framed_sha256 === "string" && /^[a-f0-9]{64}$/u.test(value.framed_sha256));
    const framed = { schema_version: value.schema_version, root: value.root, caps,
      files: value.files, directories: value.directories, total_bytes: total };
    requireValue(createHash("sha256").update(JSON.stringify(framed)).digest("hex") === value.framed_sha256);
    return directories;
  };
  const beforeDirectories = validate(before), afterDirectories = validate(after);
  requireValue(before.root === after.root && before.total_bytes === after.total_bytes && before.files.length === after.files.length);
  for (let i = 0; i < before.files.length; i += 1) {
    const oldFile = before.files[i], newFile = after.files[i];
    requireValue(oldFile.path === newFile.path && oldFile.bytes === newFile.bytes && oldFile.sha256 === newFile.sha256);
  }
  for (const directory of beforeDirectories) requireValue(afterDirectories.has(directory));
  const addedDirectories = after.directories.filter((directory) => !beforeDirectories.has(directory));
  requireValue(addedDirectories.length <= 2 && addedDirectories.every((directory) => directory === allowedParent || directory === allowedLeaf));
  return { schema_version: "fixed-ocr-package-inventory-comparison-v1",
    before_framed_sha256: before.framed_sha256, after_framed_sha256: after.framed_sha256,
    added_empty_directories: addedDirectories, all_files_unchanged: true, all_original_directories_preserved: true };
}

export default async function visualComposerGlobalSetup(config) {
  return startVisualComposerQualification(config, createVisualComposerHostLaunchPlan());
}

// Reuse authentication, lifecycle and teardown for a separately reviewed fixed
// qualification plan. The normal default above retains its existing plan.
export async function startVisualComposerQualification(config, launchPlan) {
  process.env.VISUAL_COMPOSER_QUALIFICATION_RUN_ID = launchPlan.runId;
  process.env.VISUAL_COMPOSER_QUALIFICATION_ENVIRONMENT_ID = `local-${process.platform}-${process.arch}`;
  const sourceRevision = await readAssetSystemSourceIdentity(launchPlan.repoRoot);
  Object.assign(process.env, resolveVisualComposerQualificationEnvironment(launchPlan, sourceRevision));

  const projects = resolveRequestedProjects(
    config.projects.map((project) => project.name),
  );
  if (projects.has("packaged-desktop")) {
    buildPackagedDesktopFromCurrentWorktree(launchPlan);
    preparePackagedDesktopQualificationIdentity(launchPlan);
  }
  if (!projects.has("thin-chrome")) return async () => assertAssetSystemSourceIdentity(launchPlan.repoRoot, sourceRevision);

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
    await assertAssetSystemSourceIdentity(launchPlan.repoRoot, sourceRevision);
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

export function prepareThinClientQualificationIdentity(launchPlan, purpose = "standard") {
  if (purpose !== "standard" && purpose !== "image-generation" && purpose !== "settings" && purpose !== "functional-data") throw new Error("Unsupported qualification credential purpose.");
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
              ...(purpose === "functional-data" ? ["provider-credential:use"] : []),
              ...(purpose === "image-generation" ? ["image-generation:read", "image-generation:write"] : []),
              ...(purpose === "settings" ? ["settings:read", "settings:write", "provider-credential:read", "provider-credential:write"] : []),
              "artifact:read",
              "artifact:write",
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

// Trusted reviewed callers must verify source and package before seeding.
// This does not build the package, configure runtimes or start web services.
export function preparePackagedDesktopQualificationIdentity(launchPlan, options = {}) {
  if ((options.platform ?? process.platform) !== "win32") {
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
  const result = (options.spawnProcess ?? spawnSync)(
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
