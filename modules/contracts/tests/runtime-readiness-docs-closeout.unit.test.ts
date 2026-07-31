import { readFileSync } from 'node:fs';
import { describe, expect, it } from '../../testing/node-test';

describe('runtime-readiness docs guardrails', () => {
  it('routes runtime-readiness prompts to the runtime-readiness pack and indexes the pack', () => {
    const routing = readFileSync('docs/context/prompt-routing.md', 'utf8');
    const index = readFileSync('docs/context/packs/index.pack.md', 'utf8');
    expect(routing).toContain('docs/context/packs/runtime-readiness-binding.pack.md');
    expect(index).toContain('docs/context/packs/runtime-readiness-binding.pack.md');
  });

  it('keeps runtime readiness documented as non-executing setup/readiness in Assets / Plans', () => {
    const architecture = readFileSync('docs/architecture/runtime-readiness-binding.md', 'utf8');
    const adr = readFileSync('docs/adr/ADR-0021-runtime-readiness-binding.md', 'utf8');
    expect(architecture).toContain('non-executing');
    expect(architecture).toContain('Assets / Plans');
    expect(architecture).toContain('ready-for-setup');
    expect(architecture).toContain('does **not** mean ready-to-run');
    expect(adr).toContain('do not execute workflows');
    expect(adr).toContain('execution plan preparation remains non-executing');
  });

  it('does not claim execution/install/download/credential behavior in runtime readiness docs', () => {
    const pack = readFileSync('docs/context/packs/runtime-readiness-binding.pack.md', 'utf8');
    expect(pack).toContain('non-executing readiness only');
    expect(pack).toContain('Provider invocation');
    expect(pack).toContain('Runtime installation, model download, credential creation, secret storage');
  });
});
