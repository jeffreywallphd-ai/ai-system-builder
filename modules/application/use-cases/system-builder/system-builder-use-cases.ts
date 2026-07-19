import type {
  ChangeSystemBuilderArchiveStateCommand,
  CloneSystemBuilderSystemCommand,
  CreateSystemBuilderFromTemplateCommand,
  CreateSystemBuilderSystemCommand,
  ListSystemBuilderRevisionsQuery,
  ListSystemBuilderSystemsQuery,
  ReadSystemBuilderRevisionQuery,
  ReadSystemBuilderSystemQuery,
  RenameSystemBuilderSystemCommand,
  SaveSystemBuilderRevisionCommand,
  SystemBuilderComposition,
  SystemBuilderRecord,
  SystemBuilderResult,
  SystemBuilderRevision,
  SystemBuilderTemplateSummary,
} from "../../../contracts/system-builder";
import {
  normalizeSystemBuilderRevisionId,
  normalizeSystemBuilderSystemId,
  systemBuilderFailure,
  systemBuilderSuccess,
} from "../../../contracts/system-builder";
import type { AssetReference } from "../../../contracts/asset";
import type { SystemBuilderRepositoryPort } from "../../ports/system-builder";
import type {
  SystemBuilderReferenceTemplateRegistry,
  ValidateSystemBuilderRevisionService,
} from "../../services/system-builder";
import { createCanonicalSystemBuilderStructure } from "../../services/system-builder";

export interface SystemBuilderUseCaseDependencies {
  readonly repository: SystemBuilderRepositoryPort;
  readonly validator: Pick<ValidateSystemBuilderRevisionService, "execute">;
  readonly generateSystemId: () => string;
  readonly now?: () => string;
}

export class CreateSystemBuilderSystemUseCase {
  public constructor(
    private readonly dependencies: SystemBuilderUseCaseDependencies,
  ) {}

  public async execute(
    command: CreateSystemBuilderSystemCommand,
  ): Promise<SystemBuilderResult<SystemBuilderRecord>> {
    const name = validName(command.name);
    if (!name)
      return systemBuilderFailure(
        "system-builder.name-required",
        "Enter a system name.",
        "name",
      );
    const description = validDescription(command.description);
    if (command.description !== undefined && description === undefined)
      return systemBuilderFailure(
        "system-builder.description-invalid",
        "System descriptions must be 1,000 characters or fewer.",
        "description",
      );
    let systemId;
    try {
      systemId = normalizeSystemBuilderSystemId(
        this.dependencies.generateSystemId(),
      );
    } catch {
      return systemBuilderFailure(
        "system-builder.id-invalid",
        "A safe system identifier could not be generated.",
      );
    }
    const timestamp = now(this.dependencies);
    const baseComposition = createEmptyComposition(
      systemId,
      name,
      command.actorId,
      timestamp,
      command.compositionType ?? "system",
      description,
    );
    const profile = command.profile ?? "interactive";
    let seed;
    try {
      seed = createCanonicalSystemBuilderStructure({
        systemId,
        compositionId: String(baseComposition.compositionId),
        name,
        actorId: safeActor(command.actorId),
        timestamp,
        profile,
        layoutPresetRef: command.layoutPresetRef,
      });
    } catch {
      return systemBuilderFailure(
        "system-builder.layout-unsupported",
        "Select a supported System Foundation application layout.",
        "layoutPresetRef",
      );
    }
    const composition: SystemBuilderComposition = {
      ...baseComposition,
      rootInstanceRefs: seed.rootInstanceRefs,
      instanceRefs: seed.instanceRefs,
      placementRefs: seed.placementRefs,
    };
    const revisionId = normalizeSystemBuilderRevisionId(`${systemId}.r1`);
    const candidate = {
      revisionId,
      systemId,
      targetWorkspaceId: command.workspaceId,
      revisionNumber: 1,
      composition,
      instances: seed.instances,
      bindings: [],
      structure: seed.structure,
      placements: seed.placements,
      validationIssues: [],
      createdAt: timestamp,
      createdBy: safeActor(command.actorId),
    } satisfies SystemBuilderRevision;
    const validation = await this.dependencies.validator.execute(candidate);
    const revision: SystemBuilderRevision = {
      ...candidate,
      validationIssues: validation.issues,
    };
    const record: SystemBuilderRecord = {
      systemId,
      targetWorkspaceId: command.workspaceId,
      name,
      ...(description ? { description } : {}),
      status:
        validation.status === "invalid"
          ? "blocked"
          : seed.instances.length === 0
            ? "draft"
            : "validated",
      revision: 1,
      currentRevisionId: revisionId,
      composition,
      createdAt: timestamp,
      updatedAt: timestamp,
      createdBy: safeActor(command.actorId),
      updatedBy: safeActor(command.actorId),
    };
    try {
      return systemBuilderSuccess(
        (
          await this.dependencies.repository.createRecordAndRevision(
            record,
            revision,
          )
        ).record,
      );
    } catch {
      return systemBuilderFailure(
        "system-builder.create-conflict",
        "The system could not be created. Try again.",
      );
    }
  }
}

