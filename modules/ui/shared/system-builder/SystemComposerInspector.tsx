import { useEffect, useMemo, useState } from "react";
import type {
  AssetBinding,
  AssetConfigurationField,
  AssetConfigurationValue,
  AssetConfigurationValues,
  AssetInstance,
} from "../../../contracts/asset";
import type { SystemBuilderComposerAsset } from "../../../contracts/system-builder";
import { ApplicationIcon } from "../components/ApplicationIcon";
import { EmptyState } from "../components/EmptyState";
import {
  bindingKindForSystemComposerEndpoint,
  buildSystemComposerPropertyPanelSections,
  listCompatibleSystemComposerTargets,
  listSystemComposerPortEndpoints,
  materializeSystemComposerConfiguration,
  isSystemComposerSemanticStyleField,
  isSystemComposerStylingField,
  validateSystemComposerConfiguration,
  type SystemComposerPortEndpoint,
  type SystemComposerPropertyPanel,
} from "./systemComposerInspectorModel";

export type SystemComposerInspectorMode = "configuration" | "connections";

export interface SystemComposerInspectorProps {
  readonly mode: SystemComposerInspectorMode;
  readonly embedded?: boolean;
  readonly selectedInstance?: AssetInstance;
  readonly selectedDefinition?: SystemBuilderComposerAsset;
  readonly instances: readonly AssetInstance[];
  readonly catalog: readonly SystemBuilderComposerAsset[];
  readonly bindings: readonly AssetBinding[];
  readonly onConfigurationChange: (values: AssetConfigurationValues) => void;
  readonly onAddConnection: (
    source: SystemComposerPortEndpoint,
    target: SystemComposerPortEndpoint,
  ) => void;
  readonly onRemoveConnection: (bindingId: string) => void;
}

export function SystemComposerInspector({
  mode,
  embedded = false,
  selectedInstance,
  selectedDefinition,
  instances,
  catalog,
  bindings,
  onConfigurationChange,
  onAddConnection,
  onRemoveConnection,
}: SystemComposerInspectorProps) {
  if (mode === "connections") {
    return (
      <SystemComposerConnections
        instances={instances}
        catalog={catalog}
        bindings={bindings}
        onAddConnection={onAddConnection}
        onRemoveConnection={onRemoveConnection}
      />
    );
  }
  if (!selectedInstance || !selectedDefinition) {
    return (
      <EmptyState
        compact
        title="Select an asset to configure"
        description="Choose an asset in Structure mode, then return here for generated controls."
        icon="settings"
      />
    );
  }
  return (
    <SystemComposerConfiguration
      instance={selectedInstance}
      definition={selectedDefinition}
      catalog={catalog}
      embedded={embedded}
      onChange={onConfigurationChange}
    />
  );
}

