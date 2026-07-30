import type { DatasetPreparationTaskType } from "./dataset-preparation";

export const DATASET_PREPARATION_OUTPUT_SHAPE_SCHEMA_VERSION = "1" as const;
export const DATASET_PREPARATION_OUTPUT_SHAPE_MAX_DEPTH = 5;
export const DATASET_PREPARATION_OUTPUT_SHAPE_MAX_FIELDS = 40;
export const DATASET_PREPARATION_OUTPUT_SHAPE_MAX_CHOICES = 64;
export const DATASET_PREPARATION_OUTPUT_SHAPE_MAX_LIST_ITEMS = 32;
export const DATASET_PREPARATION_OUTPUT_SHAPE_MAX_BYTES = 32 * 1024;

export const DATASET_PREPARATION_OUTPUT_FIELD_KINDS = [
  "text",
  "number",
  "boolean",
  "group",
  "text-list",
  "record",
] as const;
export type DatasetPreparationOutputFieldKind =
  (typeof DATASET_PREPARATION_OUTPUT_FIELD_KINDS)[number];

export const DATASET_PREPARATION_OUTPUT_PURPOSES = [
  "instruction",
  "input",
  "output",
  "label",
  "expected-output",
  "anchor-text",
  "positive-text",
  "query",
  "passage",
  "caption",
] as const;
export type DatasetPreparationOutputPurpose =
  (typeof DATASET_PREPARATION_OUTPUT_PURPOSES)[number];

export interface DatasetPreparationVisualOutputField {
  id: string;
  name: string;
  kind: DatasetPreparationOutputFieldKind;
  required: boolean;
  purpose?: DatasetPreparationOutputPurpose;
  children?: DatasetPreparationVisualOutputField[];
  choices?: string[];
  maxLength?: number;
  maxItems?: number;
}

export interface DatasetPreparationVisualOutputShape {
  schemaVersion: typeof DATASET_PREPARATION_OUTPUT_SHAPE_SCHEMA_VERSION;
  taskType: DatasetPreparationTaskType;
  fields: DatasetPreparationVisualOutputField[];
}

export const DATASET_PREPARATION_OUTPUT_SHAPE_DIAGNOSTIC_CODES = [
  "shape-invalid",
  "task-mismatch",
  "field-count-invalid",
  "field-depth-invalid",
  "field-id-invalid",
  "field-id-duplicate",
  "field-name-invalid",
  "field-name-unsafe",
  "field-name-protected",
  "field-name-duplicate",
  "field-kind-invalid",
  "field-required-invalid",
  "field-children-invalid",
  "field-choices-invalid",
  "field-limit-invalid",
  "purpose-invalid",
  "purpose-incompatible",
  "purpose-missing",
  "purpose-duplicate",
  "shape-bytes-exceeded",
  "nested-csv-unsupported",
  "decoder-dynamic-record-unsupported",
] as const;
export type DatasetPreparationOutputShapeDiagnosticCode =
  (typeof DATASET_PREPARATION_OUTPUT_SHAPE_DIAGNOSTIC_CODES)[number];

export interface DatasetPreparationOutputShapeDiagnostic {
  severity: "error" | "warning";
  code: DatasetPreparationOutputShapeDiagnosticCode;
  message: string;
  fieldId?: string;
}

export interface DatasetPreparationCompiledOutputShape {
  shape: DatasetPreparationVisualOutputShape;
  payloadKey: "example" | "value";
  exampleSchema: Record<string, unknown>;
  envelopeSchema: Record<string, unknown>;
  purposePaths: Partial<
    Record<DatasetPreparationOutputPurpose, readonly string[]>
  >;
  canonicalFingerprintMaterial: string;
  decoderCompatible: boolean;
}

export type DatasetPreparationOutputShapeCompileResult =
  | {
      ok: true;
      value: DatasetPreparationCompiledOutputShape;
      diagnostics: DatasetPreparationOutputShapeDiagnostic[];
    }
  | {
      ok: false;
      diagnostics: DatasetPreparationOutputShapeDiagnostic[];
    };

export interface DatasetPreparationOutputShapeCompileOptions {
  taskType: DatasetPreparationTaskType;
  outputFormat?: "jsonl" | "json" | "csv" | "parquet";
  multiLabel?: boolean;
  allowedLabels?: readonly string[];
}

