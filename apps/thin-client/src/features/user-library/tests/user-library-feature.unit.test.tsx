// @vitest-environment jsdom
import { JSDOM } from 'jsdom';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { describe, it, expect, vi } from 'vitest';
import { UserLibraryFeature } from '../components/UserLibraryFeature';

const dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'http://localhost/' });
(globalThis as any).window = dom.window;
(globalThis as any).document = dom.window.document;
function response(status: number, body: unknown) { return { status, json: vi.fn().mockResolvedValue(body) }; }

describe('thin user-library ui', () => {
  it('shows loading/empty/friendly source labels and copy-unavailable message', async () => {
    (globalThis as any).fetch = vi.fn()
      .mockResolvedValueOnce(response(200, { ok: true, value: { assets: [{ userLibraryAssetId: 'a1', version: '1', displayName: 'Asset 1' }] } }))
      .mockResolvedValueOnce(response(200, { ok: true, value: { links: [] } }))
      .mockResolvedValueOnce(response(200, { ok: true, value: { items: [{ effectiveSourceKind: 'workspace-local', assetReference: { assetId: 'a', version: '1' } }] } }))
      .mockResolvedValueOnce(response(200, { ok: true, value: {} }))
      .mockResolvedValueOnce(response(200, { ok: true, value: { assets: [{ userLibraryAssetId: 'a1', version: '1', displayName: 'Asset 1' }] } }))
      .mockResolvedValueOnce(response(200, { ok: true, value: { links: [] } }))
      .mockResolvedValueOnce(response(200, { ok: true, value: { items: [{ effectiveSourceKind: 'workspace-local', assetReference: { assetId: 'a', version: '1' } }] } }));
    const container = document.createElement('div');
    const root = createRoot(container);
    await act(async () => { root.render(<UserLibraryFeature workspaceId='ws-1' />); });
    expect(container.textContent).toContain('Created in this workspace');
    expect(container.textContent).toContain('Detached copy actions are unavailable in Phase 7 UI.');
    const linkButton = container.querySelector('button');
    await act(async () => { linkButton?.dispatchEvent(new MouseEvent('click', { bubbles: true })); });
    const linkRequest = (globalThis as any).fetch.mock.calls.find((call: any[]) => String(call[0]).includes('/workspace-links'));
    expect(linkRequest[1].body).toContain('"targetWorkspaceId":"ws-1"');
    expect(linkRequest[1].body).toContain('"propagationPolicy":"pinned-version"');
    expect(container.textContent).not.toContain('providerPayload');
  });
});
