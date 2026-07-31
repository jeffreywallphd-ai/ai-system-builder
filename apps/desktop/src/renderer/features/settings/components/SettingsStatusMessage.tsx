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
    return <TransientNotificationPublisher message={props.errorMessage} title="Settings need attention" tone="error" source="Settings" />;
  }

  if (props.successMessage) {
    return <TransientNotificationPublisher message={props.successMessage} title="Settings updated" tone="success" source="Settings" />;
  }

  return null;
}
import { TransientNotificationPublisher } from "../../../../../../../modules/ui/shared";
