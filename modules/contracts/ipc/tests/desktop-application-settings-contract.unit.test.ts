import { describe, expect, it } from "../../../testing/node-test";

import {
  DESKTOP_APPLICATION_SETTINGS_CLEAR_REQUEST_CHANNEL,
  DESKTOP_APPLICATION_SETTINGS_LIST_DEFINITIONS_REQUEST_CHANNEL,
  DESKTOP_APPLICATION_SETTINGS_READ_REQUEST_CHANNEL,
  DESKTOP_APPLICATION_SETTINGS_RESOLVE_MODEL_DEFAULT_REQUEST_CHANNEL,
  DESKTOP_APPLICATION_SETTINGS_UPDATE_REQUEST_CHANNEL,
  createDesktopApplicationSettingsReadRequest,
  createDesktopApplicationSettingsResolveModelDefaultSuccessResponse,
} from "..";

describe("desktop application settings ipc contract", () => {
  it("defines request channels", () => {
    expect(DESKTOP_APPLICATION_SETTINGS_LIST_DEFINITIONS_REQUEST_CHANNEL.value).toBe("ipc.application-settings.list-definitions.request");
    expect(DESKTOP_APPLICATION_SETTINGS_READ_REQUEST_CHANNEL.value).toBe("ipc.application-settings.read.request");
    expect(DESKTOP_APPLICATION_SETTINGS_UPDATE_REQUEST_CHANNEL.value).toBe("ipc.application-settings.update.request");
    expect(DESKTOP_APPLICATION_SETTINGS_CLEAR_REQUEST_CHANNEL.value).toBe("ipc.application-settings.clear.request");
    expect(DESKTOP_APPLICATION_SETTINGS_RESOLVE_MODEL_DEFAULT_REQUEST_CHANNEL.value).toBe("ipc.application-settings.resolve-model-default.request");
  });

  it("creates read request and resolve response envelopes", () => {
    const request = createDesktopApplicationSettingsReadRequest({ keys: ["huggingface.token"] });
    expect(request.payload.keys).toEqual(["huggingface.token"]);

    const response = createDesktopApplicationSettingsResolveModelDefaultSuccessResponse({
      provider: "transformers",
      modelId: "google/flan-t5-small",
      inferenceMode: "text2text",
      source: "builtin",
    });

    expect(response.ok).toBe(true);
    expect(response.value.resolved.inferenceMode).toBe("text2text");
  });
});
