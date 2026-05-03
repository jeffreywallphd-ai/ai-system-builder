import { usePythonRuntimeFooter, type UsePythonRuntimeFooterOptions } from "../hooks/usePythonRuntimeFooter";

export interface PythonRuntimeFooterProps extends UsePythonRuntimeFooterOptions {
}

export function PythonRuntimeFooter({ enabled, client }: PythonRuntimeFooterProps) {
  if (!enabled) {
    return null;
  }

  return <PythonRuntimeFooterBody enabled={enabled} client={client} />;
}

function PythonRuntimeFooterBody({ enabled, client }: PythonRuntimeFooterProps) {
  const {
    statusLabel,
    healthLabel,
    capabilitiesLabel,
    systemResources,
    logs,
    loading,
    error,
    onStart,
    onStop,
    onRestart,
    onRefresh,
    onClearLogs,
    logsExpanded,
    setLogsExpanded,
  } = usePythonRuntimeFooter({
    enabled,
    client,
  });

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
      <section className="ui-python-runtime-footer__resources" aria-label="System resource tracker">
        <h4 className="ui-python-runtime-footer__resources-title">System resources</h4>
        <ul className="ui-python-runtime-footer__resource-list">
          <li>Memory: <strong>{systemResources.memoryUsagePercent.toFixed(1)}%</strong></li>
          <li>CPU: <strong>{systemResources.cpuUsagePercent.toFixed(1)}%</strong></li>
          <li>GPU: <strong>{systemResources.gpuUsagePercent.toFixed(1)}%</strong></li>
        </ul>
      </section>
      {error ? <p role="alert">{error}</p> : null}
      <details className="ui-python-runtime-footer__logs" open={logsExpanded} onToggle={(event) => setLogsExpanded(event.currentTarget.open)}>
        <summary>Runtime activity log</summary>
        <div className="ui-python-runtime-footer__actions">
          <button className="ui-button" type="button" onClick={() => void onClearLogs()} disabled={loading}>Clear log</button>
        </div>
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