function SystemComposerConfiguration({
  instance,
  definition,
  catalog,
  embedded,
  onChange,
}: {
  readonly instance: AssetInstance;
  readonly definition: SystemBuilderComposerAsset;
  readonly catalog: readonly SystemBuilderComposerAsset[];
  readonly embedded: boolean;
  readonly onChange: (values: AssetConfigurationValues) => void;
}) {
  const values = useMemo(
    () =>
      materializeSystemComposerConfiguration(
        definition,
        instance.selectedConfiguration,
      ),
    [definition, instance.selectedConfiguration],
  );
  const panelSections = useMemo(
    () =>
      buildSystemComposerPropertyPanelSections(definition.configurationSchema, {
        groupLayoutFields: definition.slots.length > 0,
        includeField: (field) => !isSystemComposerStylingField(field),
      }),
    [definition.configurationSchema, definition.slots.length],
  );
  const [activePanel, setActivePanel] =
    useState<SystemComposerPropertyPanel>("design");
  useEffect(() => setActivePanel("design"), [instance.instanceId]);
  const errors = useMemo(
    () =>
      validateSystemComposerConfiguration(
        definition.configurationSchema,
        values,
      ),
    [definition.configurationSchema, values],
  );
  const update = (fieldId: string, value: AssetConfigurationValue) =>
    onChange({ ...values, [fieldId]: value });
  const advancedFieldIds = useMemo(
    () =>
      new Set(
        definition.configurationSchema?.fields
          .filter((field) => !isSystemComposerSemanticStyleField(field))
          .map((field) => field.fieldId) ?? [],
      ),
    [definition.configurationSchema],
  );
  const advancedValues = useMemo(
    () =>
      Object.fromEntries(
        Object.entries(values).filter(([fieldId]) =>
          advancedFieldIds.has(fieldId),
        ),
      ),
    [advancedFieldIds, values],
  );

  return (
    <section
      className="system-composer-inspector"
      aria-labelledby={
        embedded ? undefined : "system-composer-configuration-title"
      }
      aria-label={
        embedded
          ? `Configure ${instance.displayName ?? definition.displayName}`
          : undefined
      }
    >
      <header className="system-composer-inspector__header">
        {embedded ? null : (
          <div>
            <h3 id="system-composer-configuration-title">
              Configure {instance.displayName ?? definition.displayName}
            </h3>
            <p>
              {definition.definitionId}@{definition.version}
            </p>
          </div>
        )}
        <button
          type="button"
          className="system-composer__flat-control"
          onClick={() =>
            onChange(
              materializeSystemComposerConfiguration(definition, undefined),
            )
          }
        >
          <ApplicationIcon name="refresh" />
          <span>Reset defaults</span>
        </button>
      </header>
      {definition.layoutRole ? (
        <p className="system-composer-inspector__layout-lock ui-status ui-status--info">
          System Foundation controls this layout's width, height, regions, and
          responsive rules. Only its declared semantic properties can be
          changed.
        </p>
      ) : null}
      {definition.slots.length ? (
        <fieldset className="system-composer-inspector__section system-composer-inspector__layout-summary">
          <legend>Container layout</legend>
          <p>
            {definition.layoutRole
              ? "Uses predefined, dimension-locked Foundation geometry."
              : "Uses bounded semantic layout properties with composable named regions."}
          </p>
          <p className="ui-text-muted">
            Arrangement: {definition.layoutGeometry?.columnPattern ?? "single"}
            {" | "}
            Regions:{" "}
            {definition.slots.map((slot) => slot.displayName).join(", ")}
          </p>
        </fieldset>
      ) : null}
      <div
        className="system-composer-inspector__tabs"
        role="tablist"
        aria-label="Asset property groups"
      >
        {(["design", "data", "events"] as const).map((panel) => (
          <button
            key={panel}
            id={`system-composer-property-tab-${panel}`}
            type="button"
            role="tab"
            className="system-composer__flat-control"
            aria-selected={activePanel === panel}
            aria-controls={`system-composer-property-panel-${panel}`}
            onClick={() => setActivePanel(panel)}
          >
            {panel[0]!.toUpperCase() + panel.slice(1)}
          </button>
        ))}
      </div>
      {(["design", "data", "events"] as const).map((panel) => (
        <div
          key={panel}
          id={`system-composer-property-panel-${panel}`}
          role="tabpanel"
          aria-labelledby={`system-composer-property-tab-${panel}`}
          hidden={activePanel !== panel}
          className="system-composer-inspector__panel"
        >
          {panelSections[panel].length ? (
            panelSections[panel].map((section) => (
              <fieldset
                key={section.id}
                className="system-composer-inspector__section"
              >
                <legend>{section.label}</legend>
                <div className="system-composer-inspector__fields">
                  {section.fields.map((field) => (
                    <SystemComposerConfigurationField
                      key={field.fieldId}
                      field={field}
                      value={values[field.fieldId]}
                      catalog={catalog}
                      errors={errors[field.fieldId] ?? []}
                      onChange={(value) => update(field.fieldId, value)}
                    />
                  ))}
                </div>
              </fieldset>
            ))
          ) : (
            <p className="ui-status ui-status--info">
              No {panel} properties are declared for this asset.
            </p>
          )}
        </div>
      ))}
      {!definition.layoutRole && advancedFieldIds.size ? (
        <details className="system-composer-inspector__advanced">
          <summary>Advanced JSON</summary>
          <p className="ui-text-muted">
            Use this fallback only for schema fields that cannot be expressed by
            the generated controls.
          </p>
          <JsonValueEditor
            label="Complete configuration"
            value={advancedValues}
            onChange={(value) => {
              if (!isObjectValue(value)) return;
              const bounded = Object.fromEntries(
                Object.entries(value).filter(([fieldId]) =>
                  advancedFieldIds.has(fieldId),
                ),
              );
              onChange({ ...values, ...bounded });
            }}
          />
        </details>
      ) : null}
    </section>
  );
}

