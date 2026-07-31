import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { AssetBinding, AssetComposition, AssetDefinition, AssetInstance, AssetReference } from "../../../../contracts/asset";
import type {
  AssetBindingListQuery,
  AssetBindingRepositoryPort,
  AssetCompositionListQuery,
  AssetCompositionRepositoryPort,
  AssetDefinitionListQuery,
  AssetDefinitionRepositoryPort,
  AssetInstanceListQuery,
  AssetInstanceRepositoryPort,
} from "../../../ports/asset";
import {
  CreateAssetCompositionUseCase,
  CreateAssetInstanceUseCase,
  ListAssetCompositionsUseCase,
  ListAssetDefinitionsUseCase,
  ListAssetInstancesUseCase,
  ReadAssetCompositionUseCase,
  ReadAssetDefinitionUseCase,
  ReadAssetInstanceUseCase,
  RegisterAssetDefinitionUseCase,
  UpdateAssetCompositionUseCase,
  UpdateAssetDefinitionUseCase,
  UpdateAssetInstanceUseCase,
  ValidateAssetCompositionUseCase,
  ValidateAssetDefinitionUseCase,
  ValidateAssetInstanceUseCase,
} from "..";

const definitionRef: AssetReference = { kind: "asset-definition", id: "definition.one" as AssetReference["id"] };
const instanceRef: AssetReference = { kind: "asset-instance", id: "instance.one" as AssetReference["id"] };
const compositionRef: AssetReference = { kind: "asset-composition", id: "composition.one" as AssetReference["id"] };
const bindingRef: AssetReference = { kind: "asset-binding", id: "binding.one" as AssetReference["id"] };

class FakeDefinitionRepository implements AssetDefinitionRepositoryPort {
  public readonly saved: AssetDefinition[] = [];
  public lastQuery?: AssetDefinitionListQuery;
  public definitions = new Map<string, AssetDefinition>();

  public async saveDefinition(definition: AssetDefinition): Promise<AssetDefinition> {
    this.saved.push(definition);
    this.definitions.set(String(definition.definitionId), definition);
    return definition;
  }
  public async getDefinition(reference: AssetReference): Promise<AssetDefinition | undefined> { return this.definitions.get(reference.id); }
  public async listDefinitions(query?: AssetDefinitionListQuery) { this.lastQuery = query; return { definitions: [...this.definitions.values()], nextCursor: "next-definition" }; }
}

class FakeInstanceRepository implements AssetInstanceRepositoryPort {
  public readonly saved: AssetInstance[] = [];
  public lastQuery?: AssetInstanceListQuery;
  public instances = new Map<string, AssetInstance>();

  public async saveInstance(instance: AssetInstance): Promise<AssetInstance> {
    this.saved.push(instance);
    this.instances.set(String(instance.instanceId), instance);
    return instance;
  }
  public async getInstance(reference: AssetReference): Promise<AssetInstance | undefined> { return this.instances.get(reference.id); }
  public async listInstances(query?: AssetInstanceListQuery) { this.lastQuery = query; return { instances: [...this.instances.values()], nextCursor: "next-instance" }; }
}

class FakeCompositionRepository implements AssetCompositionRepositoryPort {
  public readonly saved: AssetComposition[] = [];
  public lastQuery?: AssetCompositionListQuery;
  public compositions = new Map<string, AssetComposition>();

  public async saveComposition(composition: AssetComposition): Promise<AssetComposition> {
    this.saved.push(composition);
    this.compositions.set(String(composition.compositionId), composition);
    return composition;
  }
  public async getComposition(reference: AssetReference): Promise<AssetComposition | undefined> { return this.compositions.get(reference.id); }
  public async listCompositions(query?: AssetCompositionListQuery) { this.lastQuery = query; return { compositions: [...this.compositions.values()], nextCursor: "next-composition" }; }
}

class FakeBindingRepository implements AssetBindingRepositoryPort {
  public readonly saved: AssetBinding[] = [];
  public lastQuery?: AssetBindingListQuery;
  public bindings = new Map<string, AssetBinding>();

  public async saveBinding(binding: AssetBinding): Promise<AssetBinding> {
    this.saved.push(binding);
    this.bindings.set(String(binding.bindingId), binding);
    return binding;
  }
  public async getBinding(reference: AssetReference): Promise<AssetBinding | undefined> { return this.bindings.get(reference.id); }
  public async listBindings(query?: AssetBindingListQuery) { this.lastQuery = query; return { bindings: [...this.bindings.values()], nextCursor: "next-binding" }; }
}

