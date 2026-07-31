export type Result<T> = { ok: true; value: T } | { ok: false; error: { code: string; message: string } };
const err = (message: string, code = 'internal'): Result<never> => ({ ok: false, error: { code, message } });
const unwrap = <T,>(r: unknown): Result<T> => {
  if (!r || typeof r !== 'object') return err('Unable to complete request.');
  const e = r as { ok?: boolean; value?: T; error?: { code?: string; message?: string } };
  return e.ok ? { ok: true, value: e.value as T } : err(e.error?.message ?? 'Unable to complete request.', e.error?.code ?? 'internal');
};
export function createDesktopEffectiveAssetProjectionsClient() {
  const api = ((globalThis as any).window?.desktopApi ?? {}) as Record<string, ((x: any) => Promise<unknown>) | undefined>;
  return {
    listProjections: async (workspaceId: string) => {
      if (typeof api.listEffectiveAssetProjections !== 'function') return err('Effective Assets are not available yet.', 'unavailable');
      return unwrap(await api.listEffectiveAssetProjections({ workspaceId }));
    },
    readProjection: async (workspaceId: string, projectionId: string) => {
      if (typeof api.readEffectiveAssetProjection !== 'function') return err('Projection details are not available yet.', 'unavailable');
      return unwrap(await api.readEffectiveAssetProjection({ workspaceId, projectionId }));
    },
    refreshProjection: async (workspaceId: string, projectionId: string) => {
      return err('Refreshing is deferred for Phase 9 desktop UI.', 'unsupported');
    },
  };
}
