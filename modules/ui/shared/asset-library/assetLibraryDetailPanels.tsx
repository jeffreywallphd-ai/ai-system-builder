import { useId, useMemo, useState, type ReactNode } from "react";

import type { AssetMetadata } from "../../../contracts/asset";
import { TermWithHint, type GlossaryTermId } from "../glossary";
import type { AssetLibraryDefinitionDetail } from "./assetLibraryReadModels";
import { FoundationAssetPreview } from "../foundation-assets";
import {
  buildAssetLibraryAdvancedSections,
  type AssetLibraryAdvancedSectionKey,
  type AssetLibraryAdvancedSectionModel,
  type AssetLibraryDetailRowModel,
} from "./assetLibraryDetailModels";
import {
  displayAssetLibraryValue,
  getAssetLibraryFamilyLabel,
  getAssetLibraryLifecycleStatusLabel,
  getAssetLibraryTypeLabel,
} from "./assetLibraryPresentation";
import {
  getAssetCategoryLabel,
  getAssetPackLabel,
  getAssetSourceBadge,
} from "./assetLibraryPackDiscovery";

export interface AssetLibraryDefinitionDetailViewProps {
  readonly detail?: AssetLibraryDefinitionDetail;
  readonly isLoading: boolean;
  readonly isLoadingValidation: boolean;
  readonly error?: string;
  readonly validationError?: string;
  readonly onLoadValidationDetails: () => void;
}

const COLLAPSED_SECTIONS: Readonly<Record<AssetLibraryAdvancedSectionKey, boolean>> = {
  aiContext: false,
  configuration: false,
  ports: false,
  requirements: false,
  packSource: false,
  overrideResolution: false,
  provenance: false,
  validation: false,
  metadata: false,
};

const DETAIL_ROW_GLOSSARY_TERMS: Readonly<Record<string, GlossaryTermId>> = {
  Category: "asset",
  Family: "assetFamily",
  Pack: "assetPack",
  Source: "source",
  Status: "lifecycleStatus",
  Type: "assetDefinition",
};

export function AssetLibraryEmptyValue() {
  return <span className="asset-library-empty-value">Not specified</span>;
}

export function AssetLibraryBadge({
  children,
  tone,
}: {
  readonly children: ReactNode;
  readonly tone?: "system" | "custom";
}) {
  const toneClass = tone ? `asset-library-badge--${tone}` : undefined;
  return (
    <span className={["asset-library-badge", toneClass].filter(Boolean).join(" ")}>
      {children}
    </span>
  );
}

export function AssetLibraryDetailRow({ label, value }: AssetLibraryDetailRowModel) {
  const displayValue = displayAssetLibraryValue(value);
  const glossaryTermId = DETAIL_ROW_GLOSSARY_TERMS[label];
  return (
    <div className="asset-library-definition-row">
      <dt>{glossaryTermId ? <TermWithHint termId={glossaryTermId}>{label}</TermWithHint> : label}</dt>
      <dd>{displayValue === "Not specified" ? <AssetLibraryEmptyValue /> : displayValue}</dd>
    </div>
  );
}

export function AssetLibraryDetailSection({
  title,
  children,
  className,
}: {
  readonly title: string;
  readonly children: ReactNode;
  readonly className?: string;
}) {
  return (
    <section className={["asset-library-detail__section", className].filter(Boolean).join(" ")}>
      <h3>{title}</h3>
      {children}
    </section>
  );
}

function AssetLibraryMetadataView({ metadata }: { readonly metadata: AssetMetadata }) {
  return (
    <pre className="asset-library-metadata" aria-label="Safe metadata">
      {JSON.stringify(metadata, null, 2)}
    </pre>
  );
}

export function AssetLibraryAdvancedPanel({
  section,
  isExpanded,
  onToggle,
}: {
  readonly section: AssetLibraryAdvancedSectionModel;
  readonly isExpanded: boolean;
  readonly onToggle: () => void;
}) {
  const autoContentId = useId();

  return (
    <section className="ui-panel ui-panel--collapsible asset-library-advanced-panel">
      <button
        className="ui-panel__toggle"
        type="button"
        aria-label={`${isExpanded ? "Collapse" : "Expand"} ${section.title}`}
        aria-expanded={isExpanded}
        aria-controls={autoContentId}
        onClick={onToggle}
      >
        <span className="ui-panel__title">{section.title}</span>
        <span className="ui-panel__chevron" aria-hidden="true">
          {isExpanded ? "-" : "+"}
        </span>
      </button>
      <div id={autoContentId} className="ui-panel__body" hidden={!isExpanded}>
        {section.summary ? <p className="asset-library-panel-note">{section.summary}</p> : null}
        {section.rows.length > 0 ? (
          <dl className="asset-library-definition-grid">
            {section.rows.map((row) => (
              <AssetLibraryDetailRow key={`${section.key}-${row.label}`} label={row.label} value={row.value} />
            ))}
          </dl>
        ) : null}
        {section.note ? <p className="asset-library-panel-note">{section.note}</p> : null}
        {section.metadata ? <AssetLibraryMetadataView metadata={section.metadata} /> : null}
      </div>
    </section>
  );
}

