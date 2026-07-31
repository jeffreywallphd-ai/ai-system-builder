import { useId, type ReactNode } from "react";
import { ModalDialog } from "../components/ModalDialog";

export type ReviewDecision = "approved" | "rejected";

export interface ReviewNavigatorItem {
  readonly id: string;
  readonly title: string;
  readonly summary?: string;
  readonly content: ReactNode;
  readonly editable?: boolean;
  readonly approvalLocked?: boolean;
}

export function DatasetReviewApproveButton({
  label,
  locked = false,
  disabled = false,
  className = "ui-button",
  onClick,
}: {
  readonly label: string;
  readonly locked?: boolean;
  readonly disabled?: boolean;
  readonly className?: string;
  readonly onClick: () => void;
}) {
  const hintId = useId();
  const button = (
    <button
      className={className}
      type="button"
      aria-describedby={locked ? hintId : undefined}
      disabled={disabled || locked}
      onClick={onClick}
    >
      {label}
    </button>
  );
  if (!locked) return button;

  return (
    <span
      className="dataset-review__locked-approval"
      role="group"
      tabIndex={0}
      title="This row is already approved."
      aria-label={`${label} unavailable`}
      aria-describedby={hintId}
    >
      {button}
      <span
        className="dataset-review__locked-approval-hint"
        id={hintId}
        role="tooltip"
      >
        This row is already approved.
      </span>
    </span>
  );
}

export interface DatasetReviewNavigatorProps {
  readonly items: readonly ReviewNavigatorItem[];
  readonly currentIndex: number;
  readonly decisions: Readonly<Record<string, ReviewDecision>>;
  readonly busy?: boolean;
  readonly approveLabel?: string;
  readonly rejectLabel?: string;
  readonly editLabel?: string;
  readonly approveChangesLabel?: string;
  readonly editing?: boolean;
  readonly absoluteIndex?: number;
  readonly totalItems?: number;
  readonly previousDisabled?: boolean;
  readonly nextDisabled?: boolean;
  readonly onCurrentIndexChange: (index: number) => void;
  readonly onApprove: (item: ReviewNavigatorItem) => void | Promise<void>;
  readonly onReject: (item: ReviewNavigatorItem) => void | Promise<void>;
  readonly onEdit?: (item: ReviewNavigatorItem) => void | Promise<void>;
  readonly onApproveChanges?: (
    item: ReviewNavigatorItem,
  ) => void | Promise<void>;
  readonly onCancelEdit?: (item: ReviewNavigatorItem) => void | Promise<void>;
  readonly onPrevious?: () => void | Promise<void>;
  readonly onNext?: () => void | Promise<void>;
}

export function DatasetReviewNavigator({
  items,
  currentIndex,
  decisions,
  busy = false,
  approveLabel = "Approve",
  rejectLabel = "Reject",
  editLabel = "Edit",
  approveChangesLabel = "Approve changes",
  editing = false,
  absoluteIndex,
  totalItems,
  previousDisabled,
  nextDisabled,
  onCurrentIndexChange,
  onApprove,
  onReject,
  onEdit,
  onApproveChanges,
  onCancelEdit,
  onPrevious,
  onNext,
}: DatasetReviewNavigatorProps) {
  const boundedIndex = Math.min(
    Math.max(0, currentIndex),
    Math.max(0, items.length - 1),
  );
  const item = items[boundedIndex];
  if (!item) {
    return <p className="ui-text-muted">There is nothing to review.</p>;
  }
  const decision =
    decisions[item.id] ?? (item.approvalLocked ? "approved" : undefined);
  const displayedIndex = absoluteIndex ?? boundedIndex;
  const displayedTotal = totalItems ?? items.length;
  const movePrevious = () =>
    onPrevious
      ? onPrevious()
      : onCurrentIndexChange(Math.max(0, boundedIndex - 1));
  const moveNext = () =>
    onNext
      ? onNext()
      : onCurrentIndexChange(Math.min(items.length - 1, boundedIndex + 1));
  return (
    <div className="dataset-review__navigator ui-stack ui-stack--sm">
      <div className="dataset-review__progress ui-cluster">
        <strong>
          {displayedIndex + 1} of {displayedTotal}
        </strong>
        <span className="ui-text-muted">
          {decision === "approved"
            ? "Approved"
            : decision === "rejected"
              ? "Rejected"
              : "Not reviewed"}
        </span>
      </div>
      <div className="dataset-review__navigation ui-actions">
        <button
          className="ui-button ui-button--outline"
          type="button"
          disabled={busy || (previousDisabled ?? displayedIndex === 0)}
          onClick={() => void movePrevious()}
        >
          Previous
        </button>
        <button
          className="ui-button ui-button--outline"
          type="button"
          disabled={
            busy || (nextDisabled ?? displayedIndex >= displayedTotal - 1)
          }
          onClick={() => void moveNext()}
        >
          Next
        </button>
      </div>
      <article
        className="dataset-review__item ui-stack ui-stack--sm"
        aria-live="polite"
      >
        <header>
          <h3>{item.title}</h3>
          {item.summary ? (
            <p className="ui-text-muted">{item.summary}</p>
          ) : null}
        </header>
        <div className="dataset-review__item-content">{item.content}</div>
      </article>
      <div className="dataset-review__actions ui-actions">
        {editing && onApproveChanges ? (
          <button
            className="ui-button"
            type="button"
            disabled={busy}
            onClick={() => void onApproveChanges(item)}
          >
            {approveChangesLabel}
          </button>
        ) : (
          <DatasetReviewApproveButton
            label={approveLabel}
            locked={item.approvalLocked}
            disabled={busy}
            onClick={() => void onApprove(item)}
          />
        )}
        <button
          className="ui-button ui-button--danger"
          type="button"
          disabled={busy}
          onClick={() => void onReject(item)}
        >
          {rejectLabel}
        </button>
        {!editing && onEdit ? (
          <button
            className="ui-button ui-button--outline"
            type="button"
            disabled={busy || item.editable === false}
            title={
              item.editable === false
                ? "This row is too large or contains values that cannot be safely edited."
                : undefined
            }
            onClick={() => void onEdit(item)}
          >
            {editLabel}
          </button>
        ) : null}
        {editing && onCancelEdit ? (
          <button
            className="ui-button ui-button--outline"
            type="button"
            disabled={busy}
            onClick={() => void onCancelEdit(item)}
          >
            Cancel
          </button>
        ) : null}
      </div>
    </div>
  );
}

export function DatasetReviewModal({
  open,
  title,
  onClose,
  ...navigator
}: DatasetReviewNavigatorProps & {
  readonly open: boolean;
  readonly title: ReactNode;
  readonly onClose: () => void;
}) {
  return (
    <ModalDialog
      open={open}
      title={title}
      onClose={onClose}
      closeDisabled={navigator.busy}
      dialogClassName="dataset-review__modal"
    >
      <DatasetReviewNavigator {...navigator} />
    </ModalDialog>
  );
}
