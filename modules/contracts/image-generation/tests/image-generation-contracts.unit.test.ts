import { describe, expect, it } from "../../../testing/node-test";

import type {
  ImageGenerationEngineType,
  ImageGenerationRequest,
  ImageGenerationResult,
} from "..";
import { assertImageGenerationRequestBounds } from '..';

describe("image generation contracts", () => {
  it('shares existing resource caps and rejects malformed values without coercion or getter evaluation',()=>{
    assertImageGenerationRequestBounds({prompt:'x'.repeat(10_000),negativePrompt:'x'.repeat(10_000),width:4096,height:4096,steps:200,numImages:8,cfg:50,denoise:0,seed:0});
    for(const field of ['width','height','steps','numImages','cfg','denoise','seed'])
      for(const value of [NaN,Infinity,'1',true])expect(()=>assertImageGenerationRequestBounds({prompt:'Valid',[field]:value} as any)).toThrow();
    for(const value of [null,[],{prompt:'Valid',negativePrompt:1},{prompt:'Valid',model:1},{prompt:'Valid',faceId:{enabled:true,references:null}},{prompt:'Valid',engineHints:[]}])
      expect(()=>assertImageGenerationRequestBounds(value as any)).toThrow();
    let serializations=0;
    for(const field of ['sampler','scheduler'])
      for(const value of [{toJSON(){serializations++;return 'changed';}},[],{},1])
        expect(()=>assertImageGenerationRequestBounds({prompt:'Valid',[field]:value} as any)).toThrow();
    expect(serializations).toBe(0);
    let calls=0;const request:any={prompt:'Valid'};
    Object.defineProperty(request,'width',{enumerable:true,get(){calls++;return 1024;}});
    expect(()=>assertImageGenerationRequestBounds(request)).toThrow();expect(calls).toBe(0);
  });
  it("defines an engine-agnostic request shape", () => {
    const request: ImageGenerationRequest = {
      prompt: "cinematic portrait",
      negativePrompt: "low quality",
      seed: 1234,
      width: 1024,
      height: 1024,
      steps: 30,
      sampler: "euler",
      scheduler: "karras",
      model: "sdxl-base",
      numImages: 2,
      engineHints: { qualityProfile: "balanced" },
    };

    expect(request.prompt).toBe("cinematic portrait");
    expect(request.engineHints).toEqual({ qualityProfile: "balanced" });
    expect("workflow" in request).toBe(false);
    expect("graph" in request).toBe(false);
  });

  it("allows optional request fields to be omitted", () => {
    const request: ImageGenerationRequest = {
      prompt: "minimal prompt",
    };

    expect(request.prompt).toBe("minimal prompt");
    expect(request.engineHints).toBeUndefined();
  });

  it("defines a serializable result shape tied to runtime status", () => {
    const result: ImageGenerationResult = {
      requestId: "img-req-1",
      status: "succeeded",
      outputs: [{ artifactId: "artifact-1" }],
      warnings: ["scheduler adjusted"],
      errors: [],
    };

    expect(result.status).toBe("succeeded");
    expect(result.outputs?.[0]?.artifactId).toBe("artifact-1");
  });

  it("restricts engine values to the shared engine literals", () => {
    const engine: ImageGenerationEngineType = "comfyui";
    const fallbackEngine: ImageGenerationEngineType = "unknown";

    expect(engine).toBe("comfyui");
    expect(fallbackEngine).toBe("unknown");
  });

  it("enforces type correctness for required fields", () => {
    // @ts-expect-error prompt is required.
    const invalidRequest: ImageGenerationRequest = { seed: 1 };
    // @ts-expect-error requestId is required.
    const invalidResult: ImageGenerationResult = { status: "queued" };

    expect(invalidRequest).toBeDefined();
    expect(invalidResult).toBeDefined();
  });
});
