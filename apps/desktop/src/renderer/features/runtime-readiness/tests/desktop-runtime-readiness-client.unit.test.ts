import { describe, expect, it } from '../../../../../../../modules/testing/node-test';
import { createDesktopRuntimeReadinessClient } from '../api/desktopRuntimeReadinessClient';

describe('desktopRuntimeReadinessClient', () => {
  it('calls preload methods only', async () => {
    (globalThis as any).window = { desktopApi: { listRuntimeReadinessInventory: async () => ({ ok: true, value: { records: [] } }) } };
    const client = createDesktopRuntimeReadinessClient();
    const r = await client.listInventory('workspace.a');
    expect(r.ok).toBe(true);
  });

  it('fails clearly when method unavailable', async () => {
    (globalThis as any).window = { desktopApi: {} };
    const client = createDesktopRuntimeReadinessClient();
    const r = await client.refreshInventory({ workspaceId: 'workspace.a' });
    expect(r).toMatchObject({ ok: false, error: { code: 'unavailable' } });
  });
});
