import { describe, expect, it } from "../../../testing/node-test";

import type {
  ApplicationSettingDefinition,
  ApplicationSettingValue,
  UpdateApplicationSettingRequest,
} from "../../../contracts/settings";
import {
  ClearSettingUseCase,
  ReadSettingsUseCase,
  UpdateSettingUseCase,
} from "../settings";
import type { ApplicationSecretsPort, ApplicationSettingsPort } from "../../ports/settings";

const DEFINITIONS: ApplicationSettingDefinition[] = [
  {
    key: "huggingface.token",
    category: "huggingface",
    label: "Token",
    valueKind: "secret",
    sensitive: true,
  },
  {
    key: "models.default",
    category: "models",
    label: "Model",
    valueKind: "object",
  },
];

function createSettingsPort(overrides: Partial<ApplicationSettingsPort> = {}): ApplicationSettingsPort {
  return {
    async listDefinitions() {
      return DEFINITIONS;
    },
    async readValues() {
      return [
        { key: "huggingface.token", configured: false },
        { key: "models.default", configured: true, value: { modelId: "google/flan-t5-small", inferenceMode: "text2text" } },
      ];
    },
    async updateValue(request: UpdateApplicationSettingRequest): Promise<ApplicationSettingValue> {
      return {
        key: request.key,
        configured: true,
        value: request.value,
      };
    },
    async clearValue(request) {
      return {
        key: request.key,
        configured: false,
      };
    },
    ...overrides,
  };
}

function createSecretsPort(overrides: Partial<ApplicationSecretsPort> = {}): ApplicationSecretsPort {
  const map = new Map<string, string>();
  return {
    async setSecret(key, value) {
      map.set(key, value);
    },
    async getSecret(key) {
      return map.get(key);
    },
    async clearSecret(key) {
      map.delete(key);
    },
    async hasSecret(key) {
      return map.has(key);
    },
    ...overrides,
  };
}

describe("settings use cases", () => {
  it("masks secret values when reading settings", async () => {
    const secrets = createSecretsPort({
      async hasSecret(key) {
        return key === "huggingface.token";
      },
    });
    const useCase = new ReadSettingsUseCase({
      settings: createSettingsPort(),
      secrets,
    });

    const values = await useCase.execute();
    const secretValue = values.find((value) => value.key === "huggingface.token");
    expect(secretValue).toEqual({
      key: "huggingface.token",
      configured: true,
      masked: true,
      maskedValue: "********",
    });
  });

  it("routes secret and non-secret setting updates to different ports", async () => {
    let settingsUpdated = false;
    let capturedSecret: string | undefined;

    const settings = createSettingsPort({
      async updateValue(request) {
        settingsUpdated = true;
        return {
          key: request.key,
          configured: true,
          value: request.value,
        };
      },
    });
    const secrets = createSecretsPort({
      async setSecret(_key, value) {
        capturedSecret = value;
      },
    });

    const useCase = new UpdateSettingUseCase({ settings, secrets });

    const secretResult = await useCase.execute({ key: "huggingface.token", value: "hf_abc" });
    const nonSecretResult = await useCase.execute({
      key: "models.default",
      value: { modelId: "google/flan-t5-base", inferenceMode: "text2text" },
    });

    expect(secretResult.maskedValue).toBe("********");
    expect(capturedSecret).toBe("hf_abc");
    expect(nonSecretResult.configured).toBe(true);
    expect(settingsUpdated).toBe(true);
  });

  it("rejects masked placeholder for secret updates and never reads maskedValue as input", async () => {
    const useCase = new UpdateSettingUseCase({ settings: createSettingsPort(), secrets: createSecretsPort() });

    await expect(useCase.execute({ key: "huggingface.token", value: { rawValue: "********" } as never }))
      .rejects.toThrow('Secret setting "huggingface.token" cannot be updated with the masked placeholder value.');
  });

  it("rejects blank and unknown keys for update and clear", async () => {
    const updateUseCase = new UpdateSettingUseCase({ settings: createSettingsPort(), secrets: createSecretsPort() });
    const clearUseCase = new ClearSettingUseCase({ settings: createSettingsPort(), secrets: createSecretsPort() });

    await expect(updateUseCase.execute({ key: "   ", value: "value" })).rejects.toThrow(
      "Setting key must be a non-empty string.",
    );
    await expect(updateUseCase.execute({ key: "unknown.setting", value: "value" })).rejects.toThrow(
      'Unknown setting key "unknown.setting".',
    );
    await expect(clearUseCase.execute({ key: "unknown.setting" })).rejects.toThrow(
      'Unknown setting key "unknown.setting".',
    );
  });

  it("clears values from the correct store", async () => {
    let settingsCleared = false;
    let secretCleared = false;

    const useCase = new ClearSettingUseCase({
      settings: createSettingsPort({
        async clearValue(request) {
          settingsCleared = request.key === "models.default";
          return { key: request.key, configured: false };
        },
      }),
      secrets: createSecretsPort({
        async clearSecret(key) {
          secretCleared = key === "huggingface.token";
        },
      }),
    });

    await useCase.execute({ key: "huggingface.token" });
    await useCase.execute({ key: "models.default" });

    expect(secretCleared).toBe(true);
    expect(settingsCleared).toBe(true);
  });
});
