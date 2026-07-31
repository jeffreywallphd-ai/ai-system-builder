import { describe, expect, it, vi } from 'vitest';
import { createDesktopEffectiveAssetProjectionsClient } from '../api/desktopEffectiveAssetProjectionsClient';
describe('desktop effective asset projections client', () => {
  it('calls list with explicit workspace id', async () => {
    const listEffectiveAssetProjections = vi.fn().mockResolvedValue({ ok: true, value: { summaries: [] } });
    (window as any).desktopApi = { listEffectiveAssetProjections };
    await createDesktopEffectiveAssetProjectionsClient().listProjections('workspace.a');
    expect(listEffectiveAssetProjections).toHaveBeenCalledWith({ workspaceId: 'workspace.a' });
  });
  it('returns unavailable when method missing', async () => {
    (window as any).desktopApi = {};
    const result = await createDesktopEffectiveAssetProjectionsClient().readProjection('w', 'p');
    expect(result.ok).toBe(false);
  });
  it('defers refresh in phase 9', async () => {
    (window as any).desktopApi = {};
    const result = await createDesktopEffectiveAssetProjectionsClient().refreshProjection('w', 'p');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('unsupported');
  });
});
