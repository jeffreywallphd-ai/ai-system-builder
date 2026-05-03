import type { BrowseModelsRequest, BrowseModelsResult } from "../../../contracts/model";

export interface ModelBrowsePort {
  browseModels(request: BrowseModelsRequest): Promise<BrowseModelsResult>;
}
