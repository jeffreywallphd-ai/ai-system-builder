import test from "node:test";
import assert from "node:assert/strict";
import {createHash} from "node:crypto";
import {readRenderedImageBytes,publishImageHostOutcome} from "../visual-composer/e2e/image-generation-host-journey";
import {imageHostReport,IMAGE_HOST_PHASES} from "../visual-composer/image-generation-host-oracles";
const signature=new Uint8Array([137,80,78,71,13,10,26,10]);
class SyntheticImage {complete=true;naturalWidth=256;naturalHeight=256;currentSrc="blob:synthetic-image-only";async decode(){}}
async function fixture(work:(image:SyntheticImage,calls:string[])=>Promise<void>,response:()=>Promise<Response>=async()=>new Response(signature,{headers:{"content-type":"image/png"}})){
  const descriptor=Object.getOwnPropertyDescriptor(globalThis,"HTMLImageElement"),previousFetch=globalThis.fetch,calls:string[]=[];
  Object.defineProperty(globalThis,"HTMLImageElement",{value:SyntheticImage,configurable:true});
  globalThis.fetch=(async(url,options)=>{calls.push(String(url));assert.equal(options?.redirect,"error");assert.equal(options?.credentials,"omit");return response();}) as typeof fetch;
  try{await work(new SyntheticImage(),calls);}finally{globalThis.fetch=previousFetch;if(descriptor)Object.defineProperty(globalThis,"HTMLImageElement",descriptor);else Reflect.deleteProperty(globalThis,"HTMLImageElement");}
}
test("synthetic preview oracle reports only bounded dimensions, size and digest",async()=>{
  await fixture(async(image,calls)=>{const result=await readRenderedImageBytes(image as unknown as HTMLImageElement);
    assert.deepEqual(result,{width:256,height:256,bytes:8,sha256:createHash("sha256").update(signature).digest("hex")});assert.deepEqual(calls,[image.currentSrc]);});
});
test("external URLs, incomplete, wrong-sized and undecodable images cannot trigger a fetch",async()=>{
  for(const patch of [{currentSrc:"https://example.invalid/private"},{currentSrc:"file:///private"},{complete:false},{naturalWidth:512},{naturalHeight:0},{decode:async()=>{throw false;}}])await fixture(async(image,calls)=>{
    Object.assign(image,patch);await assert.rejects(readRenderedImageBytes(image as unknown as HTMLImageElement));assert.deepEqual(calls,[]);
  });
});
test("bad media, signatures, oversized streams and stream failures cannot pass",async()=>{
  const responses=[()=>new Response(signature,{status:403}),()=>new Response(signature,{headers:{"content-type":"text/plain"}}),()=>new Response("invalid",{headers:{"content-type":"image/png"}}),
    ()=>new Response(new Uint8Array(1024**2+1),{headers:{"content-type":"image/png"}}),()=>new Response(new ReadableStream({start(controller){controller.error(new Error("Synthetic stream failure."));}}),{headers:{"content-type":"image/png"}})];
  for(const response of responses)await fixture(async image=>{await assert.rejects(readRenderedImageBytes(image as unknown as HTMLImageElement));},async()=>response());
});
test("failed attachments preserve fixed phase and publication failures without serializing private reasons",async()=>{
  let nameReads=0;const privateFailure=new Error("Synthetic private attachment detail.");
  Object.defineProperty(privateFailure,"name",{get(){nameReads++;throw new Error("Private name getter.");}});
  for(const reason of [undefined,null,false,0,"",privateFailure])for(const phaseFailed of [false,true]){
    const report=imageHostReport("thin-chrome","create-register",phaseFailed?[]:[...IMAGE_HOST_PHASES["create-register"]],phaseFailed);
    await assert.rejects(publishImageHostOutcome({attach:async()=>{throw reason;}},report),(error:unknown)=>{
      assert(error instanceof AggregateError);assert.equal(error.errors.length,phaseFailed?2:1);
      const text=error.errors.map(value=>(value as Error).message).join("\n");assert.match(text,/evidence attachment did not complete/);assert.doesNotMatch(text,/private|getter/i);return true;
    });
  }
  assert.equal(nameReads,0);
});