export function SystemComposerConfigurationField({
  field,
  value,
  catalog,
  errors,
  onChange,
}: {
  readonly field: AssetConfigurationField;
  readonly value: AssetConfigurationValue | undefined;
  readonly catalog: readonly SystemBuilderComposerAsset[];
  readonly errors: readonly string[];
  readonly onChange: (value: AssetConfigurationValue) => void;
}) {
  const label = field.label ?? field.fieldId;
  const describedBy = `${field.fieldId}-help ${field.fieldId}-errors`;
  const common = {
    id: field.fieldId,
    "aria-invalid": errors.length > 0,
    "aria-describedby": describedBy,
  } as const;
  let control: React.ReactNode;
  if (field.uiHint?.hintKind === "color") {
    const colorValue =
      typeof value === "string" && /^#[0-9A-Fa-f]{6}$/.test(value)
        ? value
        : "#000000";
    control = (
      <div className="system-composer-inspector__color-control">
        <input
          {...common}
          type="color"
          value={colorValue}
          onChange={(event) => onChange(event.currentTarget.value)}
        />
        <output htmlFor={field.fieldId}>{colorValue.toUpperCase()}</output>
      </div>
    );
  } else if (field.valueKind === "boolean") {
    control = (
      <input
        {...common}
        type="checkbox"
        checked={value === true}
        onChange={(event) => onChange(event.currentTarget.checked)}
      />
    );
  } else if (field.options?.length || field.valueKind === "enum") {
    control = (
      <select
        {...common}
        value={value === undefined ? "" : JSON.stringify(value)}
        onChange={(event) =>
          onChange(
            JSON.parse(event.currentTarget.value) as AssetConfigurationValue,
          )
        }
      >
        <option value="">Choose {label}</option>
        {field.options?.map((option, index) => (
          <option
            key={index}
            value={JSON.stringify(option.value)}
            disabled={option.disabled}
          >
            {option.label ?? String(option.value)}
          </option>
        ))}
      </select>
    );
  } else if (field.valueKind === "asset-reference") {
    control = (
      <select
        {...common}
        value={referenceKey(value)}
        onChange={(event) => {
          const selected = catalog.find(
            (item) =>
              `${item.definitionId}@${item.version}` ===
              event.currentTarget.value,
          );
          if (selected) {
            onChange({
              kind: selected.definitionRef.kind,
              id: String(selected.definitionRef.id),
              version: selected.version,
            });
          }
        }}
      >
        <option value="">Choose approved asset</option>
        {catalog.map((item) => (
          <option
            key={`${item.definitionId}@${item.version}`}
            value={`${item.definitionId}@${item.version}`}
          >
            {item.displayName} · v{item.version}
          </option>
        ))}
      </select>
    );
  } else if (
    [
      "resource-reference",
      "artifact-reference",
      "runtime-capability-reference",
    ].includes(field.valueKind)
  ) {
    control = (
      <select {...common} disabled>
        <option>No approved options available</option>
      </select>
    );
  } else if (field.valueKind === "number" || field.valueKind === "integer") {
    control = (
      <input
        {...common}
        type="number"
        step={field.valueKind === "integer" ? 1 : "any"}
        value={typeof value === "number" ? value : ""}
        placeholder={field.uiHint?.placeholder}
        onChange={(event) =>
          onChange(
            event.currentTarget.value === ""
              ? null
              : Number(event.currentTarget.value),
          )
        }
      />
    );
  } else if (
    field.valueKind === "array" ||
    field.valueKind === "object" ||
    field.valueKind === "json"
  ) {
    control = (
      <JsonValueEditor
        label={label}
        hideLabel
        value={value ?? (field.valueKind === "array" ? [] : {})}
        onChange={onChange}
      />
    );
  } else if (field.uiHint?.hintKind === "textarea") {
    control = (
      <textarea
        {...common}
        value={typeof value === "string" ? value : ""}
        placeholder={field.uiHint.placeholder}
        onChange={(event) => onChange(event.currentTarget.value)}
      />
    );
  } else {
    control = (
      <input
        {...common}
        value={typeof value === "string" ? value : ""}
        placeholder={field.uiHint?.placeholder}
        onChange={(event) => onChange(event.currentTarget.value)}
      />
    );
  }
  return (
    <div
      className="system-composer-inspector__field"
      data-invalid={errors.length > 0}
    >
      <label htmlFor={field.fieldId}>
        {label}
        {field.required ? <span aria-hidden="true"> *</span> : null}
      </label>
      {field.description ? (
        <p id={`${field.fieldId}-help`} className="ui-text-muted">
          {field.description}
        </p>
      ) : (
        <span id={`${field.fieldId}-help`} />
      )}
      {control}
      <div
        id={`${field.fieldId}-errors`}
        role={errors.length ? "alert" : undefined}
      >
        {errors.map((error) => (
          <p key={error} className="ui-field-error">
            {error}
          </p>
        ))}
      </div>
    </div>
  );
}

