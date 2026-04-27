import type { ApplicationSettingDefinition } from "../../../contracts/settings";
import { normalizeApplicationSettingKey } from "../../../contracts/settings";
import type { ApplicationSettingsPort } from "../../ports/settings";

export async function getKnownSettingDefinition(
  settings: ApplicationSettingsPort,
  rawKey: string,
): Promise<ApplicationSettingDefinition> {
  const key = normalizeApplicationSettingKey(rawKey);
  if (key.length === 0) {
    throw new Error("Setting key must be a non-empty string.");
  }

  const definitions = await settings.listDefinitions();
  const definition = definitions.find((item) => item.key === key);
  if (!definition) {
    throw new Error(`Unknown setting key "${key}".`);
  }

  return definition;
}
