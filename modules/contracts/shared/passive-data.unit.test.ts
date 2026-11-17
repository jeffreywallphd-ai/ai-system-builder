import assert from "node:assert/strict";
import { describe, it } from "../../testing/node-test";
import {
  normalizePassiveMetadata,
  normalizePassiveText,
  readStrictPassiveRecord,
  passiveRecord,
  passiveText,
  passiveArray,
  hasKnownPassiveCredential,
} from ".";

describe("bounded explicit passive DTO schemas", () => {
  it("denies recognizable credentials in public text and nested metadata", () => {
    for (const prefix of ["ghp_", "gho_", "github_pat_", "sk-proj-", "sk-", "sk_", "hf_", "xoxb-"]) {
      const value = prefix + "syntheticvalue".repeat(3);
      assert.equal(hasKnownPassiveCredential(value), true);
      assert.throws(() => normalizePassiveText(value));
      assert.throws(() => normalizePassiveMetadata({nested:{value}}));
    }
    assert.equal(hasKnownPassiveCredential("Review credentials before use."), false);
  });
  const normalize = passiveRecord<{values: string[]}>({values: passiveArray(passiveText)});
  it("checks dense array descriptors, prototypes and extra keys before evaluating values", () => {
    let calls = 0;
    const accessor: string[] = [];
    Object.defineProperty(accessor, "0", {enumerable:true,get(){calls++;return "Ready";}});
    const extra = Object.assign(["Ready"], {extra:"private"});
    for (const values of [accessor, extra, new Array(2), Object.setPrototypeOf(["Ready"], null)]) {
      assert.throws(() => normalize({values}));
    }
    assert.equal(calls, 0);
    assert.deepEqual(normalize({values:["Ready"]}), {values:["Ready"]});
  });
  it("bounds whole-record depth, nodes and encoded bytes before schema reconstruction", () => {
    const inspect = passiveRecord<{value:unknown}>({value:v=>v});
    let deep: unknown = "Ready";
    for (let i=0;i<14;i++) deep={nested:deep};
    const cycle: any = {}; cycle.nested=cycle;
    for (const value of [deep,cycle,Array.from({length:8},()=>new Array(600).fill(false)),
      new Array(300).fill("é".repeat(1000)),"x".repeat(2049),new Date(),NaN]) {
      assert.throws(() => inspect({value}), /invalid/);
    }
  });
});

