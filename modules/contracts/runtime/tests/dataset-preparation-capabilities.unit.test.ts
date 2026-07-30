import { describe, expect, it } from "../../../testing/node-test";
import {
  evaluateDatasetPreparationSourceReadiness,
  resolveDatasetPreparationSourceCapability,
} from "../dataset-preparation-capabilities";

describe("dataset preparation source capabilities", () => {
  it("recognizes every supported structured and document source", () => {
    expect(
      resolveDatasetPreparationSourceCapability({ fileName: "rows.csv" })
        ?.format,
    ).toBe("csv");
    expect(
      resolveDatasetPreparationSourceCapability({ fileName: "rows.jsonl" })
        ?.format,
    ).toBe("jsonl");
    expect(
      resolveDatasetPreparationSourceCapability({
        mediaType: "application/vnd.apache.parquet",
      })?.format,
    ).toBe("parquet");
    expect(
      resolveDatasetPreparationSourceCapability({ fileName: "guide.docx" })
        ?.format,
    ).toBe("docx");
    expect(
      resolveDatasetPreparationSourceCapability({ mediaType: "image/png" })
        ?.format,
    ).toBe("image");
  });

  it("rejects unsupported legacy formats with a useful action", () => {
    const readiness = evaluateDatasetPreparationSourceReadiness({
      fileName: "legacy.xls",
      taskType: "llm-classification",
    });

    expect(readiness).toMatchObject({
      ready: false,
      code: "source-format-unsupported",
    });
    expect(readiness.action).toContain("CSV");
  });

  it("does not accept unsupported image media types by broad prefix", () => {
    expect(
      resolveDatasetPreparationSourceCapability({
        fileName: "photo.avif",
        mediaType: "image/avif",
      }),
    ).toBeUndefined();
    expect(
      resolveDatasetPreparationSourceCapability({
        fileName: "photo.heic",
        mediaType: "image/heic",
      }),
    ).toBeUndefined();
  });

  it("rejects task-incompatible sources before runtime work starts", () => {
    expect(
      evaluateDatasetPreparationSourceReadiness({
        fileName: "photo.png",
        taskType: "llm-instruction",
      }),
    ).toMatchObject({
      ready: false,
      code: "source-task-incompatible",
    });

    expect(
      evaluateDatasetPreparationSourceReadiness({
        fileName: "notes.md",
        taskType: "vision-classification",
      }),
    ).toMatchObject({
      ready: false,
      code: "source-task-incompatible",
    });
  });
});
