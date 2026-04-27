import type {
  ApplicationSettingValue,
  UpdateApplicationSettingRequest,
} from "../../../contracts/settings";
import type { ApplicationSecretsPort, ApplicationSettingsPort } from "../../ports/settings";
import { getKnownSettingDefinition } from "./setting-definition-guards";

const SECRET_MASK = "********";

export interface UpdateSettingUseCaseDependencies {
  settings: ApplicationSettingsPort;
  secrets: ApplicationSecretsPort;
}

export class UpdateSettingUseCase {
  private readonly settings: ApplicationSettingsPort;
  private readonly secrets: ApplicationSecretsPort;

  public constructor(dependencies: UpdateSettingUseCaseDependencies) {
    this.settings = dependencies.settings;
    this.secrets = dependencies.secrets;
  }

  public async execute(request: UpdateApplicationSettingRequest): Promise<ApplicationSettingValue> {
    const definition = await getKnownSettingDefinition(this.settings, request.key);
    if (definition.valueKind === "secret") {
      const rawSecret = this.parseRawSecret(request.value);
      if (rawSecret.length === 0) {
        throw new Error(`Secret setting "${request.key}" requires a non-empty string value.`);
      }
      if (rawSecret === SECRET_MASK) {
        throw new Error(`Secret setting "${request.key}" cannot be updated with the masked placeholder value.`);
      }
      await this.secrets.setSecret(request.key, rawSecret);
      return {
        key: request.key,
        configured: true,
        masked: true,
        maskedValue: "********",
      };
    }

    return this.settings.updateValue(request);
  }

  private parseRawSecret(input: unknown): string {
    if (typeof input === "string") {
      return input;
    }

    if (input && typeof input === "object" && "rawValue" in input && typeof input.rawValue === "string") {
      return input.rawValue;
    }

    throw new Error("Secret updates require a raw string value.");
  }
}
