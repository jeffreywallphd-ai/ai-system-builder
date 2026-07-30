import type { ApplicationSettingKey } from "../../../contracts/settings";

export interface ApplicationSettingAuthorizationPort {
  authorizeSettingMutation(request: {
    readonly key: ApplicationSettingKey;
    readonly operation: "update" | "clear";
  }): Promise<void>;
}
