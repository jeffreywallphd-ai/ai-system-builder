import type { AssetPackId, AssetPackVersion } from "../../../contracts/asset";
import type {
  WorkspaceId,
  WorkspaceSystemPackActivation,
  WorkspaceSystemPackActivationDiagnostic,
} from "../../../contracts/workspace";
import { isWorkspaceId } from "../../../contracts/workspace";
import type { WorkspaceSystemPackActivationRepository } from "../../ports/workspace";
import {
  getKnownSystemPackReference,
  hasValidKnownSystemPackActivationProvenance,
  isKnownSystemPackActivation,
} from "./workspace-system-pack-activation-policy";
import { workspaceSystemPackActivationDiagnostic } from "./workspace-system-pack-activation-diagnostics";

const SAFE_INVALID_WORKSPACE_ID = "workspace.invalid" as WorkspaceId;

export interface WorkspaceActiveSystemPack {
  readonly workspaceId: WorkspaceId;
  readonly packId: AssetPackId;
  readonly packVersion: AssetPackVersion;
  readonly displayName?: string;
  readonly sourceKind: "system";
  readonly sourceLayer: "system-default";
  readonly trustStatus: "system-trusted";
  readonly activationId: string;
  readonly activatedAt: string;
}

export interface ListWorkspaceSystemPackActivationsResult {
  readonly status: "listed" | "failed";
  readonly workspaceId: WorkspaceId;
  readonly activeSystemPacks: readonly WorkspaceActiveSystemPack[];
  readonly inactiveSystemPacks: readonly WorkspaceSystemPackActivation[];
  readonly failedSystemPacks: readonly WorkspaceSystemPackActivation[];
  readonly unknownSystemPackActivations: readonly WorkspaceSystemPackActivation[];
  readonly diagnostics: readonly WorkspaceSystemPackActivationDiagnostic[];
}

export interface ListWorkspaceSystemPackActivationsUseCaseDependencies {
  readonly systemPackActivationRepository: WorkspaceSystemPackActivationRepository;
}

export class ListWorkspaceSystemPackActivationsUseCase {
  public constructor(private readonly dependencies: ListWorkspaceSystemPackActivationsUseCaseDependencies) {}

  public async execute(workspaceId: WorkspaceId): Promise<ListWorkspaceSystemPackActivationsResult> {
    const empty = (status: ListWorkspaceSystemPackActivationsResult["status"], diagnostics: readonly WorkspaceSystemPackActivationDiagnostic[] = []): ListWorkspaceSystemPackActivationsResult => ({
      status,
      workspaceId: status === "failed" && !isWorkspaceId(workspaceId) ? SAFE_INVALID_WORKSPACE_ID : workspaceId,
      activeSystemPacks: [],
      inactiveSystemPacks: [],
      failedSystemPacks: [],
      unknownSystemPackActivations: [],
      diagnostics,
    });

    if (!isWorkspaceId(workspaceId)) {
      return empty("failed", [workspaceSystemPackActivationDiagnostic(
        "workspace-system-pack-activation-workspace-id-invalid",
        "error",
        "Workspace id is invalid for system pack activation listing.",
      )]);
    }

    let activations: readonly WorkspaceSystemPackActivation[];
    try {
      activations = await this.dependencies.systemPackActivationRepository.listWorkspaceSystemPackActivations(workspaceId);
    } catch {
      return empty("failed", [workspaceSystemPackActivationDiagnostic(
        "workspace-system-pack-activation-list-failed",
        "error",
        "Workspace system pack activations could not be listed.",
      )]);
    }

    return categorizeWorkspaceSystemPackActivations(workspaceId, activations);
  }
}

