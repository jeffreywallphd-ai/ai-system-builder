export interface SettingsStatusMessageProps {
  loading: boolean;
  saving?: boolean;
  successMessage?: string;
  errorMessage?: string;
}

export function SettingsStatusMessage(props: SettingsStatusMessageProps) {
  if (props.loading) {
    return <p className="ui-status" role="status">Loading settings…</p>;
  }

  if (props.saving) {
    return <p className="ui-status" role="status">Saving setting…</p>;
  }

  if (props.errorMessage) {
    return <p className="ui-status" role="alert">{props.errorMessage}</p>;
  }

  if (props.successMessage) {
    return <p className="ui-status ui-status--success" role="status">{props.successMessage}</p>;
  }

  return null;
}
