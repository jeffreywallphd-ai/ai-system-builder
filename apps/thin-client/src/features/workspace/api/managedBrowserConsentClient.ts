import { MANAGED_BROWSER_CONSENT_PATH, MANAGED_BROWSER_DOCUMENT_HEADER, parseManagedBrowserRegistration } from "../../../../../../modules/contracts/headless/managed-browser-consent";
import { readUiControlObservation, readUiControlTimedGrant, type UiControlAttempt, type UiControlLeaseTarget } from "../../../../../../modules/contracts/headless/ui-control-authority";
import { secureFetch } from "../../../security/secureFetch";

const MAX_RESPONSE = 4_096;
type Registration = NonNullable<ReturnType<typeof parseManagedBrowserRegistration>>;
type Payload = {readonly status: number; readonly body?: unknown};
type Request = {readonly operation: "register"; readonly workspaceId: string} |
  {readonly operation: "observe" | "disconnect"; readonly document: Registration["target"]} |
  {readonly operation: "accept" | "ready" | "revoke"; readonly document: Registration["target"]; readonly target: UiControlAttempt | UiControlLeaseTarget};

export function createManagedBrowserConsentClient(organizationId: string, fetch = secureFetch) {
  async function send(request: Request, options: {readonly proof?: Registration["proof"]; readonly signal?: AbortSignal; readonly keepalive?: boolean} = {}): Promise<Payload> {
    const headers: Record<string, string> = {"Content-Type": "application/json", "x-organization-id": organizationId};
    if (options.proof) headers[MANAGED_BROWSER_DOCUMENT_HEADER] = options.proof;
    const timeout = AbortSignal.timeout(4_000);
    const signal = options.signal ? AbortSignal.any([timeout, options.signal]) : timeout;
    const response = await fetch(MANAGED_BROWSER_CONSENT_PATH, {
      method: "POST", body: JSON.stringify(request), headers, credentials: "same-origin", mode: "same-origin",
      cache: "no-store", redirect: "error", signal, keepalive: options.keepalive,
    });
    if (!response.ok || !/^application\/json(?:\s*;|$)/i.test(response.headers.get("content-type") ?? "")) {
      await response.body?.cancel().catch(() => {});
      return {status: response.status};
    }
    const reader = response.body?.getReader();
    if (!reader) return {status: response.status};
    const decoder = new TextDecoder("utf-8", {fatal: true, ignoreBOM: true});
    let bytes = 0;
    let body = "";
    try {
      while (true) {
        const entry = await reader.read();
        if (entry.done) break;
        bytes += entry.value.byteLength;
        if (bytes > MAX_RESPONSE || signal.aborted) return {status: response.status};
        body += decoder.decode(entry.value, {stream: true});
      }
      body += decoder.decode();
      return signal.aborted ? {status: response.status} : {status: response.status, body: JSON.parse(body) as unknown};
    } finally {
      void reader.cancel().catch(() => {});
      reader.releaseLock();
    }
  }
  const acknowledged = (raw: unknown) => JSON.stringify(raw) === '{"ok":true}';
  return {
    async register(workspaceId: string, signal: AbortSignal) {
      const response = await send({operation: "register", workspaceId}, {signal});
      if (response.status === 429 || response.status >= 500) return {status: "retry"} as const;
      const registered = parseManagedBrowserRegistration(response.body);
      if (registered?.target.workspaceId === workspaceId) return {status: "registered", tab: registered} as const;
      return {status: "unavailable"} as const;
    },
    async observe(tab: Registration, signal: AbortSignal) {
      const response = await send({operation: "observe", document: tab.target}, {proof: tab.proof, signal});
      const state = readUiControlObservation(response.body);
      if (state?.status !== "ready" || !state.request) return state;
      const { target } = state.request;
      if (target.windowId === tab.target.windowId && target.uiIncarnationId === tab.target.uiIncarnationId &&
          target.hostIncarnationId === tab.target.hostIncarnationId && target.workspaceId === tab.target.workspaceId) return state;
    },
    async consent(operation: "accept" | "ready", tab: Registration, target: UiControlAttempt | UiControlLeaseTarget, signal: AbortSignal) {
      return readUiControlTimedGrant((await send({operation, document: tab.target, target}, {proof: tab.proof, signal})).body);
    },
    async revoke(tab: Registration, target: UiControlAttempt | UiControlLeaseTarget, signal: AbortSignal) {
      return acknowledged((await send({operation: "revoke", document: tab.target, target}, {proof: tab.proof, signal})).body);
    },
    async disconnect(tab: Registration) {
      return acknowledged((await send({operation: "disconnect", document: tab.target}, {proof: tab.proof, keepalive: true})).body);
    },
  };
}
