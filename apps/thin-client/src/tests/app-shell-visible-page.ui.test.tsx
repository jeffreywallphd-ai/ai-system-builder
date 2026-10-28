// @vitest-environment jsdom
import { renderToString } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";

vi.mock("../../../../modules/ui/shared/assets/branding/logo.svg", () => ({
  default: "logo.svg",
}));
vi.mock(
  "../../../../modules/ui/shared/assets/illustrations/data-orbit.svg",
  () => ({ default: "data-orbit.svg" }),
);
vi.mock(
  "../../../../modules/ui/shared/assets/illustrations/module-network.svg",
  () => ({ default: "module-network.svg" }),
);
vi.mock(
  "../../../../modules/ui/shared/assets/illustrations/assets-orbit.png",
  () => ({ default: "assets-orbit.png" }),
);
vi.mock(
  "../../../../modules/ui/shared/assets/illustrations/library-orbit.png",
  () => ({ default: "library-orbit.png" }),
);
vi.mock(
  "../../../../modules/ui/shared/assets/illustrations/models-orbit.png",
  () => ({ default: "models-orbit.png" }),
);
vi.mock(
  "../../../../modules/ui/shared/assets/illustrations/image-generation-orbit.png",
  () => ({ default: "image-generation-orbit.png" }),
);
vi.mock(
  "../../../../modules/ui/shared/assets/illustrations/settings-orbit.png",
  () => ({ default: "settings-orbit.png" }),
);
vi.mock(
  "../../../../modules/ui/shared/assets/illustrations/security-orbit.png",
  () => ({ default: "security-orbit.png" }),
);
vi.mock("../features/workspace", () => ({
  WorkspaceSwitcher: () => <section>Workspace switcher</section>,
}));

import { AppShell } from "../components/layout/AppShell";
import { thinClientPageDefinitions } from "../routes/thinClientPages";
import { NotificationProvider } from "../../../../modules/ui/shared/notifications";

