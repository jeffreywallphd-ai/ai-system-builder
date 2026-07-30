interface WebContentsLike {
  readonly mainFrame?: unknown;
  isDestroyed?(): boolean;
}

interface BrowserWindowLike {
  readonly webContents: WebContentsLike;
  isDestroyed?(): boolean;
}

interface IpcInvokeEventLike {
  readonly sender?: unknown;
  readonly senderFrame?: unknown;
}

export function isTrustedIpcSender(
  event: unknown,
  ownedWindows: Iterable<BrowserWindowLike>,
): boolean {
  if (!event || typeof event !== "object") return false;
  const candidate = event as IpcInvokeEventLike;
  for (const window of ownedWindows) {
    if (window.isDestroyed?.() || window.webContents.isDestroyed?.()) continue;
    if (
      candidate.sender === window.webContents &&
      candidate.senderFrame !== undefined &&
      candidate.senderFrame === window.webContents.mainFrame
    ) {
      return true;
    }
  }
  return false;
}
