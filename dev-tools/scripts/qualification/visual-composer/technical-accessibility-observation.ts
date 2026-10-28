import { types } from "node:util";
import axe from "axe-core";

export const ACCESSIBILITY_RETRY_NODE_LIMIT = 1000;
const RULE_LIMIT = 512;
const NODE_LIMIT = 10000;
const INVALID = "Invalid technical accessibility observation.";
// The vocabulary comes from the installed, locked test dependency, never the DOM.
export const TECHNICAL_ACCESSIBILITY_RULE_IDS = Object.freeze(axe.getRules().map(rule => rule.ruleId));
const RULE_IDS = new Set(TECHNICAL_ACCESSIBILITY_RULE_IDS);
if (RULE_IDS.size === 0 || RULE_IDS.size > RULE_LIMIT) throw new Error(INVALID);
type RuleCount = Readonly<{ rule: string; nodes: number }>;
export interface TechnicalAccessibilityAudit {
  readonly schemaVersion: "technical-accessibility-audit-v1";
  readonly width: 320 | 1440;
  readonly violations: readonly RuleCount[];
  readonly incomplete: readonly RuleCount[];
  readonly contrastPassedNodes: number;
  readonly retries: Readonly<{ attempted: number; passed: number }>;
  readonly status: "passed" | "failed";
  readonly failures: readonly string[];
}
function record(value: unknown, keys: readonly string[]): Record<string, unknown> {
  if (!value || typeof value !== "object" || types.isProxy(value) || Object.getPrototypeOf(value) !== Object.prototype) throw new Error(INVALID);
  const fields = Object.getOwnPropertyDescriptors(value);
  if (Reflect.ownKeys(fields).length !== keys.length) throw new Error(INVALID);
  const result: Record<string, unknown> = {};
  for (const key of keys) {
    const field = fields[key];
    if (!field || !("value" in field)) throw new Error(INVALID);
    result[key] = field.value;
  }
  return result;
}
function count(value: unknown, limit: number, minimum = 0): number {
  if (!Number.isSafeInteger(value) || (value as number) < minimum || (value as number) > limit) throw new Error(INVALID);
  return value as number;
}
function rules(value: unknown): readonly RuleCount[] {
  if (types.isProxy(value) || !Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype) throw new Error(INVALID);
  const length = count(Object.getOwnPropertyDescriptor(value, "length")?.value, RULE_LIMIT);
  const fields = Object.getOwnPropertyDescriptors(value);
  if (Reflect.ownKeys(fields).length !== length + 1) throw new Error(INVALID);
  const result: RuleCount[] = [], seen = new Set<string>();
  for (let index = 0; index < length; index++) {
    const field = fields[String(index)];
    if (!field || !("value" in field)) throw new Error(INVALID);
    const item = record(field.value, ["rule", "nodes"]);
    if (typeof item.rule !== "string" || !RULE_IDS.has(item.rule) || seen.has(item.rule)) throw new Error(INVALID);
    seen.add(item.rule); result.push(Object.freeze({ rule: item.rule, nodes: count(item.nodes, NODE_LIMIT, 1) }));
  }
  return Object.freeze(result);
}
/** Structural/local evidence only. Actual browser execution supplies these facts. */
export function readTechnicalAccessibilityAudit(value: unknown): TechnicalAccessibilityAudit {
  try {
    const data = record(value, ["schemaVersion", "width", "violations", "incomplete", "contrastPassedNodes", "retries"]);
    if (data.schemaVersion !== "technical-accessibility-audit-v1" || (data.width !== 320 && data.width !== 1440)) throw new Error(INVALID);
    const violations = rules(data.violations), incomplete = rules(data.incomplete);
    const contrastPassedNodes = count(data.contrastPassedNodes, NODE_LIMIT);
    const retry = record(data.retries, ["attempted", "passed"]);
    const attempted = count(retry.attempted, ACCESSIBILITY_RETRY_NODE_LIMIT), passed = count(retry.passed, attempted);
    const contrastIncomplete = incomplete.find(item => item.rule === "color-contrast")?.nodes ?? 0;
    if (contrastIncomplete > ACCESSIBILITY_RETRY_NODE_LIMIT || attempted > contrastIncomplete) throw new Error(INVALID);
    const failures: string[] = [];
    if (violations.length) failures.push("rule-violation");
    if (incomplete.some(item => item.rule !== "color-contrast")) failures.push("unresolved-rule");
    if (attempted !== contrastIncomplete || passed !== attempted) failures.push("unresolved-contrast-retry");
    if (contrastPassedNodes === 0) failures.push("missing-contrast-sample");
    return Object.freeze({ schemaVersion: "technical-accessibility-audit-v1", width: data.width, violations, incomplete, contrastPassedNodes,
      retries: Object.freeze({ attempted, passed }), status: failures.length ? "failed" : "passed", failures: Object.freeze(failures) });
  } catch { throw new Error(INVALID); }
}
