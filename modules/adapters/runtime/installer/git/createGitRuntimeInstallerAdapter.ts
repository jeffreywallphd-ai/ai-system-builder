import { execFile as nodeExecFile } from "node:child_process";
import { mkdir as nodeMkdir, readFile as nodeReadFile, readdir as nodeReaddir, stat as nodeStat, writeFile as nodeWriteFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";

import type {
  RuntimeInstallRequest,
  RuntimeInstallResult,
  RuntimeInstallSource,
  RuntimeInstallStatusRequest,
  RuntimeInstallStatusResult,
} from "../../../../contracts/runtime-installer";
import type { RuntimeInstallerPort } from "../../../../application/ports/runtime-installer/runtime-installer.port";
import type { LoggingPort } from "../../../../application/ports/logging";

type ExecFileLike = (file: string, args?: readonly string[]) => Promise<{ stdout: string; stderr: string }>;

interface RuntimeInstallMetadata {
  managedBy: "ai-system-builder";
  targetId: string;
  installRoot: string;
  source: RuntimeInstallSource;
  requestedRef?: string;
  resolvedRef?: string;
  commitSha?: string;
  installedAt: string;
  lastCheckedAt: string;
}

function parseRuntimeInstallMetadata(value: unknown): RuntimeInstallMetadata {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw { code: "metadata-read-failed", message: "Metadata must be an object", details: { reason: "invalid-metadata-object" } };
  }

  const metadata = value as Record<string, unknown>;

  if (metadata.managedBy !== "ai-system-builder") {
    throw { code: "metadata-read-failed", message: "Metadata managedBy is invalid", details: { reason: "invalid-managed-by" } };
  }
  if (typeof metadata.targetId !== "string" || metadata.targetId.trim().length === 0) {
    throw { code: "metadata-read-failed", message: "Metadata targetId is invalid", details: { reason: "invalid-target-id" } };
  }
  if (typeof metadata.installRoot !== "string" || metadata.installRoot.trim().length === 0) {
    throw { code: "metadata-read-failed", message: "Metadata installRoot is invalid", details: { reason: "invalid-install-root" } };
  }
  if (!metadata.source || typeof metadata.source !== "object" || Array.isArray(metadata.source)) {
    throw { code: "metadata-read-failed", message: "Metadata source is invalid", details: { reason: "invalid-source" } };
  }

  const source = metadata.source as Record<string, unknown>;
  if (source.type !== "git" || typeof source.repositoryUrl !== "string" || source.repositoryUrl.trim().length === 0) {
    throw { code: "metadata-read-failed", message: "Metadata git source is invalid", details: { reason: "invalid-git-source" } };
  }

  if (typeof metadata.installedAt !== "string" || typeof metadata.lastCheckedAt !== "string") {
    throw { code: "metadata-read-failed", message: "Metadata timestamps are invalid", details: { reason: "invalid-timestamps" } };
  }
  if (metadata.commitSha !== undefined && typeof metadata.commitSha !== "string") {
    throw { code: "metadata-read-failed", message: "Metadata commitSha is invalid", details: { reason: "invalid-commit-sha" } };
  }

  return {
    managedBy: "ai-system-builder",
    targetId: metadata.targetId as string,
    installRoot: metadata.installRoot as string,
    source: metadata.source as RuntimeInstallSource,
    requestedRef: metadata.requestedRef as string | undefined,
    resolvedRef: metadata.resolvedRef as string | undefined,
    commitSha: metadata.commitSha as string | undefined,
    installedAt: metadata.installedAt as string,
    lastCheckedAt: metadata.lastCheckedAt as string,
  };
}

export interface CreateGitRuntimeInstallerAdapterOptions {
  gitCommand?: string;
  execFile?: ExecFileLike;
  readFile?: typeof nodeReadFile;
  writeFile?: typeof nodeWriteFile;
  mkdir?: typeof nodeMkdir;
  stat?: typeof nodeStat;
  readdir?: typeof nodeReaddir;
  now?: () => string;
  metadataFileName?: string;
  logging?: LoggingPort;
}

const defaultExecFile = promisify(nodeExecFile);

