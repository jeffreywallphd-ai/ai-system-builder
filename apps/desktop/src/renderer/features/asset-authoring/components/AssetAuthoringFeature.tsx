import { useEffect, useMemo, useState } from "react";
import type {
  AssetAuthoringEffectiveSourceSummary,
  AssetOverrideRecord,
  AuthoredAssetDraftRecord,
  AuthoredAssetRecord,
} from "../../../../../../../modules/contracts/asset-authoring";
import {
  AssetDerivedCustomizationEditor,
  PanelHeading,
  TermWithHint,
  type AssetCustomizationTargetSelection,
} from "../../../../../../../modules/ui/shared";
import { createDesktopAssetAuthoringClient } from "../api/desktopAssetAuthoringClient";

type RowVm = {
  id: string;
  label: string;
  statusLabel: string;
  description?: string;
  diagnosticLabel?: string;
  typeLabel?: string;
  tags?: readonly string[];
  canPublish?: boolean;
  canUpdate?: boolean;
  canDisable?: boolean;
};

const ASSET_TYPES = [
  { value: "workflow-asset", label: "Workflow" },
  { value: "system-asset", label: "System" },
  { value: "component-asset", label: "Component" },
  { value: "data-asset", label: "Data" },
  { value: "model-asset", label: "Model" },
  { value: "tool-asset", label: "Tool" },
] as const;

const safe = (value: unknown, fallback: string) =>
  typeof value === "string" && value.trim().length > 0
    ? value.trim()
    : fallback;
const stringList = (value: unknown): readonly string[] =>
  Array.isArray(value)
    ? value.filter(
        (item): item is string =>
          typeof item === "string" && item.trim().length > 0,
      )
    : [];

const mapAuthored = (record: AuthoredAssetRecord): RowVm => ({
  id: record.authoredAssetId,
  label: safe(
    record.editableValues["display-name"],
    record.assetReference.label ?? "Authored asset",
  ),
  statusLabel: safe(record.status, "Active"),
  description: safe(record.editableValues.summary, "") || undefined,
  typeLabel: safe(record.editableValues.classification, "") || undefined,
  tags: stringList(record.editableValues.tags),
});

const mapDraft = (record: AuthoredAssetDraftRecord): RowVm => ({
  id: record.draftId,
  label: safe(
    record.draftEditableValues["display-name"],
    record.baseAssetReference?.label ?? "Draft",
  ),
  statusLabel: safe(record.status, "Draft"),
  description: safe(record.draftEditableValues.summary, "") || undefined,
  typeLabel: safe(record.draftEditableValues.classification, "") || undefined,
  tags: stringList(record.draftEditableValues.tags),
  canPublish: true,
  canUpdate: true,
});

const mapOverride = (record: AssetOverrideRecord): RowVm => ({
  id: record.overrideId,
  label: safe(
    record.overrideValues["display-name"],
    record.baseAssetReference.label ?? "Customization",
  ),
  statusLabel: safe(record.status, "Active"),
  typeLabel: safe(record.overrideValues.classification, "") || undefined,
  tags: stringList(record.overrideValues.tags),
  canDisable: record.status !== "disabled",
});

const sourceLabel = (kind: unknown) =>
  kind === "workspace-authored"
    ? "Workspace authored"
    : kind === "workspace-customized"
      ? "Workspace customization"
      : kind === "linked-with-workspace-override"
        ? "Linked with workspace customization"
        : kind === "system-derived-override"
          ? "System-derived customization"
          : "Workspace usage";

const mapSummary = (
  record: AssetAuthoringEffectiveSourceSummary,
  index: number,
): RowVm => ({
  id: `${record.effectiveAssetReference?.id ?? record.assetReference.id ?? "summary"}-${index}`,
  label: sourceLabel(record.effectiveSourceKind),
  statusLabel:
    record.conflictStatus === "open"
      ? "Needs attention"
      : record.overrideStatus === "disabled"
        ? "Disabled"
        : "Active",
});

