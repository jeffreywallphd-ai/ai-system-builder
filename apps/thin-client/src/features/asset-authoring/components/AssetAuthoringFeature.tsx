import { useEffect, useMemo, useState, type FormEvent } from "react";
import type {
  AssetAuthoringEffectiveSourceSummary,
  AssetOverrideRecord,
  AuthoredAssetDraftRecord,
  AuthoredAssetRecord,
} from "../../../../../../modules/contracts/asset-authoring";
import {
  AssetDerivedCustomizationEditor,
  type AssetCustomizationTargetSelection,
} from "../../../../../../modules/ui/shared/asset-authoring";
import { PanelHeading } from "../../../../../../modules/ui/shared/components/PanelHeading";
import { TermWithHint } from "../../../../../../modules/ui/shared/glossary/GlossaryHint";
import { TransientNotificationPublisher } from "../../../../../../modules/ui/shared/notifications/TransientNotificationPublisher";
import { createThinClientAssetAuthoringClient } from "../api/thinClientAssetAuthoringClient";

type RowVm = {
  id: string;
  label: string;
  statusLabel: string;
  summary?: string;
  typeLabel?: string;
  tags?: readonly string[];
};
type Section = "create" | "drafts" | "customizations";

const ASSET_TYPES = [
  { value: "workflow-asset", label: "Workflow" },
  { value: "system-asset", label: "System" },
  { value: "component-asset", label: "Component" },
  { value: "data-asset", label: "Data" },
  { value: "model-asset", label: "Model" },
  { value: "tool-asset", label: "Tool" },
] as const;

const safe = (value: unknown, fallback: string) =>
  typeof value === "string" && value.trim() ? value.trim() : fallback;
const stringList = (value: unknown): readonly string[] =>
  Array.isArray(value)
    ? value.filter(
        (item): item is string =>
          typeof item === "string" && item.trim().length > 0,
      )
    : [];
const authoredVm = (x: AuthoredAssetRecord): RowVm => ({
  id: x.authoredAssetId,
  label: safe(x.editableValues?.["display-name"], "Custom asset"),
  statusLabel: safe(x.status, "Active"),
  summary: safe(x.editableValues?.summary, ""),
  typeLabel: safe(x.editableValues?.classification, ""),
  tags: stringList(x.editableValues?.tags),
});
const draftVm = (x: AuthoredAssetDraftRecord): RowVm => ({
  id: x.draftId,
  label: safe(x.draftEditableValues?.["display-name"], "Draft"),
  statusLabel: safe(x.status, "Draft"),
  summary: safe(x.draftEditableValues?.summary, ""),
  typeLabel: safe(x.draftEditableValues?.classification, ""),
  tags: stringList(x.draftEditableValues?.tags),
});
const overrideVm = (x: AssetOverrideRecord): RowVm => ({
  id: x.overrideId,
  label: safe(x.overrideValues?.["display-name"], "Customization"),
  statusLabel: safe(x.status, "Active"),
  summary: safe(x.overrideValues?.summary, ""),
  typeLabel: safe(x.overrideValues?.classification, ""),
  tags: stringList(x.overrideValues?.tags),
});
const summaryVm = (
  x: AssetAuthoringEffectiveSourceSummary,
  i: number,
): RowVm => ({
  id: `${x.effectiveAssetReference?.id ?? x.assetReference?.id ?? "summary"}-${i}`,
  label: safe(x.effectiveSourceKind, "Workspace usage"),
  statusLabel:
    x.conflictStatus === "open"
      ? "Needs attention"
      : x.overrideStatus === "disabled"
        ? "Disabled"
        : "Active",
});

