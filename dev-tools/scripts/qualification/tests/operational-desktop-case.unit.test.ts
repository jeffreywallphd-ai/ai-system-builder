import {settingsHostLayout} from "../visual-composer/settings-host-launch-plan.mjs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const probe = vi.hoisted(() => ({ existing: false, physicalBase: undefined as string | undefined, statCalls: [] as string[], calls: [] as Array<{ executable: string; argvPrefix: string[]; script: string; dataRoot: string; large: string; runAsNode: string; timeout: number; windowsHide: boolean }> }));
vi.mock("node:fs", () => { const lstatSync = (value: string, options: { throwIfNoEntry: boolean }) => {
  if (options.throwIfNoEntry !== false) throw new Error("Unexpected fixture stat mode.");
  probe.statCalls.push(value); return probe.existing ? {} : undefined;
}; const realpathSync = (value: string) => probe.physicalBase ?? value; return { lstatSync, realpathSync, default: { lstatSync, realpathSync } }; });
// Capture only fixed safe facts; never retain/dump the full inherited environment.
vi.mock("node:child_process", () => { const spawnSync = (executable: string, argv: string[], options: { env: Record<string, string>; timeout: number; windowsHide: boolean }) => {
  const parts = argv[argv.length - 1]!.split(/[\\/]/);
  probe.calls.push({ executable, argvPrefix: argv.slice(0, -1), script: parts[parts.length - 1]!, dataRoot: options.env.VISUAL_COMPOSER_DESKTOP_DATA_ROOT, large: options.env.VISUAL_COMPOSER_LARGE_FIXTURE, runAsNode: options.env.ELECTRON_RUN_AS_NODE, timeout: options.timeout, windowsHide: options.windowsHide });
  return { status: 0 };
}; return { spawnSync, default: { spawnSync } }; });
import { prepareIsolatedDesktopCase } from "../visual-composer/e2e/isolated-desktop-case";
import { applyOwnedDesktopNativeZoom } from "../visual-composer/e2e/native-desktop-zoom";
import type { ElectronApplication, Page } from "playwright";
import {qualifyOperationalUiJourney} from "../visual-composer/e2e/operational-ui-journey";
vi.mock("../visual-composer/e2e/critical-surface-accessibility",()=>({qualifyCriticalSurfaceAccessibility:vi.fn(async()=>undefined)}));
// Only the unrelated earlier assertions are neutral in this navigation unit.
// The target locator and the real journey/reporting still execute below.
vi.mock("@playwright/test",()=>({expect:(target:{assert?:(method:string,value:unknown,negative:boolean)=>void})=>{
  const methods=["toHaveAttribute","toBeFocused","toBeVisible","toBeHidden","toHaveCount","toBeEnabled","toBeDisabled","toHaveValue","toHaveText","toContainText"];
  const checks=(negative:boolean)=>Object.fromEntries(methods.map(method=>[method,async(...args:unknown[])=>target.assert?.(method,args,negative)]));
  return {...checks(false),not:checks(true)};
}}));
const base = path.resolve("artifacts/qualification/visual-composer/d/operational-fixture");
beforeEach(() => { probe.calls.length = 0; probe.statCalls.length = 0; probe.existing = false; probe.physicalBase = undefined; vi.stubEnv("VISUAL_COMPOSER_DESKTOP_DATA_ROOT", base); vi.stubEnv("VISUAL_COMPOSER_ELECTRON_NODE_EXECUTABLE", "synthetic-electron-node"); });
afterEach(() => { vi.unstubAllEnvs(); });
describe("fixed operational desktop slot", () => {
  it("denies a redirected training base before identity seeding or any slot write", () => {
    probe.physicalBase = path.resolve(".local-codex/foreign-run");
    expect(() => prepareIsolatedDesktopCase("training")).toThrow("Training qualification requires its existing physical run root.");
    expect(probe.calls).toEqual([]); expect(probe.statCalls).toEqual([]);
  });
  it.each(["image-create-register","image-task-recovery","training","ingestion-native400","dataset-native400","structured-output-native400","browse-native400","lifecycle-native400","ocr-native400"] as const)("uses a separate fresh %s slot with existing bounds",slot=>{
    const result=prepareIsolatedDesktopCase(slot);expect(result.dataRoot).toBe(path.join(base,slot));
    expect(result.env.HF_HUB_CACHE).toBe(path.join(result.dataRoot,"controlled-model-cache"));
    expect(probe.statCalls).toEqual([result.dataRoot]);expect(probe.calls).toHaveLength(1);
    expect(probe.calls[0]).toMatchObject({dataRoot:result.dataRoot,large:"0",runAsNode:"1",timeout:30000,windowsHide:true,script:"visual-composer-desktop-seed.ts"});
  });
  it.each(["image-create-register","image-task-recovery","training","ingestion-native400","dataset-native400","structured-output-native400","browse-native400","lifecycle-native400","ocr-native400"] as const)("retains existing/dangling %s without seeding",slot=>{
    probe.existing=true;expect(()=>prepareIsolatedDesktopCase(slot)).toThrow("An existing operational profile requires a fresh qualification run.");
    expect(probe.statCalls).toEqual([path.join(base,slot)]);expect(probe.calls).toEqual([]);
  });
  it.each(["image-create-register","image-task-recovery","training","ingestion-native400","dataset-native400","structured-output-native400","browse-native400","lifecycle-native400","ocr-native400"] as const)("refuses unsafe roots and a sample index for %s",slot=>{
    expect(()=>prepareIsolatedDesktopCase(slot,0)).toThrow();
    for(const root of ["", "relative/artifacts/qualification/visual-composer/d/fixture",path.resolve(".local-codex/outside"),path.resolve("..","lookalike","artifacts/qualification/visual-composer/d/fixture")]){
      vi.stubEnv("VISUAL_COMPOSER_DESKTOP_DATA_ROOT",root);expect(()=>prepareIsolatedDesktopCase(slot)).toThrow();
      expect(probe.statCalls).toEqual([]);expect(probe.calls).toEqual([]);
    }
  });
  it.each(["context-native400","ingestion-native400/child","dataset-native400/../escape","structured-output-native400\\child"])("refuses unlisted or nested native slot %s before stat or spawn",slot=>{
    expect(()=>prepareIsolatedDesktopCase(slot as never)).toThrow();expect(probe.statCalls).toEqual([]);expect(probe.calls).toEqual([]);
  });
  it("uses its own admitted slot, existing seed command and fixed hidden 30second bound", () => {
    const result = prepareIsolatedDesktopCase("operational");
    expect(result.dataRoot).toBe(path.join(base, "operational"));
    expect(result.env.HF_HUB_CACHE).toBe(path.join(base, "operational", "controlled-model-cache"));
    expect(probe.calls).toEqual([{ executable: "synthetic-electron-node", argvPrefix: ["--preserve-symlinks", "--preserve-symlinks-main", "--import", "tsx"], script: "visual-composer-desktop-seed.ts", dataRoot: result.dataRoot, large: "0", runAsNode: "1", timeout: 30_000, windowsHide: true }]);
    expect(result.dataRoot).not.toBe(path.join(base, "browse"));
    expect(probe.statCalls).toEqual([result.dataRoot]);
  });
  it("uses a separate fresh native slot with the same seed and resource settings", () => {
    const result=prepareIsolatedDesktopCase("operational-native400");
    expect(result.dataRoot).toBe(path.join(base,"operational-native400"));expect(result.env.HF_HUB_CACHE).toBe(path.join(result.dataRoot,"controlled-model-cache"));
    expect(probe.statCalls).toEqual([result.dataRoot]);expect(probe.calls).toHaveLength(1);
    expect(probe.calls[0]).toMatchObject({dataRoot:result.dataRoot,large:"0",runAsNode:"1",timeout:30000,windowsHide:true,script:"visual-composer-desktop-seed.ts"});
    expect(result.dataRoot).not.toBe(path.join(base,"operational"));
  });
  it.each(["relative/artifacts/qualification/visual-composer/d/fixture",path.resolve(".local-codex/outside"),"",path.resolve("..","lookalike","artifacts/qualification/visual-composer/d/fixture")])("refuses an unsafe native root before stat or seed %#",value=>{
    vi.stubEnv("VISUAL_COMPOSER_DESKTOP_DATA_ROOT",value);expect(()=>prepareIsolatedDesktopCase("operational-native400")).toThrow();
    expect(probe.statCalls).toEqual([]);expect(probe.calls).toEqual([]);
  });
  it("refuses a native sample index before stat or seed",()=>{
    expect(()=>prepareIsolatedDesktopCase("operational-native400",0)).toThrow();expect(probe.statCalls).toEqual([]);expect(probe.calls).toEqual([]);
  });
  it("retains an existing or dangling native slot without seeding",()=>{
    probe.existing=true;expect(()=>prepareIsolatedDesktopCase("operational-native400")).toThrow("An existing operational profile requires a fresh qualification run.");
    expect(probe.statCalls).toEqual([path.join(base,"operational-native400")]);expect(probe.calls).toEqual([]);
  });
  it.each(["../escape", "unknown", "operational/child", "", 1, null])("refuses an arbitrary slot before any spawn %#", value => {
    expect(() => prepareIsolatedDesktopCase(value as never)).toThrow(); expect(probe.calls).toHaveLength(0);
  });
  it.each(["relative/artifacts/qualification/visual-composer/d/fixture", path.resolve(".local-codex/outside"), ""])("refuses an unqualified root before any spawn %#", value => {
    vi.stubEnv("VISUAL_COMPOSER_DESKTOP_DATA_ROOT", value);
    expect(() => prepareIsolatedDesktopCase("operational")).toThrow(); expect(probe.calls).toHaveLength(0);
  });
  it("refuses a sample index for a non-cold operational case", () => {
    expect(() => prepareIsolatedDesktopCase("operational", 0)).toThrow(); expect(probe.calls).toHaveLength(0);
  });
  it("refuses a lookalike qualification path outside this repository before stat or spawn", () => {
    vi.stubEnv("VISUAL_COMPOSER_DESKTOP_DATA_ROOT", path.resolve("..", "outside-fixture", "artifacts/qualification/visual-composer/d/run"));
    expect(() => prepareIsolatedDesktopCase("operational")).toThrow();
    expect(probe.statCalls).toHaveLength(0); expect(probe.calls).toHaveLength(0);
  });
  it("retains an existing or dangling slot and requires a new run without seeding it", () => {
    probe.existing = true;
    expect(() => prepareIsolatedDesktopCase("operational")).toThrow("An existing operational profile requires a fresh qualification run.");
    expect(probe.statCalls).toEqual([path.join(base, "operational")]); expect(probe.calls).toHaveLength(0);
  });
});