function validDefinition(overrides: Partial<AssetDefinition> = {}): AssetDefinition {
  return {
    definitionId: "definition.one",
    assetType: "tool",
    assetFamily: "resource-backed",
    version: "1.0.0",
    displayName: "Definition One",
    description: "A valid asset definition.",
    lifecycleStatus: "draft",
    reviewStatus: "unreviewed",
    provenance: { sourceKind: "human-authored" },
    ...overrides,
  };
}

function warningDefinition(): AssetDefinition {
  return validDefinition({ assetFamily: "structural" });
}

function invalidDefinition(): AssetDefinition {
  return validDefinition({ definitionId: "/unsafe/path", displayName: "" });
}

function validInstance(overrides: Partial<AssetInstance> = {}): AssetInstance {
  return {
    instanceId: "instance.one",
    definitionRef,
    displayName: "Instance One",
    lifecycleStatus: "draft",
    reviewStatus: "unreviewed",
    provenance: { sourceKind: "human-authored" },
    ...overrides,
  };
}

function invalidInstance(): AssetInstance {
  return validInstance({ instanceId: "../bad", definitionRef: { kind: "asset-instance", id: "not-a-definition" } });
}

function validBinding(overrides: Partial<AssetBinding> = {}): AssetBinding {
  return {
    bindingId: "binding.one",
    bindingKind: "input",
    sourceRef: definitionRef,
    targetRef: definitionRef,
    lifecycleStatus: "draft",
    provenance: { sourceKind: "human-authored" },
    ...overrides,
  };
}

function validComposition(overrides: Partial<AssetComposition> = {}): AssetComposition {
  return {
    compositionId: "composition.one",
    compositionType: "feature",
    displayName: "Composition One",
    version: "1.0.0",
    lifecycleStatus: "draft",
    reviewStatus: "unreviewed",
    rootInstanceRefs: [instanceRef],
    instanceRefs: [instanceRef],
    provenance: { sourceKind: "human-authored" },
    ...overrides,
  };
}

function invalidComposition(): AssetComposition {
  return validComposition({ compositionId: "https://bad.example/id", rootInstanceRefs: [{ kind: "asset-instance", id: "missing-root" }] });
}

describe("asset definition registry use cases", () => {
  it("registers a valid definition after validation and saves without mutating input", async () => {
    const repo = new FakeDefinitionRepository();
    const definition = validDefinition();
    const before = structuredClone(definition);
    const result = await new RegisterAssetDefinitionUseCase({ definitionRepository: repo }).execute(definition);
    assert.equal(result.ok, true);
    assert.equal(result.validation?.status, "valid");
    assert.equal(repo.saved.length, 1);
    assert.deepEqual(definition, before);
    assert.equal(repo.saved[0]?.version, definition.version);
  });

  it("does not save invalid definitions and returns validation failure", async () => {
    const repo = new FakeDefinitionRepository();
    const result = await new RegisterAssetDefinitionUseCase({ definitionRepository: repo }).execute(invalidDefinition());
    assert.equal(result.ok, false);
    assert.equal(result.error?.code, "validation-failed");
    assert.equal(result.validation?.status, "invalid");
    assert.equal(repo.saved.length, 0);
    await assert.doesNotReject(() => new RegisterAssetDefinitionUseCase({ definitionRepository: repo }).execute(invalidDefinition()));
  });

  it("saves valid definitions with warnings and returns the validation result", async () => {
    const repo = new FakeDefinitionRepository();
    const result = await new RegisterAssetDefinitionUseCase({ definitionRepository: repo }).execute(warningDefinition());
    assert.equal(result.ok, true);
    assert.equal(result.validation?.status, "valid-with-warnings");
    assert.equal(repo.saved.length, 1);
  });

  it("reads existing definitions, returns not-found for missing ones, and rejects unsafe reference kinds", async () => {
    const repo = new FakeDefinitionRepository();
    await repo.saveDefinition(validDefinition());
    assert.equal((await new ReadAssetDefinitionUseCase({ definitionRepository: repo }).execute(definitionRef)).value?.definitionId, "definition.one");
    assert.equal((await new ReadAssetDefinitionUseCase({ definitionRepository: repo }).execute({ kind: "asset-definition", id: "missing" })).error?.code, "not-found");
    assert.equal((await new ReadAssetDefinitionUseCase({ definitionRepository: repo }).execute(instanceRef)).error?.code, "invalid-reference");
  });

  it("lists definitions by forwarding query parameters and updates with validation before save", async () => {
    const repo = new FakeDefinitionRepository();
    const query = { assetType: "tool", text: "search", limit: 25, cursor: "cursor" } satisfies AssetDefinitionListQuery;
    const listResult = await new ListAssetDefinitionsUseCase({ definitionRepository: repo }).execute(query);
    assert.equal(listResult.nextCursor, "next-definition");
    assert.equal(repo.lastQuery, query);
    assert.equal((await new UpdateAssetDefinitionUseCase({ definitionRepository: repo }).execute(validDefinition())).ok, true);
    assert.equal((await new UpdateAssetDefinitionUseCase({ definitionRepository: repo }).execute(invalidDefinition())).ok, false);
    assert.equal(repo.saved.length, 1);
  });
});

