import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import ts from "typescript";

const formatDiagnostics = (diagnostics: readonly ts.Diagnostic[]) => {
  const host: ts.FormatDiagnosticsHost = {
    getCanonicalFileName: (fileName) => fileName,
    getCurrentDirectory: () => process.cwd(),
    getNewLine: () => "\n",
  };

  return ts.formatDiagnosticsWithColorAndContext(diagnostics, host);
};

test("keeps desktop image generation renderer boundary emit-safe", () => {
  const repoRoot = process.cwd();
  const configPath = path.join(repoRoot, "apps", "desktop", "tsconfig.webpack.json");
  const configFile = ts.readConfigFile(configPath, (fileName) => fs.readFileSync(fileName, "utf8"));

  assert.equal(configFile.error, undefined, configFile.error ? formatDiagnostics([configFile.error]) : undefined);

  const parsedConfig = ts.parseJsonConfigFileContent(
    configFile.config,
    ts.sys,
    path.dirname(configPath),
    { noEmit: true, incremental: false },
    configPath,
  );

  assert.deepEqual(parsedConfig.errors, [], formatDiagnostics(parsedConfig.errors));

  const rootNames = [
    "apps/desktop/src/renderer/features/image-generation/api/desktopImageGenerationClient.ts",
    "apps/desktop/src/renderer/features/image-generation/hooks/useImageGenerationFeature.ts",
    "apps/desktop/src/renderer/lib/desktopApi.ts",
  ].map((relativePath) => path.join(repoRoot, relativePath));

  const program = ts.createProgram({
    rootNames,
    options: parsedConfig.options,
  });

  const diagnostics = ts.getPreEmitDiagnostics(program);

  assert.equal(diagnostics.length, 0, formatDiagnostics(diagnostics));
});
