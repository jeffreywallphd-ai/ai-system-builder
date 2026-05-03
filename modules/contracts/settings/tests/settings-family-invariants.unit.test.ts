import { describe, expect, it } from "../../../testing/node-test";

import * as settingsContracts from "..";

describe("settings family invariants", () => {
  it("exports settings contract surfaces from the family barrel", () => {
    expect(Object.keys(settingsContracts).sort()).toEqual([
      "APPLICATION_SETTING_CATEGORIES",
      "APPLICATION_SETTING_VALUE_KINDS",
      "GLOBAL_MODEL_DEFAULT_SETTING_KEY",
      "INITIAL_APPLICATION_SETTING_DEFINITIONS",
      "MODEL_DEFAULT_FEATURE_KEYS",
      "MODEL_DEFAULT_TASK_KEYS",
      "createFeatureModelDefaultSettingKey",
      "createTaskModelDefaultSettingKey",
      "findApplicationSettingDefinition",
      "isApplicationSettingCategory",
      "isApplicationSettingSensitive",
      "isModelDefaultFeatureKey",
      "isModelDefaultTaskKey",
      "listApplicationSettingDefinitionsByCategory",
      "normalizeApplicationSettingKey",
      "normalizeModelDefaultConfig",
    ].sort());
  });
});
