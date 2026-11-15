import { copyBoundedPassiveData, readStrictPassiveRecord } from "../shared";
import {
  readDesktopPlanApprovalDecision, readDesktopPlanApprovalList, readDesktopPlanApprovalSelection, readDesktopPlanApprovalView,
  type DesktopPlanApprovalDecision, type DesktopPlanApprovalSelection,
} from "./desktop-headless-plan-approval";
import { readHeadlessPlanReviewAgentResult } from "./headless-plan-review-wire";
import { isUiControlId, readUiControlWindow, type UiControlWindowTarget } from "./ui-control-authority";

export const MANAGED_BROWSER_PLAN_APPROVAL_PATH = "/api/headless/browser/plan-approvals";
export const MANAGED_BROWSER_PLAN_APPROVAL_MAX_RESULT_BYTES = 64 * 1_024;

export type ManagedBrowserPlanApprovalRequest =
  | { readonly operation: "list"; readonly document: UiControlWindowTarget }
  | { readonly operation: "open"; readonly document: UiControlWindowTarget; readonly selection: DesktopPlanApprovalSelection }
  | { readonly operation: "decide"; readonly document: UiControlWindowTarget; readonly decision: DesktopPlanApprovalDecision }
  | { readonly operation: "dismiss"; readonly document: UiControlWindowTarget; readonly viewId: string };

export function readManagedBrowserPlanApprovalRequest(value: unknown): ManagedBrowserPlanApprovalRequest | undefined {
  try {
    const { operation, document: input, ...fields } = readStrictPassiveRecord(copyBoundedPassiveData(value),
      ["operation", "document", "selection", "decision", "viewId"]);
    const document = readUiControlWindow(input);
    if (!document) return;
    switch (operation) {
      case "list":
        if (Object.keys(fields).length === 0) return { operation, document };
        return;
      case "open": {
        const { selection } = readStrictPassiveRecord(fields, ["selection"]);
        const exact = readDesktopPlanApprovalSelection(selection);
        if (exact?.workspaceId === document.workspaceId) return { operation, document, selection: exact };
        return;
      }
      case "decide": {
        const { decision } = readStrictPassiveRecord(fields, ["decision"]);
        const exact = readDesktopPlanApprovalDecision(decision);
        if (exact?.selection.workspaceId === document.workspaceId) return { operation, document, decision: exact };
        return;
      }
      case "dismiss": {
        const { viewId } = readStrictPassiveRecord(fields, ["viewId"]);
        if (isUiControlId(viewId)) return { operation, document, viewId };
      }
    }
  } catch { return undefined; }
}

export function readManagedBrowserPlanApprovalValue(request: ManagedBrowserPlanApprovalRequest, value: unknown) {
  switch (request.operation) {
    case "list": return readDesktopPlanApprovalList(value, request.document.workspaceId);
    case "open": {
      const view = readDesktopPlanApprovalView(value, request.selection);
      return view?.preview.hostIncarnationId === request.document.hostIncarnationId ? view : undefined;
    }
    case "decide": {
      const result = readHeadlessPlanReviewAgentResult({ok:true, value}, request.decision.selection.fingerprint);
      if (result.ok && result.value.revision === request.decision.expectedRevision + 1) return result.value;
      return;
    }
    case "dismiss": return value === true ? true : undefined;
  }
}
