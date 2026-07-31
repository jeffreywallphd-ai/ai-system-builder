import { describe, expect, it, testDouble } from '../../../../../../modules/testing/node-test';
import { createThinClientRuntimeReadinessClient } from '../api/thinClientRuntimeReadinessClient';

describe('thinClientRuntimeReadinessClient', () => {
  it('requires workspace id', async () => {
    const client = createThinClientRuntimeReadinessClient('/api/runtime-readiness');
    const r = await client.listInventory('');
    expect(r).toMatchObject({ ok: false, error: { code: 'validation' } });
  });

  it('encodes route params safely', async () => {
    const fetchStub = testDouble.fn(async () => ({ json: async () => ({ ok: true, value: { records: [] } }) }));
    (globalThis as any).fetch = fetchStub;
    const client = createThinClientRuntimeReadinessClient('/api/runtime-readiness');
    await client.listInventory('workspace/a');
    expect(String(fetchStub.mock.calls[0]?.[0])).toContain('workspace%2Fa');
  });
});
