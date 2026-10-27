import path from "node:path";
import { pathToFileURL } from "node:url";

import { app, BrowserWindow, dialog, ipcMain, shell } from "electron";

import { composeDesktopHost } from "../../../../modules/hosts/desktop";
import { recordDesktopMemorySnapshot } from "../../../../modules/hosts/desktop/diagnostics";
import {
  resolveLocalSqliteDatabasePolicy,
  openLocalSqliteDatabase,
} from "../../../../modules/adapters/persistence/sqlite";
import { importJsonStructuredData } from "../../../../modules/adapters/persistence/migration";
import {
  initializeLocalIdentityProfile,
  readLocalIdentityProfile,
} from "../../../../modules/adapters/security/local-identity";
import { isTrustedIpcSender } from "./trustedIpcSender";
import { createRevealModelPath } from "./revealModelPath";
import {
  createSystemRuntimeWindowManager,
  type RuntimeBrowserWindowLike,
} from "./systemRuntimeWindowManager";
import { registerSystemRuntimeConversationIpc } from "../../../../modules/adapters/transport/ipc-electron/system-runtime-conversation";
import { shutdownDesktopRuntimeResources } from "./shutdownDesktopRuntimeResources";

recordDesktopMemorySnapshot({
  milestone: "desktop.main.module.loaded",
  component: "desktop-main",
});

const openWindows = new Set<BrowserWindow>();

async function createMainWindow(): Promise<void> {
  recordDesktopMemorySnapshot({
    milestone: "desktop.window.create.before",
    component: "desktop-main",
  });

  const mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    show: false,
    backgroundColor: "#06101e",
    webPreferences: {
      preload: path.join(__dirname, "main_window_preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  recordDesktopMemorySnapshot({
    milestone: "desktop.window.constructed",
    component: "desktop-main",
  });
  openWindows.add(mainWindow);
  mainWindow.on("closed", () => { openWindows.delete(mainWindow); });

  let hasBeenShown = false;
  let visibleCueAttempt = 0;
  let visibleCueFailed = false;
  function notifyVisibleDocument() {
    if (visibleCueFailed || mainWindow.isDestroyed() || mainWindow.webContents.isDestroyed()) return;
    const attempt = ++visibleCueAttempt;
    // A fixed, one-way presentation cue. No data, Node API, IPC capability or
    // caller-controlled script crosses into the renderer. The attribute replays
    // a cue received before its tiny controller; the event covers later arrival.
    void Promise.resolve().then(() => {
      if (mainWindow.isDestroyed() || mainWindow.webContents.isDestroyed()) return;
      return mainWindow.webContents.executeJavaScript(
        'document.documentElement.dataset.desktopWindowShown = "true"; document.dispatchEvent(new Event("desktop-window-shown"));',
      );
    }).catch(() => {
      // Superseded, closing or navigating documents have a later load cue. A
      // live current document must not keep its ready shell inert indefinitely.
      if (visibleCueFailed || attempt !== visibleCueAttempt || mainWindow.isDestroyed() ||
          mainWindow.webContents.isDestroyed() || mainWindow.webContents.isLoadingMainFrame()) return;
      visibleCueFailed = true;
      dialog.showErrorBox(
        "AI System Builder could not open",
        "The desktop loading screen could not finish. Close the app and start it again.",
      );
      if (!mainWindow.isDestroyed()) mainWindow.destroy();
    });
  }
  mainWindow.on("show", () => { hasBeenShown = true; notifyVisibleDocument(); });
  mainWindow.webContents.on("did-finish-load", () => {
    // Reload creates a new document without a new native show event. Replay even
    // while minimized; the controller counts only later visible paint/time.
    if (hasBeenShown) notifyVisibleDocument();
  });

  recordDesktopMemorySnapshot({
    milestone: "desktop.window.load.before",
    component: "desktop-main",
  });
  const outcome = await new Promise<"ready" | "closed" | "failed">((resolve) => {
    let settled = false;
    let loaded = false;
    let painted = false;
    const finish = (value: "ready" | "closed" | "failed") => {
      if (settled) return;
      settled = true;
      clearTimeout(deadline);
      mainWindow.removeListener("ready-to-show", onPaint);
      mainWindow.removeListener("closed", onClosed);
      mainWindow.webContents.removeListener("preload-error", onFailure);
      mainWindow.webContents.removeListener("render-process-gone", onFailure);
      resolve(value);
    };
    const check = () => { if (loaded && painted) finish("ready"); };
    const onPaint = () => { painted = true; check(); };
    const onClosed = () => finish("closed");
    const onFailure = () => finish("failed");
    // This bounds a hidden, unpainted native window only. It does not change
    // any app, model or runtime execution budget, nor mark slow React failed.
    const deadline = setTimeout(onFailure, 60_000);
    mainWindow.once("ready-to-show", onPaint);
    mainWindow.once("closed", onClosed);
    mainWindow.webContents.once("preload-error", onFailure);
    mainWindow.webContents.once("render-process-gone", onFailure);
    // Attach success/failure handlers immediately, including synchronous throws.
    void Promise.resolve().then(() => mainWindow.loadURL(
      MAIN_WINDOW_VITE_DEV_SERVER_URL ??
        pathToFileURL(path.join(__dirname, `../renderer/${MAIN_WINDOW_VITE_NAME}/index.html`)).href,
    )).then(() => { loaded = true; check(); }, onFailure);
  });
  if (outcome !== "ready" || mainWindow.isDestroyed()) {
    if (outcome === "failed") dialog.showErrorBox(
      "AI System Builder could not open",
      "The desktop loading screen could not open. Close the app and start it again.",
    );
    // Keep the hidden window alive while the fixed dialog is shown. Destroying
    // the last window first can trigger app quit before the message is visible.
    if (!mainWindow.isDestroyed()) mainWindow.destroy();
    return;
  }
  recordDesktopMemorySnapshot({
    milestone: "desktop.window.load.after",
    component: "desktop-main",
  });
  recordDesktopMemorySnapshot({
    milestone: "desktop.window.show.before",
    component: "desktop-main",
  });
  // Electron maximize also reveals hidden windows. Both calls belong AFTER the
  // successful document-load + first-paint gate, never at construction time.
  mainWindow.maximize();
  mainWindow.show();
  recordDesktopMemorySnapshot({
    milestone: "desktop.window.show.after",
    component: "desktop-main",
  });
}

