import { copyBoundedPassiveData, readStrictPassiveRecord } from "../shared";
import {
  readDesktopPlanApprovalDecision, readDesktopPlanApprovalList, readDesktopPlanApprovalSelection, readDesktopPlanApprovalView,
  type DesktopPlanApprovalDecision, type DesktopPlanApprovalSelection,
} from "./desktop-headless-plan-approval";
import { readHeadlessPlanReviewAgentResult } from "./headless-plan-review-wire";
import type { HeadlessBuildPlanCapabilities } from "./headless-system-management";
import { isUiControlId, readUiControlWindow, type UiControlWindowTarget } from "./ui-control-authority";
import { isDesktopHeadlessClientId } from "./desktop-headless-pairing";
import { readAppHeadlessLocalFileSelectionValue, readDesktopLocalFileSelectionRequest, readDesktopProviderFileSelectionRequest,
  type DesktopLocalFileSelectionInput } from "./headless-data-app-selection";

export const MANAGED_BROWSER_PLAN_APPROVAL_PATH = "/api/headless/browser/plan-approvals";
export const MANAGED_BROWSER_PLAN_CHAT_PATH = "/api/headless/browser/plan-chat";
export const MANAGED_BROWSER_PLAN_APPROVAL_MAX_RESULT_BYTES = 64 * 1_024;

export type ManagedBrowserPlanApprovalRequest =
  | { readonly operation: "list"; readonly document: UiControlWindowTarget }
  | { readonly operation: "open"; readonly document: UiControlWindowTarget; readonly selection: DesktopPlanApprovalSelection }
  | { readonly operation: "decide"; readonly document: UiControlWindowTarget; readonly decision: DesktopPlanApprovalDecision }
  | { readonly operation: "list-file-clients"; readonly document: UiControlWindowTarget }
  | { readonly operation: "select-file"; readonly document: UiControlWindowTarget; readonly file: DesktopLocalFileSelectionInput }
  | { readonly operation: "select-provider-file"; readonly document: UiControlWindowTarget; readonly file: DesktopLocalFileSelectionInput }
  | { readonly operation: "dismiss"; readonly document: UiControlWindowTarget; readonly viewId: string };

export function readManagedBrowserPlanApprovalRequest(value: unknown): ManagedBrowserPlanApprovalRequest | undefined {
  try {
    const { operation, document: input, ...fields } = readStrictPassiveRecord(copyBoundedPassiveData(value),
      ["operation", "document", "selection", "decision", "viewId", "file"]);
    const document = readUiControlWindow(input);
    if (!document) return;
    switch (operation) {
      case "list":
      case "list-file-clients":
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
        return;
      }
      case "select-file":
      case "select-provider-file": {
        const { file: selected } = readStrictPassiveRecord(fields, ["file"]);
        const parsed = operation === "select-provider-file" ? readDesktopProviderFileSelectionRequest(selected, document.hostIncarnationId)
          : readDesktopLocalFileSelectionRequest(selected, document.hostIncarnationId);
        if (!parsed.ok || parsed.request.input.workspaceId !== document.workspaceId) return;
        const { hostIncarnationId: _boundByDocument, ...file } = parsed.request.input;
        return { operation, document, file };
      }
    }
  } catch { return undefined; }
}

export function readManagedBrowserPlanApprovalValue(request: ManagedBrowserPlanApprovalRequest, value: unknown,
  options?: HeadlessBuildPlanCapabilities) {
  switch (request.operation) {
    case "list": return readDesktopPlanApprovalList(value, request.document.workspaceId);
    case "list-file-clients": {
      try {
        const clients = copyBoundedPassiveData(value);
        if (Array.isArray(clients) && clients.length <= 1 && clients.every(isDesktopHeadlessClientId))
          return clients as readonly string[];
      } catch { return; }
      return;
    }
    case "select-file":
    case "select-provider-file": return readAppHeadlessLocalFileSelectionValue(value, request.file);
    case "open": {
      const view = readDesktopPlanApprovalView(value, request.selection, {
        allowLocalFileSave: options?.allowLocalFileSave === true, allowProviderFileSave: options?.allowProviderFileSave === true,
        allowLocalDatasetPreparation: options?.allowLocalDatasetPreparation === true,
        allowDatasetResultSave: options?.allowDatasetResultSave === true,
        allowContextPackGeneration: options?.allowContextPackGeneration === true,
          allowContextRagGeneration: options?.allowContextRagGeneration === true,
        allowContextResultSave: options?.allowContextResultSave === true,
        allowContextQuery: options?.allowContextQuery === true,
      });
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
