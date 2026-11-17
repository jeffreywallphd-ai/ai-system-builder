import { readStrictPassiveRecord } from "../shared";
import { isWorkspaceId, type WorkspaceId } from "../workspace";
import {
  UI_CONTROL_VERSION, isUiControlId, readUiControlAttempt, readUiControlLeaseTarget, readUiControlRequestView,
  readUiControlRevoke, readUiControlWindow,
  type UiControlAttempt, type UiControlLeaseTarget, type UiControlRequestView, type UiControlWindowTarget,
} from "./ui-control-authority";
import { readUiPresentationContext, readUiPresentationReceipt, readUiPresentationSubmission,
  type UiPresentationContext, type UiPresentationReceipt, type UiPresentationSubmission } from "./ui-control-delivery";
import { isHeadlessHostIncarnationId, type HeadlessHostIncarnationId } from "./headless-read-request";

export const HEADLESS_WINDOW_CONTROL_PATH = "/aisb-headless/v1/window";

type WindowOperation =
  | { readonly operation: "window.list"; readonly input: { readonly hostIncarnationId: HeadlessHostIncarnationId; readonly workspaceId: WorkspaceId } }
  | { readonly operation: "window.request"; readonly input: { readonly target: UiControlWindowTarget; readonly taskId: string; readonly requestKey: string }}
  | { readonly operation: "window.status"; readonly input: { readonly target: UiControlAttempt }}
  | { readonly operation: "window.renew" | "window.context"; readonly input: { readonly target: UiControlLeaseTarget }}
  | { readonly operation: "window.release"; readonly input: { readonly target: UiControlAttempt | UiControlLeaseTarget }}
  | { readonly operation: "window.present"; readonly input: UiPresentationSubmission };

export type HeadlessWindowRequest = WindowOperation & { readonly version: typeof UI_CONTROL_VERSION };
const failureCodes = [
  "headless.invalid-request", "headless.host-changed", "headless.forbidden", "headless.unavailable",
  "headless.idempotency-conflict", "headless.operation-capacity", "headless.operation-unconfirmed",
] as const;
export type HeadlessWindowFailure = { readonly ok: false; readonly code: (typeof failureCodes)[number] };
export type HeadlessWindowValue =
  | { readonly kind: "windows"; readonly windows: readonly UiControlWindowTarget[] }
  | { readonly kind: "request"; readonly request: UiControlRequestView; readonly lease?: UiControlLeaseTarget }
  | { readonly kind: "context"; readonly context?: UiPresentationContext }
  | { readonly kind: "command"; readonly receipt: UiPresentationReceipt; readonly duplicate: boolean }
  | { readonly kind: "released" | "ended" };
export type HeadlessWindowResult = HeadlessWindowFailure | { readonly ok: true; readonly value: HeadlessWindowValue };

export function readHeadlessWindowRequest(raw: unknown): HeadlessWindowRequest | undefined {
  try {
    const { version, operation, input } = readStrictPassiveRecord(raw, ["version", "operation", "input"]);
    if (version !== UI_CONTROL_VERSION) return;
    switch (operation) {
      case "window.list": {
        const { hostIncarnationId, workspaceId } = readStrictPassiveRecord(input, ["hostIncarnationId", "workspaceId"]);
        if (isHeadlessHostIncarnationId(hostIncarnationId) && isWorkspaceId(workspaceId)) {
          return { version, operation, input: { hostIncarnationId, workspaceId } };
        }
        break;
      }
      case "window.request": {
        const { target, taskId, requestKey } = readStrictPassiveRecord(input, ["target", "taskId", "requestKey"]);
        const window = readUiControlWindow(target);
        if (window && isUiControlId(taskId) && isUiControlId(requestKey)) return { version, operation, input: { target: window, taskId, requestKey } };
        break;
      }
      case "window.status": {
        const target = readUiControlAttempt(readStrictPassiveRecord(input, ["target"]).target);
        if (target) return { version, operation, input: { target } };
        break;
      }
      case "window.renew":
      case "window.context": {
        const target = readUiControlLeaseTarget(readStrictPassiveRecord(input, ["target"]).target);
        if (target) return { version, operation, input: { target } };
        break;
      }
      case "window.release": {
        const target = readUiControlRevoke(readStrictPassiveRecord(input, ["target"]).target);
        if (target) return { version, operation, input: { target } };
        break;
      }
      case "window.present": {
        const presentation = readUiPresentationSubmission(input);
        if (presentation) return { version, operation, input: presentation };
        break;
      }
    }
  } catch { return undefined; }
}

const unavailable = { ok: false, code: "headless.unavailable" } as const;

export function readHeadlessWindowResult(raw: unknown): HeadlessWindowResult {
  try {
    const row = readStrictPassiveRecord(raw, ["ok", "value", "code"]);
    if (row.ok === false && !("value" in row) && failureCodes.includes(row.code as never)) {
      return { ok: false, code: row.code as HeadlessWindowFailure["code"] };
    }
    if (row.ok !== true || "code" in row) return unavailable;
    const value = readStrictPassiveRecord(row.value, ["kind", "windows", "request", "lease", "context", "receipt", "duplicate"]);
    const count = Object.keys(value).length;
    switch (value.kind) {
      case "windows": {
        if (count !== 2 || !Array.isArray(value.windows) || value.windows.length > 32) break;
        const windows: UiControlWindowTarget[] = [];
        for (const rawWindow of value.windows) {
          const window = readUiControlWindow(rawWindow);
          if (!window) return unavailable;
          windows.push(window);
        }
        return { ok: true, value: { kind: "windows", windows } };
      }
      case "request": {
        const request = readUiControlRequestView(value.request);
        if (!request) break;
        if (count === 2 && !("lease" in value)) return { ok: true, value: { kind: "request", request } };
        const lease = readUiControlLeaseTarget(value.lease);
        if (count === 3 && lease && request.status === "active") {
          const { leaseId: _leaseId, generation: _generation, ...attempt } = lease;
          if (JSON.stringify(attempt) === JSON.stringify(request.target)) return { ok: true, value: { kind: "request", request, lease } };
        }
        break;
      }
      case "context": {
        if (count === 1) return { ok: true, value: { kind: "context" } };
        const context = readUiPresentationContext(value.context);
        if (count === 2 && context) return { ok: true, value: { kind: "context", context } };
        break;
      }
      case "command": {
        const receipt = readUiPresentationReceipt(value.receipt);
        if (count === 3 && receipt && typeof value.duplicate === "boolean")
          return { ok: true, value: { kind: "command", receipt, duplicate: value.duplicate } };
        break;
      }
      case "ended":
      case "released":
        if (count === 1) return { ok: true, value: { kind: value.kind } };
        break;
    }
  } catch { return unavailable; }
  return unavailable;
}
