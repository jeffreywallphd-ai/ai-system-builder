import { ApplicationIcon, type ApplicationIconName } from "./ApplicationIcon";

export interface EmptyStateProps {
  readonly title: string;
  readonly description?: string;
  readonly icon?: ApplicationIconName;
  readonly compact?: boolean;
}

export function EmptyState({
  title,
  description,
  icon = "dataset",
  compact = false,
}: EmptyStateProps) {
  return (
    <div
      className={`ui-empty-state${compact ? " ui-empty-state--compact" : ""}`}
    >
      <span className="ui-empty-state__icon" aria-hidden="true">
        <ApplicationIcon name={icon} />
      </span>
      <strong>{title}</strong>
      {description ? <p>{description}</p> : null}
    </div>
  );
}
