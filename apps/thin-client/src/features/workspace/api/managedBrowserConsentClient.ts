import { MANAGED_BROWSER_CONSENT_PATH, MANAGED_BROWSER_DOCUMENT_HEADER, MANAGED_BROWSER_OBSERVE_PATH, parseManagedBrowserRegistration } from "../../../../../../modules/contracts/headless";
import { isUiControlId, readUiControlObservation, readUiControlTimedGrant,
  type UiControlAttempt, type UiControlLeaseTarget } from "../../../../../../modules/contracts/headless";
import { readUiPresentationPullResult, sameUiControlLease, type UiPresentationReceipt,
  type UiPresentationContext } from "../../../../../../modules/contracts/headless";
import { MANAGED_BROWSER_DELIVERY_PATH, MANAGED_BROWSER_ACKNOWLEDGE_PATH, MANAGED_BROWSER_CONTEXT_PATH,
  MANAGED_BROWSER_PUBLISH_CONTEXT_PATH } from "../../../../../../modules/contracts/headless";
import { readStrictPassiveRecord } from "../../../../../../modules/contracts/shared";
import { MANAGED_BROWSER_PLAN_APPROVAL_MAX_RESULT_BYTES, MANAGED_BROWSER_PLAN_APPROVAL_PATH, MANAGED_BROWSER_PLAN_CHAT_PATH,
  readManagedBrowserPlanApprovalValue, type ManagedBrowserPlanApprovalRequest } from "../../../../../../modules/contracts/headless";
import type { DesktopPlanApprovalDecision, DesktopPlanApprovalListEntry, DesktopPlanApprovalSelection, DesktopPlanApprovalView } from "../../../../../../modules/contracts/headless";
import { readAppHeadlessLocalFileSelectionValue, type DesktopLocalFileSelectionInput } from "../../../../../../modules/contracts/headless";
import { secureFetch } from "../../../security/secureFetch";

const MAX_RESPONSE = 4_096;
type Registration = NonNullable<ReturnType<typeof parseManagedBrowserRegistration>>;
type ApprovalState = DesktopPlanApprovalView["state"];
type Payload = {readonly status: number; readonly body?: unknown; readonly delivery?: boolean;
  readonly planApprovals?: boolean; readonly planChat?: boolean};
type ApprovalPath = typeof MANAGED_BROWSER_PLAN_APPROVAL_PATH | typeof MANAGED_BROWSER_PLAN_CHAT_PATH;
type Request = {readonly operation: "register"; readonly workspaceId: string} |
  {readonly operation: "observe" | "disconnect"; readonly document: Registration["target"]} |
  {readonly operation: "accept" | "ready" | "revoke"; readonly document: Registration["target"]; readonly target: UiControlAttempt | UiControlLeaseTarget};
type PresentationRequest = {readonly document: Registration["target"]} & (
  {readonly operation: "pull"; readonly input: {readonly target: UiControlLeaseTarget; readonly sequence: number}} |
  {readonly operation: "acknowledge"; readonly input: {readonly target: UiControlLeaseTarget; readonly receipt: UiPresentationReceipt}} |
  {readonly operation: "challenge"; readonly input: {readonly target: UiControlLeaseTarget}} |
  {readonly operation: "publish"; readonly input: {readonly target: UiControlLeaseTarget; readonly challenge: string; readonly context: UiPresentationContext}}
);
const browserPaths = {
  observe: MANAGED_BROWSER_OBSERVE_PATH,
  pull: MANAGED_BROWSER_DELIVERY_PATH,
  acknowledge: MANAGED_BROWSER_ACKNOWLEDGE_PATH,
  challenge: MANAGED_BROWSER_CONTEXT_PATH,
  publish: MANAGED_BROWSER_PUBLISH_CONTEXT_PATH,
};

