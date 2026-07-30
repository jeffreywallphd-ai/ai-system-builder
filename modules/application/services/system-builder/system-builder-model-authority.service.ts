import type { ModelInventoryRecord } from "../../../contracts/model";
import {
  createSystemBuilderModelBinding,
  type SystemBuilderModelBinding,
  type SystemBuilderModelOption,
} from "../../../contracts/system-builder";
import type { WorkspaceId } from "../../../contracts/workspace";
import type { ModelRegistryPort } from "../../ports/model";

const COMPATIBLE_TASKS = new Set([
  "text-generation",
  "text2text-generation",
  "chat",
]);
const USABLE_LIFECYCLE_STATUSES = new Set([
  "downloaded",
  "generated",
  "validated",
]);

export type SystemBuilderModelResolutionFailureCode =
  | "model-binding-missing"
  | "model-binding-unavailable"
  | "model-binding-workspace-mismatch"
  | "model-binding-incompatible"
  | "model-binding-not-runnable";

export type SystemBuilderModelResolution =
  | {
      readonly status: "ready";
      readonly binding: SystemBuilderModelBinding;
      readonly record: ModelInventoryRecord;
    }
  | {
      readonly status: "denied";
      readonly code: SystemBuilderModelResolutionFailureCode;
      readonly message: string;
    };

export class SystemBuilderModelAuthorityService {
  public constructor(
    private readonly registry: Pick<
      ModelRegistryPort,
      "listModels" | "getModelRecord"
    >,
  ) {}

  public async listCompatible(
    workspaceId: WorkspaceId,
  ): Promise<readonly SystemBuilderModelOption[]> {
    const result = await this.registry.listModels({
      workspaceId,
      limit: 500,
      includeDiscovered: true,
      includeSharedStorage: true,
    });

    return result.models
      .filter((record) => isCompatibleRunnableModel(record, workspaceId))
      .map((record) => projectModelOption(record))
      .sort(
        (left, right) =>
          left.displayName.localeCompare(right.displayName) ||
          left.binding.modelRecordId.localeCompare(
            right.binding.modelRecordId,
          ),
      );
  }

  public async resolve(
    workspaceId: WorkspaceId,
    binding: SystemBuilderModelBinding | undefined,
  ): Promise<SystemBuilderModelResolution> {
    if (!binding) {
      return denied(
        "model-binding-missing",
        "Select an available text-generation model.",
      );
    }

    let record: ModelInventoryRecord | undefined;
    try {
      record = await this.registry.getModelRecord(
        workspaceId,
        binding.modelRecordId,
      );
    } catch {
      return denied(
        "model-binding-unavailable",
        "The selected model is unavailable in this workspace.",
      );
    }
    if (!record) {
      return denied(
        "model-binding-unavailable",
        "The selected model is unavailable in this workspace.",
      );
    }
    if (record.workspaceId !== workspaceId) {
      return denied(
        "model-binding-workspace-mismatch",
        "The selected model is unavailable in this workspace.",
      );
    }
    if (!hasCompatibleTextTask(record)) {
      return denied(
        "model-binding-incompatible",
        "The selected model does not support conversation text generation.",
      );
    }
    if (!isRunnableModel(record)) {
      return denied(
        "model-binding-not-runnable",
        "The selected model is not ready for local text generation.",
      );
    }
    return { status: "ready", binding, record };
  }
}

export function isCompatibleRunnableModel(
  record: ModelInventoryRecord,
  workspaceId: WorkspaceId,
): boolean {
  return (
    record.workspaceId === workspaceId &&
    hasCompatibleTextTask(record) &&
    isRunnableModel(record)
  );
}

export function createSystemBuilderModelRevisionValue(
  record: ModelInventoryRecord,
): Readonly<Record<string, unknown>> {
  return {
    modelRecordId: record.modelRecordId,
    modelId: record.modelId,
    lifecycleStatus: record.lifecycleStatus,
    validationStatus: record.validationStatus ?? "unknown",
    taskTags: [...(record.taskTags ?? [])].sort(),
    updatedAt: record.updatedAt ?? record.createdAt,
  };
}

function hasCompatibleTextTask(record: ModelInventoryRecord): boolean {
  return (record.taskTags ?? []).some((task) => COMPATIBLE_TASKS.has(task));
}

function isRunnableModel(record: ModelInventoryRecord): boolean {
  return (
    USABLE_LIFECYCLE_STATUSES.has(record.lifecycleStatus) &&
    record.validationStatus !== "invalid" &&
    typeof record.modelId === "string" &&
    record.modelId.trim().length > 0
  );
}

function projectModelOption(
  record: ModelInventoryRecord,
): SystemBuilderModelOption {
  return {
    binding: createSystemBuilderModelBinding(record.modelRecordId),
    displayName: record.displayName,
    lifecycleStatus:
      record.lifecycleStatus as SystemBuilderModelOption["lifecycleStatus"],
    taskTags: (record.taskTags ?? []).filter((task) =>
      COMPATIBLE_TASKS.has(task),
    ) as SystemBuilderModelOption["taskTags"],
  };
}

function denied(
  code: SystemBuilderModelResolutionFailureCode,
  message: string,
): SystemBuilderModelResolution {
  return { status: "denied", code, message };
}
