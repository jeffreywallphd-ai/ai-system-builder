const path = require("node:path");

/** @type {import('webpack').Configuration} */
module.exports = {
  module: {
    rules: [
      {
        test: /\.tsx?$/,
        exclude: /node_modules/,
        use: {
          loader: 'ts-loader',
          options: {
            configFile: path.resolve(__dirname, "tsconfig.webpack.json"),
            onlyCompileBundledFiles: true,
          },
        },
      },
      {
        test: /\.css$/,
        use: ['style-loader', 'css-loader'],
      },
      {
        test: /pdf\.worker\.min\.mjs$/i,
        resourceQuery: /url/,
        type: "asset/resource",
      },
      {
        test: /\.(png|svg)$/i,
        type: "asset/resource",
      },
    ],
  },
  resolve: {
    extensions: ['.js', '.ts', '.tsx', '.css'],
  },
};
