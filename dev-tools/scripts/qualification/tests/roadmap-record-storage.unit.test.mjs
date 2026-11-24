import assert from "node:assert/strict";
import {createHash} from "node:crypto";
import {readFileSync, writeFileSync, mkdirSync, mkdtempSync, lstatSync, realpathSync, rmSync} from "node:fs";
import {tmpdir} from "node:os";
import path from "node:path";
import test from "node:test";
import {decodeRoadmapRecordBytes} from "../roadmap-record-storage.mjs";
import {readQualificationJson} from "../functionality-qualification-core.mjs";

const vectors = JSON.parse(readFileSync(new URL("../../../../skills/manage-implementation-roadmaps/tests/fixtures/roadmap-storage-vectors.json", import.meta.url), "utf8"));
const quote = value => JSON.stringify(value).replace(/[\u007f-\uffff]/g, c => "\\u" + c.charCodeAt(0).toString(16).padStart(4, "0"));
const canonical = value => typeof value === "string" ? quote(value) : Array.isArray(value) ? "[" + value.map(canonical).join(",") + "]"
  : value && typeof value === "object" ? "{" + Object.keys(value).sort().map(key => quote(key) + ":" + canonical(value[key])).join(",") + "}" : JSON.stringify(value);
const sha = value => createHash("sha256").update(value).digest("hex");
const rehash = value => {
  value.contentSha256 = sha(canonical({nodes: value.nodes, root: value.root}));
  return Buffer.from(canonical(value));
};
const example = () => JSON.parse(vectors.cases.find(v => v.id === "scalars").encoded_ascii);

for (const vector of vectors.cases) test("protocol vector keeps legacy JS values: " + vector.id, () => {
  assert.deepEqual(decodeRoadmapRecordBytes(Buffer.from(vector.encoded_ascii)), JSON.parse(vector.logical_json));
});

test("negative zero, independent repeated values and prototype names remain data", () => {
  const scalar = decodeRoadmapRecordBytes(Buffer.from(vectors.cases[0].encoded_ascii));
  assert.ok(Object.is(scalar.values[7], -0));
  const repeated = decodeRoadmapRecordBytes(Buffer.from(vectors.cases.find(v => v.id === "independent-repeated-values").encoded_ascii));
  repeated.left.list.push(4); assert.deepEqual(repeated.right.list, [1, 2, 3]);
  const proto = decodeRoadmapRecordBytes(Buffer.from(vectors.cases.find(v => v.id === "prototype-names").encoded_ascii));
  assert.equal(Object.getPrototypeOf(proto), Object.prototype); assert.equal(({}).polluted, undefined);
  assert.equal(Object.hasOwn(proto, "__proto__"), true); assert.equal(proto.__proto__.polluted, "own data");
});

test("canonical encoding admits LF/CRLF and rejects duplicate keys, extra whitespace, invalid UTF8 and BOM", () => {
  const raw = vectors.cases[0].encoded_ascii;
  assert.deepEqual(decodeRoadmapRecordBytes(Buffer.from(raw.replace(/\n$/, "\r\n"))), JSON.parse(vectors.cases[0].logical_json));
  const duplicate = raw.replace('{"contentSha256":', '{"storageVersion":"roadmap-record-tree-v1","contentSha256":');
  for (const bad of [Buffer.from(duplicate), Buffer.from(" " + raw), Buffer.from(raw + "\n"), Buffer.from([0xff]),
    Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from(raw)]), Buffer.alloc(1048577, 32)]) {
    assert.throws(() => decodeRoadmapRecordBytes(bad), /bounded roadmap storage/);
  }
});

test("unknown versions, incorrect hashes and forged graphs fail even after recomputing the data hash", () => {
  for (const cause of ["version", "hash", "forward", "bool-index", "extra-field", "unused", "raw-number"]) {
    const value = example(), node = value.nodes.at(-1);
    if (cause === "version") value.storageVersion = "unknown";
    else if (cause === "hash") value.contentSha256 = "0".repeat(64);
    else if (cause === "forward") node.value[0][1] = ["ref", value.nodes.length - 1];
    else if (cause === "bool-index") value.root[1] = true;
    else if (cause === "extra-field") node.extra = true;
    else if (cause === "unused") node.value = [];
    else node.value[0][1] = 1;
    assert.throws(() => decodeRoadmapRecordBytes(cause === "hash" ? Buffer.from(canonical(value)) : rehash(value)), /bounded roadmap storage/, cause);
  }
});

test("numeric token ambiguity and nonfinite values are denied", () => {
  for (const atom of [["integer", "-0"], ["integer", "01"], ["integer", "1\n"], ["integer", "1".repeat(4301)],
    ["float", "7ff0000000000000"], ["float", "7ff8000000000000"], ["float", "0000000000000000\n"]]) {
    const value = example(); value.nodes.at(-1).value[0][1] = atom;
    assert.throws(() => decodeRoadmapRecordBytes(rehash(value)), /bounded roadmap storage/);
  }
});

test("weighted expansion is denied before a second JSON parse can allocate the logical tree", () => {
  const nodes = [{kind: "array", value: []}];
  for (let i = 1; i < 20; i++) nodes.push({kind: "array", value: [["ref", i - 1], ["ref", i - 1]]});
  nodes.push({kind: "object", value: [["tree", ["ref", nodes.length - 1]]]});
  const raw = rehash({storageVersion: "roadmap-record-tree-v1", contentSha256: "", root: ["ref", nodes.length - 1], nodes});
  const parse = JSON.parse; let calls = 0;
  JSON.parse = (...args) => {calls++; return parse(...args);};
  try {assert.throws(() => decodeRoadmapRecordBytes(raw), /bounded roadmap storage/);}
  finally {JSON.parse = parse;}
  assert.equal(calls, 1);
});

test("qualification reader keeps the raw file digest and legacy-equivalent values", t => {
  const parent = realpathSync(tmpdir()), root = realpathSync(mkdtempSync(path.join(parent, "roadmap-record-"))), identity = lstatSync(root);
  t.after(() => {
    const current = lstatSync(root);
    assert.ok(current.isDirectory() && !current.isSymbolicLink()); assert.equal(current.dev, identity.dev); assert.equal(current.ino, identity.ino);
    assert.equal(realpathSync(root), root); assert.equal(path.dirname(root), parent); rmSync(root, {recursive: true});
  });
  const relative = ".implementation-roadmaps/example/state.json", target = path.join(root, relative);
  mkdirSync(path.dirname(target), {recursive: true});
  const vector = vectors.cases[0], encoded = Buffer.from(vector.encoded_ascii);
  writeFileSync(target, encoded);
  const observed = readQualificationJson(root, relative);
  assert.equal(observed.digest, sha(encoded)); assert.deepEqual(observed.value, JSON.parse(vector.logical_json));
  writeFileSync(target, vector.logical_json);
  const legacy = readQualificationJson(root, relative);
  assert.deepEqual(legacy.value, observed.value); assert.notEqual(legacy.digest, observed.digest);
  writeFileSync(target, " " + vector.encoded_ascii); assert.throws(() => readQualificationJson(root, relative));
});
