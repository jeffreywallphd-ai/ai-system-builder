export interface SectionErrorStateProps {
  readonly title?: string;
  readonly message: string;
  readonly onRetry?: () => void;
}

export function SectionErrorState({ title = "Section could not load", message, onRetry }: SectionErrorStateProps) {
  return (
    <div className="ui-panel ui-stack ui-stack--sm" role="alert">
      <strong>{title}</strong>
      <p>{message}</p>
      {onRetry ? <button className="ui-button" type="button" onClick={onRetry}>Retry</button> : null}
    </div>
  );
}
