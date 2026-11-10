// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import path from "node:path";
import { readFileSync } from "node:fs";
import type { Page, TestInfo } from "@playwright/test";
import axe from "axe-core";
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { NotificationBell, NotificationViewport, NOTIFICATION_BELL_ID, NOTIFICATION_PANEL_ID } from "../../../../modules/ui/shared/notifications/NotificationCenter";
import { NotificationProvider } from "../../../../modules/ui/shared/notifications/NotificationProvider";
const probe = vi.hoisted(() => ({ exists: false, readFails: false, engineReadFails: false, attachFails: false, restoreFails: false, auditFails: false, calls: 0,
  forcedAuditFails: false, forcedMediaFails: false, forcedColors: "none", saveFails: false,
  navigationFault: "", navigationAuditStates: [] as string[], navigationKeys: [] as string[],
  reads: [] as string[], writes: [] as string[], flags: [] as string[], attachments: [] as string[], widths: [] as number[], motion: "no-preference" }));
vi.mock("node:fs/promises", () => {
  const readFile = async (name: string) => {
    probe.reads.push(name);
    if (name.endsWith("axe.min.js") && probe.engineReadFails) throw new Error("synthetic-private-engine-path");
    if (probe.readFails) throw new Error("synthetic-private-reference-path");
    if (name.endsWith("axe.min.js")) return "synthetic-audit-engine";
    return Buffer.from(JSON.stringify({ platform: process.platform, architecture: process.arch, logicalProcessors: 20, installedMemoryGiB: 16, deviceScaleFactor: 1, environmentId: "synthetic-reference" }));
  };
  const mkdir = async () => undefined;
  const writeFile = async (_name: string, body: string, options: { flag: string }) => {
    probe.flags.push(options.flag);
    if (probe.saveFails && options.flag === "w" && JSON.parse(body).status !== "failed") throw new Error("synthetic-private-write-path");
    if (options.flag === "wx" && probe.exists) throw new Error("synthetic-private-retained-path");
    probe.exists = true; probe.writes.push(body);
  };
  const unexpectedOcrIo = async () => { throw new Error("synthetic-private-unexpected-ocr-io"); };
  return { readFile, mkdir, writeFile, lstat: unexpectedOcrIo, realpath: unexpectedOcrIo, default: { readFile, mkdir, writeFile } };
});
vi.mock("node:os", () => { const methods = { cpus: () => new Array(20).fill({}), totalmem: () => 16 * 1024 ** 3 }; return { ...methods, default: methods }; });
import { qualifyCriticalAccessibilityReport, readCriticalAccessibilityContext, readReducedMotionObservation, readControlAccessObservation, readTechnicalAccessibilityAudit } from "../visual-composer/technical-accessibility-observation";
import { navigateCriticalApplicationArea, observeOwnedBrowserProcessRoles, prepareCriticalAccessibilityViewport, qualifyCriticalSurfaceAccessibility } from "../visual-composer/e2e/critical-surface-accessibility";
import { prepareGuidedSystemLifecycle } from "../visual-composer/e2e/guided-system-lifecycle";
import { qualifyOcrDatasetJourney } from "../visual-composer/e2e/ocr-dataset-journey";
import { qualifyOperationalUiJourney } from "../visual-composer/e2e/operational-ui-journey";

const context = () => ({ schemaVersion: "critical-accessibility-context-v1", runId: "critical-fixture-1234567890", sourceRevision: `source.${"a".repeat(64)}`, host: "thin-chrome", surface: "settings", testKey: "b".repeat(64) });
const audit = (width: number) => ({ schemaVersion: "technical-accessibility-audit-v1", width, violations: [], incomplete: [], contrastPassedNodes: 1, retries: { attempted: 0, passed: 0 } });

it("reproduces the installed engine popup reference review on valid actual Notifications markup", async () => {
  const host = document.createElement("div"); document.body.append(host); const root = createRoot(host);
  const saved = Object.getOwnPropertyDescriptor(globalThis, "IS_REACT_ACT_ENVIRONMENT");
  Object.defineProperty(globalThis, "IS_REACT_ACT_ENVIRONMENT", { value: true, configurable: true, writable: true });
  try {
    await act(async () => root.render(createElement(NotificationProvider, { children: createElement("main", { className: "ui-shell" },
      createElement("header", null, createElement(NotificationBell)), createElement("div", { className: "ui-shell__main" }, createElement(NotificationViewport))) })));
    const bell = host.querySelector<HTMLButtonElement>("#" + NOTIFICATION_BELL_ID)!; expect(bell).toBeTruthy();
    await act(async () => bell.click());
    const panel = host.querySelector("#" + NOTIFICATION_PANEL_ID)!; expect(panel).toBeTruthy();
    expect(bell.getAttribute("aria-controls")).toBe(panel.id); expect(bell.getAttribute("aria-haspopup")).toBe("dialog"); expect(bell.getAttribute("aria-expanded")).toBe("true");
    expect(bell.type).toBe("button"); expect(bell.getAttribute("aria-label")).toBe("Notifications"); expect(bell.hasAttribute("role") || bell.hasAttribute("aria-labelledby")).toBe(false);
    expect(panel.getAttribute("role")).toBe("dialog"); expect(panel.querySelector("#" + panel.getAttribute("aria-labelledby"))?.textContent).toBe("Notifications");
    expect(document.activeElement?.getAttribute("aria-label")).toBe("Close notifications");
    const result = await axe.run(host, { runOnly: { type: "rule", values: ["aria-valid-attr-value"] } });
    expect(result.violations).toHaveLength(0); expect(result.incomplete).toHaveLength(1);
    const review = result.incomplete[0]!; expect(review.id).toBe("aria-valid-attr-value"); expect(review.nodes).toHaveLength(1);
    const node = review.nodes[0]!; expect(node.target).toHaveLength(1); expect(typeof node.target[0]).toBe("string"); expect(document.querySelector(node.target[0] as string)).toBe(bell);
    const checks = [...node.any, ...node.all, ...node.none]; expect(checks).toHaveLength(1); expect(checks[0]!.id).toBe("aria-valid-attr-value");
    expect(checks[0]!.data).toEqual({ messageKey: "controlsWithinPopup", needsReview: 'aria-controls="application-notification-panel"' });
    // This one-rule source fixture measures no contrast and qualifies no host.
    const generic = readTechnicalAccessibilityAudit({ ...audit(1440), incomplete: [{ rule: review.id, nodes: 1 }] });
    expect(generic.status).toBe("failed"); expect(generic.failures).toEqual(["unresolved-rule"]);
  } finally {
    await act(async () => root.unmount()); host.remove();
    if (saved) Object.defineProperty(globalThis, "IS_REACT_ACT_ENVIRONMENT", saved); else Reflect.deleteProperty(globalThis, "IS_REACT_ACT_ENVIRONMENT");
  }
});

describe("owned browser diagnostic roles", () => {
  function owned(result: unknown, fail = "") {
    const session = {send:vi.fn(async()=>{if(fail==="send")throw new Error("synthetic-private-transport");return result;}),
      detach:vi.fn(async()=>{if(fail==="detach")throw new Error("synthetic-private-detach");})};
    const create=vi.fn(async()=>session);
    const page={context:()=>({browser:()=>({newBrowserCDPSession:create})})} as unknown as Page;
    return {page,session,create};
  }
  it("uses only the existing browser session and copies bounded roles without private fields", async()=>{
    const {page,session,create}=owned({processInfo:[{id:12,type:"browser",privatePath:"synthetic-private-path"},{id:13,type:"unknown-private-role"}]});
    const result=await observeOwnedBrowserProcessRoles(page);
    expect(result.status).toBe("collected");expect(result.nativeAuthority).toBe(false);
    expect(result.observer).toEqual({role:"playwright-worker",pid:process.pid,parentPid:process.ppid});
    expect(result.processes).toEqual([{pid:12,role:"browser"},{pid:13,role:"other"}]);
    expect(JSON.stringify(result)).not.toContain("private");
    expect(create).toHaveBeenCalledTimes(1);expect(session.send).toHaveBeenCalledTimes(1);expect(session.send).toHaveBeenCalledWith("SystemInfo.getProcessInfo");
    expect(session.detach).toHaveBeenCalledTimes(1);
  });
  it("rejects malformed, duplicate or oversized observations and always detaches", async()=>{
    for(const rows of [null,[],Array.from({length:33},(_,id)=>({id:id+1,type:"renderer"})),[{id:1,type:"renderer"},{id:1,type:"GPU"}],
      [{id:true,type:"browser"}],[{id:0,type:"browser"}],[{id:2**32,type:"browser"}],[{id:1,type:"x".repeat(65)}],[null]]) {
      const {page,session}=owned({processInfo:rows});
      expect(await observeOwnedBrowserProcessRoles(page)).toMatchObject({status:"unavailable",nativeAuthority:false,processes:[]});
      expect(session.detach).toHaveBeenCalledTimes(1);
    }
  });
  it("keeps missing transport, request and close errors non-authoritative and private", async()=>{
    const missing={context:()=>({browser:()=>null})} as unknown as Page;
    expect(await observeOwnedBrowserProcessRoles(missing)).toMatchObject({status:"unavailable",processes:[]});
    for(const failure of ["send","detach"]) {
      const {page,session}=owned({processInfo:[{id:1,type:"browser"}]},failure);
      const result=await observeOwnedBrowserProcessRoles(page);
      expect(result).toMatchObject({status:"unavailable",nativeAuthority:false,processes:[]});
      expect(JSON.stringify(result)).not.toContain("private");expect(session.detach).toHaveBeenCalledTimes(1);
    }
  });
});

