import type { SystemBuilderRecord, SystemBuilderRevisionId, SystemBuilderSystemId, SystemBuilderTemplateId } from "../system-builder";
import type { WorkspaceId } from "../workspace";
import type { ConversationTurnStatus } from "../conversations";
import type { ExecutionRunStatus } from "../execution-runs";
import type { HeadlessSystemManagementRequest } from "./headless-system-management";
import type { HeadlessIngestionStatus } from "./headless-data-task-status";
import type { HeadlessDatasetVersionBatch } from "./headless-dataset-metadata";
import type { DatasetVersionComparison } from "../dataset";
import type {HeadlessDatasetPreparationPreview} from "./headless-dataset-preparation";
import type {HeadlessDatasetTaskStatus} from "./headless-dataset-task-status";
import type {HeadlessDatasetTaskReview} from "./headless-dataset-task-review";
import {
  HEADLESS_CONTRACT_VERSION,
  type HeadlessChangeCursor,
  type HeadlessHostIncarnationId,
  type HeadlessReadOperation,
  type HeadlessReadRequestParseResult,
} from "./headless-read-request";

export type HeadlessSystemSummary = Pick<
  SystemBuilderRecord, "systemId" | "name" | "status" | "revision" | "currentRevisionId"
>;

type HeadlessSavedReference = {
  readonly systemId: SystemBuilderSystemId;
  readonly recordRevision: number;
  readonly revisionId: SystemBuilderRevisionId | null;
};
export type HeadlessSavedSnapshot = {
  readonly systems: readonly (HeadlessSavedReference & { readonly status: SystemBuilderRecord["status"] })[];
  readonly cursor: HeadlessChangeCursor;
};
export type HeadlessSavedChanges = { readonly kind: "resync" } | {
  readonly kind: "changes";
  readonly events: readonly (HeadlessSavedReference & { readonly sequence: number })[];
  readonly cursor: HeadlessChangeCursor;
  readonly more: boolean;
};

type WorkflowProfile = {
  readonly profileId: string;
  readonly source: Omit<import("../system-run-workflow").SystemRunWorkflowSource, "label">;
  readonly title: string;
  readonly availability: "available" | "blocked";
  readonly blockers: readonly { readonly code: string }[];
};
type WorkflowField = {
  readonly fieldId: string;
  readonly kind: Exclude<import("../system-run-workflow").SystemRunWorkflowFieldKind, "secret-reference">;
  readonly required: boolean;
  readonly minimum?: number;
  readonly maximum?: number;
  readonly maximumLength?: number;
  readonly options?: readonly string[];
};

import type {HeadlessContextModels, HeadlessContextPreview} from "./headless-context-preview";
import type {HeadlessContextTaskValue} from "./headless-context-task";
import type {HeadlessContextSavedValue} from "./headless-context-result-plan";
import type {HeadlessContextRebuildValue} from "./headless-context-rebuild";
import type {HeadlessContextQueryPreviewValue} from "./headless-context-query-preview";
import type {HeadlessModelInventory, HeadlessModelRecord} from "./headless-model-metadata";
import type {HeadlessModelSourcePreview} from "./headless-model-source-preview";
import type {HeadlessModelTaskValue} from "./headless-model-task";

export type HeadlessReadResult =
  | {readonly ok: true; readonly operation: "models.task"; readonly value: HeadlessModelTaskValue}
  | {readonly ok: true; readonly operation: "models.preview-source"; readonly value: HeadlessModelSourcePreview}
  | {readonly ok: true; readonly operation: "models.inventory"; readonly value: HeadlessModelInventory}
  | {readonly ok: true; readonly operation: "models.record"; readonly value: HeadlessModelRecord}
  | {readonly ok: true; readonly operation: "context.preview-query"; readonly value: HeadlessContextQueryPreviewValue}
  | {readonly ok: true; readonly operation: "context.preview-rebuild"; readonly value: HeadlessContextRebuildValue}
  | {readonly ok: true; readonly operation: "context.saved"; readonly value: HeadlessContextSavedValue}
  | {readonly ok: true; readonly operation: "context.task"; readonly value: HeadlessContextTaskValue}
  | {readonly ok: true; readonly operation: "context.models"; readonly value: HeadlessContextModels}
  | {readonly ok: true; readonly operation: "context.preview-generation"; readonly value: HeadlessContextPreview}
  | { readonly ok: true; readonly operation: "data.ingestion-status"; readonly value: HeadlessIngestionStatus }
  | { readonly ok: true; readonly operation: "data.dataset-versions"; readonly value: HeadlessDatasetVersionBatch }
  | { readonly ok: true; readonly operation: "data.compare-dataset-versions"; readonly value: DatasetVersionComparison }
  | { readonly ok: true; readonly operation: "data.preview-dataset-preparation"; readonly value: HeadlessDatasetPreparationPreview }
  | { readonly ok: true; readonly operation: "data.dataset-task-status"; readonly value: HeadlessDatasetTaskStatus }
  | { readonly ok: true; readonly operation: "data.dataset-task-review"; readonly value: HeadlessDatasetTaskReview }
  | {
      readonly ok: true;
      readonly operation: "host.describe";
      readonly value: {
        readonly version: typeof HEADLESS_CONTRACT_VERSION;
        readonly hostIncarnationId: HeadlessHostIncarnationId;
        readonly workspaces: readonly WorkspaceId[];
        readonly operations: readonly HeadlessReadOperation[];
      };
    }
  | { readonly ok: true; readonly operation: "workspaces.list"; readonly value: readonly {
      readonly workspaceId: WorkspaceId; readonly displayName: string;
    }[] }
  | { readonly ok: true; readonly operation: "systems.list"; readonly value: readonly HeadlessSystemSummary[] }
  | { readonly ok: true; readonly operation: "systems.read"; readonly value: HeadlessSystemSummary }
  | { readonly ok: true; readonly operation: "systems.snapshot"; readonly value: HeadlessSavedSnapshot }
  | { readonly ok: true; readonly operation: "systems.changes"; readonly value: HeadlessSavedChanges }
  | { readonly ok: true; readonly operation: "workflows.list"; readonly value: readonly WorkflowProfile[] }
  | { readonly ok: true; readonly operation: "workflows.prepare"; readonly value: {
    readonly profile: WorkflowProfile; readonly snapshotRevision: string;
    /** Only a current conversation grant may receive these saved handles. */
    readonly approvedSessionIds?: readonly string[];
    readonly actions: readonly {
      readonly actionId: string; readonly intent: "read"; readonly enabled: boolean; readonly requiresConfirmation: false;
      readonly fields: readonly WorkflowField[];
    }[];
  } }
  | { readonly ok: true; readonly operation: "conversation-tasks.read"; readonly value: {
    readonly sessionId: string; readonly turnId: string; readonly turnStatus: ConversationTurnStatus;
    readonly run: { readonly runId: string; readonly status: ExecutionRunStatus } | null;
  } }
  | { readonly ok: true; readonly operation: "templates.list"; readonly value: readonly {
      readonly templateId: SystemBuilderTemplateId; readonly displayName: string;
    }[] }
  | { readonly ok: true; readonly operation: "plan.capabilities"; readonly value: {
    readonly workspaceId: WorkspaceId;
    readonly actions: readonly HeadlessSystemManagementRequest["operation"][];
    readonly approval: "required";
  } }
  | {
      readonly ok: false;
      readonly code: Extract<HeadlessReadRequestParseResult, { ok: false }>["code"] |
        "headless.forbidden" | "headless.unavailable" | "headless.not-found" | "headless.result-too-large" | "headless.stale" | "headless.source-not-ready";
    };
