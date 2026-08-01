import assert from "node:assert/strict";
import test from "node:test";

import { createOrganizationId } from "../../../../../modules/contracts/organization";
import { normalizeSystemReleaseId } from "../../../../../modules/contracts/system-build";
import { SYSTEM_RUNTIME_CONVERSATION_MAX_INPUT_CHARACTERS } from "../../../../../modules/contracts/system-deployment";
import { createWorkspaceId } from "../../../../../modules/contracts/workspace";
import {
  createSystemRuntimeWindowManager,
  type RuntimeBrowserWindowLike,
  type RuntimeBrowserWindowOptions,
} from "../systemRuntimeWindowManager";

const query = {
  organizationId: createOrganizationId("org-runtime-window"),
  workspaceId: createWorkspaceId("workspace-runtime-window"),
  releaseId: normalizeSystemReleaseId("release-runtime-window"),
};

function fixture(maximumWindows = 4) {
  const windows: FakeWindow[] = [];
  let closedSessions = 0;
  let stoppedBuilds = 0;
  const session = {
    async read() {
      return {
        ok: true as const,
        value: {
          schemaVersion: "1.0" as const,
          title: "Controlled chatbot",
          state: "ready" as const,
          messages: [],
          maxInputCharacters: SYSTEM_RUNTIME_CONVERSATION_MAX_INPUT_CHARACTERS,
          canSubmit: true,
        },
      };
    },
    async submit() {
      return this.read();
    },
    async close() {
      closedSessions += 1;
    },
  };
  const manager = createSystemRuntimeWindowManager({
    entryUrl: "file:///runtime/index.html",
    preloadPath: "runtime-preload.js",
    createWindow(options) {
      const window = new FakeWindow(options);
      windows.push(window);
      return window;
    },
    maximumWindows,
    nextPartitionId: () => `fixture-${windows.length + 1}`,
  });
  return {
    manager,
    windows,
    controller: {
      async open() {
        return session;
      },
    },
    onWindowClosed: async () => {
      stoppedBuilds += 1;
    },
    closedSessions: () => closedSessions,
    stoppedBuilds: () => stoppedBuilds,
  };
}

test("creates one hardened non-persistent window and reuses it by exact release", async () => {
  const root = fixture();
  await root.manager.open(query, root.controller, root.onWindowClosed);
  const window = root.windows[0]!;
  assert.equal(root.manager.getActiveWindowCount(), 1);
  assert.equal(
    window.options.webPreferences.partition.startsWith("persist:"),
    false,
  );
  assert.deepEqual(
    {
      contextIsolation: window.options.webPreferences.contextIsolation,
      nodeIntegration: window.options.webPreferences.nodeIntegration,
      sandbox: window.options.webPreferences.sandbox,
      webSecurity: window.options.webPreferences.webSecurity,
      webviewTag: window.options.webPreferences.webviewTag,
      allowRunningInsecureContent:
        window.options.webPreferences.allowRunningInsecureContent,
    },
    {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      webviewTag: false,
      allowRunningInsecureContent: false,
    },
  );
  assert.equal(window.permissionAllowed(), false);
  assert.equal(window.permissionChecked(), false);
  assert.equal(window.windowOpenAction(), "deny");
  assert.equal(
    window.contentSecurityPolicy().includes("connect-src 'none'"),
    true,
  );
  assert.equal(window.contentSecurityPolicy().includes("unsafe-eval"), false);

  const event = {
    sender: window.webContents,
    senderFrame: window.webContents.mainFrame,
  };
  assert.ok(root.manager.resolveSession(event));
  assert.equal(
    root.manager.resolveSession({ ...event, senderFrame: {} }),
    undefined,
  );
  await root.manager.open(query, root.controller, root.onWindowClosed);
  assert.equal(root.windows.length, 1);
  assert.equal(window.focusCount, 2);
});

test("bounds active windows and closes the exact runtime session", async () => {
  const root = fixture(1);
  await root.manager.open(query, root.controller, root.onWindowClosed);
  await assert.rejects(
    () =>
      root.manager.open(
        { ...query, releaseId: normalizeSystemReleaseId("release-second") },
        root.controller,
        root.onWindowClosed,
      ),
    (error: unknown) =>
      (error as { code?: string }).code === "system-runtime-window.limit",
  );
  await root.manager.close(query);
  assert.equal(root.manager.getActiveWindowCount(), 0);
  assert.equal(root.closedSessions(), 1);
  assert.equal(root.stoppedBuilds(), 0);
  assert.equal(root.windows[0]?.closed, true);
});

test("closing the published system window stops its exact running build", async () => {
  const root = fixture();
  await root.manager.open(query, root.controller, root.onWindowClosed);

  root.windows[0]?.close();
  await new Promise<void>((resolve) => setImmediate(resolve));

  assert.equal(root.manager.getActiveWindowCount(), 0);
  assert.equal(root.closedSessions(), 1);
  assert.equal(root.stoppedBuilds(), 1);
});

class FakeWindow implements RuntimeBrowserWindowLike {
  readonly listeners = new Map<string, () => void>();
  readonly webContents: RuntimeBrowserWindowLike["webContents"];
  focusCount = 0;
  closed = false;
  private permissionRequest?: (
    contents: unknown,
    permission: string,
    callback: (allowed: boolean) => void,
  ) => void;
  private permissionCheck?: () => boolean;
  private windowOpen?: () => { action: "deny" };
  private headers?: (
    details: { responseHeaders?: Record<string, string[]> },
    callback: (response: { responseHeaders: Record<string, string[]> }) => void,
  ) => void;

  constructor(readonly options: RuntimeBrowserWindowOptions) {
    const mainFrame = {};
    this.webContents = {
      mainFrame,
      isDestroyed: () => this.closed,
      on: () => undefined,
      setWindowOpenHandler: (handler) => {
        this.windowOpen = handler;
      },
      session: {
        setPermissionRequestHandler: (handler) => {
          this.permissionRequest = handler;
        },
        setPermissionCheckHandler: (handler) => {
          this.permissionCheck = handler;
        },
        on: () => undefined,
        webRequest: {
          onHeadersReceived: (handler) => {
            this.headers = handler;
          },
        },
      },
    };
  }
  async loadURL() {}
  show() {}
  focus() {
    this.focusCount += 1;
  }
  close() {
    this.closed = true;
    this.listeners.get("closed")?.();
  }
  isDestroyed() {
    return this.closed;
  }
  on(event: "closed", listener: () => void) {
    this.listeners.set(event, listener);
  }
  permissionAllowed() {
    let allowed = true;
    this.permissionRequest?.({}, "camera", (value) => {
      allowed = value;
    });
    return allowed;
  }
  permissionChecked() {
    return this.permissionCheck?.() ?? true;
  }
  windowOpenAction() {
    return this.windowOpen?.().action;
  }
  contentSecurityPolicy() {
    let policy = "";
    this.headers?.({}, (response) => {
      policy = response.responseHeaders["Content-Security-Policy"]?.[0] ?? "";
    });
    return policy;
  }
}
