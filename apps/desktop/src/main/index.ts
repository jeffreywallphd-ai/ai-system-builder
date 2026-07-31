import path from "node:path";

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
    webPreferences: {
      preload: MAIN_WINDOW_PRELOAD_WEBPACK_ENTRY,
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  recordDesktopMemorySnapshot({
    milestone: "desktop.window.constructed",
    component: "desktop-main",
  });

  openWindows.add(mainWindow);

  mainWindow.on("closed", () => {
    openWindows.delete(mainWindow);
  });

  mainWindow.maximize();
  recordDesktopMemorySnapshot({
    milestone: "desktop.window.load.before",
    component: "desktop-main",
  });
  await mainWindow.loadURL(MAIN_WINDOW_WEBPACK_ENTRY);
  recordDesktopMemorySnapshot({
    milestone: "desktop.window.load.after",
    component: "desktop-main",
  });
  recordDesktopMemorySnapshot({
    milestone: "desktop.window.show.before",
    component: "desktop-main",
  });
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
    entryUrl: SYSTEM_RUNTIME_WEBPACK_ENTRY,
    preloadPath: SYSTEM_RUNTIME_PRELOAD_WEBPACK_ENTRY,
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
      stopPythonRuntime: () => desktopHost.stopPythonRuntime(),
      closeRuntimeDatabases: () =>
        desktopHost.systemRuntimeDatabases?.closeAll() ?? Promise.resolve(),
      closePlatformDatabase: () => sqliteDatabase.close(),
    }).finally(() => {
      shutdownComplete = true;
      app.quit();
    });
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});
