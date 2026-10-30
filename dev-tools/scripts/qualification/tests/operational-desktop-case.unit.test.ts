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
