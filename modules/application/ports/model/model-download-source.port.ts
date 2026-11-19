import type {ModelDownloadSource, ModelDownloadSourceRequest} from "../../../contracts/model";

/** Provider metadata only; never grants acquisition, license rights or runtime readiness. */
export interface ModelDownloadSourcePort {
  inspectModelDownloadSource(request: ModelDownloadSourceRequest): Promise<ModelDownloadSource>;
}
