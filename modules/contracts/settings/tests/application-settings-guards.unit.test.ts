import { describe, expect, it } from "../../../testing/node-test";

import {
  isApplicationSettingCategory,
  isModelDefaultFeatureKey,
  isModelDefaultTaskKey,
} from "..";

describe("settings contract guard helpers", () => {
  it("validates known application setting categories", () => {
    expect(isApplicationSettingCategory("models")).toBe(true);
    expect(isApplicationSettingCategory("unknown")).toBe(false);
  });

  it("validates known model default task keys", () => {
    expect(isModelDefaultTaskKey("qaGeneration")).toBe(true);
    expect(isModelDefaultTaskKey("qa-generation")).toBe(false);
  });

  it("validates known model default feature keys", () => {
    expect(isModelDefaultFeatureKey("datasetPreparation")).toBe(true);
    expect(isModelDefaultFeatureKey("publishing")).toBe(false);
  });
});
