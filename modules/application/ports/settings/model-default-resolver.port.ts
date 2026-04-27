import type { ResolveModelDefaultRequest, ResolvedModelDefault } from "../../../contracts/settings";

export interface ModelDefaultResolverPort {
  resolve(request: ResolveModelDefaultRequest): Promise<ResolvedModelDefault>;
}
