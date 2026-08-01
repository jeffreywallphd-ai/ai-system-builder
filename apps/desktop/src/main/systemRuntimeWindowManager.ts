import type { SystemPublishedConversationRuntimeQuery } from "../../../../modules/application/services/system-deployment";
import type { SystemPublishedConversationRuntimeSession } from "../../../../modules/hosts/shared/composition/composeSystemPublishedConversationRuntime";
import type { PublishedConversationRuntimeControllerPort } from "../../../../modules/hosts/desktop/composition/desktopPublishedSystemRuntimeLifecycle";

const DEFAULT_MAXIMUM_WINDOWS = 4;

export interface RuntimeBrowserWindowOptions {
  readonly width: number;
  readonly height: number;
  readonly minWidth: number;
  readonly minHeight: number;
  readonly show: boolean;
  readonly title: string;
  readonly autoHideMenuBar: boolean;
  readonly webPreferences: {
    readonly preload: string;
    readonly partition: string;
    readonly contextIsolation: true;
    readonly nodeIntegration: false;
    readonly sandbox: true;
    readonly webSecurity: true;
    readonly webviewTag: false;
    readonly allowRunningInsecureContent: false;
  };
}

interface RuntimeSessionLike {
  setPermissionRequestHandler(
    handler: (
      webContents: unknown,
      permission: string,
      callback: (allowed: boolean) => void,
    ) => void,
  ): void;
  setPermissionCheckHandler(handler: () => boolean): void;
  on(event: "will-download", listener: (event: PreventableEvent) => void): void;
  webRequest: {
    onHeadersReceived(
      listener: (
        details: { responseHeaders?: Record<string, string[]> },
        callback: (response: {
          responseHeaders: Record<string, string[]>;
        }) => void,
      ) => void,
    ): void;
  };
}

interface PreventableEvent {
  preventDefault(): void;
}

export interface RuntimeWebContentsLike {
  readonly mainFrame: unknown;
  readonly session: RuntimeSessionLike;
  isDestroyed(): boolean;
  on(
    event: "will-navigate" | "will-attach-webview",
    listener: (event: PreventableEvent) => void,
  ): void;
  setWindowOpenHandler(handler: () => { action: "deny" }): void;
}

export interface RuntimeBrowserWindowLike {
  readonly webContents: RuntimeWebContentsLike;
  loadURL(url: string): Promise<void>;
  show(): void;
  focus(): void;
  close(): void;
  isDestroyed(): boolean;
  on(event: "closed", listener: () => void): void;
}

export interface SystemRuntimeWindowManager {
  open(
    query: SystemPublishedConversationRuntimeQuery,
    controller: PublishedConversationRuntimeControllerPort,
    onWindowClosed: () => Promise<void>,
  ): Promise<void>;
  close(query: SystemPublishedConversationRuntimeQuery): Promise<void>;
  closeAll(): Promise<void>;
  resolveSession(
    event: unknown,
  ): SystemPublishedConversationRuntimeSession | undefined;
  getActiveWindowCount(): number;
}

interface RuntimeWindowRecord {
  readonly key: string;
  readonly window: RuntimeBrowserWindowLike;
  readonly session: SystemPublishedConversationRuntimeSession;
  readonly onWindowClosed: () => Promise<void>;
  disposed: boolean;
}

