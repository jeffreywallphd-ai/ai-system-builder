import { parseApiEnvelope } from '../../../security/apiErrorEnvelope';
import { secureFetch } from '../../../security/secureFetch';
export type Result<T> = { ok: true; value: T } | { ok: false; error: { code: string; message: string } };
const err = (message: string, code = 'internal'): Result<never> => ({ ok: false, error: { code, message } });
const unwrap = <T,>(r: unknown): Result<T> => { const e = r as any; return e?.ok ? { ok: true, value: e.value as T } : err(e?.error?.message ?? 'Unable to complete request.', e?.error?.code ?? 'internal'); };
const getJson = async (url: string) => parseApiEnvelope(await (await secureFetch(url, { method: 'GET' })).json());
const postJson = async (url: string, body: unknown) => parseApiEnvelope(await (await secureFetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })).json());
export function createThinClientEffectiveAssetProjectionsClient(base = '/api') {
  const b = base.replace(/\/+$/, '');
  return {
    listProjections: async (workspaceId: string) => { try { return unwrap(await getJson(`${b}/effective-asset-projections/workspaces/${encodeURIComponent(workspaceId)}/projections`)); } catch { return err('Effective Assets are not available yet.', 'unavailable'); } },
    readProjection: async (workspaceId: string, projectionId: string) => { try { return unwrap(await getJson(`${b}/effective-asset-projections/workspaces/${encodeURIComponent(workspaceId)}/projections/${encodeURIComponent(projectionId)}`)); } catch { return err('Projection details are not available yet.', 'unavailable'); } },
    refreshProjection: async (_workspaceId: string, _projectionId: string) => err('Refreshing is deferred for Phase 9 thin-client UI.', 'unsupported'),
  };
}
