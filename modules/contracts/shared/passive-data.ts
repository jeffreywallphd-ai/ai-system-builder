/** Pure, bounded validation for descriptive boundary data, never executable input. */
export type PassiveValue =
  string | number | boolean | null | PassiveRecord | readonly PassiveValue[];
export interface PassiveRecord {
  readonly [key: string]: PassiveValue;
}

const FORBIDDEN_KEY =
  /(?:token|secret|password|passwd|credential|authorization|authentication|apikey|privatekey|cookie|signedurl|presignedurl|payload|base64|command|stacktrace|processenv|environment|localpath|filepath|filesystempath|storageroot|runtimeroot|prompt|workflow|raw(?:response|request|provider|body|data|output|input|text|content|graph|exception)|graph(?:json|payload))|^(?:raw|graph|env|path|bytes|blob)$/i;
const UNSAFE_TEXT =
  /(?:[a-z][a-z0-9+.-]*:\/\/|[a-z]:[\\/]|\\\\|(?:^|[\s("'=:\[])(?:[\\/]|~[\\/]|\.\.?[\\/]|[a-z]:)|\b(?:secret|token|password|credential|api[_ -]?key|private[_ -]?key|signed[_ -]?url|stack\s*trace|process\.env|command|shell|prompt|workflow|payload|base64)\b|\bbearer\s+\S+|-----BEGIN\s|^\s*[\[{]|[A-Za-z0-9+/]{80,}={0,2})/i;
const BAD_STRUCTURAL_KEYS = new Set(["__proto__", "prototype", "constructor"]);
const KNOWN_CREDENTIAL = /\b(?:AKIA[A-Z0-9]{16}|(?:sk[-_](?:proj-)?|gh[pousr]_|github_pat_|hf_|xox[baprs]-)[A-Za-z0-9_-]{16,})\b/;

/** High-confidence representations; explanatory security vocabulary alone is separate policy. */
export function hasKnownPassiveCredential(value: string): boolean {
  return typeof value === "string" && KNOWN_CREDENTIAL.test(value);
}

function invalid(): never {
  throw new Error("Passive boundary data is invalid.");
}

export function isUnsafePassiveText(value: string): boolean {
  if (typeof value !== "string") return true;
  return (
    value.length > 2048 ||
    /[\u0000-\u001f\u007f]/.test(value) ||
    hasKnownPassiveCredential(value) ||
    UNSAFE_TEXT.test(value.trim())
  );
}

export function normalizePassiveText(value: unknown): string {
  if (typeof value !== "string" || !value.trim() || isUnsafePassiveText(value))
    invalid();
  return value.trim();
}

/** Inspect descriptors before reading values; accessors and unknown fields deny. */
export function readStrictPassiveRecord(
  value: unknown,
  allowedKeys: readonly string[],
): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) invalid();
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) invalid();
  const keys = Reflect.ownKeys(value);
  if (keys.length > 128) invalid();
  const out: Record<string, unknown> = {};
  for (const key of keys) {
    if (
      typeof key !== "string" ||
      BAD_STRUCTURAL_KEYS.has(key) ||
      !allowedKeys.includes(key)
    )
      invalid();
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor || !("value" in descriptor) || !descriptor.enumerable)
      invalid();
    out[key] = descriptor.value;
  }
  return out;
}

/** Metadata only: typed DTO identities/digests use their own explicit schemas. */
export function normalizePassiveMetadata(
  value: unknown,
  options: { readonly allowArrays?: boolean } = {},
): PassiveRecord | undefined {
  if (value === undefined) return undefined;
  let nodes = 0;
  let bytes = 0;
  const ancestors = new Set<object>();
  const encoder = new TextEncoder();
  const charge = (text: string) => {
    bytes += encoder.encode(text).byteLength;
    if (bytes > 64 * 1024) invalid();
  };
  const visit = (entry: unknown, depth: number): PassiveValue => {
    if (++nodes > 1024 || depth > 8) invalid();
    if (entry === null || typeof entry === "boolean") return entry;
    if (typeof entry === "number") {
      if (!Number.isFinite(entry)) invalid();
      return entry;
    }
    if (typeof entry === "string") {
      if (isUnsafePassiveText(entry)) invalid();
      charge(entry);
      return entry;
    }
    if (!entry || typeof entry !== "object" || ancestors.has(entry)) invalid();
    ancestors.add(entry);
    try {
      if (Array.isArray(entry)) {
        if (
          !options.allowArrays ||
          Object.getPrototypeOf(entry) !== Array.prototype ||
          entry.length > 128
        )
          invalid();
        if (Reflect.ownKeys(entry).length !== entry.length + 1) invalid();
        const out: PassiveValue[] = [];
        for (let index = 0; index < entry.length; index++) {
          const descriptor = Object.getOwnPropertyDescriptor(
            entry,
            String(index),
          );
          if (!descriptor || !("value" in descriptor) || !descriptor.enumerable)
            invalid();
          out.push(visit(descriptor.value, depth + 1));
        }
        return out;
      }
      const prototype = Object.getPrototypeOf(entry);
      if (prototype !== Object.prototype && prototype !== null) invalid();
      const keys = Reflect.ownKeys(entry);
      if (keys.length > 64) invalid();
      const out: Record<string, PassiveValue> = {};
      for (const key of keys) {
        if (
          typeof key !== "string" ||
          !key ||
          key.length > 80 ||
          BAD_STRUCTURAL_KEYS.has(key) ||
          FORBIDDEN_KEY.test(key.replace(/[^a-z0-9]/gi, "")) ||
          isUnsafePassiveText(key)
        )
          invalid();
        charge(key);
        const descriptor = Object.getOwnPropertyDescriptor(entry, key);
        if (!descriptor || !("value" in descriptor) || !descriptor.enumerable)
          invalid();
        out[key] = visit(descriptor.value, depth + 1);
      }
      return out;
    } finally {
      ancestors.delete(entry);
    }
  };
  // A metadata envelope is a record even in families permitting nested arrays.
  if (!value || typeof value !== "object" || Array.isArray(value)) invalid();
  return visit(value, 0) as PassiveRecord;
}
