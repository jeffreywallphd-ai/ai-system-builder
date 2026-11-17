import { normalizeStorageArtifactKey } from "../../../contracts/storage";
import type { DatasetVersionReplaySource } from "./datasetVersionReplay";

const failure = () => new Error("Saved source files could not be confirmed in this workspace.");
function plain(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value) ||
      ![Object.prototype, null].includes(Object.getPrototypeOf(value))) throw failure();
  const fields = Object.getOwnPropertyDescriptors(value);
  if (Reflect.ownKeys(fields).some(key => typeof key !== "string" || !("value" in fields[key]))) throw failure();
  return value as Record<string, unknown>;
}

/** Existing workspace-authorized detail operations remain the authority.
 * This bounded metadata lookup grants no source-byte or runtime qualification.
 * The caller supplies a current request guard and must recheck before setters.
 */
export async function readDatasetVersionReplaySources(
  workspaceId: string,
  sources: readonly { readonly artifactId: string; readonly storageKey: string }[],
  isCurrent: () => boolean,
  readDetail: (workspaceId: string, storageKey: string) => Promise<unknown>,
): Promise<DatasetVersionReplaySource[]> {
  try {
    if (typeof workspaceId !== "string" || !workspaceId.trim() || workspaceId !== workspaceId.trim() ||
        workspaceId.length > 256 || /[\u0000-\u001f]/u.test(workspaceId) || typeof isCurrent !== "function" ||
        typeof readDetail !== "function" || !Array.isArray(sources) || !sources.length || sources.length > 100) throw failure();
    // Capture scalars before the first await. Browse IDs are canonical catalogue
    // keys; detail metadata cannot prove another historical non-key identity.
    const references: string[] = [];
    for (let index = 0; index < sources.length; index++) {
      const slot = Object.getOwnPropertyDescriptor(sources, String(index));
      if (!slot || !("value" in slot)) throw failure();
      const source = plain(slot.value);
      if (typeof source.storageKey !== "string" || source.storageKey.length > 512 || /[\u0000-\u001f]/u.test(source.storageKey)) throw failure();
      const key = normalizeStorageArtifactKey(source.storageKey);
      if (source.storageKey !== key || source.artifactId !== key) throw failure();
      references.push(key);
    }
    if (new Set(references).size !== references.length) throw failure();
    const result: DatasetVersionReplaySource[] = [];
    const deadline = performance.now() + 15_000;
    for (const key of references) {
      if (!isCurrent()) throw failure();
      const remaining = deadline - performance.now();
      if (remaining <= 0) throw failure();
      let timer: ReturnType<typeof setTimeout> | undefined;
      const timeout = new Promise<never>((_resolve, reject) => { timer = setTimeout(() => reject(failure()), remaining); });
      // Fixed concurrency1. Timeout stops this caller and later reads, without
      // claiming cancellation of a read-only request already sent by a transport.
      let detail: unknown;
      try { detail = await Promise.race([readDetail(workspaceId, key), timeout]); }
      finally { clearTimeout(timer); }
      if (!isCurrent()) throw failure();
      const fields = plain(detail), locator = plain(fields.locator);
      const returnedKey = locator.storageKey, label = fields.originalName, mediaType = fields.mediaType;
      if (returnedKey !== key ||
          (label !== undefined && (typeof label !== "string" || label.length > 512 || /[\u0000-\u001f]/u.test(label))) ||
          (mediaType !== undefined && (typeof mediaType !== "string" || mediaType.length > 256 || /[\u0000-\u001f]/u.test(mediaType)))) throw failure();
      result.push(Object.freeze({ artifactId: key, storageKey: key, label: (label as string | undefined) ?? key,
        ...(mediaType === undefined ? {} : { mediaType: mediaType as string }) }));
    }
    return result;
  } catch { throw failure(); }
}
