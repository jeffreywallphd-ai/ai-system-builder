import type {
  ApplicationSettingValue,
  UpdateApplicationSettingRequest,
} from "../../../contracts/settings";
import type {
  ApplicationSecretsPort,
  ApplicationSettingAuthorizationPort,
  ApplicationSettingsPort,
} from "../../ports/settings";
import { getKnownSettingDefinition } from "./setting-definition-guards";
import { validateSettingUpdate } from "./validate-setting-update";

const SECRET_MASK = "********";

export interface UpdateSettingUseCaseDependencies {
  settings: ApplicationSettingsPort;
  secrets: ApplicationSecretsPort;
  authorization?: ApplicationSettingAuthorizationPort;
}

export class UpdateSettingUseCase {
  private readonly settings: ApplicationSettingsPort;
  private readonly secrets: ApplicationSecretsPort;
  private readonly authorization?: ApplicationSettingAuthorizationPort;

  public constructor(dependencies: UpdateSettingUseCaseDependencies) {
    this.settings = dependencies.settings;
    this.secrets = dependencies.secrets;
    this.authorization = dependencies.authorization;
  }

  public async execute(request: UpdateApplicationSettingRequest): Promise<ApplicationSettingValue> {
    await this.authorization?.authorizeSettingMutation({
      key: request.key,
      operation: "update",
    });
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

    validateSettingUpdate(definition, request.value);
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
