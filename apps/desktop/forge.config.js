const path = require("node:path");
const { MakerSquirrel } = require("@electron-forge/maker-squirrel");
const { MakerZIP } = require("@electron-forge/maker-zip");
const { buildWindowsOcrResource } = require("../../dev-tools/scripts/native/build_windows_ocr.cjs");

/** @type {import('@electron-forge/shared-types').ForgeConfig} */
module.exports = {
  hooks: {
    generateAssets: async (_config, platform, arch) => buildWindowsOcrResource(platform, arch),
  },
  packagerConfig: {
    extraResource: [
      path.resolve(__dirname, "../../modules/adapters/runtime/python/worker"),
    ],
    // Package only generated bundles. The
    // plugin writes package.json during packageAfterCopy.
    ignore: (file) => {
      if (!file) return false;
      if (/[^/\\]+\.[cm]?js\.map$/.test(file)) return true;
      return !/^[/\\]\.vite($|[/\\]).*$/.test(file);
    },
  },
  makers: [new MakerSquirrel({}), new MakerZIP({}, ["darwin"])],
  plugins: [
    {
      name: "@electron-forge/plugin-vite",
      config: {
        concurrent: 1,
        hotRestart: true,
        build: [
          { entry: { main: "apps/desktop/src/main/index.ts" }, config: "apps/desktop/vite.main.config.mjs", target: "main" },
          { entry: { main_window_preload: "apps/desktop/src/preload/index.ts" }, config: "apps/desktop/vite.preload.config.mjs", target: "preload" },
          { entry: { system_runtime_preload: "apps/desktop/src/system-runtime-preload/index.ts" }, config: "apps/desktop/vite.preload.config.mjs", target: "preload" },
        ],
        renderer: [
          { name: "main_window", config: "apps/desktop/vite.renderer.config.mjs" },
          { name: "system_runtime", config: "apps/desktop/vite.runtime.config.mjs" },
        ],
      },
    },
  ],
};
