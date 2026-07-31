// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { createThinClientUserLibraryClient } from '../api/thinClientUserLibraryClient';

function response(status: number, body: unknown) { return { status, json: vi.fn().mockResolvedValue(body) }; }

describe('thinClientUserLibraryClient', () => {
  it('uses prompt-9 routes and sends valid link/copy payloads', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(response(200, { ok: true, value: { assets: [] } }))
      .mockResolvedValueOnce(response(200, { ok: true, value: { links: [] } }))
      .mockResolvedValueOnce(response(200, { ok: true, value: { items: [] } }))
      .mockResolvedValueOnce(response(200, { ok: true, value: {} }))
      .mockResolvedValueOnce(response(200, { ok: true, value: {} }));
    (globalThis as any).fetch = fetchMock;
    const client = createThinClientUserLibraryClient('/api');
    await client.listAssets(); await client.listLinks('w1'); await client.listEffectiveSources('w1');
    await client.link('w1', { assetId: 'a1', version: '1.0.0' });
    await client.copy('w1', { assetId: 'a1', version: '1.0.0' });
    expect(fetchMock.mock.calls[0][0]).toBe('/api/user-library/assets');
    expect(fetchMock.mock.calls[1][0]).toBe('/api/workspaces/w1/user-library/links');
    const linkBody = JSON.parse(fetchMock.mock.calls[3][1].body as string);
    expect(linkBody.versionSelection.kind).toBe('pinned-version');
    expect(linkBody.propagationPolicy).toBe('pinned-version');
    const copyBody = JSON.parse(fetchMock.mock.calls[4][1].body as string);
    expect(copyBody.selectedVersion).toBe('1.0.0');
    expect(copyBody.targetWorkspaceId).toBeUndefined();
  });
});
