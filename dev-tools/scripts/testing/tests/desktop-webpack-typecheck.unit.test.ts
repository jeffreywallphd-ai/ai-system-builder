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
  it("typechecks the Hugging Face artifact repo storage adapter under desktop webpack tsconfig", () => {
    const repoRoot = process.cwd();
    const configPath = path.resolve(repoRoot, "apps/desktop/tsconfig.webpack.json");
    const targetFile = path.resolve(
      repoRoot,
      "modules/adapters/storage/huggingface/createHuggingFaceArtifactRepoStorageAdapter.ts",
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
      `Expected no TypeScript diagnostics for the Hugging Face artifact repo storage adapter.\n${diagnostics.map(formatDiagnostic).join("\n")}`,
    );
  });

  it("typechecks the desktop host composition dependency closure under desktop webpack tsconfig", () => {
    const repoRoot = process.cwd();
    const configPath = path.resolve(repoRoot, "apps/desktop/tsconfig.webpack.json");
    const targetFile = path.resolve(
      repoRoot,
      "modules/hosts/desktop/composition/composeDesktopHost.ts",
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
      .filter((diagnostic) => !diagnostic.file?.fileName.includes(`${path.sep}node_modules${path.sep}`));

    assert.deepEqual(
      diagnostics,
      [],
      `Expected no TypeScript diagnostics for desktop host composition dependency closure.\n${diagnostics.map(formatDiagnostic).join("\n")}`,
    );
  });

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

  it("typechecks the desktop models renderer surfaces under desktop webpack tsconfig", () => {
    const repoRoot = process.cwd();
    const configPath = path.resolve(repoRoot, "apps/desktop/tsconfig.webpack.json");
    const targetFiles = [
      "apps/desktop/src/renderer/features/models/hooks/useModelsFeature.ts",
      "apps/desktop/src/renderer/features/models/api/desktopModelsClient.ts",
      "modules/contracts/model/model-management-operations.ts",
    ].map((relativePath) => path.resolve(repoRoot, relativePath));

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
      rootNames: targetFiles,
      options: parsedConfig.options,
    });
    const diagnostics = ts
      .getPreEmitDiagnostics(program)
      .filter((diagnostic) => !diagnostic.file?.fileName.includes(`${path.sep}node_modules${path.sep}`));

    assert.deepEqual(
      diagnostics,
      [],
      `Expected no TypeScript diagnostics for desktop models renderer surfaces.\n${diagnostics.map(formatDiagnostic).join("\n")}`,
    );
  });

  it("typechecks the desktop artifact browser renderer download and media surfaces under desktop webpack tsconfig", () => {
    const repoRoot = process.cwd();
    const configPath = path.resolve(repoRoot, "apps/desktop/tsconfig.webpack.json");
    const targetFiles = [
      "apps/desktop/src/renderer/features/artifact-browser/components/ArtifactBrowserFeature.tsx",
      "apps/desktop/src/renderer/features/artifact-browser/api/desktopArtifactBrowserClient.ts",
      "apps/desktop/src/renderer/features/artifact-browser/helpers/artifactMediaBytes.ts",
    ].map((relativePath) => path.resolve(repoRoot, relativePath));

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
      rootNames: targetFiles,
      options: parsedConfig.options,
    });
    const diagnostics = ts
      .getPreEmitDiagnostics(program)
      .filter((diagnostic) => !diagnostic.file?.fileName.includes(`${path.sep}node_modules${path.sep}`));

    assert.deepEqual(
      diagnostics,
      [],
      `Expected no TypeScript diagnostics for desktop artifact browser renderer media surfaces.\n${diagnostics.map(formatDiagnostic).join("\n")}`,
    );
  });

  it("typechecks the desktop dataset preparation progress hook under desktop webpack tsconfig", () => {
    const repoRoot = process.cwd();
    const configPath = path.resolve(repoRoot, "apps/desktop/tsconfig.webpack.json");
    const targetFile = path.resolve(
      repoRoot,
      "apps/desktop/src/renderer/features/dataset-preparation/hooks/modelDownloadProgress.ts",
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
      `Expected no TypeScript diagnostics for desktop dataset preparation progress hook.\n${diagnostics.map(formatDiagnostic).join("\n")}`,
    );
  });
});
