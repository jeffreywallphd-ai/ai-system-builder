import type {ModelDownloadSource, ModelDownloadSourceRequest} from "../../../contracts/model";

export interface ModelSourceInspectionControl {
  readonly isCurrent: () => boolean;
  readonly stillAllowed: () => Promise<boolean>;
  /** A caller may narrow the existing20second limit, never expand it. */
  readonly maximumDurationMs?: number;
}
/** Provider metadata only; never grants acquisition, license rights or runtime readiness. */
export interface ModelDownloadSourcePort {
  inspectModelDownloadSource(request: ModelDownloadSourceRequest, control?: ModelSourceInspectionControl): Promise<ModelDownloadSource>;
}