function JsonValueEditor({
  label,
  hideLabel = false,
  value,
  onChange,
}: {
  readonly label: string;
  readonly hideLabel?: boolean;
  readonly value: AssetConfigurationValue;
  readonly onChange: (value: AssetConfigurationValue) => void;
}) {
  const [text, setText] = useState(() => JSON.stringify(value, null, 2));
  const [error, setError] = useState<string>();
  useEffect(() => setText(JSON.stringify(value, null, 2)), [value]);
  return (
    <label
      className={hideLabel ? "system-composer-inspector__json" : undefined}
    >
      {hideLabel ? <span className="ui-sr-only">{label}</span> : label}
      <textarea
        spellCheck={false}
        value={text}
        aria-invalid={Boolean(error)}
        onChange={(event) => setText(event.currentTarget.value)}
      />
      <button
        type="button"
        className="system-composer__flat-control"
        onClick={() => {
          try {
            onChange(JSON.parse(text) as AssetConfigurationValue);
            setError(undefined);
          } catch {
            setError("Enter valid JSON before applying this value.");
          }
        }}
      >
        Apply JSON
      </button>
      {error ? (
        <span className="ui-field-error" role="alert">
          {error}
        </span>
      ) : null}
    </label>
  );
}

function SystemComposerConnections({
  instances,
  catalog,
  bindings,
  onAddConnection,
  onRemoveConnection,
}: Pick<
  SystemComposerInspectorProps,
  | "instances"
  | "catalog"
  | "bindings"
  | "onAddConnection"
  | "onRemoveConnection"
>) {
  const endpoints = useMemo(
    () => listSystemComposerPortEndpoints(instances, catalog),
    [catalog, instances],
  );
  const sources = endpoints.filter((endpoint) =>
    ["output", "event", "control"].includes(endpoint.port.direction),
  );
  const [sourceKey, setSourceKey] = useState("");
  const [targetKey, setTargetKey] = useState("");
  const source = sources.find((endpoint) => endpoint.key === sourceKey);
  const targets = useMemo(
    () => listCompatibleSystemComposerTargets(source, endpoints),
    [endpoints, source],
  );
  const target = targets.find((endpoint) => endpoint.key === targetKey);
  useEffect(() => setTargetKey(""), [sourceKey]);
  return (
    <section
      className="system-composer-connections"
      aria-labelledby="system-composer-connections-title"
    >
      <h3 id="system-composer-connections-title">
        Typed connections and value sources
      </h3>
      <p className="ui-text-muted">
        Connect declared ports only. Containment remains in Structure mode; no
        expressions or arbitrary port names are accepted.
      </p>
      {sources.length ? (
        <div className="system-composer-connections__form">
          <label>
            Source endpoint
            <select
              value={sourceKey}
              onChange={(event) => setSourceKey(event.currentTarget.value)}
            >
              <option value="">Choose declared source</option>
              {sources.map((endpoint) => (
                <option key={endpoint.key} value={endpoint.key}>
                  {endpointLabel(endpoint)}
                </option>
              ))}
            </select>
          </label>
          <label>
            Compatible target
            <select
              value={targetKey}
              disabled={!source}
              onChange={(event) => setTargetKey(event.currentTarget.value)}
            >
              <option value="">Choose compatible target</option>
              {targets.map((endpoint) => (
                <option key={endpoint.key} value={endpoint.key}>
                  {endpointLabel(endpoint)}
                </option>
              ))}
            </select>
          </label>
          {source && !targets.length ? (
            <p className="ui-status ui-status--info">
              No compatible typed targets are available for this source.
            </p>
          ) : null}
          <button
            type="button"
            className="system-composer__flat-control"
            disabled={!source || !target}
            onClick={() => source && target && onAddConnection(source, target)}
          >
            <ApplicationIcon name="link" />
            <span>
              Add{" "}
              {source ? bindingKindForSystemComposerEndpoint(source) : "typed"}{" "}
              connection
            </span>
          </button>
        </div>
      ) : (
        <EmptyState
          compact
          title="No typed source ports"
          description="Add assets with declared output, event, or control ports."
          icon="link"
        />
      )}
      <ul className="system-composer-connections__list">
        {bindings.map((binding) => (
          <li key={String(binding.bindingId)}>
            <span>
              <strong>{binding.bindingKind}</strong> {binding.sourceRef.id}:
              {binding.sourcePortRef?.id ?? "default"} → {binding.targetRef.id}:
              {binding.targetPortRef?.id ?? "default"}
            </span>
            <button
              type="button"
              className="system-composer__flat-control"
              aria-label={`Remove connection ${binding.bindingId}`}
              onClick={() => onRemoveConnection(String(binding.bindingId))}
            >
              <ApplicationIcon name="delete" />
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}

function endpointLabel(endpoint: SystemComposerPortEndpoint): string {
  return `${endpoint.instanceLabel} · ${endpoint.port.displayName ?? endpoint.port.portId}`;
}

function referenceKey(value: AssetConfigurationValue | undefined): string {
  if (!isObjectValue(value)) return "";
  const id = value.id;
  const version = value.version;
  return typeof id === "string" && typeof version === "string"
    ? `${id}@${version}`
    : "";
}

function isObjectValue(
  value: AssetConfigurationValue | undefined,
): value is AssetConfigurationValues {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