describe("responsive Data and Context navigation driver", () => {
  it("operates the actual native disclosure markup without inventing a button role", async () => {
    // The installed Playwright role map does not assign SUMMARY a button role.
    // Keep the DOM shape distinct from a button, unlike the inert API-only driver.
    for(const name of ["apps/desktop/src/renderer/components/layout/AppShell.tsx","apps/thin-client/src/components/layout/AppShell.tsx"]) {
      const source=readFileSync(path.resolve(name),"utf8"),summary=source.match(/<summary\s[\s\S]*?>/g);
      expect(summary).toHaveLength(1);expect(summary![0]).toContain('className="ui-shell__menu-trigger"');
      expect(summary![0]).toContain('aria-label="Open navigation menu"');expect(summary![0]).toContain('aria-haspopup="menu"');
      expect(summary![0]).toContain("aria-expanded={isMenuExpanded}");expect(summary![0]).not.toMatch(/\brole\s*=/);
    }
    const host=document.createElement("div");
    host.innerHTML='<aside class="ui-shell__sidebar" hidden></aside><details><summary class="ui-shell__menu-trigger" aria-label="Open navigation menu" aria-expanded="false" aria-haspopup="menu">Menu</summary><div role="menu" aria-label="Application navigation"><button role="menuitem">Artifacts</button></div></details>';
    document.body.append(host);
    const details=host.querySelector("details")!,summary=host.querySelector("summary")!,item=host.querySelector("button")!;
    let activations=0;
    summary.addEventListener("keydown",event=>{if(event.key==="Enter"){event.preventDefault();details.open=true;summary.setAttribute("aria-expanded","true");}});
    item.addEventListener("keydown",event=>{if(event.key==="Enter"){event.preventDefault();activations++;details.open=false;summary.setAttribute("aria-expanded","false");}});
    const locator=(nodes:Element[])=>({count:async()=>nodes.length,isVisible:async()=>!nodes[0]?.hasAttribute("hidden"),
      getAttribute:async(name:string)=>nodes[0]?.getAttribute(name)??null,
      waitFor:async({state}:{state:string})=>{expect(nodes).toHaveLength(1);expect(state==="hidden"?!details.open:!nodes[0]!.hasAttribute("hidden")).toBe(true);},
      press:async(key:string)=>{expect(nodes).toHaveLength(1);nodes[0]!.dispatchEvent(new KeyboardEvent("keydown",{key,bubbles:true,cancelable:true}));},
      getByRole:(role:string,{name}:{name:string})=>locator(Array.from(nodes[0]!.querySelectorAll(`[role="${role}"]`)).filter(node=>node.textContent===name))});
    const page={locator:(selector:string)=>locator(Array.from(host.querySelectorAll(selector))),
      getByRole:(role:string,{name}:{name:string})=>locator(Array.from(host.querySelectorAll(role==="button"?'button:not([role]),[role="button"]':`[role="${role}"]`)).filter(node=>node.getAttribute("aria-label")===name))} as unknown as Page;
    try {await navigateCriticalApplicationArea(page,"Artifacts");expect(activations).toBe(1);expect(details.open).toBe(false);}
    finally {host.remove();}
  });
  function driver(wide: boolean, opened = false, failure = "") {
    const calls: string[] = [];
    const control = (name: string) => ({
      count: async () => { calls.push(`${name}:count`); return failure === `${name}:duplicate` ? 2 : failure === `${name}:missing` ? 0 : 1; },
      isVisible: async () => { calls.push(`${name}:visible`); return wide; },
      waitFor: async ({ state }: { state: string }) => { calls.push(`${name}:wait:${state}`); if (failure === `${name}:${state}`) throw new Error("synthetic-private-dom"); },
      getAttribute: async () => failure === "trigger:state" ? null : opened ? "true" : "false",
      click: async () => { calls.push(`${name}:click`); if (failure === `${name}:activate`) throw new Error("synthetic-private-dom"); },
      press: async (key: string) => { calls.push(`${name}:press:${key}`); if (failure === `${name}:activate`) throw new Error("synthetic-private-dom"); },
      getByRole: (role: string, { name: target, exact }: { name: string; exact: boolean }) => {
        expect(exact).toBe(true); return control(`${name}/${role}:${target}`);
      },
    });
    const page = {
      locator: (selector: string) => {
        if(selector === "aside.ui-shell__sidebar")return control("sidebar");
        expect(selector).toBe('summary.ui-shell__menu-trigger[aria-label="Open navigation menu"]');return control("trigger");
      },
      getByRole: (role: string, { name, exact, includeHidden }: { name: string; exact: boolean; includeHidden?: boolean }) => {
        expect(exact).toBe(true);
        expect(role).toBe("menu"); expect(name).toBe("Application navigation"); expect(includeHidden).toBe(true); return control("menu");
      },
    } as unknown as Page;
    return { page, calls };
  }
  it.each(["Home", "Data", "Artifacts", "Context"] as const)("uses the visible sidebar for %s", async area => {
    const { page, calls } = driver(true);
    await navigateCriticalApplicationArea(page, area);
    expect(calls).toContain(`sidebar/button:${area}:click`);
    expect(calls.some(call => call.startsWith("menu") || call.startsWith("trigger"))).toBe(false);
  });
  it.each(["Home", "Data", "Artifacts", "Context"].flatMap(area => [false, true].map(opened => ({ area, opened }))))("uses the real responsive menu for $area, already open=$opened", async ({ area, opened }) => {
    const { page, calls } = driver(false, opened);
    await navigateCriticalApplicationArea(page, area as "Home" | "Data" | "Artifacts" | "Context");
    expect(calls).toContain(`menu/menuitem:${area}:press:Enter`);
    expect(calls.at(-1)).toBe("menu:wait:hidden");
    expect(calls.filter(call => call === "trigger:press:Enter")).toHaveLength(opened ? 0 : 1);
    expect(calls.some(call => call.includes(":click"))).toBe(false);
  });
  it.each([null, undefined, "Settings", "../Context", {}, 4, Symbol("area")])("rejects unknown targets before Page access %#", async area => {
    let calls = 0;
    const page = new Proxy({}, { get() { calls++; throw new Error("synthetic-private-page"); } }) as Page;
    await expect(navigateCriticalApplicationArea(page, area as never)).rejects.toThrow("Critical application navigation failed.");
    expect(calls).toBe(0);
  });
  it.each(["sidebar:missing", "sidebar:duplicate", "sidebar/button:Artifacts:missing", "sidebar/button:Artifacts:duplicate",
    "sidebar/button:Artifacts:visible", "sidebar/button:Artifacts:activate", "trigger:missing", "trigger:duplicate", "trigger:visible", "trigger:activate", "trigger:state",
    "menu:missing", "menu:duplicate", "menu:visible", "menu/menuitem:Artifacts:missing", "menu/menuitem:Artifacts:duplicate",
    "menu/menuitem:Artifacts:visible", "menu/menuitem:Artifacts:activate", "menu:hidden"])("redacts %s and never retries activation", async failure => {
    const { page, calls } = driver(failure.startsWith("sidebar/button"), false, failure);
    const error=await navigateCriticalApplicationArea(page,"Artifacts").then(()=>undefined,error=>error);
    expect(error).toBeInstanceOf(Error);
    expect(error.message).toMatch(/^Critical application navigation failed\. Stage: (sidebar-admission|sidebar-target-admission|sidebar-target-visibility|sidebar-target-activation|menu-trigger-admission|menu-trigger-visibility|menu-trigger-state|menu-trigger-activation|menu-visibility|menu-target-admission|menu-target-visibility|menu-target-activation|menu-closure)\.$/);
    expect(error.message).not.toContain("synthetic-private");expect("cause" in error).toBe(false);
    expect(calls.filter(call => call === "trigger:press:Enter").length).toBeLessThanOrEqual(1);
    expect(calls.filter(call => call.endsWith(":click") || call === "menu/menuitem:Artifacts:press:Enter").length).toBeLessThanOrEqual(1);
  });
  it.each([
    ["trigger:missing","menu-trigger-admission"],
    ["trigger:activate","menu-trigger-activation"],
    ["menu/menuitem:Artifacts:activate","menu-target-activation"],
    ["menu:hidden","menu-closure"],
  ])("reports only a fixed diagnostic stage for %s",async(failure,stage)=>{
    const error=await navigateCriticalApplicationArea(driver(false,false,failure).page,"Artifacts").then(()=>undefined,error=>error);
    expect(error).toBeInstanceOf(Error);
    expect(error.message).toBe(`Critical application navigation failed. Stage: ${stage}.`);
    expect("cause" in error).toBe(false);
    expect(error.message).not.toContain("synthetic-private");
  });
});

