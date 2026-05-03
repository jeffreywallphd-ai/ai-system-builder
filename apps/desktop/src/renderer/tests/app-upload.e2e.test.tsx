import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";

import { createLogger, type StructuredLogSink } from "../../../../../modules/adapters/observability/logging";
import { createFilesystemArtifactStorageAdapter } from "../../../../../modules/adapters/storage/filesystem/artifact-store";
import {
  registerElectronIpc,
} from "../../../../../modules/adapters/transport/ipc-electron/registerElectronIpc";
import type { IpcMainHandlePort } from "../../../../../modules/adapters/transport/ipc-electron/ipcMainHandlePort";
import { StoreArtifactUploadUseCase } from "../../../../../modules/application/use-cases";
import { createLoggingConfig } from "../../../../../modules/contracts/config";
import {
  DESKTOP_ARTIFACT_UPLOAD_REQUEST_CHANNEL,
  type DesktopArtifactUploadRequest,
  type DesktopArtifactUploadResponse,
} from "../../../../../modules/contracts/ipc";

import { createDesktopPreloadApi } from "../../preload/exposedApi";
import { App } from "../App";

let tempRoots: string[] = [];

afterEach(async () => {
  await Promise.all(
    tempRoots.map(async (root) => {
      await rm(root, { recursive: true, force: true });
    }),
  );
  tempRoots = [];
  delete window.desktopApi;
});

async function createTempRoot(): Promise<string> {
  const root = await mkdtemp(path.join(os.tmpdir(), "desktop-upload-e2e-"));
  tempRoots.push(root);
  return root;
}

function setInputFiles(input: HTMLInputElement, files: File[]): void {
  Object.defineProperty(input, "files", {
    configurable: true,
    value: files,
  });

  input.dispatchEvent(new Event("change", { bubbles: true }));
}

