const path = require('node:path');
const { MakerSquirrel } = require('@electron-forge/maker-squirrel');
const { MakerZIP } = require('@electron-forge/maker-zip');
const { WebpackPlugin } = require('@electron-forge/plugin-webpack');

const mainConfig = require('./webpack.main.config');
const rendererConfig = require('./webpack.renderer.config');

/** @type {import('@electron-forge/shared-types').ForgeConfig} */
module.exports = {
  packagerConfig: {
    // Mirror the webpack plugin's default: package only generated bundles. The
    // plugin writes package.json during packageAfterCopy.
    ignore: (file) => {
      if (!file) return false;
      if (/[^/\\]+\.js\.map$/.test(file)) return true;
      return !/^[/\\]\.webpack($|[/\\]).*$/.test(file);
    },
  },
  makers: [
    new MakerSquirrel({}),
    new MakerZIP({}, ['darwin']),
  ],
  plugins: [
    new WebpackPlugin({
      port: 3005,
      mainConfig,
      renderer: {
        config: rendererConfig,
        entryPoints: [
          {
            html: path.resolve(__dirname, 'src/renderer/index.html'),
            js: path.resolve(__dirname, 'src/renderer/main.tsx'),
            name: 'main_window',
            preload: {
              js: path.resolve(__dirname, 'src/preload/index.ts'),
            },
          },
          {
            html: path.resolve(__dirname, 'src/system-runtime/index.html'),
            js: path.resolve(__dirname, 'src/system-runtime/main.tsx'),
            name: 'system_runtime',
            preload: {
              js: path.resolve(
                __dirname,
                'src/system-runtime-preload/index.ts',
              ),
            },
          },
        ],
      },
    }),
  ],
};
