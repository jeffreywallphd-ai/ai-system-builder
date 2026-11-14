import type { BaseWindow, Menu, MenuItem, MenuItemConstructorOptions } from "electron";

export const DESKTOP_NEW_WINDOW_MENU_ID = "desktop-new-window";

export function installDesktopMainWindowMenu(
  menu: Menu | null,
  createItem: (options: MenuItemConstructorOptions) => MenuItem,
  mayOpen: (source: BaseWindow | undefined) => boolean,
  openWindow: () => void,
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
  file.insert(1, createItem({ type: "separator" }));
  return true;
}
