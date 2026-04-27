import { describe, expect, it } from "vitest";

import { parseWebsiteBatchTargets } from "../hooks/parseWebsiteBatchTargets";

describe("parseWebsiteBatchTargets", () => {
  it("splits lines, trims, drops empty lines, and preserves order", () => {
    expect(parseWebsiteBatchTargets(" https://a.com \n\n https://b.com/path \n")).toEqual([
      { url: "https://a.com" },
      { url: "https://b.com/path" },
    ]);
  });
});