export function AssetLibraryDefinitionDetailView({
  detail,
  isLoading,
  isLoadingValidation,
  error,
  validationError,
  onLoadValidationDetails,
}: AssetLibraryDefinitionDetailViewProps) {
  const [expandedSections, setExpandedSections] = useState(COLLAPSED_SECTIONS);
  const advancedSections = useMemo(() => buildAssetLibraryAdvancedSections(detail), [detail]);

  const toggleSection = (section: AssetLibraryAdvancedSectionKey) => {
    setExpandedSections((current) => ({ ...current, [section]: !current[section] }));
  };

  if (isLoading) {
    return <section className="ui-panel ui-status" role="status">Loading asset details...</section>;
  }

  if (error) {
    return <section className="ui-panel ui-status" role="alert">{error}</section>;
  }

  if (!detail) {
    return (
      <section className="ui-panel asset-library-empty">
        <h2>Select an asset to view details.</h2>
      </section>
    );
  }

  return (
    <section className="ui-panel asset-library-detail" aria-label="Selected asset details">
      <div className="asset-library-detail__header">
        <div>
          <h2>{detail.displayName}</h2>
          <p>{detail.summary ?? detail.overview?.description ?? "Reusable building block."}</p>
        </div>
        <AssetLibraryBadge tone={detail.systemDefault || detail.builtIn ? "system" : "custom"}>
          {getAssetSourceBadge(detail)}
        </AssetLibraryBadge>
      </div>

      <AssetLibraryDetailSection title="Overview">
        <dl className="asset-library-definition-grid">
          <AssetLibraryDetailRow label="Short summary" value={detail.summary ?? detail.overview?.description} />
          <AssetLibraryDetailRow label="Type" value={getAssetLibraryTypeLabel(detail)} />
          <AssetLibraryDetailRow label="Family" value={getAssetLibraryFamilyLabel(detail)} />
          <AssetLibraryDetailRow label="Status" value={getAssetLibraryLifecycleStatusLabel(detail)} />
          <AssetLibraryDetailRow label="Version" value={`v${detail.version}`} />
          <AssetLibraryDetailRow label="Source" value={getAssetSourceBadge(detail)} />
          <AssetLibraryDetailRow label="Pack" value={getAssetPackLabel(detail)} />
          <AssetLibraryDetailRow label="Category" value={getAssetCategoryLabel(detail)} />
          {detail.sourcePackDisplayName ? <AssetLibraryDetailRow label="From" value={`From ${detail.sourcePackDisplayName}`} /> : null}
        </dl>
      </AssetLibraryDetailSection>

      {detail.systemDefault ? (
        <AssetLibraryDetailSection title="Preview">
          <FoundationAssetPreview definitionId={detail.definitionId} displayName={detail.displayName} />
        </AssetLibraryDetailSection>
      ) : null}

      {advancedSections.length > 0 ? (
        <AssetLibraryDetailSection title="Advanced Details" className="asset-library-detail__advanced">
          {advancedSections.map((section) => (
            <AssetLibraryAdvancedPanel
              key={section.key}
              section={section}
              isExpanded={expandedSections[section.key]}
              onToggle={() => toggleSection(section.key)}
            />
          ))}
        </AssetLibraryDetailSection>
      ) : null}

      <AssetLibraryDetailSection title="Validation details">
        {!detail.validationSummary ? (
          <p className="asset-library-panel-note">Validation details are loaded only when requested.</p>
        ) : null}
        <button
          className="ui-button"
          type="button"
          onClick={onLoadValidationDetails}
          disabled={isLoadingValidation}
        >
          {isLoadingValidation ? "Checking validation details..." : "Check validation details"}
        </button>
        {isLoadingValidation ? <p className="ui-status" role="status">Loading validation details...</p> : null}
        {validationError ? <p className="ui-status" role="alert">{validationError}</p> : null}
      </AssetLibraryDetailSection>
    </section>
  );
}
