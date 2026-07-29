import {
  MAX_SYSTEM_RUN_WORKFLOW_ACTIONS,
  MAX_SYSTEM_RUN_WORKFLOW_BLOCKS,
  MAX_SYSTEM_RUN_WORKFLOW_FIELDS,
  MAX_SYSTEM_RUN_WORKFLOW_OPTIONS,
  MAX_SYSTEM_RUN_WORKFLOW_PREVIEW_BYTES,
  MAX_SYSTEM_RUN_WORKFLOW_ROWS,
  MAX_SYSTEM_RUN_WORKFLOW_TEXT,
  SYSTEM_RUN_WORKFLOW_SCHEMA_VERSION,
  type SystemRunWorkflowAction,
  type SystemRunWorkflowField,
  type SystemRunWorkflowProfileSummary,
  type SystemRunWorkflowResultBlock,
  type SystemRunWorkflowSnapshot,
  type SystemRunWorkflowSource,
  type SystemRunWorkflowValue,
  type SystemRunWorkflowValues,
} from "./system-run-workflow-models";

const SAFE_ID = /^[a-zA-Z0-9][a-zA-Z0-9._:@/-]{0,199}$/;
const DIGEST = /^sha256:[a-f0-9]{64}$/;

const id = (value: string, label: string): string => {
  const normalized = value.trim();
  if (!SAFE_ID.test(normalized) || normalized.includes(".."))
    throw new Error(`${label} must be a safe identifier.`);
  return normalized;
};

const text = (
  value: string,
  label: string,
  maximum = MAX_SYSTEM_RUN_WORKFLOW_TEXT,
): string => {
  const normalized = value.trim();
  if (!normalized || normalized.length > maximum)
    throw new Error(`${label} must be non-empty and at most ${maximum} characters.`);
  return normalized;
};

const optionalText = (
  value: string | undefined,
  label: string,
): string | undefined =>
  value === undefined ? undefined : text(value, label);

const assertCount = (
  values: readonly unknown[],
  maximum: number,
  label: string,
): void => {
  if (values.length > maximum)
    throw new Error(`${label} cannot contain more than ${maximum} items.`);
};

const primitive = (
  value: unknown,
  label: string,
): SystemRunWorkflowValue => {
  if (
    value !== null &&
    typeof value !== "string" &&
    typeof value !== "number" &&
    typeof value !== "boolean"
  )
    throw new Error(`${label} must be a scalar value.`);
  if (typeof value === "string" && value.length > MAX_SYSTEM_RUN_WORKFLOW_TEXT)
    throw new Error(`${label} exceeds the text limit.`);
  if (typeof value === "number" && !Number.isFinite(value))
    throw new Error(`${label} must be finite.`);
  return value;
};

export const normalizeSystemRunWorkflowSource = (
  value: SystemRunWorkflowSource,
): SystemRunWorkflowSource => {
  if (
    value.kind !== "approved-release" &&
    value.kind !== "reviewed-execution-plan"
  )
    throw new Error("Workflow source kind is unsupported.");
  const sourceDigest = value.sourceDigest?.trim().toLowerCase();
  if (sourceDigest && !DIGEST.test(sourceDigest))
    throw new Error("Workflow source digest must be a SHA-256 digest.");
  if (value.kind === "approved-release" && !sourceDigest)
    throw new Error("Approved-release workflow sources require a digest.");
  if (value.kind === "reviewed-execution-plan" && sourceDigest)
    throw new Error(
      "Reviewed execution-plan workflow sources cannot use a release digest.",
    );
  const sourceRevision = value.sourceRevision?.trim();
  if (value.kind === "reviewed-execution-plan" && !sourceRevision)
    throw new Error(
      "Reviewed execution-plan workflow sources require an exact revision.",
    );
  if (value.kind === "approved-release" && sourceRevision)
    throw new Error("Approved-release workflow sources cannot use a plan revision.");
  return {
    kind: value.kind,
    sourceId: id(value.sourceId, "Workflow source id"),
    ...(sourceDigest ? { sourceDigest } : {}),
    ...(sourceRevision
      ? { sourceRevision: id(sourceRevision, "Workflow source revision") }
      : {}),
    label: text(value.label, "Workflow source label", 240),
  };
};

const normalizeBlocker = (
  value: SystemRunWorkflowProfileSummary["blockers"][number],
) => ({
  code: id(value.code, "Workflow blocker code"),
  message: text(value.message, "Workflow blocker message", 1_000),
});