describe("owning standard viewport preparation",()=>{
  it("sets and verifies the fixed viewport once on the supplied Page",async()=>{
    const setViewportSize=vi.fn(async()=>undefined),viewportSize=vi.fn(()=>({width:1440,height:1000}));
    await prepareCriticalAccessibilityViewport({setViewportSize,viewportSize} as unknown as Page,"standard");
    expect(setViewportSize).toHaveBeenCalledTimes(1);expect(setViewportSize).toHaveBeenCalledWith({width:1440,height:1000});expect(viewportSize).toHaveBeenCalledTimes(1);
  });
  it("does not accept cached dimensions before the setter completes",async()=>{
    let finish!:()=>void;const pending=new Promise<void>(resolve=>{finish=resolve;});
    const setViewportSize=vi.fn(()=>pending),viewportSize=vi.fn(()=>({width:1440,height:1000}));
    const result=prepareCriticalAccessibilityViewport({setViewportSize,viewportSize} as unknown as Page,"standard");
    try {await Promise.resolve();expect(setViewportSize).toHaveBeenCalledTimes(1);expect(viewportSize).not.toHaveBeenCalled();}
    finally {finish();}
    await result;expect(viewportSize).toHaveBeenCalledTimes(1);
  });
  it.each(["native400",null,{},false,4,"native",Symbol("mode")])("does not touch Page for native or unknown mode %#",async mode=>{
    let reads=0;const untouched=new Proxy({},{get(){reads++;throw new Error("synthetic-private-page");}}) as Page;
    if(mode === "native400")await prepareCriticalAccessibilityViewport(untouched,mode);
    else await expect(prepareCriticalAccessibilityViewport(untouched,mode as never)).rejects.toThrow("Invalid critical accessibility mode.");
    expect(reads).toBe(0);
  });
  it.each([null,undefined,{width:1440,height:999},{width:320,height:1000},{width:"1440",height:1000},{width:1440,height:NaN}])("refuses unavailable or mismatched setter result %#",async viewport=>{
    const setViewportSize=vi.fn(async()=>undefined),viewportSize=vi.fn(()=>viewport);
    await expect(prepareCriticalAccessibilityViewport({setViewportSize,viewportSize} as unknown as Page,"standard")).rejects.toThrow("Standard accessibility viewport setup failed.");
    expect(setViewportSize).toHaveBeenCalledTimes(1);expect(viewportSize).toHaveBeenCalledTimes(1);
  });
  it.each([undefined,null,false,0,"",new Error("synthetic-private-browser")].flatMap(reason=>[
    {stage:"set" as const,reason,synchronous:true},{stage:"set" as const,reason,synchronous:false},{stage:"read" as const,reason,synchronous:true},
  ]))("redacts every setup failure %# without retry",async({stage,reason,synchronous})=>{
    const fail=()=>{if(synchronous)throw reason;return Promise.reject(reason);};
    const setViewportSize=vi.fn(()=>stage === "set" ? fail() : Promise.resolve()),viewportSize=vi.fn(()=>{throw reason;});
    await expect(prepareCriticalAccessibilityViewport({setViewportSize,viewportSize} as unknown as Page,"standard")).rejects.toThrow("Standard accessibility viewport setup failed.");
    expect(setViewportSize).toHaveBeenCalledTimes(1);expect(viewportSize).toHaveBeenCalledTimes(stage === "read" ? 1 : 0);
  });
});

describe("closed critical accessibility qualification", () => {
  it.each(["settings", "security", "notifications", "navigation-menu", "data-ingestion", "dataset-preparation", "dataset-versions", "dataset-review", "dataset-row-edit",
    "dataset-output-shape", "context-rag", "context-pack", "manual-context-review", "context-browser", "asset-import", "asset-customization", "asset-studio", "asset-saved", "asset-detail",
    "system-element-picker", "system-preview", "system-properties", "system-layers", "workspace-create", "system-manage",
    "system-build-dialog", "system-publish", "system-publication-confirm", "models-discovery", "models-inventory", "image-configuration",
    "ocr-configuration", "ocr-output-review"])("copies supported %s context and requires both exact ordered widths", surface => {
    const value = { ...context(), surface }, result = qualifyCriticalAccessibilityReport(value, [audit(1440), audit(320)]);
    value.surface = "synthetic-private-context";
    expect(result.schemaVersion).toBe("critical-surface-accessibility-v1"); expect(result.contextSchemaVersion).toBe("critical-accessibility-context-v1");
    expect(result.surface).toBe(surface); expect(result.status).toBe("passed"); expect(Object.isFrozen(result.audits)).toBe(true);
  });
  it.each([{ surface: "../outside" }, { surface: ".private-selector" }, { host: "unknown" }, { host: "packaged-desktop", surface: "security" },
    { host: "thin-chrome", surface: "runtime-conversation" }, { host: "managed-thin-chrome", surface: "runtime-conversation" },
    { host: "thin-chrome", surface: "model-training" }, { host: "managed-thin-chrome", surface: "model-training" },
    { host: "managed-thin-chrome", surface: "ocr-configuration" }, { host: "managed-thin-chrome", surface: "ocr-output-review" },
    { runId: "short" }, { sourceRevision: "worktree" }, { testKey: "private-test-name" }, { token: "synthetic-private-token" }])("rejects unsupported or private context %#", change => {
    expect(() => readCriticalAccessibilityContext({ ...context(), ...change })).toThrow("Invalid critical accessibility context.");
  });
  it.each(["runtime-conversation", "model-training"])("admits %s only for the desktop host", surface => {
    const report = qualifyCriticalAccessibilityReport({ ...context(), host: "packaged-desktop", surface }, [audit(1440), audit(320)]);
    expect(report.surface).toBe(surface); expect(report.host).toBe("packaged-desktop"); expect(report.status).toBe("passed");
  });
  it.each(["ocr-configuration", "ocr-output-review"])("accepts the supported desktop %s observation", surface => {
    expect(qualifyCriticalAccessibilityReport({ ...context(), host: "packaged-desktop", surface }, [audit(1440), audit(320)]).status).toBe("passed");
  });
  it.each([[], [audit(1440)], [audit(320), audit(1440)], [audit(1440), audit(1440)], [audit(1440), { ...audit(320), contrastPassedNodes: 0 }],
    [audit(1440), { ...audit(320), violations: [{ rule: "button-name", nodes: 1 }] }], new Array(2)])("never qualifies missing, reordered, sparse or failed audits %#", values => {
    expect(() => qualifyCriticalAccessibilityReport(context(), values)).toThrow("Invalid critical accessibility qualification.");
  });
  it("refuses executable context and array hooks without invoking them", () => {
    let calls = 0; const data = context(); Object.defineProperty(data, "runId", { get: () => { calls++; return "private"; } });
    expect(() => readCriticalAccessibilityContext(data)).toThrow("Invalid critical accessibility context.");
    const values = new Proxy([audit(1440), audit(320)], { ownKeys: target => { calls++; return Reflect.ownKeys(target); } });
    expect(() => qualifyCriticalAccessibilityReport(context(), values)).toThrow("Invalid critical accessibility qualification."); expect(calls).toBe(0);
  });
  it("refuses an over-cap array before enumerating its descriptors", () => {
    const values = new Array(1000).fill(audit(1440)); let enumerations = 0;
    const original = Object.getOwnPropertyDescriptors;
    const spy = vi.spyOn(Object, "getOwnPropertyDescriptors").mockImplementation(((target: object) => {
      if (target === values) { enumerations++; throw new Error("synthetic-private-array"); }
      return original(target);
    }) as typeof Object.getOwnPropertyDescriptors);
    try {
      expect(() => qualifyCriticalAccessibilityReport(context(), values)).toThrow("Invalid critical accessibility qualification.");
      expect(enumerations).toBe(0);
    } finally { spy.mockRestore(); }
  });
  it.each([{ elements: 0 }, { elements: 100001 }, { maximumTransitionMilliseconds: 1 }, { maximumAnimationMilliseconds: NaN },
    { maximumAnimationMilliseconds: Infinity }, { maximumAnimationMilliseconds: -1 }, { selector: "synthetic-private-selector" }])("rejects invalid or excessive reduced motion facts %#", change => {
    expect(() => readReducedMotionObservation({ elements: 2, maximumTransitionMilliseconds: 0, maximumAnimationMilliseconds: 0, ...change })).toThrow("Invalid reduced motion observation.");
  });
});

describe("bounded control access observations", () => {
  it("copies finite facts and retains a legitimate inaccessible-control failure", () => {
    const input = { width: 320, controls: 3, inaccessible: 1 };
    const result = readControlAccessObservation(input); input.inaccessible = 0;
    expect(result).toEqual({ width: 320, controls: 3, inaccessible: 1, status: "failed" }); expect(Object.isFrozen(result)).toBe(true);
    expect(readControlAccessObservation({ width: 1440, controls: 1, inaccessible: 0 }).status).toBe("passed");
  });
  it.each([{ width: 0 }, { width: 400 }, { controls: 0 }, { controls: 10001 }, { controls: NaN }, { inaccessible: -1 },
    { inaccessible: 4 }, { inaccessible: Infinity }, { inaccessible: 0.5 }, { label: "synthetic-private-control" }])("refuses malformed or private control facts %#", change => {
    expect(() => readControlAccessObservation({ width: 320, controls: 3, inaccessible: 0, ...change })).toThrow("Invalid control access observation.");
  });
  it("refuses executable observation hooks without invoking them", () => {
    let calls = 0; const input = { width: 320, controls: 1, inaccessible: 0 };
    Object.defineProperty(input, "controls", { get() { calls++; return 1; } });
    expect(() => readControlAccessObservation(input)).toThrow("Invalid control access observation.");
    const proxy = new Proxy({}, { getPrototypeOf() { calls++; return Object.prototype; } });
    expect(() => readControlAccessObservation(proxy)).toThrow("Invalid control access observation."); expect(calls).toBe(0);
  });
});

