import { useState } from "react";

import { TermWithHint, TransientNotificationPublisher } from "../../../../../../../modules/ui/shared";
import { ModalDialog } from "../../../../../../../modules/ui/shared/components/ModalDialog";
import type { AssetLibraryClient } from "../../../../../../../modules/ui/shared/asset-library";
import {
  buildAssetLibraryMutationCommand,
  describeAssetMutationResult,
  getAssetLibraryMutationActions,
  getAssetLibraryFamilyLabel,
  getAssetLibraryLifecycleStatusLabel,
  getAssetLibraryTypeLabel,
  sanitizeAssetLibraryDiagnosticMessages,
  type AssetLibraryMutationAction,
  type AssetLibraryMutationCommand,
  type AssetLibraryMutationDisplay,
  type AssetLibraryResourceBackedViewCard,
  type AssetLibraryResourceBackedViewDetail,
} from "../../../../../../../modules/ui/shared/asset-library";
import { AssetMutationConfirmationDialog } from "../../../../../../../modules/ui/shared/asset-library/AssetMutationConfirmationDialog";
import { AssetDefinitionDetailPanel } from "./AssetDefinitionDetailPanel";
import { AssetDefinitionList } from "./AssetDefinitionList";
import { AssetLibraryFilters } from "./AssetLibraryFilters";
import { useAssetLibraryFeature } from "../hooks/useAssetLibraryFeature";

interface AssetLibraryFeatureProps {
  readonly client?: AssetLibraryClient;
  readonly workspaceId?: string;
  readonly workspaceName?: string;
  readonly onCustomizeDefinition?: (
    definition: import("../../../../../../../modules/ui/shared/asset-library").AssetLibraryDefinitionCard,
  ) => void;
}

type AssetDetailModalState =
  | { readonly kind: "definition"; readonly id: string; readonly title: string }
  | {
      readonly kind: "resource-view";
      readonly id: string;
      readonly title: string;
    };

