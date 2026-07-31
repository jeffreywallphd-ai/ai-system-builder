import type { AssetMetadata } from "../../../contracts/asset";
import type { AssetLibraryDefinitionDetail } from "./assetLibraryReadModels";
import {
  formatAssetLibraryBoolean,
  formatAssetLibraryDate,
  formatAssetLibraryLabel,
} from "./assetLibraryPresentation";

export type AssetLibraryAdvancedSectionKey =
  | "aiContext"
  | "configuration"
  | "ports"
  | "requirements"
  | "packSource"
  | "overrideResolution"
  | "provenance"
  | "validation"
  | "metadata";

export interface AssetLibraryDetailRowModel {
  readonly label: string;
  readonly value: string | number | undefined;
}

export interface AssetLibraryAdvancedSectionModel {
  readonly key: AssetLibraryAdvancedSectionKey;
  readonly title: string;
  readonly summary?: string;
  readonly rows: readonly AssetLibraryDetailRowModel[];
  readonly note?: string;
  readonly metadata?: AssetMetadata;
}

function joined(values: readonly string[]): string | undefined {
  return values.length > 0 ? values.join(", ") : undefined;
}

export function buildAssetLibraryAdvancedSections(
  detail: AssetLibraryDefinitionDetail | undefined,
): readonly AssetLibraryAdvancedSectionModel[] {
  if (!detail) return [];

  const sections: AssetLibraryAdvancedSectionModel[] = [];

  if (detail.aiContextSummary) {
    sections.push({
      key: "aiContext",
      title: "AI-readable context",
      summary: "Summary only. Full prompt context is not shown here.",
      rows: [
        { label: "What this is for", value: detail.aiContextSummary.purpose },
        { label: "User summary", value: detail.aiContextSummary.userFacingSummary },
        { label: "Developer summary", value: detail.aiContextSummary.developerFacingSummary },
        { label: "What it can do", value: detail.aiContextSummary.capabilityCount },
        { label: "Limitations", value: detail.aiContextSummary.limitationCount },
        { label: "Limits and safety notes", value: detail.aiContextSummary.safetyNoteCount },
      ],
    });
  }

  if (detail.configurationSummary) {
    sections.push({
      key: "configuration",
      title: "Configuration",
      summary: "Read-only summary. This is not an editable setup form.",
      rows: [
        { label: "Schema ID", value: detail.configurationSummary.schemaId },
        { label: "Schema version", value: detail.configurationSummary.schemaVersion },
        { label: "Fields", value: detail.configurationSummary.fieldCount },
        { label: "Required fields", value: detail.configurationSummary.requiredFieldCount },
        { label: "Strict mode", value: formatAssetLibraryBoolean(detail.configurationSummary.strict) },
        { label: "Description", value: detail.configurationSummary.description },
      ],
    });
  }

  if (detail.portsSummary) {
    sections.push({
      key: "ports",
      title: "Inputs and outputs",
      summary: "Connection points this building block describes.",
      rows: [
        { label: "Total ports", value: detail.portsSummary.totalCount },
        { label: "Inputs", value: detail.portsSummary.inputCount },
        { label: "Outputs", value: detail.portsSummary.outputCount },
        { label: "Events", value: detail.portsSummary.eventCount },
        { label: "Actions or controls", value: detail.portsSummary.controlCount },
      ],
    });
  }

  if (detail.requirementsSummary) {
    sections.push({
      key: "requirements",
      title: "Requirements",
      summary: "Declared needs only. This does not check whether a runtime is currently available.",
      rows: [
        { label: "Total requirements", value: detail.requirementsSummary.totalCount },
        { label: "Required", value: detail.requirementsSummary.requiredCount },
        { label: "Runtime needs", value: joined(detail.requirementsSummary.runtimeCapabilityIds) },
        { label: "Where it can run", value: joined(detail.requirementsSummary.hostKinds) },
        { label: "Safety", value: joined(detail.requirementsSummary.safetyStatuses) },
      ],
    });
  }

  if (
    detail.sourcePackId ||
    detail.sourceLayer ||
    detail.sourceKind ||
    detail.trustStatus ||
    detail.packCategoryId ||
    detail.packTags?.length
  ) {
    sections.push({
      key: "packSource",
      title: "Pack and source",
      summary: "Read-only catalog origin details.",
      rows: [
        { label: "Pack", value: detail.packLabel },
        { label: "Pack ID", value: detail.sourcePackId },
        { label: "Pack version", value: detail.sourcePackVersion },
        { label: "Source kind", value: formatAssetLibraryLabel(detail.sourceKind) },
        { label: "Source layer", value: formatAssetLibraryLabel(detail.sourceLayer) },
        { label: "Trust", value: formatAssetLibraryLabel(detail.trustStatus) },
        { label: "Category", value: detail.categoryLabel },
        { label: "Category ID", value: detail.packCategoryId },
        { label: "Tags", value: joined(detail.packTags ?? []) },
      ],
    });
  }

  if (
    detail.overridesDefinitionRef ||
    detail.overriddenByDefinitionRefs?.length ||
    detail.effectiveResolutionStatus ||
    detail.resolutionSummary
  ) {
    sections.push({
      key: "overrideResolution",
      title: "Override relationship",
      summary: "Informational only. This does not apply or edit overrides.",
      rows: [
        { label: "Overrides", value: formatAssetRef(detail.overridesDefinitionRef) },
        { label: "Overridden by", value: joined((detail.overriddenByDefinitionRefs ?? []).map(formatAssetRef).filter((value): value is string => Boolean(value))) },
        { label: "Effective status", value: formatAssetLibraryLabel(detail.effectiveResolutionStatus) },
        { label: "Resolution summary", value: detail.resolutionSummary },
      ],
    });
  }

  if (detail.provenanceSummary) {
    sections.push({
      key: "provenance",
      title: "Source",
      summary: "Safe origin and authorship details.",
      rows: [
        { label: "Source kind", value: formatAssetLibraryLabel(detail.provenanceSummary.sourceKind) },
        { label: "Authorship", value: formatAssetLibraryLabel(detail.provenanceSummary.authorship) },
        { label: "Created", value: formatAssetLibraryDate(detail.provenanceSummary.createdAt) },
        { label: "Updated", value: formatAssetLibraryDate(detail.provenanceSummary.updatedAt) },
        { label: "Generation summary", value: detail.provenanceSummary.redactedGenerationSummary },
      ],
    });
  }

  if (detail.validationSummary) {
    sections.push({
      key: "validation",
      title: "Validation summary",
      summary: "Registry validation details loaded on request.",
      rows: [
        { label: "Status", value: formatAssetLibraryLabel(detail.validationSummary.status) },
        { label: "Issues", value: detail.validationSummary.issueCount },
        { label: "Errors", value: detail.validationSummary.errorCount },
        { label: "Warnings", value: detail.validationSummary.warningCount },
        { label: "Checked", value: formatAssetLibraryDate(detail.validationSummary.validatedAt) },
      ],
    });
  }

  if (detail.metadata) {
    sections.push({
      key: "metadata",
      title: "Details",
      summary: "Sensitive or unsafe metadata is omitted.",
      note: "Sensitive or unsafe metadata is omitted",
      rows: [],
      metadata: detail.metadata,
    });
  }

  return sections;
}

function formatAssetRef(ref: { readonly id: string; readonly version?: string } | undefined): string | undefined {
  if (!ref) return undefined;
  return ref.version ? `${ref.id}@${ref.version}` : ref.id;
}

export function getAssetLibraryAdvancedSections(
  detail: AssetLibraryDefinitionDetail | undefined,
): readonly AssetLibraryAdvancedSectionKey[] {
  return buildAssetLibraryAdvancedSections(detail).map((section) => section.key);
}