recordDesktopMemorySnapshot({
  milestone: "desktop.app.whenReady.enter",
  component: "desktop-main",
});

app.whenReady().then(async () => {
  recordDesktopMemorySnapshot({
    milestone: "desktop.app.whenReady.ready",
    component: "desktop-main",
  });

  const desktopDataRootDirectory = app.getPath("userData");
  const storageRootDirectory = path.join(desktopDataRootDirectory, "artifacts");
  const sqlitePolicy = resolveLocalSqliteDatabasePolicy({
    dataRootDirectory: desktopDataRootDirectory,
  });
  const sqliteDatabase = await openLocalSqliteDatabase({
    policy: sqlitePolicy,
  });
  try {
    await importJsonStructuredData({
      sourceRootDirectory: storageRootDirectory,
      rollbackRootDirectory: path.join(
        sqlitePolicy.persistenceRootDirectory,
        "json-rollback",
      ),
      documents: sqliteDatabase.documents,
    });
  } catch (error) {
    sqliteDatabase.close();
    throw error;
  }
  let localIdentityProfile = await readLocalIdentityProfile(
    sqliteDatabase.documents,
  );
  if (!localIdentityProfile) {
    const setup = await dialog.showMessageBox({
      type: "question",
      title: "Set up local identity",
      message:
        "Create a private local organization and owner profile for this installation?",
      detail:
        "Identifiers are generated and stored only in the local SQLite database. Existing legacy data is not assigned automatically.",
      buttons: ["Create local profile", "Quit"],
      defaultId: 0,
      cancelId: 1,
      noLink: true,
    });
    if (setup.response !== 0) {
      sqliteDatabase.close();
      app.quit();
      return;
    }
    localIdentityProfile = await initializeLocalIdentityProfile({
      documents: sqliteDatabase.documents,
      organizationDisplayName: "Local Organization",
      principalDisplayName: "Local Owner",
    });
  }
  const organizationDocuments = sqliteDatabase.documents.forOrganization(
    localIdentityProfile.organizationId,
  );
  recordDesktopMemorySnapshot({
    milestone: "desktop.paths.resolved",
    component: "desktop-main",
    detail: {
      hasUserDataPath: Boolean(desktopDataRootDirectory),
      hasStorageRoot: Boolean(storageRootDirectory),
    },
  });

  recordDesktopMemorySnapshot({
    milestone: "desktop.host.compose.before",
    component: "desktop-main",
  });
  const desktopHost = composeDesktopHost({
    localIdentity: localIdentityProfile,
    persistence: { documents: sqliteDatabase.documents, organizationDocuments },
    runtimeDataRootDirectory: desktopDataRootDirectory,
    logging: {
      verbosity: process.env.LOG_VERBOSITY,
      level: "info",
    },
    artifactRepo: {
      huggingFaceAccessToken:
        process.env.HF_TOKEN ?? process.env.HUGGING_FACE_TOKEN,
      huggingFaceTokenConfigFilePath: path.join(
        storageRootDirectory,
        "config",
        "hugging-face-token.json",
      ),
    },
    folderPicker: {
      async selectFolder(options) {
        const result = await dialog.showOpenDialog({
          title: options?.title,
          defaultPath: options?.defaultPath,
          properties: ["openDirectory", "createDirectory"],
        });
        return { canceled: result.canceled, path: result.filePaths[0] };
      },
    },
  });
  recordDesktopMemorySnapshot({
    milestone: "desktop.host.compose.after",
    component: "desktop-main",
  });

  const systemRuntimeWindows = createSystemRuntimeWindowManager({
    entryUrl: SYSTEM_RUNTIME_VITE_DEV_SERVER_URL ??
      pathToFileURL(path.join(__dirname, `../renderer/${SYSTEM_RUNTIME_VITE_NAME}/index.html`)).href,
    preloadPath: path.join(__dirname, "system_runtime_preload.cjs"),
    developmentMode: !app.isPackaged,
    createWindow: (windowOptions) =>
      new BrowserWindow(windowOptions) as unknown as RuntimeBrowserWindowLike,
  });
  registerSystemRuntimeConversationIpc({
    ipcMain,
    resolveSession: (event) => systemRuntimeWindows.resolveSession(event),
  });

  recordDesktopMemorySnapshot({
    milestone: "desktop.ipc.register.before",
    component: "desktop-main",
  });
  desktopHost.registerDesktopIpc({
    ipcMain,
    senderTrust: {
      isTrustedSender: (event) => isTrustedIpcSender(event, openWindows),
    },
    storageRootDirectory,
    runtimeRootDirectory: desktopDataRootDirectory,
    systemRuntimeWindows,
    revealModelPath: createRevealModelPath(shell),
  });
  recordDesktopMemorySnapshot({
    milestone: "desktop.ipc.register.after",
    component: "desktop-main",
  });

  await createMainWindow();

  app.on("activate", async () => {
    if (openWindows.size === 0) {
      recordDesktopMemorySnapshot({
        milestone: "desktop.activate.window-create.before",
        component: "desktop-main",
      });
      await createMainWindow();
      recordDesktopMemorySnapshot({
        milestone: "desktop.activate.window-create.after",
        component: "desktop-main",
      });
    }
  });

  let shutdownStarted = false;
  let shutdownComplete = false;
  app.on("before-quit", (event) => {
    recordDesktopMemorySnapshot({
      milestone: "desktop.before-quit",
      component: "desktop-main",
    });
    if (shutdownComplete) return;
    event.preventDefault();
    if (shutdownStarted) return;
    shutdownStarted = true;
    void shutdownDesktopRuntimeResources({
      closeRuntimeWindows: () => systemRuntimeWindows.closeAll(),
      shutdownBackgroundTasks: () => desktopHost.shutdownBackgroundTasks(),
      stopPythonRuntime: () => desktopHost.stopPythonRuntime(),
      closeRuntimeDatabases: () =>
        desktopHost.systemRuntimeDatabases?.closeAll() ?? Promise.resolve(),
      closePlatformDatabase: () => sqliteDatabase.close(),
    }).then(() => {
      shutdownComplete = true;
      app.quit();
    }).catch(() => {
      shutdownStarted = false;
      console.warn("Background shutdown remains pending; closing can be retried.");
    });
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});
