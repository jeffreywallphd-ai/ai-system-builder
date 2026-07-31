import { describe, expect, it, expectTypeOf } from "../../../../testing/node-test";
import { readFileSync } from "node:fs";
import type { AssetCompositionPlanRepositoryPort } from "..";

describe("asset composition ports",()=>{
  it("exports family type surfaces from the barrel", ()=> {
    const barrel = readFileSync("modules/application/ports/asset-composition/index.ts", "utf8");
    expect(barrel).toContain("./asset-composition-plan-repository.port");
  });
  it("requires explicit workspace scoped methods",()=>{
    expectTypeOf<Parameters<AssetCompositionPlanRepositoryPort["readAssetCompositionPlanRecord"]>[0]>().toEqualTypeOf<string>();
    expectTypeOf<Parameters<AssetCompositionPlanRepositoryPort["listValidDraftBlockedConflictedStaleOrArchivedAssetCompositionPlanRecords"]>[0]>().toEqualTypeOf<string>();
  });
  it("keeps list query filters safe and explicit",()=>{
    expectTypeOf<Parameters<AssetCompositionPlanRepositoryPort["listAssetCompositionPlanRecords"]>[0]>().toMatchTypeOf<{targetWorkspaceId:string; text?: string; limit?: number; cursor?: string}>();
  });
});
