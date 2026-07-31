import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import type { DeviceCredentialStorePort } from "../../../application/ports/security";
import type { PairedDeviceCredentialRecord } from "../../../contracts/security";

interface State { records: PairedDeviceCredentialRecord[] }
const empty: State = { records: [] };

export function createLanDeviceCredentialStoreAdapter(path: string): DeviceCredentialStorePort {
  const load = async (): Promise<State> => {
    try { return JSON.parse(await readFile(path, "utf8")) as State; } catch { return empty; }
  };
  const save = async (state: State) => {
    await mkdir(dirname(path), { recursive: true });
    const tmp = `${path}.tmp`;
    await writeFile(tmp, JSON.stringify(state, null, 2));
    await rename(tmp, path);
  };
  return {
    async saveDeviceCredential(record) { const s = await load(); s.records.push(record); await save(s); },
    async findActiveDeviceCredentialByTokenHash({ tokenHash, now }) { const s = await load(); return s.records.find((r) => r.tokenHash === tokenHash && !r.revokedAt && (!r.expiresAt || new Date(r.expiresAt) > now)); },
    async findDeviceCredentialByTokenHash({ tokenHash }) { const s = await load(); return s.records.find((r) => r.tokenHash === tokenHash); },
    async revokeDevice({ deviceId, revokedAt }) { const s = await load(); const r = s.records.find((v) => v.deviceId === deviceId && !v.revokedAt); if (!r) return false; r.revokedAt = revokedAt.toISOString(); await save(s); return true; },
    async countActiveDevices({ now }) { const s = await load(); return s.records.filter((r) => !r.revokedAt && (!r.expiresAt || new Date(r.expiresAt) > now)).length; },
  };
}
