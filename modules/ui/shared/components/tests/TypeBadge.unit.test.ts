import { describe, expect, it } from "../../../../testing/node-test";

import { resolveTypeBadgePresentation } from "../TypeBadge";

describe("resolveTypeBadgePresentation", () => {
  it("maps common artifact extensions and media types to stable colored labels", () => {
    expect(resolveTypeBadgePresentation("course-outline.pdf")).toEqual({
      label: "PDF",
      tone: "red",
    });
    expect(
      resolveTypeBadgePresentation(
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      ),
    ).toEqual({ label: "DOCX", tone: "blue" });
    expect(resolveTypeBadgePresentation("attendance.xlsx")).toEqual({
      label: "XLSX",
      tone: "green",
    });
    expect(resolveTypeBadgePresentation("image/png")).toEqual({
      label: "PNG",
      tone: "violet",
    });
  });

  it("uses a neutral compact fallback without exposing punctuation", () => {
    expect(resolveTypeBadgePresentation("application/x-custom-data")).toEqual({
      label: "CUSTO",
      tone: "neutral",
    });
    expect(resolveTypeBadgePresentation(undefined)).toEqual({
      label: "TYPE",
      tone: "neutral",
    });
  });
});
