import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it, testDouble } from "../../../../testing/node-test";
import type { IpcMainHandlePort } from "../../../../adapters/transport/ipc-electron/ipcMainHandlePort";
import { composeDesktopHost } from "../composeDesktopHost";
import {
  DESKTOP_ARTIFACT_BROWSE_REQUEST_CHANNEL,
  DESKTOP_ASSET_DEFINITIONS_LIST_REQUEST_CHANNEL,
  DESKTOP_COMFYUI_INSTALL_STATUS_READ_REQUEST_CHANNEL,
  DESKTOP_DATASET_PREPARE_TRAINING_START_REQUEST_CHANNEL,
  DESKTOP_FEATURE_LIFECYCLE_STATE_READ_REQUEST_CHANNEL,
  createDesktopFeatureLifecycleStateReadRequest,
  DESKTOP_HUGGING_FACE_NAMESPACE_DATASETS_BROWSE_REQUEST_CHANNEL,
  DESKTOP_IMAGE_GENERATION_START_REQUEST_CHANNEL,
  DESKTOP_INGEST_WEBSITE_PAGE_REQUEST_CHANNEL,
  DESKTOP_MODEL_LIST_REQUEST_CHANNEL,
  DESKTOP_WORKSPACE_CREATE_REQUEST_CHANNEL,
  DESKTOP_WORKSPACE_LIST_REQUEST_CHANNEL,
  DESKTOP_WORKSPACE_SELECTION_READ_REQUEST_CHANNEL,
  createDesktopArtifactBrowseRequest,
  createDesktopAssetDefinitionsListRequest,
  createDesktopComfyUiInstallStatusRequest,
  createDesktopHuggingFaceNamespaceDatasetsBrowseRequest,
  createDesktopImageGenerationStartRequest,
  createDesktopIngestWebsitePageRequest,
  createDesktopModelListRequest,
  createDesktopPrepareTrainingDatasetStartRequest,
  createDesktopWorkspaceCreateRequest,
  createDesktopWorkspaceListRequest,
  createDesktopWorkspaceSelectionReadRequest,
} from "../../../../contracts/ipc";

type Handler = (event: unknown, request: unknown) => Promise<unknown> | unknown;

function createIpcHarness() {
  const handlers = new Map<string, Handler>();
  const ipcMain = {
    handle: testDouble.fn((channel: string, handler: Handler) => {
      handlers.set(channel, handler);
    }),
  };
  return {
    ipcMain: ipcMain as unknown as IpcMainHandlePort & typeof ipcMain,
    handlers,
    invoke(channel: string, request: unknown) {
      const handler = handlers.get(channel);
      if (!handler) {
        throw new Error(`No handler registered for ${channel}.`);
      }
      return handler({}, request);
    },
  };
}

async function composeRegisteredHost() {
  const storageRootDirectory = await mkdtemp(join(tmpdir(), "desktop-lazy-startup-storage-"));
  const runtimeRootDirectory = await mkdtemp(join(tmpdir(), "desktop-lazy-startup-runtime-"));
  const harness = createIpcHarness();
  const host = composeDesktopHost({
    artifactRepo: {
      huggingFaceTokenConfigFilePath: join(storageRootDirectory, "config", "hf-token.json"),
      huggingFaceFetchImplementation: testDouble.fn(async () => new Response(null, { status: 404 })) as unknown as typeof fetch,
    },
    settings: {
      localSettingsFilePath: join(storageRootDirectory, "config", "settings.json"),
    },
  });
  host.registerDesktopIpc({
    ipcMain: harness.ipcMain,
    senderTrust: { isTrustedSender: () => true },
    storageRootDirectory,
    runtimeRootDirectory,
  });
  return { host, storageRootDirectory, runtimeRootDirectory, ...harness };
}

