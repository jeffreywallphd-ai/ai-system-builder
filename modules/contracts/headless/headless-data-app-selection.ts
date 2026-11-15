import { copyBoundedPassiveData, readStrictPassiveRecord } from "../shared";
import { isDesktopHeadlessClientId } from "./desktop-headless-pairing";
import { readHeadlessLocalFileImportRequest, type HeadlessLocalFileImportRequest } from "./headless-data-local-file";
import { HEADLESS_CONTRACT_VERSION, type HeadlessHostIncarnationId } from "./headless-read-request";

export const DESKTOP_HEADLESS_LOCAL_FILE_SELECTION_CHANNEL = "headless-data:select-local-file";

/** App-only selection. Agent transports must never dispatch this operation. */
export interface AppHeadlessLocalFileSelectionRequest {
  readonly version: typeof HEADLESS_CONTRACT_VERSION;
  readonly operation: "data.select-local-file";
  readonly input: HeadlessLocalFileImportRequest["input"] & {
    readonly registeredClientId: string;
    readonly expectedSelectionRevision: number;
  };
}

export type AppHeadlessLocalFileSelectionValue = Pick<
  AppHeadlessLocalFileSelectionRequest["input"], "workspaceId" | "taskId" | "fileId" | "taskRevision"
> & { readonly selectionRevision: number };

export type DesktopLocalFileSelectionInput = Omit<AppHeadlessLocalFileSelectionRequest["input"], "hostIncarnationId">;

const invalid = { ok: false, code: "headless.invalid-request" } as const;
const selectionFields = ["workspaceId", "taskId", "fileId", "taskRevision", "registeredClientId", "expectedSelectionRevision"] as const;

/** The main process supplies the running host ID for an interactive renderer request. */
export function readDesktopLocalFileSelectionRequest(value: unknown, currentHost: HeadlessHostIncarnationId) {
  try {
    const input = readStrictPassiveRecord(copyBoundedPassiveData(value), selectionFields);
    return readAppHeadlessLocalFileSelectionRequest({
      version: HEADLESS_CONTRACT_VERSION,
      operation: "data.select-local-file",
      input: { ...input, hostIncarnationId: currentHost },
    }, currentHost);
  } catch { return invalid; }
}

export function readAppHeadlessLocalFileSelectionRequest(value: unknown, currentHost: HeadlessHostIncarnationId):
  { readonly ok: true; readonly request: AppHeadlessLocalFileSelectionRequest } |
  typeof invalid | { readonly ok: false; readonly code: "headless.host-changed" } {
  try {
    const { version, operation, input } = readStrictPassiveRecord(copyBoundedPassiveData(value),
      ["version", "operation", "input"]);
    if (version !== HEADLESS_CONTRACT_VERSION || operation !== "data.select-local-file") return invalid;
    const { registeredClientId, expectedSelectionRevision, ...target } =
      readStrictPassiveRecord(input, ["hostIncarnationId", ...selectionFields]);
    if (!isDesktopHeadlessClientId(registeredClientId) || typeof expectedSelectionRevision !== "number" ||
        !Number.isSafeInteger(expectedSelectionRevision) || expectedSelectionRevision < 0 ||
        expectedSelectionRevision >= Number.MAX_SAFE_INTEGER) return invalid;
    const parsed = readHeadlessLocalFileImportRequest({ version, operation: "data.prepare-local-file", input: target }, currentHost);
    return parsed.ok ? { ok: true, request: {
      version, operation, input: { ...parsed.request.input, registeredClientId, expectedSelectionRevision },
    } } : parsed;
  } catch {
    return invalid;
  }
}

/** Validate the receipt for one selection action. Query separately to find the current selected file. */
export function readAppHeadlessLocalFileSelectionValue(value: unknown, expected: DesktopLocalFileSelectionInput):
  AppHeadlessLocalFileSelectionValue | undefined {
  try {
    const { workspaceId, taskId, fileId, taskRevision, selectionRevision } = readStrictPassiveRecord(
      copyBoundedPassiveData(value), ["workspaceId", "taskId", "fileId", "taskRevision", "selectionRevision"],
    );
    if (workspaceId !== expected.workspaceId || taskId !== expected.taskId || fileId !== expected.fileId ||
        taskRevision !== expected.taskRevision || typeof selectionRevision !== "number" ||
        !Number.isSafeInteger(selectionRevision) || selectionRevision < 1 ||
        (selectionRevision !== expected.expectedSelectionRevision && selectionRevision !== expected.expectedSelectionRevision + 1)) return;
    return {
      workspaceId: expected.workspaceId,
      taskId: expected.taskId,
      fileId: expected.fileId,
      taskRevision: expected.taskRevision,
      selectionRevision,
    };
  } catch {
    return undefined;
  }
}
