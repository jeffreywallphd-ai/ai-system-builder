import { readHeadlessWindowResult, type HeadlessWindowRequest } from "./ui-control-connector";
import {sameManagedBrowserAttempt, sameManagedBrowserDocument} from "./managed-browser-consent";

export const MANAGED_HEADLESS_AGENT_WINDOW_PATH = "/api/headless/agent/window";
export const MANAGED_HEADLESS_AGENT_SESSION_HEADER = "x-aisb-headless-session";
const unavailable = {ok: false, code: "headless.unavailable"} as const;

export function isManagedConsentWindowOperation(operation: HeadlessWindowRequest["operation"]): boolean {
  return operation === "window.list" || operation === "window.request" ||
    operation === "window.status" || operation === "window.release";
}

/** Restrict response fields to the exact operation and admitted resource scope. */
export function readManagedConsentWindowResult(raw: unknown, request: HeadlessWindowRequest) {
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
  }
  return unavailable;
}
