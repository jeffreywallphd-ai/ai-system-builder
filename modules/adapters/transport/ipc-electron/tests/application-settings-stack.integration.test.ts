import { describe, expect, it, testDouble } from "../../../../testing/node-test";

import { createLocalApplicationSettingsAdapter, createInMemorySecretsAdapter } from "../../../persistence/settings";
import {
  ClearSettingUseCase,
  ListSettingsDefinitionsUseCase,
  ReadSettingsUseCase,
  ResolveModelDefaultUseCase,
  UpdateSettingUseCase,
} from "../../../../application/use-cases";
import { DefaultModelDefaultResolver } from "../../../../application/services/settings";
import {
  createDesktopApplicationSettingsClearRequest,
  createDesktopApplicationSettingsReadRequest,
  createDesktopApplicationSettingsResolveModelDefaultRequest,
  createDesktopApplicationSettingsUpdateRequest,
  DESKTOP_APPLICATION_SETTINGS_CLEAR_REQUEST_CHANNEL,
  DESKTOP_APPLICATION_SETTINGS_READ_REQUEST_CHANNEL,
  DESKTOP_APPLICATION_SETTINGS_RESOLVE_MODEL_DEFAULT_REQUEST_CHANNEL,
  DESKTOP_APPLICATION_SETTINGS_UPDATE_REQUEST_CHANNEL,
} from "../../../../contracts/ipc";
import { registerApplicationSettingsIpc } from "../settings/registerApplicationSettingsIpc";

function createIpcRegistry() {
  const handlers = new Map<string, (event: unknown, request: unknown) => Promise<unknown>>();

  const ipcMain = {
    handle: testDouble.fn((channel: string, listener: (event: unknown, request: unknown) => Promise<unknown>) => {
      handlers.set(channel, listener);
    }),
  };

  return { ipcMain, handlers };
}

describe("application settings ipc integration", () => {
  it("masks secrets end-to-end and clears from secret store", async () => {
    const settings = createLocalApplicationSettingsAdapter({ filePath: "/tmp/ai-system-builder/test-app-settings.json" });
    const secrets = createInMemorySecretsAdapter();
    const resolver = new DefaultModelDefaultResolver({ settings });

    const { ipcMain, handlers } = createIpcRegistry();
    registerApplicationSettingsIpc({
      ipcMain,
      listSettingsDefinitionsUseCase: new ListSettingsDefinitionsUseCase({ settings }),
      readSettingsUseCase: new ReadSettingsUseCase({ settings, secrets }),
      updateSettingUseCase: new UpdateSettingUseCase({ settings, secrets }),
      clearSettingUseCase: new ClearSettingUseCase({ settings, secrets }),
      resolveModelDefaultUseCase: new ResolveModelDefaultUseCase({ modelDefaultResolver: resolver }),
    });

    const updateHandler = handlers.get(DESKTOP_APPLICATION_SETTINGS_UPDATE_REQUEST_CHANNEL.value);
    const readHandler = handlers.get(DESKTOP_APPLICATION_SETTINGS_READ_REQUEST_CHANNEL.value);
    const clearHandler = handlers.get(DESKTOP_APPLICATION_SETTINGS_CLEAR_REQUEST_CHANNEL.value);
    expect(updateHandler).toBeDefined();
    expect(readHandler).toBeDefined();
    expect(clearHandler).toBeDefined();

    await updateHandler?.({}, createDesktopApplicationSettingsUpdateRequest({ key: "huggingface.token", value: "hf_secret_123" }));

    const readResponse = await readHandler?.({}, createDesktopApplicationSettingsReadRequest({ keys: ["huggingface.token"] })) as {
      ok: boolean;
      value?: { values: Array<{ configured: boolean; masked?: boolean; maskedValue?: string; value?: unknown }> };
    };
    expect(readResponse.ok).toBe(true);
    expect(readResponse.value?.values[0]).toEqual({
      key: "huggingface.token",
      configured: true,
      masked: true,
      maskedValue: "********",
    });

    await clearHandler?.({}, createDesktopApplicationSettingsClearRequest({ key: "huggingface.token" }));
    expect(await secrets.hasSecret("huggingface.token")).toBe(false);
  });

  it("resolves model defaults through ipc with source and inferenceMode", async () => {
    const settings = createLocalApplicationSettingsAdapter({ filePath: "/tmp/ai-system-builder/test-app-settings-models.json" });
    const secrets = createInMemorySecretsAdapter();
    const resolver = new DefaultModelDefaultResolver({ settings });
    const { ipcMain, handlers } = createIpcRegistry();

    registerApplicationSettingsIpc({
      ipcMain,
      listSettingsDefinitionsUseCase: new ListSettingsDefinitionsUseCase({ settings }),
      readSettingsUseCase: new ReadSettingsUseCase({ settings, secrets }),
      updateSettingUseCase: new UpdateSettingUseCase({ settings, secrets }),
      clearSettingUseCase: new ClearSettingUseCase({ settings, secrets }),
      resolveModelDefaultUseCase: new ResolveModelDefaultUseCase({ modelDefaultResolver: resolver }),
    });

    const handler = handlers.get(DESKTOP_APPLICATION_SETTINGS_RESOLVE_MODEL_DEFAULT_REQUEST_CHANNEL.value);
    const response = await handler?.({}, createDesktopApplicationSettingsResolveModelDefaultRequest({ taskKey: "qaGeneration" })) as {
      ok: boolean;
      value?: { resolved: { inferenceMode: string; source: string } };
    };

    expect(response.ok).toBe(true);
    expect(response.value?.resolved.inferenceMode).toBe("text2text");
    expect(["task", "global", "builtin"]).toContain(response.value?.resolved.source);
  });
});