export function createGitRuntimeInstallerAdapter(
  options: CreateGitRuntimeInstallerAdapterOptions = {},
): RuntimeInstallerPort {
  const gitCommand = options.gitCommand ?? "git";
  const execFile = options.execFile ?? ((file: string, args: readonly string[] = []) => defaultExecFile(file, [...args]));
  const readFile = options.readFile ?? nodeReadFile;
  const writeFile = options.writeFile ?? nodeWriteFile;
  const mkdir = options.mkdir ?? nodeMkdir;
  const stat = options.stat ?? nodeStat;
  const readdir = options.readdir ?? nodeReaddir;
  const now = options.now ?? (() => new Date().toISOString());
  const metadataFileName = options.metadataFileName ?? ".ai-system-builder-runtime-install.json";
  const log = (level: "debug" | "info" | "error", message: string, details?: Record<string, unknown>) => {
    void options.logging?.log({
      level,
      message,
      timestamp: new Date().toISOString(),
      verbosity: "normal",
      event: "runtime.git.installer.activity",
      component: "git-runtime-installer",
      subsystem: "runtime",
      data: details,
    });
  };
  const elapsed = (startedAt: number) => Date.now() - startedAt;

  const getMetadataPath = (installRoot: string) => path.join(installRoot, metadataFileName);

  const makeError = (code: string, message: string, details?: Record<string, unknown>) => ({ code, message, details });

  async function pathExists(targetPath: string): Promise<boolean> {
    try {
      await stat(targetPath);
      return true;
    } catch {
      return false;
    }
  }

  async function isDirectoryEmpty(targetPath: string): Promise<boolean> {
    const entries = await readdir(targetPath);
    return entries.length === 0;
  }

  async function readMetadata(installRoot: string): Promise<RuntimeInstallMetadata | undefined> {
    const metadataPath = getMetadataPath(installRoot);
    if (!(await pathExists(metadataPath))) {
      return undefined;
    }
    try {
      const content = await readFile(metadataPath, "utf-8");
      const parsed = JSON.parse(content) as unknown;
      return parseRuntimeInstallMetadata(parsed);
    } catch (error) {
      if (error && typeof error === "object" && "code" in error) {
        throw error;
      }
      throw makeError("metadata-read-failed", `Failed to read metadata from ${metadataPath}`);
    }
  }

  async function writeMetadata(metadata: RuntimeInstallMetadata): Promise<void> {
    const metadataPath = getMetadataPath(metadata.installRoot);
    try {
      await writeFile(metadataPath, JSON.stringify(metadata, null, 2), "utf-8");
    } catch {
      throw makeError("metadata-write-failed", `Failed to write metadata to ${metadataPath}`);
    }
  }

  const isManaged = (metadata: RuntimeInstallMetadata | undefined, targetId: string) =>
    metadata?.managedBy === "ai-system-builder" && metadata.targetId === targetId;

  async function getInstallStatus(request: RuntimeInstallStatusRequest): Promise<RuntimeInstallStatusResult> {
    const statusStartedAt = Date.now();
    if (!request.installRoot) {
      log("error", "Runtime git install status check failed because installRoot is missing.", {
        targetId: request.targetId,
        durationMs: elapsed(statusStartedAt),
      });
      return {
        targetId: request.targetId,
        status: "unknown",
        source: request.source,
        error: makeError("missing-install-root", "installRoot is required"),
      };
    }

    const installRootExists = await pathExists(request.installRoot);
    if (!installRootExists) {
      log("debug", "Runtime git install root does not exist.", {
        targetId: request.targetId,
        installRoot: request.installRoot,
        status: "not-installed",
        durationMs: elapsed(statusStartedAt),
      });
      return { targetId: request.targetId, status: "not-installed", installRoot: request.installRoot, source: request.source };
    }

    if (await isDirectoryEmpty(request.installRoot)) {
      log("debug", "Runtime git install root is empty.", {
        targetId: request.targetId,
        installRoot: request.installRoot,
        status: "not-installed",
        durationMs: elapsed(statusStartedAt),
      });
      return { targetId: request.targetId, status: "not-installed", installRoot: request.installRoot, source: request.source };
    }

    let metadata: RuntimeInstallMetadata | undefined;
    try {
      metadata = await readMetadata(request.installRoot);
    } catch (error) {
      log("error", "Runtime git install metadata status check failed.", {
        targetId: request.targetId,
        installRoot: request.installRoot,
        status: "failed",
        durationMs: elapsed(statusStartedAt),
        error,
      });
      return {
        targetId: request.targetId,
        status: "failed",
        installRoot: request.installRoot,
        source: request.source,
        error: error as RuntimeInstallResult["error"],
      };
    }

    if (isManaged(metadata, request.targetId)) {
      log("debug", "Runtime git install status is managed and installed.", {
        targetId: request.targetId,
        installRoot: request.installRoot,
        status: "installed",
        durationMs: elapsed(statusStartedAt),
      });
      return {
        targetId: request.targetId,
        status: "installed",
        installRoot: request.installRoot,
        source: metadata?.source,
        requestedRef: metadata?.requestedRef,
        resolvedRef: metadata?.resolvedRef,
        commitSha: metadata?.commitSha,
        installedAt: metadata?.installedAt,
        lastCheckedAt: metadata?.lastCheckedAt,
      };
    }

    log("error", "Runtime git install root is non-empty and unmanaged.", {
      targetId: request.targetId,
      installRoot: request.installRoot,
      status: "failed",
      durationMs: elapsed(statusStartedAt),
    });
    return {
      targetId: request.targetId,
      status: "failed",
      installRoot: request.installRoot,
      source: request.source,
      error: makeError("unmanaged-install-root", "Install root is non-empty and unmanaged"),
    };
  }

  async function runGit(args: string[], code: string) {
    try {
      log("debug", "Running git installer command.", { gitCommand, args });
      return await execFile(gitCommand, args);
    } catch (error) {
      log("error", "Git installer command failed.", { gitCommand, args, error });
      throw makeError(code, `Git command failed: ${args.join(" ")}`, { cause: error });
    }
  }

  async function ensureInstalled(request: RuntimeInstallRequest): Promise<RuntimeInstallResult> {
    const operationStartedAt = Date.now();
    log("info", "Ensuring runtime install from git source.", { targetId: request.targetId, installRoot: request.installRoot });
    if (!request.installRoot) {
      return { targetId: request.targetId, status: "failed", installRoot: "", source: request.source, error: makeError("missing-install-root", "installRoot is required") };
    }
    if (request.source.type !== "git") {
      return { targetId: request.targetId, status: "failed", installRoot: request.installRoot, source: request.source, error: makeError("unsupported-install-source", "Only git sources are supported") };
    }
    if (!request.source.repositoryUrl) {
      return { targetId: request.targetId, status: "failed", installRoot: request.installRoot, source: request.source, error: makeError("missing-repository-url", "repositoryUrl is required") };
    }

    const status = await getInstallStatus(request);
    const shouldUpdateManagedInstall = request.allowUpdate === true || request.forceRepair === true;

    if (status.status === "installed" && !shouldUpdateManagedInstall) {
      return {
        targetId: request.targetId,
        status: "installed",
        installRoot: request.installRoot,
        source: status.source ?? request.source,
        requestedRef: status.requestedRef,
        resolvedRef: status.resolvedRef,
        commitSha: status.commitSha,
        installedAt: status.installedAt,
        lastCheckedAt: status.lastCheckedAt,
      };
    }

    if (status.status === "failed" || status.status === "unknown") {
      const forceRepairMessage =
        request.forceRepair === true
          ? "forceRepair is not implemented for unmanaged install roots because destructive repair is forbidden"
          : "Cannot modify unmanaged install root";
      return {
        targetId: request.targetId,
        status: "failed",
        installRoot: request.installRoot,
        source: request.source,
        error: request.forceRepair === true ? makeError("unmanaged-install-root", forceRepairMessage) : (status.error ?? makeError("unmanaged-install-root", forceRepairMessage)),
      };
    }

    const installedAt = now();
    const requestedRef = request.source.ref;

    try {
      if (status.status === "not-installed") {
        await mkdir(path.dirname(request.installRoot), { recursive: true });
        log("info", "Cloning runtime git source.", {
          targetId: request.targetId,
          installRoot: request.installRoot,
          requestedRef,
        });
        await runGit(["clone", request.source.repositoryUrl, request.installRoot], "git-clone-failed");
        if (requestedRef) {
          log("info", "Checking out requested runtime git ref.", {
            targetId: request.targetId,
            installRoot: request.installRoot,
            requestedRef,
          });
          await runGit(["-C", request.installRoot, "checkout", requestedRef], "git-checkout-failed");
        }
      } else if (status.status === "installed" && shouldUpdateManagedInstall) {
        log("info", "Updating managed runtime git install.", {
          targetId: request.targetId,
          installRoot: request.installRoot,
          requestedRef,
          forceRepair: request.forceRepair === true,
        });
        await runGit(["-C", request.installRoot, "fetch", "--all", "--tags"], "git-fetch-failed");
        if (requestedRef) {
          log("info", "Checking out requested runtime git ref.", {
            targetId: request.targetId,
            installRoot: request.installRoot,
            requestedRef,
          });
          await runGit(["-C", request.installRoot, "checkout", requestedRef], "git-checkout-failed");
        } else {
          log("info", "Pulling runtime git install with fast-forward only.", {
            targetId: request.targetId,
            installRoot: request.installRoot,
          });
          await runGit(["-C", request.installRoot, "pull", "--ff-only"], "git-pull-failed");
        }
      }

      log("info", "Resolving runtime git install commit.", {
        targetId: request.targetId,
        installRoot: request.installRoot,
      });
      const revParse = await runGit(["-C", request.installRoot, "rev-parse", "HEAD"], "git-rev-parse-failed");
      const commitSha = revParse.stdout.trim();
      const metadata: RuntimeInstallMetadata = {
      managedBy: "ai-system-builder",
      targetId: request.targetId,
      installRoot: request.installRoot,
      source: request.source,
      requestedRef,
      resolvedRef: requestedRef,
      commitSha,
      installedAt,
      lastCheckedAt: installedAt,
    };
      await writeMetadata(metadata);
      log("info", "Runtime git install succeeded.", {
        targetId: request.targetId,
        installRoot: request.installRoot,
        commitSha,
        durationMs: elapsed(operationStartedAt),
      });

      return {
        targetId: request.targetId,
        status: "installed",
        installRoot: request.installRoot,
        source: request.source,
        requestedRef,
        resolvedRef: requestedRef,
        commitSha,
        installedAt,
        lastCheckedAt: installedAt,
      };
    } catch (error) {
      log("error", "Runtime git install failed.", {
        targetId: request.targetId,
        installRoot: request.installRoot,
        durationMs: elapsed(operationStartedAt),
        error,
      });
      return {
        targetId: request.targetId,
        status: "failed",
        installRoot: request.installRoot,
        source: request.source,
        error: error as RuntimeInstallResult["error"],
      };
    }
  }

  async function repairInstall(request: RuntimeInstallRequest): Promise<RuntimeInstallResult> {
    const operationStartedAt = Date.now();
    log("info", "Repairing runtime git install.", { targetId: request.targetId, installRoot: request.installRoot });
    const status = await getInstallStatus(request);
    log("info", "Runtime git repair preflight status read.", {
      targetId: request.targetId,
      installRoot: request.installRoot,
      status: status.status,
      durationMs: elapsed(operationStartedAt),
      error: status.error,
    });
    if (status.status !== "installed") {
      log("error", "Runtime git repair cannot continue because install is not managed and installed.", {
        targetId: request.targetId,
        installRoot: request.installRoot,
        status: status.status,
        durationMs: elapsed(operationStartedAt),
        error: status.error,
      });
      return {
        targetId: request.targetId,
        status: "failed",
        installRoot: request.installRoot,
        source: request.source,
        error: status.error ?? makeError("unmanaged-install-root", "Install cannot be repaired because it is unmanaged"),
      };
    }
    return ensureInstalled({ ...request, allowUpdate: true, forceRepair: true });
  }

  return { getInstallStatus, ensureInstalled, repairInstall };
}
