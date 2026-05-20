import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { cloneJson } from "../user-library/local-user-library-record-store";

export const EFFECTIVE_ASSET_PROJECTIONS_LOCAL_STORE_KIND = "effective-asset-projections-local-store" as const;
export const EFFECTIVE_ASSET_PROJECTIONS_LOCAL_SCHEMA_VERSION = 1 as const;
export type CollectionName = "projections" | "snapshots";
const files: Record<CollectionName, string> = { projections: "effective-asset-projections.json", snapshots: "effective-asset-projection-snapshots.json" };
interface Manifest { schemaVersion: 1; storeKind: typeof EFFECTIVE_ASSET_PROJECTIONS_LOCAL_STORE_KIND; updatedAt: string }

function assertSafeProjectionJson(value: unknown): void {
  const encoded = JSON.stringify(value);
  if (encoded === undefined) {
    throw new LocalEffectiveAssetProjectionRecordStoreError("Effective asset projection local store record must be JSON-safe.");
  }
}

export class LocalEffectiveAssetProjectionRecordStoreError extends Error { constructor(m: string) { super(m); this.name = "LocalEffectiveAssetProjectionRecordStoreError"; this.stack = undefined; } }
export class LocalEffectiveAssetProjectionRecordStore { private readonly dir: string; private readonly now: () => string; constructor(o: { rootDir: string; now?: () => string }) { this.dir = join(o.rootDir, "effective-asset-projections"); this.now = o.now ?? (() => new Date().toISOString()); }
async readCollection<T>(name: CollectionName): Promise<readonly T[]> { await this.ensure(); const v = await this.readJson(files[name], [] as T[]); if (!Array.isArray(v)) throw new LocalEffectiveAssetProjectionRecordStoreError("Effective asset projection local store collection is invalid."); return cloneJson(v as T[]); }
async writeCollection<T>(name: CollectionName, records: readonly T[]): Promise<void> { await this.ensure(); assertSafeProjectionJson(records); await this.writeJson(files[name], cloneJson(records)); await this.writeJson("effective-asset-projection-manifest.json", this.manifest()); }
private async ensure() { await mkdir(this.dir, { recursive: true }); const m = await this.readJson("effective-asset-projection-manifest.json", this.manifest()); if (!m || typeof m !== "object") throw new LocalEffectiveAssetProjectionRecordStoreError("Effective asset projection local store manifest is invalid."); const x = m as Partial<Manifest>; if (x.schemaVersion !== 1) throw new LocalEffectiveAssetProjectionRecordStoreError("Effective asset projection local store manifest schema version is unsupported."); if (x.storeKind !== EFFECTIVE_ASSET_PROJECTIONS_LOCAL_STORE_KIND) throw new LocalEffectiveAssetProjectionRecordStoreError("Effective asset projection local store manifest kind is unsupported."); }
private manifest(): Manifest { return { schemaVersion: 1, storeKind: EFFECTIVE_ASSET_PROJECTIONS_LOCAL_STORE_KIND, updatedAt: this.now() }; }
private async readJson<T>(f: string, fallback: T): Promise<T> { try { return JSON.parse(await readFile(join(this.dir, f), "utf8")) as T; } catch (e) { if ((e as NodeJS.ErrnoException).code === "ENOENT") return cloneJson(fallback); if (e instanceof SyntaxError) throw new LocalEffectiveAssetProjectionRecordStoreError("Effective asset projection local store contains malformed JSON."); throw e; } }
private async writeJson(f: string, v: unknown) { const p = join(this.dir, f); const t = `${p}.${process.pid}.${randomUUID()}.tmp`; await writeFile(t, `${JSON.stringify(v, null, 2)}\n`, "utf8"); await rename(t, p).catch(async (e) => { await unlink(t).catch(() => undefined); throw e; }); }
}
