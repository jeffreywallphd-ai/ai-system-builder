// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { createDesktopUserLibraryClient } from '../api/desktopUserLibraryClient';

describe('desktopUserLibraryClient', () => {
  it('parses asset list envelope and sends correct link/copy payloads', async () => {
    const listUserLibraryAssets = vi.fn().mockResolvedValue({ ok: true, value: { assets: [{ userLibraryAssetId: 'a', version: '1.0.0', displayName: 'A' }] } });
    const linkUserLibraryAssetToWorkspace = vi.fn().mockResolvedValue({ ok: true, value: { linked: true } });
    const copyUserLibraryAssetToWorkspace = vi.fn().mockResolvedValue({ ok: true, value: { copied: true } });
    const listWorkspaceUserLibraryLinks = vi.fn().mockResolvedValue({ ok: true, value: { links: [] } });
    const readWorkspaceEffectiveAssetSources = vi.fn().mockResolvedValue({ ok: true, value: { items: [] } });
    (window as any).desktopApi = { listUserLibraryAssets, linkUserLibraryAssetToWorkspace, copyUserLibraryAssetToWorkspace, listWorkspaceUserLibraryLinks, readWorkspaceEffectiveAssetSources };
    const client = createDesktopUserLibraryClient();
    const assets = await client.listAssets();
    expect(assets.ok && assets.value.items[0].userLibraryAssetId).toBe('a');
    await client.listLinks('ws-1');
    expect(listWorkspaceUserLibraryLinks).toHaveBeenCalledWith({ workspaceId: 'ws-1' });
    await client.link('ws-1', { assetId: 'asset-1', version: '2.0.0' });
    expect(linkUserLibraryAssetToWorkspace.mock.calls[0][0]).toMatchObject({ targetWorkspaceId: 'ws-1', versionSelection: { kind: 'pinned-version', version: '2.0.0' }, propagationPolicy: 'pinned-version' });
    await client.copy('ws-1', { assetId: 'asset-1', version: '2.0.0' });
    expect(copyUserLibraryAssetToWorkspace.mock.calls[0][0]).toMatchObject({ targetWorkspaceId: 'ws-1', selectedVersion: '2.0.0' });
    expect(copyUserLibraryAssetToWorkspace.mock.calls[0][0].propagationPolicy).toBeUndefined();
  });

  it('returns unavailable when preload methods are missing and does not use localStorage', async () => {
    (window as any).desktopApi = {};
    const getItemSpy = vi.spyOn(window.localStorage.__proto__, 'getItem');
    const client = createDesktopUserLibraryClient();
    const result = await client.listAssets();
    expect(result.ok).toBe(false);
    expect(getItemSpy).not.toHaveBeenCalled();
    getItemSpy.mockRestore();
  });
});
