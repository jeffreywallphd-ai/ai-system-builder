import { describe, expect, it } from "../../../../testing/node-test";
import { getGlossaryEntry, glossaryEntries } from "../index";

describe("shared glossary entries", () => {
  it("keeps user-facing definitions populated", () => {
    for (const [termId, entry] of Object.entries(glossaryEntries)) {
      expect(termId.trim().length).toBeGreaterThan(0);
      expect(entry.term.trim().length).toBeGreaterThan(0);
      expect(entry.definition.trim().length).toBeGreaterThan(20);
    }
  });

  it("includes field-oriented terms used by form hints", () => {
    expect(getGlossaryEntry("workspaceName").definition).toContain("project name");
    expect(getGlossaryEntry("fileUpload").definition).toContain("Pick a file");
    expect(getGlossaryEntry("settingValue").definition).toContain("Enter or choose");
    expect(getGlossaryEntry("deleteConfirmation").definition).toContain("exact confirmation word");
  });

  it("provides input-formatted recommended ranges for model training parameters", () => {
    const expectedGuidance = {
      modelTrainingEpochs: "Recommended range: 1 to 5.",
      modelTrainingMaxSteps: "Recommended range when set: 100 to 5000.",
      modelTrainingBatchSize: "Recommended range: 1 to 8.",
      modelTrainingLearningRate: "Recommended range: 0.00001 to 0.0005.",
      modelTrainingSequenceLength: "Recommended range: 512 to 4096",
      modelTrainingSeed: "Recommended range: 0 to 2147483647",
      modelTrainingLoraRank: "Recommended range: 4 to 64.",
      modelTrainingLoraAlpha: "Recommended range: 8 to 128.",
      modelTrainingLoraDropout: "Recommended range: 0.0 to 0.1.",
      modelTrainingTargetModules: "q_proj,v_proj",
      modelTrainingGradientAccumulation: "Recommended range: 1 to 32.",
      modelTrainingCheckpointInterval: "Recommended range: 50 to 1000.",
      modelTrainingEvalInterval: "Recommended range: 50 to 1000.",
    } as const;

    for (const [termId, guidance] of Object.entries(expectedGuidance)) {
      expect(getGlossaryEntry(termId as keyof typeof glossaryEntries).definition).toContain(guidance);
    }
  });
});