export const normalizeSystemRunWorkflowProfile = (
  value: SystemRunWorkflowProfileSummary,
): SystemRunWorkflowProfileSummary => {
  if (value.schemaVersion !== SYSTEM_RUN_WORKFLOW_SCHEMA_VERSION)
    throw new Error("Workflow profile schema version is unsupported.");
  if (value.availability !== "available" && value.availability !== "blocked")
    throw new Error("Workflow availability is unsupported.");
  assertCount(value.blockers, 32, "Workflow blockers");
  const blockers = value.blockers.map(normalizeBlocker);
  if (value.availability === "available" && blockers.length > 0)
    throw new Error("Available workflow profiles cannot contain blockers.");
  if (value.availability === "blocked" && blockers.length === 0)
    throw new Error("Blocked workflow profiles require a blocker.");
  return {
    schemaVersion: SYSTEM_RUN_WORKFLOW_SCHEMA_VERSION,
    profileId: id(value.profileId, "Workflow profile id"),
    source: normalizeSystemRunWorkflowSource(value.source),
    title: text(value.title, "Workflow title", 240),
    description: text(value.description, "Workflow description", 1_000),
    category: id(value.category, "Workflow category"),
    availability: value.availability,
    blockers,
  };
};

const normalizeField = (
  value: SystemRunWorkflowField,
): SystemRunWorkflowField => {
  const kinds = new Set([
    "text",
    "multiline",
    "integer",
    "number",
    "boolean",
    "select",
    "secret-reference",
  ]);
  if (!kinds.has(value.kind)) throw new Error("Workflow field kind is unsupported.");
  const options = value.options ?? [];
  assertCount(options, MAX_SYSTEM_RUN_WORKFLOW_OPTIONS, "Workflow field options");
  if (value.kind === "select" && options.length === 0)
    throw new Error("Select workflow fields require options.");
  if (value.kind !== "select" && options.length > 0)
    throw new Error("Only select workflow fields may contain options.");
  if (
    value.minimum !== undefined &&
    value.maximum !== undefined &&
    value.minimum > value.maximum
  )
    throw new Error("Workflow field minimum cannot exceed maximum.");
  if (
    value.maximumLength !== undefined &&
    (!Number.isInteger(value.maximumLength) ||
      value.maximumLength < 1 ||
      value.maximumLength > MAX_SYSTEM_RUN_WORKFLOW_TEXT)
  )
    throw new Error("Workflow field maximum length is invalid.");
  return {
    fieldId: id(value.fieldId, "Workflow field id"),
    label: text(value.label, "Workflow field label", 240),
    ...(optionalText(value.description, "Workflow field description")
      ? {
          description: optionalText(
            value.description,
            "Workflow field description",
          ),
        }
      : {}),
    kind: value.kind,
    required: value.required,
    ...(value.sensitive ? { sensitive: true } : {}),
    ...(value.defaultValue !== undefined
      ? {
          defaultValue: primitive(
            value.defaultValue,
            "Workflow field default value",
          ),
        }
      : {}),
    ...(value.minimum !== undefined ? { minimum: value.minimum } : {}),
    ...(value.maximum !== undefined ? { maximum: value.maximum } : {}),
    ...(value.maximumLength !== undefined
      ? { maximumLength: value.maximumLength }
      : {}),
    ...(options.length
      ? {
          options: options.map((option) => ({
            value: id(option.value, "Workflow option value"),
            label: text(option.label, "Workflow option label", 240),
          })),
        }
      : {}),
  };
};

const unique = (values: readonly string[], label: string): void => {
  if (new Set(values).size !== values.length)
    throw new Error(`${label} must be unique.`);
};

const normalizeAction = (
  value: SystemRunWorkflowAction,
): SystemRunWorkflowAction => {
  if (!["read", "mutate", "execute"].includes(value.intent))
    throw new Error("Workflow action intent is unsupported.");
  if (!["normal", "caution", "danger"].includes(value.emphasis))
    throw new Error("Workflow action emphasis is unsupported.");
  assertCount(value.fields, MAX_SYSTEM_RUN_WORKFLOW_FIELDS, "Workflow fields");
  const fields = value.fields.map(normalizeField);
  unique(
    fields.map((field) => field.fieldId),
    "Workflow field ids",
  );
  if (
    (value.intent === "mutate" || value.intent === "execute") &&
    !value.requiresConfirmation
  )
    throw new Error("State-changing workflow actions require confirmation.");
  return {
    actionId: id(value.actionId, "Workflow action id"),
    label: text(value.label, "Workflow action label", 240),
    description: text(value.description, "Workflow action description", 1_000),
    intent: value.intent,
    emphasis: value.emphasis,
    requiresConfirmation: value.requiresConfirmation,
    enabled: value.enabled,
    ...(optionalText(value.disabledReason, "Workflow disabled reason")
      ? {
          disabledReason: optionalText(
            value.disabledReason,
            "Workflow disabled reason",
          ),
        }
      : {}),
    fields,
  };
};