export class ListSystemBuilderTemplatesUseCase {
  public constructor(
    private readonly registry: Pick<
      SystemBuilderReferenceTemplateRegistry,
      "list"
    >,
  ) {}

  public async execute(): Promise<readonly SystemBuilderTemplateSummary[]> {
    return this.registry.list();
  }
}

export class CreateSystemBuilderFromTemplateUseCase {
  public constructor(
    private readonly dependencies: SystemBuilderUseCaseDependencies,
    private readonly registry: Pick<
      SystemBuilderReferenceTemplateRegistry,
      "materialize"
    >,
  ) {}

  public async execute(
    command: CreateSystemBuilderFromTemplateCommand,
  ): Promise<SystemBuilderResult<SystemBuilderRecord>> {
    let systemId;
    try {
      systemId = normalizeSystemBuilderSystemId(
        this.dependencies.generateSystemId(),
      );
    } catch {
      return systemBuilderFailure(
        "system-builder.id-invalid",
        "A safe system identifier could not be generated.",
      );
    }
    const timestamp = now(this.dependencies);
    const name = validName(command.name ?? "Reference system");
    if (!name)
      return systemBuilderFailure(
        "system-builder.name-required",
        "Enter a system name.",
        "name",
      );
    const materialized = this.registry.materialize(command.templateId, {
      systemId,
      name,
      actorId: command.actorId,
      timestamp,
    });
    if (!materialized) {
      return systemBuilderFailure(
        "system-builder.template-unsupported",
        "The selected system template is unavailable.",
        "templateId",
      );
    }
    const revisionId = normalizeSystemBuilderRevisionId(systemId + ".r1");
    const candidate = {
      revisionId,
      systemId,
      targetWorkspaceId: command.workspaceId,
      revisionNumber: 1,
      ...materialized,
      validationIssues: [],
      createdAt: timestamp,
      createdBy: safeActor(command.actorId),
    } satisfies SystemBuilderRevision;
    const validation = await this.dependencies.validator.execute(candidate);
    const revision: SystemBuilderRevision = {
      ...candidate,
      validationIssues: validation.issues,
    };
    const record: SystemBuilderRecord = {
      systemId,
      targetWorkspaceId: command.workspaceId,
      name,
      description: materialized.description,
      status: validation.status === "invalid" ? "blocked" : "validated",
      revision: 1,
      currentRevisionId: revisionId,
      composition: materialized.composition,
      createdAt: timestamp,
      updatedAt: timestamp,
      createdBy: safeActor(command.actorId),
      updatedBy: safeActor(command.actorId),
    };
    try {
      return systemBuilderSuccess(
        (
          await this.dependencies.repository.createRecordAndRevision(
            record,
            revision,
          )
        ).record,
      );
    } catch {
      return systemBuilderFailure(
        "system-builder.create-conflict",
        "The system could not be created. Try again.",
      );
    }
  }
}

export class ReadSystemBuilderSystemUseCase {
  public constructor(
    private readonly repository: SystemBuilderRepositoryPort,
  ) {}
  public async execute(
    query: ReadSystemBuilderSystemQuery,
  ): Promise<SystemBuilderResult<SystemBuilderRecord>> {
    const record = await this.repository.readRecord(
      query.workspaceId,
      query.systemId,
    );
    return record
      ? systemBuilderSuccess(record)
      : systemBuilderFailure(
          "system-builder.not-found",
          "The system was not found in this workspace.",
        );
  }
}

