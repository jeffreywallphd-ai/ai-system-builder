"use strict";

const upstream = require("brace-expansion-upstream");

if (typeof upstream.expand !== "function") {
  throw new TypeError("Patched brace-expansion must export expand().");
}

function expand(pattern, options) {
  return upstream.expand(pattern, options);
}

Object.assign(expand, upstream, { expand });
module.exports = expand;