export function createManagedBrowserConsentClient(organizationId: string, fetch = secureFetch) {
  async function send(request: Request | PresentationRequest | ManagedBrowserPlanApprovalRequest,
    options: {readonly proof?: Registration["proof"]; readonly signal?: AbortSignal; readonly keepalive?: boolean;
      readonly approvalPath?: ApprovalPath} = {}): Promise<Payload> {
    const headers: Record<string, string> = {"Content-Type": "application/json", "x-organization-id": organizationId};
    if (options.proof) headers[MANAGED_BROWSER_DOCUMENT_HEADER] = options.proof;
    const timeout = AbortSignal.timeout(4_000);
    const signal = options.signal ? AbortSignal.any([timeout, options.signal]) : timeout;
    const path = options.approvalPath ??
      (request.operation in browserPaths ? browserPaths[request.operation as keyof typeof browserPaths] : MANAGED_BROWSER_CONSENT_PATH);
    const responseLimit = options.approvalPath ? MANAGED_BROWSER_PLAN_APPROVAL_MAX_RESULT_BYTES : MAX_RESPONSE;
    const response = await fetch(path, {
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
        if (bytes > responseLimit || signal.aborted) return {status: response.status};
        body += decoder.decode(entry.value, {stream: true});
      }
      body += decoder.decode();
      return signal.aborted ? {status: response.status} : {status: response.status, body: JSON.parse(body) as unknown,
        delivery: response.headers.get("x-aisb-headless-presentation") === "1",
        planApprovals: response.headers.get("x-aisb-headless-plan-approvals") === "1",
        planChat: response.headers.get("x-aisb-headless-plan-chat") === "1"};
    } finally {
      void reader.cancel().catch(() => {});
      reader.releaseLock();
    }
  }
  const acknowledged = (raw: unknown) => JSON.stringify(raw) === '{"ok":true}';
  async function approval(request: ManagedBrowserPlanApprovalRequest, tab: Registration, signal: AbortSignal, chat: boolean) {
    const response = await send(request, {proof:tab.proof, signal,
      approvalPath:chat ? MANAGED_BROWSER_PLAN_CHAT_PATH : MANAGED_BROWSER_PLAN_APPROVAL_PATH});
    return readManagedBrowserPlanApprovalValue(request, response.body,
      {allowLocalFileSave:true, allowProviderFileSave:true, allowLocalDatasetPreparation:true, allowDatasetResultSave:true,
        allowContextPackGeneration:true});
  }
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
      if (state?.status !== "ready") return state;
      const target = state.request?.target;
      if (!target || target.windowId === tab.target.windowId && target.uiIncarnationId === tab.target.uiIncarnationId &&
          target.hostIncarnationId === tab.target.hostIncarnationId && target.workspaceId === tab.target.workspaceId) {
        return {...state, delivery: response.delivery === true, planApprovals: response.planApprovals === true,
          ...(response.planChat === true ? {planChat:true} : {})};
      }
    },
    async listPlanApprovals(tab: Registration, signal: AbortSignal, chat = false): Promise<readonly DesktopPlanApprovalListEntry[] | undefined> {
      const result = await approval({operation:"list", document:tab.target}, tab, signal, chat);
      if (Array.isArray(result)) return result;
    },
    async openPlanApproval(tab: Registration, selection: DesktopPlanApprovalSelection, signal: AbortSignal,
      chat = false): Promise<DesktopPlanApprovalView | undefined> {
      const result = await approval({operation:"open", document:tab.target, selection}, tab, signal, chat);
      if (result && typeof result === "object" && "viewId" in result &&
          await matchesPlanFingerprint(result, selection.fingerprint) && !signal.aborted &&
          result.state.expiresAt > Date.now()) return result;
    },
    async decidePlanApproval(tab: Registration, decision: DesktopPlanApprovalDecision, displayed: ApprovalState,
      signal: AbortSignal, chat = false): Promise<ApprovalState | undefined> {
      if (displayed.fingerprint !== decision.selection.fingerprint || displayed.revision !== decision.expectedRevision ||
          displayed.expiresAt <= Date.now()) return;
      const result = await approval({operation:"decide", document:tab.target, decision}, tab, signal, chat);
      if (result && typeof result === "object" && "revision" in result && !signal.aborted &&
          matchesPlanDecision(result, displayed, decision.decision)) return result;
    },
    async dismissPlanApproval(tab: Registration, viewId: string, signal: AbortSignal, chat = false) {
      return await approval({operation:"dismiss", document:tab.target, viewId}, tab, signal, chat) === true;
    },
    async listPlanFileClients(tab: Registration, signal: AbortSignal): Promise<readonly string[]> {
      const result = await approval({ operation:"list-file-clients", document:tab.target }, tab, signal, false);
      return Array.isArray(result) && result.every(item => typeof item === "string") ? result : [];
    },
    async selectPlanLocalFile(tab: Registration, file: DesktopLocalFileSelectionInput, signal: AbortSignal) {
      if (file.workspaceId !== tab.target.workspaceId) return;
      const result = await approval({ operation:"select-file", document:tab.target, file }, tab, signal, false);
      if (!signal.aborted) return readAppHeadlessLocalFileSelectionValue(result, file);
    },
    async selectPlanProviderFile(tab: Registration, file: DesktopLocalFileSelectionInput, signal: AbortSignal) {
      if (file.workspaceId !== tab.target.workspaceId) return;
      const result = await approval({ operation:"select-provider-file", document:tab.target, file }, tab, signal, false);
      if (!signal.aborted) return readAppHeadlessLocalFileSelectionValue(result, file);
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
    async pull(tab: Registration, target: UiControlLeaseTarget, sequence: number, signal: AbortSignal) {
      const {body, status} = await send({operation: "pull", document: tab.target, input: {target, sequence}}, {proof: tab.proof, signal});
      if (status === 503 || status === 429) return {status: "busy"} as const;
      const value = readUiPresentationPullResult(body);
      if (value.status === "command" && (!sameUiControlLease(value.command.target, target) ||
          value.command.sequence !== sequence)) return {status: "unavailable"} as const;
      if (value.status === "terminal" && value.receipt.sequence !== sequence) return {status: "unavailable"} as const;
      return value;
    },
    async acknowledge(tab: Registration, target: UiControlLeaseTarget, receipt: UiPresentationReceipt, signal: AbortSignal) {
      try {
        const {body, status} = await send({operation: "acknowledge", document: tab.target, input: {target, receipt}}, {proof: tab.proof, signal});
        if (status === 429 || status >= 500) return "retry";
        return acknowledged(body) ? "acknowledged" : "denied";
      } catch {
        // The server may already have recorded this exact receipt.
        return signal.aborted ? "denied" : "retry";
      }
    },
    async challenge(tab: Registration, target: UiControlLeaseTarget, signal: AbortSignal) {
      const {body} = await send({operation: "challenge", document: tab.target, input: {target}}, {proof: tab.proof, signal});
      try {
        const {challenge} = readStrictPassiveRecord(body, ["challenge"]);
        if (isUiControlId(challenge)) return challenge;
      } catch { return undefined; }
    },
    async publish(tab: Registration, target: UiControlLeaseTarget, challenge: string, context: UiPresentationContext, signal: AbortSignal) {
      const {body} = await send({operation: "publish", document: tab.target, input: {target, challenge, context}},
        {proof: tab.proof, signal});
      return acknowledged(body);
    },
  };
}

