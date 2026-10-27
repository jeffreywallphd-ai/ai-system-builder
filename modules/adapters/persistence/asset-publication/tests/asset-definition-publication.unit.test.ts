import assert from "node:assert/strict";
import test from "node:test";
import { normalizeAssetImplementationRevocation, normalizeAssetImplementationRevocationId } from "../../../../contracts/asset-implementation";
import type { StructuredDocumentStore } from "../../shared";
import { createFixture, studioValue, derivedValue, workspaceId, organization, otherOrganization, reference, semantic, resources, signal, hookTransactions } from "./asset-publication.fixture";

for (const backend of ["memory", "sqlite"] as const) for (const layout of ["organization", "platform"] as const) {
  const label = `${backend}/${layout}`;
  for (const kind of ["studio", "derived"] as const) {
    const namespace = kind === "studio" ? "asset-studio/asset-drafts" : "asset-authoring/derived-customizations";
    const id = (record: any) => kind === "studio" ? record.draftId : record.customizationId;
    const ref = (record: any) => kind === "studio" ? record.definitionRef : record.derivedDefinitionRef;
    const key = (record: any) => `${workspaceId}::${id(record)}`;
    const receiptKey = (record: any) => `${kind}::${key(record)}`;
    const transition = (record: any) => ({workspaceId, draftId: id(record), customizationId: id(record), expectedRevision: record.revision, actorId: "publisher"});
    const ready = (fixture: ReturnType<typeof createFixture>) => kind === "studio" ? fixture.reviewedStudio() : fixture.reviewedDerived();
    const resultValue = (result: any) => kind === "studio" ? studioValue(result) : derivedValue(result);
    const succeeded = (result: any) => kind === "studio" ? result.ok : result.kind === "success";
    const workflow = (fixture: ReturnType<typeof createFixture>, publication = fixture.publication): any => kind === "studio" ? fixture.studio(publication) : fixture.derived(publication);
    const command = async (fixture: ReturnType<typeof createFixture>, record: any) => ({current: record, definition: await fixture.reviewedDefinition(record), ...(kind === "derived" ? {baseDefinition: await fixture.definitions.getDefinition(record.base.definitionRef)} : {}), publishedAt: "2026-10-22T15:00:00.000Z", actorId: "publisher"});
    const invoke = (publication: any, input: any) => kind === "studio" ? publication.publishStudio(input) : publication.publishDerived(input);

    for (const mutation of ["update", "abandon", "review"] as const) test(`${label}/${kind}: a competing ${mutation} prevents all stale publication effects`, {timeout: 10000}, async () => {
      const fixture = createFixture(backend, layout), entered = signal(), resume = signal();
      let pending: Promise<any> | undefined;
      try {
        const record = await ready(fixture);
        const paused = {...fixture.publication, [kind === "studio" ? "publishStudio" : "publishDerived"]: async (input: any) => {entered.resolve(); await resume.promise; return invoke(fixture.publication, input);}};
        pending = workflow(fixture, paused).publish(transition(record));
        await entered.promise;
        const ordinary = workflow(fixture);
        const changed = mutation === "update" ? await ordinary.update({...transition(record), semanticDefinition: semantic("Newer status summary"), resources, semanticPatch: {"display-name": "Newer customized summary"}}) : await ordinary[mutation](transition(record));
        assert.equal(succeeded(changed), true, JSON.stringify(changed));
        resume.resolve();
        assert.equal(succeeded(await pending), false);
        assert.equal(await fixture.definitions.getDefinition(ref(record)), undefined);
        assert.equal(await fixture.documents.readDocument("asset-publication/receipts", receiptKey(record)), undefined);
        assert.deepEqual((await fixture.documents.readDocument(namespace, key(record)))?.value, (changed as any).value);
      } finally {resume.resolve(); await pending; fixture.close();}
    });

    test(`${label}/${kind}: a failure after definition and receipt writes rolls back every publication effect`, async () => {
      const fixture = createFixture(backend, layout);
      try {
        const record = await ready(fixture);
        const intercept = (target: StructuredDocumentStore): StructuredDocumentStore => new Proxy(target, {get(store, property) {
          if (property === "forOrganization") return (owner: typeof organization) => intercept(store.forOrganization(owner));
          if (property === "writeDocument") return async (ns: string, docKey: string, value: any, options: any) => {
            if (ns === namespace && value.status === "published") throw new Error("synthetic final record failure");
            return store.writeDocument(ns, docKey, value, options);
          };
          const value = Reflect.get(store, property); return typeof value === "function" ? value.bind(store) : value;
        }});
        const store = hookTransactions(layout === "platform" ? fixture.root : fixture.documents, intercept);
        assert.equal(succeeded(await workflow(fixture, fixture.publisher(store)).publish(transition(record))), false);
        assert.equal(await fixture.definitions.getDefinition(ref(record)), undefined);
        assert.equal(await fixture.documents.readDocument("asset-publication/receipts", receiptKey(record)), undefined);
        assert.deepEqual((await fixture.documents.readDocument(namespace, key(record)))?.value, record);
        assert.equal(succeeded(await workflow(fixture).publish(transition(record))), true);
      } finally {fixture.close();}
    });

    test(`${label}/${kind}: lost acknowledgement reconciles the exact committed record without a second write`, async () => {
      const fixture = createFixture(backend, layout);
      try {
        const record = await ready(fixture);
        const originalCommand = transition(record);
        const store = hookTransactions(layout === "platform" ? fixture.root : fixture.documents, tx => tx, () => {throw new Error("synthetic lost acknowledgement");});
        assert.equal(succeeded(await workflow(fixture, fixture.publisher(store)).publish(originalCommand)), false);
        const committed = await fixture.documents.readDocument<any>(namespace, key(record));
        const receipt = await fixture.documents.readDocument("asset-publication/receipts", receiptKey(record));
        assert.equal(committed?.value.status, "published"); assert.ok(receipt);
        const definition = await fixture.definitions.getDefinition(ref(record));
        // The editor retains the reviewed revision after a lost response. Its
        // Retry sends this original command, not a revision read from storage.
        assert.deepEqual(resultValue(await workflow(fixture).publish(originalCommand)), committed!.value);
        assert.deepEqual(resultValue(await workflow(fixture).publish({...originalCommand, actorId: "other-authorized-actor"})), committed!.value);
        assert.deepEqual(resultValue(await workflow(fixture).publish(transition(committed!.value))), committed!.value);
        assert.equal(succeeded(await workflow(fixture).publish({...originalCommand, expectedRevision: originalCommand.expectedRevision - 1})), false);
        assert.deepEqual(await fixture.documents.readDocument(namespace, key(record)), committed);
        assert.deepEqual(await fixture.documents.readDocument("asset-publication/receipts", receiptKey(record)), receipt);
        assert.deepEqual(await fixture.definitions.getDefinition(ref(record)), definition);
      } finally {fixture.close();}
    });

    for (const replacement of ["deleted", "foreign", "missing-receipt", "foreign-receipt"] as const) test(`${label}/${kind}: retry rejects ${replacement} publication and never recreates or adopts it`, async () => {
      const fixture = createFixture(backend, layout);
      try {
        const record = await ready(fixture);
        const published: any = resultValue(await workflow(fixture).publish(transition(record)));
        if (["deleted", "foreign"].includes(replacement)) {
          await fixture.definitions.deleteDefinition!(ref(record));
          if (replacement === "foreign") await fixture.definitions.saveDefinition({...await fixture.reviewedDefinition(record), displayName: "Foreign replacement"});
        } else {
          const receipt = await fixture.documents.readDocument<any>("asset-publication/receipts", receiptKey(record));
          if (replacement === "missing-receipt") await fixture.documents.deleteDocument("asset-publication/receipts", receiptKey(record));
          else await fixture.documents.writeDocument("asset-publication/receipts", receiptKey(record), {...receipt!.value, organizationId: otherOrganization});
        }
        const before = await fixture.definitions.getDefinition(ref(record));
        assert.equal(succeeded(await workflow(fixture).publish(transition(published))), false);
        assert.deepEqual(await fixture.definitions.getDefinition(ref(record)), before);
        assert.deepEqual((await fixture.documents.readDocument(namespace, key(record)))?.value, published);
      } finally {fixture.close();}
    });

    test(`${label}/${kind}: independently verified review bytes, snapshot, owner and private commit receipt are required`, async () => {
      const fixture = createFixture(backend, layout);
      try {
        const record = await ready(fixture), input = await command(fixture, record);
        await assert.rejects(invoke(fixture.publication, {...input, definition: {...input.definition, displayName: "Unreviewed content"}}));
        await assert.rejects(invoke(fixture.publisher(fixture.root, fixture.root.forOrganization(otherOrganization)), input));
        const snapshot = await fixture.implementations.readSourceSnapshot(workspaceId, record.review!.sourceSnapshotId);
        assert.ok(snapshot);
        // A complete-looking legacy record/definition is not an owned commit receipt.
        const published: any = resultValue(await workflow(fixture).publish(transition(record)));
        await fixture.documents.deleteDocument("asset-publication/receipts", receiptKey(record));
        await assert.rejects(invoke(fixture.publication, await command(fixture, published)));
      } finally {fixture.close();}
    });

    test(`${label}/${kind}: missing immutable review snapshot denies a valid-looking publication`, async () => {
      const fixture = createFixture(backend, layout);
      try {
        const record = await ready(fixture), input = await command(fixture, record);
        assert.ok(record.review);
        assert.equal(await fixture.documents.deleteDocument("asset-implementation/source-snapshots", record.review.sourceSnapshotId), true);
        await assert.rejects(invoke(fixture.publication, input));
        assert.equal(await fixture.definitions.getDefinition(ref(record)), undefined);
        assert.deepEqual((await fixture.documents.readDocument(namespace, key(record)))?.value, record);
      } finally {fixture.close();}
    });

    test(`${label}/${kind}: caller mutations during verified source reads cannot change the committed review`, {timeout: 10_000}, async () => {
      const fixture = createFixture(backend, layout), entered = signal(), resume = signal();
      let pending: Promise<any> | undefined;
      try {
        const record = await ready(fixture);
        // Deliberately retain a mutable runtime caller view for this race test.
        const input: any = await command(fixture, record), expected = structuredClone(input);
        const artifacts = {...fixture.artifacts, async readVerified<T>(...args: Parameters<typeof fixture.artifacts.readVerified>): Promise<T> {
          entered.resolve(); await resume.promise; return fixture.artifacts.readVerified<T>(...args);
        }};
        pending = invoke(fixture.publisher(layout === "platform" ? fixture.root : fixture.documents, fixture.documents, artifacts), input);
        await entered.promise;
        input.current.workspaceId = "workspace.changed"; input.current.revision = 99;
        input.current.review.sourceSnapshotId = "source-snapshot.changed";
        input.definition.displayName = "Unreviewed changed content";
        if (kind === "derived") input.baseDefinition.displayName = "Changed base";
        input.actorId = "changed-actor"; input.publishedAt = "invalid changed time";
        resume.resolve(); const published = await pending;
        assert.equal(published.status, "published"); assert.equal(published.workspaceId, workspaceId);
        assert.equal(published.revision, expected.current.revision + 1);
        assert.deepEqual(published.review, expected.current.review);
        assert.equal(published.publication.publishedBy, expected.actorId); assert.equal(published.publication.publishedAt, expected.publishedAt);
        assert.deepEqual(await fixture.definitions.getDefinition(ref(expected.current)), expected.definition);
        assert.deepEqual((await fixture.documents.readDocument(namespace, key(expected.current)))?.value, published);
        if (kind === "derived") assert.deepEqual(await fixture.definitions.getDefinition(expected.current.base.definitionRef), expected.baseDefinition);
        assert.equal((await fixture.root.forOrganization(otherOrganization).listDocuments("asset-publication/receipts")).length, 0);
      } finally {resume.resolve(); await pending; fixture.close();}
    });
  }

  test(`${label}: request owner is captured before asynchronous artifact verification`, async () => {
    const fixture = createFixture(backend, layout);
    try {
      const record = await fixture.reviewedStudio(), definition = await fixture.reviewedDefinition(record);
      let owner = organization;
      const ownerView = new Proxy(fixture.documents, {get(target, property) {return property === "organizationId" ? owner : Reflect.get(target, property);}});
      const publishing = fixture.publisher(fixture.root, ownerView).publishStudio({current: record, definition, actorId: "publisher", publishedAt: "2026-10-22T15:00:00.000Z"});
      owner = otherOrganization;
      const result = await publishing;
      assert.equal(result.status, "published");
      assert.equal((await fixture.root.forOrganization(otherOrganization).listDocuments("asset-publication/receipts")).length, 0);
      assert.equal((await fixture.documents.listDocuments("asset-publication/receipts")).length, 1);
    } finally {fixture.close();}
  });

  test(`${label}: competing reviewed Studio drafts with one definition identity have exactly one owner`, async () => {
    const fixture = createFixture(backend, layout);
    try {
      const one = await fixture.reviewedStudio(), two = await fixture.reviewedStudio();
      const results = await Promise.all([one, two].map(record => fixture.studio().publish({workspaceId, draftId: record.draftId, expectedRevision: record.revision, actorId: "publisher"})));
      assert.equal(results.filter(result => result.ok).length, 1);
      assert.equal((await fixture.documents.listDocuments("asset-publication/receipts")).length, 1);
      assert.equal((await fixture.drafts.list({workspaceId})).records.filter(record => record.status === "published").length, 1);
    } finally {fixture.close();}
  });

  for (const change of ["revoked", "base-definition", "backing", "release-snapshot"] as const) test(`${label}: a derived base ${change} at the transaction boundary denies publication`, async () => {
    const fixture = createFixture(backend, layout);
    try {
      const record = await fixture.reviewedDerived();
      const input = {current: record, definition: await fixture.reviewedDefinition(record), baseDefinition: (await fixture.definitions.getDefinition(record.base.definitionRef))!, publishedAt: "2026-10-22T15:00:00.000Z", actorId: "publisher"};
      if (change === "revoked") await fixture.implementations.saveRevocation(normalizeAssetImplementationRevocation({revocationId: normalizeAssetImplementationRevocationId("implementation-revocation.publication-1"), releaseId: record.base.implementationReleaseId, reasonCode: "qualification-revoked", message: "Synthetic revocation", revokedAt: "2026-10-22T14:00:00.000Z", revokedBy: "reviewer"}));
      if (change === "base-definition") {await fixture.definitions.deleteDefinition!(record.base.definitionRef); await fixture.definitions.saveDefinition({...input.baseDefinition, displayName: "Changed base"});}
      if (change === "backing") assert.equal(await fixture.documents.deleteDocument("asset-implementation/backing-resources", record.base.implementationReleaseId), true);
      if (change === "release-snapshot") {
        const release = (await fixture.implementations.readRelease(record.base.implementationReleaseId, workspaceId))!;
        await fixture.documents.writeDocument("asset-implementation/releases", record.base.implementationReleaseId, {...release, sourceSnapshotId: "source-snapshot.foreign"});
      }
      await assert.rejects(fixture.publication.publishDerived(input));
      assert.equal(await fixture.definitions.getDefinition(record.derivedDefinitionRef), undefined);
    } finally {fixture.close();}
  });
}
