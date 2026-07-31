import { describe, it, expectTypeOf } from "../../../../testing/node-test";
import type { EffectiveAssetProjectionRepositoryPort, EffectiveAssetProjectionSnapshotRepositoryPort } from "..";

describe("effective-asset-projection ports",()=>{
 it("export repository seams with explicit workspace-scoped reads",()=>{
  expectTypeOf<keyof EffectiveAssetProjectionRepositoryPort>().toEqualTypeOf<"saveEffectiveAssetProjectionRecord"|"updateEffectiveAssetProjectionRecord"|"readEffectiveAssetProjectionRecord"|"readEffectiveAssetProjectionRecordByEffectiveAssetReference"|"listEffectiveAssetProjectionRecords"|"listBlockedConflictedOrStaleEffectiveAssetProjectionRecords">();
  expectTypeOf<keyof EffectiveAssetProjectionSnapshotRepositoryPort>().toEqualTypeOf<"saveEffectiveAssetProjectionSnapshotRecord"|"readEffectiveAssetProjectionSnapshotRecord"|"listEffectiveAssetProjectionSnapshotRecords"|"findLatestEffectiveAssetProjectionSnapshotRecord">();
 });
});