describe("asset instance registry use cases", () => {
  it("creates valid instances using referenced definition context and does not mutate input", async () => {
    const definitions = new FakeDefinitionRepository();
    const instances = new FakeInstanceRepository();
    await definitions.saveDefinition(validDefinition());
    const instance = validInstance();
    const before = structuredClone(instance);
    const result = await new CreateAssetInstanceUseCase({ definitionRepository: definitions, instanceRepository: instances }).execute(instance);
    assert.equal(result.ok, true);
    assert.equal(result.validation?.status, "valid");
    assert.equal(instances.saved.length, 1);
    assert.deepEqual(instance, before);
  });

  it("does not save invalid instances or instances with missing referenced definitions", async () => {
    const definitions = new FakeDefinitionRepository();
    const instances = new FakeInstanceRepository();
    assert.equal((await new CreateAssetInstanceUseCase({ definitionRepository: definitions, instanceRepository: instances }).execute(invalidInstance())).ok, false);
    const missingDefinition = await new CreateAssetInstanceUseCase({ definitionRepository: definitions, instanceRepository: instances }).execute(validInstance());
    assert.equal(missingDefinition.ok, false);
    assert.equal(missingDefinition.validation?.status, "invalid");
    assert.match(missingDefinition.validation?.issues.at(-1)?.message ?? "", /definition was not found/);
    assert.equal(instances.saved.length, 0);
  });

  it("reads, lists, and updates instances through repository ports", async () => {
    const definitions = new FakeDefinitionRepository();
    const instances = new FakeInstanceRepository();
    await definitions.saveDefinition(validDefinition());
    await instances.saveInstance(validInstance());
    assert.equal((await new ReadAssetInstanceUseCase({ instanceRepository: instances }).execute(instanceRef)).value?.instanceId, "instance.one");
    assert.equal((await new ReadAssetInstanceUseCase({ instanceRepository: instances }).execute({ kind: "asset-instance", id: "missing" })).error?.code, "not-found");
    assert.equal((await new ReadAssetInstanceUseCase({ instanceRepository: instances }).execute(definitionRef)).error?.code, "invalid-reference");
    const query = { definitionRef, parentCompositionRef: compositionRef, limit: 10 } satisfies AssetInstanceListQuery;
    await new ListAssetInstancesUseCase({ instanceRepository: instances }).execute(query);
    assert.equal(instances.lastQuery, query);
    assert.equal((await new UpdateAssetInstanceUseCase({ definitionRepository: definitions, instanceRepository: instances }).execute(validInstance({ instanceId: "instance.two" }))).ok, true);
  });
});

describe("asset composition registry use cases", () => {
  it("creates valid compositions with available instance and definition context", async () => {
    const definitions = new FakeDefinitionRepository();
    const instances = new FakeInstanceRepository();
    const compositions = new FakeCompositionRepository();
    await definitions.saveDefinition(validDefinition());
    await instances.saveInstance(validInstance());
    const composition = validComposition();
    const before = structuredClone(composition);
    const result = await new CreateAssetCompositionUseCase({ compositionRepository: compositions, definitionRepository: definitions, instanceRepository: instances }).execute(composition);
    assert.equal(result.ok, true);
    assert.equal(result.validation?.status, "valid");
    assert.equal(compositions.saved.length, 1);
    assert.deepEqual(composition, before);
  });



  it("resolves composition bindingRefs through the optional binding repository before save", async () => {
    const definitions = new FakeDefinitionRepository();
    const instances = new FakeInstanceRepository();
    const bindings = new FakeBindingRepository();
    const compositions = new FakeCompositionRepository();
    await definitions.saveDefinition(validDefinition());
    await instances.saveInstance(validInstance());
    await bindings.saveBinding(validBinding());

    const result = await new CreateAssetCompositionUseCase({
      compositionRepository: compositions,
      definitionRepository: definitions,
      instanceRepository: instances,
      bindingRepository: bindings,
    }).execute(validComposition({ bindingRefs: [bindingRef] }));

    assert.equal(result.ok, true);
    assert.equal(result.validation?.status, "valid");
    assert.equal(compositions.saved.length, 1);
  });

  it("does not save invalid compositions and returns structured validation issues for incomplete context", async () => {
    const definitions = new FakeDefinitionRepository();
    const instances = new FakeInstanceRepository();
    const compositions = new FakeCompositionRepository();
    assert.equal((await new CreateAssetCompositionUseCase({ compositionRepository: compositions, definitionRepository: definitions, instanceRepository: instances }).execute(invalidComposition())).ok, false);
    const incomplete = await new CreateAssetCompositionUseCase({ compositionRepository: compositions, definitionRepository: definitions, instanceRepository: instances }).execute(validComposition());
    assert.equal(incomplete.ok, false);
    assert.equal(incomplete.validation?.status, "invalid");
    assert.match(incomplete.validation?.issues.at(-1)?.message ?? "", /instance was not found/);
    assert.equal(compositions.saved.length, 0);
  });

  it("reads, lists, and updates compositions through repository ports", async () => {
    const definitions = new FakeDefinitionRepository();
    const instances = new FakeInstanceRepository();
    const compositions = new FakeCompositionRepository();
    await definitions.saveDefinition(validDefinition());
    await instances.saveInstance(validInstance());
    await compositions.saveComposition(validComposition());
    assert.equal((await new ReadAssetCompositionUseCase({ compositionRepository: compositions }).execute(compositionRef)).value?.compositionId, "composition.one");
    assert.equal((await new ReadAssetCompositionUseCase({ compositionRepository: compositions }).execute({ kind: "asset-composition", id: "missing" })).error?.code, "not-found");
    assert.equal((await new ReadAssetCompositionUseCase({ compositionRepository: compositions }).execute(instanceRef)).error?.code, "invalid-reference");
    const query = { compositionType: "feature", lifecycleStatus: "draft", text: "composition" } satisfies AssetCompositionListQuery;
    await new ListAssetCompositionsUseCase({ compositionRepository: compositions }).execute(query);
    assert.equal(compositions.lastQuery, query);
    assert.equal((await new UpdateAssetCompositionUseCase({ compositionRepository: compositions, definitionRepository: definitions, instanceRepository: instances }).execute(validComposition({ compositionId: "composition.two" }))).ok, true);
  });
});

