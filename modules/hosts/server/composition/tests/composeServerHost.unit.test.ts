import { existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, expectTypeOf, it, testDouble } from "../../../../testing/node-test";

import type { LoggingPort } from "../../../../application/ports/logging";
import type { StructuredLogEvent } from "../../../../contracts/logging";
import type { HuggingFaceFetchImplementation } from "../../../../adapters/storage/huggingface";

import {
  composeServerHost,
  createServerRuntimeReadinessService,
  resolveServerComfyUiInstallRoot,
  resolveServerComfyUiLaunchPythonExecutable,
  resolveServerComfyUiPythonEnvironmentMode,
  resolveServerComfyUiRuntimeDeviceMode,
  resolveServerPythonRuntimeWorkerDirectory,
} from "../composeServerHost";

describe("composeServerHost", () => {
  it("provides a LoggingPort-backed seam using the real logging adapter", async () => {
    const sink = testDouble.fn();
    const host = composeServerHost({
      logging: {
        verbosity: "verbose",
        level: "debug",
      },
      logSink: sink,
    });

    expectTypeOf(host.loggingPort).toExtend<LoggingPort>();
    expect(host.loggingConfig).toEqual({
      verbosity: "verbose",
      level: "debug",
      includeDiagnostics: undefined,
    });

    const event: StructuredLogEvent = {
      timestamp: "2026-04-14T12:00:00.000Z",
      level: "info",
      verbosity: "normal",
      event: "upload.started",
      message: "Upload started",
      component: "store-artifact-upload-use-case",
      useCase: "store-artifact-upload",
    };

    await host.loggingPort.log(event);

    expect(sink).toHaveBeenCalledOnce();
    const [, emittedEvent] = sink.mock.calls[0] as [string, StructuredLogEvent];
    expect(emittedEvent).toMatchObject({
      event: "upload.started",
      host: "server",
      component: "store-artifact-upload-use-case",
      useCase: "store-artifact-upload",
    });
  });



  it("composes artifact-repo storage with huggingface provider registration", async () => {
    const fetchMock = testDouble.fn(async () => new Response(null, { status: 404 })) as unknown as HuggingFaceFetchImplementation;
    const hubClient = {
      fileExists: testDouble.fn(async () => false),
      uploadFile: testDouble.fn(async () => undefined),
      downloadFile: testDouble.fn(async () => new Response(new Uint8Array([]), { status: 200 })),
    };

    const host = composeServerHost({
      artifactRepo: {
        huggingFaceFetchImplementation: fetchMock,
        huggingFaceHubClient: hubClient,
      },
    });

    const result = await host.artifactRepoStorage.hasArtifactInRepo({
      target: {
        provider: "huggingface",
        repository: "openai/demo-artifacts",
        path: "images/a.png",
      },
    });

    expect(host.artifactRepoStorage).toBeDefined();
    expect(result.ok).toBe(true);
    if (!result.ok) {
      throw new Error("Expected hasArtifactInRepo success result.");
    }
    expect(result.value.exists).toBe(false);
  });

  it("composes top-level artifact repo storage before route-local model management logging exists", async () => {
    const hubClient = {
      fileExists: testDouble.fn(async () => false),
      uploadFile: testDouble.fn(async () => undefined),
      downloadFile: testDouble.fn(async () => new Response(new Uint8Array([]), { status: 200 })),
    };

    const host = composeServerHost({
      artifactRepo: {
        huggingFaceHubClient: hubClient,
      },
    });

    const result = await host.artifactRepoStorage.hasArtifactInRepo({
      target: {
        provider: "huggingface",
        repository: "openai/demo-artifacts",
        path: "images/a.png",
      },
    });

    expect(result.ok).toBe(true);
  });

  it("uses updated host token configuration for Hugging Face store operations", async () => {
    const hubClient = {
      fileExists: testDouble.fn(async () => true),
      uploadFile: testDouble.fn(async () => undefined),
      downloadFile: testDouble.fn(async () => new Response(new Uint8Array([1]), { status: 200 })),
    };
    const host = composeServerHost({
      artifactRepo: {
        huggingFaceHubClient: hubClient,
        huggingFaceTokenConfigFilePath: join(tmpdir(), `server-host-token-${Date.now()}.json`),
      },
    });
    host.setHuggingFaceToken("hf_token_updated");
    await host.artifactRepoStorage.storeArtifactInRepo({
      target: {
        provider: "huggingface",
        repository: "openai/demo-artifacts",
        path: "images/a.png",
      },
      content: new Uint8Array([1, 2, 3]),
    });
    const uploadCall = hubClient.uploadFile.mock.calls[0]?.[0] as { accessToken?: string };
    expect(uploadCall.accessToken).toBe("hf_token_updated");
  });

  it("registers server artifact upload routes using a provided app port without creating express", async () => {
    const app = {
      post: testDouble.fn(),
      get: testDouble.fn(),
      patch: testDouble.fn(),
      delete: testDouble.fn(),
    };
    const artifactRepoFetch = testDouble.fn(async () => new Response(null, { status: 404 })) as unknown as HuggingFaceFetchImplementation;
    const hubClient = {
      fileExists: testDouble.fn(async () => false),
      uploadFile: testDouble.fn(async () => undefined),
      downloadFile: testDouble.fn(async () => new Response(new Uint8Array([]), { status: 200 })),
    };

    const host = composeServerHost({
      artifactRepo: {
        huggingFaceFetchImplementation: artifactRepoFetch,
        huggingFaceHubClient: hubClient,
      },
    });

    const storageRootDirectory = join(tmpdir(), `server-artifact-upload-test-${Date.now()}`);
    const runtimeRootDirectory = join(tmpdir(), `server-runtime-${Date.now()}`);

    host.registerApi({
      app,
      storageRootDirectory,
      runtimeRootDirectory,
    });

    const registeredPaths = app.post.mock.calls.map((call) => call[0]);
    for (const expectedPath of [
      "/api/artifact/upload",
      "/api/artifact/browse",
      "/api/artifact/read",
      "/api/artifact/content/read",
      "/api/artifact/delete",
      "/api/config/huggingface-token",
      "/api/artifact-repo/has",
      "/api/huggingface/namespace/datasets",
      "/api/huggingface/dataset/parquet-files",
      "/api/artifact-repo/store",
      "/api/artifact/publish",
      "/api/artifact/publish/verify",
      "/api/artifact/source/verify",
      "/api/artifact/register-from-repo",
      "/api/artifact/localize-from-repo",
      "/api/model/browse",
      "/api/model/details",
      "/api/model/list",
      "/api/model/reference/save",
      "/api/model/download",
      "/api/model/record/update",
      "/api/model/record/delete",
      "/api/image-generation/start",
      "/api/image-generation/read",
      "/api/image-generation/cancel",
      "/api/image-generation/finalize",
      "/api/image-generation/unload-model",
      "/api/image-generation/runtime-resources",
      "/api/application-settings/list-definitions",
      "/api/application-settings/read",
      "/api/application-settings/update",
      "/api/application-settings/clear",
      "/api/workspaces",
      "/api/workspaces/active-selection",
      "/api/workspaces/active-selection/clear",
      "/api/user-library/assets/promote",
      "/api/user-library/workspace-links",
      "/api/workspaces/:workspaceId/user-library/copies",
      "/api/workspaces/:targetWorkspaceId/imports/workspace-asset",
      "/api/assets/register-resource-backed-view",
      "/api/assets/finalize-generated-output",
      "/api/assets/import-external-repository-object",
      "/api/assets/localize-external-repository-object",
      "/api/server/restart",
    ]) {
      expect(registeredPaths).toContain(expectedPath);
    }
    expect(registeredPaths.filter((path) => String(path).startsWith("/api/assets"))).toEqual([
      "/api/assets/register-resource-backed-view",
      "/api/assets/finalize-generated-output",
      "/api/assets/import-external-repository-object",
      "/api/assets/localize-external-repository-object",
    ]);
    expect(existsSync(join(storageRootDirectory, "asset-kernel", "manifest.json"))).toBe(true);
    expect(existsSync(join(runtimeRootDirectory, "asset-kernel", "manifest.json"))).toBe(false);
    const internalRegistry = host.getInternalAssetRegistry();
    expect(internalRegistry).toBeDefined();
    expect(internalRegistry?.resourceBackedViewProvider).toBeDefined();
    expect(internalRegistry?.diagnostics.resourceBackedViewsEnabled).toBe(true);
    const resourceBacked = await internalRegistry?.readFacade.listResourceBackedViewCards({ limit: 10 });
    expect(resourceBacked?.items).toEqual([]);
    expect(resourceBacked?.diagnostics?.some((diagnostic) => diagnostic.code.includes("source-unavailable") || diagnostic.code.includes("unsupported") || diagnostic.code.includes("workspace"))).toBe(true);
    const missingResourceBackedDetail = await internalRegistry!.readFacade.readResourceBackedViewDetail("asset-view.image.internal.missing");
    expect(missingResourceBackedDetail).toBeUndefined();
    expect(artifactRepoFetch).not.toHaveBeenCalled();
    expect(hubClient.fileExists).not.toHaveBeenCalled();
    expect(hubClient.uploadFile).not.toHaveBeenCalled();
    expect(hubClient.downloadFile).not.toHaveBeenCalled();
    expect(existsSync(join(runtimeRootDirectory, "asset-kernel", "manifest.json"))).toBe(false);
    expect(
      await internalRegistry?.readFacade.listDefinitionCards({ includeBuiltIns: true, includeCustom: true }),
    ).toEqual({ items: [] });
    const registeredGetPaths = app.get.mock.calls.map((call) => call[0]);

    expect(registeredGetPaths).toContain("/api/assets/definitions");
    expect([...registeredPaths, ...app.patch.mock.calls.map((call) => call[0]), ...app.delete.mock.calls.map((call) => call[0])]
      .some((path) => /\/api\/assets.*(create|update|delete|patch|edit|seed|publish|execute|run|scan)/i.test(String(path)))).toBe(false);
    expect(readFileSync(resolve("modules/hosts/server/composition/composeServerHost.ts"), "utf8")).toContain("assetRegistryRead: internalAssetRegistry.readFacade");
    expect(readFileSync(resolve("modules/hosts/server/composition/composeServerHost.ts"), "utf8")).toContain("assetMutationUseCases");
    for (const expectedPath of [
      "/api/artifact/upload/policy",
      "/api/artifact/media/view",
      "/api/config/huggingface-token",
      "/api/workspaces",
      "/api/workspaces/active-selection",
      "/api/user-library/assets",
      "/api/user-library/assets/:assetId",
      "/api/workspaces/:workspaceId/user-library/links",
      "/api/workspaces/:workspaceId/user-library/links/:linkId",
      "/api/workspaces/:workspaceId/effective-asset-sources",
      "/api/assets/definitions",
      "/api/asset-authoring/workspaces/:workspaceId/authored-assets",
      "/api/asset-authoring/workspaces/:workspaceId/authored-assets/:authoredAssetId",
      "/api/asset-authoring/workspaces/:workspaceId/drafts",
      "/api/asset-authoring/workspaces/:workspaceId/drafts/:draftId",
      "/api/asset-authoring/workspaces/:workspaceId/revisions",
      "/api/asset-authoring/workspaces/:workspaceId/revisions/:revisionId",
      "/api/asset-authoring/workspaces/:workspaceId/overrides",
      "/api/asset-authoring/workspaces/:workspaceId/overrides/:overrideId",
      "/api/asset-authoring/workspaces/:workspaceId/effective-summaries",
      "/api/asset-authoring/workspaces/:workspaceId/customization-targets",
      "/api/asset-authoring/workspaces/:workspaceId/customization-targets/:implementationReleaseId",
      "/api/asset-authoring/workspaces/:workspaceId/derived-customizations",
      "/api/asset-authoring/workspaces/:workspaceId/derived-customizations/:customizationId",
      "/api/assets/resource-backed-views",
      "/api/assets/resource-backed-views/:viewId",
      "/api/assets/definitions/:definitionId",
      "/api/assets/definitions/:definitionId/versions/:version",
      "/api/runtime/readiness",
      "/api/runtime/capabilities/:capabilityId",
    ]) {
      expect(registeredGetPaths).toContain(expectedPath);
    }
  });

  it("builds server model-publishing readiness as explicit unavailable, not missing", async () => {
    const service = createServerRuntimeReadinessService({
      pythonSupervisor: { getStatus: () => "ready" },
      readComfyUiSupervisor: () => undefined,
      readComfyUiInstallStatus: async () => "installed" as const,
      now: () => "2026-05-06T00:00:00.000Z",
    });

    const snapshot = await service.getReadinessSnapshot();
    expect(snapshot.capabilities.find((capability) => capability.capabilityId === "model-publishing")).toMatchObject({
      status: "unavailable",
      reason: { code: "runtime.model-publishing.not-implemented", category: "unavailable" },
    });
  });

  it("keeps server model training and validation readiness derived from python-runtime", async () => {
    const service = createServerRuntimeReadinessService({
      pythonSupervisor: { getStatus: () => "failed" },
      readComfyUiSupervisor: () => undefined,
      readComfyUiInstallStatus: async () => "installed" as const,
      now: () => "2026-05-06T00:00:00.000Z",
    });

    const snapshot = await service.getReadinessSnapshot();

    expect(snapshot.capabilities.find((capability) => capability.capabilityId === "model-training")).toMatchObject({
      status: "failed",
      dependencies: [{ capabilityId: "python-runtime", status: "failed" }],
    });
    expect(snapshot.capabilities.find((capability) => capability.capabilityId === "model-validation")).toMatchObject({
      status: "failed",
      dependencies: [{ capabilityId: "python-runtime", status: "failed" }],
    });
    expect(snapshot.capabilities.find((capability) => capability.capabilityId === "model-publishing")).toMatchObject({
      status: "unavailable",
      reason: { code: "runtime.model-publishing.not-implemented" },
    });
  });

  it("wires Hugging Face browse use-cases to the dedicated Hugging Face adapter seam", () => {
    const canonicalSourcePath = resolve("modules/hosts/server/composition/composeServerHost.ts");
    const typeScriptPath = fileURLToPath(new URL("../composeServerHost.ts", import.meta.url));
    const sourcePath = existsSync(canonicalSourcePath)
      ? canonicalSourcePath
      : (existsSync(typeScriptPath) ? typeScriptPath : typeScriptPath.replace(/\.ts$/, ".js"));
    const source = readFileSync(sourcePath, "utf8");

    expect(source).toMatchObject(
      expect.stringMatching(
        /const\s+huggingFaceArtifactRepoStorage\s*=\s*createHuggingFaceArtifactRepoStorageAdapter/,
      ),
    );
    expect(source).toContain("adapter: huggingFaceArtifactRepoStorage");
    expect(source).toContain("repoBrowser: huggingFaceArtifactRepoStorage");
    expect(source).not.toContain("repoBrowser: artifactRepoStorage");
  });

  it("throws clear error for invalid COMFYUI runtime mode", () => {
    const previous = process.env.COMFYUI_RUNTIME_DEVICE_MODE;
    process.env.COMFYUI_RUNTIME_DEVICE_MODE = "vulkan";
    const host = composeServerHost();
    expect(() => host.registerApi({ app: { post: testDouble.fn(), get: testDouble.fn(), patch: testDouble.fn(), delete: testDouble.fn() }, storageRootDirectory: join(tmpdir(), "server-invalid-runtime") })).toThrow("Unsupported COMFYUI runtime mode");
    process.env.COMFYUI_RUNTIME_DEVICE_MODE = previous;
  });

  it("accepts cpu and directml COMFYUI runtime modes", () => {
    const previous = process.env.COMFYUI_RUNTIME_DEVICE_MODE;
    process.env.COMFYUI_RUNTIME_DEVICE_MODE = "cpu";
    expect(() => composeServerHost().registerApi({ app: { post: testDouble.fn(), get: testDouble.fn(), patch: testDouble.fn(), delete: testDouble.fn() }, storageRootDirectory: join(tmpdir(), "server-runtime-cpu") })).not.toThrow();
    process.env.COMFYUI_RUNTIME_DEVICE_MODE = "directml";
    expect(() => composeServerHost().registerApi({ app: { post: testDouble.fn(), get: testDouble.fn(), patch: testDouble.fn(), delete: testDouble.fn() }, storageRootDirectory: join(tmpdir(), "server-runtime-directml") })).not.toThrow();
    process.env.COMFYUI_RUNTIME_DEVICE_MODE = previous;
  });

  it("resolves request-selected server image-generation runtime modes when no env override is set", () => {
    expect(resolveServerComfyUiRuntimeDeviceMode({} as NodeJS.ProcessEnv, "cuda")).toBe("cuda");
    expect(resolveServerComfyUiRuntimeDeviceMode({} as NodeJS.ProcessEnv, "directml")).toBe("directml");
    expect(resolveServerComfyUiRuntimeDeviceMode({} as NodeJS.ProcessEnv, "cpu")).toBe("cpu");
    expect(resolveServerComfyUiRuntimeDeviceMode({} as NodeJS.ProcessEnv, "nvidia")).toBe("cuda");
    expect(resolveServerComfyUiRuntimeDeviceMode({ COMFYUI_RUNTIME_DEVICE_MODE: "cpu" } as NodeJS.ProcessEnv, "cuda")).toBe("cpu");
  });


  it("wires server model download through python runtime instead of unavailable stub", () => {
    const canonicalSourcePath = resolve("modules/hosts/server/composition/composeServerHost.ts");
    const source = readFileSync(canonicalSourcePath, "utf8");
    expect(source).toContain("pythonRuntimeFoundation.runtimePort.ensureModelDownloaded");
    expect(source).toContain("runtime.python.model_download.requested");
    expect(source).toContain("runtime.python.model_download.succeeded");
    expect(source).toContain("runtime.python.model_download.failed");
    expect(source).not.toContain("Model download runtime is unavailable on server host.");
  });

  it("wires server Python runtime supervisor activity into structured logs", () => {
    const canonicalSourcePath = resolve("modules/hosts/server/composition/composeServerHost.ts");
    const source = readFileSync(canonicalSourcePath, "utf8");
    expect(source).toContain("onEvent(event)");
    expect(source).toContain("runtime.python.server.activity");
    expect(source).toContain("classifyPythonRuntimeSupervisorLogLevel");
  });

  it("resolves the server Python runtime worker directory from the repository root when launched from app workspace", () => {
    const workerDirectory = resolveServerPythonRuntimeWorkerDirectory({
      cwd: resolve("apps/server"),
      startDirectory: resolve("dist/modules/hosts/server/composition"),
      exists: (candidate) => candidate === resolve("modules/adapters/runtime/python/worker"),
    });

    expect(workerDirectory).toBe(resolve("modules/adapters/runtime/python/worker"));
  });

  it("keeps explicit server Python runtime worker directory overrides absolute", () => {
    const workerDirectory = resolveServerPythonRuntimeWorkerDirectory({
      configuredWorkerDirectory: "custom/python-worker",
      cwd: resolve("apps/server"),
      exists: () => false,
    });

    expect(workerDirectory).toBe(resolve("apps/server/custom/python-worker"));
  });

  it("passes model-management logger into Hugging Face browse/details adapter", () => {
    const canonicalSourcePath = resolve("modules/hosts/server/composition/composeServerHost.ts");
    const source = readFileSync(canonicalSourcePath, "utf8");
    expect(source).toContain("createHuggingFaceModelBrowseDetailsAdapter({");
    expect(source).toContain("logger: modelManagementLogger");
  });

  it("prepares ComfyUI before synchronizing selected model checkpoints", () => {
    const canonicalSourcePath = resolve("modules/hosts/server/composition/composeServerHost.ts");
    const source = readFileSync(canonicalSourcePath, "utf8");
    expect(source).toContain("createRuntimePreparedModelCheckpointResolver");
    expect(source).toContain("runtime: comfyUiSupervisor");
    expect(source).toContain("modelCheckpointResolver: localModelCheckpointResolver");
  });

  it("wires a command runner into the server ComfyUI installer by default", () => {
    const canonicalSourcePath = resolve("modules/hosts/server/composition/composeServerHost.ts");
    const source = readFileSync(canonicalSourcePath, "utf8");
    expect(source).toContain("const execFileWithTimeout = async");
    expect(source).toMatchObject(
      expect.stringMatching(
        /createGitRuntimeInstallerAdapter\(\{[\s\S]*?logging:\s*loggingPort,[\s\S]*?execFile:\s*execFileWithTimeout,[\s\S]*?\}\)/,
      ),
    );
    expect(source).toContain("execFile: execFileWithTimeout");
  });

});

