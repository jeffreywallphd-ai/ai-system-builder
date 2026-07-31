import type {
  WorkspaceId,
  WorkspaceSystemPackActivation,
  WorkspaceSystemPackActivationDiagnostic,
} from "../../../contracts/workspace";
import { isWorkspaceId } from "../../../contracts/workspace";
import type { WorkspaceSystemPackActivationRepository } from "../../ports/workspace";
import {
  hasValidKnownSystemPackActivationProvenance,
  isKnownSystemPackActivation,
} from "./workspace-system-pack-activation-policy";
import { workspaceSystemPackActivationDiagnostic } from "./workspace-system-pack-activation-diagnostics";

const SAFE_INVALID_WORKSPACE_ID = "workspace.invalid" as WorkspaceId;

export interface ReadWorkspaceSystemPackActivationUseCaseInput {
  readonly workspaceId: WorkspaceId;
  readonly activationId: string;
}

export interface ReadWorkspaceSystemPackActivationUseCaseResult {
  readonly status: "read" | "not-found" | "failed";
  readonly workspaceId: WorkspaceId;
  readonly activation?: WorkspaceSystemPackActivation;
  readonly isKnownSystemPackActivation: boolean;
  readonly diagnostics: readonly WorkspaceSystemPackActivationDiagnostic[];
}

export interface ReadWorkspaceSystemPackActivationUseCaseDependencies {
  readonly systemPackActivationRepository: WorkspaceSystemPackActivationRepository;
}

export class ReadWorkspaceSystemPackActivationUseCase {
  public constructor(private readonly dependencies: ReadWorkspaceSystemPackActivationUseCaseDependencies) {}

  public async execute(input: ReadWorkspaceSystemPackActivationUseCaseInput): Promise<ReadWorkspaceSystemPackActivationUseCaseResult> {
    if (!isWorkspaceId(input.workspaceId)) {
      return {
        status: "failed",
        workspaceId: SAFE_INVALID_WORKSPACE_ID,
        isKnownSystemPackActivation: false,
        diagnostics: [workspaceSystemPackActivationDiagnostic(
          "workspace-system-pack-activation-workspace-id-invalid",
          "error",
          "Workspace id is invalid for system pack activation read.",
        )],
      };
    }

    if (input.activationId.trim().length === 0) {
      return {
        status: "failed",
        workspaceId: input.workspaceId,
        isKnownSystemPackActivation: false,
        diagnostics: [workspaceSystemPackActivationDiagnostic(
          "workspace-system-pack-activation-activation-id-invalid",
          "error",
          "Workspace system pack activation id is required.",
        )],
      };
    }

    let activation: WorkspaceSystemPackActivation | undefined;
    try {
      activation = await this.dependencies.systemPackActivationRepository.readWorkspaceSystemPackActivation(input.workspaceId, input.activationId);
    } catch {
      return {
        status: "failed",
        workspaceId: input.workspaceId,
        isKnownSystemPackActivation: false,
        diagnostics: [workspaceSystemPackActivationDiagnostic(
          "workspace-system-pack-activation-list-failed",
          "error",
          "Workspace system pack activation could not be read.",
        )],
      };
    }

    if (!activation) {
      return {
        status: "not-found",
        workspaceId: input.workspaceId,
        isKnownSystemPackActivation: false,
        diagnostics: [workspaceSystemPackActivationDiagnostic(
          "workspace-system-pack-activation-not-found",
          "warning",
          "Workspace system pack activation was not found.",
        )],
      };
    }

    const known = isKnownSystemPackActivation(activation);
    const validProvenance = hasValidKnownSystemPackActivationProvenance(activation);
    const diagnostics: WorkspaceSystemPackActivationDiagnostic[] = [];
    if (!known) {
      diagnostics.push(workspaceSystemPackActivationDiagnostic(
        "workspace-system-pack-activation-unknown-pack",
        "warning",
        "Workspace system pack activation references an unknown system pack id or version.",
      ));
    }
    if (known && !validProvenance) {
      diagnostics.push(workspaceSystemPackActivationDiagnostic(
        "workspace-system-pack-activation-invalid-provenance",
        "warning",
        "Workspace system pack activation has invalid system provenance metadata.",
      ));
    }

    return {
      status: "read",
      workspaceId: input.workspaceId,
      activation,
      isKnownSystemPackActivation: known && validProvenance,
      diagnostics,
    };
  }
}
