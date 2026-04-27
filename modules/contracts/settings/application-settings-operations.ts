import type {
  ApplicationSettingCategory,
  ApplicationSettingDefinition,
  ApplicationSettingKey,
  ApplicationSettingPrimitiveValue,
  ApplicationSettingValue,
} from "./application-settings";

export interface ListApplicationSettingDefinitionsRequest {
  category?: ApplicationSettingCategory;
  keys?: ApplicationSettingKey[];
}

export interface ListApplicationSettingDefinitionsResult {
  definitions: ApplicationSettingDefinition[];
}

export interface ReadApplicationSettingsRequest {
  category?: ApplicationSettingCategory;
  keys?: ApplicationSettingKey[];
}

export interface ReadApplicationSettingsResult {
  values: ApplicationSettingValue[];
}

export interface UpdateApplicationSettingRequest {
  key: ApplicationSettingKey;
  value: ApplicationSettingPrimitiveValue;
}

export interface UpdateApplicationSettingResult {
  value: ApplicationSettingValue;
}

export interface ClearApplicationSettingRequest {
  key: ApplicationSettingKey;
}

export interface ClearApplicationSettingResult {
  value: ApplicationSettingValue;
}