describe("server runtime/comfy root resolution", () => {
  it("defaults ComfyUI install root under server-runtime sibling, not storage root", () => {
    const { installRoot, source } = resolveServerComfyUiInstallRoot({
      env: {} as NodeJS.ProcessEnv,
      runtimeRootDirectory: "/app/server-runtime",
    });
    expect(installRoot).toBe("/app/server-runtime/runtime-installs/comfyui");
    expect(source).toBe("default-server-runtime-root");
  });

  it("uses SERVER_RUNTIME_ROOT when provided", () => {
    const { installRoot, source } = resolveServerComfyUiInstallRoot({
      env: { SERVER_RUNTIME_ROOT: " /tmp/runtime-root " } as NodeJS.ProcessEnv,
      runtimeRootDirectory: "/app/server-runtime",
    });
    expect(installRoot).toBe(resolve("/tmp/runtime-root", "runtime-installs", "comfyui"));
    expect(source).toBe("SERVER_RUNTIME_ROOT");
  });

  it("ignores COMFYUI_INSTALL_ROOT and keeps server ComfyUI under server runtime root", () => {
    const { installRoot, source } = resolveServerComfyUiInstallRoot({
      env: { SERVER_RUNTIME_ROOT: "/tmp/runtime-root", COMFYUI_INSTALL_ROOT: " /tmp/custom-comfy " } as NodeJS.ProcessEnv,
      runtimeRootDirectory: "/app/server-runtime",
    });
    expect(installRoot).toBe(resolve("/tmp/runtime-root", "runtime-installs", "comfyui"));
    expect(source).toBe("SERVER_RUNTIME_ROOT");
  });
});

