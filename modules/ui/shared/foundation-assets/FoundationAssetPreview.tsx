import { Component, type FormEvent, type ReactNode } from "react";

import { readSystemFoundationBackingResourceProgram } from "../../../application/services/asset-packs/system-foundation-backing-resource-catalog";
import type { AssetJsonValue } from "../../../contracts/asset";

export interface FoundationAssetPreviewProps {
  readonly definitionId: string;
  readonly displayName?: string;
  readonly configuration?: Readonly<Record<string, AssetJsonValue>>;
}

export const MAX_FOUNDATION_PREVIEW_COLLECTION_ITEMS = 50;
export const MAX_FOUNDATION_PREVIEW_TABLE_ROWS = 25;
export const MAX_FOUNDATION_PREVIEW_TABLE_COLUMNS = 20;
export const MAX_FOUNDATION_PREVIEW_TEXT_CHARACTERS = 2_000;

export function FoundationAssetPreview(props: FoundationAssetPreviewProps) {
  return (
    <FoundationAssetPreviewBoundary key={props.definitionId}>
      <FoundationAssetPreviewContent {...props} />
    </FoundationAssetPreviewBoundary>
  );
}

export class FoundationAssetPreviewBoundary extends Component<
  { readonly children: ReactNode },
  { readonly failed: boolean }
> {
  readonly state = { failed: false };

  static getDerivedStateFromError(): { readonly failed: boolean } {
    return { failed: true };
  }

  render(): ReactNode {
    if (this.state.failed) {
      return (
        <div
          className="foundation-preview foundation-preview--unsupported"
          role="status"
          data-preview-recovered="true"
        >
          <strong>Visual preview unavailable</strong>
          <span>
            The preview renderer stopped safely. The asset and current draft
            were not changed.
          </span>
        </div>
      );
    }
    return this.props.children;
  }
}

function FoundationAssetPreviewContent({
  definitionId,
  displayName,
  configuration,
}: FoundationAssetPreviewProps) {
  const program = readSystemFoundationBackingResourceProgram(definitionId);
  if (!program) {
    return (
      <div
        className="foundation-preview foundation-preview--unsupported"
        role="status"
      >
        <strong>Preview unavailable</strong>
        <span>
          This asset does not have a registered system-foundation renderer.
        </span>
      </div>
    );
  }

  const fixture = {
    ...program.previewFixture,
    ...program.previewConfiguration,
    ...configuration,
  };
  const title =
    stringValue(configuration?.title) ?? displayName ?? program.displayName;
  switch (program.previewKind) {
    case "form":
      return <FormPreview title={title} fixture={fixture} />;
    case "data":
      return <DataPreview title={title} fixture={fixture} />;
    case "conversation":
      return <ConversationPreview title={title} fixture={fixture} />;
    case "workflow":
      return (
        <OrderedPreview
          title={title}
          label="Workflow steps"
          values={
            program.backendSteps.length
              ? program.backendSteps
              : stringArray(fixture.steps)
          }
        />
      );
    case "policy":
      return (
        <PolicyPreview title={title} reason={stringValue(fixture.reason)} />
      );
    case "state":
      return (
        <StatePreview title={title} message={stringValue(fixture.message)} />
      );
    case "layout":
      return (
        <OrderedPreview
          title={title}
          label="Layout regions"
          values={stringArray(fixture.regions)}
        />
      );
    default:
      return (
        <PreviewFrame title={title} kind="Semantic default">
          <p>
            {stringValue(fixture.summary) ??
              "Portable system-foundation building block."}
          </p>
        </PreviewFrame>
      );
  }
}

function PreviewFrame({
  title,
  kind,
  children,
}: {
  readonly title: string;
  readonly kind: string;
  readonly children: ReactNode;
}) {
  return (
    <div className="foundation-preview">
      <div className="foundation-preview__heading">
        <div>
          <span className="foundation-preview__eyebrow">{kind}</span>
          <strong>{title}</strong>
        </div>
        <span className="asset-library-badge asset-library-badge--system">
          System default
        </span>
      </div>
      <div className="foundation-preview__surface">{children}</div>
    </div>
  );
}

function FormPreview({
  title,
  fixture,
}: {
  readonly title: string;
  readonly fixture: Record<string, AssetJsonValue>;
}) {
  const fields = objectArray(fixture.fields);
  const onSubmit = (event: FormEvent<HTMLFormElement>) =>
    event.preventDefault();
  return (
    <PreviewFrame title={title} kind="Accessible form preview">
      <form
        className="foundation-preview__form"
        onSubmit={onSubmit}
        aria-label={`${title} preview`}
      >
        {fields.map((field, index) => {
          const id = `foundation-preview-${index}`;
          return (
            <label key={id} htmlFor={id}>
              <span>
                {stringValue(field.label) ?? `Field ${index + 1}`}
                {field.required === true ? " *" : ""}
              </span>
              <input
                id={id}
                value={stringValue(field.value) ?? ""}
                readOnly
                required={field.required === true}
              />
            </label>
          );
        })}
        <button className="ui-button" type="submit">
          {stringValue(fixture.submitLabel) ?? "Save"}
        </button>
      </form>
    </PreviewFrame>
  );
}

