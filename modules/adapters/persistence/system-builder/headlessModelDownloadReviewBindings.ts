import {createHash} from "node:crypto";
import {types} from "node:util";
import type {HeadlessBuildPlanRequest} from "../../../contracts/headless";
import {readStrictPassiveRecord} from "../../../contracts/shared";

/** Private prepared metadata facts, not provider credentials or transfer authority.
 * The host supplies them only after provider preparation outside the transaction. */
export interface ModelDownloadReviewBinding {
  readonly step: number;
  readonly manifestDigest: string;
}

/** Exact ordered coverage; inline proposal claims cannot replace the host binder. */
export function readModelDownloadReviewBindings(value: unknown,
  requests: readonly HeadlessBuildPlanRequest[]): readonly ModelDownloadReviewBinding[] | undefined {
  try {
    const expected = requests.flatMap((request, index) => request.operation === "models.download" ? [{request, step: index + 1}] : []);
    if (!expected.length || !value || typeof value !== "object" || types.isProxy(value) ||
        !Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype || value.length !== expected.length) return;
    // Inspect descriptors before reading entries; no accessors or extra array fields.
    const keys = Reflect.ownKeys(value);
    if (keys.length !== expected.length + 1 || keys.some(key => key !== "length" &&
        (typeof key !== "string" || !/^(0|[1-9][0-9]*)$/.test(key)))) return;
    const result: ModelDownloadReviewBinding[] = [];
    for (const [index, target] of expected.entries()) {
      const field = Object.getOwnPropertyDescriptor(value, String(index));
      if (!field || !("value" in field) || !field.value || typeof field.value !== "object" || types.isProxy(field.value)) return;
      const row = readStrictPassiveRecord(field.value, ["step", "manifestDigest"]);
      const manifest = target.request.input.sourceManifest;
      const digest = "sha256:" + createHash("sha256").update(JSON.stringify(manifest.source), "utf8").digest("hex");
      if (row.step !== target.step || row.manifestDigest !== digest || manifest.manifestDigest !== digest) return;
      result.push(Object.freeze({step: target.step, manifestDigest: digest}));
    }
    return Object.freeze(result);
  } catch {return;}
}
