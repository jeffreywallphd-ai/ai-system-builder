import { useEffect, useState } from "react";
import type { DesktopHeadlessClientAccess, DesktopHeadlessPairingStatus } from "../../../../../../../modules/contracts/headless";
import { getDesktopApi } from "../../../lib/desktopApi";
import { useActiveWorkspace } from "../../workspace";

export function HeadlessClientSettings() {
  const { activeWorkspace, activeWorkspaceId, status: workspaceStatus } = useActiveWorkspace();
  const [data, setData] = useState<DesktopHeadlessPairingStatus>();
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState("");
  const [refresh, setRefresh] = useState(0);

  useEffect(() => {
    let current = true;
    void Promise.resolve().then(() => getDesktopApi().readHeadlessPairingStatus?.()).then((value) => {
      if (current) setData(value ?? { status: "unavailable" });
    }).catch(() => { if (current) setData({ status: "unavailable" }); });
    return () => { current = false; };
  }, [refresh]);

  async function pair(access: DesktopHeadlessClientAccess) {
    if (!activeWorkspaceId || pending) return;
    setPending(true);
    try {
      const result = await getDesktopApi().beginHeadlessPairing?.(activeWorkspaceId, access);
      if (result === "shown") setMessage("Use the one-time code in your local chat client.");
      else if (result !== "canceled") setMessage("Pairing is unavailable for this workspace.");
    } catch {
      setMessage("Pairing could not start. Try again.");
    } finally {
      setPending(false);
      setRefresh((current) => current + 1);
    }
  }

  async function revoke(clientId: string) {
    if (pending) return;
    setPending(true);
    try {
      const result = await getDesktopApi().revokeHeadlessClient?.(clientId);
      setMessage(result === "revoked" ? "Client access removed." : "Client access could not be removed.");
    } catch {
      setMessage("Client access could not be removed.");
    } finally {
      setPending(false);
      setRefresh((current) => current + 1);
    }
  }

  async function start() {
    if (pending) return;
    setPending(true);
    try {
      const result = await getDesktopApi().startHeadlessConnector?.();
      if (result === "started") setMessage("Paired clients can now reconnect.");
      else if (result !== "canceled") setMessage("The local connector could not start.");
    } catch {
      setMessage("The local connector could not start.");
    } finally {
      setPending(false);
      setRefresh((current) => current + 1);
    }
  }

  return (
    <section aria-label="Local chat clients" className="ui-stack ui-stack--sm">
      <p>Choose whether a local chat client can read or edit saved systems in one workspace. Pairing does not give the client control of this window.</p>
      {data?.status === "ready" ? <>
        <p>{data.running ? "The local connector is on." : "The local connector is off."}</p>
        {data.endpoint ? <p>Local address: <code>{data.endpoint}</code></p> : null}
        {data.fingerprint ? <p>Certificate fingerprint: <code style={{ overflowWrap: "anywhere" }}>{data.fingerprint}</code></p> : null}
        <p>{activeWorkspace ? `Selected workspace: ${activeWorkspace.displayName}` : "Select a workspace before pairing."}</p>
        <div>
          <button type="button" disabled={pending || workspaceStatus !== "ready" || !activeWorkspaceId} onClick={() => void pair("read")}>
            Pair a read-only client
          </button>
          <button type="button" disabled={pending || workspaceStatus !== "ready" || !activeWorkspaceId} onClick={() => void pair("author")}>
            Pair a client that can edit
          </button>
          <button type="button" disabled={pending} onClick={() => setRefresh((current) => current + 1)}>
            Refresh clients
          </button>
          {!data.running && data.clients.length > 0 ? <button type="button" disabled={pending} onClick={() => void start()}>
            Turn on for paired clients
          </button> : null}
        </div>
        {data.clients.length ? <ul>
          {data.clients.map((client) => <li key={client.registeredClientId}>
            <span>{client.workspaceId} · Client {client.registeredClientId.slice(0, 8)} · {client.access === "author" ? "Read and edit" : "Read only"} </span>
            <button type="button" disabled={pending} onClick={() => void revoke(client.registeredClientId)}
              aria-label={`Remove access for client ${client.registeredClientId.slice(0, 8)}`}>Remove access</button>
          </li>)}
        </ul> : <p>No paired clients.</p>}
      </> : <p>{data ? "Local chat pairing is unavailable." : "Checking local chat pairing…"}</p>}
      <p role="status">{message}</p>
    </section>
  );
}
