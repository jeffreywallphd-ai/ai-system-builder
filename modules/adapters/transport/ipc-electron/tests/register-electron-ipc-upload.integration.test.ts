import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it, testDouble } from "../../../../testing/node-test";

import { StoreArtifactUploadUseCase } from "../../../../application/use-cases";
import { createFilesystemArtifactStorageAdapter } from "../../../storage/filesystem/artifact-store";
import {
  createDesktopArtifactUploadRequest,
  DESKTOP_ARTIFACT_UPLOAD_RESPONSE_CHANNEL,
} from "../../../../contracts/ipc";
import type { LoggingPort } from "../../../../application/ports/logging";
import { createDesktopArtifactUploadIpcHandler } from "../artifact-upload/registerArtifactUploadIpc";

let tempRoots: string[] = [];

afterEach(async () => {
  await Promise.all(
    tempRoots.map(async (root) => {
      await rm(root, { recursive: true, force: true });
    }),
  );
  tempRoots = [];
});

async function createTempRoot(): Promise<string> {
  const root = await mkdtemp(path.join(os.tmpdir(), "ipc-upload-integration-"));
  tempRoots.push(root);
  return root;
}

function createLoggingPort(log = testDouble.fn<LoggingPort["log"]>().mockResolvedValue(undefined)) {
  return {
    log,
  } satisfies LoggingPort;
}

describe("desktop artifact upload IPC integration", () => {
  it("handles a real upload request through IPC -> use case -> filesystem adapter and returns success", async () => {
    const rootDirectory = await createTempRoot();
    const log = testDouble.fn<LoggingPort["log"]>().mockResolvedValue(undefined);
    const useCase = new StoreArtifactUploadUseCase({
      storage: createFilesystemArtifactStorageAdapter({
        rootDirectory,
        logging: createLoggingPort(log),
      }),
      logging: createLoggingPort(log),
      now: () => "2026-04-14T12:00:00.000Z",
    });
    const handler = createDesktopArtifactUploadIpcHandler(useCase);
    const request = createDesktopArtifactUploadRequest(
      {
        fileName: "cat.png",
        mediaType: "image/png",
        bytes: new Uint8Array([137, 80, 78, 71]),
        boundary: {
          host: "desktop",
          source: "desktop.renderer.artifact-upload.form",
        },
      },
      {
        requestId: "req-ipc-integration-1",
        correlationId: "corr-ipc-integration-1",
      },
    );

    const response = await handler({}, request);

    expect(response.ok).toBe(true);
    if (!response.ok) {
      throw new Error("Expected upload success response.");
    }
    expect(response.channel).toBe(DESKTOP_ARTIFACT_UPLOAD_RESPONSE_CHANNEL.value);
    expect(response.operation).toBe("artifact.upload");
    expect(response.requestId).toBe("req-ipc-integration-1");
    expect(response.correlationId).toBe("corr-ipc-integration-1");
    expect(path.isAbsolute(response.value.descriptor.storage.key)).toBe(false);
    expect(response.value.descriptor.storage.mediaType).toBe("image/png");
    expect(response.value.descriptor.storage.sizeBytes).toBe(4);

    const writtenBytes = await readFile(path.join(rootDirectory, ...response.value.descriptor.storage.key.split("/")));
    expect(new Uint8Array(writtenBytes)).toEqual(new Uint8Array([137, 80, 78, 71]));

    const events = log.mock.calls.map(
      ([event]: Parameters<LoggingPort["log"]>) => event.event,
    );
    expect(events).toContain("application.artifact-upload.store.started");
    expect(events).toContain("application.artifact-upload.store.succeeded");
    expect(events).toContain("storage.filesystem.store.started");
    expect(events).toContain("storage.filesystem.store.succeeded");
  });

  it("maps real use-case validation failures to structured IPC failures", async () => {
    const rootDirectory = await createTempRoot();
    const useCase = new StoreArtifactUploadUseCase({
      storage: createFilesystemArtifactStorageAdapter({
        rootDirectory,
      }),
      logging: createLoggingPort(),
      now: () => "2026-04-14T12:00:00.000Z",
    });
    const handler = createDesktopArtifactUploadIpcHandler(useCase);
    const request = createDesktopArtifactUploadRequest(
      {
        fileName: "brochure.zip",
        mediaType: "application/zip",
        bytes: new Uint8Array([1, 2, 3]),
        boundary: {
          host: "desktop",
          source: "desktop.renderer.artifact-upload.form",
        },
      },
      {
        requestId: "req-ipc-integration-2",
        correlationId: "corr-ipc-integration-2",
      },
    );

    const response = await handler({}, request);

    expect(response).toEqual({
      ok: false,
      operation: "artifact.upload",
      channel: "ipc.artifact.upload.response",
      error: {
        code: "validation",
        message: "Artifact type is not accepted: application/zip.",
        details: undefined,
        requestId: "req-ipc-integration-2",
        correlationId: "corr-ipc-integration-2",
        metadata: undefined,
        operation: "artifact.upload",
        channel: "ipc.artifact.upload.response",
      },
      requestId: "req-ipc-integration-2",
      correlationId: "corr-ipc-integration-2",
      metadata: undefined,
    });
  });
});