const FIELD_ID_PATTERN = /^[a-z][a-z0-9-]{0,63}$/;
const FIELD_NAME_PATTERN = /^[A-Za-z_][A-Za-z0-9_-]{0,63}$/;
const UNSAFE_FIELD_NAMES = new Set(["__proto__", "prototype", "constructor"]);
const PROTECTED_ROOT_FIELD_NAMES = new Set([
  "schemaVersion",
  "taskType",
  "fieldKind",
  "status",
  "example",
  "value",
  "artifactId",
  "candidateIndex",
  "chunkIndex",
  "generationMode",
  "sourceArtifactId",
  "sourceAttribution",
  "sourceLineage",
  "sourceRowIndex",
]);
const MAX_FIELD_LENGTH = 8_000;
const MAX_FIELD_CHOICE_LENGTH = 120;

export function createDatasetPreparationSourceAttributionSchema(): Record<
  string,
  unknown
> {
  return {
    type: "object",
    additionalProperties: false,
    required: ["sourceArtifactId"],
    properties: {
      sourceArtifactId: { type: "string", minLength: 1, maxLength: 512 },
      sourceName: { type: "string", minLength: 1, maxLength: 512 },
      sourceUri: { type: "string", minLength: 1, maxLength: 2_048 },
      sourceAuthor: { type: "string", minLength: 1, maxLength: 1_000 },
      sourceLicense: { type: "string", minLength: 1, maxLength: 512 },
    },
  };
}

export interface DatasetPreparationOutputPurposeDescription {
  readonly label: string;
  readonly kinds: readonly DatasetPreparationOutputFieldKind[];
  readonly allowEmpty?: boolean;
  readonly maxLength?: number;
}

const PURPOSE_SPECS: Record<
  DatasetPreparationOutputPurpose,
  DatasetPreparationOutputPurposeDescription
> = {
  instruction: { label: "Instruction", kinds: ["text"], maxLength: 2_000 },
  input: {
    label: "Supporting input",
    kinds: ["text"],
    allowEmpty: true,
    maxLength: MAX_FIELD_LENGTH,
  },
  output: { label: "Answer", kinds: ["text"], maxLength: MAX_FIELD_LENGTH },
  label: { label: "Label", kinds: ["text", "text-list"], maxLength: 120 },
  "expected-output": {
    label: "Extracted information",
    kinds: ["group", "record"],
  },
  "anchor-text": { label: "Search text", kinds: ["text"], maxLength: 2_000 },
  "positive-text": {
    label: "Matching passage",
    kinds: ["text"],
    maxLength: MAX_FIELD_LENGTH,
  },
  query: { label: "Search query", kinds: ["text"], maxLength: 2_000 },
  passage: {
    label: "Relevant passage",
    kinds: ["text"],
    maxLength: MAX_FIELD_LENGTH,
  },
  caption: { label: "Caption", kinds: ["text"], maxLength: 500 },
};

const TASK_PURPOSES: Record<
  DatasetPreparationTaskType,
  readonly DatasetPreparationOutputPurpose[]
> = {
  "llm-instruction": ["instruction", "input", "output"],
  "llm-classification": ["label"],
  "llm-extraction": ["expected-output"],
  "llm-embedding": ["anchor-text", "positive-text"],
  "llm-reranker": ["query", "passage"],
  "diffusion-lora": ["caption"],
  "vision-classification": ["label"],
  "vision-detection": ["label"],
  "vision-segmentation": ["label"],
};

const METADATA_TASKS = new Set<DatasetPreparationTaskType>([
  "diffusion-lora",
  "vision-classification",
  "vision-detection",
  "vision-segmentation",
]);

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const boundedInteger = (
  value: unknown,
  minimum: number,
  maximum: number,
): number | undefined =>
  typeof value === "number" &&
  Number.isSafeInteger(value) &&
  value >= minimum &&
  value <= maximum
    ? value
    : undefined;

const field = (
  id: string,
  name: string,
  kind: DatasetPreparationOutputFieldKind,
  purpose: DatasetPreparationOutputPurpose,
  options: Partial<DatasetPreparationVisualOutputField> = {},
): DatasetPreparationVisualOutputField => ({
  id,
  name,
  kind,
  required: true,
  purpose,
  ...options,
});

export function listDatasetPreparationRequiredOutputPurposes(
  taskType: DatasetPreparationTaskType,
): readonly DatasetPreparationOutputPurpose[] {
  return TASK_PURPOSES[taskType];
}

