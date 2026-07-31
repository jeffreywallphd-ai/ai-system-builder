import test, { describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

const root = join(process.cwd(), 'modules/application/ports/conversations');

describe('conversation port source boundaries', () => {
  test('barrel exports expected files', async () => {
    const index = await readFile(join(root, 'index.ts'), 'utf8');
    assert.match(index, /conversation-session-repository\.port/);
    assert.match(index, /conversation-turn-repository\.port/);
    assert.match(index, /conversation-message-repository\.port/);
    assert.match(index, /assistant-response-repository\.port/);
  });

  test('port interfaces do not import adapter/provider/transport/ui layers', async () => {
    const files = [
      'conversation-session-repository.port.ts',
      'conversation-turn-repository.port.ts',
      'conversation-message-repository.port.ts',
      'assistant-response-repository.port.ts',
    ];
    for (const file of files) {
      const content = await readFile(join(root, file), 'utf8');
      assert.doesNotMatch(content, /\bfrom\s+['"][^'"]*(?:adapters|provider|transport|ui|electron|shell|workflow)[^'"]*['"]/i);
    }
  });
});