export function AssetLibraryFeature({
  client,
  workspaceId,
  onCustomizeDefinition,
}: AssetLibraryFeatureProps) {
  const state = useAssetLibraryFeature(client, workspaceId);
  const [detailModal, setDetailModal] = useState<
    AssetDetailModalState | undefined
  >();
  const [pendingAction, setPendingAction] = useState<
    AssetLibraryMutationAction | undefined
  >();
  const [isMutating, setIsMutating] = useState(false);
  const [mutationDisplay, setMutationDisplay] = useState<
    AssetLibraryMutationDisplay | undefined
  >();
  const topLevelDiagnostics = safeDiagnosticMessages(state.diagnostics);

  async function confirmMutation() {
    if (!pendingAction || !state.selectedResourceBackedViewDetail) return;
    setIsMutating(true);
    setMutationDisplay(undefined);
    const command = buildAssetLibraryMutationCommand({
      action: pendingAction,
      view: state.selectedResourceBackedViewDetail,
      userConfirmed: true,
      workspaceId: workspaceId as never,
    });
    const result = await callMutationClient(state, command);
    if (result.ok === true) {
      const display = describeAssetMutationResult(result.value);
      setMutationDisplay(display);
      setPendingAction(undefined);
      if (result.value.ok === true) {
        await state.refresh();
        await state.selectResourceBackedView(
          state.selectedResourceBackedViewDetail,
        );
      }
    } else {
      setMutationDisplay({
        tone: "error",
        message:
          result.error.message || "Unable to complete this asset action.",
      });
    }
    setIsMutating(false);
  }

  return (
    <section className="asset-library-feature ui-stack ui-stack--lg">
      <AssetLibraryFilters
        filters={state.filters}
        onSearchTextChange={state.setSearchText}
        onAssetTypeChange={state.setAssetType}
        onAssetFamilyChange={state.setAssetFamily}
        onLifecycleStatusChange={state.setLifecycleStatus}
        onBuiltInChange={state.setBuiltIn}
        onPackIdChange={state.setPackId}
        onSourceLayerChange={state.setSourceLayer}
        onCategoryIdChange={state.setCategoryId}
        onRefresh={() => {
          void state.refresh();
        }}
        isRefreshing={state.isLoadingList}
      />

      {state.isLoadingList ? (
        <div className="ui-status" role="status">
          Loading asset definitions...
        </div>
      ) : null}
      {state.listError ? (
        <div className="ui-status" role="alert">
          {state.listError}
        </div>
      ) : null}
      {topLevelDiagnostics.length > 0 ? (
        <div className="ui-status" role="status">
          {topLevelDiagnostics.join(" ")}
        </div>
      ) : null}

      <div
        className="asset-library-tabs"
        role="tablist"
        aria-label="Asset Library views"
      >
        <button
          type="button"
          role="tab"
          aria-selected={state.activeTab === "definitions"}
          onClick={() => {
            setDetailModal(undefined);
            setPendingAction(undefined);
            state.setActiveTab("definitions");
          }}
        >
          Definitions
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={state.activeTab === "resource-views"}
          onClick={() => {
            setDetailModal(undefined);
            setPendingAction(undefined);
            state.setActiveTab("resource-views");
          }}
        >
          Resource views
        </button>
      </div>

      {state.activeTab === "definitions" ? (
        <AssetDefinitionList
          definitions={state.definitions}
          selectedDefinitionId={
            detailModal?.kind === "definition" ? detailModal.id : undefined
          }
          hasActiveFilters={state.hasActiveFilters}
          onSelectDefinition={(definition) => {
            setDetailModal({
              kind: "definition",
              id: definition.id,
              title: definition.displayName,
            });
            void state.selectDefinition(definition);
          }}
          onCustomizeDefinition={onCustomizeDefinition}
        />
      ) : (
        <ResourceBackedViewList
          views={state.resourceBackedViews}
          selectedViewId={
            detailModal?.kind === "resource-view" ? detailModal.id : undefined
          }
          hasActiveFilters={state.hasActiveFilters}
          onSelectView={(view) => {
            setDetailModal({
              kind: "resource-view",
              id: view.id,
              title: view.displayName,
            });
            void state.selectResourceBackedView(view);
          }}
        />
      )}

      <ModalDialog
        open={detailModal !== undefined}
        title={detailModal?.title ?? "Asset details"}
        closeLabel="Close asset details"
        closeDisabled={isMutating || pendingAction !== undefined}
        onClose={() => {
          setDetailModal(undefined);
          setMutationDisplay(undefined);
        }}
        dialogClassName="asset-library-detail-dialog"
      >
        {detailModal?.kind === "definition" ? (
          <AssetDefinitionDetailPanel
            detail={state.selectedDetail}
            isLoading={state.isLoadingDetail}
            isLoadingValidation={state.isLoadingValidation}
            error={state.detailError}
            validationError={state.validationError}
            onLoadValidationDetails={() => {
              void state.loadValidationDetails();
            }}
          />
        ) : detailModal?.kind === "resource-view" ? (
          <ResourceBackedViewDetailPanel
            detail={state.selectedResourceBackedViewDetail}
            isLoading={state.isLoadingDetail}
            error={state.detailError}
            mutationDisplay={mutationDisplay}
            workspaceId={workspaceId}
            isMutating={isMutating}
            onChooseAction={(action) => {
              setMutationDisplay(undefined);
              setPendingAction(action);
            }}
          />
        ) : null}
      </ModalDialog>
      {pendingAction && state.selectedResourceBackedViewDetail ? (
        <AssetMutationConfirmationDialog
          action={pendingAction}
          view={state.selectedResourceBackedViewDetail}
          isPending={isMutating}
          stacked
          onCancel={() => setPendingAction(undefined)}
          onConfirm={() => {
            void confirmMutation();
          }}
        />
      ) : null}
    </section>
  );
}

function ResourceBackedViewList({
  views,
  selectedViewId,
  hasActiveFilters,
  onSelectView,
}: {
  readonly views: readonly AssetLibraryResourceBackedViewCard[];
  readonly selectedViewId?: string;
  readonly hasActiveFilters: boolean;
  readonly onSelectView: (view: AssetLibraryResourceBackedViewCard) => void;
}) {
  if (views.length === 0) {
    return (
      <section className="ui-panel asset-library-empty">
        <h2>
          {hasActiveFilters
            ? "No resource views match the current filters."
            : "No resource-backed views are visible yet."}
        </h2>
        <p>
          Resource-backed views appear when safe descriptor seams are wired for
          this host.
        </p>
      </section>
    );
  }
  return (
    <section className="asset-library-list" aria-label="Resource views">
      {views.map((view) => {
        const isSelected = view.id === selectedViewId;
        return (
          <button
            key={view.id}
            type="button"
            className={`asset-definition-card${isSelected ? " asset-definition-card--selected" : ""}`}
            aria-haspopup="dialog"
            aria-expanded={isSelected}
            onClick={() => onSelectView(view)}
          >
            <span className="asset-definition-card__header">
              <span className="asset-definition-card__title">
                {view.displayName}
              </span>
              <span className="asset-library-badge asset-library-badge--system">
                {view.viewKindLabel}
              </span>
            </span>
            {view.summary ? (
              <span className="asset-definition-card__summary">
                {view.summary}
              </span>
            ) : null}
            <span
              className="asset-library-cues"
              aria-label="Resource view cues"
            >
              <span>{getAssetLibraryTypeLabel(view)}</span>
              <span>{getAssetLibraryFamilyLabel(view)}</span>
              <span>{getAssetLibraryLifecycleStatusLabel(view)}</span>
              <span>{view.registrationStatusLabel}</span>
            </span>
            {safeDiagnosticMessages(view.diagnostics).length ? (
              <span className="asset-definition-card__updated">
                {safeDiagnosticMessages(view.diagnostics).join(" ")}
              </span>
            ) : null}
          </button>
        );
      })}
    </section>
  );
}

