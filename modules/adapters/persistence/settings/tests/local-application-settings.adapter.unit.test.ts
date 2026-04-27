import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { describe, expect, it } from "../../../../testing/node-test";

import { createLocalApplicationSettingsAdapter } from "../createLocalApplicationSettingsAdapter";
import type { ApplicationSettingDefinition } from "../../../../contracts/settings";

const DEFINITIONS: ApplicationSettingDefinition[] = [
  {
    key: "huggingface.defaultNamespace",
    category: "huggingface",
    label: "Namespace",
    valueKind: "string",
  },
  {
    key: "models.default",
    category: "models",
    label: "Model",
    valueKind: "object",
  },
];

describe("createLocalApplicationSettingsAdapter", () => {
  it("reads, writes, and updates individual settings keys", async () => {
    const dir = await mkdtemp(join(tmpdir(), "app-settings-"));
    const path = join(dir, "settings.json");
    const adapter = createLocalApplicationSettingsAdapter({ filePath: path, definitions: DEFINITIONS });

    await adapter.updateValue({ key: "huggingface.defaultNamespace", value: "team-a" });
    await adapter.updateValue({ key: "models.default", value: { modelId: "google/flan-t5-small", inferenceMode: "text2text" } });

    const values = await adapter.readValues({ keys: ["huggingface.defaultNamespace", "models.default"] });
    expect(values).toEqual([
      { key: "huggingface.defaultNamespace", configured: true, value: "team-a" },
      { key: "models.default", configured: true, value: { modelId: "google/flan-t5-small", inferenceMode: "text2text" } },
    ]);

    await adapter.clearValue({ key: "huggingface.defaultNamespace" });
    const cleared = await adapter.readValues({ keys: ["huggingface.defaultNamespace"] });
    expect(cleared).toEqual([{ key: "huggingface.defaultNamespace", configured: false, value: undefined }]);
  });

  it("preserves unknown document keys when writing settings", async () => {
    const dir = await mkdtemp(join(tmpdir(), "app-settings-"));
    const path = join(dir, "settings.json");
    await writeFile(path, JSON.stringify({ schemaVersion: 2, settings: { untouched: "keep" } }), "utf8");

    const adapter = createLocalApplicationSettingsAdapter({ filePath: path, definitions: DEFINITIONS });
    await adapter.updateValue({ key: "huggingface.defaultNamespace", value: "team-b" });

    const document = JSON.parse(await readFile(path, "utf8")) as Record<string, unknown>;
    expect(document.schemaVersion).toBe(2);
    expect(document.settings).toEqual({
      untouched: "keep",
      "huggingface.defaultNamespace": "team-b",
    });
  });
});

  it("never persists secret values in local settings storage", async () => {
    const dir = await mkdtemp(join(tmpdir(), "app-settings-"));
    const path = join(dir, "settings.json");
    const adapter = createLocalApplicationSettingsAdapter({
      filePath: path,
      definitions: [
        ...DEFINITIONS,
        {
          key: "huggingface.token",
          category: "huggingface",
          label: "Token",
          valueKind: "secret",
          sensitive: true,
        },
      ],
    });

    await expect(adapter.updateValue({ key: "huggingface.token", value: "hf_secret" })).rejects.toThrow(
      'Secret setting "huggingface.token" must be stored via ApplicationSecretsPort.',
    );
  });