export function AssetAuthoringFeature({
  workspaceId,
  initialSection = "create",
  initialCustomizationTarget,
}: {
  workspaceId: string;
  initialSection?: Section;
  initialCustomizationTarget?: AssetCustomizationTargetSelection;
}) {
  const client = useMemo(
    () => createThinClientAssetAuthoringClient("/api"),
    [],
  );
  const [authored, setAuthored] = useState<RowVm[]>([]);
  const [drafts, setDrafts] = useState<RowVm[]>([]);
  const [overrides, setOverrides] = useState<RowVm[]>([]);
  const [summaries, setSummaries] = useState<RowVm[]>([]);
  const [summariesUnavailable, setSummariesUnavailable] = useState(false);
  const [message, setMessage] = useState("");
  const contextualMessage = message === "Some asset records are unavailable." || message === "Display name is required.";
  const successfulMessage = ["Draft created.", "Draft published.", "Draft saved."].includes(message);
  const [displayName, setDisplayName] = useState("");
  const [summary, setSummary] = useState("");
  const [description, setDescription] = useState("");
  const [classification, setClassification] = useState<string>(
    ASSET_TYPES[0].value,
  );
  const [tags, setTags] = useState("");

  const refresh = async () => {
    const [authoredResult, draftsResult, overridesResult, summariesResult] =
      await Promise.all([
        client.listAuthoredAssets(workspaceId),
        client.listDrafts(workspaceId),
        client.listOverrides(workspaceId),
        client.listEffectiveSummaries(workspaceId),
      ]);
    if (authoredResult.ok)
      setAuthored(authoredResult.value.items.map(authoredVm));
    if (draftsResult.ok) setDrafts(draftsResult.value.items.map(draftVm));
    if (overridesResult.ok)
      setOverrides(overridesResult.value.items.map(overrideVm));
    if (summariesResult.ok) {
      setSummaries(summariesResult.value.items.map(summaryVm));
      setSummariesUnavailable(false);
    } else if (summariesResult.error.code === "unavailable") {
      setSummaries([]);
      setSummariesUnavailable(true);
    }
    if (!authoredResult.ok || !draftsResult.ok || !overridesResult.ok)
      setMessage("Some asset records are unavailable.");
  };

  useEffect(() => {
    if (initialSection !== "customizations") void refresh();
  }, [initialSection, workspaceId]);

  if (initialSection === "customizations") {
    return (
      <AssetDerivedCustomizationEditor
        workspaceId={workspaceId}
        client={client}
        initialTarget={initialCustomizationTarget}
      />
    );
  }

  const createDraft = async (event: FormEvent) => {
    event.preventDefault();
    if (!displayName.trim()) {
      setMessage("Display name is required.");
      return;
    }
    const result = await client.createDraft({
      workspaceId,
      displayName,
      summary,
      description,
      classification,
      tags: tagList(tags),
    });
    if (!result.ok) {
      setMessage(result.error.message);
      return;
    }
    setDisplayName("");
    setSummary("");
    setDescription("");
    setTags("");
    setMessage("Draft created.");
    await refresh();
  };

  return (
    <section className="asset-authoring ui-stack">
      <header>
        <PanelHeading icon="assets" tone="violet">
          Workspace Assets
        </PanelHeading>
      </header>

      {initialSection === "create" ? (
        <section className="ui-panel ui-stack">
          <h3>Create Asset</h3>
          <form
            className="asset-authoring__form ui-stack"
            onSubmit={createDraft}
          >
            <label className="ui-stack ui-stack--sm">
              <span>
                <TermWithHint termId="assetDisplayName">
                  Display name
                </TermWithHint>
              </span>
              <input
                aria-label="Display name"
                value={displayName}
                onChange={(event) => setDisplayName(event.target.value)}
              />
            </label>
            <label className="ui-stack ui-stack--sm">
              <span>
                <TermWithHint termId="assetTypeFilter">Asset type</TermWithHint>
              </span>
              <select
                aria-label="Asset type"
                value={classification}
                onChange={(event) => setClassification(event.target.value)}
              >
                {ASSET_TYPES.map((item) => (
                  <option key={item.value} value={item.value}>
                    {item.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="ui-stack ui-stack--sm">
              <span>
                <TermWithHint termId="assetSummary">Summary</TermWithHint>
              </span>
              <input
                aria-label="Summary"
                value={summary}
                onChange={(event) => setSummary(event.target.value)}
              />
            </label>
            <label className="ui-stack ui-stack--sm">
              <span>
                <TermWithHint termId="assetDescription">
                  Description
                </TermWithHint>
              </span>
              <textarea
                aria-label="Description"
                value={description}
                onChange={(event) => setDescription(event.target.value)}
              />
            </label>
            <label className="ui-stack ui-stack--sm">
              <span>
                <TermWithHint termId="assetTags">Tags</TermWithHint>
              </span>
              <input
                aria-label="Tags"
                value={tags}
                onChange={(event) => setTags(event.target.value)}
              />
            </label>
            <button className="ui-button" type="submit">
              Save draft
            </button>
          </form>
          <AssetList
            title="Created Assets"
            emptyLabel="No custom assets yet."
            rows={authored}
          />
        </section>
      ) : null}

      {initialSection === "drafts" ? (
        <section className="ui-panel ui-stack">
          <h3>Drafts</h3>
          <ul>
            {drafts.length ? (
              drafts.map((draft) => (
                <li key={draft.id}>
                  <AssetRow row={draft} />{" "}
                  <button
                    onClick={async () => {
                      const result = await client.publishDraft(
                        workspaceId,
                        draft.id,
                      );
                      setMessage(
                        result.ok ? "Draft published." : result.error.message,
                      );
                      if (result.ok) await refresh();
                    }}
                  >
                    Publish
                  </button>{" "}
                  <button
                    onClick={async () => {
                      const result = await client.updateDraft({
                        workspaceId,
                        draftId: draft.id,
                        summary: draft.summary || "Updated in workspace",
                      });
                      setMessage(
                        result.ok ? "Draft saved." : result.error.message,
                      );
                      if (result.ok) await refresh();
                    }}
                  >
                    Save
                  </button>
                </li>
              ))
            ) : (
              <li>No drafts yet.</li>
            )}
          </ul>
        </section>
      ) : null}

      <section className="ui-panel">
        <h3>Readiness</h3>
        {summariesUnavailable ? (
          <p>Workspace usage summaries are not available yet.</p>
        ) : (
          <ul>
            {summaries.length ? (
              summaries.map((item) => (
                <li key={item.id}>
                  <AssetRow row={item} />
                </li>
              ))
            ) : (
              <li>No workspace usage summaries yet.</li>
            )}
          </ul>
        )}
      </section>

      {contextualMessage ? <p role="alert">{message}</p> : null}
      <TransientNotificationPublisher message={!contextualMessage ? message : undefined} title={successfulMessage ? "Asset authoring updated" : "Asset authoring needs attention"} tone={successfulMessage ? "success" : "error"} source="Asset Authoring" workspaceId={workspaceId} />
    </section>
  );
}

function AssetList({
  title,
  rows,
  emptyLabel,
}: {
  title: string;
  rows: readonly RowVm[];
  emptyLabel: string;
}) {
  return (
    <section>
      <h3>{title}</h3>
      <ul>
        {rows.length ? (
          rows.map((row) => (
            <li key={row.id}>
              <AssetRow row={row} />
            </li>
          ))
        ) : (
          <li>{emptyLabel}</li>
        )}
      </ul>
    </section>
  );
}

function AssetRow({ row }: { row: RowVm }) {
  return (
    <span>
      <strong>{row.label}</strong> - {row.statusLabel}
      {row.typeLabel ? ` - ${row.typeLabel}` : ""}
      {row.summary ? ` - ${row.summary}` : ""}
      {row.tags?.length ? ` - ${row.tags.join(", ")}` : ""}
    </span>
  );
}

function tagList(value: string): readonly string[] {
  return value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}
