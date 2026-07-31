import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { existsSync } from "node:fs";
import path from "node:path";
import test from "node:test";

const requireFromRoot = createRequire(path.resolve("package.json"));
const forgeConfig = requireFromRoot("./apps/desktop/forge.config.js") as {
  packagerConfig?: {
    ignore?: (file: string) => boolean;
    extraResource?: string[];
  };
  plugins?: Array<{
    config?: {
      renderer?: {
        entryPoints?: Array<{
          name?: string;
          html?: string;
          js?: string;
          preload?: { js?: string };
        }>;
      };
    };
  }>;
};

test("desktop packaging includes the managed Python worker as a resource", () => {
  const resources = forgeConfig.packagerConfig?.extraResource ?? [];
  assert.equal(resources.length, 1);
  assert.equal(path.basename(resources[0] ?? ""), "worker");
  assert.equal(existsSync(path.join(resources[0] ?? "", "main.py")), true);
  assert.equal(
    existsSync(path.join(resources[0] ?? "", "requirements.txt")),
    true,
  );
  assert.equal(
    existsSync(
      path.join(resources[0] ?? "", "tasks", "constrained_json_decoder.py"),
    ),
    true,
  );
});

test("desktop packaging includes only webpack output and excludes runtime data", () => {
  const ignored = forgeConfig.packagerConfig?.ignore;
  assert.equal(typeof ignored, "function");
  for (const path of [
    "/artifacts/runtime-data",
    "/dist/apps",
    "/out/package",
    "/.git/objects",
  ]) {
    assert.equal(
      ignored?.(path),
      true,
      `${path} should be excluded from packaging`,
    );
  }
  assert.equal(ignored?.("/apps/server/.local/server-runtime/model.bin"), true);
  assert.equal(ignored?.("/apps/desktop/src/main/index.ts"), true);
  assert.equal(ignored?.("/.webpack/main/index.js"), false);
  assert.equal(ignored?.("/.webpack/main/index.js.map"), true);
});

test("desktop packaging includes a separately bundled minimal system runtime entry", () => {
  const entries =
    forgeConfig.plugins?.flatMap(
      (plugin) => plugin.config?.renderer?.entryPoints ?? [],
    ) ?? [];
  const runtime = entries.find((entry) => entry.name === "system_runtime");
  assert.ok(runtime);
  assert.match(runtime.html ?? "", /system-runtime[\\/]index\.html$/);
  assert.match(runtime.js ?? "", /system-runtime[\\/]main\.tsx$/);
  assert.match(
    runtime.preload?.js ?? "",
    /system-runtime-preload[\\/]index\.ts$/,
  );
  assert.notEqual(
    runtime.preload?.js,
    entries.find((entry) => entry.name === "main_window")?.preload?.js,
  );
});
