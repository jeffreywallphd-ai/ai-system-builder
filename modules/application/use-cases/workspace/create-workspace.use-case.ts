import type {
  ActiveWorkspaceSelection,
  CreateWorkspaceCommand,
  WorkspaceId,
  WorkspaceRecord,
  WorkspaceSystemPackActivation,
} from "../../../contracts/workspace";
import { isWorkspaceId } from "../../../contracts/workspace";
import type { OrganizationId } from "../../../contracts/organization";
import type {
  WorkspaceRepository,
  WorkspaceSelectionRepository,
  WorkspaceSystemPackActivationRepository,
} from "../../ports/workspace";
import {
  defaultGenerateWorkspaceId,
  normalizeWorkspaceDescription,
  normalizeWorkspaceDisplayName,
} from "./workspace-create-policy";
import { createSystemFoundationWorkspaceActivation } from "./workspace-system-pack-activation-policy";
import { SYSTEM_FOUNDATION_CURRENT_PACK_VERSION } from "../../services/asset-packs/system-packs";
import type {
  WorkspaceUseCaseDiagnostic,
  WorkspaceUseCaseIssue,
} from "./workspace-use-case-diagnostics";
import {
  workspaceDiagnostic,
  workspaceIssue,
} from "./workspace-use-case-diagnostics";

export interface CreateWorkspaceUseCaseDependencies {
  readonly workspaceRepository: WorkspaceRepository;
  readonly systemPackActivationRepository: WorkspaceSystemPackActivationRepository;
  readonly workspaceSelectionRepository?: WorkspaceSelectionRepository;
  readonly organizationId?: OrganizationId;
}

export interface CreateWorkspaceUseCaseInput {
  readonly command: CreateWorkspaceCommand;
  readonly organizationId?: OrganizationId;
  readonly now?: () => Date;
  readonly generateWorkspaceId?: () => WorkspaceId;
  readonly selectAfterCreate?: boolean;
}

export interface CreateWorkspaceUseCaseResult {
  readonly status: "created" | "failed";
  readonly workspace?: WorkspaceRecord;
  readonly activeSelection?: ActiveWorkspaceSelection;
  readonly systemPackActivations: readonly WorkspaceSystemPackActivation[];
  readonly issues: readonly WorkspaceUseCaseIssue[];
  readonly diagnostics: readonly WorkspaceUseCaseDiagnostic[];
}

export class CreateWorkspaceUseCase {
  public constructor(
    private readonly dependencies: CreateWorkspaceUseCaseDependencies,
  ) {}