export const normalizeSystemRunWorkflowValues = (
  value: Readonly<Record<string, unknown>>,
): SystemRunWorkflowValues => {
  const entries = Object.entries(value);
  assertCount(entries, MAX_SYSTEM_RUN_WORKFLOW_FIELDS, "Workflow values");
  const normalized: Record<string, SystemRunWorkflowValue> = {};
  for (const [key, item] of entries)
    normalized[id(key, "Workflow value field id")] = primitive(
      item,
      `Workflow value ${key}`,
    );
  return normalized;
};

const normalizeBlock = (
  value: SystemRunWorkflowResultBlock,
): SystemRunWorkflowResultBlock => {
  const blockId = id(value.blockId, "Workflow block id");
  const title = text(value.title, "Workflow block title", 240);
  switch (value.kind) {
    case "notice":
      if (!["neutral", "success", "warning", "danger"].includes(value.tone))
        throw new Error("Workflow notice tone is unsupported.");
      return {
        blockId,
        kind: value.kind,
        title,
        message: text(value.message, "Workflow notice message"),
        tone: value.tone,
      };
    case "status":
      return {
        blockId,
        kind: value.kind,
        title,
        status: id(value.status, "Workflow status"),
        ...(optionalText(value.summary, "Workflow status summary")
          ? { summary: optionalText(value.summary, "Workflow status summary") }
          : {}),
      };
    case "key-value":
      assertCount(value.entries, MAX_SYSTEM_RUN_WORKFLOW_ROWS, "Workflow entries");
      return {
        blockId,
        kind: value.kind,
        title,
        entries: value.entries.map((entry) => ({
          key: id(entry.key, "Workflow entry key"),
          label: text(entry.label, "Workflow entry label", 240),
          value: primitive(entry.value, "Workflow entry value"),
        })),
      };
    case "table": {
      assertCount(value.columns, MAX_SYSTEM_RUN_WORKFLOW_FIELDS, "Workflow columns");
      assertCount(value.rows, MAX_SYSTEM_RUN_WORKFLOW_ROWS, "Workflow rows");
      const columns = value.columns.map((column) => ({
        columnId: id(column.columnId, "Workflow column id"),
        label: text(column.label, "Workflow column label", 240),
      }));
      unique(
        columns.map((column) => column.columnId),
        "Workflow column ids",
      );
      return {
        blockId,
        kind: value.kind,
        title,
        columns,
        rows: value.rows.map((row) => ({
          rowId: id(row.rowId, "Workflow row id"),
          values: normalizeSystemRunWorkflowValues(row.values),
        })),
        ...(optionalText(value.emptyMessage, "Workflow empty message")
          ? {
              emptyMessage: optionalText(
                value.emptyMessage,
                "Workflow empty message",
              ),
            }
          : {}),
      };
    }
    case "transcript":
      assertCount(
        value.entries,
        MAX_SYSTEM_RUN_WORKFLOW_ROWS,
        "Workflow transcript",
      );
      return {
        blockId,
        kind: value.kind,
        title,
        entries: value.entries.map((entry) => {
          if (!["user", "assistant", "system"].includes(entry.role))
            throw new Error("Workflow transcript role is unsupported.");
          return {
            entryId: id(entry.entryId, "Workflow transcript entry id"),
            role: entry.role,
            text: text(entry.text, "Workflow transcript text"),
            ...(optionalText(entry.occurredAt, "Workflow transcript timestamp")
              ? {
                  occurredAt: optionalText(
                    entry.occurredAt,
                    "Workflow transcript timestamp",
                  ),
                }
              : {}),
          };
        }),
      };
    case "artifacts":
      assertCount(value.items, MAX_SYSTEM_RUN_WORKFLOW_ROWS, "Workflow artifacts");
      return {
        blockId,
        kind: value.kind,
        title,
        items: value.items.map((item) => {
          if (
            item.previewKind &&
            !["text", "table", "image", "pdf", "unsupported"].includes(
              item.previewKind,
            )
          )
            throw new Error("Workflow artifact preview kind is unsupported.");
          if (
            item.previewStatus &&
            ![
              "ready",
              "unavailable",
              "oversized",
              "malformed",
              "unsupported",
            ].includes(item.previewStatus)
          )
            throw new Error("Workflow artifact preview status is unsupported.");
          if (
            item.previewBytes &&
            (item.previewBytes.length > MAX_SYSTEM_RUN_WORKFLOW_PREVIEW_BYTES ||
              item.previewBytes.some(
                (byte) =>
                  !Number.isInteger(byte) || byte < 0 || byte > 255,
              ))
          )
            throw new Error("Workflow artifact preview bytes are invalid.");
          if (item.previewTable) {
            assertCount(
              item.previewTable.columns,
              MAX_SYSTEM_RUN_WORKFLOW_FIELDS,
              "Workflow preview columns",
            );
            assertCount(
              item.previewTable.rows,
              MAX_SYSTEM_RUN_WORKFLOW_ROWS,
              "Workflow preview rows",
            );
          }
          return {
          artifactRef: id(item.artifactRef, "Workflow artifact reference"),
          label: text(item.label, "Workflow artifact label", 240),
          ...(optionalText(item.mediaType, "Workflow artifact media type")
            ? {
                mediaType: optionalText(
                  item.mediaType,
                  "Workflow artifact media type",
                ),
              }
            : {}),
          ...(optionalText(item.summary, "Workflow artifact summary")
            ? {
                summary: optionalText(
                  item.summary,
                  "Workflow artifact summary",
                ),
              }
            : {}),
          ...(optionalText(item.previewText, "Workflow artifact preview")
            ? {
                previewText: optionalText(
                  item.previewText,
                  "Workflow artifact preview",
                ),
              }
            : {}),
          ...(item.previewKind ? { previewKind: item.previewKind } : {}),
          ...(item.previewStatus ? { previewStatus: item.previewStatus } : {}),
          ...(item.previewTable
            ? {
                previewTable: {
                  columns: item.previewTable.columns.map((column) =>
                    text(column, "Workflow preview column", 240),
                  ),
                  rows: item.previewTable.rows.map((row) => {
                    assertCount(
                      row,
                      MAX_SYSTEM_RUN_WORKFLOW_FIELDS,
                      "Workflow preview row",
                    );
                    return row.map((cell) =>
                      text(cell, "Workflow preview cell", 1_000),
                    );
                  }),
                },
              }
            : {}),
          ...(item.previewBytes
            ? { previewBytes: [...item.previewBytes] }
            : {}),
          ...(item.truncated ? { truncated: true } : {}),
          };
        }),
      };
    case "audit":
      assertCount(value.items, MAX_SYSTEM_RUN_WORKFLOW_ROWS, "Workflow audit");
      return {
        blockId,
        kind: value.kind,
        title,
        items: value.items.map((item) => {
          if (!["allowed", "denied", "failed"].includes(item.outcome))
            throw new Error("Workflow audit outcome is unsupported.");
          return {
            entryId: id(item.entryId, "Workflow audit entry id"),
            action: id(item.action, "Workflow audit action"),
            outcome: item.outcome,
            occurredAt: text(
              item.occurredAt,
              "Workflow audit timestamp",
              240,
            ),
            summary: text(item.summary, "Workflow audit summary", 1_000),
          };
        }),
      };
    case "diagnostics":
      assertCount(
        value.items,
        MAX_SYSTEM_RUN_WORKFLOW_ROWS,
        "Workflow diagnostics",
      );
      return {
        blockId,
        kind: value.kind,
        title,
        items: value.items.map((item) => {
          if (!["info", "warning", "error"].includes(item.severity))
            throw new Error("Workflow diagnostic severity is unsupported.");
          return {
            severity: item.severity,
            code: id(item.code, "Workflow diagnostic code"),
            message: text(item.message, "Workflow diagnostic message", 1_000),
          };
        }),
      };
  }
};

