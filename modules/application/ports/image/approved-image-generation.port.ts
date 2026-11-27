import type {ResolveModelCheckpointRequest, ResolveModelCheckpointResult} from "../model/model-checkpoint-resolver.port";

/** Trusted host/application capability, never request JSON or a boolean grant.
 * The exact approved-plan owner supplies current actor/client/workspace/Model
 * policy and an exact registered-checkpoint resolver. The resolver must invoke
 * authorize, then assertCurrent synchronously at its own file/runtime effect
 * handoffs and verify source bytes;
 * the ordinary label/filename-based resolver cannot satisfy this contract. */
export interface ApprovedImageGenerationAdmission {
  readonly isCurrent: () => boolean;
  readonly authorize: () => Promise<boolean>;
  readonly resolveCheckpoint: (request: Readonly<ResolveModelCheckpointRequest>, fence: ApprovedImageGenerationFence) => Promise<ResolveModelCheckpointResult>;
}

export interface ApprovedImageGenerationFence {
  readonly authorize: () => Promise<void>;
  /** Call in the effect's own continuation after authorize and immediately
   * before the handoff. A check inside an awaited helper is insufficient. */
  readonly assertCurrent: () => void;
}
