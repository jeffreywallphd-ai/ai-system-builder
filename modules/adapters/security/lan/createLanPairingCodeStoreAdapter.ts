import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import type { PairingCodeStorePort } from "../../../application/ports/security";

interface PairingRecord { code: string; expiresAt: string; consumedAt?: string; defaultDeviceName?: string; defaultScopes?: string[] }
interface State { enabled: boolean; records: PairingRecord[] }

export function createLanPairingCodeStoreAdapter(path: string): PairingCodeStorePort {
  const load = async (): Promise<State> => {
    try { return JSON.parse(await readFile(path, "utf8")) as State; } catch { return { enabled: true, records: [] }; }
  };
  const save = async (state: State) => {
    await mkdir(dirname(path), { recursive: true });
    const tmp = `${path}.tmp`;
    await writeFile(tmp, JSON.stringify(state, null, 2));
    await rename(tmp, path);
  };
  return {
    async consumePairingCode({ pairingCode, now }) {
      const state = await load();
      if (!state.enabled) return { status: "disabled" };
      const record = state.records.find((v) => v.code === pairingCode);
      if (!record) return { status: "invalid" };
      if (record.consumedAt) return { status: "already-used" };
      if (new Date(record.expiresAt) <= now) return { status: "expired" };
      record.consumedAt = now.toISOString();
      await save(state);
      return { status: "valid", expiresAt: record.expiresAt, defaultDeviceName: record.defaultDeviceName, defaultScopes: record.defaultScopes as any };
    },
  };
}
