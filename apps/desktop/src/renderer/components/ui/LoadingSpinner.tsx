export function LoadingSpinner({ label = "Loading" }: { label?: string }) {
  return (
    <span className="ui-loading-spinner" role="status" aria-label={label}>
      <span aria-hidden="true" />
    </span>
  );
}
