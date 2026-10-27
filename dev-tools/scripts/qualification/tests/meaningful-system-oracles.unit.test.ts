import assert from "node:assert/strict";
import test from "node:test";
import {
  canonicalMeaningfulSystem, assertMeaningfulSystemPreserved, assertMeaningfulSystemSet,
  MEANINGFUL_SYSTEM_IDS, type MeaningfulSystemObservation,
} from "../visual-composer/meaningful-system-oracles";

function saved(): MeaningfulSystemObservation {
  return {schemaVersion: "meaningful-system-snapshot-v1", scenarioId: "request-intake",
    workspaceId: "workspace.fixture", systemId: "system.intake", nodes: [
      {id: "root", reference: "builtin.system.system@3.0.0", parent: null, slot: null, order: 0},
      {id: "form", reference: "builtin.form.form@3.0.0", parent: "root", slot: "content", order: 0},
      {id: "field", reference: "builtin.form.text-field@3.0.0", parent: "form", slot: "fields", order: 0},
      {id: "consent", reference: "builtin.form.checkbox-field@3.0.0", parent: "form", slot: "fields", order: 1},
    ], properties: [{instanceId: "field", field: "label", value: "Request description"},
      {instanceId: "consent", field: "required", value: true}]};
}

test("exact saved observations survive harmless enumeration order without changing either input", () => {
  const expected = saved(), observed = saved(); observed.nodes.reverse(); observed.properties.reverse();
  const before = structuredClone([expected, observed]);
  assertMeaningfulSystemPreserved(expected, observed); assert.deepEqual([expected, observed], before);
  Object.freeze(expected.nodes); Object.freeze(expected.properties); Object.freeze(expected);
  assertMeaningfulSystemPreserved(expected, observed);
});

const changes: [string, (value: MeaningfulSystemObservation) => void][] = [
  ["workspace", value => { value.workspaceId = "workspace.other"; }],
  ["system", value => { value.systemId = "system.other"; }],
  ["scenario", value => { value.scenarioId = "operations-dashboard"; }],
  ["instance identity", value => { value.nodes[3]!.id = "substituted"; value.properties[1]!.instanceId = "substituted"; }],
  ["definition", value => { value.nodes[2]!.reference = "builtin.form.number-field@3.0.0"; }],
  ["version", value => { value.nodes[2]!.reference = "builtin.form.text-field@3.0.1"; }],
  ["parent", value => { value.nodes[2]!.parent = "root"; }],
  ["slot", value => { value.nodes[2]!.slot = "actions"; }],
  ["sibling order", value => { value.nodes[2]!.order = 1; value.nodes[3]!.order = 0; }],
  ["text configuration", value => { value.properties[0]!.value = "Lost label"; }],
  ["required configuration", value => { value.properties[1]!.value = false; }],
  ["missing configuration", value => { value.properties.pop(); }],
  ["missing subtree", value => { value.nodes.splice(2); value.properties = []; }],
  ["additional component", value => { value.nodes.push({id: "extra", reference: "builtin.ui.card@3.0.0", parent: "root", slot: "content", order: 1}); }],
];
for (const [name, change] of changes) test(`same-count or plausible ${name} substitution cannot pass as saved content`, () => {
  const observed = saved(); change(observed); assert.throws(() => assertMeaningfulSystemPreserved(saved(), observed));
});

const malformed: [string, (value: any) => void][] = [
  ["schema", value => { value.schemaVersion = "unknown"; }],
  ["unknown scenario", value => { value.scenarioId = "made-up"; }],
  ["extra field", value => { value.token = "synthetic-not-a-credential"; }],
  ["missing field", value => { delete value.systemId; }],
  ["blank identity", value => { value.systemId = ""; }],
  ["control character", value => { value.workspaceId = "workspace.\nother"; }],
  ["duplicate identity", value => { value.nodes[3].id = "field"; }],
  ["duplicate position", value => { value.nodes[3].order = 0; }],
  ["missing parent", value => { value.nodes[2].parent = "absent"; }],
  ["cycle", value => { value.nodes[1].parent = "field"; }],
  ["multiple roots", value => { value.nodes[1].parent = null; value.nodes[1].slot = null; value.nodes[1].order = 1; }],
  ["missing root", value => { value.nodes[0].parent = "field"; value.nodes[0].slot = "content"; }],
  ["unpaired slot", value => { value.nodes[2].slot = null; }],
  ["noninteger order", value => { value.nodes[2].order = 0.5; }],
  ["unversioned reference", value => { value.nodes[2].reference = "builtin.form.text-field"; }],
  ["unknown configured instance", value => { value.properties[0].instanceId = "absent"; }],
  ["duplicate configured field", value => { value.properties.push({...value.properties[0]}); }],
  ["executable value", value => { value.properties[0].value = () => "content"; }],
  ["excessive value", value => { value.properties[0].value = "x".repeat(4097); }],
  ["excessive identities", value => { value.systemId = "x".repeat(257); }],
  ["excessive node count", value => { value.nodes = Array(1025).fill(value.nodes[0]); }],
  ["excessive field count", value => { value.properties = Array(1025).fill(value.properties[0]); }],
  ["excessive encoded bytes", value => { value.properties = Array.from({length: 65}, (_, i) => ({instanceId: "field", field: `field${i}`, value: "x".repeat(4096)})); }],
];
for (const [name, change] of malformed) test(`malformed ${name} is refused with a fixed diagnostic`, () => {
  const value = saved(); change(value); assert.throws(() => canonicalMeaningfulSystem(value), error =>
    error instanceof Error && !error.message.includes("synthetic-not-a-credential"));
});

