import assert from "node:assert/strict";
import { isDeepStrictEqual, types } from "node:util";

export const MEANINGFUL_SYSTEM_IDS = ["request-intake", "operations-dashboard", "conversation-interface"] as const;
export interface CanvasNodeObservation {
  id: string; reference: string; parent: string | null; slot: string | null; order: number;
}
export interface CanvasPropertyObservation { instanceId: string; field: string; value: string | boolean; }
export interface MeaningfulSystemObservation {
  schemaVersion: "meaningful-system-snapshot-v1";
  scenarioId: string; workspaceId: string; systemId: string;
  nodes: CanvasNodeObservation[]; properties: CanvasPropertyObservation[];
}

function record(value: unknown, keys: string[]): asserts value is Record<string, unknown> {
  assert(value && typeof value === "object" && !types.isProxy(value) && Object.getPrototypeOf(value) === Object.prototype,
    "Canvas observation must contain plain records.");
  assert(Object.getOwnPropertySymbols(value).length === 0 &&
    isDeepStrictEqual(Object.keys(Object.getOwnPropertyDescriptors(value)).sort(), [...keys].sort()) &&
    Object.values(Object.getOwnPropertyDescriptors(value)).every(descriptor => "value" in descriptor),
    "Canvas observation contains missing, unexpected or executable fields.");
}
function text(value: unknown, limit: number): asserts value is string {
  assert(typeof value === "string" && value.length > 0 && Buffer.byteLength(value, "utf8") <= limit &&
    !/[\u0000-\u001f\u007f]/.test(value), "Canvas observation text is missing or exceeds its bound.");
}
const compare = (a: string, b: string) => a < b ? -1 : a > b ? 1 : 0;

function dataArray(value: unknown, limit: number): unknown[] {
  assert(!types.isProxy(value) && Array.isArray(value) && Object.getPrototypeOf(value) === Array.prototype,
    "Canvas observation requires plain data arrays.");
  const length = Object.getOwnPropertyDescriptor(value, "length")?.value;
  assert(Number.isSafeInteger(length) && length >= 0 && length <= limit,
    "Canvas observation array exceeds its count bound.");
  const descriptors = Object.getOwnPropertyDescriptors(value);
  assert(Object.getOwnPropertySymbols(value).length === 0 && Object.keys(descriptors).length === length + 1,
    "Canvas observation array contains missing, unexpected or excessive fields.");
  const result: unknown[] = [];
  for (let index = 0; index < length; index++) {
    const descriptor = descriptors[String(index)];
    assert(descriptor && "value" in descriptor, "Canvas observation array must contain dense data indexes.");
    result.push(descriptor.value);
  }
  return result;
}

