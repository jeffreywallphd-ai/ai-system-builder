import { readFileSync } from 'node:fs';
import { describe, expect, it } from '../../testing/node-test';

const read = (p:string)=>readFileSync(p,'utf8');

describe('execution plan docs guardrails', ()=>{
  it('routes and indexes execution plan pack', ()=>{
    const index = read('docs/context/packs/index.pack.md');
    const routing = read('docs/context/prompt-routing.md');
    expect(index).toContain('execution-plan-preparation.pack.md');
    expect(routing).toContain('execution-plan-preparation.pack.md');
  });

  it('keeps execution plan preparation explicitly non-executing and preview-in-setup language', ()=>{
    const arch = read('docs/architecture/execution-plan-preparation.md');
    const adr = read('docs/adr/ADR-0022-execution-plan-preparation.md');
    const pack = read('docs/context/packs/execution-plan-preparation.pack.md');
    expect(arch).toContain('workspace-scoped, non-executing planning layer');
    expect(adr).toContain('Assets / Plans / Setup');
    expect(arch).toContain('ready-for-review');
    expect(arch).toContain('does **not** mean executable');
    expect(arch).toContain('does **not** mean executable or ready-to-run');
    expect(adr).toContain('do not execute workflows');
    expect(pack).toContain('Planning layer only; no execution.');
  });

  it('does not overclaim execution outcomes', ()=>{
    const docs = [
      read('docs/architecture/execution-plan-preparation.md'),
      read('docs/adr/ADR-0022-execution-plan-preparation.md'),
      read('docs/context/packs/execution-plan-preparation.pack.md')
    ].join('\n');
    expect(docs.toLowerCase()).toContain('disallowed status language for execution plan preparation');
    for (const banned of ['runtime-ready','workflow-ready']) {
      expect(docs.toLowerCase()).not.toContain(banned);
    }
  });
});