async function captureMemoryMilestones<T>(run: () => T | Promise<T>): Promise<{ result: T; milestones: string[] }> {
  const previous = process.env.DESKTOP_MEMORY_DIAGNOSTICS;
  process.env.DESKTOP_MEMORY_DIAGNOSTICS = "1";
  const lines: string[] = [];
  const original = console.log;
  console.log = (line?: unknown) => {
    if (typeof line === "string") {
      lines.push(line);
    }
  };
  try {
    const result = await run();
    return { result, milestones: lines.map((line) => JSON.parse(line).milestone as string) };
  } finally {
    console.log = original;
    if (previous === undefined) {
      delete process.env.DESKTOP_MEMORY_DIAGNOSTICS;
    } else {
      process.env.DESKTOP_MEMORY_DIAGNOSTICS = previous;
    }
  }
}

const deferredMilestones = [
  "desktop.host.artifact-features.import.before",
  "desktop.host.artifact-features.compose.before",
  "desktop.host.artifact-remote-features.import.before",
  "desktop.host.artifact-remote-features.compose.before",
  "desktop.host.asset-features.import.before",
  "desktop.host.asset-features.compose.before",
  "desktop.host.model-features.import.before",
  "desktop.host.model-features.compose.before",
  "desktop.host.image-generation-features.import.before",
  "desktop.host.image-generation-features.compose.before",
  "desktop.host.ingestion-features.import.before",
  "desktop.host.ingestion-features.compose.before",
  "desktop.host.dataset-preparation-features.import.before",
  "desktop.host.dataset-preparation-features.compose.before",
  "desktop.host.comfyui-install-features.import.before",
  "desktop.host.comfyui-install-features.compose.before",
  "desktop.host.comfyui-image-runtime-features.import.before",
  "desktop.host.comfyui-image-runtime-features.compose.before",
  "desktop.host.runtime-task-features.import.before",
  "desktop.host.runtime-task-features.compose.before",
  "desktop.host.python-runtime-foundation.import.before",
  "desktop.host.python-runtime-foundation.compose.before",
];

