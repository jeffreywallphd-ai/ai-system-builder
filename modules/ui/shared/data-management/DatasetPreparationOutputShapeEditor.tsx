import type { ReactNode } from "react";

import {
  DATASET_PREPARATION_OUTPUT_FIELD_KINDS,
  compileDatasetPreparationVisualOutputShape,
  createDefaultDatasetPreparationVisualOutputShape,
  createDatasetPreparationSourceAttributionSchema,
  describeDatasetPreparationOutputPurpose,
  listDatasetPreparationAvailableOutputPurposes,
  resolveDatasetPreparationOutputFieldExample,
  type DatasetPreparationOutputFieldKind,
  type DatasetPreparationOutputPurpose,
  type DatasetPreparationTaskType,
  type DatasetPreparationVisualOutputField,
  type DatasetPreparationVisualOutputShape,
} from "../../../contracts/runtime";

export interface DatasetPreparationOutputShapeEditorProps {
  idPrefix: string;
  taskType: DatasetPreparationTaskType;
  shape: DatasetPreparationVisualOutputShape;
  outputFormat: "jsonl" | "json" | "csv" | "parquet";
  allowedLabels?: readonly string[];
  multiLabel?: boolean;
  includeSourceAttribution?: boolean;
  disabled?: boolean;
  onChange: (shape: DatasetPreparationVisualOutputShape) => void;
}

const FIELD_KIND_LABELS: Record<DatasetPreparationOutputFieldKind, string> = {
  text: "Text",
  number: "Number",
  boolean: "True / False",
  group: "Object with fields",
  "text-list": "List",
  record: "Object",
};

type FieldPath = readonly number[];

function visitFields(
  fields: readonly DatasetPreparationVisualOutputField[],
  visit: (field: DatasetPreparationVisualOutputField) => void,
): void {
  for (const field of fields) {
    visit(field);
    if (field.children) visitFields(field.children, visit);
  }
}

function nextFieldId(shape: DatasetPreparationVisualOutputShape): string {
  const ids = new Set<string>();
  visitFields(shape.fields, (field) => ids.add(field.id));
  let index = 1;
  while (ids.has(`custom-field-${index}`)) index += 1;
  return `custom-field-${index}`;
}

function nextFieldName(
  fields: readonly DatasetPreparationVisualOutputField[],
): string {
  const names = new Set(fields.map((field) => field.name));
  let index = 1;
  while (names.has(`new_field_${index}`)) index += 1;
  return `new_field_${index}`;
}

function createNewField(
  shape: DatasetPreparationVisualOutputShape,
  siblings: readonly DatasetPreparationVisualOutputField[],
): DatasetPreparationVisualOutputField {
  return {
    id: nextFieldId(shape),
    name: nextFieldName(siblings),
    kind: "text",
    required: false,
    example: resolveDatasetPreparationOutputFieldExample("text"),
  };
}

function updateFieldsAtPath(
  fields: readonly DatasetPreparationVisualOutputField[],
  path: FieldPath,
  update: (
    siblings: readonly DatasetPreparationVisualOutputField[],
  ) => DatasetPreparationVisualOutputField[],
): DatasetPreparationVisualOutputField[] {
  if (path.length === 0) return update(fields);
  const [index, ...remaining] = path;
  return fields.map((field, fieldIndex) =>
    fieldIndex === index
      ? {
          ...field,
          children: updateFieldsAtPath(
            field.children ?? [],
            remaining,
            update,
          ),
        }
      : field,
  );
}

function updateFieldAtPath(
  fields: readonly DatasetPreparationVisualOutputField[],
  path: FieldPath,
  update: (
    field: DatasetPreparationVisualOutputField,
  ) => DatasetPreparationVisualOutputField,
): DatasetPreparationVisualOutputField[] {
  const parentPath = path.slice(0, -1);
  const fieldIndex = path[path.length - 1];
  return updateFieldsAtPath(fields, parentPath, (siblings) =>
    siblings.map((field, index) =>
      index === fieldIndex ? update(field) : field,
    ),
  );
}

function fieldContainsTrainingPurpose(
  field: DatasetPreparationVisualOutputField,
): boolean {
  return Boolean(
    field.purpose ||
      field.children?.some((child) => fieldContainsTrainingPurpose(child)),
  );
}