describe("exact owned desktop window zoom",()=>{
  const page={} as Page;
  const reasons=[undefined,null,false,0,"","synthetic-private-reason",new Error("synthetic-private-reason")];
  const variants=reasons.flatMap(reason=>[{reason,synchronous:false},{reason,synchronous:true}]);
  function fixture(options:{stage?:"acquire"|"evaluate"|"dispose";reason?:unknown;synchronous?:boolean;factor?:unknown;windowDestroyed?:boolean;contentsDestroyed?:boolean;destroyAfterRead?:boolean;alsoDisposeFails?:boolean}={}){
    const calls:string[]=[];let destroyed=options.windowDestroyed??false;
    const window={
      isDestroyed(){calls.push("window-state");return destroyed;},
      unmaximize(){calls.push("unmaximize");},
      setBounds(value:unknown){expect(value).toEqual({width:1440,height:1000});calls.push("fixed-bounds");},
      webContents:{isDestroyed(){calls.push("contents-state");return options.contentsDestroyed??false;},
        setZoomFactor(value:unknown){expect(value).toBe(4);calls.push("fixed-factor");},
        getZoomFactor(){calls.push("read-factor");if(options.destroyAfterRead)destroyed=true;return Object.prototype.hasOwnProperty.call(options,"factor")?options.factor:4;}}
    };
    const fail=()=>{if(options.synchronous)throw options.reason;return Promise.reject(options.reason);};
    const handle={evaluate(callback:(value:typeof window)=>unknown){calls.push("evaluate");return options.stage==="evaluate"?fail():Promise.resolve(callback(window));},
      dispose(){calls.push("dispose");return options.stage==="dispose"||options.alsoDisposeFails?fail():Promise.resolve();}};
    const app={browserWindow(actual:Page){expect(actual).toBe(page);calls.push("exact-page");return options.stage==="acquire"?fail():Promise.resolve(handle);}} as unknown as ElectronApplication;
    return {app,calls};
  }
  async function caught(action:()=>Promise<unknown>){try{await action();return undefined;}catch(error){return error;}}
  it("sets and reads factor4 on only the given Page window and disposes its handle once",async()=>{
    const {app,calls}=fixture();expect(await applyOwnedDesktopNativeZoom(app,page)).toBe(4);
    expect(calls).toEqual(["exact-page","evaluate","window-state","contents-state","unmaximize","fixed-bounds","fixed-factor","read-factor","window-state","contents-state","dispose"]);
  });
  it.each(variants)("redacts acquisition failure %# without window effects or invented cleanup",async options=>{
    const {app,calls}=fixture({...options,stage:"acquire"});const error=await caught(()=>applyOwnedDesktopNativeZoom(app,page));
    expect(error).toBeInstanceOf(Error);expect((error as Error).message).toBe("Native desktop zoom setup failed.");expect(calls).toEqual(["exact-page"]);
  });
  it.each(variants)("redacts evaluation failure %# and retires the obtained handle",async options=>{
    const {app,calls}=fixture({...options,stage:"evaluate"});const error=await caught(()=>applyOwnedDesktopNativeZoom(app,page));
    expect(error).toBeInstanceOf(Error);expect((error as Error).message).toBe("Native desktop zoom setup failed.");expect(calls).toEqual(["exact-page","evaluate","dispose"]);
  });
  it.each(variants)("fails an otherwise successful zoom if handle disposal fails %#",async options=>{
    const {app,calls}=fixture({...options,stage:"dispose"});const error=await caught(()=>applyOwnedDesktopNativeZoom(app,page));
    expect(error).toBeInstanceOf(Error);expect((error as Error).message).toBe("Native desktop zoom handle retirement failed.");expect(calls.filter(v=>v==="dispose")).toHaveLength(1);
  });
  it.each(variants)("preserves both safe failure stages for a combined failure %#",async options=>{
    const {app,calls}=fixture({...options,stage:"evaluate",alsoDisposeFails:true});const error=await caught(()=>applyOwnedDesktopNativeZoom(app,page));
    expect(error).toBeInstanceOf(AggregateError);const actual=error as AggregateError;
    expect(actual.message).toBe("Native desktop zoom setup and retirement failed.");
    expect(actual.errors.map((e:Error)=>e.message)).toEqual(["Native desktop zoom setup failed.","Native desktop zoom handle retirement failed."]);
    expect(JSON.stringify(actual.errors.map((e:Error)=>e.message))).not.toContain("synthetic-private");expect(calls).toEqual(["exact-page","evaluate","dispose"]);
  });
  it.each([0,1,3.99,4.1,NaN,Infinity,-1,false,"4",{},null,undefined])("refuses invalid measured factor %# and still disposes once",async factor=>{
    const {app,calls}=fixture({factor});const error=await caught(()=>applyOwnedDesktopNativeZoom(app,page));
    expect(error).toBeInstanceOf(Error);expect((error as Error).message).toBe("Native desktop zoom setup failed.");expect(calls.filter(v=>v==="dispose")).toHaveLength(1);
  });
  it.each([{windowDestroyed:true},{contentsDestroyed:true},{destroyAfterRead:true}])("refuses a destroyed owned window or contents %#",async options=>{
    const {app,calls}=fixture(options);expect(await caught(()=>applyOwnedDesktopNativeZoom(app,page))).toBeInstanceOf(Error);
    expect(calls.filter(v=>v==="dispose")).toHaveLength(1);if(!options.destroyAfterRead)expect(calls).not.toContain("fixed-factor");
  });
  it("does not coerce an unexpected factor object",async()=>{
    let coercions=0;const factor={valueOf(){coercions++;throw new Error("synthetic-private-coercion");}};
    const {app}=fixture({factor});expect(await caught(()=>applyOwnedDesktopNativeZoom(app,page))).toBeInstanceOf(Error);expect(coercions).toBe(0);
  });
});