export class ListSystemBuilderSystemsUseCase {
  public constructor(
    private readonly repository: SystemBuilderRepositoryPort,
  ) {}
  public async execute(
    query: ListSystemBuilderSystemsQuery,
  ): Promise<readonly SystemBuilderRecord[]> {
    return this.repository.listRecords(
      query.workspaceId,
      query.includeArchived,
    );
  }
}

export class RenameSystemBuilderSystemUseCase {
  public constructor(
    private readonly dependencies: Pick<
      SystemBuilderUseCaseDependencies,
      "repository" | "now"
    >,
  ) {}
  public async execute(
    command: RenameSystemBuilderSystemCommand,
  ): Promise<SystemBuilderResult<SystemBuilderRecord>> {
    const name = validName(command.name);
    if (!name)
      return systemBuilderFailure(
        "system-builder.name-required",
        "Enter a system name.",
        "name",
      );
    const description = validDescription(command.description);
    if (command.description !== undefined && description === undefined)
      return systemBuilderFailure(
        "system-builder.description-invalid",
        "System descriptions must be 1,000 characters or fewer.",
        "description",
      );
    const current = await this.dependencies.repository.readRecord(
      command.workspaceId,
      command.systemId,
    );
    if (!current)
      return systemBuilderFailure(
        "system-builder.not-found",
        "The system was not found in this workspace.",
      );
    if (current.revision !== command.expectedRevision) return staleFailure();
    const updated: SystemBuilderRecord = {
      ...current,
      name,
      ...(description ? { description } : { description: undefined }),
      revision: current.revision + 1,
      updatedAt: now(this.dependencies),
      updatedBy: safeActor(command.actorId),
    };
    return updateRecord(
      this.dependencies.repository,
      updated,
      command.expectedRevision,
    );
  }
}

export class ArchiveSystemBuilderSystemUseCase {
  public constructor(
    private readonly dependencies: Pick<
      SystemBuilderUseCaseDependencies,
      "repository" | "now"
    >,
  ) {}
  public async execute(
    command: ChangeSystemBuilderArchiveStateCommand,
  ): Promise<SystemBuilderResult<SystemBuilderRecord>> {
    return changeArchiveState(this.dependencies, command, true);
  }
}

export class RestoreSystemBuilderSystemUseCase {
  public constructor(
    private readonly dependencies: Pick<
      SystemBuilderUseCaseDependencies,
      "repository" | "now"
    >,
  ) {}
  public async execute(
    command: ChangeSystemBuilderArchiveStateCommand,
  ): Promise<SystemBuilderResult<SystemBuilderRecord>> {
    return changeArchiveState(this.dependencies, command, false);
  }
}

