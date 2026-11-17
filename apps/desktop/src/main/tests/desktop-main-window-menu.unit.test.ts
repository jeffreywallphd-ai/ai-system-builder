import assert from "node:assert/strict";
import { test } from "node:test";
import type { BaseWindow, Menu, MenuItem, MenuItemConstructorOptions } from "electron";
import { DESKTOP_DISABLE_TAKEOVER_MENU_ID, DESKTOP_NEW_WINDOW_MENU_ID, installDesktopMainWindowMenu } from "../desktopMainWindowMenu";

test("adds one native action while retaining the existing File menu items", () => {
  const existing = { role: "quit" };
  const items: Array<MenuItemConstructorOptions> = [existing];
  const file = {
    getMenuItemById: (id: string) => items.find(item => item.id === id),
    insert(index: number, item: MenuItemConstructorOptions) { items.splice(index, 0, item); },
  };
  const menu = { items: [{ label: "&File", submenu: file }, { label: "Edit" }] } as unknown as Menu;
  const owner = {} as BaseWindow;
  const runtime = {} as BaseWindow;
  const create = (options: MenuItemConstructorOptions) => options as MenuItem;
  let opened = 0;
  const mayOpen = (source: BaseWindow | undefined) => source === owner && opened === 0;
  const open = () => { opened++; };
  assert.equal(installDesktopMainWindowMenu(menu, create, mayOpen, open), true);
  assert.equal(installDesktopMainWindowMenu(menu, create, mayOpen, open), false);
  assert.equal(installDesktopMainWindowMenu(null, create, mayOpen, open), false);
  assert.deepEqual(items.map(item => item.id ?? item.type ?? item.role), [DESKTOP_NEW_WINDOW_MENU_ID, "separator", "quit"]);
  const action = items[0]!;
  const event = {} as Parameters<NonNullable<MenuItemConstructorOptions["click"]>>[2];
  action.click?.(action as MenuItem, runtime, event);
  action.click?.(action as MenuItem, undefined, event);
  assert.equal(opened, 0);
  action.click?.(action as MenuItem, owner, event);
  action.click?.(action as MenuItem, owner, event);
  assert.equal(opened, 1);
});

test("the native menu stops presentation once and only for an admitted owner", () => {
  const items: MenuItemConstructorOptions[] = [];
  const file = { getMenuItemById: (id: string) => items.find(item => item.id === id),
    insert(index: number, item: MenuItemConstructorOptions) { items.splice(index, 0, item); } };
  const menu = { items: [{ label: "File", submenu: file }] } as unknown as Menu;
  const owner = {} as BaseWindow;
  let stopped = 0;
  installDesktopMainWindowMenu(menu, options => ({ enabled: true, ...options }) as MenuItem, () => false, () => {}, {
    mayStop: source => source === owner, stop: () => { stopped++; },
  });
  const action = items.find(item => item.id === DESKTOP_DISABLE_TAKEOVER_MENU_ID)!;
  const event = {} as Parameters<NonNullable<MenuItemConstructorOptions["click"]>>[2];
  action.click?.(action as MenuItem, {} as BaseWindow, event);
  assert.equal(stopped, 0);
  action.click?.(action as MenuItem, owner, event);
  action.click?.(action as MenuItem, owner, event);
  assert.equal(stopped, 1);
  assert.equal(action.enabled, false);
});
