import { readStrictPassiveRecord } from "../shared";
import { createIpcChannelValue } from "../ipc/ipc-channel";
import { createTransportOperation } from "../transport";
import { isWorkspaceId, type WorkspaceId } from "../workspace";

export const DESKTOP_SYSTEM_CHANGE_POLL_CHANNEL = createIpcChannelValue(
  createTransportOperation("system-builder", "observe-saved-changes"), "request",
);
export type DesktopSystemChangeWatermark =
  | { readonly status: "ready"; readonly sequence: number }
  | { readonly status: "unavailable" };

export function readDesktopSystemChangePoll(value: unknown): WorkspaceId | undefined {
  try {
    const { workspaceId } = readStrictPassiveRecord(value, ["workspaceId"]);
    return isWorkspaceId(workspaceId) ? workspaceId : undefined;
  } catch { return undefined; }
}

export function readDesktopSystemChangeWatermark(value: unknown): DesktopSystemChangeWatermark {
  try {
    const { status, sequence } = readStrictPassiveRecord(value, ["status", "sequence"]);
    if (status === "ready" && typeof sequence === "number" && Number.isSafeInteger(sequence) && sequence >= 0)
      return { status, sequence };
  } catch { /* Treat malformed responses as unavailable. */ }
  return { status: "unavailable" };
}
