export const SYSTEM_RUN_WORKFLOW_SCHEMA_VERSION = "1.0" as const;
export const MAX_SYSTEM_RUN_WORKFLOW_PROFILES = 64;
export const MAX_SYSTEM_RUN_WORKFLOW_ACTIONS = 32;
export const MAX_SYSTEM_RUN_WORKFLOW_FIELDS = 64;
export const MAX_SYSTEM_RUN_WORKFLOW_BLOCKS = 64;
export const MAX_SYSTEM_RUN_WORKFLOW_OPTIONS = 128;
export const MAX_SYSTEM_RUN_WORKFLOW_ROWS = 200;
export const MAX_SYSTEM_RUN_WORKFLOW_TEXT = 16_000;
export const MAX_SYSTEM_RUN_WORKFLOW_PREVIEW_BYTES = 8 * 1024 * 1024;

export type SystemRunWorkflowSourceKind =
  | "approved-release"
  | "reviewed-execution-plan";

export interface SystemRunWorkflowSource {
  readonly kind: SystemRunWorkflowSourceKind;
  readonly sourceId: string;
  readonly sourceDigest?: string;
  readonly sourceRevision?: string;
  readonly label: string;
}

export type SystemRunWorkflowAvailability = "available" | "blocked";

export interface SystemRunWorkflowBlocker {
  readonly code: string;
  readonly message: string;
}

export interface SystemRunWorkflowProfileSummary {
  readonly schemaVersion: typeof SYSTEM_RUN_WORKFLOW_SCHEMA_VERSION;
  readonly profileId: string;
  readonly source: SystemRunWorkflowSource;
  readonly title: string;
  readonly description: string;
  readonly category: string;
  readonly availability: SystemRunWorkflowAvailability;
  readonly blockers: readonly SystemRunWorkflowBlocker[];
}

export type SystemRunWorkflowValue = string | number | boolean | null;
export type SystemRunWorkflowValues = Readonly<
  Record<string, SystemRunWorkflowValue>
>;

export interface SystemRunWorkflowOption {
  readonly value: string;
  readonly label: string;
}

export type SystemRunWorkflowFieldKind =
  | "text"
  | "multiline"
  | "integer"
  | "number"
  | "boolean"
  | "select"
  | "secret-reference";

export interface SystemRunWorkflowField {
  readonly fieldId: string;
  readonly label: string;
  readonly description?: string;
  readonly kind: SystemRunWorkflowFieldKind;
  readonly required: boolean;
  readonly sensitive?: boolean;
  readonly defaultValue?: SystemRunWorkflowValue;
  readonly minimum?: number;
  readonly maximum?: number;
  readonly maximumLength?: number;
  readonly options?: readonly SystemRunWorkflowOption[];
}

export type SystemRunWorkflowActionIntent = "read" | "mutate" | "execute";
export type SystemRunWorkflowActionEmphasis =
  | "normal"
  | "caution"
  | "danger";

export interface SystemRunWorkflowAction {
  readonly actionId: string;
  readonly label: string;
  readonly description: string;
  readonly intent: SystemRunWorkflowActionIntent;
  readonly emphasis: SystemRunWorkflowActionEmphasis;
  readonly requiresConfirmation: boolean;
  readonly enabled: boolean;
  readonly disabledReason?: string;
  readonly fields: readonly SystemRunWorkflowField[];
}

export interface SystemRunWorkflowKeyValueEntry {
  readonly key: string;
  readonly label: string;
  readonly value: SystemRunWorkflowValue;
}

export interface SystemRunWorkflowTableColumn {
  readonly columnId: string;
  readonly label: string;
}

export interface SystemRunWorkflowTableRow {
  readonly rowId: string;
  readonly values: SystemRunWorkflowValues;
}

export interface SystemRunWorkflowTranscriptEntry {
  readonly entryId: string;
  readonly role: "user" | "assistant" | "system";
  readonly text: string;
  readonly occurredAt?: string;
}

export interface SystemRunWorkflowArtifactItem {
  readonly artifactRef: string;
  readonly label: string;
  readonly mediaType?: string;
  readonly summary?: string;
  readonly previewText?: string;
  readonly previewKind?: "text" | "table" | "image" | "pdf" | "unsupported";
  readonly previewStatus?:
    | "ready"
    | "unavailable"
    | "oversized"
    | "malformed"
    | "unsupported";
  readonly previewTable?: {
    readonly columns: readonly string[];
    readonly rows: readonly (readonly string[])[];
  };
  readonly previewBytes?: readonly number[];
  readonly truncated?: boolean;
}

export interface SystemRunWorkflowAuditItem {
  readonly entryId: string;
  readonly action: string;
  readonly outcome: "allowed" | "denied" | "failed";
  readonly occurredAt: string;
  readonly summary: string;
}

export interface SystemRunWorkflowDiagnostic {
  readonly severity: "info" | "warning" | "error";
  readonly code: string;
  readonly message: string;
}

export type SystemRunWorkflowResultBlock =
  | {
      readonly blockId: string;
      readonly kind: "notice";
      readonly title: string;
      readonly message: string;
      readonly tone: "neutral" | "success" | "warning" | "danger";
    }
  | {
      readonly blockId: string;
      readonly kind: "status";
      readonly title: string;
      readonly status: string;
      readonly summary?: string;
    }
  | {
      readonly blockId: string;
      readonly kind: "key-value";
      readonly title: string;
      readonly entries: readonly SystemRunWorkflowKeyValueEntry[];
    }
  | {
      readonly blockId: string;
      readonly kind: "table";
      readonly title: string;
      readonly columns: readonly SystemRunWorkflowTableColumn[];
      readonly rows: readonly SystemRunWorkflowTableRow[];
      readonly emptyMessage?: string;
    }
  | {
      readonly blockId: string;
      readonly kind: "transcript";
      readonly title: string;
      readonly entries: readonly SystemRunWorkflowTranscriptEntry[];
    }
  | {
      readonly blockId: string;
      readonly kind: "artifacts";
      readonly title: string;
      readonly items: readonly SystemRunWorkflowArtifactItem[];
    }
  | {
      readonly blockId: string;
      readonly kind: "audit";
      readonly title: string;
      readonly items: readonly SystemRunWorkflowAuditItem[];
    }
  | {
      readonly blockId: string;
      readonly kind: "diagnostics";
      readonly title: string;
      readonly items: readonly SystemRunWorkflowDiagnostic[];
    };

export interface SystemRunWorkflowSnapshot {
  readonly schemaVersion: typeof SYSTEM_RUN_WORKFLOW_SCHEMA_VERSION;
  readonly profile: SystemRunWorkflowProfileSummary;
  readonly snapshotRevision: string;
  readonly blocks: readonly SystemRunWorkflowResultBlock[];
  readonly actions: readonly SystemRunWorkflowAction[];
  readonly refreshedAt: string;
}
