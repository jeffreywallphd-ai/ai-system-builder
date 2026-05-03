import type { PublishModelRequest, PublishModelResult } from "../../../contracts/model";

export interface ModelPublisherPort {
  publishModel(request: PublishModelRequest & { modelPath: string }): Promise<PublishModelResult>;
}
