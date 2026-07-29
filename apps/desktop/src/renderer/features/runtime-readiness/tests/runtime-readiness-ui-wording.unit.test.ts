import { readFileSync } from 'node:fs';
import { describe, expect, it } from '../../../../../../../modules/testing/node-test';

describe('runtime-readiness UI wording guardrails', () => {
  it('keeps technical readiness controls out of the simplified Systems navigation', () => {
    const desktop = readFileSync('apps/desktop/src/renderer/pages/SystemBuilderPage.tsx', 'utf8');
    const thin = readFileSync('apps/thin-client/src/pages/SystemBuilderPage.tsx', 'utf8');
    for (const source of [desktop, thin]) {
      expect(source).not.toContain('AssetPlansTab');
      expect(source).not.toContain('label: "Plans"');
      expect(source).toContain('label: "Publish"');
      expect(source).not.toContain('ready-to-run');
      expect(source).not.toContain('execution-ready');
      expect(source).not.toContain('start workflow');
      expect(source).not.toContain('invoke provider');
    }
  });
});