/** Accept only bounded inert DOM observations, and never normalize the caller's arrays in place. */
export function canonicalMeaningfulSystem(value: unknown): MeaningfulSystemObservation {
  record(value, ["schemaVersion", "scenarioId", "workspaceId", "systemId", "nodes", "properties"]);
  assert(value.schemaVersion === "meaningful-system-snapshot-v1" &&
    MEANINGFUL_SYSTEM_IDS.some(id => id === value.scenarioId), "Canvas observation has an unknown scenario or schema.");
  text(value.workspaceId, 256); text(value.systemId, 256);
  const observedNodes = dataArray(value.nodes, 1024), observedProperties = dataArray(value.properties, 1024);
  assert(observedNodes.length > 0, "Canvas observation needs its root.");
  const nodes: CanvasNodeObservation[] = [], properties: CanvasPropertyObservation[] = [];
  const identities = new Set<string>(), positions = new Set<string>(), fields = new Set<string>();
  for (const node of observedNodes) {
    record(node, ["id", "reference", "parent", "slot", "order"]);
    text(node.id, 256); text(node.reference, 512);
    assert(/^[a-zA-Z0-9._:-]+@[0-9]+\.[0-9]+\.[0-9]+(?:[-+][a-zA-Z0-9.+-]+)?$/.test(node.reference),
      "Canvas observation requires an exact definition and version.");
    assert(Number.isSafeInteger(node.order) && Number(node.order) >= 0 && Number(node.order) < 1024,
      "Canvas observation has an invalid sibling position.");
    assert((node.parent === null) === (node.slot === null), "Canvas parent and slot must be paired.");
    if (node.parent !== null) { text(node.parent, 256); text(node.slot, 256); }
    assert(!identities.has(node.id), "Canvas observation repeats an instance identity.");
    identities.add(node.id);
    const position = JSON.stringify([node.parent, node.slot, node.order]);
    assert(!positions.has(position), "Canvas observation repeats a sibling position."); positions.add(position);
    nodes.push({id: node.id, reference: node.reference, parent: node.parent as string | null,
      slot: node.slot as string | null, order: node.order as number});
  }
  assert(nodes.filter(node => node.parent === null).length === 1, "Canvas observation needs one root.");
  const byId = new Map(nodes.map(node => [node.id, node]));
  for (const node of nodes) {
    const visited = new Set<string>(); let current: CanvasNodeObservation | undefined = node;
    while (current) {
      assert(!visited.has(current.id), "Canvas observation contains a cycle."); visited.add(current.id);
      if (current.parent === null) break;
      assert(byId.has(current.parent), "Canvas observation refers to a missing parent.");
      current = byId.get(current.parent);
    }
  }
  for (const property of observedProperties) {
    record(property, ["instanceId", "field", "value"]);
    text(property.instanceId, 256); text(property.field, 128);
    assert(identities.has(property.instanceId), "Canvas configuration refers to a missing instance.");
    assert(typeof property.value === "boolean" || typeof property.value === "string" &&
      Buffer.byteLength(property.value, "utf8") <= 4096, "Canvas configuration value exceeds its bound.");
    const key = JSON.stringify([property.instanceId, property.field]);
    assert(!fields.has(key), "Canvas observation repeats a configured field."); fields.add(key);
    properties.push({instanceId: property.instanceId, field: property.field, value: property.value});
  }
  nodes.sort((a, b) => compare(a.id, b.id));
  properties.sort((a, b) => compare(a.instanceId, b.instanceId) || compare(a.field, b.field));
  const result: MeaningfulSystemObservation = {schemaVersion: "meaningful-system-snapshot-v1",
    scenarioId: value.scenarioId as string, workspaceId: value.workspaceId, systemId: value.systemId, nodes, properties};
  assert(Buffer.byteLength(JSON.stringify(result), "utf8") <= 262_144, "Canvas observation exceeds its byte bound.");
  return result;
}

export function assertMeaningfulSystemPreserved(expected: unknown, observed: unknown) {
  assert(isDeepStrictEqual(canonicalMeaningfulSystem(expected), canonicalMeaningfulSystem(observed)),
    "Saved Canvas identity, definition, hierarchy or configuration changed.");
}

/** A revisit is useful only if all three distinct systems belong to the same captured workspace. */
export function assertMeaningfulSystemSet(values: readonly unknown[]): MeaningfulSystemObservation[] {
  const entries = dataArray(values, MEANINGFUL_SYSTEM_IDS.length);
  assert(entries.length === MEANINGFUL_SYSTEM_IDS.length, "Expected all three saved systems.");
  const systems = entries.map(canonicalMeaningfulSystem);
  assert(isDeepStrictEqual(systems.map(value => value.scenarioId).sort(), [...MEANINGFUL_SYSTEM_IDS].sort()) &&
    new Set(systems.map(value => value.systemId)).size === systems.length &&
    new Set(systems.map(value => value.workspaceId)).size === 1,
    "Saved systems must have distinct scenario and system identities in one workspace.");
  return systems;
}

export interface DesktopStartupObservation {
  readonly schemaVersion: "desktop-startup-observation-v1";
  readonly firstWindowMilliseconds: number;
  readonly interactiveShellMilliseconds: number;
}

/** Elapsed test-driver observations, not first paint or a new speed verdict. */
export function readDesktopStartupObservation(value: unknown): DesktopStartupObservation {
  record(value, ["schemaVersion", "firstWindowMilliseconds", "interactiveShellMilliseconds"]);
  assert(value.schemaVersion === "desktop-startup-observation-v1", "Unknown startup observation.");
  for (const field of ["firstWindowMilliseconds", "interactiveShellMilliseconds"] as const) {
    // Output bound matches the existing cohort deadline; it is not a speed target.
    assert(typeof value[field] === "number" && Number.isFinite(value[field]) && value[field] >= 0 && value[field] <= 600_000,
      "Startup observation exceeds its collection bound.");
  }
  assert(Number(value.interactiveShellMilliseconds) >= Number(value.firstWindowMilliseconds), "Startup phases are out of order.");
  return Object.freeze({ schemaVersion: "desktop-startup-observation-v1", firstWindowMilliseconds: value.firstWindowMilliseconds as number,
    interactiveShellMilliseconds: value.interactiveShellMilliseconds as number });
}
