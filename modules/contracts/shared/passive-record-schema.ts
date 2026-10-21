import { normalizePassiveText, readStrictPassiveRecord } from "./passive-data";

export type PassiveParser<T> = (value: unknown) => T;
function invalid(): never { throw new Error("Passive record data is invalid."); }

/** Bound the entire DTO before normalization; inspect descriptors without executing accessors. */
export function copyBoundedPassiveData(input: unknown): unknown {
  let nodes = 0;
  let bytes = 0;
  const ancestors = new Set<object>();
  const encoder = new TextEncoder();
  const charge = (text: string) => {
    bytes += encoder.encode(text).byteLength;
    if (bytes > 256 * 1024) invalid();
  };
  const visit = (value: unknown, depth: number): unknown => {
    if (++nodes > 4096 || depth > 12) invalid();
    if (value === undefined || value === null || typeof value === "boolean") return value;
    if (typeof value === "number") return Number.isFinite(value) ? value : invalid();
    if (typeof value === "string") {
      if (value.length > 2048) invalid();
      charge(value);
      return value;
    }
    if (!value || typeof value !== "object" || ancestors.has(value)) invalid();
    const array = Array.isArray(value);
    const prototype = Object.getPrototypeOf(value);
    if (array ? prototype !== Array.prototype : prototype !== Object.prototype && prototype !== null) invalid();
    ancestors.add(value);
    try {
      const keys = Reflect.ownKeys(value);
      if (array) {
        if (value.length > 1024 || keys.length !== value.length + 1) invalid();
        const result: unknown[] = [];
        for (let index = 0; index < value.length; index++) {
          const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
          if (!descriptor || !("value" in descriptor) || !descriptor.enumerable) invalid();
          result.push(visit(descriptor.value, depth + 1));
        }
        return result;
      }
      if (keys.length > 128) invalid();
      const result: Record<string, unknown> = {};
      for (const key of keys) {
        if (typeof key !== "string" || key.length > 80 || ["__proto__", "constructor", "prototype"].includes(key)) invalid();
        charge(key);
        const descriptor = Object.getOwnPropertyDescriptor(value, key);
        if (!descriptor || !("value" in descriptor) || !descriptor.enumerable) invalid();
        result[key] = visit(descriptor.value, depth + 1);
      }
      return result;
    } finally { ancestors.delete(value); }
  };
  return visit(input, 0);
}

/** Explicit schemas reconstruct only declared fields; typed IDs use their own parsers. */
export function passiveRecord<T extends object>(fields: { [K in keyof T]-?: PassiveParser<T[K]> }): PassiveParser<T> {
  return (value) => {
    const record = readStrictPassiveRecord(copyBoundedPassiveData(value), Object.keys(fields));
    const output: Record<string, unknown> = {};
    for (const key of Object.keys(fields) as (keyof T & string)[]) {
      const parsed = fields[key](record[key]);
      if (parsed !== undefined) output[key] = parsed;
    }
    return output as T;
  };
}

export const passiveOptional = <T>(parse: PassiveParser<T>): PassiveParser<T | undefined> =>
  (value) => value === undefined ? undefined : parse(value);
export const passiveString = (value: unknown): string => {
  if (typeof value !== "string" || !value.trim() || value.length > 2048) invalid();
  return value.trim();
};
export const passiveText = normalizePassiveText;
export const passiveTypedString = <T>(parse: (value: string) => T): PassiveParser<T> =>
  (value) => parse(passiveString(value));
export const passiveBoolean = (value: unknown): boolean => typeof value === "boolean" ? value : invalid();
export const passiveEnum = <T extends string>(values: readonly T[]): PassiveParser<T> =>
  (value) => { const text = passiveString(value).toLowerCase(); return values.includes(text as T) ? text as T : invalid(); };
export const passiveTimestamp = (value: unknown): string => {
  const text = passiveString(value);
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(text) || !Number.isFinite(Date.parse(text)) || new Date(text).toISOString() !== text) invalid();
  return text;
};
export const passiveArray = <T>(parse: PassiveParser<T>, allowMissing = false): PassiveParser<T[]> =>
  (value) => {
    if (value === undefined && allowMissing) return [];
    const copy = copyBoundedPassiveData(value);
    if (!Array.isArray(copy)) invalid();
    return copy.map(parse);
  };
export const passiveDiagnosticCode = (value: unknown): string => {
  const text = passiveText(value).toLowerCase();
  if (!/^[a-z0-9]+(?:[.-][a-z0-9]+){1,7}$/.test(text)) invalid();
  return text;
};
export const passivePercentage = (value: unknown): number =>
  typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 100 ? value : invalid();
export const passivePositiveInteger = (value: unknown): number =>
  typeof value === "number" && Number.isSafeInteger(value) && value > 0 ? value : invalid();
