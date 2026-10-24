import { AsyncLocalStorage } from "node:async_hooks";
import type { OrganizationId } from "../../../contracts/organization";
import {
  StructuredDocumentConflictError,
  cloneStructuredJson,
  type StructuredDocument,
  type StructuredDocumentStore,
  type StructuredDocumentWriteOptions,
} from "./structured-document-store";

export function createInMemoryStructuredDocumentStore(
  now: () => string = () => new Date().toISOString(),
): StructuredDocumentStore {
  const state = new Map<string, StructuredDocument>();
  type Owner = { active: boolean };
  const context = new AsyncLocalStorage<Owner>();
  let queue: Promise<void> = Promise.resolve();
  const assertOwner = (owner?: Owner) => {
    if (owner) {
      if (!owner.active || context.getStore() !== owner) throw new Error("Structured transaction owner is not active in this context.");
    } else if (context.getStore()) throw new Error("Use the supplied transaction store for owned operations.");
  };
  const serialize = async <T>(work: (owner: Owner) => Promise<T>): Promise<T> => {
    assertOwner();
    const previous = queue;
    let release!: () => void;
    queue = new Promise<void>(done => { release = done; });
    await previous;
    const owner = {active: true};
    try { return await context.run(owner, () => work(owner)); }
    finally { owner.active = false; release(); }
  };
  const createStore = (
    target: Map<string, StructuredDocument>,
    owner?: Owner,
    organizationId?: OrganizationId,
  ): StructuredDocumentStore => ({
    organizationId,
    forOrganization(requestedOrganizationId) {
      assertOwner(owner);
      assertOrganizationScope(organizationId, requestedOrganizationId);
      return createStore(target, owner, requestedOrganizationId);
    },
    async readDocument<T>(namespace: string, key: string) {
      assertOwner(owner);
      if (!owner) return serialize(lease => createStore(target, lease, organizationId).readDocument<T>(namespace, key));
      const document = target.get(identity(organizationId, namespace, key));
      return document ? cloneDocument<T>(document) : undefined;
    },
    async listNamespaces() {
      assertOwner(owner);
      if (!owner) return serialize(lease => createStore(target, lease, organizationId).listNamespaces());
      return [...new Set(entriesForOrganization(target, organizationId).map(([, document]) => document.namespace))]
        .sort((left, right) => left.localeCompare(right));
    },
    async listDocuments<T>(namespace: string) {
      assertOwner(owner);
      if (!owner) return serialize(lease => createStore(target, lease, organizationId).listDocuments<T>(namespace));
      return entriesForOrganization(target, organizationId)
        .map(([, document]) => document)
        .filter(document => document.namespace === namespace)
        .sort((left, right) => left.key.localeCompare(right.key))
        .map(document => cloneDocument<T>(document));
    },
    async writeDocument<T>(namespace: string, key: string, value: T, options: StructuredDocumentWriteOptions = {}) {
      assertOwner(owner);
      // Capture caller-owned data before any queue wait.
      const payload = cloneStructuredJson(value);
      const admitted = {expectedRevision: options.expectedRevision, updatedAt: options.updatedAt ?? now()};
      if (!owner) return serialize(lease => createStore(target, lease, organizationId).writeDocument(namespace, key, payload, admitted));
      const mapKey = identity(organizationId, namespace, key);
      const current = target.get(mapKey);
      if (admitted.expectedRevision !== undefined &&
          (admitted.expectedRevision === 0 ? current !== undefined : current?.revision !== admitted.expectedRevision)) {
        throw new StructuredDocumentConflictError(namespace, key, admitted.expectedRevision);
      }
      const document: StructuredDocument<T> = {namespace, key, value: payload, revision: (current?.revision ?? 0) + 1, updatedAt: admitted.updatedAt};
      target.set(mapKey, document);
      return cloneDocument<T>(document);
    },
    async deleteDocument(namespace: string, key: string, expectedRevision?: number) {
      assertOwner(owner);
      if (!owner) return serialize(lease => createStore(target, lease, organizationId).deleteDocument(namespace, key, expectedRevision));
      const mapKey = identity(organizationId, namespace, key);
      const current = target.get(mapKey);
      if (expectedRevision !== undefined && current?.revision !== expectedRevision) throw new StructuredDocumentConflictError(namespace, key, expectedRevision);
      return target.delete(mapKey);
    },
    async runInTransaction<T>(work: (transaction: StructuredDocumentStore) => Promise<T>) {
      assertOwner(owner);
      if (owner) return work(this);
      return serialize(async lease => {
        const snapshot = new Map([...target.entries()].map(([key, value]) => [key, cloneDocument(value)]));
        const result = await work(createStore(snapshot, lease, organizationId));
        target.clear();
        for (const [key, value] of snapshot) target.set(key, value);
        return result;
      });
    },
  });
  return createStore(state);
}

function identity(organizationId: OrganizationId | undefined, namespace: string, key: string): string {
  return `${organizationPrefix(organizationId)}${namespace}\u0000${key}`;
}

function organizationPrefix(organizationId: OrganizationId | undefined): string {
  return `${organizationId ?? "\u0001platform"}\u0000`;
}

function entriesForOrganization(
  target: Map<string, StructuredDocument>,
  organizationId: OrganizationId | undefined,
): [string, StructuredDocument][] {
  const prefix = organizationPrefix(organizationId);
  return [...target.entries()].filter(([key]) => key.startsWith(prefix));
}

function assertOrganizationScope(
  currentOrganizationId: OrganizationId | undefined,
  requestedOrganizationId: OrganizationId,
): void {
  if (currentOrganizationId !== undefined && currentOrganizationId !== requestedOrganizationId) {
    throw new Error("An organization-scoped document store cannot change organization scope.");
  }
}

function cloneDocument<T>(document: StructuredDocument): StructuredDocument<T> {
  return {
    namespace: document.namespace,
    key: document.key,
    value: cloneStructuredJson(document.value) as T,
    revision: document.revision,
    updatedAt: document.updatedAt,
  };
}
