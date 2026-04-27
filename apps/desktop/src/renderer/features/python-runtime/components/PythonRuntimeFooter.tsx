import { usePythonRuntimeFooter, type UsePythonRuntimeFooterOptions } from "../hooks/usePythonRuntimeFooter";

export interface PythonRuntimeFooterProps extends UsePythonRuntimeFooterOptions {
}

export function PythonRuntimeFooter({ enabled, client }: PythonRuntimeFooterProps) {
  const {
    statusLabel,
    healthLabel,
    capabilitiesLabel,
    logs,
    loading,
    error,
    onStart,
    onStop,
    onRestart,
    onRefresh,
  } = usePythonRuntimeFooter({
    enabled,
    client,
  });

  if (!enabled) {
    return null;
  }

  return (
    <footer className="ui-python-runtime-footer ui-panel ui-stack ui-stack--sm" aria-label="Python runtime controls">
      <div className="ui-python-runtime-footer__header">
        <h3 className="ui-panel__title">Python Runtime</h3>
        <div className="ui-python-runtime-footer__actions">
          <button className="ui-button" type="button" onClick={() => void onStart()} disabled={loading}>Start</button>
          <button className="ui-button" type="button" onClick={() => void onStop()} disabled={loading}>Stop</button>
          <button className="ui-button" type="button" onClick={() => void onRestart()} disabled={loading}>Restart</button>
          <button className="ui-button" type="button" onClick={() => void onRefresh()} disabled={loading}>Refresh</button>
        </div>
      </div>
      <p>
        Status: <strong>{statusLabel}</strong> | Health: <strong>{healthLabel}</strong> | Capabilities: {capabilitiesLabel}
      </p>
      {error ? <p role="alert">{error}</p> : null}
      <details className="ui-python-runtime-footer__logs">
        <summary>Runtime activity log</summary>
        {logs.length === 0 ? <p>No runtime activity recorded yet.</p> : (
          <ul className="ui-python-runtime-footer__log-list">
            {logs.map((entry, index) => (
              <li key={`${entry.timestamp}-${index}`}>
                <span>[{new Date(entry.timestamp).toLocaleTimeString()}]</span>
                {" "}
                <strong>{entry.level.toUpperCase()}</strong>
                {" "}
                {entry.message}
              </li>
            ))}
          </ul>
        )}
      </details>
    </footer>
  );
}
