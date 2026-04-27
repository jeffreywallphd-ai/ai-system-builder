import type {
  ApplicationSettingDefinition,
  ListApplicationSettingDefinitionsRequest,
} from "../../../contracts/settings";
import type { ApplicationSettingsPort } from "../../ports/settings";

export interface ListSettingsDefinitionsUseCaseDependencies {
  settings: ApplicationSettingsPort;
}

export class ListSettingsDefinitionsUseCase {
  private readonly settings: ApplicationSettingsPort;

  public constructor(dependencies: ListSettingsDefinitionsUseCaseDependencies) {
    this.settings = dependencies.settings;
  }

  public async execute(request: ListApplicationSettingDefinitionsRequest = {}): Promise<ApplicationSettingDefinition[]> {
    const definitions = await this.settings.listDefinitions();

    return definitions.filter((definition) => {
      if (request.category && definition.category !== request.category) {
        return false;
      }

      if (request.keys && request.keys.length > 0 && !request.keys.includes(definition.key)) {
        return false;
      }

      return true;
    });
  }
}
