import type { FormEvent, ReactNode } from "react";

import { readSystemFoundationBackingResourceProgram } from "../../../application/services/asset-packs/system-foundation-backing-resource-catalog";
import type { AssetJsonValue } from "../../../contracts/asset";

export interface FoundationAssetPreviewProps {
  readonly definitionId: string;
  readonly displayName?: string;
}

export function FoundationAssetPreview({ definitionId, displayName }: FoundationAssetPreviewProps) {
  const program = readSystemFoundationBackingResourceProgram(definitionId);
  if (!program) {
    return (
      <div className="foundation-preview foundation-preview--unsupported" role="status">
        <strong>Preview unavailable</strong>
        <span>This asset does not have a registered system-foundation renderer.</span>
      </div>
    );
  }

  const title = displayName ?? program.displayName;
  switch (program.previewKind) {
    case "form": return <FormPreview title={title} fixture={program.previewFixture} />;
    case "data": return <DataPreview title={title} fixture={program.previewFixture} />;
    case "conversation": return <ConversationPreview title={title} fixture={program.previewFixture} />;
    case "workflow": return <OrderedPreview title={title} label="Workflow steps" values={program.backendSteps.length ? program.backendSteps : stringArray(program.previewFixture.steps)} />;
    case "policy": return <PolicyPreview title={title} reason={stringValue(program.previewFixture.reason)} />;
    case "state": return <StatePreview title={title} message={stringValue(program.previewFixture.message)} />;
    case "layout": return <OrderedPreview title={title} label="Layout regions" values={stringArray(program.previewFixture.regions)} />;
    default:
      return <PreviewFrame title={title} kind="Semantic default"><p>{stringValue(program.previewFixture.summary) ?? "Portable system-foundation building block."}</p></PreviewFrame>;
  }
}

function PreviewFrame({ title, kind, children }: { readonly title: string; readonly kind: string; readonly children: ReactNode }) {
  return (
    <div className="foundation-preview">
      <div className="foundation-preview__heading">
        <div><span className="foundation-preview__eyebrow">{kind}</span><strong>{title}</strong></div>
        <span className="asset-library-badge asset-library-badge--system">System default</span>
      </div>
      <div className="foundation-preview__surface">{children}</div>
    </div>
  );
}

function FormPreview({ title, fixture }: { readonly title: string; readonly fixture: Record<string, AssetJsonValue> }) {
  const fields = objectArray(fixture.fields);
  const onSubmit = (event: FormEvent<HTMLFormElement>) => event.preventDefault();
  return (
    <PreviewFrame title={title} kind="Accessible form preview">
      <form className="foundation-preview__form" onSubmit={onSubmit} aria-label={`${title} preview`}>
        {fields.map((field, index) => {
          const id = `foundation-preview-${index}`;
          return <label key={id} htmlFor={id}><span>{stringValue(field.label) ?? `Field ${index + 1}`}{field.required === true ? " *" : ""}</span><input id={id} value={stringValue(field.value) ?? ""} readOnly required={field.required === true} /></label>;
        })}
        <button className="ui-button" type="submit">{stringValue(fixture.submitLabel) ?? "Save"}</button>
      </form>
    </PreviewFrame>
  );
}

function DataPreview({ title, fixture }: { readonly title: string; readonly fixture: Record<string, AssetJsonValue> }) {
  const columns = stringArray(fixture.columns);
  const rows = arrayArray(fixture.rows);
  return (
    <PreviewFrame title={title} kind="Bounded data preview">
      <div className="foundation-preview__table-wrap" tabIndex={0} aria-label={`${title} table preview`}>
        <table><thead><tr>{columns.map((column) => <th scope="col" key={column}>{column}</th>)}</tr></thead><tbody>{rows.map((row, rowIndex) => <tr key={rowIndex}>{row.map((cell, cellIndex) => <td key={cellIndex}>{stringValue(cell) ?? "-"}</td>)}</tr>)}</tbody></table>
      </div>
    </PreviewFrame>
  );
}

function ConversationPreview({ title, fixture }: { readonly title: string; readonly fixture: Record<string, AssetJsonValue> }) {
  const messages = objectArray(fixture.messages);
  return (
    <PreviewFrame title={title} kind="Conversation preview">
      <ol className="foundation-preview__messages" aria-label="Example conversation">{messages.map((message, index) => <li key={index} data-role={stringValue(message.role) ?? "assistant"}><strong>{stringValue(message.role) === "user" ? "You" : "Assistant"}</strong><span>{stringValue(message.text)}</span></li>)}</ol>
      <label className="foundation-preview__composer"><span>Message</span><textarea value="Preview input" readOnly /></label>
      <button className="ui-button" type="button" disabled>Send preview</button>
    </PreviewFrame>
  );
}

function OrderedPreview({ title, label, values }: { readonly title: string; readonly label: string; readonly values: readonly string[] }) {
  return <PreviewFrame title={title} kind={label}><ol className="foundation-preview__steps">{values.map((value, index) => <li key={`${value}-${index}`}><span>{index + 1}</span>{value}</li>)}</ol></PreviewFrame>;
}

function PolicyPreview({ title, reason }: { readonly title: string; readonly reason?: string }) {
  return <PreviewFrame title={title} kind="Fail-closed policy preview"><div className="foundation-preview__policy" role="status"><strong>Denied by default</strong><span>{reason ?? "Required policy evidence has not been provided."}</span></div></PreviewFrame>;
}

function StatePreview({ title, message }: { readonly title: string; readonly message?: string }) {
  return <PreviewFrame title={title} kind="Application state preview"><div className="foundation-preview__state" role="status">{message ?? "State preview"}</div></PreviewFrame>;
}

function stringValue(value: AssetJsonValue | undefined): string | undefined {
  return typeof value === "string" || typeof value === "number" || typeof value === "boolean" ? String(value) : undefined;
}

function stringArray(value: AssetJsonValue | undefined): readonly string[] {
  return Array.isArray(value) ? value.map(stringValue).filter((item): item is string => Boolean(item)) : [];
}

function objectArray(value: AssetJsonValue | undefined): readonly Record<string, AssetJsonValue>[] {
  return Array.isArray(value) ? value.filter((item): item is Record<string, AssetJsonValue> => Boolean(item) && typeof item === "object" && !Array.isArray(item)) : [];
}

function arrayArray(value: AssetJsonValue | undefined): readonly (readonly AssetJsonValue[])[] {
  return Array.isArray(value) ? value.filter((item): item is readonly AssetJsonValue[] => Array.isArray(item)) : [];
}