describe("desktop startup lazy composition contract", () => {
  it("registers the IPC surface without composing deferred feature groups", async () => {
    const storageRootDirectory = await mkdtemp(join(tmpdir(), "desktop-lazy-registration-storage-"));
    const runtimeRootDirectory = await mkdtemp(join(tmpdir(), "desktop-lazy-registration-runtime-"));
    const harness = createIpcHarness();

    const { result, milestones } = await captureMemoryMilestones(() => {
      const host = composeDesktopHost({
        artifactRepo: { huggingFaceTokenConfigFilePath: join(storageRootDirectory, "config", "hf-token.json") },
        settings: { localSettingsFilePath: join(storageRootDirectory, "config", "settings.json") },
      });
      host.registerDesktopIpc({
        ipcMain: harness.ipcMain,
        senderTrust: { isTrustedSender: () => true },
        storageRootDirectory,
        runtimeRootDirectory,
      });
      return host;
    });

    expect(result.getInternalAssetRegistry()).toBeUndefined();
    expect(harness.ipcMain.handle.mock.calls.length >= 65).toBe(true);
    expect(harness.handlers.has("effective-asset-projections:list")).toBe(true);
    expect(harness.handlers.has("effective-asset-projections:read")).toBe(true);
    expect(milestones).toContain("desktop.host.startup-workspace-shell.compose.before");
    expect(milestones).toContain("desktop.host.startup-workspace-shell.compose.after");
    expect(milestones).toContain("desktop.host.ipc-registration.lazy-handlers.before");
    expect(milestones).toContain("desktop.host.ipc-registration.lazy-handlers.after");
    for (const group of ["startup", "artifact", "asset", "model", "image-generation", "runtime", "ingestion", "dataset-preparation", "asset-authoring", "user-library", "effective-asset-projections"]) {
      expect(milestones).toContain(`desktop.host.ipc.${group}-group.register.before`);
      expect(milestones).toContain(`desktop.host.ipc.${group}-group.register.after`);
    }
    for (const milestone of deferredMilestones) {
      expect(milestones).not.toContain(milestone);
    }
  });

  it("serves effective asset projection reads through the desktop host IPC surface", async () => {
    const harness = await composeRegisteredHost();

    const result = await harness.invoke("effective-asset-projections:list", {
      payload: {
        targetWorkspaceId: "workspace.projections",
        status: "ready",
      },
    });

    expect((result as { ok: boolean }).ok).toBe(true);
    expect((result as { value: { summaries: unknown[] } }).value.summaries).toEqual([]);
  });


  it("reads lifecycle diagnostics without composing deferred feature groups", async () => {
    const harness = await composeRegisteredHost();
    const { milestones, result } = await captureMemoryMilestones(() => harness.invoke(DESKTOP_FEATURE_LIFECYCLE_STATE_READ_REQUEST_CHANNEL.value, createDesktopFeatureLifecycleStateReadRequest({ boundary: { host: "desktop", source: "test" } })));

    expect((result as { ok: boolean }).ok).toBe(true);
    const entries = (result as { value: { entries: Array<{ featureKey: string; loaded: boolean }> } }).value.entries;
    const featureKeys = entries.map((entry) => entry.featureKey);
    for (const expectedFeatureKey of ["artifact-local", "model-registry", "image-generation", "comfyui-image-runtime", "runtime-task-registry"]) {
      expect(featureKeys.includes(expectedFeatureKey)).toBe(true);
    }
    expect(entries.every((entry) => entry.loaded === false)).toBe(true);
    for (const milestone of deferredMilestones) {
      expect(milestones).not.toContain(milestone);
    }
  });

  it("supports workspace list/create/selection through the startup workspace shell", async () => {
    const harness = await composeRegisteredHost();

    const emptyList = await harness.invoke(DESKTOP_WORKSPACE_LIST_REQUEST_CHANNEL.value, createDesktopWorkspaceListRequest({}));
    expect((emptyList as { ok: boolean; value: { workspaces: unknown[] } }).ok).toBe(true);
    expect((emptyList as { value: { workspaces: unknown[] } }).value.workspaces).toEqual([]);

    const created = await harness.invoke(DESKTOP_WORKSPACE_CREATE_REQUEST_CHANNEL.value, createDesktopWorkspaceCreateRequest({
      command: { displayName: "Lazy Startup Workspace", includeSystemFoundationAssets: false },
      selectAfterCreate: true,
    }));
    expect((created as { ok: boolean }).ok).toBe(true);

    const selection = await harness.invoke(DESKTOP_WORKSPACE_SELECTION_READ_REQUEST_CHANNEL.value, createDesktopWorkspaceSelectionReadRequest());
    expect((selection as { ok: boolean; value: { workspaceId?: string } }).ok).toBe(true);
    expect(Boolean((selection as { value: { workspaceId?: string } }).value.workspaceId)).toBe(true);
  });

  it("composes model features on the first model request and memoizes them", async () => {
    const harness = await composeRegisteredHost();
    const { milestones: firstMilestones } = await captureMemoryMilestones(() => harness.invoke(DESKTOP_MODEL_LIST_REQUEST_CHANNEL.value, createDesktopModelListRequest({})));
    const { milestones: secondMilestones } = await captureMemoryMilestones(() => harness.invoke(DESKTOP_MODEL_LIST_REQUEST_CHANNEL.value, createDesktopModelListRequest({})));

    expect(firstMilestones).toContain("desktop.host.model-features.compose.before");
    expect(firstMilestones).toContain("desktop.host.model-features.compose.after");
    expect(firstMilestones).not.toContain("desktop.host.comfyui-image-runtime-features.compose.before");
    expect(firstMilestones).not.toContain("desktop.host.runtime-task-features.compose.before");
    expect(secondMilestones).not.toContain("desktop.host.model-features.compose.before");
  });

  it("composes remote artifact, ingestion, and dataset-preparation groups only on first relevant requests", async () => {
    const harness = await composeRegisteredHost();

    const { milestones: remoteMilestones } = await captureMemoryMilestones(() => harness.invoke(DESKTOP_HUGGING_FACE_NAMESPACE_DATASETS_BROWSE_REQUEST_CHANNEL.value, createDesktopHuggingFaceNamespaceDatasetsBrowseRequest({
      namespace: "ai-system-builder-test",
      boundary: { host: "desktop", source: "test" },
    })));
    expect(remoteMilestones).toContain("desktop.host.artifact-remote-features.compose.before");
    expect(remoteMilestones).toContain("desktop.host.artifact-features.compose.before");
    expect(remoteMilestones).not.toContain("desktop.host.model-features.compose.before");

    const { milestones: ingestionMilestones } = await captureMemoryMilestones(() => harness.invoke(DESKTOP_INGEST_WEBSITE_PAGE_REQUEST_CHANNEL.value, createDesktopIngestWebsitePageRequest({
      request: { url: "https://example.com/page" },
      boundary: { host: "desktop", source: "test" },
    })));
    expect(ingestionMilestones).toContain("desktop.host.ingestion-features.compose.before");
    expect(ingestionMilestones).not.toContain("desktop.host.model-features.compose.before");

    const { milestones: datasetMilestones } = await captureMemoryMilestones(() => harness.invoke(DESKTOP_DATASET_PREPARE_TRAINING_START_REQUEST_CHANNEL.value, createDesktopPrepareTrainingDatasetStartRequest({
      command: {
        sourceArtifactIds: ["artifact.dataset-source"],
        recipe: {
          normalization: { targetFormat: "markdown" },
          chunking: { strategy: "character", chunkSize: 1000, chunkOverlap: 100 },
          generation: { mode: "qa", model: { provider: "transformers", modelId: "test-model" } },
        },
        split: { trainRatio: 0.8, testRatio: 0.2 },
        output: { format: "jsonl" },
      },
      boundary: { host: "desktop", source: "test" },
    })));
    expect(datasetMilestones).toContain("desktop.host.dataset-preparation-features.compose.before");
    expect(datasetMilestones).toContain("desktop.host.runtime-task-features.compose.before");
    expect(datasetMilestones).not.toContain("desktop.host.image-generation-features.compose.before");
  });

  it("composes image-generation, artifact, and ComfyUI feature groups only on first relevant requests", async () => {
    const harness = await composeRegisteredHost();

    const { milestones: artifactMilestones } = await captureMemoryMilestones(() => harness.invoke(DESKTOP_ARTIFACT_BROWSE_REQUEST_CHANNEL.value, createDesktopArtifactBrowseRequest({
        workspaceId: "workspace.lazy-startup",
        boundary: { host: "desktop", source: "test" },
      })));
    expect(artifactMilestones).toContain("desktop.host.artifact-features.compose.before");
    expect(artifactMilestones).not.toContain("desktop.host.artifact-remote-features.compose.before");

    const { milestones: assetMilestones } = await captureMemoryMilestones(() => harness.invoke(DESKTOP_ASSET_DEFINITIONS_LIST_REQUEST_CHANNEL.value, createDesktopAssetDefinitionsListRequest({
      boundary: { host: "desktop", source: "test" },
    })));
    expect(assetMilestones).toContain("desktop.host.asset-features.compose.before");
    expect(assetMilestones).not.toContain("desktop.host.model-features.compose.before");

    const { milestones: imageMilestones } = await captureMemoryMilestones(() => harness.invoke(DESKTOP_IMAGE_GENERATION_START_REQUEST_CHANNEL.value, createDesktopImageGenerationStartRequest({ prompt: "cat" })));
    expect(imageMilestones).toContain("desktop.host.image-generation-features.compose.before");
    expect(imageMilestones).toContain("desktop.host.comfyui-image-runtime-features.compose.before");
    expect(imageMilestones).toContain("desktop.host.runtime-task-features.compose.before");

    const { milestones: comfyUiMilestones } = await captureMemoryMilestones(() => harness.invoke(DESKTOP_COMFYUI_INSTALL_STATUS_READ_REQUEST_CHANNEL.value, createDesktopComfyUiInstallStatusRequest({})));
    expect(comfyUiMilestones).toContain("desktop.host.comfyui-install-features.compose.before");
    expect(comfyUiMilestones).not.toContain("desktop.host.comfyui-image-runtime-features.compose.before");
    expect(comfyUiMilestones).not.toContain("desktop.host.runtime-task-features.compose.before");
  });
});
