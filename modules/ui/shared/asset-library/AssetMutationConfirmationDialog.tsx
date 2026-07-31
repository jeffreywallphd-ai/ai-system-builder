import { ModalDialog } from "../components/ModalDialog";
import { TermWithHint } from "../glossary";

import type { AssetLibraryMutationAction } from "./assetLibraryActions";
import type { AssetLibraryResourceBackedViewDetail } from "./assetLibraryReadModels";

export interface AssetMutationConfirmationDialogProps {
  readonly action: AssetLibraryMutationAction;
  readonly view: Pick<
    AssetLibraryResourceBackedViewDetail,
    "displayName" | "viewKindLabel" | "registrationStatusLabel"
  >;
  readonly isPending: boolean;
  readonly stacked?: boolean;
  readonly onCancel: () => void;
  readonly onConfirm: () => void;
}

export function AssetMutationConfirmationDialog({
  action,
  view,
  isPending,
  stacked = false,
  onCancel,
  onConfirm,
}: AssetMutationConfirmationDialogProps) {
  return (
    <ModalDialog
      open
      title={action.confirmationTitle}
      closeLabel="Close confirmation"
      closeDisabled={isPending}
      stacked={stacked}
      onClose={onCancel}
      dialogClassName="asset-mutation-dialog__panel"
    >
      <p>{action.confirmationMessage}</p>
      <dl className="asset-library-detail__facts">
        <dt>
          <TermWithHint termId="source">Source</TermWithHint>
        </dt>
        <dd>{view.displayName}</dd>
        <dt>
          <TermWithHint termId="createdAsset">Creates</TermWithHint>
        </dt>
        <dd>{action.creates}</dd>
        <dt>
          <TermWithHint termId="lifecycleStatus">Current state</TermWithHint>
        </dt>
        <dd>{view.registrationStatusLabel}</dd>
        <dt>
          <TermWithHint termId="localStorageAccess">Local storage</TermWithHint>
        </dt>
        <dd>
          {action.approvalDefaults.allowFilesystemWrite
            ? "May write after confirmation"
            : "No write requested"}
        </dd>
        <dt>
          <TermWithHint termId="networkAccess">
            Network or provider
          </TermWithHint>
        </dt>
        <dd>
          {action.approvalDefaults.allowNetworkAccess
            ? "May be used after confirmation"
            : "No access requested"}
        </dd>
        <dt>
          <TermWithHint termId="credentials">Credentials</TermWithHint>
        </dt>
        <dd>
          {action.approvalDefaults.allowCredentialUse
            ? "Configured credentials may be used"
            : "No credential use requested"}
        </dd>
      </dl>
      {action.approvalDefaults.allowPartialCompletion ? (
        <div className="ui-status" role="status">
          This operation can partly complete. If that happens, you can retry or
          review the safe details shown here.
        </div>
      ) : null}
      {action.riskSummary?.length ? (
        <details className="asset-mutation-dialog__details">
          <summary>Review details</summary>
          <ul>
            {action.riskSummary.map((risk) => (
              <li key={risk}>{risk}</li>
            ))}
          </ul>
        </details>
      ) : null}
      <div className="asset-mutation-dialog__actions">
        <button
          type="button"
          className="ui-button ui-button--outline"
          onClick={onCancel}
          disabled={isPending}
          data-modal-initial-focus
        >
          Cancel
        </button>
        <button
          type="button"
          className="ui-button ui-button--primary"
          onClick={onConfirm}
          disabled={isPending}
        >
          {isPending ? "Working..." : action.confirmLabel}
        </button>
      </div>
    </ModalDialog>
  );
}
