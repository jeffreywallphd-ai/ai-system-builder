import type {
  RuntimeInventoryRepositoryPort,
  RuntimeReadinessBindingRepositoryPort,
} from "../../../application/ports/runtime-readiness";
import { normalizeAssetCompositionPlanId } from "../../../contracts/asset-composition";
import {
  normalizeRuntimeBindingStatus,
  normalizeRuntimeCapabilityKind,
  normalizeRuntimeInventory,
  normalizeRuntimeInventorySourceId,
  normalizeRuntimeProviderAvailabilityStatus,
  normalizeRuntimeReadinessBinding,
  normalizeRuntimeReadinessBindingId,
  normalizeRuntimeReadinessStatus,
  type RuntimeInventory,
  type RuntimeReadinessBinding,
} from "../../../contracts/runtime-readiness";
import {
  pageRecords,
  textValuesMatch,
} from "../user-library/local-user-library-repository-helpers";
import {
  LocalRuntimeReadinessRecordStore,
  type LocalRuntimeReadinessRecordStoreOptions,
} from "./local-runtime-readiness-record-store";
const sortBinding = (a: RuntimeReadinessBinding, b: RuntimeReadinessBinding) =>
  b.updatedAt.localeCompare(a.updatedAt) ||
  a.readinessBindingId.localeCompare(b.readinessBindingId);
const sortInventory = (a: RuntimeInventory, b: RuntimeInventory) =>
  (b.checkedAt ?? "").localeCompare(a.checkedAt ?? "") ||
  a.inventorySourceId.localeCompare(b.inventorySourceId);
const iso = (v: string) =>
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(v.trim())
    ? v.trim()
    : undefined;

export function createLocalRuntimeReadinessBindingRepositoryAdapter(
  o: LocalRuntimeReadinessRecordStoreOptions,
): RuntimeReadinessBindingRepositoryPort {
  const store = new LocalRuntimeReadinessRecordStore(o);
  return {
    async saveRuntimeReadinessBindingRecord(record) {
      const n = normalizeRuntimeReadinessBinding(record);
      await store.mutateBindings<RuntimeReadinessBinding, void>((current) => ({
        records: [
          ...current
            .map(normalizeRuntimeReadinessBinding)
            .filter(
              (x) =>
                !(
                  x.targetWorkspaceId === n.targetWorkspaceId &&
                  x.readinessBindingId === n.readinessBindingId
                ),
            ),
          n,
        ].sort(sortBinding),
        result: undefined,
      }));
      return n;
    },
    async updateRuntimeReadinessBindingRecord(record) {
      return this.saveRuntimeReadinessBindingRecord(record);
    },
    async readRuntimeReadinessBindingRecord(
      targetWorkspaceId,
      readinessBindingId,
    ) {
      const safeId = normalizeRuntimeReadinessBindingId(readinessBindingId);
      if (!targetWorkspaceId) throw new Error("targetWorkspaceId is required.");
      return (await store.readBindings<RuntimeReadinessBinding>())
        .map(normalizeRuntimeReadinessBinding)
        .find(
          (x) =>
            x.targetWorkspaceId === targetWorkspaceId &&
            x.readinessBindingId === safeId,
        );
    },
    async listRuntimeReadinessBindingRecords(query) {
      if (!query.targetWorkspaceId)
        throw new Error("targetWorkspaceId is required.");
      const safeStatus = query.status
        ? normalizeRuntimeReadinessStatus(query.status)
        : undefined;
      const safePlan = query.compositionPlanId
        ? normalizeAssetCompositionPlanId(query.compositionPlanId)
        : undefined;
      const createdAfter = query.createdAfter
        ? iso(query.createdAfter)
        : undefined;
      const createdBefore = query.createdBefore
        ? iso(query.createdBefore)
        : undefined;
      const updatedAfter = query.updatedAfter
        ? iso(query.updatedAfter)
        : undefined;
      const updatedBefore = query.updatedBefore
        ? iso(query.updatedBefore)
        : undefined;
      const requiredCapabilityKind = query.requiredCapabilityKind
        ? normalizeRuntimeCapabilityKind(query.requiredCapabilityKind)
        : undefined;
      const providerAvailabilityStatus = query.providerAvailabilityStatus
        ? normalizeRuntimeProviderAvailabilityStatus(
            query.providerAvailabilityStatus,
          )
        : undefined;
      const bindingStatus = query.bindingStatus
        ? normalizeRuntimeBindingStatus(query.bindingStatus)
        : undefined;
      const text = query.text?.trim();
      const records = (await store.readBindings<RuntimeReadinessBinding>())
        .map(normalizeRuntimeReadinessBinding)
        .filter(
          (x) =>
            x.targetWorkspaceId === query.targetWorkspaceId &&
            (!safeStatus || x.status === safeStatus) &&
            (!safePlan || x.compositionPlanId === safePlan) &&
            (!requiredCapabilityKind ||
              x.requirements.some(
                (r) => r.capabilityKind === requiredCapabilityKind,
              )) &&
            (!providerAvailabilityStatus ||
              x.providerCandidates.some(
                (p) => p.availabilityStatus === providerAvailabilityStatus,
              )) &&
            (!bindingStatus ||
              x.bindings.some((b) => b.status === bindingStatus)) &&
            (!query.blockedOnly || x.blockers.length > 0) &&
            (!query.missingRequirementsOnly ||
              x.status === "missing-requirements") &&
            (!query.providerUnavailableOnly ||
              x.status === "provider-unavailable") &&
            (!query.configurationRequiredOnly ||
              x.status === "configuration-required") &&
            (!query.permissionRequiredOnly ||
              x.status === "permission-required") &&
            (!query.staleOnly || x.status === "stale") &&
            (query.archived === undefined ||
              (query.archived ? Boolean(x.archivedAt) : !x.archivedAt)) &&
            (!createdAfter || x.createdAt >= createdAfter) &&
            (!createdBefore || x.createdAt <= createdBefore) &&
            (!updatedAfter || x.updatedAt >= updatedAfter) &&
            (!updatedBefore || x.updatedAt <= updatedBefore) &&
            (!text ||
              textValuesMatch(
                [
                  x.readinessBindingId,
                  x.status,
                  x.compositionPlanId,
                  ...x.requirements.map((r) => r.label),
                  ...x.providerCandidates.map((p) => p.displayLabel),
                ],
                text,
              )),
        );
      const paged = pageRecords(
        records.sort(sortBinding),
        query.limit,
        query.cursor,
      );
      return { records: paged.records, nextCursor: paged.nextCursor };
    },
    async listRuntimeReadinessBindingRecordsByCompositionPlanId(
      targetWorkspaceId,
      compositionPlanId,
    ) {
      return (
        await this.listRuntimeReadinessBindingRecords({
          targetWorkspaceId,
          compositionPlanId,
        })
      ).records;
    },
    async listDraftCheckingBlockedStaleOrArchivedRuntimeReadinessBindingRecords(
      targetWorkspaceId,
    ) {
      return (
        await this.listRuntimeReadinessBindingRecords({ targetWorkspaceId })
      ).records.filter(
        (x) =>
          x.status === "draft" ||
          x.status === "checking" ||
          x.status === "blocked" ||
          x.status === "stale" ||
          Boolean(x.archivedAt),
      );
    },
    async archiveRuntimeReadinessBindingRecord(
      targetWorkspaceId,
      readinessBindingId,
      archivedAt,
    ) {
      const record = await this.readRuntimeReadinessBindingRecord(
        targetWorkspaceId,
        readinessBindingId,
      );
      if (!record) return undefined;
      return this.saveRuntimeReadinessBindingRecord({
        ...record,
        status: "archived",
        archivedAt,
        updatedAt: archivedAt,
      });
    },
  };
}

