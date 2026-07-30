import type {
  ApplicationSettingValue,
  ClearApplicationSettingRequest,
} from "../../../contracts/settings";
import type {
  ApplicationSecretsPort,
  ApplicationSettingAuthorizationPort,
  ApplicationSettingsPort,
} from "../../ports/settings";
import { getKnownSettingDefinition } from "./setting-definition-guards";

export interface ClearSettingUseCaseDependencies {
  settings: ApplicationSettingsPort;
  secrets: ApplicationSecretsPort;
  authorization?: ApplicationSettingAuthorizationPort;
}

export class ClearSettingUseCase {
  private readonly settings: ApplicationSettingsPort;
  private readonly secrets: ApplicationSecretsPort;
  private readonly authorization?: ApplicationSettingAuthorizationPort;

  public constructor(dependencies: ClearSettingUseCaseDependencies) {
    this.settings = dependencies.settings;
    this.secrets = dependencies.secrets;
    this.authorization = dependencies.authorization;
  }

  public async execute(request: ClearApplicationSettingRequest): Promise<ApplicationSettingValue> {
    await this.authorization?.authorizeSettingMutation({
      key: request.key,
      operation: "clear",
    });
    const definition = await getKnownSettingDefinition(this.settings, request.key);
    if (definition.valueKind === "secret") {
      await this.secrets.clearSecret(request.key);
      return {
        key: request.key,
        configured: false,
        masked: false,
      };
    }

    return this.settings.clearValue(request);
  }
}
