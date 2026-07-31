import type {
  WorkspaceId,
  WorkspaceSystemPackActivation,
  WorkspaceSystemPackActivationDiagnostic,
  WorkspaceSystemPackActivationStatus,
} from "../../../contracts/workspace";
import { isWorkspaceId } from "../../../contracts/workspace";
import type { WorkspaceSystemPackActivationRepository } from "../../ports/workspace";
import {
  hasValidKnownSystemPackActivationProvenance,
  isKnownSystemPackActivation,
} from "./workspace-system-pack-activation-policy";
import type { WorkspaceSystemPackActivationIssue } from "./workspace-system-pack-activation-diagnostics";

import {
  workspaceSystemPackActivationDiagnostic,
  workspaceSystemPackActivationIssue,
} from "./workspace-system-pack-activation-diagnostics";

const SAFE_INVALID_WORKSPACE_ID = "workspace.invalid" as WorkspaceId;

export type SetWorkspaceSystemPackActivationStatus = Extract<WorkspaceSystemPackActivationStatus, "active" | "inactive">;

export interface SetWorkspaceSystemPackActivationStatusUseCaseInput {
  readonly workspaceId: WorkspaceId;
  readonly activationId: string;
  readonly status: SetWorkspaceSystemPackActivationStatus;
  readonly updatedAt: string;
}

export interface SetWorkspaceSystemPackActivationStatusUseCaseResult {
  readonly status: "updated" | "failed";
  readonly workspaceId: WorkspaceId;
  readonly activation?: WorkspaceSystemPackActivation;
  readonly issues: readonly WorkspaceSystemPackActivationIssue[];
  readonly diagnostics: readonly WorkspaceSystemPackActivationDiagnostic[];
}

export interface SetWorkspaceSystemPackActivationStatusUseCaseDependencies {
  readonly systemPackActivationRepository: WorkspaceSystemPackActivationRepository;
}

export class SetWorkspaceSystemPackActivationStatusUseCase {
  public constructor(private readonly dependencies: SetWorkspaceSystemPackActivationStatusUseCaseDependencies) {}

  public async execute(
    input: SetWorkspaceSystemPackActivationStatusUseCaseInput,
  ): Promise<SetWorkspaceSystemPackActivationStatusUseCaseResult> {
    if (!isWorkspaceId(input.workspaceId)) {
      return this.failed(SAFE_INVALID_WORKSPACE_ID, "workspace-system-pack-activation-workspace-id-invalid", "Workspace id is invalid for system pack activation status updates.");
    }

    if (input.activationId.trim().length === 0) {
      return this.failed(input.workspaceId, "workspace-system-pack-activation-activation-id-invalid", "Workspace system pack activation id is required.");
    }

    if (input.status !== "active" && input.status !== "inactive") {
      return this.failed(input.workspaceId, "workspace-system-pack-activation-status-invalid", "Workspace system pack activation status must be active or inactive.");
    }

    let existing: WorkspaceSystemPackActivation | undefined;
    try {
      existing = await this.dependencies.systemPackActivationRepository.readWorkspaceSystemPackActivation(input.workspaceId, input.activationId);
    } catch {
      return this.failed(input.workspaceId, "workspace-system-pack-activation-status-update-failed", "Workspace system pack activation status could not be updated.");
    }

    if (!existing) {
      return this.failed(input.workspaceId, "workspace-system-pack-activation-not-found", "Workspace system pack activation was not found.");
    }

    if (!isKnownSystemPackActivation(existing)) {
      return this.failed(input.workspaceId, "workspace-system-pack-activation-unknown-pack", "Workspace system pack activation references an unknown system pack id or version.");
    }

    if (!hasValidKnownSystemPackActivationProvenance(existing)) {
      return this.failed(input.workspaceId, "workspace-system-pack-activation-invalid-provenance", "Workspace system pack activation has invalid system provenance metadata.");
    }

    if (existing.status === "failed") {
      return this.failed(input.workspaceId, "workspace-system-pack-activation-failed", "Failed workspace system pack activations cannot be user-toggled.");
    }

    const updated: WorkspaceSystemPackActivation = {
      ...existing,
      status: input.status,
    };

    try {
      await this.dependencies.systemPackActivationRepository.updateWorkspaceSystemPackActivation(updated);
    } catch {
      return this.failed(input.workspaceId, "workspace-system-pack-activation-status-update-failed", "Workspace system pack activation status could not be updated.");
    }

    return {
      status: "updated",
      workspaceId: input.workspaceId,
      activation: updated,
      issues: [],
      diagnostics: [],
    };
  }

  private failed(
    workspaceId: WorkspaceId,
    code: WorkspaceSystemPackActivationIssue["code"],
    message: string,
  ): SetWorkspaceSystemPackActivationStatusUseCaseResult {
    return {
      status: "failed",
      workspaceId,
      issues: [workspaceSystemPackActivationIssue(code, message)],
      diagnostics: [workspaceSystemPackActivationDiagnostic(code, code.endsWith("invalid") ? "error" : "warning", message)],
    };
  }
}