export function createLocalRuntimeInventoryRepositoryAdapter(
  o: LocalRuntimeReadinessRecordStoreOptions,
): RuntimeInventoryRepositoryPort {
  const store = new LocalRuntimeReadinessRecordStore(o);
  return {
    async saveRuntimeInventoryRecord(record) {
      const n = normalizeRuntimeInventory(record);
      await store.mutateInventory<RuntimeInventory, void>((current) => ({
        records: [
          ...current
            .map(normalizeRuntimeInventory)
            .filter(
              (x) =>
                !(
                  x.targetWorkspaceId === n.targetWorkspaceId &&
                  x.inventorySourceId === n.inventorySourceId
                ),
            ),
          n,
        ].sort(sortInventory),
        result: undefined,
      }));
      return n;
    },
    async updateRuntimeInventoryRecord(record) {
      return this.saveRuntimeInventoryRecord(record);
    },
    async readRuntimeInventoryRecord(targetWorkspaceId, inventorySourceId) {
      if (!targetWorkspaceId) throw new Error("targetWorkspaceId is required.");
      const sourceId = normalizeRuntimeInventorySourceId(inventorySourceId);
      return (await store.readInventory<RuntimeInventory>())
        .map(normalizeRuntimeInventory)
        .find(
          (x) =>
            x.targetWorkspaceId === targetWorkspaceId &&
            x.inventorySourceId === sourceId,
        );
    },
    async listRuntimeInventoryRecords(query) {
      if (!query.targetWorkspaceId)
        throw new Error("targetWorkspaceId is required.");
      const checkedAfter = query.checkedAfter
        ? iso(query.checkedAfter)
        : undefined;
      const checkedBefore = query.checkedBefore
        ? iso(query.checkedBefore)
        : undefined;
      const providerAvailabilityStatus = query.providerAvailabilityStatus
        ? normalizeRuntimeProviderAvailabilityStatus(
            query.providerAvailabilityStatus,
          )
        : undefined;
      const rows = (await store.readInventory<RuntimeInventory>())
        .map(normalizeRuntimeInventory)
        .filter(
          (x) =>
            x.targetWorkspaceId === query.targetWorkspaceId &&
            (!query.inventorySourceKind ||
              x.inventorySourceKind === query.inventorySourceKind) &&
            (!query.inventoryStatus ||
              x.inventoryStatus === query.inventoryStatus) &&
            (!providerAvailabilityStatus ||
              x.discoveredProviderCandidates.some(
                (p) => p.availabilityStatus === providerAvailabilityStatus,
              )) &&
            (!query.blockedOnly || x.blockers.length > 0) &&
            (!query.staleOnly || x.inventoryStatus === "stale") &&
            (!checkedAfter || (x.checkedAt ?? "") >= checkedAfter) &&
            (!checkedBefore || (x.checkedAt ?? "") <= checkedBefore),
        );
      const paged = pageRecords(
        rows.sort(sortInventory),
        query.limit,
        query.cursor,
      );
      return { records: paged.records, nextCursor: paged.nextCursor };
    },
    async readLatestRuntimeInventoryRecord(
      targetWorkspaceId,
      inventorySourceKind,
    ) {
      return (
        await this.listRuntimeInventoryRecords({
          targetWorkspaceId,
          inventorySourceKind,
          limit: 1,
        })
      ).records[0];
    },
  };
}
