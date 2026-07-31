import { readFileSync } from 'node:fs';
import { describe, expect, it } from '../../testing/node-test';
import { API_RUNTIME_READINESS_READ_OPERATION, API_RUNTIME_CAPABILITY_STATUS_READ_OPERATION } from '../api';
import {
  DESKTOP_RUNTIME_CAPABILITY_STATUS_READ_OPERATION,
  DESKTOP_RUNTIME_READINESS_READ_OPERATION,
} from '../ipc';

describe('runtime-readiness transport parity', () => {
  it('keeps legacy runtime-readiness operation parity between API and IPC', () => {
    expect(new Set([API_RUNTIME_READINESS_READ_OPERATION, API_RUNTIME_CAPABILITY_STATUS_READ_OPERATION]))
      .toEqual(new Set([DESKTOP_RUNTIME_READINESS_READ_OPERATION, DESKTOP_RUNTIME_CAPABILITY_STATUS_READ_OPERATION]));
  });

  it('keeps v2 runtime-readiness channel family aligned between IPC and preload bridge', () => {
    const ipc = readFileSync('modules/adapters/transport/ipc-electron/runtime-readiness/registerRuntimeReadinessIpc.ts', 'utf8');
    const preload = readFileSync('apps/desktop/src/preload/exposedApi.ts', 'utf8');
    const channels = [
      'DESKTOP_RUNTIME_READINESS_REFRESH_INVENTORY_REQUEST_CHANNEL',
      'DESKTOP_RUNTIME_READINESS_LIST_INVENTORY_REQUEST_CHANNEL',
      'DESKTOP_RUNTIME_READINESS_READ_INVENTORY_REQUEST_CHANNEL',
      'DESKTOP_RUNTIME_READINESS_READ_LATEST_INVENTORY_REQUEST_CHANNEL',
      'DESKTOP_RUNTIME_READINESS_SUMMARIZE_INVENTORY_REQUEST_CHANNEL',
      'DESKTOP_RUNTIME_READINESS_CREATE_BINDING_REQUEST_CHANNEL',
      'DESKTOP_RUNTIME_READINESS_VALIDATE_BINDING_REQUEST_CHANNEL',
    ];
    for (const channel of channels) {
      expect(ipc).toContain(channel);
      expect(preload).toContain(channel);
    }
    expect(ipc).not.toContain('runtime-readiness:execute');
    expect(preload).not.toContain('runtime-readiness:execute');
  });
});
