// @vitest-environment node
import {beforeEach, describe, expect, it, vi} from "vitest";
import type {Page, TestInfo} from "@playwright/test";
const io=vi.hoisted(()=>({calls:0}));
vi.mock("node:fs/promises",async()=>{
  const original=await vi.importActual<Record<string,unknown>>("node:fs/promises");
  const guarded=Object.fromEntries(Object.entries(original).map(([key,value])=>[key,typeof value==="function"?()=>{io.calls++;throw new Error("Unexpected file effect.");}:value]));
  return {...guarded,default:guarded};
});
import {prepareGuidedSystemLifecycle,assertGuidedLifecycleReflow} from "../visual-composer/e2e/guided-system-lifecycle";
import {qualifyOcrDatasetJourney,ocrDatasetEvidenceName} from "../visual-composer/e2e/ocr-dataset-journey";
async function caught(action:()=>Promise<unknown>){try{await action();return undefined;}catch(error){return error;}}
const workflows=[
  {name:"lifecycle",error:"Unsupported native lifecycle host.",invoke:(page:Page,info:TestInfo,mode:never)=>prepareGuidedSystemLifecycle(page,"Synthetic",{modelDisplayName:"Synthetic",accessibility:{mode:"initial",info},zoomMode:mode})},
  {name:"OCR",error:"Unknown OCR host context.",invoke:(page:Page,info:TestInfo,mode:never)=>qualifyOcrDatasetJourney(page,info,"thin",mode)},
];
beforeEach(()=>{io.calls=0;});
for(const workflow of workflows)describe(`${workflow.name} native admission`,()=>{
  it.each([null,{},()=>{},Symbol("mode"),"","native",4,false])("rejects an unknown mode before metadata, Page or files %#",async mode=>{
    let pageReads=0,infoReads=0;
    const page=new Proxy({},{get(){pageReads++;throw new Error("Unexpected private Page read.");}}) as Page;
    const info=new Proxy({},{get(){infoReads++;throw new Error("Unexpected private context read.");}}) as TestInfo;
    const error=await caught(()=>workflow.invoke(page,info,mode as never));
    expect(error).toBeInstanceOf(Error);expect((error as Error).message).toBe("Invalid critical accessibility mode.");
    expect(pageReads).toBe(0);expect(infoReads).toBe(0);expect(io.calls).toBe(0);
  });
  it.each(["managed-thin-chrome","unknown","",undefined])("refuses an unsupported native project before Page or files %#",async project=>{
    let reads=0;const page=new Proxy({},{get(){reads++;throw new Error("Unexpected Page read.");}}) as Page;
    const info=(project===undefined?undefined:{project:{name:project}}) as unknown as TestInfo;
    const error=await caught(()=>workflow.invoke(page,info,"native400" as never));
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toBe(workflow.name==="lifecycle"&&project===undefined?"Unknown lifecycle accessibility mode.":workflow.error);
    expect(reads).toBe(0);expect(io.calls).toBe(0);
  });
});
describe("native repeat preparation",()=>{
  it.each([undefined,{project:{name:"unknown"}},{project:{name:"managed-thin-chrome"}}])("requires local host metadata before Page access %#",async info=>{
    let reads=0;const page=new Proxy({},{get(){reads++;throw new Error("Unexpected Page read.");}}) as Page;
    const error=await caught(()=>prepareGuidedSystemLifecycle(page,"Synthetic",{modelDisplayName:"Synthetic",accessibility:{mode:"repeat",info},zoomMode:"native400"} as never));
    expect(error).toBeInstanceOf(Error);expect((error as Error).message).toBe("Unsupported native lifecycle host.");expect(reads).toBe(0);expect(io.calls).toBe(0);
  });
  it.each(["thin-chrome","packaged-desktop"])("admits the local repeat context without early file effects %#",async project=>{
    const marker=new Error("Synthetic first UI action.");
    const page={getByRole:()=>{throw marker;}} as unknown as Page;
    const error=await caught(()=>prepareGuidedSystemLifecycle(page,"Synthetic",{modelDisplayName:"Synthetic",accessibility:{mode:"repeat",info:{project:{name:project}}},zoomMode:"native400"} as never));
    expect(error).toBe(marker);expect(io.calls).toBe(0);
  });
});
describe("OCR host and evidence cohorts",()=>{
  it.each([{host:"thin",project:"packaged-desktop"},{host:"desktop",project:"thin-chrome"}])("rejects a crossed host/project before effects %#",async({host,project})=>{
    let reads=0;const page=new Proxy({},{get(){reads++;throw new Error("Unexpected Page read.");}}) as Page;
    const error=await caught(()=>qualifyOcrDatasetJourney(page,{project:{name:project}} as unknown as TestInfo,host as "thin"|"desktop","native400"));
    expect(error).toBeInstanceOf(Error);expect((error as Error).message).toBe("Unknown OCR host context.");expect(reads).toBe(0);expect(io.calls).toBe(0);
  });
  it("preserves standard filenames and separates the two native outputs",()=>{
    const names=[ocrDatasetEvidenceName("desktop"),ocrDatasetEvidenceName("thin"),ocrDatasetEvidenceName("desktop","native400"),ocrDatasetEvidenceName("thin","native400")];
    expect(names).toEqual(["desktop.json","thin.json","desktop-native400.json","thin-native400.json"]);expect(new Set(names).size).toBe(4);expect(io.calls).toBe(0);
  });
  it.each(["../escape","thin/child","desktop\\child","unknown",null,{},Symbol("host")])("refuses a path-like or unsupported output host %#",host=>{
    expect(()=>ocrDatasetEvidenceName(host as never)).toThrow("Invalid OCR evidence identity.");expect(io.calls).toBe(0);
  });
  it("does not coerce an output identity",()=>{
    let calls=0;const host={toString(){calls++;throw new Error("synthetic-private-value");}};
    expect(()=>ocrDatasetEvidenceName(host as never)).toThrow("Invalid OCR evidence identity.");expect(calls).toBe(0);
  });
});
describe("standard and native reflow separation",()=>{
  const frame={dpr:4,cssZoom:"1",visualScale:1,outerWidth:1440,innerWidth:356,layoutWidth:356,overflow:0,controls:1,inaccessible:0};
  it.each([undefined,"standard","native400"] as const)("keeps the default320viewport separate from a measured native frame %#",async mode=>{
    const widths:number[]=[],marker=new Error("Synthetic heading assertion.");let frames=0;
    const page={setViewportSize:async({width}:{width:number})=>{widths.push(width);},evaluate:async()=>{frames++;return frame;},getByRole:()=>{throw marker;}} as unknown as Page;
    expect(await caught(()=>assertGuidedLifecycleReflow(page,mode))).toBe(marker);
    expect(widths).toEqual(mode==="native400"?[]:[320]);expect(frames).toBe(mode==="native400"?1:0);expect(io.calls).toBe(0);
  });
  it.each([{...frame,overflow:2},{...frame,inaccessible:1},{...frame,cssZoom:"2"}])("denies failed native fit before later UI actions %#",async raw=>{
    let later=0,viewports=0;const page={evaluate:async()=>raw,setViewportSize:async()=>{viewports++;},getByRole:()=>{later++;throw new Error("Unexpected later UI action.");}} as unknown as Page;
    expect(await caught(()=>assertGuidedLifecycleReflow(page,"native400"))).toBeInstanceOf(Error);expect(later).toBe(0);expect(viewports).toBe(0);expect(io.calls).toBe(0);
  });
});
