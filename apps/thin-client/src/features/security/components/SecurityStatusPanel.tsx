import { useThinClientSecurity } from "../hooks/useThinClientSecurity";
import { STATUS_FAILURE } from "../../../security/securityErrors";

export function SecurityStatusPanel() {
  const security = useThinClientSecurity();
  const status = security.status;
  const listenerLabel = status ? (status.httpsEnabled ? "HTTPS enabled" : "HTTP only") : "Not available";
  return <section className="ui-panel ui-stack"><h2>Security</h2>
    {security.loading ? <p role="status">Checking security status…</p> : null}
    {security.error ? <p role="alert">{security.guidance ?? STATUS_FAILURE}</p> : null}
    <button className="ui-button" type="button" disabled={security.loading || security.pairingBusy} onClick={() => void security.refreshStatus()}>Refresh status</button>
    <p>Server mode: {status?.mode ?? "Not available"}</p>
    <div className="ui-stack">
      <h3>Transport security</h3>
      <p>Current listener: {listenerLabel}</p><p>HTTPS required: {status ? (status.httpsRequired ? "Yes" : "No") : "Not available"}</p>
      <p>TLS cert mode: {status?.tls?.mode ?? "n/a"}</p><p>Certificate source: {status?.tls?.source ?? "n/a"}</p>
      {status?.tls?.hosts?.length ? <p>Hosts/SANs: {status.tls.hosts.join(", ")}</p> : null}
      {status?.requiresRestartToChangeTransportSecurity ? <p>Changing HTTP/HTTPS listener mode requires restarting dev:server.</p> : null}
      {status?.tls?.mode === "auto-self-signed" ? <p>Auto self-signed certificates enable HTTPS transport, but browsers/devices may still require trust exception/manual trust.</p> : null}
      {status?.tls?.mode === "auto-local-ca" ? <div><p>Manual trust required for local CA. No automatic trust-store installation is performed.</p>{status?.tls?.localCa?.downloadUrl ? <p><a href={status.tls.localCa.downloadUrl} target="_blank" rel="noreferrer">Download local CA certificate (PEM)</a></p> : null}</div> : null}
      <p>Private keys must not be committed or shared.</p>
      <h4>Restart examples</h4>
      <pre><code>AI_SYSTEM_BUILDER_SECURITY_MODE=disabled-dev npm run dev:server</code></pre>
      <pre><code>{`AI_SYSTEM_BUILDER_SECURITY_MODE=disabled-dev \
AI_SYSTEM_BUILDER_HTTPS_ENABLED=true \
AI_SYSTEM_BUILDER_TLS_CERT_MODE=auto-self-signed \
npm run dev:server`}</code></pre>
      <pre><code>{`AI_SYSTEM_BUILDER_SECURITY_MODE=disabled-dev \
AI_SYSTEM_BUILDER_HTTPS_ENABLED=true \
AI_SYSTEM_BUILDER_TLS_CERT_MODE=auto-local-ca \
npm run dev:server`}</code></pre>
      <pre><code>{`AI_SYSTEM_BUILDER_SECURITY_MODE=lan-https-token \
AI_SYSTEM_BUILDER_TLS_CERT_MODE=auto-self-signed \
SERVER_TOKEN_HASH_SECRET=<strong-random-secret> \
npm run dev:server`}</code></pre>
      <pre><code>{`AI_SYSTEM_BUILDER_SECURITY_MODE=lan-https-token \
AI_SYSTEM_BUILDER_TLS_CERT_MODE=auto-local-ca \
SERVER_TOKEN_HASH_SECRET=<strong-random-secret> \
npm run dev:server`}</code></pre>
    </div></section>;
}
