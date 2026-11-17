import { isWorkspaceId } from "../../../../../../../modules/contracts/workspace";

const TEXT_FIELDS = ["prompt", "negativePrompt", "seed", "width", "height", "steps", "cfg", "denoise", "sampler", "scheduler", "model", "numImages", "latentSourceArtifactId", "faceIdArtifactId1", "faceIdArtifactId2", "faceIdArtifactId3", "faceIdIdentityStrength", "faceIdStructureStrength", "faceIdNoise"] as const;
export type ImageGenerationFormValues = Record<typeof TEXT_FIELDS[number], string> & { faceIdEnabled: boolean };
export const IMAGE_DRAFT_WORKSPACE_LIMIT = 8;
export const IMAGE_DRAFT_BYTE_LIMIT = 128 * 1024;

/** Navigation convenience only. Never retain task outcomes, errors or previews. */
export function captureImageGenerationDraft(input: unknown): ImageGenerationFormValues | undefined {
  try {
    if (!input || typeof input !== "object" || Object.getPrototypeOf(input) !== Object.prototype) return undefined;
    const fields = Object.getOwnPropertyDescriptors(input);
    if (Reflect.ownKeys(fields).length !== TEXT_FIELDS.length + 1) return undefined;
    const result = {} as ImageGenerationFormValues;
    for (const name of TEXT_FIELDS) {
      const property = fields[name];
      if (!property || !("value" in property) || typeof property.value !== "string" || property.value.length > (name === "prompt" || name === "negativePrompt" ? 10_000 : 2048)) return undefined;
      result[name] = property.value;
    }
    const enabled = fields.faceIdEnabled;
    if (!enabled || !("value" in enabled) || typeof enabled.value !== "boolean") return undefined;
    result.faceIdEnabled = enabled.value;
    if (new TextEncoder().encode(JSON.stringify(result)).byteLength > IMAGE_DRAFT_BYTE_LIMIT) return undefined;
    return result;
  } catch { return undefined; }
}

export class ImageGenerationDraftCache {
  private readonly drafts = new Map<string, Readonly<ImageGenerationFormValues>>();

  read(workspace: unknown): ImageGenerationFormValues | undefined {
    if (!isWorkspaceId(workspace)) return undefined;
    const value = this.drafts.get(workspace);
    if (!value) return undefined;
    this.drafts.delete(workspace); this.drafts.set(workspace, value);
    return { ...value };
  }

  write(workspace: unknown, input: unknown): boolean {
    if (!isWorkspaceId(workspace)) return false;
    const value = captureImageGenerationDraft(input);
    // An uncached latest edit must not resurrect an older draft on navigation.
    this.drafts.delete(workspace);
    if (!value) return false;
    this.drafts.set(workspace, Object.freeze(value));
    while (this.drafts.size > IMAGE_DRAFT_WORKSPACE_LIMIT) this.drafts.delete(this.drafts.keys().next().value!);
    return true;
  }
}

const scopes = new WeakMap<object, WeakMap<object, WeakMap<object, ImageGenerationDraftCache>>>();
/** Weak client identities do not become strings or persistence authority. */
export function imageDraftCacheForOwners(owners: readonly [object, object, object]): ImageGenerationDraftCache | undefined {
  if (owners.length !== 3 || owners.some(owner => !owner || typeof owner !== "object" && typeof owner !== "function")) return undefined;
  const [client, models, artifacts] = owners;
  let byModels = scopes.get(client);
  if (!byModels) { byModels = new WeakMap(); scopes.set(client, byModels); }
  let byArtifacts = byModels.get(models);
  if (!byArtifacts) { byArtifacts = new WeakMap(); byModels.set(models, byArtifacts); }
  let cache = byArtifacts.get(artifacts);
  if (!cache) { cache = new ImageGenerationDraftCache(); byArtifacts.set(artifacts, cache); }
  return cache;
}