export function createSystemRuntimeWindowManager(options: {
  readonly entryUrl: string;
  readonly preloadPath: string;
  readonly createWindow: (
    options: RuntimeBrowserWindowOptions,
  ) => RuntimeBrowserWindowLike;
  readonly developmentMode?: boolean;
  readonly maximumWindows?: number;
  readonly nextPartitionId?: () => string;
}): SystemRuntimeWindowManager {
  const records = new Map<string, RuntimeWindowRecord>();
  const pending = new Map<string, Promise<void>>();
  const maximumWindows = options.maximumWindows ?? DEFAULT_MAXIMUM_WINDOWS;
  let partitionSequence = 0;
  const nextPartitionId =
    options.nextPartitionId ??
    (() => `${Date.now()}-${(partitionSequence += 1)}`);

  const dispose = async (
    record: RuntimeWindowRecord,
    closeWindow: boolean,
    stopBuild: boolean,
  ): Promise<void> => {
    if (record.disposed) return;
    record.disposed = true;
    records.delete(record.key);
    await record.session.close().catch(() => undefined);
    if (stopBuild) await record.onWindowClosed().catch(() => undefined);
    if (closeWindow && !record.window.isDestroyed()) record.window.close();
  };

  const manager: SystemRuntimeWindowManager = {
    async open(query, controller, onWindowClosed) {
      const key = runtimeWindowKey(query);
      const existing = records.get(key);
      if (existing && !existing.disposed && !existing.window.isDestroyed()) {
        existing.window.show();
        existing.window.focus();
        return;
      }
      const inFlight = pending.get(key);
      if (inFlight) return inFlight;
      if (records.size + pending.size >= maximumWindows) {
        throw safeWindowError(
          "system-runtime-window.limit",
          "Close another running system window before opening this one.",
        );
      }

      const opening = (async () => {
        const runtimeSession = await controller.open(query);
        const initial = await runtimeSession.read();
        if (!initial.ok) {
          await runtimeSession.close().catch(() => undefined);
          throw safeWindowError(
            "system-runtime-window.unavailable",
            "The published system window is unavailable.",
          );
        }
        const partitionId = nextPartitionId();
        if (!/^[A-Za-z0-9._-]{1,96}$/.test(partitionId)) {
          await runtimeSession.close().catch(() => undefined);
          throw safeWindowError(
            "system-runtime-window.partition-invalid",
            "The published system window is unavailable.",
          );
        }
        const runtimeWindow = options.createWindow({
          width: 960,
          height: 760,
          minWidth: 560,
          minHeight: 520,
          show: false,
          title: initial.value.title,
          autoHideMenuBar: true,
          webPreferences: {
            preload: options.preloadPath,
            partition: `system-runtime-${partitionId}`,
            contextIsolation: true,
            nodeIntegration: false,
            sandbox: true,
            webSecurity: true,
            webviewTag: false,
            allowRunningInsecureContent: false,
          },
        });
        const record: RuntimeWindowRecord = {
          key,
          window: runtimeWindow,
          session: runtimeSession,
          onWindowClosed,
          disposed: false,
        };
        configureRuntimeWindow(runtimeWindow, options.developmentMode === true);
        records.set(key, record);
        runtimeWindow.on("closed", () => {
          void dispose(record, false, true);
        });
        try {
          await runtimeWindow.loadURL(options.entryUrl);
          if (runtimeWindow.isDestroyed()) throw new Error("destroyed");
          runtimeWindow.show();
          runtimeWindow.focus();
        } catch {
          await dispose(record, true, false);
          throw safeWindowError(
            "system-runtime-window.load-failed",
            "The published system window could not be opened.",
          );
        }
      })();
      pending.set(key, opening);
      try {
        await opening;
      } finally {
        pending.delete(key);
      }
    },
    async close(query) {
      const key = runtimeWindowKey(query);
      await pending.get(key)?.catch(() => undefined);
      const record = records.get(key);
      if (record) await dispose(record, true, false);
    },
    async closeAll() {
      await Promise.allSettled([...pending.values()]);
      await Promise.all(
        [...records.values()].map((record) => dispose(record, true, false)),
      );
    },
    resolveSession(event) {
      const candidate = optionalEvent(event);
      if (!candidate) return undefined;
      for (const record of records.values()) {
        const webContents = record.window.webContents;
        if (
          !record.disposed &&
          !record.window.isDestroyed() &&
          !webContents.isDestroyed() &&
          candidate.sender === webContents &&
          candidate.senderFrame === webContents.mainFrame
        ) {
          return record.session;
        }
      }
      return undefined;
    },
    getActiveWindowCount: () => records.size,
  };
  return manager;
}

function configureRuntimeWindow(
  runtimeWindow: RuntimeBrowserWindowLike,
  developmentMode: boolean,
): void {
  runtimeWindow.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  runtimeWindow.webContents.on("will-navigate", (event) =>
    event.preventDefault(),
  );
  runtimeWindow.webContents.on("will-attach-webview", (event) =>
    event.preventDefault(),
  );
  const runtimeSession = runtimeWindow.webContents.session;
  runtimeSession.setPermissionRequestHandler(
    (_contents, _permission, callback) => callback(false),
  );
  runtimeSession.setPermissionCheckHandler(() => false);
  runtimeSession.on("will-download", (event) => event.preventDefault());
  const policy = developmentMode
    ? "default-src 'self'; script-src 'self' 'unsafe-eval'; style-src 'self' 'unsafe-inline'; connect-src 'self' ws:; img-src 'self' data:; object-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'"
    : "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; connect-src 'none'; img-src 'self' data:; object-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'";
  runtimeSession.webRequest.onHeadersReceived((details, callback) => {
    callback({
      responseHeaders: {
        ...(details.responseHeaders ?? {}),
        "Content-Security-Policy": [policy],
      },
    });
  });
}

function runtimeWindowKey(
  query: SystemPublishedConversationRuntimeQuery,
): string {
  return `${query.organizationId}\u0000${query.workspaceId}\u0000${query.releaseId}`;
}

function optionalEvent(
  value: unknown,
): { sender?: unknown; senderFrame?: unknown } | undefined {
  return value && typeof value === "object"
    ? (value as { sender?: unknown; senderFrame?: unknown })
    : undefined;
}

function safeWindowError(
  code: string,
  message: string,
): Error & { code: string } {
  const error = new Error(message) as Error & { code: string };
  error.name = "SystemRuntimeWindowError";
  error.code = code;
  error.stack = undefined;
  return error;
}
