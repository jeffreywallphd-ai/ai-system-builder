import type { GetModelDetailsRequest, GetModelDetailsResult } from "../../../contracts/model";

export interface ModelDetailsPort {
  getModelDetails(request: GetModelDetailsRequest): Promise<GetModelDetailsResult>;
}
