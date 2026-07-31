import { readFileSync } from 'node:fs';
import { describe, expect, it } from '../../../../../../../modules/testing/node-test';

describe('runtime-readiness client boundary discipline', () => {
  it('desktop runtime-readiness client avoids forbidden imports', () => {
    const source = readFileSync('apps/desktop/src/renderer/features/runtime-readiness/api/desktopRuntimeReadinessClient.ts', 'utf8');
    const forbidden = /from\s+["'][^"']*(?:modules\/application|modules\/adapters|modules\/hosts|api-express|ipc-electron)[^"']*["']/;
    expect(forbidden.test(source)).toBe(false);
  });

  it('thin-client runtime-readiness client avoids forbidden imports', () => {
    const source = readFileSync('apps/thin-client/src/features/runtime-readiness/api/thinClientRuntimeReadinessClient.ts', 'utf8');
    const forbidden = /from\s+["'][^"']*(?:modules\/application|modules\/adapters|modules\/hosts|ipc-electron)[^"']*["']/;
    expect(forbidden.test(source)).toBe(false);
  });
});
