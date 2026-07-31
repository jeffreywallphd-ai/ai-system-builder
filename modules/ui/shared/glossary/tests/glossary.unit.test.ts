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
});
