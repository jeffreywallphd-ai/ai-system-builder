import test, { describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

const root = join(process.cwd(), 'modules/application/ports/execution-runs');

describe('execution-run port source boundaries', () => {
  test('barrel exports expected execution-run repository ports', async () => {
    const index = await readFile(join(root, 'index.ts'), 'utf8');
    for (const expected of [
      'execution-run-repository.port',
      'execution-attempt-repository.port',
      'execution-event-repository.port',
      'execution-result-repository.port',
      'execution-approval-repository.port',
      'execution-cancellation-request-repository.port',
      'execution-retry-request-repository.port',
      'execution-runtime-reference-repository.port',
    ]) assert.match(index, new RegExp(expected.replace('.', '\\.')));
  });

  test('execution-run repository query surface remains bounded and safe', async () => {
    const content = await readFile(join(root, 'execution-run-repository.port.ts'), 'utf8');
    assert.match(content, /workspaceId/);
    assert.doesNotMatch(content, /messageText|prompt|secret|token|apiKey|providerPayload|runtimeLog/i);
  });
});
