import type { BaseWindow, Menu, MenuItem, MenuItemConstructorOptions } from "electron";

export const DESKTOP_NEW_WINDOW_MENU_ID = "desktop-new-window";
export const DESKTOP_DISABLE_TAKEOVER_MENU_ID = "desktop-disable-takeover";

export function installDesktopMainWindowMenu(
  menu: Menu | null,
  createItem: (options: MenuItemConstructorOptions) => MenuItem,
  mayOpen: (source: BaseWindow | undefined) => boolean,
  openWindow: () => void,
  stopTakeover?: { readonly mayStop: (source: BaseWindow | undefined) => boolean; readonly stop: () => void },
) {
  const file = menu?.items.find(item => item.role?.toLowerCase() === "filemenu" ||
    item.label.replaceAll("&", "") === "File")?.submenu;
  if (!file || file.getMenuItemById(DESKTOP_NEW_WINDOW_MENU_ID)) return false;
  file.insert(0, createItem({
    id: DESKTOP_NEW_WINDOW_MENU_ID,
    label: "New Window",
    accelerator: "CommandOrControl+Shift+N",
    click: (_item, source) => { if (mayOpen(source)) openWindow(); },
  }));
  if (stopTakeover) file.insert(1, createItem({
    id: DESKTOP_DISABLE_TAKEOVER_MENU_ID,
    label: "Turn Off Window Takeover for This Session",
    click: (item, source) => {
      if (!item.enabled || !stopTakeover.mayStop(source)) return;
      item.enabled = false;
      stopTakeover.stop();
    },
  }));
  file.insert(stopTakeover ? 2 : 1, createItem({ type: "separator" }));
  return true;
}