export const normalizeSystemRunWorkflowSnapshot = (
  value: SystemRunWorkflowSnapshot,
): SystemRunWorkflowSnapshot => {
  if (value.schemaVersion !== SYSTEM_RUN_WORKFLOW_SCHEMA_VERSION)
    throw new Error("Workflow snapshot schema version is unsupported.");
  assertCount(value.blocks, MAX_SYSTEM_RUN_WORKFLOW_BLOCKS, "Workflow blocks");
  assertCount(value.actions, MAX_SYSTEM_RUN_WORKFLOW_ACTIONS, "Workflow actions");
  const blocks = value.blocks.map(normalizeBlock);
  const actions = value.actions.map(normalizeAction);
  unique(
    blocks.map((block) => block.blockId),
    "Workflow block ids",
  );
  unique(
    actions.map((action) => action.actionId),
    "Workflow action ids",
  );
  return {
    schemaVersion: SYSTEM_RUN_WORKFLOW_SCHEMA_VERSION,
    profile: normalizeSystemRunWorkflowProfile(value.profile),
    snapshotRevision: id(
      value.snapshotRevision,
      "Workflow snapshot revision",
    ),
    blocks,
    actions,
    refreshedAt: text(value.refreshedAt, "Workflow refresh timestamp", 240),
  };
};
