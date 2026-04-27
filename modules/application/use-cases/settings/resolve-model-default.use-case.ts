import type { ResolveModelDefaultRequest, ResolvedModelDefault } from "../../../contracts/settings";
import type { ModelDefaultResolverPort } from "../../ports/settings";

export interface ResolveModelDefaultUseCaseDependencies {
  modelDefaultResolver: ModelDefaultResolverPort;
}

export class ResolveModelDefaultUseCase {
  private readonly modelDefaultResolver: ModelDefaultResolverPort;

  public constructor(dependencies: ResolveModelDefaultUseCaseDependencies) {
    this.modelDefaultResolver = dependencies.modelDefaultResolver;
  }

  public async execute(request: ResolveModelDefaultRequest): Promise<ResolvedModelDefault> {
    return this.modelDefaultResolver.resolve(request);
  }
}
