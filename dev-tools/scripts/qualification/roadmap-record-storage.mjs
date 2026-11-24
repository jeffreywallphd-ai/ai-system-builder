/** Bounded roadmap storage only. Content integrity is not approval authority. */
import {createHash} from "node:crypto";
import {TextDecoder} from "node:util";

const VERSION = "roadmap-record-tree-v1";
const PHYSICAL = 1048576, EXPANDED = 8388608, POOL = 65536, CONTAINERS = 262144, DEPTH = 64;
const fail = () => {throw new Error("The bounded roadmap storage is missing, malformed or unsupported.");};
const own = (value, key) => Object.prototype.hasOwnProperty.call(value, key);
const object = value => value !== null && typeof value === "object" && !Array.isArray(value);
const fields = (value, expected) => object(value) && Object.keys(value).length === expected.length && expected.every(key => own(value, key));
const sha = text => createHash("sha256").update(text, "ascii").digest("hex");
const quote = value => JSON.stringify(value).replace(/[\u007f-\uffff]/g, c => "\\u" + c.charCodeAt(0).toString(16).padStart(4, "0"));
// No raw numeric payloads occur in this envelope: only small integer indices.
function canonical(value) {
  if (value === null || typeof value === "boolean") return JSON.stringify(value);
  if (typeof value === "string") return quote(value);
  if (typeof value === "number") {
    if (!Number.isInteger(value) || value < 0 || value >= POOL || Object.is(value, -0)) fail();
    return String(value);
  }
  if (Array.isArray(value)) return "[" + value.map(canonical).join(",") + "]";
  if (!object(value)) fail();
  return "{" + Object.keys(value).sort().map(key => quote(key) + ":" + canonical(value[key])).join(",") + "}";
}
function compareCodePoints(a, b) {
  const left = Array.from(a), right = Array.from(b);
  for (let i = 0; i < Math.min(left.length, right.length); i++) {
    const difference = left[i].codePointAt(0) - right[i].codePointAt(0);
    if (difference) return difference;
  }
  return left.length - right.length;
}
const reference = (atom, before) => Array.isArray(atom) && atom.length === 2 && atom[0] === "ref" &&
  typeof atom[1] === "number" && Number.isInteger(atom[1]) && !Object.is(atom[1], -0) && atom[1] >= 0 && atom[1] < before;
function number(atom) {
  const [tag, value] = atom;
  if (typeof value !== "string") fail();
  if (tag === "integer") {
    if (value.match(/^-?(?:0|[1-9][0-9]*)/u)?.[0] !== value || value === "-0" || value.replace(/^-/, "").length > 4300) fail();
    return [value, value.length];
  }
  if (tag !== "float" || value.length !== 16 || !/^[0-9a-f]{16}$/u.test(value)) fail();
  const decoded = Buffer.from(value, "hex").readDoubleBE();
  if (!Number.isFinite(decoded)) fail();
  // Ordinary JS values must match JSON.parse of the previous logical JSON.
  return [Object.is(decoded, -0) ? "-0.0" : String(decoded), 32];
}
function preflight(envelope) {
  if (!fields(envelope, ["storageVersion", "contentSha256", "root", "nodes"]) || envelope.storageVersion !== VERSION ||
      typeof envelope.contentSha256 !== "string" || !/^[0-9a-f]{64}$/u.test(envelope.contentSha256)) fail();
  const {nodes, root} = envelope;
  if (!Array.isArray(nodes) || nodes.length < 1 || nodes.length > POOL || !reference(root, nodes.length) || root[1] !== nodes.length - 1) fail();
  const stats = [], edges = [], unique = new Set();
  const bound = (bytes, count, depth) => {if (bytes > EXPANDED || count > CONTAINERS || depth > DEPTH) fail();};
  function atomStats(atom, index, children) {
    if (reference(atom, index)) {children.push(atom[1]); return stats[atom[1]];}
    if (atom === null) return [4, 0, 0];
    if (typeof atom === "boolean") return [atom ? 4 : 5, 0, 0];
    if (typeof atom === "string") return [quote(atom).length, 0, 0];
    if (Array.isArray(atom) && atom.length === 2 && ["integer", "float"].includes(atom[0])) return [number(atom)[1], 0, 0];
    fail();
  }
  for (let index = 0; index < nodes.length; index++) {
    const node = nodes[index];
    if (!fields(node, ["kind", "value"]) || !["object", "array"].includes(node.kind) || !Array.isArray(node.value)) fail();
    let bytes = 2 + Math.max(0, node.value.length - 1), count = 1, depth = 1, previous;
    const children = [];
    for (const item of node.value) {
      let atom = item;
      if (node.kind === "object") {
        if (!Array.isArray(item) || item.length !== 2 || typeof item[0] !== "string" ||
            previous !== undefined && compareCodePoints(item[0], previous) <= 0) fail();
        previous = item[0]; bytes += quote(item[0]).length + 1; atom = item[1];
      }
      const [size, containers, childDepth] = atomStats(atom, index, children);
      bytes += size; count += containers; depth = Math.max(depth, childDepth + 1); bound(bytes, count, depth);
    }
    bound(bytes, count, depth); stats.push([bytes, count, depth]); edges.push(children);
    const token = canonical(node); if (unique.has(token)) fail(); unique.add(token);
  }
  if (nodes[root[1]].kind !== "object") fail();
  const reachable = new Set(), pending = [root[1]];
  while (pending.length) {
    const index = pending.pop();
    if (!reachable.has(index)) {reachable.add(index); for (const child of edges[index]) pending.push(child);}
  }
  if (reachable.size !== nodes.length || sha(canonical({nodes, root})) !== envelope.contentSha256) fail();
}

export function decodeRoadmapRecordBytes(raw) {
  try {
    if (!Buffer.isBuffer(raw) || raw.byteLength > PHYSICAL || raw[0] === 0xef && raw[1] === 0xbb && raw[2] === 0xbf) fail();
    const text = new TextDecoder("utf-8", {fatal: true}).decode(raw), value = JSON.parse(text);
    if (!object(value)) fail();
    if (!own(value, "storageVersion")) return value;
    preflight(value);
    const content = text.endsWith("\r\n") ? text.slice(0, -2) : text.endsWith("\n") ? text.slice(0, -1) : text;
    // Exact canonical comparison also detects duplicate keys hidden by JSON.parse.
    if (content !== canonical(value)) fail();
    const parts = [], nodes = value.nodes;
    function emit(atom) {
      if (reference(atom, nodes.length)) {
        const node = nodes[atom[1]], isObject = node.kind === "object";
        parts.push(isObject ? "{" : "[");
        node.value.forEach((item, index) => {
          if (index) parts.push(",");
          if (isObject) {parts.push(quote(item[0]), ":"); emit(item[1]);} else emit(item);
        });
        parts.push(isObject ? "}" : "]");
      } else if (Array.isArray(atom)) parts.push(number(atom)[0]);
      else parts.push(typeof atom === "string" ? quote(atom) : JSON.stringify(atom));
    }
    emit(value.root);
    // Native JSON parsing creates ordinary independent own properties, including
    // literal __proto__/constructor names, without property-assignment pollution.
    return JSON.parse(parts.join(""));
  } catch {fail();}
}
