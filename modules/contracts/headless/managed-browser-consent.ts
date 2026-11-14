import { readStrictPassiveRecord } from "../shared";
import { isWorkspaceId, type WorkspaceId } from "../workspace";
import { readUiControlAttempt, readUiControlLeaseTarget, readUiControlRevoke, readUiControlWindow,
  type UiControlAttempt, type UiControlLeaseTarget, type UiControlWindowTarget } from "./ui-control-authority";

export const MANAGED_BROWSER_CONSENT_PATH = "/api/headless/browser/consent";
export const MANAGED_BROWSER_DOCUMENT_HEADER = "x-aisb-headless-document";

export function isManagedBrowserDocumentProof(value: unknown): value is string {
  return typeof value === "string" && /^[A-Za-z0-9_-]{43}$/.test(value);
}

export function parseManagedBrowserRegistration(raw: unknown) {
  try {
    const {target: rawTarget, proof} = readStrictPassiveRecord(raw, ["target", "proof"]);
    const target = readUiControlWindow(rawTarget);
    if (target && isManagedBrowserDocumentProof(proof)) return {target, proof};
  } catch { return undefined; }
}

type Operation =
  | {readonly operation: "register"; readonly workspaceId: WorkspaceId}
  | {readonly operation: "observe"; readonly document: UiControlWindowTarget}
  | {readonly operation: "disconnect"; readonly document: UiControlWindowTarget}
  | {readonly operation: "accept" | "ready" | "revoke"; readonly document: UiControlWindowTarget; readonly target: UiControlAttempt | UiControlLeaseTarget};

export function sameManagedBrowserDocument(left: UiControlWindowTarget, right: UiControlWindowTarget) {
  return left.hostIncarnationId === right.hostIncarnationId && left.workspaceId === right.workspaceId &&
    left.windowId === right.windowId && left.uiIncarnationId === right.uiIncarnationId;
}

export function sameManagedBrowserAttempt(left: UiControlAttempt, right: UiControlAttempt) {
  return sameManagedBrowserDocument(left, right) && left.requestId === right.requestId && left.attemptId === right.attemptId;
}

export function parseManagedBrowserConsent(raw: unknown): Operation | undefined {
  try {
    const record = readStrictPassiveRecord(raw, ["operation", "workspaceId", "document", "target"]);
    const {operation, workspaceId, document: rawDocument, target: rawTarget} = record;
    if (operation === "register") {
      if (Object.keys(record).length === 2 && isWorkspaceId(workspaceId)) return {operation, workspaceId};
      return;
    }
    const document = readUiControlWindow(rawDocument);
    if (!document || "workspaceId" in record) return;
    if (operation === "observe") return "target" in record ? undefined : {operation, document};
    if (operation === "disconnect") return "target" in record ? undefined : {operation, document};
    if (operation !== "accept" && operation !== "ready" && operation !== "revoke") return;
    const target = operation === "accept" ? readUiControlAttempt(rawTarget) :
      operation === "ready" ? readUiControlLeaseTarget(rawTarget) : readUiControlRevoke(rawTarget);
    if (target && sameManagedBrowserDocument(document, target)) return {operation, document, target};
  } catch { return undefined; }
}
