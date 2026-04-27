import { describe, expect, it, testDouble } from "../../../../testing/node-test";

import {
  DESKTOP_ARTIFACT_BROWSE_REQUEST_CHANNEL,
  DESKTOP_ARTIFACT_UPLOAD_REQUEST_CHANNEL,
} from "../../../../contracts/ipc";
import type {
  BrowseArtifactsUseCasePort,
  StoreArtifactUploadUseCasePort,
} from "../../../../application/use-cases";
import { createDesktopArtifactBrowseIpcHandler } from "../artifact-browser/registerArtifactBrowserIpc";
import { createDesktopArtifactUploadIpcHandler } from "../artifact-upload/registerArtifactUploadIpc";
import type { IpcMainHandlePort, IpcMainHandleListener } from "../ipcMainHandlePort";

describe("ipc main handle port contract", () => {
  it("accepts handlers for multiple request/response contract families", () => {
    const handlers = new Map<string, IpcMainHandleListener>();
    const ipcMain: IpcMainHandlePort = {
      handle(channel, listener) {
        handlers.set(channel, listener as IpcMainHandleListener);
      },
    };

    ipcMain.handle(
      DESKTOP_ARTIFACT_UPLOAD_REQUEST_CHANNEL.value,
      createDesktopArtifactUploadIpcHandler({
        execute: testDouble.fn() as StoreArtifactUploadUseCasePort["execute"],
      }),
    );
    ipcMain.handle(
      DESKTOP_ARTIFACT_BROWSE_REQUEST_CHANNEL.value,
      createDesktopArtifactBrowseIpcHandler({
        execute: testDouble.fn() as BrowseArtifactsUseCasePort["execute"],
      }),
    );

    expect(handlers.has(DESKTOP_ARTIFACT_UPLOAD_REQUEST_CHANNEL.value)).toBe(true);
    expect(handlers.has(DESKTOP_ARTIFACT_BROWSE_REQUEST_CHANNEL.value)).toBe(true);
  });
});
