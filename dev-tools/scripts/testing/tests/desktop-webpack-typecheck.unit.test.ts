import assert from "node:assert/strict";
import path from "node:path";
import { describe, it } from "node:test";
import ts from "typescript";
import { fileURLToPath } from "node:url";

function formatDiagnostic(diagnostic: ts.Diagnostic): string {
  const message = ts.flattenDiagnosticMessageText(diagnostic.messageText, "\n");
  if (!diagnostic.file || diagnostic.start === undefined) {
    return message;
  }

  const position = diagnostic.file.getLineAndCharacterOfPosition(diagnostic.start);
  const filePath = path.relative(process.cwd(), diagnostic.file.fileName).split(path.sep).join("/");
  return `${filePath}:${position.line + 1}:${position.character + 1} ${message}`;
}

describe("desktop webpack typecheck", () => {
  it("typechecks the python runtime footer hook under desktop webpack tsconfig", () => {
    const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../..");
    const configPath = path.resolve(repoRoot, "apps/desktop/tsconfig.webpack.json");
    const targetFile = path.resolve(
      repoRoot,
      "apps/desktop/src/renderer/features/python-runtime/hooks/usePythonRuntimeFooter.ts",
    );

    const configFile = ts.readConfigFile(configPath, ts.sys.readFile);
    if (configFile.error) {
      assert.fail(formatDiagnostic(configFile.error));
    }

    const parsedConfig = ts.parseJsonConfigFileContent(
      configFile.config,
      ts.sys,
      path.dirname(configPath),
      { noEmit: true },
      configPath,
    );

    const program = ts.createProgram({
      rootNames: [targetFile],
      options: parsedConfig.options,
    });
    const diagnostics = ts
      .getPreEmitDiagnostics(program)
      .filter((diagnostic) => diagnostic.file?.fileName === targetFile);

    assert.deepEqual(
      diagnostics,
      [],
      `Expected no TypeScript diagnostics for python runtime footer hook.\n${diagnostics.map(formatDiagnostic).join("\n")}`,
    );
  });

  it("typechecks the default model resolver under desktop webpack tsconfig", () => {
    const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../..");
    const configPath = path.resolve(repoRoot, "apps/desktop/tsconfig.webpack.json");
    const targetFile = path.resolve(
      repoRoot,
      "modules/application/services/settings/default-model-default-resolver.ts",
    );

    const configFile = ts.readConfigFile(configPath, ts.sys.readFile);
    if (configFile.error) {
      assert.fail(formatDiagnostic(configFile.error));
    }

    const parsedConfig = ts.parseJsonConfigFileContent(
      configFile.config,
      ts.sys,
      path.dirname(configPath),
      { noEmit: true },
      configPath,
    );

    const program = ts.createProgram({
      rootNames: [targetFile],
      options: parsedConfig.options,
    });
    const diagnostics = ts
      .getPreEmitDiagnostics(program)
      .filter((diagnostic) => diagnostic.file?.fileName === targetFile);

    assert.deepEqual(
      diagnostics,
      [],
      `Expected no TypeScript diagnostics for default model resolver.\n${diagnostics.map(formatDiagnostic).join("\n")}`,
    );
  });

  it("typechecks the application settings IPC adapter under desktop webpack tsconfig", () => {
    const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../..");
    const configPath = path.resolve(repoRoot, "apps/desktop/tsconfig.webpack.json");
    const targetFile = path.resolve(
      repoRoot,
      "modules/adapters/transport/ipc-electron/settings/registerApplicationSettingsIpc.ts",
    );

    const configFile = ts.readConfigFile(configPath, ts.sys.readFile);
    if (configFile.error) {
      assert.fail(formatDiagnostic(configFile.error));
    }

    const parsedConfig = ts.parseJsonConfigFileContent(
      configFile.config,
      ts.sys,
      path.dirname(configPath),
      { noEmit: true },
      configPath,
    );

    const program = ts.createProgram({
      rootNames: [targetFile],
      options: parsedConfig.options,
    });
    const diagnostics = ts
      .getPreEmitDiagnostics(program)
      .filter((diagnostic) => diagnostic.file?.fileName === targetFile);

    assert.deepEqual(
      diagnostics,
      [],
      `Expected no TypeScript diagnostics for application settings IPC adapter.\n${diagnostics.map(formatDiagnostic).join("\n")}`,
    );
  });
});
