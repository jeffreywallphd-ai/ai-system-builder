import type { ElectronApplication, JSHandle, Page } from "playwright";

interface OwnedWindow {
  isDestroyed(): boolean;
  unmaximize(): void;
  setBounds(value: { width: number; height: number }): void;
  webContents: {
    isDestroyed(): boolean;
    setZoomFactor(value: number): void;
    getZoomFactor(): unknown;
  };
}

/** Fixed test-owned Page/window only. This supplies no OS-wide window authority. */
export async function applyOwnedDesktopNativeZoom(app: ElectronApplication, page: Page): Promise<4> {
  let handle: JSHandle | undefined;
  const failures: Error[] = [];
  try {
    handle = await app.browserWindow(page);
    const factor: unknown = await handle.evaluate((window: OwnedWindow) => {
      if (window.isDestroyed() || window.webContents.isDestroyed()) throw new Error();
      window.unmaximize();
      window.setBounds({ width: 1440, height: 1000 });
      window.webContents.setZoomFactor(4);
      const observed = window.webContents.getZoomFactor();
      if (window.isDestroyed() || window.webContents.isDestroyed()) throw new Error();
      return observed;
    });
    if (typeof factor !== "number" || !Number.isFinite(factor) || Math.abs(factor - 4) >= 1e-8) throw new Error();
  } catch {
    failures.push(new Error("Native desktop zoom setup failed."));
  } finally {
    if (handle !== undefined) {
      try { await handle.dispose(); }
      catch { failures.push(new Error("Native desktop zoom handle retirement failed.")); }
    }
  }
  if (failures.length === 1) throw failures[0];
  if (failures.length) throw new AggregateError(failures, "Native desktop zoom setup and retirement failed.");
  return 4;
}
