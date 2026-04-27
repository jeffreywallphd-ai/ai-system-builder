import type {
  ApplicationSettingCategory,
  ApplicationSettingKey,
  ApplicationSettingPrimitiveValue,
  ResolveModelDefaultRequest,
} from "../../../../../../../modules/contracts/settings";
import {
  createApplicationSettingsApi,
  type ApplicationSettingsApi,
} from "../../../lib/applicationSettingsApi";

export interface DesktopApplicationSettingsClient {
  listDefinitions: (input?: { category?: ApplicationSettingCategory; keys?: ApplicationSettingKey[] }) => ReturnType<ApplicationSettingsApi["listDefinitions"]>;
  readSettings: (input?: { category?: ApplicationSettingCategory; keys?: ApplicationSettingKey[] }) => ReturnType<ApplicationSettingsApi["readSettings"]>;
  updateSetting: (input: { key: ApplicationSettingKey; value: ApplicationSettingPrimitiveValue }) => ReturnType<ApplicationSettingsApi["updateSetting"]>;
  clearSetting: (input: { key: ApplicationSettingKey }) => ReturnType<ApplicationSettingsApi["clearSetting"]>;
  resolveModelDefault: (input: ResolveModelDefaultRequest) => ReturnType<ApplicationSettingsApi["resolveModelDefault"]>;
}

export function createDesktopApplicationSettingsClient(): DesktopApplicationSettingsClient {
  return createApplicationSettingsApi();
}
