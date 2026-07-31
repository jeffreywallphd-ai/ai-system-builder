export interface SectionLoadingStateProps {
  readonly message: string;
}

export function SectionLoadingState({ message }: SectionLoadingStateProps) {
  return (
    <div className="ui-panel ui-stack ui-stack--sm" role="status" aria-live="polite">
      <p>{message}</p>
    </div>
  );
}
