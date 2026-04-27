import type {
  ApplicationSettingValue,
  ClearApplicationSettingRequest,
} from "../../../contracts/settings";
import type { ApplicationSecretsPort, ApplicationSettingsPort } from "../../ports/settings";
import { getKnownSettingDefinition } from "./setting-definition-guards";

export interface ClearSettingUseCaseDependencies {
  settings: ApplicationSettingsPort;
  secrets: ApplicationSecretsPort;
}

export class ClearSettingUseCase {
  private readonly settings: ApplicationSettingsPort;
  private readonly secrets: ApplicationSecretsPort;

  public constructor(dependencies: ClearSettingUseCaseDependencies) {
    this.settings = dependencies.settings;
    this.secrets = dependencies.secrets;
  }

  public async execute(request: ClearApplicationSettingRequest): Promise<ApplicationSettingValue> {
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