describe("desktop artifact upload end-to-end", () => {
  it("uploads from renderer UI through preload and IPC into real filesystem storage with structured success", async () => {
    const rootDirectory = await createTempRoot();
    const logEvents: string[] = [];
    const sink: StructuredLogSink = (_serializedEvent, event) => {
      logEvents.push(event.event);
    };

    const logger = createLogger({
      config: createLoggingConfig({
        level: "trace",
        verbosity: "trace",
      }),
      host: "desktop",
      component: "desktop-e2e-test",
      sink,
      now: () => "2026-04-14T12:00:00.000Z",
    });

    const useCase = new StoreArtifactUploadUseCase({
      storage: createFilesystemArtifactStorageAdapter({
        rootDirectory,
        logging: logger,
        now: () => "2026-04-14T12:00:00.000Z",
        randomSuffix: () => "e2e",
      }),
      logging: logger,
      now: () => "2026-04-14T12:00:00.000Z",
    });

    let uploadHandler:
      | ((event: unknown, request: DesktopArtifactUploadRequest) => Promise<DesktopArtifactUploadResponse>)
      | undefined;

    const ipcMain: IpcMainHandlePort = {
      handle(channel: string, listener) {
        if (channel === DESKTOP_ARTIFACT_UPLOAD_REQUEST_CHANNEL.value) {
          uploadHandler = listener;
        }
      },
    };

    const unavailableResult = {
      ok: false as const,
      error: {
        code: "unavailable" as const,
        message: "artifact browser disabled in upload-only e2e",
      },
    };

    registerElectronIpc({
      ipcMain,
      pythonRuntime: {
        startPythonRuntime: async () => undefined,
        stopPythonRuntime: async () => undefined,
        restartPythonRuntime: async () => undefined,
        unloadPythonRuntimeModel: async () => undefined,
        clearPythonRuntimeLogs: async () => undefined,
        readPythonRuntimeStatus: async () => ({
          supervisorStatus: "stopped",
          healthy: false,
          runtimeStatus: "stopped",
          capabilities: [],
          logs: [],
        }),
      },
      getHuggingFaceTokenStatus: () => ({ configured: false }),
      setHuggingFaceToken: () => ({ configured: true, maskedToken: "****0000" }),
      clearHuggingFaceToken: () => ({ configured: false }),
      storeArtifactUploadUseCase: useCase,
      browseArtifactsUseCase: {
        execute: async () => unavailableResult,
      },
      browseUnregisteredArtifactsUseCase: {
        execute: async () => unavailableResult,
      },
      registerUnregisteredArtifactUseCase: {
        execute: async () => unavailableResult,
      },
      deleteUnregisteredArtifactUseCase: {
        execute: async () => unavailableResult,
      },
      deleteRegisteredArtifactUseCase: {
        execute: async () => unavailableResult,
      },
      readArtifactDetailUseCase: {
        execute: async () => unavailableResult,
      },
      readArtifactContentUseCase: {
        execute: async () => unavailableResult,
      },
      artifactMediaViewRetrieval: {
        retrieveArtifactViewerMediaByStorageKey: async () => unavailableResult,
      },
      publishArtifactToRepoUseCase: {
        execute: async () => unavailableResult,
      },
      verifyPublishedArtifactBackingUseCase: {
        execute: async () => unavailableResult,
      },
      verifyImportedArtifactSourceBackingUseCase: {
        execute: async () => unavailableResult,
      },
      registerArtifactFromRepoUseCase: {
        execute: async () => unavailableResult,
      },
      localizeArtifactFromRepoUseCase: {
        execute: async () => unavailableResult,
      },
      browseHuggingFaceNamespaceDatasetsUseCase: {
        execute: async () => unavailableResult,
      },
      browseHuggingFaceDatasetParquetFilesUseCase: {
        execute: async () => unavailableResult,
      },
      ingestWebsitePageUseCase: {
        execute: async () => unavailableResult,
      },
      ingestWebsitePagesBatchUseCase: {
        execute: async () => unavailableResult,
      },
      prepareTrainingDatasetFromArtifactsUseCase: {
        execute: async () => unavailableResult,
      },
    });

    const preloadApi = createDesktopPreloadApi({
      ipcRenderer: {
        invoke: async (channel, request) => {
          if (channel !== DESKTOP_ARTIFACT_UPLOAD_REQUEST_CHANNEL.value || !uploadHandler) {
            throw new Error("Desktop upload IPC handler was not registered.");
          }

          return uploadHandler({}, request as DesktopArtifactUploadRequest);
        },
      },
    });

    window.desktopApi = preloadApi;

    const container = document.createElement("div");
    document.body.appendChild(container);
    const root: Root = createRoot(container);

    try {
      await act(async () => {
        root.render(<App />);
      });

      const artifactsButton = Array.from(container.querySelectorAll("button")).find((button) => button.textContent === "Artifacts");
      await act(async () => {
        artifactsButton?.dispatchEvent(new Event("click", { bubbles: true }));
      });

      const input = container.querySelector("input[type='file']") as HTMLInputElement | null;
      const form = container.querySelector("form") as HTMLFormElement | null;
      expect(input).not.toBeNull();
      expect(form).not.toBeNull();

      const bytes = new Uint8Array([137, 80, 78, 71, 13, 10]);
      const file = new File([bytes], "e2e-cat.png", {
        type: "image/png",
      });

      await act(async () => {
        setInputFiles(input as HTMLInputElement, [file]);
      });

      await act(async () => {
        (form as HTMLFormElement).dispatchEvent(
          new Event("submit", { bubbles: true, cancelable: true }),
        );
      });

      const expectedKey = "uploads/20260414120000000-e2e.png";
      expect(container.textContent).toContain("Stored e2e-cat.png.");
      expect(container.textContent).toContain(expectedKey);
      expect(container.textContent).toContain("image/png");
      expect(container.textContent).toContain("6");

      const writtenBytes = await readFile(path.join(rootDirectory, "uploads", "20260414120000000-e2e.png"));
      expect(new Uint8Array(writtenBytes)).toEqual(bytes);

      expect(logEvents).toContain("application.artifact-upload.store.started");
      expect(logEvents).toContain("application.artifact-upload.store.succeeded");
      expect(logEvents).toContain("storage.filesystem.store.started");
      expect(logEvents).toContain("storage.filesystem.store.succeeded");
    } finally {
      await act(async () => {
        root.unmount();
      });
      container.remove();
    }
  });
});
