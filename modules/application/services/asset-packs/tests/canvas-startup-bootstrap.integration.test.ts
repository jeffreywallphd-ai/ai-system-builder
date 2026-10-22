import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createInMemoryStructuredDocumentStore } from '../../../../adapters/persistence/shared';
import { assertJsonCompatibleAssetRecord } from '../../../../adapters/persistence/asset/local-asset-record-store';
import { createLocalAssetDefinitionRepositoryAdapter } from '../../../../adapters/persistence/asset';
import { composeInternalAssetRegistry } from '../../../../hosts/shared/composition/composeInternalAssetRegistry';
import { composeAssetImplementationKernel, DEFAULT_TRUSTED_ASSET_IMPLEMENTATION_SEEDS } from '../../../../hosts/shared/composition/composeAssetImplementationKernel';
import { createSystemFoundationInitializationError } from '../install-system-foundation-pack.service';
import { InstallSystemAssetPackService } from '../install-system-asset-pack.service';
import { RegisterAssetDefinitionUseCase } from '../../../use-cases/asset';
import { SYSTEM_FOUNDATION_PACK_MANIFEST } from '../system-packs';
import type { AssetDefinition, AssetReference } from '../../../../contracts/asset';
const a = SYSTEM_FOUNDATION_PACK_MANIFEST.assets[0]!.definition;
const b = SYSTEM_FOUNDATION_PACK_MANIFEST.assets[1]!.definition;
const ref = (d: AssetDefinition): AssetReference => ({ kind: 'asset-definition-version', id: d.definitionId, version: d.version });
async function fixture() { const root = await mkdtemp(join(tmpdir(), 'canvas-bootstrap-')); const documents = createInMemoryStructuredDocumentStore().forOrganization('startup-owner' as never); const registry = composeInternalAssetRegistry({ rootDirectory: root, documents }); return { root, documents, registry, repository: registry.assetKernel.repositories.definitionRepository }; }
describe('bounded Canvas Foundation bootstrap', () => {
    it('preserves unrelated duplicate legacy records and refuses ambiguity in a selected identity', async () => {
        const { repository, documents } = await fixture();
        const duplicate = { ...a, displayName: 'Distinct retained duplicate' };
        await documents.writeDocument('asset-kernel', 'definitions.json', [a, duplicate]);
        await repository.saveDefinitions!([b], [undefined]);
        const stored = await documents.readDocument<AssetDefinition[]>('asset-kernel', 'definitions.json');
        assert.deepEqual(stored?.value, [a, duplicate, b]);
        await assert.rejects(repository.saveDefinitions!([{ ...a, displayName: 'Ambiguous overwrite' }], [duplicate]));
        assert.deepEqual((await documents.readDocument('asset-kernel', 'definitions.json'))?.value, [a, duplicate, b]);
    });
    it('validates tiny deeply nested arrays with a linear reflection budget', () => {
        let value: unknown = 1;
        for (let level = 0; level < 26; level++) value = [value];
        const original = Object.getOwnPropertyDescriptors;
        let calls = 0;
        Object.getOwnPropertyDescriptors = ((object: object) => {
            if (++calls > 100) throw new Error('Reflection budget exceeded for53byte JSON');
            return original(object);
        }) as typeof original;
        try { assert.doesNotThrow(() => assertJsonCompatibleAssetRecord(value)); }
        finally { Object.getOwnPropertyDescriptors = original; }
        assert.ok(calls <= 100);
    });
    it('binds organization context before awaited batch effects', async () => {
        const root = createInMemoryStructuredDocumentStore();
        let owner = 'organization-a';
        const context = { ...root, get organizationId() { return owner as never; } };
        const repository = createLocalAssetDefinitionRepositoryAdapter({ rootDir: await mkdtemp(join(tmpdir(), 'startup-owner-')), documents: context });
        const writing = repository.saveDefinitions!([a], [undefined]);
        owner = 'organization-b';
        await writing;
        const first = await root.forOrganization('organization-a' as never).readDocument<AssetDefinition[]>('asset-kernel', 'definitions.json');
        assert.equal(first?.value[0]?.definitionId, a.definitionId);
        assert.equal(await root.forOrganization('organization-b' as never).readDocument('asset-kernel', 'definitions.json'), undefined);
    });
    it('atomically validates bounded batches and rejects stale expected bodies without replacing user edits', async () => {
        const { repository } = await fixture();
        assert.equal(typeof repository.saveDefinitions, 'function');
        await repository.saveDefinitions!([a, b], [undefined, undefined]);
        const edited = { ...a, displayName: 'User edited content' };
        await repository.saveDefinition(edited);
        await assert.rejects(repository.saveDefinitions!([{ ...a, displayName: 'Stale overwrite' }, b], [a, b]));
        assert.equal((await repository.getDefinition(ref(a)))?.displayName, 'User edited content');
        await assert.rejects(repository.saveDefinitions!([a, a], [edited, edited]));
        await assert.rejects(repository.saveDefinitions!(Array(251).fill(a), Array(251).fill(undefined)));
        let callbacks = 0;
        const active = Object.defineProperty({ ...b }, 'displayName', { enumerable: true, get() { callbacks++; return 'Active'; } });
        await assert.rejects(repository.saveDefinitions!([active], [b]));
        assert.equal(callbacks, 0);
        assert.deepEqual(await repository.getDefinition(ref(b)), b);
    });
    it('validates every registration member before any persistence effect', async () => {
        const { repository } = await fixture();
        const register = new RegisterAssetDefinitionUseCase({ definitionRepository: repository });
        assert.equal(typeof register.executeMany, 'function');
        const result = await register.executeMany([a, { ...b, definitionId: '/invalid' }], [undefined, undefined]);
        assert.equal(result.ok, false);
        assert.equal((await repository.listDefinitions()).definitions.length, 0);
    });
    it('installs all343 exact Foundation definitions with bounded reads and atomic batch saves, then revalidates stored content', async () => {
        const { registry, repository } = await fixture();
        let reads = 0, batches = 0, singles = 0;
        const get = repository.getDefinitions!.bind(repository), save = repository.saveDefinitions?.bind(repository), single = repository.saveDefinition.bind(repository);
        assert.equal(typeof save, 'function');
        repository.getDefinitions = async (refs) => { reads++; assert.ok(refs.length <= 250); return get(refs); };
        repository.saveDefinitions = async (ds, expected) => { batches++; assert.ok(ds.length <= 250); return save!(ds, expected); };
        repository.saveDefinition = async (d) => { singles++; return single(d); };
        const installed = await registry.installSystemFoundationPack.installAll();
        assert.ok(installed.every(r => r.status === 'installed'));
        assert.equal(installed.reduce((n, r) => n + r.installedEntryCount, 0), 343);
        assert.equal(reads, 3);
        assert.equal(batches, 3);
        assert.equal(singles, 0);
        const stored = await repository.getDefinition(ref(a));
        assert.ok(stored);
        await single({ ...stored, displayName: 'Tampered body; unchanged marker' });
        const denied = await registry.installSystemFoundationPack.install();
        assert.equal(denied.status, 'failed');
        assert.equal((await repository.getDefinition(ref(a)))?.displayName, 'Tampered body; unchanged marker');
    });
    it('fails closed on a substituted or malformed batch read before writes', async () => {
        for (const malformed of ['short', 'wrong-identity']) {
            const { registry, repository } = await fixture();
            let writes = 0;
            repository.saveDefinition = async (d) => { writes++; return d; };
            repository.getDefinitions = async (refs) => malformed === 'short' ? [] : refs.map(() => a);
            const result = await registry.installSystemFoundationPack.install();
            assert.equal(result.status, 'failed');
            assert.equal(writes, 0);
        }
    });
    it('does not bypass a rejecting injected single-registration hook', async () => {
        const { repository } = await fixture();
        let calls = 0;
        const installer = new InstallSystemAssetPackService({ definitionRepository: repository, registerAssetDefinition: { async execute() { calls++; return { ok: false }; } } });
        const result = await installer.install({ manifest: SYSTEM_FOUNDATION_PACK_MANIFEST });
        assert.equal(result.status, 'failed');
        assert.equal(calls, 105);
        assert.equal((await repository.listDefinitions()).definitions.length, 0);
    });
    it('rechecks expected content after a real revision conflict rather than overwriting a concurrent edit', async () => {
        const { repository, documents } = await fixture();
        await repository.saveDefinitions!([a, b], [undefined, undefined]);
        const write = documents.writeDocument.bind(documents);
        let injected = false;
        documents.writeDocument = async (namespace, key, value, options) => {
            if (!injected && namespace === 'asset-kernel' && key === 'definitions.json' && options?.expectedRevision) {
                injected = true;
                const current = await documents.readDocument<AssetDefinition[]>(namespace, key);
                assert.ok(current);
                await write(namespace, key, current.value.map(d => d.definitionId === a.definitionId ? { ...d, displayName: 'Concurrent edit' } : d), { expectedRevision: current.revision });
            }
            return write(namespace, key, value, options);
        };
        // The operation binds the actual organization store; instrument that same store.
        documents.forOrganization = () => documents;
        await assert.rejects(repository.saveDefinitions!([{ ...a, displayName: 'Stale batch' }, b], [a, b]));
        assert.equal(injected, true);
        assert.equal((await repository.getDefinition(ref(a)))?.displayName, 'Concurrent edit');
    });
    it('retains an interrupted attempt and revalidates on a healthy retry', async () => {
        const { registry, repository, documents } = await fixture();
        await registry.installSystemFoundationPack.installAll();
        const original = documents.writeDocument.bind(documents);
        let deny = true;
        documents.forOrganization = () => documents;
        documents.writeDocument = async (namespace, key, value, options) => { if (deny && namespace === 'asset-implementation/bindings') {
            deny = false;
            throw new Error('Synthetic denied binding');
        } return original(namespace, key, value, options); };
        const kernel = composeAssetImplementationKernel({ documents, definitions: repository });
        await assert.rejects(kernel.ensureTrustedBuiltIns(), /binding is invalid/);
        assert.equal(deny, false);
        await kernel.ensureTrustedBuiltIns();
        const seed = DEFAULT_TRUSTED_ASSET_IMPLEMENTATION_SEEDS[0]!;
        assert.ok(await kernel.repository.readBinding(seed.bindingId));
    });
    it('keeps Foundation failure attribution bounded and free of private repository detail', () => {
        const sentinel = 'private/path/token';
        const error = createSystemFoundationInitializationError(Array(10).fill({ status: 'failed', packVersion: sentinel, failedEntryCount: 999999, diagnostics: [{ severity: 'error', code: 'definition-read-failed', message: sentinel }, { severity: 'error', code: sentinel }] }));
        assert.equal(error.message, 'System foundation assets are unavailable.');
        assert.ok(!JSON.stringify(error).includes(sentinel));
        assert.equal((error as any).failures.length, 3);
        assert.equal((error as any).failures[0].failedEntries, 1000);
        assert.deepEqual((error as any).failures[0].codes, ['definition-read-failed', 'validation-or-unknown']);
    });
    it('uses a private bounded definition snapshot only during missing trusted publication and joins overlapping initializers', async () => {
        const { registry, repository, documents } = await fixture();
        await registry.installSystemFoundationPack.installAll();
        let batches = 0, singles = 0;
        const get = repository.getDefinitions!.bind(repository), single = repository.getDefinition.bind(repository);
        repository.getDefinitions = async (refs) => { batches++; return get(refs); };
        repository.getDefinition = async (r) => { singles++; return single(r); };
        const kernel = composeAssetImplementationKernel({ documents, definitions: repository });
        await Promise.all([kernel.ensureTrustedBuiltIns(), kernel.ensureTrustedBuiltIns()]);
        assert.equal(DEFAULT_TRUSTED_ASSET_IMPLEMENTATION_SEEDS.length, 343);
        assert.equal(batches, 2);
        assert.equal(singles, 0);
        const seed = DEFAULT_TRUSTED_ASSET_IMPLEMENTATION_SEEDS[0]!;
        const release = await kernel.repository.readRelease(seed.releaseId);
        assert.ok(release);
        await documents.writeDocument('asset-implementation/releases', seed.releaseId, { ...release, packageDigest: 'sha256:' + '0'.repeat(64) });
        await assert.rejects(kernel.ensureTrustedBuiltIns(), /incompatible/);
    });
});