function FieldControl({
  label,
  children,
}: {
  label: ReactNode;
  children: ReactNode;
}) {
  return (
    <label className="dataset-output-shape-editor__control">
      <span>{label}</span>
      {children}
    </label>
  );
}

export function DatasetPreparationOutputShapeEditor({
  idPrefix,
  taskType,
  shape,
  outputFormat,
  allowedLabels,
  multiLabel,
  includeSourceAttribution,
  disabled = false,
  onChange,
}: DatasetPreparationOutputShapeEditorProps) {
  const availablePurposes =
    listDatasetPreparationAvailableOutputPurposes(taskType);
  const assignedPurposes: DatasetPreparationOutputPurpose[] = [];
  visitFields(shape.fields, (field) => {
    if (field.purpose && !assignedPurposes.includes(field.purpose)) {
      assignedPurposes.push(field.purpose);
    }
  });
  const compileResult = compileDatasetPreparationVisualOutputShape(shape, {
    taskType,
    outputFormat,
    multiLabel,
    allowedLabels,
  });
  const diagnostics = compileResult.diagnostics;

  const emitFields = (fields: DatasetPreparationVisualOutputField[]) =>
    onChange({ schemaVersion: "1", taskType, fields });

  const renderFields = (
    fields: readonly DatasetPreparationVisualOutputField[],
    parentPath: FieldPath,
    depth: number,
  ): ReactNode =>
    fields.map((field, index) => {
      const path = [...parentPath, index];
      const fieldLabel = field.name.trim() || `Field ${index + 1}`;
      const visibleKinds = field.purpose
        ? describeDatasetPreparationOutputPurpose(field.purpose).kinds
        : DATASET_PREPARATION_OUTPUT_FIELD_KINDS;
      const updateField = (
        update: (
          current: DatasetPreparationVisualOutputField,
        ) => DatasetPreparationVisualOutputField,
      ) => emitFields(updateFieldAtPath(shape.fields, path, update));
      const move = (direction: -1 | 1) =>
        emitFields(
          updateFieldsAtPath(shape.fields, parentPath, (siblings) => {
            const next = [...siblings];
            const target = index + direction;
            if (target < 0 || target >= next.length) return next;
            [next[index], next[target]] = [next[target]!, next[index]!];
            return next;
          }),
        );
      const remove = () =>
        emitFields(
          updateFieldsAtPath(shape.fields, parentPath, (siblings) =>
            siblings.filter((_, siblingIndex) => siblingIndex !== index),
          ),
        );
      const addChild = () =>
        updateField((current) => ({
          ...current,
          children: [
            ...(current.children ?? []),
            createNewField(shape, current.children ?? []),
          ],
        }));

      return (
        <fieldset
          className="dataset-output-shape-editor__field"
          data-depth={depth}
          key={field.id}
        >
          <legend>{fieldLabel}</legend>
          <div className="dataset-output-shape-editor__grid">
            <FieldControl label="Field name">
              <input
                aria-label={`${fieldLabel} field name`}
                disabled={disabled}
                maxLength={64}
                onInput={(event) =>
                  updateField((current) => ({
                    ...current,
                    name: event.currentTarget.value,
                  }))
                }
                value={field.name}
              />
            </FieldControl>
            <FieldControl label="Value type">
              <select
                aria-label={`${fieldLabel} value type`}
                disabled={disabled}
                onChange={(event) => {
                  const kind = event.target
                    .value as DatasetPreparationOutputFieldKind;
                  updateField((current) => {
                    const purpose = current.purpose;
                    const purposeCompatible = purpose
                      ? describeDatasetPreparationOutputPurpose(
                          purpose,
                        ).kinds.includes(kind)
                      : true;
                    const nextPurpose = purposeCompatible
                      ? purpose
                      : undefined;
                    return {
                      ...current,
                      kind,
                      purpose: nextPurpose,
                      example: resolveDatasetPreparationOutputFieldExample(
                        kind,
                        nextPurpose,
                      ),
                      ...(kind === "group"
                        ? {
                            children:
                              current.children?.length
                                ? current.children
                                : [createNewField(shape, [])],
                          }
                        : { children: undefined }),
                      ...(
                        kind === "text" || kind === "text-list"
                          ? {}
                          : { choices: undefined, maxLength: undefined }
                      ),
                      ...(kind === "text-list" ? {} : { maxItems: undefined }),
                    };
                  });
                }}
                value={field.kind}
              >
                {visibleKinds.map((kind) => (
                  <option key={kind} value={kind}>
                    {FIELD_KIND_LABELS[kind]}
                  </option>
                ))}
              </select>
            </FieldControl>
            <FieldControl label="Needed for training">
              <select
                aria-label={`${fieldLabel} training purpose`}
                disabled={disabled}
                onChange={(event) => {
                  const purpose = event.target.value as
                    | DatasetPreparationOutputPurpose
                    | "";
                  updateField((current) => {
                    if (!purpose) {
                      return { ...current, purpose: undefined };
                    }
                    const purposeKinds =
                      describeDatasetPreparationOutputPurpose(purpose).kinds;
                    const kind = purposeKinds.includes(current.kind)
                      ? current.kind
                      : purposeKinds[0]!;
                    return {
                      ...current,
                      kind,
                      purpose,
                      required: true,
                      example:
                        resolveDatasetPreparationOutputFieldExample(
                          kind,
                          purpose,
                        ),
                      ...(kind === "group"
                        ? {
                            children:
                              current.children?.length
                                ? current.children
                                : [createNewField(shape, [])],
                          }
                        : { children: undefined }),
                    };
                  });
                }}
                value={field.purpose ?? ""}
              >
                <option value="">Not used directly for training</option>
                {availablePurposes.map((purpose) => (
                  <option key={purpose} value={purpose}>
                    {describeDatasetPreparationOutputPurpose(purpose).label}
                  </option>
                ))}
              </select>
            </FieldControl>
            <label className="dataset-output-shape-editor__checkbox">
              <input
                checked={field.required || Boolean(field.purpose)}
                disabled={disabled || Boolean(field.purpose)}
                onChange={(event) =>
                  updateField((current) => ({
                    ...current,
                    required: event.target.checked,
                  }))
                }
                type="checkbox"
              />
              Always include this field
            </label>
          </div>

          {field.purpose === "label" ? (
            <p className="ui-text-muted">
              Labels are selected in the training goal settings in Step 1, so
              they are not repeated here.
            </p>
          ) : field.kind === "group" ? null : (
            <FieldControl
              label={
                field.purpose === "instruction"
                  ? (
                      <>
                        Instruction{" "}
                        <strong>— describe how the model should behave</strong>
                      </>
                    )
                  : field.purpose === "input"
                    ? "Example input"
                    : field.purpose === "context"
                      ? "Example supporting data"
                    : field.purpose === "output"
                      ? "Example output"
                      : field.purpose === "thought"
                        ? "Example thought"
                        : field.purpose === "anchor-text"
                          ? "Example search input"
                          : field.purpose === "positive-text"
                            ? "Example matching text"
                            : field.purpose === "query"
                              ? "Example query"
                              : field.purpose === "passage"
                                ? "Example passage"
                                : field.purpose === "caption"
                                  ? "Example caption"
                        : field.purpose === "expected-output" ||
                            field.kind === "record"
                          ? "Example output (JSON)"
                          : field.kind === "text-list"
                            ? "Sample list (one item per line)"
                            : "Example value"
              }
            >
              {field.kind === "boolean" ? (
                <select
                  aria-label={`${fieldLabel} example value`}
                  disabled={disabled}
                  onChange={(event) =>
                    updateField((current) => ({
                      ...current,
                      example: event.target.value,
                    }))
                  }
                  value={field.example ?? "true"}
                >
                  <option value="true">True</option>
                  <option value="false">False</option>
                </select>
              ) : field.kind === "number" ? (
                <input
                  aria-label={`${fieldLabel} example value`}
                  disabled={disabled}
                  onInput={(event) =>
                    updateField((current) => ({
                      ...current,
                      example: event.currentTarget.value,
                    }))
                  }
                  type="number"
                  value={field.example ?? "0"}
                />
              ) : (
                <textarea
                  aria-label={`${fieldLabel} example value`}
                  disabled={disabled}
                  onInput={(event) =>
                    updateField((current) => ({
                      ...current,
                      example: event.currentTarget.value,
                    }))
                  }
                  rows={3}
                  value={
                    field.example ??
                    resolveDatasetPreparationOutputFieldExample(
                      field.kind,
                      field.purpose,
                    )
                  }
                />
              )}
            </FieldControl>
          )}

          <div className="dataset-output-shape-editor__actions">
            <button
              aria-label={`Move ${fieldLabel} up`}
              disabled={disabled || index === 0}
              onClick={() => move(-1)}
              type="button"
            >
              Move up
            </button>
            <button
              aria-label={`Move ${fieldLabel} down`}
              disabled={disabled || index === fields.length - 1}
              onClick={() => move(1)}
              type="button"
            >
              Move down
            </button>
            {field.kind === "group" && (
              <button
                aria-label={`Add a field inside ${fieldLabel}`}
                disabled={disabled}
                onClick={addChild}
                type="button"
              >
                Add field inside
              </button>
            )}
            <button
              aria-label={`Remove ${fieldLabel}`}
              disabled={disabled || fieldContainsTrainingPurpose(field)}
              onClick={remove}
              type="button"
            >
              Remove
            </button>
          </div>

          {field.kind === "group" && field.children?.length
            ? renderFields(field.children, path, depth + 1)
            : null}
        </fieldset>
      );
    });

  return (
    <section
      aria-labelledby={`${idPrefix}-heading`}
      className="dataset-output-shape-editor"
    >
      <div className="dataset-output-shape-editor__heading">
        <div>
          <h4 id={`${idPrefix}-heading`}>Desired output format</h4>
          <p>
            Define one sample JSON result the model should follow for each
            source section. Labels remain in Step 1 and are not duplicated here.
          </p>
        </div>
        <button
          disabled={disabled}
          onClick={() =>
            onChange(
              createDefaultDatasetPreparationVisualOutputShape(taskType, {
                multiLabel,
              }),
            )
          }
          type="button"
        >
          Reset fields
        </button>
      </div>

      <div className="dataset-output-shape-editor__purposes">
        <strong>Needed for training</strong>
        <ul>
          {assignedPurposes.map((purpose) => (
            <li key={purpose}>
              {describeDatasetPreparationOutputPurpose(purpose).label}
            </li>
          ))}
        </ul>
      </div>

      <div aria-live="polite" className="dataset-output-shape-editor__validation">
        {diagnostics.length === 0 ? (
          <p>Desired output format is ready.</p>
        ) : (
          <>
            <strong>Check the desired output format</strong>
            <ul>
              {diagnostics.slice(0, 8).map((diagnostic, index) => (
                <li key={`${diagnostic.code}-${diagnostic.fieldId ?? index}`}>
                  {diagnostic.message}
                </li>
              ))}
            </ul>
          </>
        )}
      </div>

      <div className="dataset-output-shape-editor__tree">
        {renderFields(shape.fields, [], 1)}
      </div>
      <button
        disabled={disabled}
        onClick={() =>
          emitFields([...shape.fields, createNewField(shape, shape.fields)])
        }
        type="button"
      >
        Add field
      </button>

      <details className="dataset-output-shape-editor__preview">
        <summary>JSON output preview</summary>
        <p>
          This sample format is supplied with the instructions. Fixed fields,
          such as Instruction, are copied exactly. Context is attached unchanged
          from the source section. The model creates the remaining requested
          values from that evidence.
        </p>
        <pre aria-label="JSON output preview">
          {compileResult.ok
            ? JSON.stringify(compileResult.value.exampleEnvelope, null, 2)
            : "Fix the output field messages to create the output preview."}
        </pre>
      </details>
      <details className="dataset-output-shape-editor__preview">
        <summary>Advanced structure preview</summary>
        <p>
          Exact validation structure used by the checks and optional JSON
          constraints.
        </p>
        <pre aria-label="Generated JSON schema preview">
          {compileResult.ok
            ? JSON.stringify(compileResult.value.envelopeSchema, null, 2)
            : "Fix the output field messages to create the schema preview."}
        </pre>
      </details>
      {includeSourceAttribution ? (
        <section className="dataset-output-shape-editor__system-fields ui-stack ui-stack--sm">
          <strong>Source attribution added automatically</strong>
          <p className="ui-text-muted">
            Each saved example will include its source ID and any available
            source name, public link, author, and license. These trusted fields
            are added by the system and cannot be written by the model.
          </p>
          <details>
            <summary>Attribution fields preview</summary>
            <pre aria-label="Source attribution JSON schema preview">
              {JSON.stringify(
                createDatasetPreparationSourceAttributionSchema(),
                null,
                2,
              )}
            </pre>
          </details>
        </section>
      ) : null}
    </section>
  );
}