export function describeDatasetPreparationOutputPurpose(
  purpose: DatasetPreparationOutputPurpose,
): DatasetPreparationOutputPurposeDescription {
  return PURPOSE_SPECS[purpose];
}

export function createDefaultDatasetPreparationVisualOutputShape(
  taskType: DatasetPreparationTaskType,
  options: { multiLabel?: boolean } = {},
): DatasetPreparationVisualOutputShape {
  let fields: DatasetPreparationVisualOutputField[];
  switch (taskType) {
    case "llm-instruction":
      fields = [
        field("instruction", "instruction", "text", "instruction", {
          maxLength: 2_000,
        }),
        field("input", "input", "text", "input", {
          maxLength: MAX_FIELD_LENGTH,
        }),
        field("output", "output", "text", "output", {
          maxLength: MAX_FIELD_LENGTH,
        }),
      ];
      break;
    case "llm-classification":
      fields = [
        field(
          "label",
          "label",
          options.multiLabel ? "text-list" : "text",
          "label",
          options.multiLabel ? { maxItems: 32, maxLength: 120 } : { maxLength: 120 },
        ),
      ];
      break;
    case "llm-extraction":
      fields = [
        field(
          "expected-output",
          "expectedOutput",
          "record",
          "expected-output",
        ),
      ];
      break;
    case "llm-embedding":
      fields = [
        field("anchor-text", "anchorText", "text", "anchor-text", {
          maxLength: 2_000,
        }),
        field("positive-text", "positiveText", "text", "positive-text", {
          maxLength: MAX_FIELD_LENGTH,
        }),
      ];
      break;
    case "llm-reranker":
      fields = [
        field("query", "query", "text", "query", { maxLength: 2_000 }),
        field("passage", "passage", "text", "passage", {
          maxLength: MAX_FIELD_LENGTH,
        }),
      ];
      break;
    case "diffusion-lora":
      fields = [field("caption", "caption", "text", "caption", { maxLength: 500 })];
      break;
    case "vision-classification":
      fields = [field("label", "label", "text", "label", { maxLength: 120 })];
      break;
    case "vision-detection":
      fields = [field("label", "labels", "text", "label", { maxLength: 120 })];
      break;
    case "vision-segmentation":
      fields = [field("label", "label", "text", "label", { maxLength: 120 })];
      break;
  }
  return {
    schemaVersion: DATASET_PREPARATION_OUTPUT_SHAPE_SCHEMA_VERSION,
    taskType,
    fields,
  };
}

