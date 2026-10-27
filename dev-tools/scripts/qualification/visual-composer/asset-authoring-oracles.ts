import assert from "node:assert/strict";
import { isDeepStrictEqual } from "node:util";

export const AUTHORING_PHASE_BUDGET_MS = 300_000;
export const AUTHORING_STEP_BUDGET_MS = 60_000;
export const BASE_FIELD_LABELS = ["Display name", "Description", "Summary", "Classification", "Tags (comma separated)", "Safe metadata additions", "AI context", "Configuration schema", "Default configuration", "Ports", "Requirements", "Composition rules", "Dependencies"] as const;
export type AuthoringHost = "packaged-desktop" | "thin-chrome";
export interface ResourceObservation { path: string; mediaType: string; content: string; section: string }
export interface StudioObservation {
  workspaceId: string; id: string; name: string; version: string; type: string;
  family: string; definition: string; aiContext: unknown; status: string;
  resources: ResourceObservation[];
}
export interface BaseObservation {
  workspaceId: string; id: string; version: string; source: string; baseLabel: string;
  semantic: Record<string, string>;
  resources: {path: string; mediaType: string; content: string; editable: boolean}[];
}

// Expectations come from declared synthetic inputs, never from returned UI values.
export function createAuthoringExpectations(host: AuthoringHost, workspaceId: string) {
  assert(["packaged-desktop", "thin-chrome"].includes(host), "Unsupported authoring host.");
  assert(/^workspace[.-][a-zA-Z0-9._-]{1,128}$/.test(workspaceId), "Missing exact workspace identity.");
  const suffix = host === "packaged-desktop" ? "desktop" : "browser";
  const studio: StudioObservation = {
    workspaceId, id: `asset.qualification-status-summary-${suffix}`, name: `Qualification Status Summary ${suffix}`,
    version: "1.0.0", type: "tool", family: "behavioral", definition: "Summarize selected system status records for the user.",
    aiContext: {purpose: "Summarize system status.", userFacingSummary: "A status summary.", developerFacingSummary: "Inert qualification resource bundle.", capabilities: ["status-summary"], limitations: ["Synthetic fixture only."]},
    status: "draft - revision 1",
    resources: [
      {path: "frontend/AssetView.tsx", mediaType: "text/typescript", content: "export const View = () => <output>Status ready</output>;", section: "Frontend structure"},
      {path: "frontend/asset.css", mediaType: "text/css", content: "output { color: #176325; }", section: "Styling logic"},
      {path: "backend/handleAssetRequest.ts", mediaType: "text/typescript", content: "export const summarize = (rows: unknown[]) => ({ count: rows.length });", section: "Backend logic"},
    ],
  };
  const copies = [
    {baseId: "builtin.form.submit-action", baseVersion: "1.0.0", source: "system-owned-asset", id: `asset.qualification-foundation-copy-${suffix}`, name: `Qualification Foundation Copy ${suffix}`},
    {baseId: "imported.demo.ui-overrides.panel", baseVersion: "1.0.0", source: "workspace-imported-asset", id: `asset.qualification-import-copy-${suffix}`, name: `Qualification Imported Copy ${suffix}`},
  ];
  return {
    workspaceId, studio, copies,
    replayKind: "document-reload" as const, replayCount: 4,
    package: {id: "imported.demo.ui-overrides", version: "1.0.0", label: "Imported Demo UI Overrides v1.0.0", contents: "1 definitions · 1 implementations · 3 files"},
    overlay: {path: "frontend/qualification-status.css", mediaType: "text/css", role: "frontend-style", content: ".qualification-status { border: 2px solid #176325; }"},
    copyDescription: "Status summary with an emphasized status border.",
  };
}
export type AuthoringExpectations = ReturnType<typeof createAuthoringExpectations>;

