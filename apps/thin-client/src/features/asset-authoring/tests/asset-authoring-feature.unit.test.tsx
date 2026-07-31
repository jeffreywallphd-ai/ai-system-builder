// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { NotificationTestHarness, readNotificationMessages } from '../../../../../../modules/ui/shared/notifications/tests/NotificationTestHarness';

const client = {
  listAuthoredAssets: vi.fn(), listDrafts: vi.fn(), listOverrides: vi.fn(), listEffectiveSummaries: vi.fn(),
  createDraft: vi.fn(), updateDraft: vi.fn(), publishDraft: vi.fn(), disableOverride: vi.fn(),
};
vi.mock('../api/thinClientAssetAuthoringClient', () => ({ createThinClientAssetAuthoringClient: () => client }));
import { AssetAuthoringFeature } from '../components/AssetAuthoringFeature';

describe('AssetAuthoringFeature thin', () => {
  afterEach(() => vi.resetAllMocks());
  it('uses view models and shows success only on success', async () => {
    client.listAuthoredAssets.mockResolvedValue({ ok: true, value: { items: [{ authoredAssetId: 'a1', status: 'active', editableFields: { displayName: 'Safe Label' } }] } });
    client.listDrafts.mockResolvedValue({ ok: true, value: { items: [] } });
    client.listOverrides.mockResolvedValue({ ok: true, value: { items: [] } });
    client.listEffectiveSummaries.mockResolvedValue({ ok: true, value: { items: [] } });
    client.createDraft.mockResolvedValue({ ok: false, error: { code: 'validation', message: 'invalid' } });
    const c = document.createElement('div'); document.body.appendChild(c); const root = createRoot(c);
    await act(async () => { root.render(<NotificationTestHarness><AssetAuthoringFeature workspaceId='w1' /></NotificationTestHarness>); });
    const input = c.querySelector('input[aria-label="Display name"]') as HTMLInputElement;
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set?.call(input, 'X');
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
    const form = c.querySelector('form')!;
    await act(async () => { form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })); });
    expect(readNotificationMessages(c)).toContain('invalid');
    expect(c.textContent).not.toContain('invalid');
    expect(c.textContent).not.toContain('Draft created.');
    expect(c.textContent).toContain('Asset type');
    root.unmount(); c.remove();
  });
});