(globalThis as typeof globalThis & {IS_REACT_ACT_ENVIRONMENT?:boolean}).IS_REACT_ACT_ENVIRONMENT=true;
const mounted: {root:Root;host:HTMLDivElement}[]=[];
afterEach(()=>{for(const {root,host} of mounted.splice(0)){act(()=>root.unmount());host.remove();}vi.restoreAllMocks();});
const key=(element:HTMLElement,value:string)=>act(()=>{element.dispatchEvent(new KeyboardEvent("keydown",{key:value,bubbles:true,cancelable:true}));});
function mountedMenu() {
  const onNavigate=vi.fn();
  const host=document.createElement("div");document.body.append(host);const root=createRoot(host);mounted.push({root,host});
  act(()=>root.render(<NotificationProvider><AppShell activePage="models" pages={thinClientPageDefinitions} onNavigate={onNavigate}><button>Outside content</button></AppShell></NotificationProvider>));
  const trigger=host.querySelector<HTMLElement>('[aria-label="Open navigation menu"]')!;
  const details=trigger.closest("details")!;
  const menu=details.querySelector<HTMLElement>('[role="menu"]')!;
  const item=(label:string)=>{const result=Array.from(menu.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')).find(el=>el.textContent?.trim()===label);if(!result)throw Error("Expected declared navigation item.");return result;};
  return {host,onNavigate,trigger,details,menu,item};
}
describe("mounted shell navigation menu keyboard behavior",()=>{
  it("opens from the trigger and moves to the first item by keyboard",()=>{
    const {trigger,menu,item}=mountedMenu();trigger.focus();key(trigger,"ArrowDown");
    expect(trigger.getAttribute("aria-expanded")).toBe("true");expect(trigger.getAttribute("aria-haspopup")).toBe("menu");
    expect(menu.getAttribute("aria-label")).toBe("Application navigation");
    expect(document.activeElement).toBe(item("Home"));
  });
  it("closes on Escape and returns focus from a menu item",()=>{
    const {trigger,details,item}=mountedMenu();act(()=>{details.open=true;});
    const home=item("Home");home.focus();key(home,"Escape");
    expect(details.open).toBe(false);expect(document.activeElement).toBe(trigger);
  });
  it("wraps arrows and supports Home End and a label key without changing the current page",()=>{
    const {trigger,menu,item,onNavigate}=mountedMenu();key(trigger,"Enter");
    const entries=Array.from(menu.querySelectorAll<HTMLButtonElement>('[role="menuitem"]'));
    expect(item("Models").getAttribute("aria-current")).toBe("page");expect(menu.querySelectorAll('[aria-current="page"]')).toHaveLength(1);
    key(item("Home"),"ArrowDown");expect(document.activeElement).toBe(item("Systems"));
    key(item("Systems"),"ArrowUp");expect(document.activeElement).toBe(item("Home"));
    key(item("Home"),"ArrowUp");expect(document.activeElement).toBe(entries[entries.length-1]);
    key(entries[entries.length-1]!,"Home");expect(document.activeElement).toBe(item("Home"));
    key(item("Home"),"End");expect(document.activeElement).toBe(entries[entries.length-1]);
    key(entries[entries.length-1]!,"Home");key(item("Home"),"M");expect(document.activeElement).toBe(item("Models"));expect(onNavigate).not.toHaveBeenCalled();
  });
  it("opens at the last enabled item with Arrow Up and toggles from the trigger with Space",()=>{
    const {trigger,menu,details}=mountedMenu();key(trigger,"ArrowUp");
    expect(document.activeElement).toBe(menu.querySelectorAll('[role="menuitem"]').item(menu.querySelectorAll('[role="menuitem"]').length-1));
    trigger.focus();key(trigger," ");expect(details.open).toBe(false);expect(document.activeElement).toBe(trigger);
    key(trigger," ");expect(details.open).toBe(true);expect(document.activeElement?.textContent).toBe("Home");
  });
  it.each([false,true])("closes on Tab without canceling native traversal (shift %s)",shiftKey=>{
    const {trigger,details,item}=mountedMenu();key(trigger,"Enter");item("Models").focus();
    const event=new KeyboardEvent("keydown",{key:"Tab",shiftKey,bubbles:true,cancelable:true});act(()=>{item("Models").dispatchEvent(event);});
    expect(event.defaultPrevented).toBe(false);expect(details.open).toBe(false);expect(document.activeElement).toBe(trigger);
  });
  it("activates exactly the selected route once and returns focus",()=>{
    const {trigger,details,item,onNavigate}=mountedMenu();key(trigger,"Enter");act(()=>item("Models").click());
    expect(onNavigate.mock.calls).toEqual([["models"]]);expect(details.open).toBe(false);expect(trigger.getAttribute("aria-expanded")).toBe("false");expect(document.activeElement).toBe(trigger);
  });
  it.each(["Enter"," "])("retains the native %s default-action contract without premature navigation",value=>{
    const {trigger,details,item,onNavigate}=mountedMenu();key(trigger,"Enter");item("Models").focus();
    const event=new KeyboardEvent("keydown",{key:value,bubbles:true,cancelable:true});act(()=>{item("Models").dispatchEvent(event);});
    expect(event.defaultPrevented).toBe(false);expect(onNavigate).not.toHaveBeenCalled();
    // JSDOM does not synthesize the browser's keyboard click default action.
    act(()=>item("Models").click());expect(onNavigate.mock.calls).toEqual([["models"]]);expect(details.open).toBe(false);expect(document.activeElement).toBe(trigger);
  });
  it.each(["mousedown","touchstart"])("outside %s closes without taking focus or navigating",eventName=>{
    const {host,trigger,details,onNavigate}=mountedMenu();key(trigger,"Enter");const outside=Array.from(host.querySelectorAll("button")).find(el=>el.textContent==="Outside content")!;outside.focus();
    act(()=>{outside.dispatchEvent(new Event(eventName,{bubbles:true}));});expect(details.open).toBe(false);expect(document.activeElement).toBe(outside);expect(onNavigate).not.toHaveBeenCalled();
  });
  it("removes owned document dismissal listeners on unmount",()=>{
    const add=vi.spyOn(document,"addEventListener"),remove=vi.spyOn(document,"removeEventListener");mountedMenu();
    // This mounted shell owns navigation and Notification Center listener pairs.
    const listeners=add.mock.calls.filter(([name])=>name==="mousedown"||name==="touchstart");expect(listeners).toHaveLength(4);
    const owned=mounted.pop()!;act(()=>owned.root.unmount());owned.host.remove();
    for(const [name,callback] of listeners)expect(remove.mock.calls.some(([removed,fn])=>removed===name&&fn===callback)).toBe(true);
  });
});

describe("thin-client AppShell visible workspace page state", () => {
  it("does not mark a pending workspace-required route active while setup is visible", () => {
    const html = renderToString(
      <NotificationProvider>
        <AppShell
          activePage={undefined}
          pages={thinClientPageDefinitions}
          onNavigate={() => undefined}
        >
          <section>Workspace required</section>
        </AppShell>
      </NotificationProvider>,
    );

    expect(html).toContain("Workspace required");
    expect(html).toContain("Models");
    expect(html).toContain("Application areas");
    expect(html).toContain("Build");
    expect(html).toContain("Manage");
    expect(html).toContain('aria-expanded="true"');
    expect(html).toContain("ui-app-icon");
    expect(html).toContain("Collapse sidebar");
    expect(html).toContain('id="application-notification-bell"');
    expect(html.indexOf('id="application-notification-bell"') < html.indexOf('aria-label="Settings"')).toBe(true);
    expect(html).not.toContain('aria-current="page"');
  });
});
