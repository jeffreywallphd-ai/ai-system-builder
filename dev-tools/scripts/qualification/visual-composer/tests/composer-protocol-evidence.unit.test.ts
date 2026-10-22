import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { observeComposerProtocol } from "../e2e/meaningful-system-journeys";

async function fixture() {
  const parent = path.resolve(".local-codex/t");
  await mkdir(parent, { recursive: true });
  const root = await mkdtemp(path.join(parent, "protocol-evidence-"));
  let listener: (response: any) => void = () => undefined;
  let attached = "";
  const page: any = { url: () => "http://127.0.0.1/systems", on: (_name: string, value: typeof listener) => { listener = value; }, off: () => undefined };
  const info: any = {
    outputPath: (name: string) => path.join(root, name),
    attach: async (_name: string, value: { body: string }) => { attached = value.body; },
  };
  const finish = observeComposerProtocol(page, info);
  return {
    emit: (response: any) => listener(response),
    finish: async () => { await finish(); assert.equal(await readFile(path.join(root, "composer-protocol-outcomes.json"), "utf8"), attached + "\n"); return JSON.parse(attached); },
    cleanup: async () => {
      const relative = path.relative(parent, root);
      assert.ok(relative && !relative.startsWith("..") && !path.isAbsolute(relative));
      await rm(root, { recursive: true, force: true });
    },
  };
}

test("protocol evidence excludes credentials, URLs, payloads and unknown error text", async () => {
  const f = await fixture();
  const sentinel = "synthetic-private-evidence-sentinel";
  const body = JSON.stringify({ ok: false, error: { code: sentinel, message: sentinel }, value: { items: [{ definitionId: sentinel }] } });
  try {
    f.emit({
      url: () => `http://user:${sentinel}@127.0.0.1/api/systems/composer/assets?searchText=${sentinel}&token=${sentinel}`,
      status: () => 500,
      headers: () => ({ "content-length": String(Buffer.byteLength(body)), authorization: sentinel, "set-cookie": sentinel }),
      request: () => ({ method: () => "POST", postData: () => JSON.stringify({ credential: sentinel, instances: [{ definitionRef: { id: "conversation.message-composer" }, selectedConfiguration: { modelBinding: { privateValue: sentinel }, protectedPrompt: sentinel } }] }) }),
      text: async () => body,
    });
    f.emit({ url: () => "http://untrusted.example/api/systems/composer/assets", text: () => { throw new Error("foreign response must not be read"); } });
    f.emit({ url: () => "http://127.0.0.1:9999/api/systems/composer/assets", text: () => { throw new Error("different fixture authority must not be read"); } });
    const result = await f.finish();
    assert.equal(result.rows.length, 1);
    assert.equal(result.rows[0].code, "other");
    assert.equal(result.rows[0].modelBindingPresent, true);
    assert.equal(result.rows[0].requestedDefinitionReturned, true);
    assert.ok(!JSON.stringify(result).includes(sentinel));
    assert.ok(!JSON.stringify(result).includes("http://"));
    assert.ok(!JSON.stringify(result).includes("authorization"));
    assert.ok(!JSON.stringify(result).includes("protectedPrompt"));
  } finally { await f.cleanup(); }
});

test("protocol observation bounds events and refuses oversized bodies before reading", async () => {
  const f = await fixture();
  let reads = 0;
  try {
    const response = {
      url: () => "http://127.0.0.1/api/systems/revisions/save", status: () => 200,
      headers: () => ({ "content-length": String(3 * 1024 * 1024) }),
      request: () => ({ method: () => "POST", postData: () => "x".repeat(512 * 1024 + 1) }),
      text: async () => { reads += 1; throw new Error("must not read"); },
    };
    for (let i = 0; i < 300; i += 1) f.emit(response);
    f.emit({ ...response, url: () => "http://127.0.0.1/api/private-unknown" });
    const result = await f.finish();
    assert.equal(result.rows.length, 256);
    assert.equal(result.dropped, 44);
    assert.equal(reads, 0);
    assert.ok(Buffer.byteLength(JSON.stringify(result)) < 128 * 1024);
  } finally { await f.cleanup(); }
});
