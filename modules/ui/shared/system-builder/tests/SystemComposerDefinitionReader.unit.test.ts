import assert from "node:assert/strict";
import { describe, it } from "../../../../testing/node-test";
import { createSystemComposerDefinitionReader } from "../SystemComposerDefinitionReader";
import { ListSystemBuilderComposerAssetsUseCase } from "../../../../application/use-cases/system-builder/list-system-builder-composer-assets.use-case";
import { normalizeAssetId } from "../../../../contracts/asset";

const query = (id: string, workspaceId = "workspace.a") => ({ workspaceId, definitionRef: { kind: "asset-definition-version", id, version: "3.0.0" } }) as any;
const success = (input: ReturnType<typeof query>) => ({ ok: true as const, value: { definitionId: input.definitionRef.id, version: input.definitionRef.version, definitionRef: { ...input.definitionRef } } as any });
const tick = () => new Promise<void>(resolve => setImmediate(resolve));

describe("Bounded exact Composer reads", () => {
  for (const mode of ["read", "readSummary"] as const) {
    it(`does not join an inactive ${mode} generation already choosing cancellation`, async () => {
      const reader = createSystemComposerDefinitionReader();
      let active = true;
      let calls = 0;
      const input = query("asset.a");
      const client = {
        readComposerAsset: async () => { calls += 1; return success(input); },
        listComposerAssets: async () => { calls += 1; return { ok: true as const, value: { items: [success(input).value] } }; },
      };
      const obsolete = reader[mode](client, input, () => active);
      active = false;
      const current = Promise.resolve().then(() => reader[mode](client, input, () => true));
      const [oldResult, currentResult] = await Promise.all([obsolete, current]);
      assert.equal(oldResult.ok, false);
      assert.equal(currentResult.ok, true);
      assert.equal(calls, 1);
    });
  }

  it("does not reuse a settled failed read for an immediate explicit retry", async () => {
    const reader = createSystemComposerDefinitionReader();
    let calls = 0;
    const input = query("asset.a");
    const client = { listComposerAssets: async () => {
      calls += 1;
      return calls === 1
        ? { ok: false as const, error: { code: "unavailable", message: "Synthetic failure" } }
        : { ok: true as const, value: { items: [success(input).value] } };
    } };
    assert.equal((await reader.readSummary(client, input, () => true)).ok, false);
    assert.equal((await reader.readSummary(client, input, () => true)).ok, true);
    assert.equal(calls, 2);
  });

  it("does not poison a new generation with an already-settled cancelled continuation", async () => {
    const reader = createSystemComposerDefinitionReader();
    let active = true;
    let release!: () => void;
    let calls = 0;
    const input = query("asset.a");
    const client = { listComposerAssets: async () => {
      calls += 1;
      if (calls === 1) return new Promise<any>(resolve => { release = () => resolve({ ok: true, value: { items: [], nextCursor: "next" } }); });
      return { ok: true as const, value: { items: [success(input).value] } };
    } };
    const obsolete = reader.readSummary(client, input, () => active);
    await tick();
    active = false;
    release();
    assert.equal((await obsolete).ok, false);
    assert.equal((await reader.readSummary(client, input, () => true)).ok, true);
    assert.equal(calls, 2);
  });

  it("loads valid long IDs through the real bounded catalog without accepting a prefix collision", async () => {
    const id = normalizeAssetId("custom." + "a".repeat(194));
    const definition: any = { definitionId: id, version: "3.0.0", displayName: "Long component", description: "Synthetic structural fixture", assetType: "ui-component", assetFamily: "structural", lifecycleStatus: "published", provenance: { sourceKind: "human-authored" } };
    const reference = query(id).definitionRef;
    const searches: string[] = [];
    const registry: any = {
      listDefinitionCards: async (input: any) => {
        if (input.includeBuiltIns) return { items: [] };
        searches.push(input.searchText);
        return { items: [{ definitionRef: reference, definitionId: id, version: definition.version, displayName: definition.displayName, summary: definition.description, assetType: definition.assetType, assetFamily: definition.assetFamily, lifecycleStatus: "published", builtIn: false }] };
      },
      readDefinitionDetail: async () => ({ definition, builtIn: false }),
    };
    const catalog = new ListSystemBuilderComposerAssetsUseCase(registry);
    const real = await createSystemComposerDefinitionReader().readSummary({ listComposerAssets: input => catalog.execute(input) }, query(id), () => true);
    assert.equal(real.ok, true);
    assert.deepEqual(searches, [id.slice(0, 200)]);
    const pages: any[] = [];
    const collision = query(id.slice(0, 200) + "b");
    const exact = await createSystemComposerDefinitionReader().readSummary({ listComposerAssets: async input => {
      pages.push(input);
      return { ok: true, value: { items: [success(input.cursor ? query(id) : collision).value], ...(!input.cursor ? { nextCursor: "second-page" } : {}) } };
    } }, query(id), () => true);
    assert.equal(exact.ok, true);
    assert.equal(exact.ok && exact.value.definitionId, id);
    assert.deepEqual(pages.map(page => page.searchText), [id.slice(0, 200), id.slice(0, 200)]);
    assert.equal(pages[1].cursor, "second-page");
  });

  it("resolves a bounded exact structural projection without fetching editable schemas", async () => {
    const reader = createSystemComposerDefinitionReader(); const queries: any[] = [];
    const input = query("asset.a");
    const result = await reader.readSummary({
      listComposerAssets: async request => { queries.push(request); return { ok: true, value: { items: [{ ...success(input).value, configurationSchema: { fields: [] }, defaultConfiguration: { title: "Hidden editable default" } }], nextCursor: "unrelated-next-page" } }; },
      readComposerAsset: async () => { throw new Error("Structural discovery must not fetch detail"); },
    }, input, () => true);
    assert.equal(result.ok, true); assert.equal(queries.length, 1);
    if (result.ok) { assert.equal("configurationSchema" in result.value, false); assert.equal("defaultConfiguration" in result.value, false); }
    assert.deepEqual(queries[0], { workspaceId: "workspace.a", searchText: "asset.a", limit: 200 });
  });

  it("denies a repeated structural continuation and mismatched version", async () => {
    const reader = createSystemComposerDefinitionReader(); let calls = 0;
    const result = await reader.readSummary({ listComposerAssets: async () => { calls += 1; return { ok: true, value: { items: [{ ...success(query("asset.a")).value, version: "2.0.0" }], nextCursor: "repeated" } }; } }, query("asset.a"), () => true);
    assert.equal(result.ok, false); assert.equal(calls, 2);
  });
  it("shares the physical budget across navigation and selection, then progresses after settlement", async () => {
    const reader = createSystemComposerDefinitionReader();
    let activeA = true, outstanding = 0, peak = 0, calls = 0;
    const pending: Array<() => void> = [];
    const client = { readComposerAsset: async (input: any) => {
      calls += 1; outstanding += 1; peak = Math.max(peak, outstanding);
      return new Promise<any>(resolve => pending.push(() => { outstanding -= 1; resolve(success(input)); }));
    } };
    const first = Array.from({ length: 12 }, (_, index) => reader.read(client, query(`a.${index}`), () => activeA));
    await tick(); assert.equal(calls, 8); assert.equal(outstanding, 8);
    activeA = false;
    const second = Array.from({ length: 12 }, (_, index) => reader.read(client, query(`b.${index}`), () => true));
    const selection = reader.read(client, query("b.0"), () => true);
    await tick(); assert.equal(calls, 8); assert.equal(outstanding, 8);
    for (let round = 0; round < 4; round += 1) { for (const release of pending.splice(0)) release(); await tick(); }
    const results = await Promise.all([...first, ...second, selection]);
    assert.equal(peak, 8); assert.equal(outstanding, 0); assert.equal(calls, 20);
    assert.equal(results.filter(result => result.ok).length, 21);
    assert.equal(results.filter(result => !result.ok).length, 4);
  });

  it("deduplicates exact authority context and captures queued identity without cross-client/workspace reuse", async () => {
    const reader = createSystemComposerDefinitionReader(); const inputs: any[] = [];
    const pending: Array<() => void> = [];
    const client = { readComposerAsset: async (input: any) => { inputs.push(input); return new Promise<any>(resolve => pending.push(() => resolve(success(input)))); } };
    const otherClient = { ...client };
    const input = query("asset.a");
    const requests = [reader.read(client, input, () => true), reader.read(client, query("asset.a"), () => true), reader.read(client, query("asset.a", "workspace.b"), () => true), reader.read(otherClient, query("asset.a"), () => true)];
    input.workspaceId = "workspace.changed"; input.definitionRef.id = "asset.changed";
    await tick(); assert.equal(inputs.length, 3); assert.equal(inputs[0].workspaceId, "workspace.a"); assert.equal(inputs[0].definitionRef.id, "asset.a");
    for (const release of pending) release();
    assert.ok((await Promise.all(requests)).every(result => result.ok));
  });

  it("denies substituted identities and raw rejection without exposing failure detail", async () => {
    const reader = createSystemComposerDefinitionReader();
    const mismatch = await reader.read({ readComposerAsset: async input => ({ ...success(input), value: { ...success(input).value, definitionRef: query("asset.other").definitionRef } }) }, query("asset.a"), () => true);
    const rejected = await reader.read({ readComposerAsset: async () => { throw new Error("synthetic-private-exception"); } }, query("asset.a"), () => true);
    const inactive = await reader.read({ readComposerAsset: async () => { throw new Error("must not execute"); } }, query("asset.a"), () => false);
    assert.ok([mismatch, rejected, inactive].every(result => !result.ok));
    assert.ok(!JSON.stringify([mismatch, rejected, inactive]).includes("synthetic-private-exception"));
  });

  it("keeps expected identity private when an adapter mutates its request or substitutes reference kind", async () => {
    const reader = createSystemComposerDefinitionReader();
    const mutated = await reader.read({ readComposerAsset: async (input: any) => {
      input.workspaceId = "workspace.other"; input.definitionRef.id = "asset.other";
      return success(input);
    } }, query("asset.a"), () => true);
    const wrongKind = await reader.read({ readComposerAsset: async input => ({ ...success(input), value: { ...success(input).value, definitionRef: { ...input.definitionRef, kind: "asset-instance" } } }) }, query("asset.a"), () => true);
    assert.equal(mutated.ok, false); assert.equal(wrongKind.ok, false);
  });
});
