import { useMemo } from "react";

import type {
  AssetConfigurationValue,
  AssetConfigurationValues,
  AssetInstance,
} from "../../../contracts/asset";
import type { SystemBuilderComposerAsset } from "../../../contracts/system-builder";
import { ApplicationIcon } from "../components/ApplicationIcon";
import { EmptyState } from "../components/EmptyState";
import { SystemComposerConfigurationField } from "./SystemComposerInspector";
import {
  buildSystemComposerConfigurationSections,
  isSystemComposerStylingField,
  materializeSystemComposerConfiguration,
  validateSystemComposerConfiguration,
} from "./systemComposerInspectorModel";

export interface SystemComposerStylingPanelProps {
  readonly rootInstance?: AssetInstance;
  readonly rootDefinition?: SystemBuilderComposerAsset;
  readonly catalog: readonly SystemBuilderComposerAsset[];
  readonly onChange: (values: AssetConfigurationValues) => void;
}

export function SystemComposerStylingPanel({
  rootInstance,
  rootDefinition,
  catalog,
  onChange,
}: SystemComposerStylingPanelProps) {
  const values = useMemo(
    () =>
      rootDefinition
        ? materializeSystemComposerConfiguration(
            rootDefinition,
            rootInstance?.selectedConfiguration,
          )
        : {},
    [rootDefinition, rootInstance?.selectedConfiguration],
  );
  const sections = useMemo(
    () =>
      buildSystemComposerConfigurationSections(
        rootDefinition?.configurationSchema,
        { includeField: isSystemComposerStylingField },
      ),
    [rootDefinition?.configurationSchema],
  );
  const errors = useMemo(
    () =>
      validateSystemComposerConfiguration(
        rootDefinition?.configurationSchema,
        values,
      ),
    [rootDefinition?.configurationSchema, values],
  );

  if (!rootInstance || !rootDefinition || !sections.length) {
    return (
      <EmptyState
        compact
        icon="settings"
        title="System styling is unavailable"
        description="This system uses an earlier Foundation release. Upgrade it explicitly to edit the reusable bounded style profile."
      />
    );
  }

  const update = (fieldId: string, value: AssetConfigurationValue) =>
    onChange({ ...values, [fieldId]: value });
  const resetTheme = () => {
    const defaults = materializeSystemComposerConfiguration(
      rootDefinition,
      undefined,
    );
    const next = { ...values };
    for (const section of sections) {
      for (const field of section.fields) {
        if (defaults[field.fieldId] !== undefined) {
          next[field.fieldId] = defaults[field.fieldId];
        }
      }
    }
    onChange(next);
  };

  return (
    <section
      className="system-composer-inspector system-composer-styling"
      aria-labelledby="system-composer-styling-title"
    >
      <header className="system-composer-inspector__header">
        <div>
          <h3 id="system-composer-styling-title">System styling</h3>
          <p>Reusable semantic styles inherited by the complete Canvas.</p>
        </div>
        <button
          type="button"
          className="system-composer__flat-control"
          onClick={resetTheme}
        >
          <ApplicationIcon name="refresh" />
          <span>Reset theme</span>
        </button>
      </header>
      <p className="ui-status ui-status--info">
        Choose from bounded colors and style roles. Raw CSS, selectors, and
        arbitrary dimensions are not accepted.
      </p>
      {sections.map((section) => (
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
      ))}
    </section>
  );
}
