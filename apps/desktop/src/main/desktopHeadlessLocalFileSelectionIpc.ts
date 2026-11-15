import type { IpcMainHandlePort } from "../../../../modules/adapters/transport/ipc-electron/ipcMainHandlePort";
import {
  DESKTOP_HEADLESS_LOCAL_FILE_SELECTION_CHANNEL,
  readDesktopLocalFileSelectionRequest,
  readAppHeadlessLocalFileSelectionValue,
} from "../../../../modules/contracts/headless";
import type { composeDesktopHeadlessLocalFileSelection } from "../../../../modules/hosts/desktop/composition/composeDesktopHeadlessLocalFileSelection";

type Selection = ReturnType<typeof composeDesktopHeadlessLocalFileSelection>;
const unavailable = { ok: false, code: "headless.unavailable" } as const;
const MAX_PENDING = 4;

export function registerDesktopHeadlessLocalFileSelectionIpc(options: {
  readonly ipcMain: IpcMainHandlePort;
  readonly getSelection: () => Selection | undefined;
  readonly resolveWindow: (event: unknown) => { readonly isUsable: () => boolean } | undefined;
}) {
  let active = 0;
  options.ipcMain.handle(DESKTOP_HEADLESS_LOCAL_FILE_SELECTION_CHANNEL, async (event, raw: unknown) => {
    const window = options.resolveWindow(event);
    const selection = options.getSelection();
    if (!window?.isUsable() || !selection || active >= MAX_PENDING) return unavailable;
    const parsed = readDesktopLocalFileSelectionRequest(raw, selection.hostIncarnationId);
    if (!parsed.ok) return parsed;
    const isCurrent = () => window.isUsable() && options.getSelection() === selection;
    active++;
    try {
      const result = await selection.select(parsed.request, isCurrent);
      if (!isCurrent()) return unavailable;
      if (!result.ok) return result;
      const value = readAppHeadlessLocalFileSelectionValue(result.value, parsed.request.input);
      return value && result.receiptIsCurrent() && isCurrent() ? { ok: true, value } as const : unavailable;
    } catch {
      return unavailable;
    } finally {
      active--;
    }
  });
}
