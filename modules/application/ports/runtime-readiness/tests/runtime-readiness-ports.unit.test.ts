import { describe, expect, expectTypeOf, it } from "../../../../testing/node-test";
import { readFileSync } from "node:fs";
import type { RuntimeInventoryRepositoryPort, RuntimeReadinessBindingRepositoryPort } from "..";

describe("runtime readiness ports",()=>{
  it("exports family type surfaces from the barrel", ()=> {
    const barrel = readFileSync("modules/application/ports/runtime-readiness/index.ts", "utf8");
    expect(barrel).toContain("./runtime-readiness-binding-repository.port");
    expect(barrel).toContain("./runtime-inventory-repository.port");
  });
  it("requires explicit workspace scoped methods",()=>{
    expectTypeOf<Parameters<RuntimeReadinessBindingRepositoryPort["readRuntimeReadinessBindingRecord"]>[0]>().toEqualTypeOf<string>();
    expectTypeOf<Parameters<RuntimeInventoryRepositoryPort["readRuntimeInventoryRecord"]>[0]>().toEqualTypeOf<string>();
  });
  it("keeps list query filters safe and explicit",()=>{
    expectTypeOf<Parameters<RuntimeReadinessBindingRepositoryPort["listRuntimeReadinessBindingRecords"]>[0]>().toMatchTypeOf<{targetWorkspaceId:string; text?:string; limit?:number; cursor?:string}>();
    expectTypeOf<Parameters<RuntimeInventoryRepositoryPort["listRuntimeInventoryRecords"]>[0]>().toMatchTypeOf<{targetWorkspaceId:string; limit?:number; cursor?:string}>();
  });
});
