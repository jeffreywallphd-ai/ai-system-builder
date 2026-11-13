import type { SystemBuilderRecord, SystemBuilderRevisionId, SystemBuilderSystemId, SystemBuilderTemplateId } from "../system-builder";
import type { WorkspaceId } from "../workspace";
import type { ConversationTurnStatus } from "../conversations";
import type { ExecutionRunStatus } from "../execution-runs";
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

export type HeadlessReadResult =
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
  | {
      readonly ok: false;
      readonly code: Extract<HeadlessReadRequestParseResult, { ok: false }>["code"] |
        "headless.forbidden" | "headless.unavailable" | "headless.not-found" | "headless.result-too-large" | "headless.stale";
    };
