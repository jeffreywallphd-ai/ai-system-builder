import type {
  ApplicationSettingDefinition,
  ApplicationSettingValue,
  ReadApplicationSettingsRequest,
} from "../../../contracts/settings";
import type { ApplicationSecretsPort, ApplicationSettingsPort } from "../../ports/settings";

const SECRET_MASK = "********";

export interface ReadSettingsUseCaseDependencies {
  settings: ApplicationSettingsPort;
  secrets: ApplicationSecretsPort;
}

export class ReadSettingsUseCase {
  private readonly settings: ApplicationSettingsPort;
  private readonly secrets: ApplicationSecretsPort;

  public constructor(dependencies: ReadSettingsUseCaseDependencies) {
    this.settings = dependencies.settings;
    this.secrets = dependencies.secrets;
  }

  public async execute(request: ReadApplicationSettingsRequest = {}): Promise<ApplicationSettingValue[]> {
    const [definitions, values] = await Promise.all([
      this.settings.listDefinitions(),
      this.settings.readValues(request),
    ]);

    const definitionsByKey = new Map(definitions.map((definition) => [definition.key, definition] as const));

    return Promise.all(values.map(async (value) => this.maskSecretValue(value, definitionsByKey.get(value.key))));
  }

  private async maskSecretValue(
    value: ApplicationSettingValue,
    definition: ApplicationSettingDefinition | undefined,
  ): Promise<ApplicationSettingValue> {
    if (definition?.valueKind !== "secret") {
      return value;
    }

    const configured = await this.secrets.hasSecret(value.key);
    return {
      key: value.key,
      configured,
      masked: configured,
      maskedValue: configured ? SECRET_MASK : undefined,
    };
  }
}