describe("critical surface Page definition with inert IO and synthetic DOM", () => {
  let oldAxe: PropertyDescriptor | undefined;
  let notificationRootStyles: Array<{node: HTMLElement; value: string | null}> = [];
  let oldClientWidth: PropertyDescriptor | undefined, oldScrollWidth: PropertyDescriptor | undefined;
  const page = {
    viewportSize: () => ({ width: 1440, height: 1000 }),
    evaluate: async (callback: ((value: unknown) => unknown) | string, value: unknown) => typeof callback === "string" ? undefined : callback(value),
    emulateMedia: async (options: { reducedMotion?: string; forcedColors?: string }) => {
      if (probe.restoreFails && options.reducedMotion === "no-preference") throw new Error("synthetic-private-browser-error");
      if (options.reducedMotion) probe.motion = options.reducedMotion;
      if (options.forcedColors) probe.forcedColors = options.forcedColors;
    },
    setViewportSize: async (value: { width: number }) => { probe.widths.push(value.width); },
    locator: (selector: string) => ({
      press: async (key: string) => {
        expect(selector).toBe("summary.ui-shell__menu-trigger");
        probe.navigationKeys.push(key);
        if (probe.navigationFault === (key === "Escape" ? "close-throws" : "reopen-throws")) throw new Error("synthetic-private-keyboard");
        if (probe.navigationFault !== "close-state") {
          const trigger=document.querySelector(selector)!;trigger.setAttribute("aria-expanded", key === "Escape" ? "false" : "true");
          (trigger.closest("details") as HTMLDetailsElement).open=key !== "Escape";
        }
      },
      waitFor: async ({ state }: { state: string }) => {
        expect(selector).toBe('.ui-shell__menu-panel[role="menu"]');
        const panel = document.querySelector(selector)!;
        expect(Boolean(panel.getClientRects().length)).toBe(state === "visible");
      },
      getAttribute: async (name: string) => document.querySelector(selector)!.getAttribute(name),
    }),
  } as unknown as Page;
  const info = { title: "Fixed critical UI fixture", project: { name: "thin-chrome" }, attach: async (_name: string, value: { body: string }) => {
    if (probe.attachFails) throw new Error("synthetic-private-attachment"); probe.attachments.push(value.body);
  } } as unknown as TestInfo;
  beforeEach(() => {
    Object.assign(probe, { exists: false, readFails: false, engineReadFails: false, attachFails: false, restoreFails: false, auditFails: false, calls: 0, motion: "no-preference", forcedAuditFails: false, forcedMediaFails: false, forcedColors: "none", saveFails: false, navigationFault: "" });
    probe.navigationAuditStates.length = probe.navigationKeys.length = 0;
    probe.writes.length = probe.flags.length = probe.attachments.length = probe.widths.length = 0;
    probe.reads.length = 0;
    vi.stubEnv("VISUAL_COMPOSER_QUALIFICATION_RUN_ID", context().runId); vi.stubEnv("VISUAL_COMPOSER_QUALIFICATION_SOURCE_REVISION", context().sourceRevision);
    vi.stubGlobal("devicePixelRatio", 1); vi.stubGlobal("matchMedia", (query: string) => ({ matches: query === "(forced-colors: active)" ? !probe.forcedMediaFails && probe.forcedColors === "active" : probe.motion === "reduce" }));
    oldClientWidth = Object.getOwnPropertyDescriptor(document.documentElement, "clientWidth");
    oldScrollWidth = Object.getOwnPropertyDescriptor(document.documentElement, "scrollWidth");
    for (const key of ["clientWidth", "scrollWidth"]) Object.defineProperty(document.documentElement, key, { configurable: true, get: () => probe.widths[probe.widths.length - 1] ?? 1440 });
    oldAxe = Object.getOwnPropertyDescriptor(window, "axe");
    Object.defineProperty(window, "axe", { configurable: true, value: { run: async (root: string) => {
      expect(["body", ".ui-shell__menu"]).toContain(root); probe.calls++;
      const expanded = root === ".ui-shell__menu";
      const trigger = document.querySelector("summary.ui-shell__menu-trigger");
      if (trigger && (probe.widths.at(-1) === 320 || expanded)) {
        expect(trigger.getAttribute("aria-expanded")).toBe(expanded ? "true" : "false");
        probe.navigationAuditStates.push(`${probe.forcedColors}:${expanded ? "expanded-menu" : "closed-document"}`);
      }
      if (expanded && (probe.navigationFault === "panel-failed" || probe.navigationFault === "forced-panel-failed" && probe.forcedColors === "active") ||
          trigger && !expanded && probe.widths.at(-1) === 320 && probe.navigationFault === "closed-document-failed") {
        return { violations: [{ id: "color-contrast", nodes: [{}] }], incomplete: [], passes: [{ id: "color-contrast", nodes: [{}] }] };
      }
      if (expanded && probe.navigationFault === "panel-unresolved") return { violations: [], incomplete: [{ id: "aria-roles", nodes: [{}] }], passes: [{ id: "color-contrast", nodes: [{}] }] };
      if (expanded && probe.navigationFault === "panel-no-positive") return { violations: [], incomplete: [], passes: [] };
      return { violations: probe.auditFails || (probe.forcedAuditFails && probe.forcedColors === "active") ? [{ id: "button-name", nodes: [{}] }] : [], incomplete: [], passes: [{ id: "color-contrast", nodes: [{}] }] };
    } } });
    document.body.innerHTML = '<main class="ui-shell" style="visibility:visible;transition-duration:0s;animation-name:none"><button style="visibility:visible;transition-duration:0s;animation-name:none">Synthetic private label</button></main>';
    for (const element of document.body.querySelectorAll("*")) {
      Object.defineProperty(element, "getClientRects", { value: () => [{ width: 1, height: 1 }] });
      Object.defineProperty(element, "getBoundingClientRect", { configurable: true, value: () => ({ width: 1, height: 1, left: 0, right: 1 }) });
      Object.defineProperty(element, "scrollIntoView", { configurable: true, value: vi.fn() });
    }
  });
  afterEach(() => {
    if (oldAxe) Object.defineProperty(window, "axe", oldAxe); else Reflect.deleteProperty(window, "axe");
    for (const [key, old] of [["clientWidth", oldClientWidth], ["scrollWidth", oldScrollWidth]] as const) {
      if (old) Object.defineProperty(document.documentElement, key, old); else Reflect.deleteProperty(document.documentElement, key);
    }
    for (const {node,value} of notificationRootStyles) if (value === null) node.removeAttribute("style"); else node.setAttribute("style",value);
    notificationRootStyles = [];
    document.documentElement.style.removeProperty("zoom");document.body.replaceChildren(); vi.unstubAllEnvs(); vi.unstubAllGlobals();
  });
  function notificationSurface(fault="") {
    notificationRootStyles = [document.documentElement,document.body].map(node=>({node,value:node.getAttribute("style")}));
    document.body.innerHTML='<main class="ui-shell"><header class="ui-shell__header"><button id="application-notification-bell" type="button" class="ui-shell__notification-button" aria-label="Notifications" aria-haspopup="dialog" aria-expanded="true" aria-controls="application-notification-panel">Notifications</button></header><div class="ui-shell__main"><button id="synthetic-private-background">Synthetic private background</button></div></main>';
    const main=document.querySelector(".ui-shell__main")!,bell=document.getElementById("application-notification-bell")!;
    const keys:string[]=[],states:string[]=[];let disposed=0;
    function prepareGeometry() {
      for(const element of document.querySelectorAll("*")) {
        Object.defineProperty(element,"getClientRects",{configurable:true,value:()=>[{width:10,height:10}]});
        Object.defineProperty(element,"getBoundingClientRect",{configurable:true,value:()=>({left:0,right:10,top:0,bottom:10,width:10,height:10})});
        Object.defineProperty(element,"scrollIntoView",{configurable:true,value:vi.fn()});
        Object.assign((element as HTMLElement).style,{visibility:"visible",opacity:"1",transitionDuration:"0s",animationName:"none"});
      }
    }
    function open() {
      const panel=document.createElement("div");panel.id="application-notification-panel";panel.className="ui-notification__panel";panel.setAttribute("role","dialog");panel.setAttribute("aria-modal","false");panel.setAttribute("aria-labelledby","application-notification-heading");
      panel.innerHTML='<h2 id="application-notification-heading">Notifications</h2><button data-notification-initial-focus aria-label="Close notifications">Close</button><p>No notifications yet.</p>';main.append(panel);
      bell.setAttribute("aria-expanded","true");bell.setAttribute("aria-controls",panel.id);prepareGeometry();
      if(fault!=="reopen-focus"||keys.length===0)(panel.querySelector("button") as HTMLButtonElement).focus();
    }
    open();
    Object.defineProperty(window,"axe",{configurable:true,value:{run:async(root:unknown)=>{
      const foreground=typeof root!=="string";
      if(foreground)expect(root).toEqual({include:[["#application-notification-bell"],["#application-notification-panel"]]});else expect(root).toBe("body");
      states.push(`${probe.forcedColors}:${probe.widths.at(-1)}:${foreground?"popup-and-opener":"complete-closed-document"}`);
      if(!foreground){expect(document.getElementById("application-notification-panel")).toBeNull();expect(bell.getAttribute("aria-expanded")).toBe("false");}
      const known={id:"aria-valid-attr-value",nodes:[{target:["#application-notification-bell"],any:[{id:"aria-valid-attr-value",data:{messageKey:"controlsWithinPopup",needsReview:'aria-controls="application-notification-panel"'}}],all:[],none:[]}]};
      if(foreground&&fault==="popup-changes")bell.setAttribute("aria-controls","synthetic-private-reference");
      return {violations:(!foreground&&fault==="body-failed"||foreground&&fault==="popup-bell-contrast")?[{id:"color-contrast",nodes:[{}]}]:[],
        incomplete:foreground?[known,...(fault==="popup-extra-rule"||fault==="forced-popup-extra"&&probe.forcedColors==="active"?[{id:"aria-roles",nodes:[{target:["#application-notification-panel"]}]}]:[])]:[],
        passes:foreground&&fault==="popup-no-positive"?[]:[{id:"color-contrast",nodes:[{target:[foreground?"#application-notification-heading":"#synthetic-private-background"]}]}]};
    }}});
    const notificationPage={...page,
      locator:(selector:string)=>({
        count:async()=>document.querySelectorAll(selector).length,
        getAttribute:async(name:string)=>document.querySelector(selector)?.getAttribute(name)??null,
        waitFor:async({state}:{state:string})=>{if(Boolean(document.querySelector(selector))!==(state==="visible"))throw new Error("synthetic-private-state");},
        press:async(key:string)=>{
          keys.push(key);
          if(key==="Escape"){
            expect(selector).toBe('[id="application-notification-panel"]');
            if(fault==="close-throws")throw new Error("synthetic-private-close");
            document.getElementById("application-notification-panel")?.remove();bell.setAttribute("aria-expanded",fault==="close-state"?"true":"false");bell.removeAttribute("aria-controls");
            if(fault!=="close-focus")(bell as HTMLButtonElement).focus();
          }else{
            expect(selector).toBe('[id="application-notification-bell"]');expect(key).toBe("Enter");
            if(fault==="reopen-throws")throw new Error("synthetic-private-open");open();
          }
        },
      }),
      waitForFunction:async(callback:()=>boolean)=>{if(!callback())throw new Error("synthetic-private-focus");return{dispose:async()=>{disposed++;if(fault==="handle-close"&&disposed===1)throw new Error("synthetic-private-handle");}};},
    } as unknown as Page;
    return{page:notificationPage,keys,states,disposed:()=>disposed,bell};
  }
  it("keeps complete closed-page audits beside all four positive opener-and-popup proofs",async()=>{
    const fixture=notificationSurface();expect((await qualifyCriticalSurfaceAccessibility(fixture.page,info,"notifications")).status).toBe("passed");
    expect(fixture.keys).toEqual(Array.from({length:4},()=>["Escape","Enter"]).flat());expect(fixture.disposed()).toBe(8);
    expect(fixture.states).toEqual(["none:1440:complete-closed-document","none:1440:popup-and-opener","none:320:complete-closed-document","none:320:popup-and-opener","active:1440:complete-closed-document","active:1440:popup-and-opener","active:320:complete-closed-document","active:320:popup-and-opener"]);
    const saved=JSON.parse(probe.writes.at(-1)!);expect(saved.status).toBe("passed");expect(saved.notificationPopupAudits).toHaveLength(4);
    for(const item of saved.notificationPopupAudits){expect(item.qualification.status).toBe("passed");expect(item.qualification.rawAudit.status).toBe("failed");expect(item.qualification.rawAudit.incomplete).toEqual([{rule:"aria-valid-attr-value",nodes:1}]);expect(item.qualification.reference.matchedIdReferences).toBe(2);expect(item.qualification.reference.namedBells).toBe(1);expect(item.qualification.reference.buttonOpeners).toBe(1);}
    expect(saved.audits.every((item:{incomplete:unknown[]})=>item.incomplete.length===0)).toBe(true);expect(fixture.bell.getAttribute("aria-expanded")).toBe("true");expect(document.activeElement?.hasAttribute("data-notification-initial-focus")).toBe(true);
    expect(probe.writes.join("")).not.toMatch(/synthetic-private|Synthetic private|application-notification|needsReview|selector|target"/);
  });
  it.each(["body-failed","popup-extra-rule","popup-no-positive","popup-bell-contrast","popup-changes","close-throws","close-state","close-focus","reopen-throws","reopen-focus","handle-close","forced-popup-extra"])("keeps notification %s failed and preserves observed evidence",async fault=>{
    const fixture=notificationSurface(fault);await expect(qualifyCriticalSurfaceAccessibility(fixture.page,info,"notifications")).rejects.toThrow(/Critical accessibility check failed/);
    const saved=JSON.parse(probe.writes.at(-1)!);expect(saved.status).toBe("failed");expect(saved.notificationPopupAudits).toBeInstanceOf(Array);expect(probe.motion).toBe("no-preference");expect(probe.forcedColors).toBe("none");
    if(fault==="body-failed"){expect(fixture.keys).toEqual(["Escape","Enter"]);expect(fixture.bell.getAttribute("aria-expanded")).toBe("true");expect(saved.audits[0].status).toBeUndefined();expect(saved.audits[0].violations).toHaveLength(1);}
    if(["popup-extra-rule","popup-no-positive","popup-bell-contrast","forced-popup-extra"].includes(fault)){expect(saved.notificationPopupAudits.at(-1).qualification.status).toBe("failed");expect(saved.notificationPopupAudits.at(-1).qualification.rawAudit.status).toBe("failed");}
    expect(probe.writes.join("")).not.toMatch(/synthetic-private|Synthetic private|application-notification|needsReview|selector|target"/);
  });
  it("audits both declared widths and finalizes only bounded context/rule/count facts", async () => {
    const report = await qualifyCriticalSurfaceAccessibility(page, info, "settings");
    expect(report.status).toBe("passed"); expect(probe.calls).toBe(4); expect(probe.widths).toEqual([1440, 320, 1440, 320, 1440]);
    expect(probe.flags).toEqual(["wx", "w", "w", "w", "w", "w"]); expect(probe.motion).toBe("no-preference"); expect(probe.forcedColors).toBe("none");
    const saved = JSON.parse(probe.writes[probe.writes.length - 1]!); expect(saved.status).toBe("passed"); expect(saved.audits.map((v: { width: number }) => v.width)).toEqual([1440, 320]);
    expect(saved).not.toHaveProperty("contrastRetryDiagnostics"); expect(report).not.toHaveProperty("contrastRetryDiagnostics");
    expect(saved.forcedColorsAudits.map((v: { width: number }) => v.width)).toEqual([1440, 320]);
    expect(saved["control-access-320"]).toEqual({ width: 320, controls: 1, inaccessible: 0, status: "passed" });
    expect(probe.writes.join("")).not.toMatch(/Synthetic private|synthetic-private|userAgent|selector|message/);
  });
  it.each(["standard","native400"] as const)("persists owned diagnostic frontiers without changing %s audit results",async mode=>{
    vi.stubEnv("PYTHON_RUNTIME_QUALIFICATION_SCENARIO","dataset-profile");
    if(mode==="native400")installNativeFrame();
    const detach=vi.fn(async()=>{}),send=vi.fn(async()=>({processInfo:[{id:123,type:"renderer",privateText:"synthetic-private-browser"}]}));
    const observed={...page,context:()=>({browser:()=>({newBrowserCDPSession:async()=>({send,detach})})})} as unknown as Page;
    expect((await qualifyCriticalSurfaceAccessibility(observed,info,"settings",mode)).status).toBe("passed");
    const first=JSON.parse(probe.writes[0]!),last=JSON.parse(probe.writes.at(-1)!);
    expect(first.audits).toEqual([]);expect(first.browserProcessRolesBefore).toMatchObject({status:"collected",nativeAuthority:false,processes:[{pid:123,role:"renderer"}]});
    expect(last.browserProcessRolesAfter).toEqual(first.browserProcessRolesBefore);expect(last.status).toBe("passed");
    expect(detach).toHaveBeenCalledTimes(2);expect(probe.calls).toBe(mode==="standard"?4:2);
    expect(probe.writes.join("")).not.toContain("synthetic-private-browser");
  });
  it.each(["standard","native400"] as const)("keeps unavailable %s diagnostics separate from a passing accessibility audit",async mode=>{
    vi.stubEnv("PYTHON_RUNTIME_QUALIFICATION_SCENARIO","dataset-profile");
    if(mode==="native400")installNativeFrame();
    const detach=vi.fn(async()=>{}),observed={...page,context:()=>({browser:()=>({newBrowserCDPSession:async()=>({
      send:async()=>{throw new Error("synthetic-private-role-transport");},detach})})})} as unknown as Page;
    expect((await qualifyCriticalSurfaceAccessibility(observed,info,"settings",mode)).status).toBe("passed");
    const last=JSON.parse(probe.writes.at(-1)!);
    for(const key of ["browserProcessRolesBefore","browserProcessRolesAfter"])expect(last[key]).toMatchObject({status:"unavailable",nativeAuthority:false,processes:[]});
    expect(detach).toHaveBeenCalledTimes(2);expect(probe.calls).toBe(mode==="standard"?4:2);
    expect(probe.writes.join("")).not.toContain("synthetic-private-role-transport");
  });
  it("does not open diagnostic sessions outside the fixed dataset-profile scenario",async()=>{
    vi.stubEnv("PYTHON_RUNTIME_QUALIFICATION_SCENARIO","training-profile");
    const create=vi.fn(),observed={...page,context:()=>({browser:()=>({newBrowserCDPSession:create})})} as unknown as Page;
    expect((await qualifyCriticalSurfaceAccessibility(observed,info,"settings")).status).toBe("passed");
    expect(create).not.toHaveBeenCalled();expect(JSON.parse(probe.writes.at(-1)!)).not.toHaveProperty("browserProcessRolesBefore");
  });
  it.each([false, true])("restores the caller's narrow viewport after an audit failure=%s", async failure => {
    probe.auditFails = failure;
    const narrow = { ...page, viewportSize: () => ({ width: 320, height: 720 }) } as Page;
    if (failure) await expect(qualifyCriticalSurfaceAccessibility(narrow, info, "settings")).rejects.toThrow("Critical accessibility check failed at audit-1440.");
    else await qualifyCriticalSurfaceAccessibility(narrow, info, "settings");
    expect(probe.widths.at(-1)).toBe(320);
  });
  it("persists current-version reason counters with an unchanged failed core audit", async () => {
    probe.auditFails = true;
    await expect(qualifyCriticalSurfaceAccessibility(page, info, "settings")).rejects.toThrow("Critical accessibility check failed at audit-1440.");
    const saved = JSON.parse(probe.writes.at(-1)!);
    expect(saved.status).toBe("failed"); expect(saved.audits[0].violations).toEqual([{ rule: "button-name", nodes: 1 }]);
    expect(saved.audits[0].retries).toEqual({ attempted: 0, passed: 0 });
    expect(saved.contrastRetryDiagnostics.stage).toBe("audit-1440");
    expect(saved.contrastRetryDiagnostics.observation.schemaVersion).toBe("contrast-retry-diagnostics-v4");
    expect(Object.values(saved.contrastRetryDiagnostics.observation.reasonRegions.other).every(value => value === 0)).toBe(true);
    expect(saved.contrastRetryDiagnostics.observation.reasons.pseudoContent).toBe(0);
    expect(probe.attachments).toHaveLength(1); expect(probe.writes.join("")).not.toMatch(/Synthetic private|synthetic-private|selector|privateCss/);
  });
  it.each([null,undefined,{width:0,height:720},{width:320,height:NaN},{width:320.5,height:720}])("refuses an unavailable or invalid caller viewport %# before any mutation",async viewport=>{
    const untouched={...page,viewportSize:()=>viewport} as Page;
    await expect(qualifyCriticalSurfaceAccessibility(untouched,info,"settings")).rejects.toThrow("Critical accessibility check failed at viewport-admission.");
    expect(probe.flags).toEqual([]);expect(probe.widths).toEqual([]);expect(probe.motion).toBe("no-preference");expect(probe.calls).toBe(0);
  });
  it("redacts a viewport capture failure without inventing a restore target",async()=>{
    const untouched={...page,viewportSize:()=>{throw new Error("synthetic-private-viewport");}} as Page;
    await expect(qualifyCriticalSurfaceAccessibility(untouched,info,"settings")).rejects.toThrow("Critical accessibility check failed at viewport-admission.");
    expect(probe.flags).toEqual([]);expect(probe.widths).toEqual([]);
  });
  function installNavigation(fault?: "missing" | "duplicate" | "wide-menu" | "narrow-menu" | "forced-menu") {
    const main=document.querySelector("main")!;
    const menu=document.createElement("details");menu.className="ui-shell__menu";menu.open=true;main.append(menu);
    for(const [tag,className] of [["aside","ui-shell__sidebar"],["summary","ui-shell__menu-trigger"],["div","ui-shell__menu-panel"]]) {
      if(fault === "missing" && tag === "aside")continue;
      const node=document.createElement(tag!);node.className=className!;
      Object.assign(node.style,{visibility:"visible",transitionDuration:"0s",animationName:"none"});
      node.setAttribute("aria-expanded","true");
      if (tag === "div") { node.setAttribute("role", "menu"); node.setAttribute("aria-label", "Application navigation"); }
      Object.defineProperty(node,"getClientRects",{value:()=>{
        const narrow=(probe.widths.at(-1) ?? (devicePixelRatio === 4 ? 356 : 1440))<=1024;
        let visible=tag === "aside" ? !narrow : narrow;
        if (tag === "div" && document.querySelector("summary.ui-shell__menu-trigger")?.getAttribute("aria-expanded") === "false") visible=false;
        if(fault === "wide-menu" && !narrow && tag !== "aside")visible=true;
        if((fault === "narrow-menu" || fault === "forced-menu" && probe.forcedColors === "active") && narrow && tag === "div")visible=false;
        return visible ? [{width:1,height:1}] : [];
      }});
      Object.defineProperty(node,"getBoundingClientRect",{value:()=>({width:1,height:1,left:0,right:1})});
      (tag === "aside" ? main : menu).append(node);
      if(fault === "duplicate" && tag === "aside")main.append(node.cloneNode(true));
    }
  }
  it("requires wide sidebar and narrow open menu in both media profiles, then restores narrow caller",async()=>{
    installNavigation();const narrow={...page,viewportSize:()=>({width:320,height:720})} as Page;
    expect((await qualifyCriticalSurfaceAccessibility(narrow,info,"navigation-menu")).status).toBe("passed");
    expect(probe.calls).toBe(6);expect(probe.widths).toEqual([1440,320,1440,320,320]);
    expect(probe.navigationKeys).toEqual(["Escape", "ArrowDown", "Escape", "ArrowDown"]);
    expect(probe.navigationAuditStates).toEqual(["none:closed-document", "none:expanded-menu", "active:closed-document", "active:expanded-menu"]);
    const saved=JSON.parse(probe.writes.at(-1)!);
    expect(saved.navigationMenuAudits.map((item: {media:string;audit:{width:number}})=>[item.media,item.audit.width])).toEqual([["normal",320],["forced-colors",320]]);
    expect(document.querySelector("summary.ui-shell__menu-trigger")!.getAttribute("aria-expanded")).toBe("true");
  });
  it.each(["closed-document-failed", "panel-failed", "panel-unresolved", "panel-no-positive", "forced-panel-failed", "close-throws", "reopen-throws", "close-state"])("keeps navigation %s failed without dropping either state",async fault=>{
    installNavigation();probe.navigationFault=fault;
    const stage=fault === "forced-panel-failed" ? "forced-colors-expanded-navigation-audit-320" : fault.startsWith("panel-") ? "expanded-navigation-audit-320" : "audit-320";
    await expect(qualifyCriticalSurfaceAccessibility(page,info,"navigation-menu")).rejects.toThrow(`Critical accessibility check failed at ${stage}.`);
    const saved=JSON.parse(probe.writes.at(-1)!);expect(saved.status).toBe("failed");expect(probe.widths.at(-1)).toBe(1440);
    expect(probe.writes.join("")).not.toContain("synthetic-private");
    if(fault === "closed-document-failed")expect(document.querySelector("summary.ui-shell__menu-trigger")!.getAttribute("aria-expanded")).toBe("true");
    if(fault.startsWith("panel-")||fault === "forced-panel-failed")expect(saved.navigationMenuAudits.at(-1).audit[ fault === "panel-unresolved" ? "incomplete" : fault === "panel-no-positive" ? "contrastPassedNodes" : "violations"]).not.toBeUndefined();
  });
  it.each(["missing","duplicate","wide-menu","narrow-menu","forced-menu"] as const)("refuses wrong responsive navigation %s",async fault=>{
    installNavigation(fault);
    const stage=fault === "forced-menu" ? "forced-colors-navigation-layout-320" : fault === "narrow-menu" ? "navigation-layout-320" : "navigation-layout-1440";
    await expect(qualifyCriticalSurfaceAccessibility(page,info,"navigation-menu")).rejects.toThrow(`Critical accessibility check failed at ${stage}.`);
    expect(JSON.parse(probe.writes.at(-1)!).status).toBe("failed");expect(probe.widths.at(-1)).toBe(1440);
  });
  it("reads fixed source-owned profile and engine inputs from an unrelated working folder",async()=>{
    const inputs=[path.resolve(__dirname,"../../../config/technical-reference-profiles.json"),path.resolve(__dirname,"../../../../node_modules/axe-core/axe.min.js")];
    const unrelated=path.resolve(".local-codex","synthetic-isolated-working-folder");
    const current=vi.spyOn(process,"cwd").mockReturnValue(unrelated);
    try{const result=await qualifyCriticalSurfaceAccessibility(page,info,"settings");expect(result.status).toBe("passed");expect(probe.reads).toEqual(inputs);}
    finally{current.mockRestore();}
  });
  it("keeps an unavailable source-owned engine failed and redacted",async()=>{
    probe.engineReadFails=true;
    await expect(qualifyCriticalSurfaceAccessibility(page,info,"settings")).rejects.toThrow("Critical accessibility check failed at audit-engine.");
    const result=JSON.parse(probe.writes[probe.writes.length-1]!);expect(result.status).toBe("failed");expect(result.failureStage).toBe("audit-engine");
    expect(probe.calls).toBe(0);expect(probe.writes.join("")).not.toContain("synthetic-private-engine-path");
  });
  it("audits the actual standalone mount without requiring the builder shell", async () => {
    document.querySelector("main")!.className = "system-runtime-app";
    const runtimeInfo = { ...info, project: { name: "packaged-desktop" } } as TestInfo;
    const result = await qualifyCriticalSurfaceAccessibility(page, runtimeInfo, "runtime-conversation");
    expect(result.status).toBe("passed"); expect(probe.calls).toBe(4); expect(probe.widths).toEqual([1440, 320, 1440, 320, 1440]);
    expect(probe.motion).toBe("no-preference"); expect(probe.attachments).toHaveLength(1);
    expect(probe.writes.join("")).not.toMatch(/Synthetic private|synthetic-private|selector|message/);
  });
  it.each(["builder-only", "duplicate-runtime", "missing-runtime"] as const)("refuses %s instead of auditing a different page", async fault => {
    const main = document.querySelector("main")!;
    if (fault !== "builder-only") main.className = "system-runtime-app";
    if (fault === "duplicate-runtime") document.body.append(main.cloneNode(true));
    if (fault === "missing-runtime") main.remove();
    const runtimeInfo = { ...info, project: { name: "packaged-desktop" } } as TestInfo;
    await expect(qualifyCriticalSurfaceAccessibility(page, runtimeInfo, "runtime-conversation")).rejects.toThrow("Critical accessibility check failed at browser-profile.");
    expect(probe.calls).toBe(0); expect(JSON.parse(probe.writes[probe.writes.length - 1]!).status).toBe("failed");
  });
  it("rejects a thin runtime before any file or Page effect", async () => {
    const evaluate = vi.fn();
    await expect(qualifyCriticalSurfaceAccessibility({ evaluate } as unknown as Page, info, "runtime-conversation")).rejects.toThrow("Invalid critical accessibility context.");
    expect(evaluate).not.toHaveBeenCalled(); expect(probe.flags).toEqual([]);
  });
  it("rechecks runtime identity if the document changes after initial admission", async () => {
    document.querySelector("main")!.className = "system-runtime-app";
    const changingPage = { ...page, evaluate: async (callback: ((value: unknown) => unknown) | string, value: unknown) => {
      if (value && typeof value === "object" && "scope" in value && value.scope === "runtime") document.querySelector("main")!.className = "ui-shell";
      return typeof callback === "string" ? undefined : callback(value);
    } } as unknown as Page;
    const runtimeInfo = { ...info, project: { name: "packaged-desktop" } } as TestInfo;
    await expect(qualifyCriticalSurfaceAccessibility(changingPage, runtimeInfo, "runtime-conversation")).rejects.toThrow("Critical accessibility check failed at audit-1440.");
    expect(probe.calls).toBe(0); expect(JSON.parse(probe.writes[probe.writes.length - 1]!).status).toBe("failed");
  });
  it.each(["outside-left", "outside-right", "zero-width", "nonfinite"] as const)("refuses a visible %s control even without document overflow", async fault => {
    Object.defineProperty(document.querySelector("button")!, "getBoundingClientRect", { configurable: true, value: () => ({
      width: fault === "zero-width" ? 0 : fault === "nonfinite" ? NaN : 10, height: 10,
      left: fault === "outside-left" ? -20 : 0, right: fault === "outside-right" ? 2000 : 10,
    }) });
    await expect(qualifyCriticalSurfaceAccessibility(page, info, "settings")).rejects.toThrow("Critical accessibility check failed at control-access-1440.");
    const saved = JSON.parse(probe.writes[probe.writes.length - 1]!); expect(saved.status).toBe("failed");
    expect(saved["control-access-1440"].inaccessible).toBe(1); expect(probe.forcedColors).toBe("none");
  });
  it("scrolls visible controls before measurement and excludes hidden or inert controls", async () => {
    const button = document.querySelector("button")!; let scrolled = false;
    Object.defineProperty(button, "scrollIntoView", { configurable: true, value: () => { scrolled = true; } });
    Object.defineProperty(button, "getBoundingClientRect", { configurable: true, value: () => ({ width: 1, height: 1, left: scrolled ? 0 : -20, right: 1 }) });
    const hidden = document.createElement("button"); hidden.style.visibility = "hidden"; document.body.append(hidden);
    const inert = document.createElement("div"); inert.setAttribute("inert", ""); inert.append(document.createElement("button")); document.body.append(inert);
    for (const element of [hidden, inert.firstElementChild!]) {
      Object.assign((element as HTMLElement).style, { transitionDuration: "0s", animationName: "none" });
      if (element !== hidden) (element as HTMLElement).style.visibility = "visible";
      Object.defineProperty(element, "getClientRects", { value: () => [{ width: 10, height: 10 }] });
      Object.defineProperty(element, "getBoundingClientRect", { value: () => ({ width: 10, height: 10, left: -100, right: -90 }) });
      Object.defineProperty(element, "scrollIntoView", { value: () => { throw new Error("Excluded controls must not be inspected."); } });
    }
    expect((await qualifyCriticalSurfaceAccessibility(page, info, "settings")).status).toBe("passed");
    const saved = JSON.parse(probe.writes[probe.writes.length - 1]!); expect(saved["control-access-320"].controls).toBe(1); expect(scrolled).toBe(true);
  });
  it.each(["media", "contrast"] as const)("retains a failed forced-colors %s check after both baseline widths passed", async fault => {
    probe.forcedMediaFails = fault === "media"; probe.forcedAuditFails = fault === "contrast";
    await expect(qualifyCriticalSurfaceAccessibility(page, info, "settings")).rejects.toThrow(`Critical accessibility check failed at ${fault === "media" ? "forced-colors-media" : "forced-colors-audit-1440"}.`);
    const saved = JSON.parse(probe.writes[probe.writes.length - 1]!); expect(saved.status).toBe("failed"); expect(saved.audits).toHaveLength(2);
    expect(probe.forcedColors).toBe("none"); expect(probe.motion).toBe("no-preference"); expect(probe.widths[probe.widths.length - 1]).toBe(1440);
    expect(probe.writes.join("")).not.toContain("synthetic-private");
  });
  it("refuses a mounted document without any observable controls", async () => {
    document.querySelector("button")!.remove();
    await expect(qualifyCriticalSurfaceAccessibility(page, info, "settings")).rejects.toThrow("Critical accessibility check failed at control-access-1440.");
    expect(JSON.parse(probe.writes[probe.writes.length - 1]!).status).toBe("failed"); expect(probe.calls).toBe(0);
  });
  it("refuses an excessive control collection before inspecting its entries", async () => {
    const query = document.body.querySelectorAll.bind(document.body);
    const spy = vi.spyOn(document.body, "querySelectorAll").mockImplementation(((selector: string) => selector === "*" ? query(selector) : new Array(10001)) as typeof document.body.querySelectorAll);
    try {
      await expect(qualifyCriticalSurfaceAccessibility(page, info, "settings")).rejects.toThrow("Critical accessibility check failed at control-access-1440.");
      expect(JSON.parse(probe.writes[probe.writes.length - 1]!).status).toBe("failed"); expect(probe.calls).toBe(0);
    } finally { spy.mockRestore(); }
  });
  it("denies an existing report without overwriting, inspecting or adopting its bytes", async () => {
    probe.exists = true;
    await expect(qualifyCriticalSurfaceAccessibility(page, info, "settings")).rejects.toThrow("Critical accessibility check failed at evidence-create.");
    expect(probe.flags).toEqual(["wx"]); expect(probe.writes).toEqual([]); expect(probe.calls).toBe(0); expect(probe.widths).toEqual([]);
  });
  it("rejects unknown context before any file or Page effect", async () => {
    await expect(qualifyCriticalSurfaceAccessibility(page, info, "../private" as never)).rejects.toThrow("Invalid critical accessibility context.");
    expect(probe.flags).toEqual([]); expect(probe.calls).toBe(0); expect(probe.widths).toEqual([]);
  });
  it.each(["profile", "scale", "unmounted", "motion", "audit", "attachment", "restore"] as const)("preserves failed %s evidence and fixed diagnostics", async fault => {
    if (fault === "profile") probe.readFails = true;
    if (fault === "scale") vi.stubGlobal("devicePixelRatio", { private: "synthetic-private-scale" });
    if (fault === "unmounted") document.body.replaceChildren();
    if (fault === "motion") (document.querySelector("button") as HTMLElement).style.transitionDuration = "1s";
    if (fault === "audit") probe.auditFails = true;
    if (fault === "attachment") probe.attachFails = true;
    if (fault === "restore") probe.restoreFails = true;
    await expect(qualifyCriticalSurfaceAccessibility(page, info, "settings")).rejects.toThrow(/^(Critical accessibility check|Technical accessibility finalization) failed at [a-z0-9-]+\.$/);
    if (fault === "profile") expect(probe.writes).toEqual([]);
    else expect(JSON.parse(probe.writes[probe.writes.length - 1]!).status).toBe("failed");
    expect(probe.writes.join("")).not.toContain("synthetic-private");
    if (fault === "scale") expect(JSON.parse(probe.writes[probe.writes.length - 1]!).browser).toBeUndefined();
  });
  function installNativeFrame() {
    vi.stubGlobal("devicePixelRatio",4);vi.stubGlobal("outerWidth",1440);vi.stubGlobal("innerWidth",356);vi.stubGlobal("visualViewport",{scale:1});
    document.documentElement.style.zoom="1";
    const computed = getComputedStyle;
    // JSDOM does not implement native browser zoom or its computed CSS property.
    vi.stubGlobal("getComputedStyle", (element: Element) => {
      const style = computed(element);
      if (element === document.documentElement) Object.defineProperty(style,"zoom",{value:document.documentElement.style.zoom});
      return style;
    });
    for(const key of ["clientWidth","scrollWidth"])Object.defineProperty(document.documentElement,key,{configurable:true,get:()=>356});
  }
  it.each(["standard", "forced-colors", "save", "restore", "attachment", "native"] as const)("persists only safe failed contrast diagnostics through %s", async failure => {
    const button = document.querySelector("button")!; button.id = "synthetic-private-contrast-target";
    document.querySelector("main")!.setAttribute("style", "visibility:visible;transition-duration:0s;animation-name:none;background-image:linear-gradient(red,blue)");
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => { callback(0); return 1; });
    if (failure === "native") installNativeFrame();
    probe.saveFails = failure === "save"; probe.restoreFails = failure === "restore"; probe.attachFails = failure === "attachment";
    Object.defineProperty(window, "axe", { configurable: true, value: { run: async (root: unknown) => {
      probe.calls++;
      if (failure === "forced-colors" && probe.forcedColors !== "active") return { violations: [], incomplete: [], passes: [{ id: "color-contrast", nodes: [{}] }] };
      return { violations: [], passes: [{ id: "color-contrast", nodes: [{}] }], incomplete: [{ id: "color-contrast", nodes: [{
        target: ["#synthetic-private-contrast-target"], any: [{ id: "color-contrast", message: "synthetic-private-audit-message",
          data: { messageKey: "bgGradient", bgColor: "synthetic-private-color" } }],
      }] }] };
    } } });
    await expect(qualifyCriticalSurfaceAccessibility(page, info, "settings", failure === "native" ? "native400" : "standard")).rejects.toThrow(/^(Critical|Native|Technical) accessibility (check|finalization) failed at [a-z0-9-]+\.$/);
    const saved = JSON.parse(probe.writes.at(-1)!);
    expect(saved.status).toBe("failed");
    expect(saved.contrastRetryDiagnostics.stage).toBe(failure === "native" ? "native-normal-audit" : failure === "forced-colors" ? "forced-colors-audit-1440" : "audit-1440");
    const data = saved.contrastRetryDiagnostics.observation;
    expect(data.attempted).toBe(1); expect(data.passed).toBe(0); expect(data.outcomes).toEqual({ violation: 0, unresolved: 1, noPositiveSample: 0 });
    expect(data.reasons.bgGradient).toBe(1); expect(data.hints.backgroundImage).toBe(1);
    expect(probe.writes.join("")).not.toMatch(/synthetic-private|Synthetic private|messageKey|bgColor|linear-gradient/);
    expect(probe.calls).toBe(failure === "forced-colors" ? 4 : 2);
    if (failure !== "attachment" && failure !== "restore") expect(JSON.parse(probe.attachments.at(-1)!).contrastRetryDiagnostics).toEqual(saved.contrastRetryDiagnostics);
  });
  it.each(["settings","navigation-menu"] as const)("audits native %s at its actual width without any viewport resize",async surface=>{
    installNativeFrame();if(surface === "navigation-menu")installNavigation();
    const result=await qualifyCriticalSurfaceAccessibility(page,info,surface,"native400");
    expect(result.scope).toBe("native-ui-observation-only");expect(result.status).toBe("passed");expect(probe.calls).toBe(2);expect(probe.widths).toEqual([]);
    expect(result.audits.map(item=>"frame" in item?item.frame.innerWidth:null)).toEqual([356,356]);
    expect(probe.motion).toBe("no-preference");expect(probe.forcedColors).toBe("none");expect(probe.flags).toEqual(["wx","w","w","w"]);
    expect(JSON.parse(probe.writes[probe.writes.length-1]!).status).toBe("passed");expect(probe.attachments).toHaveLength(1);
    expect(probe.writes.join("")).not.toMatch(/Synthetic private|synthetic-private|selector|message/);
  });
  it.each(["narrow-menu","forced-menu"] as const)("requires native responsive navigation in %s media",async fault=>{
    installNativeFrame();installNavigation(fault);
    const stage=fault === "forced-menu" ? "native-forced-colors-navigation-layout" : "native-normal-navigation-layout";
    await expect(qualifyCriticalSurfaceAccessibility(page,info,"navigation-menu","native400")).rejects.toThrow(`Native accessibility check failed at ${stage}.`);
    expect(probe.widths).toEqual([]);expect(JSON.parse(probe.writes.at(-1)!).status).toBe("failed");
  });
  it("reads the same source-owned inputs for native observations from an unrelated working folder",async()=>{
    installNativeFrame();
    const inputs=[path.resolve(__dirname,"../../../config/technical-reference-profiles.json"),path.resolve(__dirname,"../../../../node_modules/axe-core/axe.min.js")];
    const unrelated=path.resolve(".local-codex","synthetic-native-working-folder");
    const current=vi.spyOn(process,"cwd").mockReturnValue(unrelated);
    try{const result=await qualifyCriticalSurfaceAccessibility(page,info,"settings","native400");expect(result.status).toBe("passed");expect(probe.reads).toEqual(inputs);}
    finally{current.mockRestore();}
  });
  it("supports only the standalone runtime mount for native runtime observations",async()=>{
    installNativeFrame();document.querySelector("main")!.className="system-runtime-app";
    const result=await qualifyCriticalSurfaceAccessibility(page,{...info,project:{name:"packaged-desktop"}} as TestInfo,"runtime-conversation","native400");
    expect(result.status).toBe("passed");expect(probe.calls).toBe(2);expect(probe.widths).toEqual([]);
  });
  it.each(["scale","css","pinch","outer","inner","overflow","control","missing-control","unmounted"] as const)("denies invalid native %s before evidence writes or audits",async fault=>{
    installNativeFrame();
    if(fault==="scale")vi.stubGlobal("devicePixelRatio",1);
    if(fault==="css")document.documentElement.style.zoom="4";
    if(fault==="pinch")vi.stubGlobal("visualViewport",{scale:4});
    if(fault==="outer")vi.stubGlobal("outerWidth",1500);
    if(fault==="inner")vi.stubGlobal("innerWidth",1440);
    if(fault==="overflow")Object.defineProperty(document.documentElement,"scrollWidth",{configurable:true,get:()=>400});
    if(fault==="control")Object.defineProperty(document.querySelector("button")!,"getBoundingClientRect",{configurable:true,value:()=>({width:400,height:10,left:0,right:400})});
    if(fault==="missing-control")document.querySelector("button")!.remove();
    if(fault==="unmounted")document.body.replaceChildren();
    await expect(qualifyCriticalSurfaceAccessibility(page,info,"settings","native400")).rejects.toThrow(/^(Native frame collection failed|Invalid native accessibility observation|Native accessibility frame admission failed)\.$/);
    expect(probe.writes).toEqual([]);expect(probe.calls).toBe(0);expect(probe.widths).toEqual([]);expect(probe.motion).toBe("no-preference");
  });
  it("keeps the standard device-scale guard unchanged",async()=>{
    installNativeFrame();await expect(qualifyCriticalSurfaceAccessibility(page,info,"settings")).rejects.toThrow("Critical accessibility check failed at browser-profile.");
    expect(probe.calls).toBe(0);expect(JSON.parse(probe.writes[probe.writes.length-1]!).status).toBe("failed");
  });
  it.each(["profile","exists","motion","media","audit","forced-audit","save","attach","restore"] as const)("retains failed native %s results and restores media without resizing",async fault=>{
    installNativeFrame();
    if(fault==="profile")probe.readFails=true;if(fault==="exists")probe.exists=true;
    if(fault==="motion")(document.querySelector("button") as HTMLElement).style.transitionDuration="1s";
    if(fault==="media")probe.forcedMediaFails=true;if(fault==="audit")probe.auditFails=true;if(fault==="forced-audit")probe.forcedAuditFails=true;
    if(fault==="save")probe.saveFails=true;if(fault==="attach")probe.attachFails=true;if(fault==="restore")probe.restoreFails=true;
    await expect(qualifyCriticalSurfaceAccessibility(page,info,"settings","native400")).rejects.toThrow(/^(Native accessibility check|Technical accessibility finalization) failed at [a-z0-9-]+\.$/);
    if(fault==="profile"||fault==="exists")expect(probe.writes).toEqual([]);
    else expect(JSON.parse(probe.writes[probe.writes.length-1]!).status).toBe("failed");
    expect(probe.widths).toEqual([]);expect(probe.writes.join("")).not.toContain("synthetic-private");
  });
  it("rejects unsupported native hosts and unknown modes before touching Page or files",async()=>{
    const untouched=new Proxy({},{get(){throw new Error("Page must not be read.");}}) as Page;
    await expect(qualifyCriticalSurfaceAccessibility(untouched,{...info,project:{name:"managed-thin-chrome"}} as TestInfo,"settings","native400")).rejects.toThrow("Unsupported native accessibility host.");
    for(const mode of [null,{},"native",4]){
      await expect(qualifyCriticalSurfaceAccessibility(untouched,untouched as unknown as TestInfo,"settings",mode as never)).rejects.toThrow("Invalid critical accessibility mode.");
      await expect(qualifyOperationalUiJourney(untouched,untouched as unknown as TestInfo,"thin-chrome",mode as never)).rejects.toThrow("Invalid critical accessibility mode.");
    }
    expect(probe.writes).toEqual([]);expect(probe.calls).toBe(0);
  });
  it.each([undefined,null,false,0,"","synthetic-private-port",new Error("synthetic-private-port")].flatMap(reason=>[
    {reason,synchronous:false},{reason,synchronous:true},
  ]))("redacts an initial native Page failure %# before effects",async ({reason,synchronous})=>{
      const evaluate=vi.fn(()=>{if(synchronous)throw reason;return Promise.reject(reason);});
      const emulateMedia=vi.fn(),setViewportSize=vi.fn();
      let rejected=false,caught:unknown;
      try {await qualifyCriticalSurfaceAccessibility({evaluate,emulateMedia,setViewportSize} as unknown as Page,info,"settings","native400");}
      catch(error){rejected=true;caught=error;}
      expect(rejected).toBe(true);expect(caught).toBeInstanceOf(Error);expect((caught as Error).message).toBe("Native frame collection failed.");
      expect(evaluate).toHaveBeenCalledTimes(1);expect(emulateMedia).not.toHaveBeenCalled();expect(setViewportSize).not.toHaveBeenCalled();
      expect(probe.writes).toEqual([]);expect(probe.flags).toEqual([]);expect(probe.attachments).toEqual([]);expect(probe.calls).toBe(0);
  });
});


describe("explicit lifecycle audit admission", () => {
  it.each([undefined, null, {}, { mode: "unknown" }, { mode: "" }, { mode: "initial", info: undefined }])("rejects missing or invalid mode before Page access %#", async accessibility => {
    const page = new Proxy({}, { get() { throw new Error("Page must not be accessed."); } });
    await expect(prepareGuidedSystemLifecycle(page as Page, "Synthetic lifecycle", { modelDisplayName: "Synthetic model", accessibility } as never))
      .rejects.toThrow("Unknown lifecycle accessibility mode.");
  });
});

describe("explicit OCR host admission", () => {
  it.each([
    { host: "unknown", project: "packaged-desktop" }, { host: "desktop", project: "thin-chrome" },
    { host: "thin", project: "packaged-desktop" }, { host: "thin", project: "managed-thin-chrome" },
    { host: "desktop", project: undefined }, { host: "thin", project: undefined },
  ])("refuses unsupported or mismatched transport/project before file or Page work %#", async ({ host, project }) => {
    const page = new Proxy({}, { get() { throw new Error("Page must not be accessed."); } });
    const info = project === undefined ? undefined : { project: { name: project } };
    await expect(qualifyOcrDatasetJourney(page as Page, info as TestInfo, host as "desktop" | "thin")).rejects.toThrow("Unknown OCR host context.");
  });
});