describe("server ComfyUI python/runtime resolution", () => {
  it("defaults to managed-venv mode and managed launch executable", () => {
    const mode = resolveServerComfyUiPythonEnvironmentMode({} as NodeJS.ProcessEnv);
    expect(mode).toEqual({ pythonEnvironmentMode: "managed-venv" });
    const launch = resolveServerComfyUiLaunchPythonExecutable({
      installRoot: "/tmp/server-runtime/runtime-installs/comfyui",
      basePythonCommand: "python3",
      pythonEnvironmentMode: mode.pythonEnvironmentMode,
      skipPythonSetup: false,
      platform: "linux",
    });
    expect(launch).toEqual({
      launchPythonExecutable: "/tmp/server-runtime/runtime-installs/comfyui/.venv/bin/python",
      source: "managed-venv",
    });
  });

  it("uses ambient mode and COMFYUI_PYTHON_COMMAND as launch python", () => {
    const mode = resolveServerComfyUiPythonEnvironmentMode({ COMFYUI_PYTHON_ENVIRONMENT_MODE: "ambient" } as NodeJS.ProcessEnv);
    expect(mode.pythonEnvironmentMode).toBe("ambient");
    const launch = resolveServerComfyUiLaunchPythonExecutable({
      installRoot: "/tmp/comfy",
      basePythonCommand: "python3.11",
      pythonEnvironmentMode: mode.pythonEnvironmentMode,
      skipPythonSetup: false,
    });
    expect(launch).toEqual({ launchPythonExecutable: "python3.11", source: "ambient" });
  });

  it("uses base python command when skip python setup is enabled", () => {
    const launch = resolveServerComfyUiLaunchPythonExecutable({
      installRoot: "/tmp/comfy",
      basePythonCommand: "python-custom",
      pythonEnvironmentMode: "managed-venv",
      skipPythonSetup: true,
    });
    expect(launch).toEqual({ launchPythonExecutable: "python-custom", source: "skip-python-setup" });
  });

  it("falls back to managed-venv for invalid environment mode values", () => {
    const mode = resolveServerComfyUiPythonEnvironmentMode({ COMFYUI_PYTHON_ENVIRONMENT_MODE: "global" } as NodeJS.ProcessEnv);
    expect(mode).toEqual({ pythonEnvironmentMode: "managed-venv", invalidValue: "global" });
  });

  it("resolves runtime device mode from COMFYUI_RUNTIME_DEVICE_MODE and COMFYUI_ACCELERATOR", () => {
    expect(resolveServerComfyUiRuntimeDeviceMode({} as NodeJS.ProcessEnv)).toBe("cpu");
    expect(resolveServerComfyUiRuntimeDeviceMode({ COMFYUI_RUNTIME_DEVICE_MODE: "directml" } as NodeJS.ProcessEnv)).toBe("directml");
    expect(resolveServerComfyUiRuntimeDeviceMode({ COMFYUI_ACCELERATOR: "cpu" } as NodeJS.ProcessEnv)).toBe("cpu");
    expect(resolveServerComfyUiRuntimeDeviceMode({ COMFYUI_RUNTIME_DEVICE_MODE: "auto" } as NodeJS.ProcessEnv)).toBe("auto");
    expect(resolveServerComfyUiRuntimeDeviceMode({ COMFYUI_RUNTIME_DEVICE_MODE: "unknown" } as NodeJS.ProcessEnv)).toBe("cpu");
  });

  it("logs structured ComfyUI python/runtime diagnostics", () => {
    const sink = testDouble.fn();
    const host = composeServerHost({ logSink: sink });
    const storageRootDirectory = join(tmpdir(), "server-storage");
    const runtimeRootDirectory = join(tmpdir(), "server-runtime");
    host.registerApi({
      app: { post: testDouble.fn(), get: testDouble.fn(), patch: testDouble.fn(), delete: testDouble.fn() },
      storageRootDirectory,
      runtimeRootDirectory,
    });
    const comfyLog = sink.mock.calls
      .map((call) => call[1] as StructuredLogEvent)
      .find((event) => event.event === "runtime.comfyui.server.configuration");
    const expectedBasePythonCommand = process.platform === "win32" ? "python" : "python3";
    expect(comfyLog?.data).toMatchObject({
      pythonEnvironmentMode: "managed-venv",
      basePythonCommand: expectedBasePythonCommand,
      launchPythonExecutableSource: "managed-venv",
      skipPythonSetup: false,
      skipPythonValidation: false,
      runtimeDeviceMode: "cpu",
      installRootSource: "default-server-runtime-root",
    });
  });

  it("logs server-owned Python worker-sidecar diagnostics without desktop/runtime-root leakage", () => {
    const sink = testDouble.fn();
    const host = composeServerHost({ logSink: sink });
    const storageRootDirectory = join(tmpdir(), "server-storage");
    const runtimeRootDirectory = join(tmpdir(), "server-runtime");
    host.registerApi({
      app: { post: testDouble.fn(), get: testDouble.fn(), patch: testDouble.fn(), delete: testDouble.fn() },
      storageRootDirectory,
      runtimeRootDirectory,
    });
    const pythonLog = sink.mock.calls
      .map((call) => call[1] as StructuredLogEvent)
      .find((event) => event.event === "runtime.python.server.configuration");
    expect(pythonLog?.data).toMatchObject({
      host: "server",
      serverStorageRootDirectory: storageRootDirectory,
      serverRuntimeRootDirectory: runtimeRootDirectory,
      pythonRuntimeMode: "worker-sidecar",
      pythonRuntimeRootDirectory: join(runtimeRootDirectory, "models", "huggingface"),
      pythonRuntimeRootSource: "default-server-runtime-root",
      pythonRuntimeBaseUrl: "http://127.0.0.1:43111",
      pythonRuntimeWorkerDirectory: expect.stringMatching(/modules[\\/]adapters[\\/]runtime[\\/]python[\\/]worker$/),
      pythonRuntimeArgs: ["main.py"],
      taskRegistryOwnership: "server",
    });
    expect(pythonLog?.data).not.toMatchObject({
      pythonRuntimeMode: "ambient-only",
      pythonRuntimeRootDirectory: null,
    });
  });

  it("keeps server host composition free of desktop-host imports", () => {
    const sourcePath = resolve("modules/hosts/server/composition/composeServerHost.ts");
    const source = readFileSync(sourcePath, "utf8");
    expect(source).not.toContain("hosts/desktop");
    expect(source).not.toContain("transport/ipc-electron");
  });

  it("keeps Hugging Face Xet enabled by default while assigning a server-owned Xet cache", () => {
    const sourcePath = resolve("modules/hosts/server/composition/composeServerHost.ts");
    const source = readFileSync(sourcePath, "utf8");

    expect(source).toContain("HF_XET_CACHE");
    expect(source).toContain("joinHostPath(pythonRuntimeRoot, \"xet\")");
    expect(source).not.toContain("HF_HUB_DISABLE_XET: env.HF_HUB_DISABLE_XET ?? \"1\"");
  });
});

