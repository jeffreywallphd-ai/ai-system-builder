const path = require('node:path');
const { MakerSquirrel } = require('@electron-forge/maker-squirrel');
const { MakerZIP } = require('@electron-forge/maker-zip');
const { WebpackPlugin } = require('@electron-forge/plugin-webpack');

const mainConfig = require('./webpack.main.config');
const rendererConfig = require('./webpack.renderer.config');

/** @type {import('@electron-forge/shared-types').ForgeConfig} */
module.exports = {
  packagerConfig: {},
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
        ],
      },
    }),
  ],
};
