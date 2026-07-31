import type {
  WorkspaceId,
  WorkspaceSystemPackActivation,
} from "../../../contracts/workspace";

/**
 * Persistence-only repository for workspace system-pack activation references.
 * It stores passed activation records only and does not validate, install, copy,
 * mutate, activate, or deactivate system pack definitions.
 *
 * saveWorkspaceSystemPackActivation is the create-or-replace/upsert seam by
 * activation id. updateWorkspaceSystemPackActivation is existing-activation-only
 * and adapters must not create a missing activation from update calls; missing
 * updates should fail safely according to adapter error policy.
 */
export interface WorkspaceSystemPackActivationRepository {
  readonly listWorkspaceSystemPackActivations: (
    workspaceId: WorkspaceId,
  ) => Promise<readonly WorkspaceSystemPackActivation[]>;
  readonly readWorkspaceSystemPackActivation: (
    workspaceId: WorkspaceId,
    activationId: string,
  ) => Promise<WorkspaceSystemPackActivation | undefined>;
  readonly saveWorkspaceSystemPackActivation: (
    activation: WorkspaceSystemPackActivation,
  ) => Promise<void>;
  readonly updateWorkspaceSystemPackActivation: (
    activation: WorkspaceSystemPackActivation,
  ) => Promise<void>;
}
