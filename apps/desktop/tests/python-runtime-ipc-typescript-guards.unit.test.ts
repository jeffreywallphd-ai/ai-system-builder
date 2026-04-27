import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "../../../modules/testing/node-test";

function readSourceFile(relativePath: string): string {
  return readFileSync(resolve(relativePath), "utf8");
}

describe("python runtime ipc TypeScript regression guards", () => {
  it("keeps response-specific runtime error mappers to avoid ts-loader emit-skip regressions", () => {
    const source = readSourceFile(
      "modules/adapters/transport/ipc-electron/python-runtime/registerPythonRuntimeIpc.ts",
    );

    expect(source).toContain("function mapStatusReadRuntimeErrorToIpcFailure(");
    expect(source).toContain("): DesktopPythonRuntimeStatusReadResponse {");
    expect(source).toContain("function mapControlRuntimeErrorToIpcFailure(");
    expect(source).toContain("): DesktopPythonRuntimeControlResponse {");
    expect(source).toContain("details: createRuntimeErrorDetails(operation),");
    expect(source).not.toContain("as DesktopPythonRuntimeStatusReadResponse");
    expect(source).not.toContain("as DesktopPythonRuntimeControlResponse");
  });
});