describe("fresh isolated Settings profiles",()=>{
  const run="settings-case-fixture-20261029",source="source."+"a".repeat(64);
  function setup(){
    vi.stubEnv("VISUAL_COMPOSER_QUALIFICATION_RUN_ID",run);vi.stubEnv("VISUAL_COMPOSER_QUALIFICATION_SOURCE_REVISION",source);
    const folder=settingsHostLayout(process.cwd(),run,source).desktopDataRoot;vi.stubEnv("VISUAL_COMPOSER_DESKTOP_DATA_ROOT",folder);return folder;
  }
  it.each(["settings-public-values","settings-secret-defaults"] as const)("uses only the fresh exact %s slot",slot=>{
    const folder=setup();vi.stubEnv("HF_TOKEN","synthetic-user-token");vi.stubEnv("HUGGING_FACE_TOKEN","synthetic-other-token");
    const result=prepareIsolatedDesktopCase(slot);expect(result.dataRoot).toBe(path.join(folder,slot));
    const captured:Record<string,unknown>=result.env;
    expect(captured.HF_TOKEN).toBeUndefined();expect(captured.HUGGING_FACE_TOKEN).toBeUndefined();expect(captured.PYTHON_RUNTIME_QUALIFICATION_SCENARIO).toBe("immediate");
    expect(captured.HF_HUB_OFFLINE).toBe("1");expect(captured.COMFYUI_AUTO_INSTALL).toBe("0");
    expect(probe.calls).toHaveLength(1);expect(probe.calls[0]).toMatchObject({dataRoot:result.dataRoot,large:"0",runAsNode:"1",timeout:30000,windowsHide:true});
  });
  it.each(["settings-public-values","settings-secret-defaults"] as const)("retains existing %s and refuses redirected roots before seed",slot=>{
    const folder=setup();probe.existing=true;expect(()=>prepareIsolatedDesktopCase(slot)).toThrow("An existing operational profile requires a fresh qualification run.");expect(probe.calls).toEqual([]);
    probe.existing=false;probe.statCalls.length=0;probe.physicalBase=path.resolve(".local-codex/foreign-profile");expect(()=>prepareIsolatedDesktopCase(slot)).toThrow("physical run root");expect(probe.statCalls).toEqual([]);expect(probe.calls).toEqual([]);
    probe.physicalBase=undefined;vi.stubEnv("VISUAL_COMPOSER_DESKTOP_DATA_ROOT",path.join(folder,"lookalike"));expect(()=>prepareIsolatedDesktopCase(slot)).toThrow("exact fresh run root");expect(probe.calls).toEqual([]);
  });
});

