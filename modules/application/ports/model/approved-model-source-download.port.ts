import type {ModelDownloadSource} from "../../../contracts/model";
import type {WorkspaceId} from "../../../contracts/workspace";
import type {InstalledRuntimeTaskStart} from "../runtime";

/** Internal host admission, never an API/IPC request or a permission granted by data. */
export interface ApprovedModelSourceDownloadRequest {
  readonly requestId: string;
  readonly workspaceId: WorkspaceId;
  readonly sourceManifest: {readonly source: ModelDownloadSource; readonly manifestDigest: string};
  readonly maximumDurationSeconds: number;
  readonly allowedOrigins: readonly string[];
}
export interface ApprovedModelSourceDownloadControl {
  /** Original host/lease lifetime; business revocation does not grant cleanup authority. */
  readonly isCurrent: () => boolean;
  readonly stillAllowed: () => Promise<boolean>;
}
export interface ApprovedModelSourceDownloadPort {
  /** Explicit installed-only readiness; an unknown start must never be adopted or repeated. */
  startApprovedModelSource(request: ApprovedModelSourceDownloadRequest, control: ApprovedModelSourceDownloadControl): Promise<InstalledRuntimeTaskStart>;
}
