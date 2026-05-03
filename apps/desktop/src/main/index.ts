import path from "node:path";

import { app, BrowserWindow, ipcMain } from "electron";

import { composeDesktopHost } from "../../../../modules/hosts/desktop";

const openWindows = new Set<BrowserWindow>();

async function createMainWindow(): Promise<void> {
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

  openWindows.add(mainWindow);

  mainWindow.on("closed", () => {
    openWindows.delete(mainWindow);
  });

  mainWindow.maximize();
  await mainWindow.loadURL(MAIN_WINDOW_WEBPACK_ENTRY);
  mainWindow.show();
}

app.whenReady().then(async () => {
  const desktopDataRootDirectory = app.getPath("userData");
  const storageRootDirectory = path.join(desktopDataRootDirectory, "artifacts");
  const desktopHost = composeDesktopHost({
    logging: {
      verbosity: process.env.LOG_VERBOSITY,
      level: "info",
    },
    artifactRepo: {
      huggingFaceAccessToken: process.env.HF_TOKEN ?? process.env.HUGGING_FACE_TOKEN,
      huggingFaceTokenConfigFilePath: path.join(storageRootDirectory, "config", "hugging-face-token.json"),
    },
  });

  desktopHost.registerArtifactUploadIpc({
    ipcMain,
    storageRootDirectory,
    runtimeRootDirectory: desktopDataRootDirectory,
  });

  await createMainWindow();

  app.on("activate", async () => {
    if (openWindows.size === 0) {
      await createMainWindow();
    }
  });

  app.on("before-quit", () => {
    void desktopHost.stopPythonRuntime();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});