describe("fresh isolated functional model profile",()=>{
  const run="settings-case-fixture-20261029",source="source."+"a".repeat(64);
  function setup(){
    vi.stubEnv("VISUAL_COMPOSER_QUALIFICATION_RUN_ID",run);vi.stubEnv("VISUAL_COMPOSER_QUALIFICATION_SOURCE_REVISION",source);
    const folder=settingsHostLayout(process.cwd(),run,source).desktopDataRoot;vi.stubEnv("VISUAL_COMPOSER_DESKTOP_DATA_ROOT",folder);return folder;
  }
  it.each(["functional-model-reference","functional-artifact-local","functional-provider-source","functional-provider-publication"] as const)("uses only the fresh exact %s slot",slot=>{
    const folder=setup();vi.stubEnv("HF_TOKEN","synthetic-user-token");vi.stubEnv("HUGGING_FACE_TOKEN","synthetic-other-token");
    const result=prepareIsolatedDesktopCase(slot);expect(result.dataRoot).toBe(path.join(folder,slot));
    const captured:Record<string,unknown>=result.env;
    expect(captured.HF_TOKEN).toBeUndefined();expect(captured.HUGGING_FACE_TOKEN).toBeUndefined();expect(captured.PYTHON_RUNTIME_QUALIFICATION_SCENARIO).toBe("immediate");
    expect(captured.HF_HUB_OFFLINE).toBe("1");expect(captured.COMFYUI_AUTO_INSTALL).toBe("0");
    expect(probe.calls).toHaveLength(1);expect(probe.calls[0]).toMatchObject({dataRoot:result.dataRoot,large:"0",runAsNode:"1",timeout:30000,windowsHide:true});
  });
  it.each(["functional-model-reference","functional-artifact-local","functional-provider-source","functional-provider-publication"] as const)("retains existing %s and refuses redirected roots before seed",slot=>{
    const folder=setup();probe.existing=true;expect(()=>prepareIsolatedDesktopCase(slot)).toThrow("An existing operational profile requires a fresh qualification run.");expect(probe.calls).toEqual([]);
    probe.existing=false;probe.statCalls.length=0;probe.physicalBase=path.resolve(".local-codex/foreign-profile");expect(()=>prepareIsolatedDesktopCase(slot)).toThrow("physical run root");expect(probe.statCalls).toEqual([]);expect(probe.calls).toEqual([]);
    probe.physicalBase=undefined;vi.stubEnv("VISUAL_COMPOSER_DESKTOP_DATA_ROOT",path.join(folder,"lookalike"));expect(()=>prepareIsolatedDesktopCase(slot)).toThrow("exact fresh run root");expect(probe.calls).toEqual([]);
  });
});