function DataPreview({
  title,
  fixture,
}: {
  readonly title: string;
  readonly fixture: Record<string, AssetJsonValue>;
}) {
  const columns = stringArray(fixture.columns);
  const rows = arrayArray(fixture.rows);
  return (
    <PreviewFrame title={title} kind="Bounded data preview">
      <div
        className="foundation-preview__table-wrap"
        tabIndex={0}
        aria-label={`${title} table preview`}
      >
        <table>
          <thead>
            <tr>
              {columns.map((column) => (
                <th scope="col" key={column}>
                  {column}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, rowIndex) => (
              <tr key={rowIndex}>
                {row.map((cell, cellIndex) => (
                  <td key={cellIndex}>{stringValue(cell) ?? "-"}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </PreviewFrame>
  );
}

function ConversationPreview({
  title,
  fixture,
}: {
  readonly title: string;
  readonly fixture: Record<string, AssetJsonValue>;
}) {
  const messages = objectArray(fixture.messages);
  return (
    <PreviewFrame title={title} kind="Conversation preview">
      <ol
        className="foundation-preview__messages"
        aria-label="Example conversation"
      >
        {messages.map((message, index) => (
          <li key={index} data-role={stringValue(message.role) ?? "assistant"}>
            <strong>
              {stringValue(message.role) === "user" ? "You" : "Assistant"}
            </strong>
            <span>{stringValue(message.text)}</span>
          </li>
        ))}
      </ol>
      <label className="foundation-preview__composer">
        <span>Message</span>
        <textarea value="Preview input" readOnly />
      </label>
      <button className="ui-button" type="button" disabled>
        Send preview
      </button>
    </PreviewFrame>
  );
}

function OrderedPreview({
  title,
  label,
  values,
}: {
  readonly title: string;
  readonly label: string;
  readonly values: readonly string[];
}) {
  return (
    <PreviewFrame title={title} kind={label}>
      <ol className="foundation-preview__steps">
        {values.map((value, index) => (
          <li key={`${value}-${index}`}>
            <span>{index + 1}</span>
            {value}
          </li>
        ))}
      </ol>
    </PreviewFrame>
  );
}

function PolicyPreview({
  title,
  reason,
}: {
  readonly title: string;
  readonly reason?: string;
}) {
  return (
    <PreviewFrame title={title} kind="Fail-closed policy preview">
      <div className="foundation-preview__policy" role="status">
        <strong>Denied by default</strong>
        <span>
          {reason ?? "Required policy evidence has not been provided."}
        </span>
      </div>
    </PreviewFrame>
  );
}

function StatePreview({
  title,
  message,
}: {
  readonly title: string;
  readonly message?: string;
}) {
  return (
    <PreviewFrame title={title} kind="Application state preview">
      <div className="foundation-preview__state" role="status">
        {message ?? "State preview"}
      </div>
    </PreviewFrame>
  );
}

function stringValue(value: AssetJsonValue | undefined): string | undefined {
  return typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
    ? String(value).slice(0, MAX_FOUNDATION_PREVIEW_TEXT_CHARACTERS)
    : undefined;
}

function stringArray(value: AssetJsonValue | undefined): readonly string[] {
  return Array.isArray(value)
    ? value
        .slice(0, MAX_FOUNDATION_PREVIEW_COLLECTION_ITEMS)
        .map(stringValue)
        .filter((item): item is string => Boolean(item))
    : [];
}

function objectArray(
  value: AssetJsonValue | undefined,
): readonly Record<string, AssetJsonValue>[] {
  return Array.isArray(value)
    ? value
        .filter(
          (item): item is Record<string, AssetJsonValue> =>
            Boolean(item) && typeof item === "object" && !Array.isArray(item),
        )
        .slice(0, MAX_FOUNDATION_PREVIEW_COLLECTION_ITEMS)
    : [];
}

function arrayArray(
  value: AssetJsonValue | undefined,
): readonly (readonly AssetJsonValue[])[] {
  return Array.isArray(value)
    ? value
        .filter((item): item is readonly AssetJsonValue[] =>
          Array.isArray(item),
        )
        .slice(0, MAX_FOUNDATION_PREVIEW_TABLE_ROWS)
        .map((row) => row.slice(0, MAX_FOUNDATION_PREVIEW_TABLE_COLUMNS))
    : [];
}
