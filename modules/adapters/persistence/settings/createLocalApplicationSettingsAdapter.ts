import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

import {
  INITIAL_APPLICATION_SETTING_DEFINITIONS,
  type ApplicationSettingDefinition,
  type ApplicationSettingValue,
  type ApplicationSettingPrimitiveValue,
  type ClearApplicationSettingRequest,
  type ReadApplicationSettingsRequest,
  type UpdateApplicationSettingRequest,
} from "../../../contracts/settings";
import type { ApplicationSettingsPort } from "../../../application/ports/settings";

interface SettingsFileShape {
  settings?: Record<string, ApplicationSettingPrimitiveValue>;
  [key: string]: unknown;
}

export interface LocalApplicationSettingsAdapterOptions {
  filePath: string;
  now?: () => string;
  definitions?: ApplicationSettingDefinition[];
}

export function createLocalApplicationSettingsAdapter(
  options: LocalApplicationSettingsAdapterOptions,
): ApplicationSettingsPort {
  const now = options.now ?? (() => new Date().toISOString());
  const definitions = options.definitions ?? INITIAL_APPLICATION_SETTING_DEFINITIONS;
  const definitionByKey = new Map(definitions.map((definition) => [definition.key, definition] as const));

  async function readDocument(): Promise<SettingsFileShape> {
    try {
      const json = await readFile(options.filePath, "utf8");
      const parsed = JSON.parse(json) as SettingsFileShape;
      if (!parsed || typeof parsed !== "object") {
        return { settings: {} };
      }

      return {
        ...parsed,
        settings: parsed.settings && typeof parsed.settings === "object" ? parsed.settings : {},
      };
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code === "ENOENT") {
        return { settings: {} };
      }

      throw error;
    }
  }

  async function writeDocument(nextDocument: SettingsFileShape): Promise<void> {
    const directory = dirname(options.filePath);
    await mkdir(directory, { recursive: true });

    const temporaryPath = `${options.filePath}.tmp`;
    await writeFile(temporaryPath, JSON.stringify(nextDocument, null, 2), "utf8");
    await rename(temporaryPath, options.filePath);
  }

  async function updateSetting(key: string, value: ApplicationSettingPrimitiveValue | undefined): Promise<void> {
    const document = await readDocument();
    const currentSettings = document.settings ?? {};
    const nextSettings = { ...currentSettings };

    if (value === undefined) {
      delete nextSettings[key];
    } else {
      nextSettings[key] = value;
    }

    await writeDocument({
      ...document,
      settings: nextSettings,
    });
  }

  function selectDefinitions(request: ReadApplicationSettingsRequest = {}): ApplicationSettingDefinition[] {
    return definitions.filter((definition) => {
      if (request.category && definition.category !== request.category) {
        return false;
      }

      if (request.keys && request.keys.length > 0 && !request.keys.includes(definition.key)) {
        return false;
      }

      return true;
    });
  }

  return {
    async listDefinitions(): Promise<ApplicationSettingDefinition[]> {
      return [...definitions];
    },
    async readValues(request): Promise<ApplicationSettingValue[]> {
      const document = await readDocument();
      const selectedDefinitions = selectDefinitions(request);
      const settings = document.settings ?? {};

      return selectedDefinitions.map((definition) => {
        if (definition.valueKind === "secret") {
          return {
            key: definition.key,
            configured: false,
            value: undefined,
          };
        }

        const storedValue = settings[definition.key];
        return {
          key: definition.key,
          configured: storedValue !== undefined,
          value: storedValue,
        };
      });
    },
    async updateValue(request: UpdateApplicationSettingRequest): Promise<ApplicationSettingValue> {
      const definition = definitionByKey.get(request.key);
      if (definition?.valueKind === "secret") {
        throw new Error(`Secret setting "${request.key}" must be stored via ApplicationSecretsPort.`);
      }

      await updateSetting(request.key, request.value);
      return {
        key: request.key,
        configured: true,
        value: request.value,
        updatedAt: now(),
      };
    },
    async clearValue(request: ClearApplicationSettingRequest): Promise<ApplicationSettingValue> {
      await updateSetting(request.key, undefined);
      return {
        key: request.key,
        configured: false,
        updatedAt: now(),
      };
    },
  };
}
