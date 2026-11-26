/** Private metadata codec only: no file, native loading or authority effects. */
import {types} from "node:util";
import {readStrictPassiveRecord} from "../../../../contracts/shared";

const names = ["config.json", "generation_config.json", "tokenizer.json", "tokenizer_config.json",
  "special_tokens_map.json", "added_tokens.json", "vocab.json", "merges.txt", "model.safetensors",
  "adapter_config.json", "adapter_model.safetensors", "serialization_manifest.json", "training-run.json"] as const;
const invalid = () => new Error("Private training result inventory is invalid.");
function need(value: unknown): asserts value {if (value !== true) throw invalid();}
function record(value: unknown, keys: readonly string[]) {
  need(!!value && typeof value === "object" && !types.isProxy(value));
  const row = readStrictPassiveRecord(value, keys); need(Object.keys(row).length === keys.length); return row;
}
function integer(value: unknown, minimum: number, maximum: number): number {
  need(typeof value === "number" && Number.isSafeInteger(value) && value >= minimum && value <= maximum); return value;
}
function files(value: unknown, maximum: number): unknown[] {
  need(!!value && typeof value === "object" && !types.isProxy(value) && Array.isArray(value));
  need(Object.getPrototypeOf(value) === Array.prototype);
  const length = integer(Object.getOwnPropertyDescriptor(value, "length")?.value, 1, maximum);
  need(Reflect.ownKeys(value).length === length + 1);
  return Array.from({length}, (_, index) => {
    const item = Object.getOwnPropertyDescriptor(value, String(index));
    need(!!item && "value" in item && item.enumerable === true); return item.value;
  });
}

/** Revalidate the receiver's complete inventory before allocating the existing
 * ASBTRS02 input. Returned bytes grant no custody, quota, permission or Save. */
export function captureTrainingResultInventory(input: unknown, configured: {
  readonly maximumFiles: number; readonly maximumFileBytes: number; readonly maximumTotalBytes: number;
}) {
  try {
    const limits = record(configured, ["maximumFiles", "maximumFileBytes", "maximumTotalBytes"]);
    const maximumFiles = integer(limits.maximumFiles, 1, 256);
    const maximumTotal = integer(limits.maximumTotalBytes, 1, Number.MAX_SAFE_INTEGER);
    const maximumFile = integer(limits.maximumFileBytes, 1, maximumTotal);
    const publication = record(input, ["publicationId", "totalBytes", "files"]);
    need(typeof publication.publicationId === "string" && /^[a-f0-9]{32}$/.test(publication.publicationId));
    const total = integer(publication.totalBytes, 1, maximumTotal);
    let group = 0, sum = 0;
    const seen = new Set<string>();
    const rows = files(publication.files, maximumFiles).map((value, index) => {
      const row = record(value, ["fileIndex", "groupIndex", "name", "role", "mediaType", "expectedSizeBytes", "expectedSha256"]);
      need(row.fileIndex === index);
      const nextGroup = integer(row.groupIndex, 0, 255);
      need(nextGroup === group || index > 0 && nextGroup === group + 1); group = nextGroup;
      need(typeof row.name === "string");
      const ordinal = names.indexOf(row.name as typeof names[number]) + 1; need(ordinal > 0);
      need(row.role === "checkpoint" || row.role === "candidate");
      need(row.mediaType === (row.name.endsWith(".json") ? "application/json" : "application/octet-stream"));
      const size = integer(row.expectedSizeBytes, 1, maximumFile); need(size <= maximumTotal - sum); sum += size;
      need(typeof row.expectedSha256 === "string" && /^sha256:[a-f0-9]{64}$/.test(row.expectedSha256));
      const key = `${group}/${row.name}`; need(!seen.has(key)); seen.add(key);
      return {index, group, role: row.role === "checkpoint" ? 1 : 2, ordinal, size, hash: row.expectedSha256.slice(7)};
    });
    need(sum === total && rows.every(row => row.role === (row.group === group ? 2 : 1)));
    const encoded = Buffer.alloc(12 + 48 * rows.length); // At most 12,300 bytes, after complete validation.
    encoded.write("ASBTRS02", 0, "ascii"); encoded.writeUInt32LE(rows.length, 8);
    for (const row of rows) {
      const at = 12 + 48 * row.index;
      encoded.writeUInt32LE(row.index, at); encoded.writeUInt16LE(row.group, at + 4);
      encoded[at + 6] = row.role; encoded[at + 7] = row.ordinal;
      encoded.writeBigUInt64LE(BigInt(row.size), at + 8); Buffer.from(row.hash, "hex").copy(encoded, at + 16);
    }
    return Object.freeze({publicationId: publication.publicationId, totalBytes: sum, encoded,
      files: Object.freeze(rows.map(row => Object.freeze({fileIndex: row.index, groupIndex: row.group,
        name: names[row.ordinal - 1]!, role: row.role === 1 ? "checkpoint" as const : "candidate" as const,
        mediaType: names[row.ordinal - 1]!.endsWith(".json") ? "application/json" as const : "application/octet-stream" as const,
        expectedSizeBytes: row.size, expectedSha256: "sha256:" + row.hash})))});
  } catch {throw invalid();}
}

/** Compatibility encoder; the captured metadata stays private to its caller. */
export function encodeTrainingResultInventory(input: unknown, configured: {
  readonly maximumFiles: number; readonly maximumFileBytes: number; readonly maximumTotalBytes: number;
}): Buffer {return captureTrainingResultInventory(input, configured).encoded;}