describe("server host composition decomposition", () => {
  it("keeps runtime readiness wiring in a focused helper without Express transport imports", () => {
    const hostSource = readFileSync(resolve("modules/hosts/server/composition/composeServerHost.ts"), "utf8");
    const helperSource = readFileSync(resolve("modules/hosts/server/composition/composeServerRuntimeReadiness.ts"), "utf8");

    expect(hostSource).toContain("./composeServerRuntimeReadiness");
    expect(helperSource).toContain("RuntimeReadinessService");
    expect(helperSource).not.toContain("api-express");
    expect(helperSource).not.toContain("registerExpressApi");
  });

  it("keeps image-generation runtime task registry wiring in a focused helper without Express transport imports", () => {
    const hostSource = readFileSync(resolve("modules/hosts/server/composition/composeServerHost.ts"), "utf8");
    const helperSource = readFileSync(resolve("modules/hosts/server/composition/composeServerImageGenerationRuntimeTaskRegistry.ts"), "utf8");

    expect(hostSource).toContain("./composeServerImageGenerationRuntimeTaskRegistry");
    expect(helperSource).toContain("createComfyUiImageGenerationRuntimeAdapter");
    expect(helperSource).not.toContain("api-express");
    expect(helperSource).not.toContain("registerExpressApi");
  });
});
