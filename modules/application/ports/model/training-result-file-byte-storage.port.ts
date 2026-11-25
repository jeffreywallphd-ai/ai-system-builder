import type {ApplicationRequestContext} from "../application-request-context";
import type {StoreArtifactResult} from "../../../contracts/storage";

/** One private, configured training publication. The owning coordinator must
 * separately prove source custody, actual capacity and current permission.
 * Neither this capability nor a stream may come from a client command.
 * Stored bytes are not a registered Model, artifact catalog entry or Save. */
export interface TrainingResultFileByteStoragePort {
  publishResultFile(input: {
    readonly fileIndex: number;
    readonly mediaType: "application/json" | "application/octet-stream";
    readonly content: AsyncIterable<Uint8Array>;
    readonly expectedSizeBytes: number;
    readonly expectedSha256: string;
  }, context: ApplicationRequestContext): Promise<StoreArtifactResult>;
  /** Local acknowledgements/declarations only, not file readiness, measured
   * allocation, complete custody or global settlement. No IO occurs here. */
  inspectPublication(): {
    readonly phase: "open" | "checking" | "writing" | "unconfirmed";
    readonly attemptedFileCount: number;
    readonly acknowledgedFileCount: number;
    readonly declaredPayloadBytes: number;
  };
}