function boundedText(value: unknown, limit: number, nonempty = false): asserts value is string {
  assert(typeof value === "string" && value.length <= limit && (!nonempty || value.trim().length > 0), "Missing or oversized authoring observation.");
}
function resourcePath(value: unknown) {
  boundedText(value, 240, true);
  assert(!value.startsWith("/") && !value.includes("\\") && !value.includes(":") && value.split("/").every(part => part && part !== "." && part !== ".."), "Invalid observed resource path.");
}
export function assertStudioObservation(expected: StudioObservation, observed: unknown) {
  // Equality also rejects undeclared extra fields, missing fields and reordered resources.
  assert(isDeepStrictEqual(observed, expected), "Saved Studio fields, resources, identity or revision differ from the declared input.");
}
export function assertPackageObservation(plan: AuthoringExpectations, observed: unknown) {
  assert(isDeepStrictEqual(observed, {label: plan.package.label, contents: plan.package.contents}), "Inspected package differs from the declared inert fixture.");
}
export function validateBaseObservation(plan: AuthoringExpectations, copy: AuthoringExpectations["copies"][number], observed: BaseObservation) {
  assert(observed && observed.workspaceId === plan.workspaceId && observed.id === copy.baseId && observed.version === copy.baseVersion && observed.source === copy.source, "Unexpected base identity, source or workspace.");
  boundedText(observed.baseLabel, 1024, true);
  assert(observed.baseLabel.includes(` - ${copy.baseId} - v${copy.baseVersion} - `), "Exact base selection was not observed.");
  assert(observed.semantic && isDeepStrictEqual(Object.keys(observed.semantic).sort(), [...BASE_FIELD_LABELS].sort()), "Base semantic fields are missing or unexpected.");
  for (const label of BASE_FIELD_LABELS) boundedText(observed.semantic[label], 32_768);
  assert(Array.isArray(observed.resources) && observed.resources.length > 0 && observed.resources.length <= 64, "Base resources are missing or excessive.");
  const paths = new Set<string>(); let bytes = 0;
  for (const row of observed.resources) {
    assert(row && isDeepStrictEqual(Object.keys(row).sort(), ["content", "editable", "mediaType", "path"]), "Base resource shape is incomplete.");
    resourcePath(row.path); boundedText(row.mediaType, 128, true); boundedText(row.content, 262_144, true);
    assert(typeof row.editable === "boolean" && !paths.has(row.path.toLowerCase()), "Duplicate or ambiguous base resource.");
    paths.add(row.path.toLowerCase()); bytes += Buffer.byteLength(row.content, "utf8");
  }
  assert(bytes <= 2 * 1024 * 1024, "Base resource observation exceeds the byte bound.");
}
export function assertBaseUnchanged(plan: AuthoringExpectations, copy: AuthoringExpectations["copies"][number], before: BaseObservation, after: BaseObservation) {
  validateBaseObservation(plan, copy, before); validateBaseObservation(plan, copy, after);
  assert(isDeepStrictEqual(before, after), "The original base changed after customizing its separate copy.");
}
export function assertPublishedHistory(copy: AuthoringExpectations["copies"][number], rows: string[]) {
  assert(Array.isArray(rows) && rows.length === 1, "Expected one exact published customization history entry.");
  boundedText(rows[0], 2048, true);
  const normalized = rows[0]!.replace(/\s+/g, " ").trim();
  assert(normalized === `${copy.name} - published - revision 4 ${copy.id} v1.0.0`, "Published history identity or revision is incorrect.");
}
export interface PublishedDefinitionObservation {
  definitionId: string; version: string; displayName: string; assetType: string;
  assetFamily: string; lifecycleStatus: string; description: string; metadataSummary?: string;
}
export function assertPublishedDefinition(expected: PublishedDefinitionObservation, envelope: unknown) {
  const encoded = JSON.stringify(envelope);
  assert(typeof encoded === "string" && Buffer.byteLength(encoded, "utf8") <= 262_144, "Published definition response is missing or excessive.");
  const result = envelope as {ok?: unknown; value?: {definition?: Omit<PublishedDefinitionObservation, "metadataSummary"> & {metadata?: {summary?: unknown}}}} | null;
  assert(result && result.ok === true && result.value?.definition && typeof result.value.definition === "object", "Exact public definition read did not succeed.");
  const value = result.value.definition;
  assert(!Object.prototype.hasOwnProperty.call(value, "summary"), "Published definition contains a noncanonical summary field.");
  const observed = {definitionId: value.definitionId, version: value.version, displayName: value.displayName, assetType: value.assetType, assetFamily: value.assetFamily, lifecycleStatus: value.lifecycleStatus, description: value.description, metadataSummary: value.metadata?.summary};
  assert(isDeepStrictEqual(observed, {...expected, metadataSummary: expected.metadataSummary}), "Published definition identity or semantics differ from the declared input.");
}
export function assertDocumentReplay(plan: AuthoringExpectations, observed: {kind: string; count: number; workspaceIds: string[]}) {
  assert(observed.kind === "document-reload" && observed.count === plan.replayCount && observed.workspaceIds.length === plan.replayCount && observed.workspaceIds.every(id => id === plan.workspaceId), "Replay scope, count or workspace is incorrect; document reload is not process restart.");
}