export class SaveSystemBuilderRevisionUseCase {
  public constructor(
    private readonly dependencies: Pick<
      SystemBuilderUseCaseDependencies,
      "repository" | "validator" | "now"
    >,
  ) {}
  public async execute(
    command: SaveSystemBuilderRevisionCommand,
  ): Promise<SystemBuilderResult<SystemBuilderRevision>> {
    const current = await this.dependencies.repository.readRecord(
      command.workspaceId,
      command.systemId,
    );
    if (!current)
      return systemBuilderFailure(
        "system-builder.not-found",
        "The system was not found in this workspace.",
      );
    if (current.status === "archived")
      return systemBuilderFailure(
        "system-builder.archived",
        "Restore the system before editing it.",
      );
    if (current.revision !== command.expectedRecordRevision)
      return staleFailure();
    if (
      String(command.composition.compositionId) !==
      String(current.composition.compositionId)
    ) {
      return systemBuilderFailure(
        "system-builder.composition-mismatch",
        "The composition does not belong to this system.",
        "composition",
      );
    }
    const timestamp = now(this.dependencies);
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
    const candidate = {
      revisionId,
      systemId: command.systemId,
      targetWorkspaceId: command.workspaceId,
      revisionNumber: nextRevisionNumber,
      composition: clone(command.composition),
      instances: clone(command.instances),
      bindings: clone(command.bindings),
      ...(command.structure ? { structure: clone(command.structure) } : {}),
      ...(command.placements ? { placements: clone(command.placements) } : {}),
      validationIssues: [],
      createdAt: timestamp,
      createdBy: safeActor(command.actorId),
    } satisfies SystemBuilderRevision;
    const validation = await this.dependencies.validator.execute(candidate);
    const revision: SystemBuilderRevision = {
      ...candidate,
      validationIssues: validation.issues,
    };
    const updatedRecord: SystemBuilderRecord = {
      ...current,
      composition: revision.composition,
      currentRevisionId: revisionId,
      status:
        validation.status === "invalid"
          ? "blocked"
          : revision.instances.length === 0
            ? "draft"
            : "validated",
      revision: current.revision + 1,
      updatedAt: timestamp,
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

export class ReadSystemBuilderRevisionUseCase {
  public constructor(
    private readonly repository: SystemBuilderRepositoryPort,
  ) {}
  public async execute(
    query: ReadSystemBuilderRevisionQuery,
  ): Promise<SystemBuilderResult<SystemBuilderRevision>> {
    const record = await this.repository.readRecord(
      query.workspaceId,
      query.systemId,
    );
    if (!record)
      return systemBuilderFailure(
        "system-builder.not-found",
        "The system was not found in this workspace.",
      );
    const revisionId = query.revisionId ?? record.currentRevisionId;
    if (!revisionId)
      return systemBuilderFailure(
        "system-builder.revision-not-found",
        "The system has no saved revision.",
      );
    const revision = await this.repository.readRevision(
      query.workspaceId,
      query.systemId,
      revisionId,
    );
    return revision
      ? systemBuilderSuccess(revision)
      : systemBuilderFailure(
          "system-builder.revision-not-found",
          "The system revision was not found.",
        );
  }
}

export class ListSystemBuilderRevisionsUseCase {
  public constructor(
    private readonly repository: SystemBuilderRepositoryPort,
  ) {}
  public async execute(
    query: ListSystemBuilderRevisionsQuery,
  ): Promise<readonly SystemBuilderRevision[]> {
    return this.repository.listRevisions(query.workspaceId, query.systemId);
  }
}

export class CloneSystemBuilderSystemUseCase {
  public constructor(
    private readonly dependencies: SystemBuilderUseCaseDependencies,
  ) {}
  public async execute(
    command: CloneSystemBuilderSystemCommand,
  ): Promise<SystemBuilderResult<SystemBuilderRecord>> {
    const name = validName(command.name);
    if (!name)
      return systemBuilderFailure(
        "system-builder.name-required",
        "Enter a system name.",
        "name",
      );
    const source = await this.dependencies.repository.readRecord(
      command.workspaceId,
      command.sourceSystemId,
    );
    if (!source?.currentRevisionId)
      return systemBuilderFailure(
        "system-builder.not-found",
        "The source system was not found in this workspace.",
      );
    const sourceRevision = await this.dependencies.repository.readRevision(
      command.workspaceId,
      source.systemId,
      source.currentRevisionId,
    );
    if (!sourceRevision)
      return systemBuilderFailure(
        "system-builder.revision-not-found",
        "The source system revision was not found.",
      );
    let systemId;
    try {
      systemId = normalizeSystemBuilderSystemId(
        this.dependencies.generateSystemId(),
      );
    } catch {
      return systemBuilderFailure(
        "system-builder.id-invalid",
        "A safe system identifier could not be generated.",
      );
    }
    const timestamp = now(this.dependencies);
    const compositionId = `${systemId}.composition`;
    const composition = {
      ...clone(sourceRevision.composition),
      compositionId,
      displayName: name,
      version: "0.1.0",
      lifecycleStatus: "draft",
      provenance: {
        sourceKind: "human-authored",
        createdAt: timestamp,
        createdBy: safeActor(command.actorId),
        derivedFromRefs: [
          {
            kind: "asset-composition",
            id: String(sourceRevision.composition.compositionId),
          } as AssetReference,
        ],
      },
    } as SystemBuilderComposition;
    const instances = clone(sourceRevision.instances).map((instance) => ({
      ...instance,
      parentCompositionRef: {
        kind: "asset-composition",
        id: compositionId,
      } as AssetReference,
    }));
    const revisionId = normalizeSystemBuilderRevisionId(`${systemId}.r1`);
    const structure = sourceRevision.structure
      ? clone(sourceRevision.structure)
      : undefined;
    const placements = sourceRevision.placements
      ? clone(sourceRevision.placements)
      : undefined;
    const validation = await this.dependencies.validator.execute({
      composition,
      instances,
      bindings: sourceRevision.bindings,
      ...(structure ? { structure } : {}),
      ...(placements ? { placements } : {}),
    });
    const revision: SystemBuilderRevision = {
      revisionId,
      systemId,
      targetWorkspaceId: command.workspaceId,
      revisionNumber: 1,
      composition,
      instances,
      bindings: clone(sourceRevision.bindings),
      ...(structure ? { structure } : {}),
      ...(placements ? { placements } : {}),
      validationIssues: validation.issues,
      createdAt: timestamp,
      createdBy: safeActor(command.actorId),
    };
    const record: SystemBuilderRecord = {
      systemId,
      targetWorkspaceId: command.workspaceId,
      name,
      ...(source.description ? { description: source.description } : {}),
      status:
        validation.status === "invalid"
          ? "blocked"
          : instances.length === 0
            ? "draft"
            : "validated",
      revision: 1,
      currentRevisionId: revisionId,
      composition,
      createdAt: timestamp,
      updatedAt: timestamp,
      createdBy: safeActor(command.actorId),
      updatedBy: safeActor(command.actorId),
    };
    try {
      return systemBuilderSuccess(
        (
          await this.dependencies.repository.createRecordAndRevision(
            record,
            revision,
          )
        ).record,
      );
    } catch {
      return systemBuilderFailure(
        "system-builder.create-conflict",
        "The system could not be cloned. Try again.",
      );
    }
  }
}

function createEmptyComposition(
  systemId: string,
  name: string,
  actorId: string,
  timestamp: string,
  compositionType: SystemBuilderComposition["compositionType"],
  description?: string,
): SystemBuilderComposition {
  return {
    compositionId: `${systemId}.composition`,
    compositionType,
    displayName: name,
    ...(description ? { description } : {}),
    version: "0.1.0",
    lifecycleStatus: "draft",
    rootInstanceRefs: [],
    instanceRefs: [],
    bindingRefs: [],
    provenance: {
      sourceKind: "human-authored",
      createdAt: timestamp,
      createdBy: safeActor(actorId),
    },
  };
}

async function changeArchiveState(
  dependencies: Pick<SystemBuilderUseCaseDependencies, "repository" | "now">,
  command: ChangeSystemBuilderArchiveStateCommand,
  archive: boolean,
): Promise<SystemBuilderResult<SystemBuilderRecord>> {
  const current = await dependencies.repository.readRecord(
    command.workspaceId,
    command.systemId,
  );
  if (!current)
    return systemBuilderFailure(
      "system-builder.not-found",
      "The system was not found in this workspace.",
    );
  if (current.revision !== command.expectedRevision) return staleFailure();
  const timestamp = now(dependencies);
  const nextStatus = archive
    ? "archived"
    : current.composition.instanceRefs.length === 0
      ? "draft"
      : current.currentRevisionId
        ? "validated"
        : "in-composition";
  return updateRecord(
    dependencies.repository,
    {
      ...current,
      status: nextStatus,
      ...(archive ? { archivedAt: timestamp } : { archivedAt: undefined }),
      revision: current.revision + 1,
      updatedAt: timestamp,
      updatedBy: safeActor(command.actorId),
    },
    command.expectedRevision,
  );
}

async function updateRecord(
  repository: SystemBuilderRepositoryPort,
  record: SystemBuilderRecord,
  expectedRevision: number,
): Promise<SystemBuilderResult<SystemBuilderRecord>> {
  try {
    return systemBuilderSuccess(
      await repository.updateRecord(record, expectedRevision),
    );
  } catch {
    return staleFailure();
  }
}

function staleFailure(): SystemBuilderResult<never> {
  return systemBuilderFailure(
    "system-builder.stale",
    "This system changed. Reload it before saving again.",
  );
}

function validName(value: string): string | undefined {
  const normalized = value.trim();
  return normalized.length > 0 &&
    normalized.length <= 120 &&
    !/[\u0000-\u001f\u007f]/.test(normalized)
    ? normalized
    : undefined;
}

function validDescription(value: string | undefined): string | undefined {
  if (value === undefined || value.trim() === "") return undefined;
  const normalized = value.trim();
  return normalized.length <= 1_000 &&
    !/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(normalized)
    ? normalized
    : undefined;
}

function safeActor(value: string): string {
  const normalized = value.trim();
  return normalized.length > 0 &&
    normalized.length <= 160 &&
    !/[\u0000-\u001f\u007f]/.test(normalized)
    ? normalized
    : "unknown-actor";
}

function now(dependencies: { readonly now?: () => string }): string {
  return (dependencies.now ?? (() => new Date().toISOString()))();
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}
