#!/usr/bin/env node
import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import ts from "typescript";

export function getRepositoryRootFromScriptUrl(scriptUrl = import.meta.url) {
  return path.resolve(path.dirname(fileURLToPath(scriptUrl)), "..", "..", "..");
}

export function createServerDevPaths(repositoryRootDirectory = getRepositoryRootFromScriptUrl()) {
  return {
    repositoryRootDirectory,
    distRootDirectory: path.join(repositoryRootDirectory, "dist"),
    serverTsconfigPath: path.join(repositoryRootDirectory, "apps", "server", "tsconfig.json"),
    serverCreateServerPath: path.join(repositoryRootDirectory, "dist", "apps", "server", "src", "createServer.js"),
  };
}

export function resolveBundledDevPythonCommand(env = process.env) {
  if (env.COMFYUI_PYTHON_COMMAND?.trim()) {
    return undefined;
  }
  const homeDirectory = env.USERPROFILE?.trim() || env.HOME?.trim();
  if (!homeDirectory) {
    return undefined;
  }
  const bundledPython = path.join(
    homeDirectory,
    ".cache",
    "codex-runtimes",
    "codex-primary-runtime",
    "dependencies",
    "python",
    process.platform === "win32" ? "python.exe" : "bin/python",
  );
  return existsSync(bundledPython) ? bundledPython : undefined;
}

function createServerDevEnvironment(env) {
  const bundledPython = resolveBundledDevPythonCommand(env);
  return bundledPython
    ? { ...env, COMFYUI_PYTHON_COMMAND: bundledPython }
    : env;
}

function assertRequiredPathExists(filePath, label) {
  if (!existsSync(filePath)) {
    throw new Error(`Unable to start server dev runner. Missing ${label}: ${filePath}`);
  }
}

function validateServerDevPaths(paths) {
  assertRequiredPathExists(paths.serverTsconfigPath, "server TypeScript config");
}

function createDiagnosticHost() {
  return {
    getCanonicalFileName: (fileName) => fileName,
    getCurrentDirectory: ts.sys.getCurrentDirectory,
    getNewLine: () => ts.sys.newLine,
  };
}

function writeDiagnostic(diagnostic, stream) {
  stream.write(ts.formatDiagnosticsWithColorAndContext([diagnostic], createDiagnosticHost()));
}

function clearDistRequireCache(distRootDirectory, requireFunction) {
  const normalizedDistRoot = path.resolve(distRootDirectory);
  for (const modulePath of Object.keys(requireFunction.cache ?? {})) {
    if (path.resolve(modulePath).startsWith(normalizedDistRoot)) {
      delete requireFunction.cache[modulePath];
    }
  }
}

function assertCompiledServerModule(compiledServerModule, modulePath) {
  if (typeof compiledServerModule?.createServer !== "function") {
    throw new TypeError(`Compiled server module does not export createServer: ${modulePath}`);
  }

  if (typeof compiledServerModule?.createServerListener !== "function") {
    throw new TypeError(`Compiled server module does not export createServerListener: ${modulePath}`);
  }
}

export async function startCompiledServer(options) {
  const { paths, env, stderr, requireFromRoot } = options;

  if (!existsSync(paths.serverCreateServerPath)) {
    stderr.write(`[server-dev] Waiting for compiled server module: ${paths.serverCreateServerPath}\n`);
    return undefined;
  }

  clearDistRequireCache(paths.distRootDirectory, requireFromRoot);
  const compiledServerModule = requireFromRoot(paths.serverCreateServerPath);
  assertCompiledServerModule(compiledServerModule, paths.serverCreateServerPath);

  const createdServer = await compiledServerModule.createServer({
    env,
    restartServer: options.restartServer,
  });
  const listener = compiledServerModule.createServerListener(createdServer);

  await new Promise((resolve, reject) => {
    const handleListenError = (error) => {
      reject(error);
    };

    listener.once("error", handleListenError);
    listener.listen(createdServer.config.port, () => {
      listener.off("error", handleListenError);
      const transport = createdServer.config.security?.httpsEnabled ? "https" : "http";
      void createdServer.loggingPort.log({
        timestamp: new Date().toISOString(),
        level: "info",
        verbosity: "normal",
        event: `server.${transport}.listening`,
        host: "server",
        component: "server-host",
        message: `Server ${transport.toUpperCase()} listener started.`,
        data: {
          port: createdServer.config.port,
          transport,
          storageRootDirectory: createdServer.config.storageRootDirectory,
          runtimeRootDirectory: createdServer.config.runtimeRootDirectory,
        },
      });
      resolve();
    });
  });

  return listener;
}

export function startServerDevRunner(options = {}) {
  const paths = options.paths ?? createServerDevPaths();
  const env = createServerDevEnvironment(options.env ?? process.env);
  const stdout = options.stdout ?? process.stdout;
  const stderr = options.stderr ?? process.stderr;
  const requireFromRoot = createRequire(path.join(paths.repositoryRootDirectory, "package.json"));

  validateServerDevPaths(paths);

  let activeHttpServer;
  let restartQueue = Promise.resolve();
  let isStopping = false;

  const closeActiveServer = async () => {
    const server = activeHttpServer;
    activeHttpServer = undefined;
    if (!server) {
      return;
    }

    await new Promise((resolve, reject) => {
      server.close((error) => {
        if (error) {
          reject(error);
          return;
        }
        resolve();
      });
    });
  };

  const restartCompiledServer = () => {
    restartQueue = restartQueue
      .then(async () => {
        if (isStopping) {
          return;
        }

        await closeActiveServer();
        activeHttpServer = await startCompiledServer({
          paths,
          env,
          stderr,
          requireFromRoot,
          restartServer: restartCompiledServer,
        });
      })
      .catch((error) => {
        const message = error instanceof Error ? error.stack ?? error.message : String(error);
        stderr.write(`[server-dev] Failed to restart server after compile.\n${message}\n`);
      });
  };

  const stopCompiledServer = () => {
    restartQueue = restartQueue
      .then(() => closeActiveServer())
      .catch((error) => {
        const message = error instanceof Error ? error.stack ?? error.message : String(error);
        stderr.write(`[server-dev] Failed to stop server after compile failure.\n${message}\n`);
      });
  };

  const host = ts.createWatchCompilerHost(
    paths.serverTsconfigPath,
    {},
    ts.sys,
    ts.createSemanticDiagnosticsBuilderProgram,
    (diagnostic) => writeDiagnostic(diagnostic, stderr),
    (diagnostic) => {
      stdout.write(`${ts.flattenDiagnosticMessageText(diagnostic.messageText, ts.sys.newLine)}${ts.sys.newLine}`);
    },
  );

  const originalAfterProgramCreate = host.afterProgramCreate;
  host.afterProgramCreate = (builderProgram) => {
    originalAfterProgramCreate?.(builderProgram);

    const diagnostics = ts
      .getPreEmitDiagnostics(builderProgram.getProgram())
      .filter((diagnostic) => diagnostic.category === ts.DiagnosticCategory.Error);

    if (diagnostics.length > 0) {
      stopCompiledServer();
      return;
    }

    restartCompiledServer();
  };

  const watchProgram = ts.createWatchProgram(host);

  const stop = () => {
    isStopping = true;
    watchProgram.close();
    void closeActiveServer();
  };

  return {
    stop,
    watchProgram,
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const runner = startServerDevRunner();
  process.once("SIGINT", runner.stop);
  process.once("SIGTERM", runner.stop);
}
