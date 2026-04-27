import { describe, expect, it, testDouble } from "../../../../testing/node-test";

import {
  DESKTOP_APPLICATION_SETTINGS_CLEAR_REQUEST_CHANNEL,
  DESKTOP_APPLICATION_SETTINGS_LIST_DEFINITIONS_REQUEST_CHANNEL,
  DESKTOP_APPLICATION_SETTINGS_READ_REQUEST_CHANNEL,
  DESKTOP_APPLICATION_SETTINGS_READ_RESPONSE_CHANNEL,
  DESKTOP_APPLICATION_SETTINGS_RESOLVE_MODEL_DEFAULT_REQUEST_CHANNEL,
  DESKTOP_APPLICATION_SETTINGS_UPDATE_REQUEST_CHANNEL,
  createDesktopApplicationSettingsReadRequest,
} from "../../../../contracts/ipc";
import {
  createReadApplicationSettingsIpcHandler,
  registerApplicationSettingsIpc,
} from "../settings/registerApplicationSettingsIpc";

describe("registerApplicationSettingsIpc", () => {
  it("registers all application settings channels", () => {
    const channels: string[] = [];
    registerApplicationSettingsIpc({
      ipcMain: { handle: testDouble.fn((channel: string) => channels.push(channel)) },
      listSettingsDefinitionsUseCase: { execute: testDouble.fn() },
      readSettingsUseCase: { execute: testDouble.fn() },
      updateSettingUseCase: { execute: testDouble.fn() },
      clearSettingUseCase: { execute: testDouble.fn() },
      resolveModelDefaultUseCase: { execute: testDouble.fn() },
    });

    expect(channels).toEqual([
      DESKTOP_APPLICATION_SETTINGS_LIST_DEFINITIONS_REQUEST_CHANNEL.value,
      DESKTOP_APPLICATION_SETTINGS_READ_REQUEST_CHANNEL.value,
      DESKTOP_APPLICATION_SETTINGS_UPDATE_REQUEST_CHANNEL.value,
      DESKTOP_APPLICATION_SETTINGS_CLEAR_REQUEST_CHANNEL.value,
      DESKTOP_APPLICATION_SETTINGS_RESOLVE_MODEL_DEFAULT_REQUEST_CHANNEL.value,
    ]);
  });

  it("maps read handler to use case", async () => {
    const execute = testDouble.fn().mockResolvedValue([{ key: "huggingface.token", configured: true, masked: true, maskedValue: "********" }]);
    const handler = createReadApplicationSettingsIpcHandler({ execute });
    const response = await handler({}, createDesktopApplicationSettingsReadRequest({ keys: ["huggingface.token"] }));

    expect(execute).toHaveBeenCalledWith({ keys: ["huggingface.token"] });
    expect(response.ok).toBe(true);
  });

  it("maps read handler errors to the application settings read failure envelope", async () => {
    const handler = createReadApplicationSettingsIpcHandler({
      execute: testDouble.fn(async () => {
        throw new Error("settings unavailable");
      }),
    });

    const response = await handler({}, createDesktopApplicationSettingsReadRequest(
      { keys: ["huggingface.token"] },
      { requestId: "req-settings-read", correlationId: "corr-settings-read" },
    ));

    expect(response).toMatchObject({
      ok: false,
      channel: DESKTOP_APPLICATION_SETTINGS_READ_RESPONSE_CHANNEL.value,
      requestId: "req-settings-read",
      correlationId: "corr-settings-read",
      error: {
        code: "internal",
        message: "settings unavailable",
      },
    });
  });
});
