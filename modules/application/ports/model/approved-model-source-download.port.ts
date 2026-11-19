import type {ModelDownloadSource} from "../../../contracts/model";
import type {WorkspaceId} from "../../../contracts/workspace";
import type {InstalledRuntimeTaskStart} from "../runtime";
import type {CancelRuntimeTaskResult, RuntimeTaskRecord, StartRuntimeTaskResult} from "../../../contracts/runtime";
import type {CompletedModelDownload} from "./model-download-completion.port";

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
  startApprovedModelSource(request: ApprovedModelSourceDownloadRequest, control: ApprovedModelSourceDownloadControl): Promise<ApprovedModelSourceDownloadStart>;
}

/** Original host-private result owner; a reusable shared-history ID is not authority. */
export interface ApprovedModelSourceDownloadTask {
  readonly requestId: string;
  readonly workspaceId: WorkspaceId;
  readonly modelId: string;
  readonly revision: string;
  readonly manifestDigest: string;
  readonly read: () => Promise<RuntimeTaskRecord>;
  readonly cancel: () => Promise<CancelRuntimeTaskResult>;
  /** Cached original completion only; never discovers or advances a different task. */
  readonly readCompleted: () => Promise<CompletedModelDownload | undefined>;
}
export type ApprovedModelSourceDownloadStart = Exclude<InstalledRuntimeTaskStart, {kind: "accepted"}> |
  {readonly kind: "accepted"; readonly value: StartRuntimeTaskResult; readonly task: ApprovedModelSourceDownloadTask};
