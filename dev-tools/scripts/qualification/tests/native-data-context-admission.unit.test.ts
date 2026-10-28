// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Page, TestInfo } from "@playwright/test";
const io = vi.hoisted(() => ({ calls: 0 }));
vi.mock("node:fs/promises", async () => {
  const original = await vi.importActual<Record<string, unknown>>("node:fs/promises");
  const guarded: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(original)) guarded[key] = typeof value === "function"
    ? () => { io.calls++; throw new Error("Unexpected file operation before admission."); } : value;
  return { ...guarded, default: guarded };
});
import { qualifyIngestionSourceJourney, ingestionSourceEvidenceName } from "../visual-composer/e2e/ingestion-source-journey";
import { prepareProvidedVersions } from "../visual-composer/e2e/provided-dataset-version-journey";
import { prepareSavedRowReview } from "../visual-composer/e2e/saved-row-review-host-journey";
import { prepareSourceContext } from "../visual-composer/e2e/source-context-host-journey";
import { prepareManualContext } from "../visual-composer/e2e/manual-context-host-journey";
import { qualifyStructuredOutputControls } from "../visual-composer/e2e/structured-output-controls-journey";

type Invoke = (page: Page, info: TestInfo, host: "desktop" | "thin", mode: never) => Promise<unknown>;
const workflows: Array<{name: string; invoke: Invoke}> = [
  {name:"file import",invoke:(p,i,h,m)=>qualifyIngestionSourceJourney(p,i,h,m)},
  {name:"dataset versions",invoke:(p,i,h,m)=>prepareProvidedVersions(p,h,i,m)},
  {name:"saved row review",invoke:(p,i,h,m)=>prepareSavedRowReview(p,h,i,m)},
  {name:"source Context",invoke:(p,i,h,m)=>prepareSourceContext(p,h,i,m)},
  {name:"manual Context",invoke:(p,i,h,m)=>prepareManualContext(p,h,i,m)},
  {name:"output shapes",invoke:(p,i,h,m)=>qualifyStructuredOutputControls(p,i,h,async()=>{throw new Error("Unexpected reopen before admission.");},m)},
];
async function caught(action:()=>Promise<unknown>){try{await action();return undefined;}catch(error){return error;}}
beforeEach(()=>{io.calls=0;});
for(const workflow of workflows)describe(`${workflow.name} native admission`,()=>{
  it.each([null,{},()=>{},Symbol("unknown-mode"),"","native",4,false])("rejects unknown mode %# before metadata, Page or file effects",async mode=>{
    let pageReads=0,infoReads=0;
    const page=new Proxy({},{get(){pageReads++;throw new Error("Unexpected private Page read.");}}) as Page;
    const info=new Proxy({},{get(){infoReads++;throw new Error("Unexpected private metadata read.");}}) as TestInfo;
    const error=await caught(()=>workflow.invoke(page,info,"thin",mode as never));
    expect(error).toBeInstanceOf(Error);expect((error as Error).message).toBe("Invalid critical accessibility mode.");
    expect(pageReads).toBe(0);expect(infoReads).toBe(0);expect(io.calls).toBe(0);
  });
  it.each([
    {host:"desktop",project:"thin-chrome"},{host:"thin",project:"packaged-desktop"},
    {host:"thin",project:"managed-thin-chrome"},{host:"desktop",project:"unknown"},
    {host:"unknown",project:"thin-chrome"},{host:"thin",project:undefined},{host:"desktop",project:undefined},
  ])("rejects unsupported native host/project %# before Page or files",async ({host,project})=>{
    let pageReads=0;const page=new Proxy({},{get(){pageReads++;throw new Error("Unexpected private Page read.");}}) as Page;
    const info=(project===undefined?undefined:{project:{name:project}}) as unknown as TestInfo;
    const error=await caught(()=>workflow.invoke(page,info,host as "desktop"|"thin","native400" as never));
    expect(error).toBeInstanceOf(Error);expect((error as Error).message).toBe("Unsupported native Data and Context host.");
    expect(pageReads).toBe(0);expect(io.calls).toBe(0);
  });
});

describe("ingestion result cohort identity",()=>{
  it("preserves both standard names and gives each native cohort a separate exclusive-create destination",()=>{
    const names=[ingestionSourceEvidenceName("desktop"),ingestionSourceEvidenceName("thin"),
      ingestionSourceEvidenceName("desktop","native400"),ingestionSourceEvidenceName("thin","native400")];
    expect(names).toEqual(["desktop.json","thin.json","desktop-native400.json","thin-native400.json"]);
    expect(new Set(names).size).toBe(4);expect(names.every(name=>/^(desktop|thin)(-native400)?\.json$/.test(name))).toBe(true);expect(io.calls).toBe(0);
  });
  it.each(["../escape","desktop/../escape","thin\\child","unknown",null,{},Symbol("host")])("rejects unsupported or path-like result host %#",host=>{
    expect(()=>ingestionSourceEvidenceName(host as never)).toThrow("Invalid ingestion evidence identity.");expect(io.calls).toBe(0);
  });
  it.each([null,{},"native",4,Symbol("mode")])("rejects unsupported result mode %#",mode=>{
    expect(()=>ingestionSourceEvidenceName("thin",mode as never)).toThrow("Invalid critical accessibility mode.");expect(io.calls).toBe(0);
  });
  it("does not coerce a result host object",()=>{
    let calls=0;const host={toString(){calls++;throw new Error("synthetic-private-host");}};
    expect(()=>ingestionSourceEvidenceName(host as never)).toThrow("Invalid ingestion evidence identity.");expect(calls).toBe(0);expect(io.calls).toBe(0);
  });
});
