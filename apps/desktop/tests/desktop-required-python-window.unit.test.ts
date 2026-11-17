import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { test } from "node:test";
import { runInNewContext } from "node:vm";
import { transform } from "esbuild";

test("the required Python failure document opens without the application's preload", async () => {
  const source = readFileSync(resolve("apps/desktop/src/main/index.ts"), "utf8").replaceAll("\r\n", "\n");
  const start = source.indexOf("async function createDesktopWindow(");
  const end = source.indexOf('\nrecordDesktopMemorySnapshot({\n  milestone: "desktop.app.whenReady.enter"', start);
  assert.ok(start >= 0 && end > start);
  const compiled = await transform(source.slice(start, end) + '\ncreateDesktopWindow("missing");', { loader: "ts" });

  let preferences: Record<string, unknown> | undefined;
  let loadedUrl: string | undefined;
  let shown = false;
  class LoadingWindow extends EventEmitter {
    webContents = new EventEmitter();
    constructor(options: { webPreferences: Record<string, unknown> }) {
      super();
      preferences = options.webPreferences;
    }
    isDestroyed() { return false; }
    async loadURL(url: string) {
      loadedUrl = url;
      this.emit("ready-to-show");
    }
    maximize() {}
    show() { shown = true; }
  }

  await runInNewContext(compiled.code, {
    BrowserWindow: LoadingWindow, URL, setTimeout, clearTimeout,
    MAIN_WINDOW_VITE_DEV_SERVER_URL: "http://127.0.0.1:3005",
    openWindows: new Set(), recordDesktopMemorySnapshot() {},
  });
  assert.ok(preferences);
  assert.equal(preferences.preload, undefined);
  assert.equal(preferences.contextIsolation, true);
  assert.equal(preferences.nodeIntegration, false);
  assert.equal(new URL(loadedUrl!).searchParams.get("required-python"), "missing");
  assert.ok(shown);
});