test("observation getters are refused without executing them", () => {
  const value = saved(); let calls = 0;
  Object.defineProperty(value, "systemId", {get: () => { calls++; return "system.bad"; }, enumerable: true});
  assert.throws(() => canonicalMeaningfulSystem(value)); assert.equal(calls, 0);
});

test("a complete set requires all three distinct systems in the captured workspace", () => {
  const all = MEANINGFUL_SYSTEM_IDS.map((scenarioId, i) => ({...saved(), scenarioId, systemId: `system.${i}`}));
  assert.equal(assertMeaningfulSystemSet(all).length, 3);
  for (const values of [all.slice(1), [...all, all[0]], [all[0], all[0], all[2]],
    [all[0], {...all[1], systemId: all[0]!.systemId}, all[2]],
    [all[0], {...all[1], workspaceId: "workspace.other"}, all[2]]]) assert.throws(() => assertMeaningfulSystemSet(values));
});

for (const field of ["nodes", "properties"] as const) test(`${field} array getters do not execute`, () => {
  const value = saved(), original = value[field][0]; let calls = 0;
  Object.defineProperty(value[field], "0", {get: () => { calls++; return original; }, enumerable: true});
  assert.throws(() => canonicalMeaningfulSystem(value)); assert.equal(calls, 0);
});

for (const field of ["nodes", "properties"] as const) test(`${field} custom iteration does not execute`, () => {
  const value = saved(), original = [...value[field]]; let calls = 0;
  Object.defineProperty(value[field], Symbol.iterator, {value: function* () { calls++; yield* original; }});
  assert.throws(() => canonicalMeaningfulSystem(value)); assert.equal(calls, 0);
});

test("an iterator cannot provide more nodes than its declared array length", () => {
  const value = saved(), original = [...value.nodes]; let calls = 0;
  Object.defineProperty(value.nodes, Symbol.iterator, {value: function* () {
    calls++; yield* original; yield {id: "extra", reference: "builtin.ui.card@3.0.0", parent: "form", slot: "fields", order: 2};
  }});
  assert.throws(() => canonicalMeaningfulSystem(value)); assert.equal(calls, 0);
});

test("sparse, decorated and subclass arrays cannot supply observations", () => {
  const sparse = saved(); delete sparse.nodes[2];
  const decorated = saved(); Object.assign(decorated.properties, {privateField: "synthetic-container-field"});
  const subclass = saved(); Object.setPrototypeOf(subclass.nodes, Object.create(Array.prototype));
  for (const value of [sparse, decorated, subclass]) assert.throws(() => canonicalMeaningfulSystem(value));
});

test("the system-set array cannot override map or indexing", () => {
  const all = MEANINGFUL_SYSTEM_IDS.map((scenarioId, i) => ({...saved(), scenarioId, systemId: `system.${i}`}));
  const mapped = [...all], indexed = [...all]; let mapCalls = 0, indexCalls = 0;
  Object.defineProperty(mapped, "map", {value: () => { mapCalls++; return all.map(canonicalMeaningfulSystem); }});
  Object.defineProperty(indexed, "0", {get: () => { indexCalls++; return all[0]; }, enumerable: true});
  assert.throws(() => assertMeaningfulSystemSet(mapped)); assert.equal(mapCalls, 0);
  assert.throws(() => assertMeaningfulSystemSet(indexed)); assert.equal(indexCalls, 0);
  Object.freeze(all); assert.equal(assertMeaningfulSystemSet(all).length, 3);
});

test("record and array proxies are refused before their traps execute", () => {
  let calls = 0;
  const traps = {getPrototypeOf: () => { calls++; throw new Error("Proxy trap must not execute"); },
    getOwnPropertyDescriptor: () => { calls++; throw new Error("Proxy trap must not execute"); },
    get: () => { calls++; throw new Error("Proxy trap must not execute"); }};
  const record = new Proxy(saved(), traps), nodes = saved(), fields = saved();
  nodes.nodes = new Proxy(nodes.nodes, traps); fields.properties = new Proxy(fields.properties, traps);
  for (const value of [record, nodes, fields]) assert.throws(() => canonicalMeaningfulSystem(value));
  assert.throws(() => assertMeaningfulSystemSet(new Proxy([], traps))); assert.equal(calls, 0);
});

test("revoked array proxies use the fixed refusal path", () => {
  const revoked = Proxy.revocable([], {}); revoked.revoke(); const value = saved(); value.nodes = revoked.proxy;
  assert.throws(() => canonicalMeaningfulSystem(value), /Canvas observation requires plain data arrays/);
  assert.throws(() => assertMeaningfulSystemSet(revoked.proxy), /Canvas observation requires plain data arrays/);
});

test("over-cap arrays are refused before enumerating their descriptors", () => {
  const value = saved(); value.nodes.length = 1025; let enumerations = 0;
  const original = Object.getOwnPropertyDescriptors;
  Object.getOwnPropertyDescriptors = ((input: object) => {
    if (input === value.nodes) enumerations++;
    return original(input);
  }) as typeof original;
  try {
    assert.throws(() => canonicalMeaningfulSystem(value), /Canvas observation array exceeds its count bound/);
    assert.equal(enumerations, 0);
  } finally { Object.getOwnPropertyDescriptors = original; }
});