async function matchesPlanFingerprint(view: DesktopPlanApprovalView, expected: string): Promise<boolean> {
  try {
    const digest = await globalThis.crypto.subtle.digest("SHA-256", new TextEncoder().encode(JSON.stringify(view.preview)));
    return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, "0")).join("") === expected;
  } catch { return false; }
}

function matchesPlanDecision(result: ApprovalState, displayed: ApprovalState,
  decision: DesktopPlanApprovalDecision["decision"]): boolean {
  const {expiresAt, stepCount, approvedSteps, mode, status} = displayed;
  if (result.expiresAt !== expiresAt || expiresAt <= Date.now() || result.stepCount !== stepCount) return false;
  if (decision.kind === "approve") {
    if (status !== "pending" || (mode !== undefined && mode !== decision.mode)) return false;
    const expected = decision.mode === "whole-plan" ? stepCount : approvedSteps + 1;
    if (decision.mode === "whole-plan" ? approvedSteps !== 0 : decision.step !== expected) return false;
    return result.mode === decision.mode && result.approvedSteps === expected &&
      result.status === (expected === stepCount ? "approved" : "pending");
  }
  if (result.approvedSteps !== approvedSteps || result.mode !== mode) return false;
  if (decision.kind === "revoke") return result.status === "revoked" && (status === "pending" || status === "approved");
  return status === "pending" && result.status === (decision.kind === "deny" ? "denied" : "cancelled");
}
