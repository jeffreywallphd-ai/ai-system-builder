const path = require('node:path');
const rules = require('./webpack.rules');

/** @type {import('webpack').Configuration} */
module.exports = {
  entry: path.resolve(__dirname, 'src/main/index.ts'),
  module: {
    rules,
  },
  resolve: {
    extensions: ['.js', '.ts', '.tsx', '.json'],
  },
};