describe("operational Settings entry with duplicate named buttons",()=>{
  it.each(["thin-chrome","packaged-desktop"] as const)("uses the real header scope for %s without a page-wide match",async host=>{
    vi.stubEnv("VISUAL_COMPOSER_QUALIFICATION_RUN_ID","operational-routing-fixture-20261105");
    vi.stubEnv("VISUAL_COMPOSER_QUALIFICATION_SOURCE_REVISION","source."+"a".repeat(64));
    const calls:string[]=[],attachments:string[]=[];
    interface PassiveLocator { focus():Promise<void>; press():Promise<void>; click():Promise<void>; getByRole():PassiveLocator; locator():PassiveLocator; last():PassiveLocator; }
    const neutral:PassiveLocator={focus:async()=>undefined,press:async()=>undefined,click:async()=>undefined,
      getByRole:()=>neutral,locator:()=>neutral,last:()=>neutral};
    const workspace={...neutral,inputValue:async()=>"fixture-workspace",locator:()=>({...neutral,textContent:async()=>"Fixture workspace"})};
    const page={viewportSize:()=>({width:1440,height:1000}),setViewportSize:async()=>undefined,getByLabel:()=>neutral,
      getByRole(role:string,options:{name:string}){
        if(role==="button"&&options.name==="Settings")throw new Error("synthetic ambiguous Settings buttons");
        return neutral;
      },
      locator(selector:string){
        if(selector!=="header.ui-shell__header")return neutral;
        return {getByRole(role:string,options:unknown){
          if(role === "combobox")return workspace;
          calls.push("header");
          expect(role).toBe("button");expect(options).toEqual({name:"Settings",exact:true});calls.push("settings");
          return {click:async()=>{calls.push("click");throw new Error("synthetic-private-navigation-detail");}};
        }};
      },
    } as unknown as Page;
    const info={project:{name:host},attach:async(name:string,value:{body:string})=>{
      expect(name).toBe("operational-ui");attachments.push(value.body);
    }} as unknown as import("@playwright/test").TestInfo;
    await expect(qualifyOperationalUiJourney(page,info,host)).rejects.toThrow("Operational UI step failed: settings-opened.");
    expect(calls).toEqual(["header","settings","click"]);expect(attachments).toHaveLength(1);
    const report=JSON.parse(attachments[0]!);expect(report.status).toBe("failed");expect(report.nextPhase).toBe("settings-opened");
    expect(report.phases).toEqual(["navigation-menu-opened","navigation-menu-navigated","navigation-menu-focus-returned","sidebar-collapsed","sidebar-restored"]);
    expect(report.scope).toBe("ui-integration-only");expect(attachments[0]).not.toContain("synthetic-private-navigation-detail");
    expect(probe.calls).toEqual([]);
  });
});