describe("asset registry deferred behavior", () => {
  it("read and list use cases return stored records without revalidating by default", async () => {
    const definitions = new FakeDefinitionRepository();
    const instances = new FakeInstanceRepository();
    const compositions = new FakeCompositionRepository();
    const invalidStoredDefinition = invalidDefinition();
    const invalidStoredInstance = invalidInstance();
    const invalidStoredComposition = invalidComposition();
    definitions.definitions.set(String(invalidStoredDefinition.definitionId), invalidStoredDefinition);
    instances.instances.set(String(invalidStoredInstance.instanceId), invalidStoredInstance);
    compositions.compositions.set(String(invalidStoredComposition.compositionId), invalidStoredComposition);

    const definitionRead = await new ReadAssetDefinitionUseCase({ definitionRepository: definitions }).execute({ kind: "asset-definition", id: String(invalidStoredDefinition.definitionId) as AssetReference["id"] });
    const instanceRead = await new ReadAssetInstanceUseCase({ instanceRepository: instances }).execute({ kind: "asset-instance", id: String(invalidStoredInstance.instanceId) as AssetReference["id"] });
    const compositionRead = await new ReadAssetCompositionUseCase({ compositionRepository: compositions }).execute({ kind: "asset-composition", id: String(invalidStoredComposition.compositionId) as AssetReference["id"] });

    assert.equal(definitionRead.ok, true);
    assert.equal(instanceRead.ok, true);
    assert.equal(compositionRead.ok, true);
    assert.equal(definitionRead.validation, undefined);
    assert.equal(instanceRead.validation, undefined);
    assert.equal(compositionRead.validation, undefined);
    assert.equal((await new ListAssetDefinitionsUseCase({ definitionRepository: definitions }).execute()).definitions[0], invalidStoredDefinition);
    assert.equal((await new ListAssetInstancesUseCase({ instanceRepository: instances }).execute()).instances[0], invalidStoredInstance);
    assert.equal((await new ListAssetCompositionsUseCase({ compositionRepository: compositions }).execute()).compositions[0], invalidStoredComposition);
  });
});

describe("asset validation-only use cases and boundaries", () => {
  it("returns validation reports without saving", async () => {
    const definitions = new FakeDefinitionRepository();
    const instances = new FakeInstanceRepository();
    await definitions.saveDefinition(validDefinition());
    await instances.saveInstance(validInstance());
    assert.equal(new ValidateAssetDefinitionUseCase().execute(validDefinition()).status, "valid");
    assert.equal((await new ValidateAssetInstanceUseCase({ definitionRepository: definitions }).execute(validInstance())).status, "valid");
    assert.equal((await new ValidateAssetCompositionUseCase({ definitionRepository: definitions, instanceRepository: instances }).execute(validComposition())).status, "valid");
    assert.equal(definitions.saved.length, 1);
    assert.equal(instances.saved.length, 1);
  });
});