function ResourceBackedViewDetailPanel({
  detail,
  isLoading,
  error,
  mutationDisplay,
  workspaceId,
  isMutating,
  onChooseAction,
}: {
  readonly detail?: AssetLibraryResourceBackedViewDetail;
  readonly isLoading: boolean;
  readonly error?: string;
  readonly mutationDisplay?: AssetLibraryMutationDisplay;
  readonly workspaceId?: string;
  readonly isMutating: boolean;
  readonly onChooseAction: (action: AssetLibraryMutationAction) => void;
}) {
  if (isLoading)
    return (
      <section className="ui-panel" role="status">
        Loading resource view...
      </section>
    );
  if (error)
    return (
      <section className="ui-panel" role="alert">
        {error}
      </section>
    );
  if (!detail)
    return (
      <section className="ui-panel asset-library-empty">
        <h2>Select a resource view.</h2>
      </section>
    );
  const actions = getAssetLibraryMutationActions(detail);
  return (
    <section
      className="ui-panel asset-library-detail"
      aria-label="Resource view detail"
    >
      <h2>{detail.displayName}</h2>
      {detail.summary ? <p>{detail.summary}</p> : null}
      <dl className="asset-library-detail__facts">
        <dt>
          <TermWithHint termId="resourceBackedView">View kind</TermWithHint>
        </dt>
        <dd>{detail.viewKindLabel}</dd>
        <dt>
          <TermWithHint termId="lifecycleStatus">Status</TermWithHint>
        </dt>
        <dd>{detail.registrationStatusLabel}</dd>
        <dt>
          <TermWithHint termId="assetDefinition">Type</TermWithHint>
        </dt>
        <dd>{getAssetLibraryTypeLabel(detail)}</dd>
        <dt>
          <TermWithHint termId="assetFamily">Family</TermWithHint>
        </dt>
        <dd>{getAssetLibraryFamilyLabel(detail)}</dd>
        {detail.sourceKind ? (
          <>
            <dt>
              <TermWithHint termId="source">Source</TermWithHint>
            </dt>
            <dd>{detail.sourceKind}</dd>
          </>
        ) : null}
        {detail.resourceBackingSummary?.resourceKind ? (
          <>
            <dt>
              <TermWithHint termId="backing">Backing</TermWithHint>
            </dt>
            <dd>{detail.resourceBackingSummary.resourceKind}</dd>
          </>
        ) : null}
      </dl>
      {actions.length > 0 ? (
        <div
          className="asset-library-actions"
          aria-label="Resource view actions"
        >
          {actions.map((action) => (
            <button
              key={action.id}
              type="button"
              className="ui-button ui-button--primary"
              onClick={() => onChooseAction(action)}
              disabled={isMutating || Boolean(action.disabledReason)}
            >
              {action.label}
            </button>
          ))}
        </div>
      ) : null}
      <TransientNotificationPublisher message={mutationDisplay?.message} title={mutationDisplay?.tone === "error" ? "Asset library action needs attention" : "Asset library updated"} tone={mutationDisplay?.tone === "error" ? "error" : "success"} source="Asset Library" workspaceId={workspaceId} />
      {mutationDisplay?.details?.length ? <details><summary>Review action details</summary><ul>{mutationDisplay.details.map((detailMessage) => <li key={detailMessage}>{detailMessage}</li>)}</ul></details> : null}
      {safeDiagnosticMessages(detail.diagnostics).length ? (
        <div className="ui-status" role="status">
          {safeDiagnosticMessages(detail.diagnostics).join(" ")}
        </div>
      ) : null}
    </section>
  );
}

async function callMutationClient(
  state: ReturnType<typeof useAssetLibraryFeature>,
  command: AssetLibraryMutationCommand,
) {
  switch (command.operation) {
    case "asset.register-resource-backed-view":
      return state.client.registerResourceBackedViewAsAsset(command);
    case "asset.finalize-generated-output":
      return state.client.finalizeGeneratedOutputAsAsset(command);
    case "asset.import-external-repository-object":
      return state.client.importExternalRepositoryObjectAsAsset(command);
    case "asset.localize-external-repository-object":
      return state.client.localizeExternalRepositoryObjectAsAsset(command);
    default:
      return assertNever(command);
  }
}

function assertNever(value: never): never {
  throw new Error(
    `Unsupported asset mutation command: ${JSON.stringify(value)}`,
  );
}

function safeDiagnosticMessages(
  value: readonly string[] | undefined,
): readonly string[] {
  return sanitizeAssetLibraryDiagnosticMessages(value);
}
