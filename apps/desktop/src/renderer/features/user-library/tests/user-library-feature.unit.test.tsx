// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { it, expect, vi } from 'vitest';
import { NotificationTestHarness, readNotificationMessages } from '../../../../../../../modules/ui/shared/notifications/tests/NotificationTestHarness';
import { UserLibraryFeature } from '../components/UserLibraryFeature';

it('renders friendly labels, links with workspace id, and hides unavailable copy UI', async () => {
  const api = {
    listUserLibraryAssets: vi.fn().mockResolvedValue({ ok: true, value: { assets: [{ userLibraryAssetId: 'a1', version: '1.0.0', displayName: 'Asset 1' }] } }),
    listWorkspaceUserLibraryLinks: vi.fn().mockResolvedValue({ ok: true, value: { links: [{ linkId: 'l1', userLibraryAssetReference: { assetId: 'a1', version: '1.0.0' }, propagationPolicy: 'pinned-version' }] } }),
    readWorkspaceEffectiveAssetSources: vi.fn().mockResolvedValue({ ok: true, value: { items: [{ effectiveSourceKind: 'user-library-linked', assetReference: { assetId: 'x', version: '1' } }] } }),
    linkUserLibraryAssetToWorkspace: vi.fn().mockResolvedValue({ ok: true, value: {} }),
    copyUserLibraryAssetToWorkspace: vi.fn().mockResolvedValue({ ok: true, value: {} }),
  };
  (window as any).desktopApi = api;
  const container = document.createElement('div');
  const root = createRoot(container);
  await act(async () => { root.render(<NotificationTestHarness><UserLibraryFeature workspaceId='ws-1' /></NotificationTestHarness>); });
  const linkButton = container.querySelector('button');
  expect(linkButton?.textContent).toContain('Link to this workspace');
  await act(async () => { linkButton?.dispatchEvent(new MouseEvent('click', { bubbles: true })); });
  expect(api.linkUserLibraryAssetToWorkspace).toHaveBeenCalledWith(expect.objectContaining({ targetWorkspaceId: 'ws-1', userLibraryAssetReference: { assetId: 'a1', version: '1.0.0' }, propagationPolicy: 'pinned-version' }));
  expect(api.copyUserLibraryAssetToWorkspace).not.toHaveBeenCalled();
  expect(readNotificationMessages(container)).toContain('Linked to this workspace.');
  expect(container.textContent).not.toContain('Linked to this workspace.');
  expect(container.textContent).toContain('Detached copy actions are unavailable in Phase 7 UI.');
  expect(container.textContent).toContain('Linked from your reusable library');
  expect(container.textContent).not.toContain('providerPayload');
});
