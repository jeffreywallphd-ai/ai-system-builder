import { types } from "node:util";

export type FingerprintJson = null | boolean | number | string | FingerprintJson[] | { [key: string]: FingerprintJson };

const MAX_DEPTH = 32;
const MAX_VALUES = 250_000;
const MAX_BYTES = 16 * 1024 * 1024;
const MAX_ITEMS = 8192;

function invalid(): never { throw new Error("Asset pack semantic fingerprint input is invalid."); }

/** Capture passive JSON before validation, with no getter, proxy or toJSON evaluation. */
export function captureAssetPackFingerprintInput(input: unknown): FingerprintJson {
  let values = 0;
  let bytes = 0;
  const ancestors = new Set<object>();
  const account = (size: number): void => {
    bytes += size;
    if (bytes > MAX_BYTES) invalid();
  };
  const accountString = (value: string): void => {
    // Charge JSON escaping and UTF-8 without first allocating an oversized encoding.
    if (value.length > MAX_BYTES) invalid();
    account(2);
    for (let index = 0; index < value.length; index++) {
      const code = value.charCodeAt(index);
      if (code === 34 || code === 92 || [8, 9, 10, 12, 13].includes(code)) account(2);
      else if (code < 32) account(6);
      else if (code < 128) account(1);
      else if (code < 2048) account(2);
      else if (code >= 0xd800 && code <= 0xdbff) {
        const next = value.charCodeAt(index + 1);
        if (next >= 0xdc00 && next <= 0xdfff) { account(4); index++; }
        else account(6);
      } else if (code >= 0xdc00 && code <= 0xdfff) account(6);
      else account(3);
    }
  };
  const visit = (value: unknown, depth: number): FingerprintJson => {
    if (++values > MAX_VALUES || depth > MAX_DEPTH) invalid();
    if (value === null || typeof value === "boolean") {
      account(value === null || value === true ? 4 : 5);
      return value;
    }
    if (typeof value === "number") {
      if (!Number.isFinite(value)) invalid();
      account(JSON.stringify(value).length);
      return value;
    }
    if (typeof value === "string") { accountString(value); return value; }
    if (typeof value !== "object" || types.isProxy(value) || ancestors.has(value)) invalid();
    const array = Array.isArray(value);
    const prototype = Object.getPrototypeOf(value);
    if (array ? prototype !== Array.prototype : prototype !== Object.prototype && prototype !== null) invalid();
    const keys = Reflect.ownKeys(value);
    if (keys.length > MAX_ITEMS + (array ? 1 : 0) || keys.some((k) => typeof k !== "string")) invalid();
    ancestors.add(value);
    try {
      if (array) {
        const length = Object.getOwnPropertyDescriptor(value, "length")?.value;
        if (!Number.isInteger(length) || length < 0 || length > MAX_ITEMS || keys.length !== length + 1) invalid();
        account(2 + Math.max(0, length - 1));
        const result: FingerprintJson[] = [];
        for (let index = 0; index < length; index++) {
          const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
          if (!descriptor || !("value" in descriptor) || !descriptor.enumerable) invalid();
          result.push(visit(descriptor.value, depth + 1));
        }
        return result;
      }
      const result: { [key: string]: FingerprintJson } = Object.create(null);
      account(2);
      let members = 0;
      for (const key of keys as string[]) {
        if (["__proto__", "prototype", "constructor"].includes(key)) invalid();
        const descriptor = Object.getOwnPropertyDescriptor(value, key);
        if (!descriptor || !("value" in descriptor) || !descriptor.enumerable) invalid();
        // An absent optional object field and an explicit undefined field have
        // the same JSON meaning. Array holes/undefined and other nonJSON deny.
        if (descriptor.value !== undefined) {
          account(members++ > 0 ? 2 : 1); // Member separator and colon.
          accountString(key);
          result[key] = visit(descriptor.value, depth + 1);
        }
      }
      return result;
    } finally { ancestors.delete(value); }
  };
  return visit(input, 0);
}