export function categorizeWorkspaceSystemPackActivations(
  workspaceId: WorkspaceId,
  activations: readonly WorkspaceSystemPackActivation[],
): ListWorkspaceSystemPackActivationsResult {
  const diagnostics: WorkspaceSystemPackActivationDiagnostic[] = [];
  const inactiveSystemPacks: WorkspaceSystemPackActivation[] = [];
  const failedSystemPacks: WorkspaceSystemPackActivation[] = [];
  const unknownSystemPackActivations: WorkspaceSystemPackActivation[] = [];
  const activeByReference = new Map<string, WorkspaceActiveSystemPack>();
  const activationIdCounts = new Map<string, number>();

  const ordered = sortWorkspaceSystemPackActivations(activations).filter((activation) => activation.workspaceId === workspaceId);

  for (const activation of ordered) {
    activationIdCounts.set(activation.activationId, (activationIdCounts.get(activation.activationId) ?? 0) + 1);
  }

  for (const [, count] of [...activationIdCounts.entries()].sort(([left], [right]) => left.localeCompare(right))) {
    if (count > 1) {
      diagnostics.push(workspaceSystemPackActivationDiagnostic(
        "workspace-system-pack-activation-duplicate-id",
        "warning",
        "Workspace system pack activation id appears more than once; deterministic ordering was applied.",
      ));
    }
  }

  for (const activation of ordered) {
    const knownReference = getKnownSystemPackReference(activation.packId, activation.packVersion);
    const validProvenance = hasValidKnownSystemPackActivationProvenance(activation);

    if (!knownReference) {
      unknownSystemPackActivations.push(activation);
      diagnostics.push(workspaceSystemPackActivationDiagnostic(
        "workspace-system-pack-activation-unknown-pack",
        "warning",
        "Workspace system pack activation references an unknown system pack id or version.",
      ));
      continue;
    }

    if (!validProvenance) {
      unknownSystemPackActivations.push(activation);
      diagnostics.push(workspaceSystemPackActivationDiagnostic(
        "workspace-system-pack-activation-invalid-provenance",
        "warning",
        "Workspace system pack activation has invalid system provenance metadata.",
      ));
      continue;
    }

    if (activation.status === "inactive") {
      inactiveSystemPacks.push(activation);
      diagnostics.push(workspaceSystemPackActivationDiagnostic(
        "workspace-system-pack-activation-inactive",
        "info",
        "Known workspace system pack activation is inactive.",
      ));
      continue;
    }

    if (activation.status === "failed") {
      failedSystemPacks.push(activation);
      diagnostics.push(workspaceSystemPackActivationDiagnostic(
        "workspace-system-pack-activation-failed",
        "warning",
        "Known workspace system pack activation is failed and is not active.",
      ));
      continue;
    }

    if (!isKnownSystemPackActivation(activation)) {
      unknownSystemPackActivations.push(activation);
      continue;
    }

    const referenceKey = `${activation.packId}@${activation.packVersion}`;
    if (activeByReference.has(referenceKey)) {
      diagnostics.push(workspaceSystemPackActivationDiagnostic(
        "workspace-system-pack-activation-duplicate-pack",
        "warning",
        "Workspace has multiple active activation records for the same known system pack; the first deterministic record was used.",
      ));
      continue;
    }

    activeByReference.set(referenceKey, {
      workspaceId: activation.workspaceId,
      packId: activation.packId,
      packVersion: activation.packVersion,
      ...(knownReference.displayName ? { displayName: knownReference.displayName } : {}),
      sourceKind: "system",
      sourceLayer: "system-default",
      trustStatus: "system-trusted",
      activationId: activation.activationId,
      activatedAt: activation.activatedAt,
    });
  }

  return {
    status: "listed",
    workspaceId,
    activeSystemPacks: [...activeByReference.values()].sort(compareActiveSystemPacks),
    inactiveSystemPacks: sortWorkspaceSystemPackActivations(inactiveSystemPacks),
    failedSystemPacks: sortWorkspaceSystemPackActivations(failedSystemPacks),
    unknownSystemPackActivations: sortWorkspaceSystemPackActivations(unknownSystemPackActivations),
    diagnostics: sortDiagnostics(diagnostics),
  };
}

export function sortWorkspaceSystemPackActivations(
  activations: readonly WorkspaceSystemPackActivation[],
): WorkspaceSystemPackActivation[] {
  return [...activations].sort((left, right) => {
    const pack = `${left.packId}@${left.packVersion}`.localeCompare(`${right.packId}@${right.packVersion}`);
    if (pack !== 0) return pack;
    const activated = left.activatedAt.localeCompare(right.activatedAt);
    if (activated !== 0) return activated;
    return left.activationId.localeCompare(right.activationId);
  });
}

function compareActiveSystemPacks(left: WorkspaceActiveSystemPack, right: WorkspaceActiveSystemPack): number {
  const pack = `${left.packId}@${left.packVersion}`.localeCompare(`${right.packId}@${right.packVersion}`);
  if (pack !== 0) return pack;
  const activated = left.activatedAt.localeCompare(right.activatedAt);
  if (activated !== 0) return activated;
  return left.activationId.localeCompare(right.activationId);
}

function sortDiagnostics(
  diagnostics: readonly WorkspaceSystemPackActivationDiagnostic[],
): WorkspaceSystemPackActivationDiagnostic[] {
  return [...diagnostics].sort((left, right) => {
    const code = left.code.localeCompare(right.code);
    if (code !== 0) return code;
    const severity = left.severity.localeCompare(right.severity);
    if (severity !== 0) return severity;
    return left.message.localeCompare(right.message);
  });
}
