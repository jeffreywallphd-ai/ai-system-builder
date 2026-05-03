import { join } from "node:path";

import ts from "typescript";

import { describe, expect, it } from "../../../modules/testing/node-test";

describe("desktop webpack TypeScript configuration", () => {
  it("typechecks the Electron main dependency closure with emit enabled", () => {
    const configPath = join(process.cwd(), "apps/desktop/tsconfig.webpack.json");
    const configFile = ts.readConfigFile(configPath, ts.sys.readFile);

    if (configFile.error) {
      throw new Error(ts.flattenDiagnosticMessageText(configFile.error.messageText, "\n"));
    }

    const parsedConfig = ts.parseJsonConfigFileContent(
      configFile.config,
      ts.sys,
      process.cwd(),
      { noEmit: false },
      configPath,
    );

    const program = ts.createProgram(parsedConfig.fileNames, parsedConfig.options);
    const diagnostics = ts.getPreEmitDiagnostics(program);

    expect(formatDiagnostics(diagnostics)).toBe("");
  });
});

function formatDiagnostics(diagnostics: readonly ts.Diagnostic[]): string {
  if (diagnostics.length === 0) {
    return "";
  }

  return ts.formatDiagnosticsWithColorAndContext(diagnostics, {
    getCanonicalFileName: (fileName) => fileName,
    getCurrentDirectory: () => process.cwd(),
    getNewLine: () => "\n",
  });
}
