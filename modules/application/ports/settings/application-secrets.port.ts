import type { ApplicationSettingKey } from "../../../contracts/settings";

export interface ApplicationSecretsPort {
  setSecret(key: ApplicationSettingKey, value: string): Promise<void>;
  getSecret(key: ApplicationSettingKey): Promise<string | undefined>;
  clearSecret(key: ApplicationSettingKey): Promise<void>;
  hasSecret(key: ApplicationSettingKey): Promise<boolean>;
}
