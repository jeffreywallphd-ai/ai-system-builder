import type {
  UserLibraryAssetRecord,
  UserLibraryEffectiveSourceSummary,
  WorkspaceUserLibraryLinkRecord,
} from '../../../../../../modules/contracts/user-library';
import { parseApiEnvelope } from '../../../security/apiErrorEnvelope';
import { secureFetch } from '../../../security/secureFetch';

type Result<T> = { ok: true; value: T } | { ok: false; error: { code: string; message: string } };
const e = (message: string, code = 'internal'): Result<never> => ({ ok: false, error: { code, message } });
const unwrap = <T,>(envelope: unknown): Result<T> => {
  if (!envelope || typeof envelope !== 'object') return e('Unable to complete request.');
  const value = envelope as { ok?: boolean; value?: T; error?: { code?: string; message?: string } };
  return value.ok === true ? { ok: true, value: value.value as T } : e(value.error?.message ?? 'Unable to complete request.', value.error?.code ?? 'internal');
};

async function getJson(url: string) { const r = await secureFetch(url, { method: 'GET' }); return parseApiEnvelope(await r.json()); }
async function postJson(url: string, body: unknown) { const r = await secureFetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }); return parseApiEnvelope(await r.json()); }

export function createThinClientUserLibraryClient(apiBaseUrl = '/api') {
  const base = apiBaseUrl.replace(/\/+$/, '');
  return {
    async listAssets(): Promise<Result<{ items: readonly UserLibraryAssetRecord[] }>> { try { const r = unwrap<{ assets: readonly UserLibraryAssetRecord[] }>(await getJson(`${base}/user-library/assets`)); return r.ok ? { ok: true, value: { items: r.value.assets ?? [] } } : r; } catch { return e('Unable to read saved reusable assets.'); } },
    async listLinks(workspaceId: string): Promise<Result<{ items: readonly WorkspaceUserLibraryLinkRecord[] }>> { try { const r = unwrap<{ links: readonly WorkspaceUserLibraryLinkRecord[] }>(await getJson(`${base}/workspaces/${encodeURIComponent(workspaceId)}/user-library/links`)); return r.ok ? { ok: true, value: { items: r.value.links ?? [] } } : r; } catch { return e('Unable to read workspace library links.'); } },
    async listEffectiveSources(workspaceId: string): Promise<Result<{ items: readonly UserLibraryEffectiveSourceSummary[] }>> { try { return unwrap(await getJson(`${base}/workspaces/${encodeURIComponent(workspaceId)}/effective-asset-sources`)); } catch { return e('Unable to read source summaries.'); } },
    async link(workspaceId: string, ref: { assetId: string; version: string }): Promise<Result<unknown>> { try { return unwrap(await postJson(`${base}/user-library/workspace-links`, { targetWorkspaceId: workspaceId, userLibraryAssetReference: ref, versionSelection: { kind: 'pinned-version', version: ref.version }, propagationPolicy: 'pinned-version', displayLabel: 'Linked to this workspace' })); } catch { return e('Unable to link asset to this workspace.'); } },
    async copy(workspaceId: string, ref: { assetId: string; version: string }): Promise<Result<unknown>> { try { return unwrap(await postJson(`${base}/workspaces/${encodeURIComponent(workspaceId)}/user-library/copies`, { userLibraryAssetReference: ref, selectedVersion: ref.version })); } catch { return e('Unable to copy asset into this workspace.'); } },
  };
}
