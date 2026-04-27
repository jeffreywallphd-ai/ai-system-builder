const path = require("node:path");

module.exports = [
  {
    test: /native_modules\\.+\.node$/,
    use: 'node-loader',
  },
  {
    test: /\.(m?js|node)$/,
    parser: {
      amd: false,
    },
    use: {
      loader: '@vercel/webpack-asset-relocator-loader',
      options: {
        outputAssetBase: 'native_modules',
      },
    },
  },
  {
    test: /\.tsx?$/,
    exclude: /(node_modules|\.webpack)/,
    use: {
      loader: 'ts-loader',
      options: {
        configFile: path.resolve(__dirname, "tsconfig.webpack.json"),
        onlyCompileBundledFiles: true,
      },
    },
  },
];
