import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "../../../../testing/node-test";

describe("observability logging barrel exports", () => {
  it("re-exports StructuredLogSink from createLogger for host composition imports", () => {
    const filePath = resolve("modules/adapters/observability/logging/index.ts");
    const source = readFileSync(filePath, "utf8");

    expect(source.includes("export type { StructuredLogSink } from \"./createLogger\";")).toBe(true);
  });
});
