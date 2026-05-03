import {
  normalizeGetModelDetailsRequest,
  normalizeGetModelDetailsResult,
  type GetModelDetailsRequest,
  type GetModelDetailsResult,
  type ModelBrowseProvider,
} from "../../../contracts/model";
import type { ModelDetailsPort } from "../../ports/model";

export class GetModelDetailsUseCase {
  private readonly providers: Partial<Record<ModelBrowseProvider, ModelDetailsPort>>;

  public constructor(dependencies: {
    providers: Partial<Record<ModelBrowseProvider, ModelDetailsPort>>;
  }) {
    this.providers = dependencies.providers;
  }

  public async execute(request: GetModelDetailsRequest): Promise<GetModelDetailsResult> {
    const normalizedRequest = normalizeGetModelDetailsRequest(request);
    const provider = this.providers[normalizedRequest.provider];

    if (!provider) {
      throw new Error(`Model details provider \"${normalizedRequest.provider}\" is not supported by this use case.`);
    }

    const result = await provider.getModelDetails(normalizedRequest);
    return normalizeGetModelDetailsResult(result);
  }
}
