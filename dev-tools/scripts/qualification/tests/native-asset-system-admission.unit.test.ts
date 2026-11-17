// @vitest-environment node
import {beforeEach, describe, expect, it, vi} from "vitest";
import type {Page, TestInfo} from "@playwright/test";
const io=vi.hoisted(()=>({calls:0}));
vi.mock("node:fs/promises",async()=>{
  const original=await vi.importActual<Record<string,unknown>>("node:fs/promises");
  const guarded=Object.fromEntries(Object.entries(original).map(([key,value])=>[key,typeof value==="function"?()=>{io.calls++;throw new Error("Unexpected file effect.");}:value]));
  return {...guarded,default:guarded};
});
import {completeBrowseAuthoringJourney} from "../visual-composer/e2e/browse-authoring-journey";
import {completeAssetAuthoringJourney} from "../visual-composer/e2e/asset-authoring-journey";
type Invoke=(page:Page,info:TestInfo,host:never,mode:never)=>Promise<unknown>;
const workflows:Array<{name:string;invoke:Invoke}>=[
  {name:"System editing",invoke:(p,i,_h,m)=>completeBrowseAuthoringJourney(p,"Synthetic",async()=>{throw new Error("Unexpected reload.");},i,m)},
  {name:"Assets",invoke:(p,i,h,m)=>completeAssetAuthoringJourney(p,h,{kind:"document-reload",reload:async()=>{throw new Error("Unexpected reload.");}},async()=>{throw new Error("Unexpected read.");},i,m)},
];
async function caught(action:()=>Promise<unknown>){try{await action();return undefined;}catch(error){return error;}}
beforeEach(()=>{io.calls=0;});
for(const workflow of workflows)describe(`${workflow.name} native admission`,()=>{
  it.each([null,{},()=>{},Symbol("mode"),"","native",4,false])("rejects unknown mode before metadata, Page and files %#",async mode=>{
    let pageReads=0,infoReads=0;
    const page=new Proxy({},{get(){pageReads++;throw new Error("Unexpected private Page read.");}}) as Page;
    const info=new Proxy({},{get(){infoReads++;throw new Error("Unexpected private context read.");}}) as TestInfo;
    const error=await caught(()=>workflow.invoke(page,info,"thin-chrome" as never,mode as never));
    expect(error).toBeInstanceOf(Error);expect((error as Error).message).toBe("Invalid critical accessibility mode.");
    expect(pageReads).toBe(0);expect(infoReads).toBe(0);expect(io.calls).toBe(0);
  });
  it.each(["managed-thin-chrome","unknown","",undefined])("rejects unsupported native project before effects %#",async project=>{
    let pageReads=0;const page=new Proxy({},{get(){pageReads++;throw new Error("Unexpected Page read.");}}) as Page;
    const info=(project===undefined?undefined:{project:{name:project}}) as unknown as TestInfo;
    const error=await caught(()=>workflow.invoke(page,info,"thin-chrome" as never,"native400" as never));
    expect(error).toBeInstanceOf(Error);expect((error as Error).message).toBe("Unsupported native Assets and System host.");expect(pageReads).toBe(0);expect(io.calls).toBe(0);
  });
});
describe("Assets host identity",()=>{
  it.each([{host:"thin-chrome",project:"packaged-desktop"},{host:"packaged-desktop",project:"thin-chrome"},{host:"unknown",project:"thin-chrome"},{host:null,project:"thin-chrome"}])("rejects a mismatched native host before Page effects %#",async({host,project})=>{
    let reads=0;const page=new Proxy({},{get(){reads++;throw new Error("Unexpected Page read.");}}) as Page;
    const error=await caught(()=>workflows[1]!.invoke(page,{project:{name:project}} as TestInfo,host as never,"native400" as never));
    expect(error).toBeInstanceOf(Error);expect((error as Error).message).toBe("Unsupported native Assets and System host.");expect(reads).toBe(0);expect(io.calls).toBe(0);
  });
});
describe("System viewport compatibility",()=>{
  it.each([undefined,"standard","native400"] as const)("keeps the standard default and does not emulate a native viewport %#",async mode=>{
    const widths:number[]=[], marker=new Error("Synthetic first UI action.");
    const page={setViewportSize:async({width}:{width:number})=>{widths.push(width);},getByLabel:()=>({fill:async()=>{throw marker;}})} as unknown as Page;
    const error=await caught(()=>completeBrowseAuthoringJourney(page,"Synthetic",async()=>{}, {project:{name:"thin-chrome"}} as TestInfo,mode));
    expect(error).toBe(marker);expect(widths).toEqual(mode==="native400"?[]:[1440]);expect(io.calls).toBe(0);
  });
});