export function resolveDatasetPreparationVisualOutputShape(
  taskType: DatasetPreparationTaskType,
  value: DatasetPreparationVisualOutputShape | undefined,
  options: { multiLabel?: boolean } = {},
): { source: "default" | "saved"; shape: DatasetPreparationVisualOutputShape } {
  return value
    ? { source: "saved", shape: value }
    : {
        source: "default",
        shape: createDefaultDatasetPreparationVisualOutputShape(taskType, options),
      };
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map((item) => canonicalJson(item)).join(",")}]`;
  }
  if (isRecord(value)) {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`)
      .join(",")}}`;
  }
  const serialized = JSON.stringify(value);
  if (serialized === undefined) throw new Error("Unsupported canonical value.");
  return serialized;
}

function normalizeChoiceValues(value: unknown): string[] | undefined {
  if (!Array.isArray(value) || value.length < 1 || value.length > DATASET_PREPARATION_OUTPUT_SHAPE_MAX_CHOICES) {
    return undefined;
  }
  const choices = value.map((item) =>
    typeof item === "string" ? item.trim() : "",
  );
  if (
    choices.some(
      (choice) => !choice || choice.length > MAX_FIELD_CHOICE_LENGTH,
    ) ||
    new Set(choices).size !== choices.length
  ) {
    return undefined;
  }
  return choices;
}

function fieldSchema(
  visualField: DatasetPreparationVisualOutputField,
  options: DatasetPreparationOutputShapeCompileOptions,
): { schema: Record<string, unknown>; decoderCompatible: boolean } {
  const purposeSpec = visualField.purpose
    ? PURPOSE_SPECS[visualField.purpose]
    : undefined;
  const maxLength =
    visualField.maxLength ?? purposeSpec?.maxLength ?? MAX_FIELD_LENGTH;
  const configuredChoices =
    visualField.purpose === "label" && options.allowedLabels?.length
      ? [...options.allowedLabels]
      : visualField.choices;
  switch (visualField.kind) {
    case "text":
      return {
        schema: {
          type: "string",
          ...(purposeSpec?.allowEmpty ? {} : { minLength: 1 }),
          maxLength,
          ...(configuredChoices?.length ? { enum: configuredChoices } : {}),
        },
        decoderCompatible: true,
      };
    case "number":
      return { schema: { type: "number" }, decoderCompatible: true };
    case "boolean":
      return { schema: { type: "boolean" }, decoderCompatible: true };
    case "text-list":
      return {
        schema: {
          type: "array",
          minItems: 1,
          maxItems:
            visualField.maxItems ?? DATASET_PREPARATION_OUTPUT_SHAPE_MAX_LIST_ITEMS,
          uniqueItems: true,
          items: {
            type: "string",
            minLength: 1,
            maxLength,
            ...(configuredChoices?.length ? { enum: configuredChoices } : {}),
          },
        },
        decoderCompatible: true,
      };
    case "record":
      return {
        schema: {
          type: "object",
          minProperties: 1,
          maxProperties: 64,
          additionalProperties: {
            anyOf: [
              { type: "string", maxLength: MAX_FIELD_LENGTH },
              { type: "number" },
              { type: "boolean" },
              { type: "null" },
            ],
          },
        },
        decoderCompatible: false,
      };
    case "group": {
      const properties: Record<string, unknown> = {};
      const required: string[] = [];
      let decoderCompatible = true;
      for (const child of visualField.children ?? []) {
        const compiled = fieldSchema(child, options);
        properties[child.name] = compiled.schema;
        decoderCompatible &&= compiled.decoderCompatible;
        if (child.required) required.push(child.name);
      }
      return {
        schema: {
          type: "object",
          additionalProperties: false,
          properties,
          ...(required.length ? { required } : {}),
        },
        decoderCompatible,
      };
    }
  }
}

export function compileDatasetPreparationVisualOutputShape(
  value: unknown,
  options: DatasetPreparationOutputShapeCompileOptions,
): DatasetPreparationOutputShapeCompileResult {
  const diagnostics: DatasetPreparationOutputShapeDiagnostic[] = [];
  const error = (
    code: DatasetPreparationOutputShapeDiagnosticCode,
    message: string,
    fieldId?: string,
  ) => diagnostics.push({ severity: "error", code, message, ...(fieldId ? { fieldId } : {}) });
  if (!isRecord(value) || value.schemaVersion !== "1" || !Array.isArray(value.fields)) {
    error("shape-invalid", "The output layout is incomplete or invalid.");
    return { ok: false, diagnostics };
  }
  if (value.taskType !== options.taskType) {
    error("task-mismatch", "The output layout belongs to a different training goal.");
    return { ok: false, diagnostics };
  }
  const allowedLabels = options.allowedLabels?.length
    ? normalizeChoiceValues(options.allowedLabels)
    : undefined;
  if (options.allowedLabels !== undefined && !allowedLabels) {
    error(
      "field-choices-invalid",
      "Configured labels must be a bounded list of unique, nonempty values.",
    );
  }
  const compileOptions: DatasetPreparationOutputShapeCompileOptions = {
    ...options,
    ...(allowedLabels ? { allowedLabels } : {}),
  };

  const seenIds = new Set<string>();
  const purposePaths = new Map<DatasetPreparationOutputPurpose, string[]>();
  let fieldCount = 0;
  let nested = false;
  const normalizeFields = (
    rawFields: unknown[],
    depth: number,
    parentPath: readonly string[],
  ): DatasetPreparationVisualOutputField[] => {
    if (depth > DATASET_PREPARATION_OUTPUT_SHAPE_MAX_DEPTH) {
      error("field-depth-invalid", "The output layout has too many nested levels.");
      return [];
    }
    const siblingNames = new Set<string>();
    const normalized: DatasetPreparationVisualOutputField[] = [];
    for (const rawField of rawFields) {
      fieldCount += 1;
      if (fieldCount > DATASET_PREPARATION_OUTPUT_SHAPE_MAX_FIELDS) {
        error("field-count-invalid", "The output layout contains too many fields.");
        break;
      }
      if (!isRecord(rawField)) {
        error("shape-invalid", "One output field is invalid.");
        continue;
      }
      const id = typeof rawField.id === "string" ? rawField.id : "";
      if (!FIELD_ID_PATTERN.test(id)) {
        error("field-id-invalid", "A field has an invalid internal identifier.", id || undefined);
      } else if (seenIds.has(id)) {
        error("field-id-duplicate", "Two fields share the same internal identifier.", id);
      }
      seenIds.add(id);

      const name = typeof rawField.name === "string" ? rawField.name.trim() : "";
      if (!FIELD_NAME_PATTERN.test(name)) {
        error("field-name-invalid", "Field names must start with a letter or underscore and use only letters, numbers, underscores, or hyphens.", id);
      }
      if (UNSAFE_FIELD_NAMES.has(name)) {
        error("field-name-unsafe", "This field name is reserved for software safety.", id);
      }
      if (depth === 1 && PROTECTED_ROOT_FIELD_NAMES.has(name)) {
        error("field-name-protected", "This field name is reserved by the generated-output envelope.", id);
      }
      if (siblingNames.has(name)) {
        error("field-name-duplicate", "Fields at the same level must have different names.", id);
      }
      siblingNames.add(name);

      const kind = DATASET_PREPARATION_OUTPUT_FIELD_KINDS.includes(
        rawField.kind as DatasetPreparationOutputFieldKind,
      )
        ? (rawField.kind as DatasetPreparationOutputFieldKind)
        : undefined;
      if (!kind) {
        error("field-kind-invalid", "Choose a supported value type for every field.", id);
        continue;
      }
      if (typeof rawField.required !== "boolean") {
        error("field-required-invalid", "Choose whether every field is required.", id);
      }

      const purpose =
        typeof rawField.purpose === "string" &&
        DATASET_PREPARATION_OUTPUT_PURPOSES.includes(
          rawField.purpose as DatasetPreparationOutputPurpose,
        )
          ? (rawField.purpose as DatasetPreparationOutputPurpose)
          : undefined;
      if (rawField.purpose !== undefined && !purpose) {
        error("purpose-invalid", "Choose a supported training purpose.", id);
      }
      if (purpose) {
        if (!TASK_PURPOSES[options.taskType].includes(purpose)) {
          error("purpose-invalid", "This training purpose does not belong to the selected training goal.", id);
        } else if (!PURPOSE_SPECS[purpose].kinds.includes(kind)) {
          error("purpose-incompatible", `${PURPOSE_SPECS[purpose].label} needs a compatible value type.`, id);
        } else if (purposePaths.has(purpose)) {
          error("purpose-duplicate", `${PURPOSE_SPECS[purpose].label} can be assigned to only one field.`, id);
        } else {
          purposePaths.set(purpose, [...parentPath, name]);
        }
        if (rawField.required !== true) {
          error("purpose-incompatible", "Fields needed for training must be required.", id);
        }
      }

      const choices = rawField.choices === undefined
        ? undefined
        : normalizeChoiceValues(rawField.choices);
      if (
        rawField.choices !== undefined &&
        (!choices || (kind !== "text" && kind !== "text-list"))
      ) {
        error("field-choices-invalid", "Allowed choices must be a bounded list on a text field.", id);
      }
      const maxLength = rawField.maxLength === undefined
        ? undefined
        : boundedInteger(rawField.maxLength, 1, MAX_FIELD_LENGTH);
      if (rawField.maxLength !== undefined && (!maxLength || (kind !== "text" && kind !== "text-list"))) {
        error("field-limit-invalid", "Text length must be within the supported limit.", id);
      }
      const maxItems = rawField.maxItems === undefined
        ? undefined
        : boundedInteger(rawField.maxItems, 1, DATASET_PREPARATION_OUTPUT_SHAPE_MAX_LIST_ITEMS);
      if (rawField.maxItems !== undefined && (!maxItems || kind !== "text-list")) {
        error("field-limit-invalid", "List length must be within the supported limit.", id);
      }

      let children: DatasetPreparationVisualOutputField[] | undefined;
      if (kind === "group") {
        if (!Array.isArray(rawField.children) || rawField.children.length === 0) {
          error("field-children-invalid", "A field group must contain at least one child field.", id);
          children = [];
        } else {
          nested = true;
          children = normalizeFields(rawField.children, depth + 1, [...parentPath, name]);
        }
      } else if (rawField.children !== undefined) {
        error("field-children-invalid", "Only a field group may contain child fields.", id);
      }
      if (kind === "record") nested = true;

      normalized.push({
        id,
        name,
        kind,
        required: rawField.required === true,
        ...(purpose ? { purpose } : {}),
        ...(children ? { children } : {}),
        ...(choices ? { choices } : {}),
        ...(maxLength ? { maxLength } : {}),
        ...(maxItems ? { maxItems } : {}),
      });
    }
    return normalized;
  };

  const fields = normalizeFields(value.fields, 1, []);
  if (fields.length === 0) {
    error("field-count-invalid", "The output layout must contain at least one field.");
  }
  for (const purpose of TASK_PURPOSES[options.taskType]) {
    if (!purposePaths.has(purpose)) {
      error("purpose-missing", `${PURPOSE_SPECS[purpose].label} is required for this training goal.`);
    }
  }
  if (options.outputFormat === "csv" && nested) {
    error("nested-csv-unsupported", "Nested output requires JSON or Parquet. Choose a flat layout to use CSV.");
  }

  const shape: DatasetPreparationVisualOutputShape = {
    schemaVersion: "1",
    taskType: options.taskType,
    fields,
  };
  const shapeBytes = new TextEncoder().encode(canonicalJson(shape)).byteLength;
  if (shapeBytes > DATASET_PREPARATION_OUTPUT_SHAPE_MAX_BYTES) {
    error("shape-bytes-exceeded", "The output layout is too large.");
  }
  if (diagnostics.some((diagnostic) => diagnostic.severity === "error")) {
    return { ok: false, diagnostics };
  }

  const properties: Record<string, unknown> = {};
  const required: string[] = [];
  let decoderCompatible = true;
  for (const visualField of fields) {
    const compiled = fieldSchema(visualField, compileOptions);
    properties[visualField.name] = compiled.schema;
    decoderCompatible &&= compiled.decoderCompatible;
    if (visualField.required) required.push(visualField.name);
  }
  const exampleSchema: Record<string, unknown> = {
    type: "object",
    additionalProperties: false,
    properties,
    ...(required.length ? { required } : {}),
  };
  if (!decoderCompatible) {
    diagnostics.push({
      severity: "warning",
      code: "decoder-dynamic-record-unsupported",
      message: "Define the extracted fields to make token-level constraints available for this layout.",
    });
  }

  const payloadKey = METADATA_TASKS.has(options.taskType) ? "value" : "example";
  const fieldKind = TASK_PURPOSES[options.taskType][0];
  const envelopeProperties: Record<string, unknown> = {
    schemaVersion: { const: "1" },
    taskType: { const: options.taskType },
    ...(payloadKey === "value" ? { fieldKind: { const: fieldKind } } : {}),
    status: { enum: ["ok", "skip"] },
    [payloadKey]: { anyOf: [exampleSchema, { type: "null" }] },
  };
  const envelopeRequired = [
    "schemaVersion",
    "taskType",
    ...(payloadKey === "value" ? ["fieldKind"] : []),
    "status",
    payloadKey,
  ];
  const envelopeSchema: Record<string, unknown> = {
    $schema: "https://json-schema.org/draft/2020-12/schema",
    type: "object",
    additionalProperties: false,
    required: envelopeRequired,
    properties: envelopeProperties,
    oneOf: [
      {
        properties: {
          status: { const: "ok" },
          [payloadKey]: exampleSchema,
        },
      },
      {
        properties: {
          status: { const: "skip" },
          [payloadKey]: { type: "null" },
        },
      },
    ],
  };
  const sortedPurposePaths = Object.fromEntries(
    [...purposePaths.entries()]
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([purpose, path]) => [purpose, path]),
  ) as Partial<Record<DatasetPreparationOutputPurpose, readonly string[]>>;
  const canonicalFingerprintMaterial = canonicalJson({
    compilerVersion: "dataset-preparation-output-shape.v1",
    shape,
    purposePaths: sortedPurposePaths,
    envelopeSchema,
  });

  return {
    ok: true,
    value: {
      shape,
      payloadKey,
      exampleSchema,
      envelopeSchema,
      purposePaths: sortedPurposePaths,
      canonicalFingerprintMaterial,
      decoderCompatible,
    },
    diagnostics,
  };
}
