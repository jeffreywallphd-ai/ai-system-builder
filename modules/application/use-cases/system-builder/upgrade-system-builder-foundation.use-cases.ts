import type {
  PreviewSystemBuilderFoundationUpgradeCommand,
  SystemBuilderFoundationUpgradePreview,
  SystemBuilderRecord,
  SystemBuilderResult,
  SystemBuilderRevision,
  SystemBuilderRevisionId,
  UpgradeSystemBuilderFoundationCommand,
} from "../../../contracts/system-builder";
import {
  normalizeSystemBuilderRevisionId,
  systemBuilderFailure,
  systemBuilderSuccess,
  SYSTEM_BUILDER_FOUNDATION_UPGRADE_TARGET_VERSION,
  SYSTEM_BUILDER_MODEL_BINDING_FIELD_ID,
} from "../../../contracts/system-builder";
import type { SystemBuilderRepositoryPort } from "../../ports/system-builder";
import {
  mapSystemBuilderFoundationUpgrade,
  type SystemBuilderFoundationUpgradeCandidate,
  type ValidateSystemBuilderRevisionService,
} from "../../services/system-builder";

interface SystemBuilderFoundationUpgradeDependencies {
  readonly repository: SystemBuilderRepositoryPort;
  readonly validator: Pick<ValidateSystemBuilderRevisionService, "execute">;
  readonly now?: () => string;
}

interface PreparedSystemBuilderFoundationUpgrade {
  readonly record: SystemBuilderRecord;
  readonly sourceRevision: SystemBuilderRevision;
  readonly candidate: SystemBuilderFoundationUpgradeCandidate;
  readonly preview: SystemBuilderFoundationUpgradePreview;
  readonly timestamp: string;
}

export class PreviewSystemBuilderFoundationUpgradeUseCase {
  public constructor(
    private readonly dependencies: SystemBuilderFoundationUpgradeDependencies,
  ) {}

  public async execute(
    command: PreviewSystemBuilderFoundationUpgradeCommand,
  ): Promise<SystemBuilderResult<SystemBuilderFoundationUpgradePreview>> {
    const prepared = await prepareFoundationUpgrade(this.dependencies, command);
    return prepared.ok
      ? systemBuilderSuccess(prepared.value.preview)
      : prepared;
  }
}

export class UpgradeSystemBuilderFoundationUseCase {
  public constructor(
    private readonly dependencies: SystemBuilderFoundationUpgradeDependencies,
  ) {}

  public async execute(
    command: UpgradeSystemBuilderFoundationCommand,
  ): Promise<SystemBuilderResult<SystemBuilderRevision>> {
    const prepared = await prepareFoundationUpgrade(
      this.dependencies,
      command,
      command.sourceRevisionId,
    );
    if (!prepared.ok) return prepared;
    if (!prepared.value.preview.eligible) {
      return systemBuilderFailure(
        "system-builder.foundation-upgrade-blocked",
        prepared.value.preview.issues[0]?.message ??
          prepared.value.preview.validationIssues[0]?.message ??
          "The system cannot be upgraded without losing or invalidating data.",
      );
    }

    const nextRevisionNumber =
      (
        await this.dependencies.repository.listRevisions(
          command.workspaceId,
          command.systemId,
        )
      ).reduce((maximum, item) => Math.max(maximum, item.revisionNumber), 0) +
      1;
    const revisionId = normalizeSystemBuilderRevisionId(
      `${command.systemId}.r${nextRevisionNumber}`,
    );
    const revision: SystemBuilderRevision = {
      revisionId,
      systemId: command.systemId,
      targetWorkspaceId: command.workspaceId,
      revisionNumber: nextRevisionNumber,
      composition: clone(prepared.value.candidate.composition),
      instances: clone(prepared.value.candidate.instances),
      bindings: clone(prepared.value.candidate.bindings),
      ...(prepared.value.candidate.structure
        ? { structure: clone(prepared.value.candidate.structure) }
        : {}),
      ...(prepared.value.candidate.placements
        ? { placements: clone(prepared.value.candidate.placements) }
        : {}),
      validationIssues: prepared.value.preview.validationIssues,
      createdAt: prepared.value.timestamp,
      createdBy: safeActor(command.actorId),
    };
    const updatedRecord: SystemBuilderRecord = {
      ...prepared.value.record,
      composition: revision.composition,
      ...(prepared.value.candidate.systemDefinitionRef
        ? {
            systemDefinitionRef: clone(
              prepared.value.candidate.systemDefinitionRef,
            ),
          }
        : {}),
      currentRevisionId: revisionId,
      status:
        revision.instances.length === 0
          ? "draft"
          : prepared.value.preview.validationStatus === "invalid"
            ? "blocked"
            : "validated",
      revision: prepared.value.record.revision + 1,
      updatedAt: prepared.value.timestamp,
      updatedBy: safeActor(command.actorId),
    };
    try {
      return systemBuilderSuccess(
        (
          await this.dependencies.repository.saveRevisionAndRecord(
            revision,
            updatedRecord,
            command.expectedRecordRevision,
          )
        ).revision,
      );
    } catch {
      return staleFailure();
    }
  }
}

