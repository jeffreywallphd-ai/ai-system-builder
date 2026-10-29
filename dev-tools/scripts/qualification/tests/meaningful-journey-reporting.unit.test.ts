// @vitest-environment node
import {beforeEach,afterEach,expect,it,vi} from "vitest";
import type {Page} from "@playwright/test";
import {buildMeaningfulSystem,type MeaningfulSystemCase} from "../visual-composer/e2e/meaningful-system-journeys";

const scenario:MeaningfulSystemCase={id:"request-intake",name:"Synthetic system",purpose:"Synthetic setup failure fixture",elements:[]};
async function caught(action:()=>Promise<unknown>){try{await action();return undefined;}catch(error){return error;}}
beforeEach(()=>{vi.stubEnv("VISUAL_COMPOSER_QUALIFICATION_SOURCE_REVISION","source."+"a".repeat(64));});
afterEach(()=>{vi.unstubAllEnvs();});
function page(options:{on?:unknown[];evaluate?:unknown[];off?:unknown[]}={}){
  let bindings=0,unbindings=0,evaluations=0,actions=0;let handler:unknown,removed:unknown;
  const target={on:(_event:string,value:unknown)=>{bindings++;handler=value;if(options.on?.length)throw options.on.shift();},
    off:(_event:string,value:unknown)=>{unbindings++;removed=value;if(options.off?.length)throw options.off.shift();},
    evaluate:async()=>{evaluations++;if(options.evaluate?.length)throw options.evaluate.shift();},
    getByLabel:()=>{actions++;throw new Error("Synthetic first UI action.");}} as unknown as Page;
  return {target,read:()=>({bindings,unbindings,evaluations,actions,handler,removed})};
}
it.each([undefined,null,false,0,""])("initial listener failure %# remains visible and cleanup still runs",async failure=>{
  const fixture=page({on:[failure]}),saved:Record<string,unknown>[]=[];
  const error=await caught(()=>buildMeaningfulSystem(fixture.target,scenario,async()=>undefined,async report=>{saved.push(structuredClone(report));}));
  expect(error).toBeInstanceOf(AggregateError);expect((error as AggregateError).errors).toEqual([failure]);
  const result=fixture.read();expect(result.bindings).toBe(1);expect(result.unbindings).toBe(1);expect(result.actions).toBe(0);
  expect(result.removed).toBe(result.handler);expect(saved).toHaveLength(1);expect(saved[0]!.status).toBe("failed");expect(saved[0]!.totalMs).toBe(0);
});
it("observer setup failure retains the primary error and detaches the owned listener",async()=>{
  const fixture=page({evaluate:[false]}),saved:Record<string,unknown>[]=[];
  const error=await caught(()=>buildMeaningfulSystem(fixture.target,scenario,async()=>undefined,async report=>{saved.push(structuredClone(report));}));
  expect(error).toBeInstanceOf(AggregateError);expect((error as AggregateError).errors).toEqual([false]);
  expect(fixture.read().unbindings).toBe(1);expect(fixture.read().evaluations).toBe(2);expect(fixture.read().actions).toBe(0);
  expect(saved[0]!.status).toBe("failed");expect(Number(saved[0]!.totalMs)).toBeGreaterThanOrEqual(0);
});
it("initial record failure does not reach the UI or hide failed evidence",async()=>{
  const fixture=page(),saved:Record<string,unknown>[]=[];let records=0;
  const error=await caught(()=>buildMeaningfulSystem(fixture.target,scenario,async()=>undefined,async report=>{if(++records===1)throw undefined;saved.push(structuredClone(report));}));
  expect(error).toBeInstanceOf(AggregateError);expect((error as AggregateError).errors).toEqual([undefined]);
  expect(records).toBe(2);expect(fixture.read().actions).toBe(0);expect(fixture.read().unbindings).toBe(1);
  expect(saved[0]!.status).toBe("failed");
});
it("observer/listener cleanup and failed record recovery preserve every error",async()=>{
  const fixture=page({evaluate:[undefined,false],off:[null]});let records=0;
  const error=await caught(()=>buildMeaningfulSystem(fixture.target,scenario,async()=>undefined,async()=>{records++;throw records===1?0:"";}));
  expect(error).toBeInstanceOf(AggregateError);expect((error as AggregateError).errors).toEqual([undefined,false,null,0,""]);
  expect(records).toBe(2);expect(fixture.read().unbindings).toBe(1);
});
it("a first UI failure records running then failed facts without private exception content",async()=>{
  const fixture=page(),saved:Record<string,unknown>[]=[];
  const error=await caught(()=>buildMeaningfulSystem(fixture.target,scenario,async()=>undefined,async report=>{saved.push(structuredClone(report));}));
  expect(error).toBeInstanceOf(AggregateError);expect(saved.map(report=>report.status)).toEqual(["running","failed"]);
  expect(JSON.stringify(saved)).not.toContain("Synthetic first UI action.");expect(fixture.read().unbindings).toBe(1);
  expect(fixture.read().actions).toBe(1);
});
