import { describe, expect, it } from "vitest";

import { resolveLatestModelDownloadProgress } from "../hooks/modelDownloadProgress";

describe("model download progress", () => {
  it("extracts Hugging Face file download percentages from runtime logs", () => {
    const progress = resolveLatestModelDownloadProgress({
      logs: [
        {
          timestamp: "2026-04-26T21:06:05.000Z",
          level: "warn",
          message: "Python runtime stderr: Fetching 14 files: 43%|####2 | 6/14 [00:00<00:00, 11.15it/s]",
        },
      ],
    }, "Qwen/Qwen3.5-4B");

    expect(progress).toEqual({
      percent: 43,
      completedFiles: 6,
      totalFiles: 14,
      message: "Downloading model Qwen/Qwen3.5-4B: 43% (6/14 files).",
    });
  });

  it("returns the latest progress line when a runtime log chunk contains multiple tqdm updates", () => {
    const progress = resolveLatestModelDownloadProgress({
      logs: [
        {
          timestamp: "2026-04-26T21:06:05.000Z",
          level: "warn",
          message: [
            "Python runtime stderr: Fetching 14 files: 7%|7 | 1/14 [00:00<00:04, 2.72it/s]",
            "Fetching 14 files: 43%|####2 | 6/14 [00:00<00:00, 11.15it/s]",
          ].join("\r"),
        },
      ],
    }, "Qwen/Qwen3.5-4B");

    expect(progress?.message).toBe("Downloading model Qwen/Qwen3.5-4B: 43% (6/14 files).");
  });
});
