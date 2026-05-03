import {
  normalizeBrowseModelsRequest,
  normalizeBrowseModelsResult,
  type BrowseModelsRequest,
  type BrowseModelsResult,
  type ModelBrowseProvider,
} from "../../../contracts/model";
import type { ModelBrowsePort } from "../../ports/model";

export class BrowseModelsUseCase {
  private readonly providers: Partial<Record<ModelBrowseProvider, ModelBrowsePort>>;

  public constructor(dependencies: {
    providers: Partial<Record<ModelBrowseProvider, ModelBrowsePort>>;
  }) {
    this.providers = dependencies.providers;
  }

  public async execute(request: BrowseModelsRequest): Promise<BrowseModelsResult> {
    const normalizedRequest = normalizeBrowseModelsRequest(request);
    const provider = this.providers[normalizedRequest.provider];

    if (!provider) {
      throw new Error(`Model browse provider \"${normalizedRequest.provider}\" is not supported by this use case.`);
    }

    const result = await provider.browseModels(normalizedRequest);
    return normalizeBrowseModelsResult(result);
  }
}
