/* Fixed grader outside the trial workspace. No external resource loader. */
const { JSDOM } = require('jsdom');
const { readFileSync, writeFileSync } = require('node:fs');
const path = require('node:path');
(async () => {
  const workspace = process.argv[2];
  const dom = new JSDOM(readFileSync(path.join(workspace, 'index.html'), 'utf8'), { runScripts: 'outside-only' });
  try {
    const { window } = dom;
    let calls = 0;
    window.runTask = async () => { calls++; if (calls === 1) throw new Error('fixture failure'); return 'Saved'; };
    window.eval(readFileSync(path.join(workspace, 'app.js'), 'utf8'));
    const form = window.document.querySelector('#form');
    const result = { label: !!window.document.querySelector('label[for="name"]'), status_role: window.document.querySelector('#status').getAttribute('role') };
    form.dispatchEvent(new window.Event('submit', { cancelable: true }));
    await new Promise(resolve => setImmediate(resolve));
    const retry = window.document.querySelector('#retry');
    Object.assign(result, { calls_after_failure: calls, retry_visible: retry.hidden === false, retry_named: /retry/i.test(retry.textContent), error_present: !!window.document.querySelector('#status').textContent.trim() });
    retry.click();
    await new Promise(resolve => setImmediate(resolve));
    Object.assign(result, { calls_after_retry: calls, saved: /Saved/.test(window.document.querySelector('#status').textContent) });
    writeFileSync(process.argv[3], JSON.stringify(result));
  } finally { dom.window.close(); }
})().catch(() => { process.stderr.write('journey.failed\n'); process.exitCode = 1; });
