import type {
  ApplicationSettingDefinition,
  ApplicationSettingValue,
} from "../../../contracts/settings";
import type {
  ClearApplicationSettingRequest,
  ReadApplicationSettingsRequest,
  UpdateApplicationSettingRequest,
} from "../../../contracts/settings";

export interface ApplicationSettingsPort {
  listDefinitions(): Promise<ApplicationSettingDefinition[]>;
  readValues(request: ReadApplicationSettingsRequest): Promise<ApplicationSettingValue[]>;
  updateValue(request: UpdateApplicationSettingRequest): Promise<ApplicationSettingValue>;
  clearValue(request: ClearApplicationSettingRequest): Promise<ApplicationSettingValue>;
}
