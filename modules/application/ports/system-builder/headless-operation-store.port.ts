import type { OrganizationId } from "../../../contracts/organization";
import type { SystemBuilderResult, SystemBuilderRevisionId, SystemBuilderSystemId } from "../../../contracts/system-builder";
import type { WorkspaceId } from "../../../contracts/workspace";
import type { SystemBuilderRepositoryPort } from "./system-builder-repository.port";

export const HEADLESS_MUTATIONS = ["systems.apply-edits", "systems.create", "systems.rename", "systems.clone"] as const;
export type HeadlessMutation = typeof HEADLESS_MUTATIONS[number];

export interface HeadlessOperationScope {
  readonly organizationId: OrganizationId;
  readonly workspaceId: WorkspaceId;
  readonly principalId: string;
  readonly registeredClientId: string;
}

export interface HeadlessMutationReference {
  readonly systemId: SystemBuilderSystemId;
  readonly recordRevision: number;
  readonly revisionId: SystemBuilderRevisionId;
}

export interface CommittedSystemChange extends HeadlessMutationReference {
  readonly sequence: number;
}

export type HeadlessOperationOutcome =
  | { readonly kind: "committed" | "replayed"; readonly reference: HeadlessMutationReference }
  | { readonly kind: "denied" | "key-conflict" | "key-expired" | "capacity" }
  | { readonly kind: "mutation-failed"; readonly failure: Extract<SystemBuilderResult<never>, { ok: false }> };

/**
 * Internal persistence only. The caller supplies a host-verified identity
 * and must authorize before entry and before returning a result or event.
 */
export interface HeadlessOperationStorePort {
  run(input: {
    readonly scope: HeadlessOperationScope;
    readonly operation: HeadlessMutation;
    readonly key: string;
    readonly fingerprint: string;
    /** No I/O: this is a fence for a verified grant, including during the transaction. */
    readonly isCurrent: () => boolean;
    /** Database effects only; use this transaction's repository, never a captured repository. */
    readonly mutate: (systems: SystemBuilderRepositoryPort) => Promise<SystemBuilderResult<HeadlessMutationReference>>;
  }): Promise<HeadlessOperationOutcome>;

  watermark(scope: Pick<HeadlessOperationScope, "organizationId" | "workspaceId">): Promise<number>;
  readChanges(
    scope: Pick<HeadlessOperationScope, "organizationId" | "workspaceId">,
    after: number,
  ): Promise<{ readonly kind: "changes"; readonly events: readonly CommittedSystemChange[]; readonly watermark: number } |
    { readonly kind: "resync" }>;
}