  public async execute(
    input: CreateWorkspaceUseCaseInput,
  ): Promise<CreateWorkspaceUseCaseResult> {
    const diagnostics: WorkspaceUseCaseDiagnostic[] = [];
    const issues: WorkspaceUseCaseIssue[] = [];
    const normalizedDisplayName = normalizeWorkspaceDisplayName(
      input.command.displayName,
    );

    if (!normalizedDisplayName.displayName) {
      const code =
        normalizedDisplayName.reason === "required"
          ? "workspace-display-name-required"
          : "workspace-display-name-invalid";
      issues.push(
        workspaceIssue(
          code,
          this.displayNameIssueMessage(normalizedDisplayName.reason),
        ),
      );
      diagnostics.push(
        workspaceDiagnostic(
          "workspace-create-validation-failed",
          "error",
          "Workspace display name validation failed.",
        ),
      );
      return this.failed(issues, diagnostics);
    }

    if (normalizedDisplayName.displayName !== input.command.displayName) {
      diagnostics.push(
        workspaceDiagnostic(
          "workspace-display-name-normalized",
          "info",
          "Workspace display name whitespace was normalized.",
        ),
      );
    }

    const workspaceId = this.generateWorkspaceId(
      input.generateWorkspaceId,
      issues,
      diagnostics,
    );
    if (!workspaceId) {
      return this.failed(issues, diagnostics);
    }

    if (!isWorkspaceId(workspaceId)) {
      issues.push(
        workspaceIssue(
          "workspace-id-invalid",
          "Generated workspace id is not safe for persistence.",
        ),
      );
      diagnostics.push(
        workspaceDiagnostic(
          "workspace-id-invalid",
          "error",
          "Generated workspace id failed workspace id validation.",
        ),
      );
      return this.failed(issues, diagnostics);
    }

    try {
      const existing =
        await this.dependencies.workspaceRepository.readWorkspace(workspaceId);
      if (existing) {
        issues.push(
          workspaceIssue(
            "workspace-already-exists",
            "Generated workspace id already exists.",
          ),
        );
        diagnostics.push(
          workspaceDiagnostic(
            "workspace-already-exists",
            "error",
            "Workspace creation did not overwrite an existing workspace.",
          ),
        );
        return this.failed(issues, diagnostics);
      }
    } catch {
      issues.push(
        workspaceIssue(
          "workspace-save-failed",
          "Workspace could not be checked before save.",
        ),
      );
      diagnostics.push(
        workspaceDiagnostic(
          "workspace-save-failed",
          "error",
          "Workspace persistence failed during pre-save conflict check.",
        ),
      );
      return this.failed(issues, diagnostics);
    }

    const createdAt = (input.now ?? (() => new Date()))().toISOString();
    const organizationId =
      input.organizationId ?? this.dependencies.organizationId;
    const includeSystemFoundationAssets =
      input.command.includeSystemFoundationAssets !== false;
    const description = normalizeWorkspaceDescription(
      input.command.description,
    );
    const workspace: WorkspaceRecord = {
      ...(organizationId ? { organizationId } : {}),
      workspaceId,
      displayName: normalizedDisplayName.displayName,
      ...(description ? { description } : {}),
      status: "active",
      createdAt,
      updatedAt: createdAt,
      storageRoot: { kind: "host-managed" },
      ...(input.command.ownerActorRef
        ? { ownerActorRef: input.command.ownerActorRef }
        : {}),
      ...(input.command.createdByActorRef
        ? { createdByActorRef: input.command.createdByActorRef }
        : {}),
      settings: {
        ...input.command.initialSettings,
        defaultIncludeSystemFoundationAssets: includeSystemFoundationAssets,
      },
    };
    const activations = includeSystemFoundationAssets
      ? [
          createSystemFoundationWorkspaceActivation(
            workspaceId,
            createdAt,
            input.command.createdByActorRef,
            SYSTEM_FOUNDATION_CURRENT_PACK_VERSION,
          ),
        ]
      : [];

    if (includeSystemFoundationAssets) {
      diagnostics.push(
        workspaceDiagnostic(
          "workspace-create-reference-only-system-foundation-activation",
          "info",
          "Workspace creation will reference the system foundation pack by id and version without installing or copying definitions.",
        ),
      );
    } else {
      diagnostics.push(
        workspaceDiagnostic(
          "workspace-create-system-foundation-activation-disabled",
          "info",
          "Workspace creation was requested without system foundation pack activation.",
        ),
      );
    }

    try {
      await this.dependencies.workspaceRepository.saveWorkspace(workspace);
      diagnostics.push(
        workspaceDiagnostic(
          "workspace-create-workspace-persisted",
          "info",
          "Workspace record was persisted.",
        ),
      );
    } catch {
      issues.push(
        workspaceIssue(
          "workspace-save-failed",
          "Workspace could not be saved.",
        ),
      );
      diagnostics.push(
        workspaceDiagnostic(
          "workspace-save-failed",
          "error",
          "Workspace persistence failed during save.",
        ),
      );
      return this.failed(issues, diagnostics);
    }

    for (const activation of activations) {
      try {
        await this.dependencies.systemPackActivationRepository.saveWorkspaceSystemPackActivation(
          activation,
        );
      } catch {
        issues.push(
          workspaceIssue(
            "workspace-system-pack-activation-save-failed",
            "System foundation activation reference could not be saved.",
          ),
        );
        diagnostics.push(
          workspaceDiagnostic(
            "workspace-system-pack-activation-save-failed",
            "error",
            "Workspace exists, but the system foundation activation reference was not persisted.",
          ),
        );
        return {
          status: "failed",
          workspace,
          systemPackActivations: [],
          issues,
          diagnostics,
        };
      }
    }

    if (input.selectAfterCreate === true) {
      if (!this.dependencies.workspaceSelectionRepository) {
        issues.push(
          workspaceIssue(
            "workspace-selection-save-failed",
            "Active workspace selection repository is not available.",
          ),
        );
        diagnostics.push(
          workspaceDiagnostic(
            "workspace-selection-save-failed",
            "error",
            "Active workspace selection was explicitly requested but could not be persisted.",
          ),
        );
        return {
          status: "failed",
          workspace,
          systemPackActivations: activations,
          issues,
          diagnostics,
        };
      }

      const activeSelection: ActiveWorkspaceSelection = {
        workspaceId,
        selectedAt: createdAt,
      };
      try {
        await this.dependencies.workspaceSelectionRepository.saveActiveWorkspaceSelection(
          activeSelection,
        );
        diagnostics.push(
          workspaceDiagnostic(
            "workspace-create-active-selection-persisted",
            "info",
            "Active workspace selection was explicitly persisted.",
          ),
        );
        return {
          status: "created",
          workspace,
          activeSelection,
          systemPackActivations: activations,
          issues,
          diagnostics,
        };
      } catch {
        issues.push(
          workspaceIssue(
            "workspace-selection-save-failed",
            "Active workspace selection could not be saved.",
          ),
        );
        diagnostics.push(
          workspaceDiagnostic(
            "workspace-selection-save-failed",
            "error",
            "Workspace exists, but the explicit active workspace selection was not persisted.",
          ),
        );
        return {
          status: "failed",
          workspace,
          systemPackActivations: activations,
          issues,
          diagnostics,
        };
      }
    }

    return {
      status: "created",
      workspace,
      systemPackActivations: activations,
      issues,
      diagnostics,
    };
  }

  private failed(
    issues: readonly WorkspaceUseCaseIssue[],
    diagnostics: readonly WorkspaceUseCaseDiagnostic[],
  ): CreateWorkspaceUseCaseResult {
    return { status: "failed", systemPackActivations: [], issues, diagnostics };
  }

  private displayNameIssueMessage(reason: string | undefined): string {
    if (reason === "required") {
      return "Workspace display name is required.";
    }
    if (reason === "too-long") {
      return "Workspace display name is too long.";
    }
    if (reason === "control-character") {
      return "Workspace display name contains unsupported control characters.";
    }
    if (reason === "path-like") {
      return "Workspace display name must be a user-facing name, not a path or locator.";
    }
    return "Workspace display name is invalid.";
  }

  private generateWorkspaceId(
    generator: (() => WorkspaceId) | undefined,
    issues: WorkspaceUseCaseIssue[],
    diagnostics: WorkspaceUseCaseDiagnostic[],
  ): WorkspaceId | undefined {
    try {
      return (generator ?? defaultGenerateWorkspaceId)();
    } catch {
      issues.push(
        workspaceIssue(
          "workspace-id-generation-failed",
          "Workspace id could not be generated.",
        ),
      );
      diagnostics.push(
        workspaceDiagnostic(
          "workspace-id-generation-failed",
          "error",
          "Workspace id generation failed.",
        ),
      );
      return undefined;
    }
  }
}