export function AssetAuthoringFeature({
  workspaceId,
  initialSection = "create",
  initialCustomizationTarget,
}: {
  workspaceId: string;
  initialSection?: "create" | "drafts" | "customizations";
  initialCustomizationTarget?: AssetCustomizationTargetSelection;
}) {
  const client = useMemo(() => createDesktopAssetAuthoringClient(), []);
  const [authored, setAuthored] = useState<RowVm[]>([]);
  const [drafts, setDrafts] = useState<RowVm[]>([]);
  const [overrides, setOverrides] = useState<RowVm[]>([]);
  const [summaries, setSummaries] = useState<RowVm[]>([]);
  const [summariesUnavailable, setSummariesUnavailable] = useState(false);
  const [message, setMessage] = useState("");
  const [name, setName] = useState("");
  const [summary, setSummary] = useState("");
  const [description, setDescription] = useState("");
  const [classification, setClassification] = useState<string>(
    ASSET_TYPES[0].value,
  );
  const [tags, setTags] = useState("");
  const sectionMatches = {
    create: initialSection === "create",
    drafts: initialSection === "drafts",
    customizations: initialSection === "customizations",
  };

  const refresh = async () => {
    const [authoredResult, draftsResult, overridesResult, summariesResult] =
      await Promise.all([
        client.listAuthoredAssets(workspaceId),
        client.listDrafts(workspaceId),
        client.listOverrides(workspaceId),
        client.listEffectiveSummaries(workspaceId),
      ]);

    if (authoredResult.ok === true)
      setAuthored(authoredResult.value.items.map(mapAuthored));
    if (draftsResult.ok === true)
      setDrafts(draftsResult.value.items.map(mapDraft));
    if (overridesResult.ok === true)
      setOverrides(overridesResult.value.items.map(mapOverride));
    if (summariesResult.ok === true) {
      setSummaries(summariesResult.value.items.map(mapSummary));
      setSummariesUnavailable(false);
    } else if (summariesResult.error.code === "unavailable") {
      setSummaries([]);
      setSummariesUnavailable(true);
    }
    if (
      authoredResult.ok === false ||
      draftsResult.ok === false ||
      overridesResult.ok === false
    ) {
      setMessage("Some data is not available yet.");
    }
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

  return (
    <section className="asset-authoring ui-panel ui-stack">
      <header className="ui-panel__section-header">
        <PanelHeading icon="assets" tone="violet">
          Create and manage workspace assets
        </PanelHeading>
      </header>
      {sectionMatches.create ? <h3>Created assets</h3> : null}
      <ul>
        {authored.length ? (
          authored.map((asset) => (
            <li key={asset.id}>
              <strong>{asset.label}</strong> - {asset.statusLabel}
              {asset.typeLabel ? ` - ${asset.typeLabel}` : ""}
              {asset.tags?.length ? ` - ${asset.tags.join(", ")}` : ""}
            </li>
          ))
        ) : (
          <li>No custom assets yet.</li>
        )}
      </ul>
      {sectionMatches.drafts ? <h3>Drafts</h3> : null}
      <ul>
        {drafts.length ? (
          drafts.map((draft) => (
            <li key={draft.id}>
              <strong>{draft.label}</strong> - {draft.statusLabel}{" "}
              <button
                onClick={async () => {
                  const result = await client.publishDraft(
                    workspaceId,
                    draft.id,
                  );
                  setMessage(
                    result.ok === true
                      ? "Draft published."
                      : result.error.message,
                  );
                  if (result.ok === true) await refresh();
                }}
              >
                Publish
              </button>{" "}
              <button
                onClick={async () => {
                  const result = await client.updateDraft({
                    workspaceId,
                    draftId: draft.id,
                    summary: "Updated in workspace",
                  });
                  setMessage(
                    result.ok === true
                      ? "Draft changes saved."
                      : result.error.message,
                  );
                  if (result.ok === true) await refresh();
                }}
              >
                Save safe edit
              </button>
            </li>
          ))
        ) : (
          <li>No drafts yet.</li>
        )}
      </ul>
      <h3>Create asset draft</h3>
      <form
        className="asset-authoring__form ui-panel ui-stack"
        onSubmit={async (event) => {
          event.preventDefault();
          if (!name.trim()) {
            setMessage("Name is required.");
            return;
          }
          const result = await client.createDraft({
            workspaceId,
            displayName: name,
            summary,
            description,
            classification,
            tags: tagList(tags),
          });
          if (result.ok === true) {
            setName("");
            setSummary("");
            setDescription("");
            setTags("");
            setMessage("Saved as draft.");
            await refresh();
          } else {
            setMessage(result.error.message);
          }
        }}
      >
        <label className="ui-stack ui-stack--sm">
          <span>
            <TermWithHint termId="assetDisplayName">Name</TermWithHint>
          </span>
          <input
            aria-label="Name"
            value={name}
            onChange={(event) => setName(event.target.value)}
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
            <TermWithHint termId="assetSummary">Short summary</TermWithHint>
          </span>
          <input
            aria-label="Short summary"
            value={summary}
            onChange={(event) => setSummary(event.target.value)}
          />
        </label>
        <label className="ui-stack ui-stack--sm">
          <span>
            <TermWithHint termId="assetDescription">Description</TermWithHint>
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
          Create asset draft
        </button>
      </form>
      <h3>What this workspace is using</h3>
      {summariesUnavailable ? (
        <p>Workspace usage summaries are not available yet.</p>
      ) : (
        <ul>
          {summaries.length ? (
            summaries.map((summaryItem) => (
              <li key={summaryItem.id}>
                {summaryItem.label} - {summaryItem.statusLabel}
              </li>
            ))
          ) : (
            <li>No workspace usage summaries yet.</li>
          )}
        </ul>
      )}
      {message ? <p>{message}</p> : null}
    </section>
  );
}

function tagList(value: string): readonly string[] {
  return value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}
