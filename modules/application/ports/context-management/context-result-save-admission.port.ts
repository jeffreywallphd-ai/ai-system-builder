import type {ApplicationRequestContext} from "../application-request-context";
import type {ContextSavedArtifactReference, ContextArtifactMediaType} from "../../../contracts/context-management";
import type {HeadlessContextTaskReview} from "../../../contracts/headless";

/** Pure private owner metadata, after accepted task and actor proof. */
export interface PreparedContextResultReview {
  readonly review: HeadlessContextTaskReview;
  readonly name: string;
  readonly commandDigest: string;
  readonly output: {readonly name: string; readonly outputHandle: string;
    readonly mediaType: ContextArtifactMediaType; readonly sizeBytes: number; readonly digest: string};
}

/** Private owned-task file selection. Never accepted from a transport. */
export interface ContextResultOutputSourcePort {
  readOutput(input: {readonly runtimeDirectory: string; readonly outputHandle: string;
    readonly expectedSizeBytes: number}): AsyncIterable<Uint8Array>;
}

/** Minted by the host's approved save step. Data fields alone are not authority.
 * Commit must atomically register catalog, primary binding and causal receipt in
 * the root owner's current-policy transaction. It performs no byte/runtime IO. */
export interface ApprovedContextResultSaveAdmission {
  readonly effectId: string;
  readonly taskId: string;
  readonly reportFingerprint: string;
  readonly organizationId: NonNullable<ApplicationRequestContext["organizationId"]>;
  readonly workspaceId: NonNullable<ApplicationRequestContext["workspaceId"]>;
  readonly principalId: string;
  isCurrent(): boolean;
  stillAllowed(): Promise<boolean>;
  issue(): Promise<"issued" | "denied" | "unconfirmed">;
  commit(artifact: ContextSavedArtifactReference): Promise<ContextSavedArtifactReference>;
}