async function prepareFoundationUpgrade(
  dependencies: SystemBuilderFoundationUpgradeDependencies,
  command: PreviewSystemBuilderFoundationUpgradeCommand,
  expectedSourceRevisionId?: SystemBuilderRevisionId,
): Promise<SystemBuilderResult<PreparedSystemBuilderFoundationUpgrade>> {
  const record = await dependencies.repository.readRecord(
    command.workspaceId,
    command.systemId,
  );
  if (!record) {
    return systemBuilderFailure(
      "system-builder.not-found",
      "The system was not found in this workspace.",
    );
  }
  if (record.status === "archived") {
    return systemBuilderFailure(
      "system-builder.archived",
      "Restore the system before upgrading it.",
    );
  }
  if (record.revision !== command.expectedRecordRevision) {
    return staleFailure();
  }
  if (!record.currentRevisionId) {
    return systemBuilderFailure(
      "system-builder.revision-not-found",
      "The system has no saved revision to upgrade.",
    );
  }
  if (
    expectedSourceRevisionId &&
    String(record.currentRevisionId) !== String(expectedSourceRevisionId)
  ) {
    return staleFailure();
  }
  const sourceRevision = await dependencies.repository.readRevision(
    command.workspaceId,
    command.systemId,
    record.currentRevisionId,
  );
  if (!sourceRevision) {
    return systemBuilderFailure(
      "system-builder.revision-not-found",
      "The current system revision was not found.",
    );
  }

  const timestamp = dependencies.now?.() ?? new Date().toISOString();
  const mapping = mapSystemBuilderFoundationUpgrade({
    sourceRevision,
    systemName: record.name,
    systemDescription: record.description,
    systemDefinitionRef: record.systemDefinitionRef,
    actorId: safeActor(command.actorId),
    timestamp,
  });
  const validation = await dependencies.validator.execute(mapping.candidate);
  const modelSelectionIsTheOnlyBlocker =
    validation.status === "invalid" &&
    validation.issues.length > 0 &&
    validation.issues.every(
      (issue) =>
        issue.category === "configuration" &&
        issue.path?.[issue.path.length - 1] ===
          SYSTEM_BUILDER_MODEL_BINDING_FIELD_ID,
    );
  const preview: SystemBuilderFoundationUpgradePreview = {
    sourceRevisionId: sourceRevision.revisionId,
    sourceVersion: mapping.sourceVersion,
    targetVersion: SYSTEM_BUILDER_FOUNDATION_UPGRADE_TARGET_VERSION,
    eligible:
      mapping.issues.length === 0 &&
      (validation.status !== "invalid" || modelSelectionIsTheOnlyBlocker),
    mappedInstanceCount: mapping.mappedInstanceCount,
    mappedConfigurationFieldCount: mapping.mappedConfigurationFieldCount,
    issues: mapping.issues,
    validationStatus: validation.status,
    validationIssues: validation.issues,
  };
  return systemBuilderSuccess({
    record,
    sourceRevision,
    candidate: mapping.candidate,
    preview,
    timestamp,
  });
}

function staleFailure(): SystemBuilderResult<never> {
  return systemBuilderFailure(
    "system-builder.stale",
    "This system changed. Reload it before upgrading.",
  );
}

function safeActor(value: string): string {
  const normalized = value.trim();
  return normalized.length > 0 &&
    normalized.length <= 160 &&
    !/[\u0000-\u001f\u007f]/.test(normalized)
    ? normalized
    : "unknown-actor";
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}