describe("operational journey against responsive and current-session behavior",()=>{
  // A source-informed Page contract, not a real browser qualification. Unknown
  // selectors/assertions fail. Wide-only and narrow-only actions are enforced.
  type Locator = {
    assert(method:string,args:unknown,negative:boolean):void;
    getByRole(role:string,options?:{name?:string|RegExp;level?:number}):Locator;
    getByText(text:string):Locator;locator(selector:string):Locator;last():Locator;
    filter(options:{hasText:RegExp}):Locator;focus():Promise<void>;press(key:string):Promise<void>;click():Promise<void>;
    inputValue():Promise<string>;textContent():Promise<string>;isEnabled():Promise<boolean>;fill(value:string):Promise<void>;
  };
  function fixture(options:{native?:boolean;records?:number;active?:boolean;markNeeded?:boolean;wrongHome?:boolean;wrongFocus?:boolean;leak?:boolean;restoreFails?:boolean;failNavigation?:boolean}={}) {
    let viewport={width:options.native?356:1280,height:720},route="Home",menu=false,focus="",collapsed=false,panel=false;
    let records=options.records??0,unread=options.markNeeded??false,intercept=false,fault=false,prompt="";
    const calls:string[]=[],sizes:Array<{width:number;height:number}>=[],attachments:string[]=[];
    const wide=()=>viewport.width>1024;
    const nameOf=(name?:string|RegExp)=>name instanceof RegExp ? name.source.startsWith("^Notifications") ? "Notifications" : name.source.startsWith("^Search") ? "Search" : name.source.startsWith("^Prompt") ? "Prompt" : "unexpected-regex" : name??"";
    function locator(key:string):Locator {
      const visible=()=>key === "trigger" ? !wide() : key === "menu" || key.startsWith("menuitem:") ? !wide()&&menu : key === "sidebar" ? wide()
        : key === "Collapse sidebar" ? wide()&&!collapsed : key === "Expand sidebar" ? wide()&&collapsed
        : key === "notifications" || key === "Close notifications" ? panel : key === "empty" ? panel&&records===0
        : key === "alert" ? fault : key === "home" || key === "home-heading" ? route === "Home"
        : key === "heading:Model Management" || key === "heading:Server model inventory" ? route === "Models"
        : key === "heading:Settings" ? route === "Settings" : key === "heading:Image Generation" || key === "Image generation workflow" || key === "Prompt" ? route === "Image Generation"
        : ["workspace","selected","header","current","Security","Refresh status","security","Mark all read","Clear completed","Notifications","Search","Refresh"].includes(key) ? true
        : (()=>{throw new Error("Unexpected fixture visibility: "+key);})();
      const enabled=()=>key === "Mark all read" ? unread : key === "Clear completed" ? records>0 : true;
      const node:Locator={
        assert(method,raw,negative) {
          const args=raw as unknown[];let actual:unknown,wanted:unknown=true;
          if(method === "toBeVisible")actual=visible();
          else if(method === "toBeHidden")actual=!visible();
          else if(method === "toBeEnabled")actual=enabled();
          else if(method === "toBeDisabled")actual=!enabled();
          else if(method === "toBeFocused")actual=focus===key;
          else if(method === "toHaveCount") {actual=key === "alert" ? Number(fault) : key === "input" || key === "Train Model" ? 0 : 1;wanted=args[0];}
          else if(method === "toHaveAttribute") {
            actual=args[0] === "aria-haspopup" ? "menu" : args[0] === "aria-expanded" ? String(menu) : args[0] === "aria-current" && key === "menuitem:"+route ? "page" : undefined;wanted=args[1];
          } else if(method === "toHaveValue") {actual=key === "workspace" ? "fixture-workspace" : prompt;wanted=args[0];}
          else if(method === "toHaveText") {
            actual=key === "home-heading" ? options.wrongHome ? "Wrong workspace" : "Synthetic workspace title" : key === "server-mode" ? "Server mode: disabled-dev" : key === "listener" ? "Current listener: HTTP only" : undefined;
            wanted=args[0];if(wanted instanceof RegExp){actual=wanted.test(String(actual));wanted=true;}
          } else if(method === "toContainText") {actual=options.leak ? "synthetic-operational-hidden-detail".includes(String(args[0])) : false;wanted=true;}
          else throw new Error("Unexpected fixture assertion: "+method);
          if(negative)expect(actual).not.toEqual(wanted);else expect(actual).toEqual(wanted);
        },
        getByRole(role,opts) {
          const name=nameOf(opts?.name);
          if(key === "header")return locator(role === "combobox" && name === "Select current workspace" ? "workspace" : role === "button" && name === "Settings" ? "header-settings" : "unknown-header");
          if(key === "menu")return locator("menuitem:"+name);
          if(key === "home" && role === "heading")return locator("home-heading");
          if(role === "heading")return locator("heading:"+name);
          if(role === "alert")return locator("alert");
          if(key === "security" && role === "button")return locator("security-button");
          if(role === "dialog" && name === "Notifications")return locator("notifications");
          if(role === "menu" && name === "Application navigation")return locator("menu");
          return locator(name);
        },
        getByText(text){if(key === "notifications" && text === "No notifications yet.")return locator("empty");throw new Error("Unexpected fixture text.");},
        locator(selector) {
          if(key === "root")return locator(selector === "header.ui-shell__header" ? "header" : selector === ".home-page" ? "home" : selector === ".ui-shell__sidebar" ? "sidebar" : selector === "#application-notification-bell" ? "Notifications" : "unknown-selector");
          if(key === "workspace" && selector === "option:checked")return locator("selected");
          if(key === "menu" && selector === '[aria-current="page"]')return locator("current");
          if(key === "Refresh status" && selector === "..")return locator("security");
          if(key === "security")return locator(selector === "input" ? "input" : selector === "p" ? "paragraphs" : "unknown-security");
          throw new Error("Unexpected fixture locator.");
        },
        last(){return locator("menuitem:last");},
        filter({hasText}){if(key !== "paragraphs")throw new Error("Unexpected fixture filter.");return locator(hasText.source.includes("Server mode") ? "server-mode" : "listener");},
        async focus(){if(!visible())throw new Error("Cannot focus hidden fixture control.");focus=key;},
        async press(value) {
          calls.push(key+":"+value);
          if(key === "trigger") {if(wide()||options.failNavigation)throw new Error("synthetic-private-navigation");menu=!menu;focus=menu ? "menuitem:Home" : "trigger";return;}
          if(key === "notifications" && value === "Escape"){panel=false;focus="Notifications";return;}
          if(!key.startsWith("menuitem:") || !visible())throw new Error("Unexpected/hidden fixture press.");
          if(value === "Enter"){route=key.slice(9);menu=false;focus="trigger";}
          else if(value === "Escape" || value === "Tab"){menu=false;focus=value === "Tab" ? "Notifications" : "trigger";}
          else focus=value === "ArrowDown" ? "menuitem:Systems" : value === "End" ? "menuitem:last" : "menuitem:Home";
        },
        async click() {
          calls.push(key+":click");
          if(key === "Collapse sidebar" || key === "Expand sidebar"){if(!visible())throw new Error("Hidden sidebar control.");collapsed=!collapsed;}
          else if(key === "header-settings")route="Settings";
          else if(["Models","Image Generation","Home"].includes(key)){if(!wide())throw new Error("Hidden wide navigation.");route=key;}
          else if(key === "Notifications"){panel=true;focus=options.wrongFocus ? "Mark all read" : "Close notifications";}
          else if(key === "Mark all read"){if(!enabled())throw new Error("Disabled mark read.");unread=false;focus=key;}
          else if(key === "Clear completed"){if(!enabled())throw new Error("Disabled clear.");records=options.active ? 1 : 0;focus=key;}
          else if(key === "Refresh status")fault=intercept;
          else if(key !== "Security")throw new Error("Unexpected fixture click: "+key);
        },
        async inputValue(){if(key !== "workspace")throw new Error("Unexpected fixture input.");return "fixture-workspace";},
        async textContent(){if(key !== "selected")throw new Error("Unexpected fixture content.");return "Synthetic workspace title";},
        async isEnabled(){return enabled();},async fill(value){if(!["Search","Prompt"].includes(key))throw new Error("Unexpected fixture fill.");prompt=value;},
      };
      return node;
    }
    const root=locator("root"),page={...root,getByLabel:(name:string)=>{if(name !== "Open navigation menu")throw new Error("Unexpected fixture label.");return locator("trigger");},
      viewportSize:()=>({...viewport}),setViewportSize:async(size:{width:number;height:number})=>{sizes.push({...size});if(options.restoreFails && size.width === 1280)throw new Error("synthetic-private-restore");viewport={...size};},
      url:()=>"http://127.0.0.1:3000/",route:async()=>{intercept=true;},unroute:async()=>{intercept=false;},
    } as unknown as Page;
    const info={project:{name:"thin-chrome"},attach:async(_name:string,value:{body:string})=>{attachments.push(value.body);}} as unknown as import("@playwright/test").TestInfo;
    return {page,info,calls,sizes,attachments};
  }
  beforeEach(()=>{
    vi.stubEnv("VISUAL_COMPOSER_QUALIFICATION_RUN_ID","operational-responsive-fixture-20261105");
    vi.stubEnv("VISUAL_COMPOSER_QUALIFICATION_SOURCE_REVISION","source."+"a".repeat(64));
  });
  it.each([{records:0},{records:2},{records:2,markNeeded:true}])("completes standard current-session history %# and restores caller viewport",async options=>{
    const f=fixture(options);const report=await qualifyOperationalUiJourney(f.page,f.info,"thin-chrome","standard");
    expect(report.status).toBe("passed");expect(report.phases).toHaveLength(17);
    expect(f.sizes).toEqual([{width:320,height:1000},{width:1440,height:1000},{width:1280,height:720}]);
    expect(f.calls.includes("Clear completed:click")).toBe(options.records>0);
    expect(f.calls.includes("Mark all read:click")).toBe(options.markNeeded??false);
    expect(f.attachments.join("")).not.toMatch(/Synthetic workspace|fixture-workspace|synthetic-private/);
  });
  it("uses the visible native menu for every route without emulating a viewport",async()=>{
    const f=fixture({native:true,records:1});f.page.viewportSize=()=>{throw new Error("Native must not capture an emulated viewport.");};
    const report=await qualifyOperationalUiJourney(f.page,f.info,"thin-chrome","native400");
    expect(report.status).toBe("passed");expect(f.sizes).toEqual([]);
    expect(report.phases.slice(3,5)).toEqual(["sidebar-responsive-hidden","navigation-trigger-responsive-visible"]);
    expect(f.calls).not.toContain("Collapse sidebar:click");expect(f.calls).toContain("menuitem:Image Generation:Enter");
  });
  it.each([null,undefined,{width:-1,height:720},{width:320,height:Infinity},{width:320,height:0}])("refuses missing or invalid standard viewport %# without changing layout",async viewport=>{
    const f=fixture();f.page.viewportSize=()=>viewport as ReturnType<Page["viewportSize"]>;
    await expect(qualifyOperationalUiJourney(f.page,f.info,"thin-chrome","standard")).rejects.toThrow("Operational UI step failed: navigation-menu-opened.");
    expect(f.calls).toEqual([]);expect(f.sizes).toEqual([]);expect(JSON.parse(f.attachments[0]!).phases).toEqual([]);
  });
  it.each([
    [{wrongHome:true},"navigation-menu-navigated"], [{records:2,active:true},"notifications-empty"],
    [{wrongFocus:true},"notifications-empty"], [{leak:true},"security-fault-safe"],
    [{restoreFails:true},"reporting"], [{failNavigation:true},"navigation-menu-opened"],
  ] as const)("retains a failed journey and safe diagnostics for %#",async(options,phase)=>{
    const f=fixture(options);await expect(qualifyOperationalUiJourney(f.page,f.info,"thin-chrome","standard")).rejects.toThrow(`Operational UI step failed: ${phase}.`);
    expect(f.sizes.at(-1)).toEqual({width:1280,height:720});
    const report=JSON.parse(f.attachments[0]!);expect(report.status).toBe("failed");expect(report.nextPhase).toBe(phase);
    expect(f.attachments.join("")).not.toMatch(/Synthetic workspace|fixture-workspace|synthetic-private/);
  });
});
