import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "../../../modules/testing/node-test";

function readSourceFile(relativePath: string): string {
  return readFileSync(resolve(relativePath), "utf8");
}

describe("python runtime TypeScript regression guards", () => {
  it("keeps health status mapping narrowed to the runtime status union to avoid ts-loader no-output failures", () => {
    const source = readSourceFile(
      "modules/adapters/runtime/python/protocol/pythonRuntimeHttpProtocol.ts",
    );

    expect(source).toContain("const PYTHON_RUNTIME_STATUS_VALUES: ReadonlySet<PythonRuntimeStatus> = new Set([");
    expect(source).toContain("function asPythonRuntimeStatus(value: unknown, field: string): PythonRuntimeStatus {");
    expect(source).toContain("status: asPythonRuntimeStatus(payload.status, \"status.status\"),");
  });
});

