import {
  Children,
  type CSSProperties,
  type FormEvent,
  type ReactNode,
} from "react";

import type { SystemFoundationBackingResourceProgram } from "../../../application/services/asset-packs/system-foundation-backing-resource-catalog";
import type { AssetJsonValue } from "../../../contracts/asset";

export interface FoundationAssetSurfaceProps {
  readonly definitionId: string;
  readonly displayName: string;
  readonly configuration?: Readonly<Record<string, AssetJsonValue>>;
  readonly program: SystemFoundationBackingResourceProgram;
  readonly regions?: Readonly<Record<string, ReactNode>>;
}

export function FoundationAssetSurface({
  definitionId,
  displayName,
  configuration,
  program,
  regions = {},
}: FoundationAssetSurfaceProps) {
  const values = {
    ...program.previewFixture,
    ...program.previewConfiguration,
    ...configuration,
  };
  const title =
    stringValue(configuration?.title) ||
    stringValue(configuration?.label) ||
    displayName;
  const description = stringValue(configuration?.description);
  const region = (id: string) => regions[id] ?? null;
  const hasRegion = (id: string) => Children.count(region(id)) > 0;
  const allRegions = program.regions.map((item) => (
    <div key={item.slotId} data-slot={item.slotId}>
      {region(item.slotId)}
    </div>
  ));
  const common = {
    className:
      "foundation-surface foundation-surface--" +
      definitionId.replace(/[^A-Za-z0-9_-]/g, "-"),
    "data-foundation-definition": definitionId,
    ...foundationPresentationProps(configuration),
  };

  if (definitionId === "builtin.system.system") {
    return <div {...common}>{region("application-shell")}</div>;
  }
  if (definitionId.startsWith("builtin.layout.")) {
    return (
      <div {...common} data-foundation-layout={definitionId}>
        {allRegions}
      </div>
    );
  }
  if (definitionId === "builtin.shell.navigation-group") {
    const label =
      stringValue(configuration?.label) ||
      stringValue(configuration?.accessibilityLabel) ||
      title;
    return (
      <nav {...common} aria-label={label}>
        <strong>{label}</strong>
        {hasRegion("items") ? (
          region("items")
        ) : (
          <ul>
            <li>
              <button type="button" aria-current="page">
                Overview
              </button>
            </li>
          </ul>
        )}
      </nav>
    );
  }
  if (definitionId === "builtin.shell.page") {
    return (
      <main {...common}>
        <header>
          <h1>{title}</h1>
          {description ? <p>{description}</p> : null}
        </header>
        <div data-slot="content">{region("content")}</div>
        {hasRegion("actions") ? (
          <footer data-slot="actions">{region("actions")}</footer>
        ) : null}
      </main>
    );
  }
  if (definitionId === "builtin.shell.resource-browser") {
    return (
      <section {...common} aria-label={title}>
        <header>
          <h2>{title}</h2>
          {description ? <p>{description}</p> : null}
        </header>
        <div className="foundation-surface__filters" data-slot="filters">
          {region("filters")}
        </div>
        <div data-slot="results">
          {hasRegion("results") ? region("results") : region("states")}
        </div>
        {hasRegion("actions") ? (
          <div data-slot="actions">{region("actions")}</div>
        ) : null}
      </section>
    );
  }
  if (definitionId === "builtin.shell.detail-page") {
    return (
      <article {...common}>
        <header>
          <h2>{title}</h2>
          {description ? <p>{description}</p> : null}
          {hasRegion("actions") ? (
            <div data-slot="actions">{region("actions")}</div>
          ) : null}
        </header>
        <div data-slot="summary">{region("summary")}</div>
        <div data-slot="content">{region("content")}</div>
        {!hasRegion("summary") &&
        !hasRegion("content") &&
        hasRegion("states") ? (
          <div data-slot="states">{region("states")}</div>
        ) : null}
      </article>
    );
  }
  if (
    definitionId === "builtin.shell.feature" ||
    definitionId === "builtin.shell.dashboard-section" ||
    definitionId === "builtin.shell.settings-panel" ||
    definitionId === "builtin.shell.wizard-step" ||
    definitionId === "conversation.basic-assistant-system"
  ) {
    return (
      <section
        {...common}
        aria-label={
          definitionId === "conversation.basic-assistant-system"
            ? stringValue(configuration?.accessibilityLabel) || title
            : title
        }
      >
        <header>
          <h2>{title}</h2>
          {description ? <p>{description}</p> : null}
        </header>
        <div
          data-slot={
            definitionId.startsWith("conversation.") ? "interface" : "content"
          }
        >
          {region("interface") || region("content")}
        </div>
        {hasRegion("actions") ? (
          <div data-slot="actions">{region("actions")}</div>
        ) : null}
        {!hasRegion("interface") &&
        !hasRegion("content") &&
        hasRegion("states") ? (
          <div data-slot="states">{region("states")}</div>
        ) : null}
      </section>
    );
  }
  if (definitionId === "builtin.ui.card") {
    return (
      <article {...common}>
        {hasRegion("media") ? (
          <div data-slot="media">{region("media")}</div>
        ) : null}
        <header>
          <h2>{title}</h2>
          {description ? <p>{description}</p> : null}
        </header>
        <div data-slot="content">{region("content")}</div>
        {hasRegion("actions") ? (
          <footer data-slot="actions">{region("actions")}</footer>
        ) : null}
      </article>
    );
  }
  if (
    definitionId === "builtin.ui.section" ||
    definitionId === "builtin.ui.panel"
  ) {
    return (
      <section {...common} aria-label={title}>
        <header>
          <h2>{title}</h2>
          {description ? <p>{description}</p> : null}
        </header>
        <div data-slot="content">{region("content")}</div>
        {hasRegion("actions") ? (
          <footer data-slot="actions">{region("actions")}</footer>
        ) : null}
      </section>
    );
  }
  if (definitionId === "builtin.ui.collapsible-section") {
    return (
      <details {...common} open={configuration?.defaultExpanded !== false}>
        <summary>{title}</summary>
        <div data-slot="content">{region("content")}</div>
      </details>
    );
  }
  if (definitionId === "builtin.ui.tabs") {
    return (
      <section {...common} aria-label={title}>
        <div role="tablist" aria-label={title}>
          <button type="button" role="tab" aria-selected="true">
            {stringValue(configuration?.defaultTab) || "Overview"}
          </button>
        </div>
        <div role="tabpanel" data-slot="tabs">
          {region("tabs")}
        </div>
      </section>
    );
  }
  if (
    definitionId === "builtin.ui.container" ||
    definitionId === "builtin.ui.stack" ||
    definitionId === "builtin.ui.grid"
  ) {
    const slotId =
      definitionId === "builtin.ui.container" ? "content" : "items";
    return (
      <div {...common} data-slot={slotId}>
        {region(slotId)}
      </div>
    );
  }
  if (definitionId === "builtin.form.form") {
    const onSubmit = (event: FormEvent<HTMLFormElement>) =>
      event.preventDefault();
    return (
      <form {...common} onSubmit={onSubmit} aria-label={title}>
        <fieldset>
          <legend>{title}</legend>
          {description ? <p>{description}</p> : null}
          <div data-slot="fields">{region("fields")}</div>
        </fieldset>
        {hasRegion("messages") ? (
          <div data-slot="messages">{region("messages")}</div>
        ) : null}
        {hasRegion("actions") ? (
          <div data-slot="actions">{region("actions")}</div>
        ) : null}
      </form>
    );
  }
  if (definitionId === "builtin.form.field-group") {
    const fields = (
      <>
        {description ? <p>{description}</p> : null}
        <div data-slot="fields">{region("fields")}</div>
        {hasRegion("messages") ? (
          <div data-slot="messages">{region("messages")}</div>
        ) : null}
      </>
    );
    return configuration?.collapsible === true ? (
      <details {...common} open={configuration.defaultExpanded !== false}>
        <summary>{title}</summary>
        {fields}
      </details>
    ) : (
      <fieldset {...common}>
        <legend>{title}</legend>
        {fields}
      </fieldset>
    );
  }
  if (definitionId.startsWith("builtin.form.")) {
    return renderFormControl(
      common,
      definitionId,
      title,
      configuration,
      values,
    );
  }
  if (definitionId === "builtin.display.table") {
    const configuredColumns = stringArray(configuration?.columns);
    const columns = configuredColumns.length
      ? configuredColumns
      : stringArray(program.previewFixture.columns);
    const rows = arrayArray(values.rows);
    return (
      <section {...common} aria-label={title}>
        <h2>{title}</h2>
        <table>
          <thead>
            <tr>
              {columns.map((value) => (
                <th key={value} scope="col">
                  {value}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, index) => (
              <tr key={index}>
                {row.map((value, cell) => (
                  <td key={cell}>{stringValue(value)}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    );
  }
  if (
    definitionId === "builtin.display.detail-view" ||
    definitionId === "builtin.display.key-value-summary"
  ) {
    return (
      <section {...common} aria-label={title}>
        <h2>{title}</h2>
        <dl>
          <div>
            <dt>Name</dt>
            <dd>Example record</dd>
          </div>
          <div>
            <dt>Status</dt>
            <dd>Ready</dd>
          </div>
        </dl>
        {hasRegion("content") ? (
          <div data-slot="content">{region("content")}</div>
        ) : null}
        {hasRegion("actions") ? (
          <div data-slot="actions">{region("actions")}</div>
        ) : null}
      </section>
    );
  }
  if (definitionId === "builtin.display.list") {
    const items = arrayArray(values.rows);
    return (
      <section {...common} aria-label={title}>
        <h2>{title}</h2>
        <ul>
          {items.map((item, index) => (
            <li key={index}>
              <strong>{stringValue(item[0]) || `Item ${index + 1}`}</strong>
              {item[1] ? <span>{stringValue(item[1])}</span> : null}
            </li>
          ))}
        </ul>
      </section>
    );
  }
  if (definitionId === "builtin.display.status-badge") {
    const label = stringValue(configuration?.label) || title;
    const status = stringValue(configuration?.status);
    return (
      <span {...common} role="status">
        {label}
        {status && status !== label ? `: ${status}` : ""}
      </span>
    );
  }
  if (definitionId === "builtin.display.progress-indicator") {
    return (
      <label {...common}>
        <span>{title}</span>
        <progress value={numberValue(configuration?.value) ?? 40} max={100} />
      </label>
    );
  }
  if (definitionId === "builtin.display.image-preview-placeholder") {
    return (
      <figure {...common}>
        <div
          role="img"
          aria-label={stringValue(configuration?.altText) || title}
        >
          Image preview
        </div>
        <figcaption>{title}</figcaption>
      </figure>
    );
  }
  if (definitionId === "builtin.display.resource-preview-placeholder") {
    return (
      <article {...common} aria-label={title}>
        <h2>{title}</h2>
        <p>{description || "Select an authorized resource to preview it."}</p>
      </article>
    );
  }
  if (definitionId.startsWith("builtin.display.")) {
    return (
      <section {...common} aria-label={title}>
        <h2>{title}</h2>
        <p>{stringValue(values.summary) || "Example preview content"}</p>
      </section>
    );
  }
  if (definitionId.startsWith("builtin.state.")) {
    const error = definitionId.includes("error");
    return (
      <div {...common} role={error ? "alert" : "status"}>
        <strong>{title}</strong>
        <p>
          {stringValue(configuration?.message) || stringValue(values.message)}
        </p>
      </div>
    );
  }
  if (definitionId === "conversation.chat-shell") {
    const accessibilityLabel =
      stringValue(configuration?.accessibilityLabel) || title;
    return (
      <section {...common} aria-label={accessibilityLabel}>
        <header>
          <h2>{title}</h2>
          {description ? <p>{description}</p> : null}
          <div data-slot="status">{region("status")}</div>
        </header>
        <div data-slot="history">{region("history")}</div>
        {!hasRegion("history") &&
        !hasRegion("composer") &&
        hasRegion("states") ? (
          <div data-slot="states">{region("states")}</div>
        ) : null}
        <footer data-slot="composer">{region("composer")}</footer>
      </section>
    );
  }
  if (definitionId === "conversation.message-history-display") {
    const historyTitle = stringValue(configuration?.title) || "Conversation";
    return (
      <section
        {...common}
        aria-label={
          stringValue(configuration?.accessibilityLabel) ||
          "Conversation history"
        }
      >
        <h3>{historyTitle}</h3>
        <ol>
          <li>
            <strong>
              {stringValue(configuration?.userRoleLabel) || "You"}
            </strong>
            <p>
              {stringValue(configuration?.sampleUserMessage) ||
                "How can this system help?"}
            </p>
          </li>
          <li>
            <strong>
              {stringValue(configuration?.assistantRoleLabel) || "Assistant"}
            </strong>
            <p>
              {stringValue(configuration?.sampleAssistantMessage) ||
                "This is a safe preview response."}
            </p>
          </li>
        </ol>
        {hasRegion("messages") ? (
          <div data-slot="messages">{region("messages")}</div>
        ) : null}
      </section>
    );
  }
  if (definitionId === "conversation.assistant-response-panel") {
    const responseTitle =
      stringValue(configuration?.title) || "Assistant response";
    return (
      <section
        {...common}
        aria-label={
          stringValue(configuration?.accessibilityLabel) || responseTitle
        }
      >
        <h3>{responseTitle}</h3>
        <div data-slot="content">{region("content")}</div>
        {!hasRegion("content") && hasRegion("states") ? (
          <div data-slot="states">{region("states")}</div>
        ) : null}
      </section>
    );
  }
  if (definitionId === "conversation.message-composer") {
    return (
      <form
        {...common}
        onSubmit={(event) => event.preventDefault()}
        aria-label={
          stringValue(configuration?.accessibilityLabel) || "Message composer"
        }
      >
        <div data-slot="input">{region("input")}</div>
        <div data-slot="actions">{region("actions")}</div>
      </form>
    );
  }
  if (definitionId === "conversation.user-message-input") {
    return (
      <label {...common}>
        <span>{stringValue(configuration?.label) || "Message"}</span>
        <textarea
          aria-label={
            stringValue(configuration?.accessibilityLabel) ||
            stringValue(configuration?.label) ||
            "Message"
          }
          placeholder={stringValue(configuration?.placeholder) || undefined}
          value={stringValue(configuration?.previewValue) || "Preview message"}
          readOnly
        />
      </label>
    );
  }
  if (definitionId === "conversation.assistant-text-response-output") {
    return (
      <p
        {...common}
        aria-label={
          stringValue(configuration?.accessibilityLabel) || "Assistant response"
        }
      >
        {stringValue(configuration?.content) ||
          "The assistant response will appear here."}
      </p>
    );
  }
  if (definitionId.startsWith("conversation.")) {
    return (
      <section {...common} aria-label={title}>
        {allRegions}
      </section>
    );
  }
  if (definitionId === "builtin.preview.artifact") {
    const preview = Children.toArray(region("previews"))[0] ?? null;
    return (
      <section {...common} aria-label={title}>
        <h2>{title}</h2>
        <div data-slot="previews">{preview || region("states")}</div>
      </section>
    );
  }
  if (definitionId.startsWith("builtin.preview.")) {
    return (
      <figure {...common}>
        <div role="img" aria-label={title}>
          Preview
        </div>
        <figcaption>{title}</figcaption>
      </figure>
    );
  }
  return (
    <section {...common} aria-label={title}>
      <header>
        <h2>{title}</h2>
      </header>
      {allRegions}
    </section>
  );
}

const FOUNDATION_THEME_COLOR_PROPERTIES = {
  themeColorPrimary: "--foundation-color-primary",
  themeColorSecondary: "--foundation-color-secondary",
  themeColorTertiary: "--foundation-color-tertiary",
  themeColorSurface: "--foundation-color-surface",
  themeColorCanvas: "--foundation-color-canvas",
  themeColorText: "--foundation-color-text",
  themeColorMutedText: "--foundation-color-muted-text",
  themeColorBorder: "--foundation-color-border",
  themeColorSuccess: "--foundation-color-success",
  themeColorDanger: "--foundation-color-danger",
} as const;

function foundationPresentationProps(
  configuration: Readonly<Record<string, AssetJsonValue>> | undefined,
) {
  const style: Record<string, string> = {};
  for (const [fieldId, property] of Object.entries(
    FOUNDATION_THEME_COLOR_PROPERTIES,
  )) {
    const value = stringValue(configuration?.[fieldId]);
    if (value && /^#[0-9A-Fa-f]{6}$/.test(value)) style[property] = value;
  }
  return {
    style: (Object.keys(style).length ? style : undefined) as
      CSSProperties | undefined,
    "data-theme-font-family": semanticChoice(configuration, "themeFontFamily"),
    "data-theme-text-size": semanticChoice(configuration, "themeTextSize"),
    "data-theme-heading-scale": semanticChoice(
      configuration,
      "themeHeadingScale",
    ),
    "data-theme-density": semanticChoice(configuration, "themeDensity"),
    "data-theme-button-treatment": semanticChoice(
      configuration,
      "themeButtonTreatment",
    ),
    "data-theme-button-shape": semanticChoice(
      configuration,
      "themeButtonShape",
    ),
    "data-theme-form-treatment": semanticChoice(
      configuration,
      "themeFormTreatment",
    ),
    "data-theme-surface-treatment": semanticChoice(
      configuration,
      "themeSurfaceTreatment",
    ),
    "data-style-surface-role": semanticChoice(
      configuration,
      "styleSurfaceRole",
    ),
    "data-style-text-role": semanticChoice(configuration, "styleTextRole"),
    "data-style-typography-role": semanticChoice(
      configuration,
      "styleTypographyRole",
    ),
    "data-style-spacing": semanticChoice(configuration, "styleSpacing"),
    "data-style-border": semanticChoice(configuration, "styleBorder"),
    "data-style-button-role": semanticChoice(configuration, "styleButtonRole"),
    "data-style-button-treatment": semanticChoice(
      configuration,
      "styleButtonTreatment",
    ),
    "data-style-form-role": semanticChoice(configuration, "styleFormRole"),
    "data-style-form-treatment": semanticChoice(
      configuration,
      "styleFormTreatment",
    ),
    "data-style-control-size": semanticChoice(
      configuration,
      "styleControlSize",
    ),
  };
}

function semanticChoice(
  configuration: Readonly<Record<string, AssetJsonValue>> | undefined,
  fieldId: string,
): string | undefined {
  const value = stringValue(configuration?.[fieldId]);
  return value && value !== "inherit" ? value : undefined;
}

function renderFormControl(
  common: {
    readonly className: string;
    readonly "data-foundation-definition": string;
  },
  definitionId: string,
  title: string,
  configuration: Readonly<Record<string, AssetJsonValue>> | undefined,
  values: Readonly<Record<string, AssetJsonValue>>,
): ReactNode {
  const label = stringValue(configuration?.label) || title;
  if (definitionId === "builtin.form.submit-action") {
    return (
      <button {...common} type="submit">
        {label}
      </button>
    );
  }
  if (definitionId === "builtin.form.cancel-action") {
    return (
      <button {...common} type="button">
        {label}
      </button>
    );
  }
  if (definitionId === "builtin.form.validation-message") {
    return (
      <p {...common} role="alert">
        {stringValue(configuration?.message) || label}
      </p>
    );
  }
  if (definitionId === "builtin.form.checkbox-field") {
    return (
      <label {...common}>
        <input type="checkbox" required={configuration?.required === true} />{" "}
        <span>{label}</span>
      </label>
    );
  }
  if (definitionId === "builtin.form.radio-group") {
    const options = objectArray(configuration?.staticOptions);
    const defaultValue = stringValue(configuration?.defaultValue);
    return (
      <fieldset {...common}>
        <legend>
          {label}
          {configuration?.required === true ? " *" : ""}
        </legend>
        {stringValue(configuration?.helpText) ? (
          <p>{stringValue(configuration?.helpText)}</p>
        ) : null}
        {options.map((option, index) => {
          const value = stringValue(option.value) || String(index);
          return (
            <label key={value}>
              <input
                type="radio"
                name={definitionId}
                value={value}
                defaultChecked={value === defaultValue}
                required={index === 0 && configuration?.required === true}
                disabled={configuration?.disabled === true}
              />
              <span>{stringValue(option.label) || `Option ${index + 1}`}</span>
            </label>
          );
        })}
      </fieldset>
    );
  }
  if (definitionId === "builtin.form.select-field") {
    const options = objectArray(configuration?.staticOptions);
    return (
      <label {...common}>
        <span>
          {label}
          {configuration?.required === true ? " *" : ""}
        </span>
        <select defaultValue="" required={configuration?.required === true}>
          <option value="">Select</option>
          {options.map((option, index) => (
            <option
              key={index}
              value={stringValue(option.value) || String(index)}
            >
              {stringValue(option.label) || "Option"}
            </option>
          ))}
        </select>
      </label>
    );
  }
  if (definitionId === "builtin.form.text-area") {
    return (
      <label {...common}>
        <span>
          {label}
          {configuration?.required === true ? " *" : ""}
        </span>
        <textarea
          required={configuration?.required === true}
          placeholder={stringValue(configuration?.placeholder) || undefined}
        />
      </label>
    );
  }
  const type =
    definitionId === "builtin.form.number-field"
      ? "number"
      : definitionId === "builtin.form.date-time-field"
        ? "date"
        : "text";
  return (
    <label {...common}>
      <span>
        {label}
        {configuration?.required === true ? " *" : ""}
      </span>
      <input
        type={type}
        required={configuration?.required === true}
        min={numberValue(configuration?.minimum)}
        max={numberValue(configuration?.maximum)}
        placeholder={stringValue(configuration?.placeholder) || undefined}
      />
    </label>
  );
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function numberValue(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value)
    ? value
    : undefined;
}

function stringArray(value: unknown): readonly string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
}

function objectArray(
  value: unknown,
): readonly Readonly<Record<string, AssetJsonValue>>[] {
  return Array.isArray(value)
    ? value.filter(
        (item): item is Readonly<Record<string, AssetJsonValue>> =>
          Boolean(item) && typeof item === "object" && !Array.isArray(item),
      )
    : [];
}

function arrayArray(value: unknown): readonly (readonly AssetJsonValue[])[] {
  return Array.isArray(value)
    ? value.filter((item): item is readonly AssetJsonValue[] =>
        Array.isArray(item),
      )
    : [];
}
