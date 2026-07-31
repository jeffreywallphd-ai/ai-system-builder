import { describe, expect, it } from "vitest";

import { formatUploadedFileSize } from "../hooks/formatUploadedFileSize";

describe("formatUploadedFileSize", () => {
  it("formats stored upload sizes as MB by default and GB at one gigabyte", () => {
    expect(formatUploadedFileSize(20908)).toBe("0.02 MB");
    expect(formatUploadedFileSize(1024 * 1024 * 1024)).toBe("1.00 GB");
  });
});
