import { readHeadlessWindowResult, type HeadlessWindowRequest } from "./ui-control-connector";
import { sameManagedBrowserAttempt, sameManagedBrowserDocument } from "./managed-browser-consent";
import { sameUiControlLease } from "./ui-control-delivery";

export const MANAGED_HEADLESS_AGENT_WINDOW_PATH = "/api/headless/agent/window";
export const MANAGED_HEADLESS_AGENT_SESSION_HEADER = "x-aisb-headless-session";
const unavailable = {ok: false, code: "headless.unavailable"} as const;

export function isManagedWindowOperation(operation: HeadlessWindowRequest["operation"], enableDelivery: boolean): boolean {
  switch (operation) {
    case "window.list":
    case "window.request":
    case "window.status":
    case "window.release":
      return true;
    case "window.renew":
    case "window.context":
    case "window.present":
      return enableDelivery;
  }
}

/** Restrict response fields to the exact operation and admitted resource scope. */
export function readManagedWindowResult(raw: unknown, request: HeadlessWindowRequest) {
  const result = readHeadlessWindowResult(raw);
  if (!result.ok) return result;
  const value = result.value;
  switch (request.operation) {
    case "window.list":
      if (value.kind === "windows" && value.windows.every(window =>
        window.hostIncarnationId === request.input.hostIncarnationId && window.workspaceId === request.input.workspaceId)) return result;
      break;
    case "window.request":
      if (value.kind === "ended" || value.kind === "request" && value.request.taskId === request.input.taskId &&
        sameManagedBrowserDocument(value.request.target, request.input.target)) return result;
      break;
    case "window.status":
      if (value.kind === "ended" || value.kind === "request" && sameManagedBrowserAttempt(value.request.target, request.input.target)) return result;
      break;
    case "window.release":
      if (value.kind === "released") return result;
      break;
    case "window.renew":
      if (value.kind === "ended" || value.kind === "request" && value.lease &&
          sameUiControlLease(value.lease, request.input.target)) return result;
      break;
    case "window.context":
      if (value.kind === "context" && value.context?.ready) return result;
      break;
    case "window.present":
      if (value.kind === "command" && value.receipt.commandId === request.input.commandId &&
          (value.duplicate || value.receipt.status === "accepted")) return result;
      break;
  }
  return unavailable;
}