describe("bounded passive boundary data", () => {
  it("preserves safe primitive meanings, nesting and schema-permitted arrays", () => {
    const safe = {
      count: 0,
      enabled: false,
      absent: null,
      nested: { label: "Ready", count: 2 },
    };
    const result = normalizePassiveMetadata(safe);
    assert.deepEqual(result, safe);
    assert.notEqual(result, safe);
    assert.notEqual(result?.nested, safe.nested);
    assert.deepEqual(
      normalizePassiveMetadata(
        { labels: ["Ready", 0, false, null, { result: "Allowed" }] },
        { allowArrays: true },
      ),
      { labels: ["Ready", 0, false, null, { result: "Allowed" }] },
    );
    assert.throws(() => normalizePassiveMetadata({ labels: ["Ready"] }));
    assert.throws(() => normalizePassiveMetadata([], { allowArrays: true }));
  });

  it("rejects compound protected keys, actual paths and encoded/raw representations", () => {
    for (const key of [
      "accessToken",
      "refresh_token",
      "OPENAI_API_KEY",
      "api-key",
      "databasePassword",
      "credentialReference",
      "Authorization",
      "PRIVATE_KEY",
      "rawResponse",
      "providerPayload",
      "process.env",
      "filePath",
      "signedURL",
    ]) {
      assert.throws(
        () => normalizePassiveMetadata({ nested: { [key]: "synthetic" } }),
        /Passive boundary data is invalid/,
      );
    }
    for (const value of [
      "/private/example",
      "See /opt/example",
      "at(/srv/example)",
      "C:\\private\\example",
      "\\\\host\\share",
      "../private",
      "file:///synthetic",
      "Bearer synthetic-value",
      "-----BEGIN PRIVATE KEY-----",
      '{"example":"synthetic"}',
      "Y".repeat(100),
    ]) {
      assert.throws(() => normalizePassiveMetadata({ label: value }));
      assert.throws(() => normalizePassiveText(value));
    }
    assert.equal(normalizePassiveText("  Safe result  "), "Safe result");
  });

  it("rejects nonJSON, accessors and dangerous keys without evaluating getters", () => {
    let calls = 0;
    const accessor = Object.defineProperty({}, "label", {
      enumerable: true,
      get: () => {
        calls++;
        return "private";
      },
    });
    const arrayAccessor = ["safe"];
    Object.defineProperty(arrayAccessor, "0", {
      enumerable: true,
      get: () => {
        calls++;
        return "private";
      },
    });
    const circular: Record<string, unknown> = {};
    circular.nested = circular;
    for (const value of [
      accessor,
      circular,
      { value: NaN },
      { value: Infinity },
      { value: undefined },
      { value: 1n },
      { value: () => true },
      { value: new Date() },
      { value: new Map() },
      { value: new Uint8Array(2) },
      JSON.parse('{"__proto__":{}}'),
      { constructor: "synthetic" },
      { [Symbol("synthetic")]: "safe" },
      { list: arrayAccessor },
    ]) {
      assert.throws(() =>
        normalizePassiveMetadata(value, { allowArrays: true }),
      );
    }
    assert.equal(calls, 0);
    assert.throws(() => readStrictPassiveRecord(accessor, ["label"]));
    assert.equal(calls, 0);
  });

  it("bounds depth, nodes, collection counts, strings and total encoded bytes", () => {
    let deep: unknown = "safe";
    for (let n = 0; n < 10; n++) deep = { nested: deep };
    const manyKeys = Object.fromEntries(
      Array.from({ length: 65 }, (_, n) => [`item${n}`, n]),
    );
    const tooManyNodes = {
      items: Array.from({ length: 128 }, () =>
        Array.from({ length: 9 }, () => 0),
      ),
    };
    const tooManyBytes = Object.fromEntries(
      Array.from({ length: 40 }, (_, n) => [`item${n}`, "界".repeat(700)]),
    );
    for (const value of [
      deep,
      manyKeys,
      tooManyNodes,
      tooManyBytes,
      { label: "a ".repeat(2000) },
      { items: Array(129).fill(0) },
      { items: new Array(2) },
    ])
      assert.throws(() =>
        normalizePassiveMetadata(value, { allowArrays: true }),
      );
  });

  it("strict records admit declared DTO keys without applying metadata key filters", () => {
    assert.deepEqual(
      readStrictPassiveRecord(
        { sourceGraphSummary: { nodeCount: 0 }, authoredAssetId: "opaque.a" },
        ["sourceGraphSummary", "authoredAssetId"],
      ),
      { sourceGraphSummary: { nodeCount: 0 }, authoredAssetId: "opaque.a" },
    );
    assert.throws(() =>
      readStrictPassiveRecord({ label: "safe", extra: "synthetic" }, ["label"]),
    );
    assert.throws(() => readStrictPassiveRecord(new Date(), []));
  });
});


it("denies Windows rooted and drive-relative paths in descriptive metadata", () => {
 for (const value of [String.raw`\Users\synthetic\private.txt`, String.raw`C:private.txt`, String.raw`at \synthetic\file`, String.raw`see C:synthetic`, String.raw`C:`, String.raw`C: `, String.raw`C: private.txt`, String.raw`see C: private.txt`]) {
  assert.throws(() => normalizePassiveMetadata({label:value}));
  assert.throws(() => normalizePassiveText(value));
 }
 assert.equal(normalizePassiveText("A useful status summary"),"A useful status summary");
 assert.equal(normalizePassiveText("Status: available"),"Status: available");
});
