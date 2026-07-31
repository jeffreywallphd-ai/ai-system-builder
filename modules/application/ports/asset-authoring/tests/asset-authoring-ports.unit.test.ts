import { describe, expect, it, expectTypeOf } from "../../../../testing/node-test";
import { readFileSync } from "node:fs";
import type { AssetDraftRepositoryPort, AssetOverrideRepositoryPort, AuthoredAssetRepositoryPort, AssetRevisionRepositoryPort } from "..";

describe("asset authoring ports",()=>{
 it("exports family type surfaces from the barrel", ()=> {
  const barrel = readFileSync("modules/application/ports/asset-authoring/index.ts", "utf8");
  expect(barrel).toContain("./authored-asset-repository.port");
  expect(barrel).toContain("./asset-draft-repository.port");
  expect(barrel).toContain("./asset-revision-repository.port");
  expect(barrel).toContain("./asset-override-repository.port");
 });
 it("requires explicit workspace ids",()=>{
  expectTypeOf<Parameters<AuthoredAssetRepositoryPort["readAuthoredAssetRecordByWorkspace"]>[0]>().toEqualTypeOf<string>();
  expectTypeOf<Parameters<AssetDraftRepositoryPort["readAssetDraftRecord"]>[0]>().toEqualTypeOf<string>();
  expectTypeOf<Parameters<AssetOverrideRepositoryPort["readAssetOverrideRecord"]>[0]>().toEqualTypeOf<string>();
  expectTypeOf<Parameters<AssetRevisionRepositoryPort["readAssetRevisionRecord"]>[0]>().toEqualTypeOf<string>();
 });
});
