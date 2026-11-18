import type {ApplicationRequestContext} from "../application-request-context";
import type {ContextArtifactMediaType} from "../../../contracts/context-management";
import type {StoreArtifactResult} from "../../../contracts/storage";

/** Internal byte publication only. The caller must separately admit the owned
 * reviewed task and atomically commit metadata. Never deserialize this capability
 * or its stream from a client command. It does not register an active Context. */
export interface ContextResultByteStoragePort {
  publishResult(input: {
    readonly publicationId: string;
    readonly mediaType: ContextArtifactMediaType;
    readonly content: AsyncIterable<Uint8Array>;
    readonly expectedSizeBytes: number;
    readonly expectedSha256: string;
  }, context: ApplicationRequestContext): Promise<StoreArtifactResult>;
}
