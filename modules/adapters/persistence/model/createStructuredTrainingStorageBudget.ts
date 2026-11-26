import {createHash} from "node:crypto";
import {types} from "node:util";
import type {TrainingStorageBudgetPort, TrainingStorageBudgetRequest, TrainingStorageBudgetResult, TrainingStorageBudgetScope} from "../../../application/ports/model";
import {isOrganizationId} from "../../../contracts/organization";
import {isWorkspaceId} from "../../../contracts/workspace";
import {hasKnownPassiveCredential, readStrictPassiveRecord} from "../../../contracts/shared";
import type {StructuredDocumentStore} from "../shared";

const POOLS = "model/training/storage-budget/pools-v1";
const RESERVATIONS = "model/training/storage-budget/reservations-v1";
const roles = ["model", "inputs", "worker-output", "parent-output", "overhead"] as const;
const policyKeys = ["poolId", "profileFingerprint", "maximumBytes", "maximumOrganizationBytes", "maximumPrincipalBytes",
  "maximumReservations", "maximumOrganizationReservations", "maximumPrincipalReservations"] as const;
export interface StructuredTrainingStorageBudgetPolicy {
  readonly poolId: string;
  readonly profileFingerprint: string;
  readonly maximumBytes: number;
  readonly maximumOrganizationBytes: number;
  readonly maximumPrincipalBytes: number;
  readonly maximumReservations: number;
  readonly maximumOrganizationReservations: number;
  readonly maximumPrincipalReservations: number;
}
type Counter = {key: string; reservedBytes: number; reservationCount: number};
type OrganizationCounter = Counter & {principals: Counter[]};
type Pool = {schema: "training-storage-budget-pool-v1"; policyDigest: string;
  reservedBytes: number; reservationCount: number; organizations: OrganizationCounter[]};
const denied = {kind: "denied"} as const;
const unconfirmed = {kind: "unconfirmed"} as const;
const hash = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
function need(value: unknown): asserts value {if (value !== true) throw new Error("Training storage budget is unavailable.");}
function data(value: unknown, keys: readonly string[]) {
  need(!types.isProxy(value));
  const row = readStrictPassiveRecord(value, keys); need(Object.keys(row).length === keys.length); return row;
}
function integer(value: unknown, minimum = 1, maximum = Number.MAX_SAFE_INTEGER): number {
  need(typeof value === "number" && Number.isSafeInteger(value) && value >= minimum && value <= maximum); return value;
}
function digest(value: unknown): string {need(typeof value === "string" && /^sha256:[a-f0-9]{64}$/.test(value)); return value;}
function key(value: unknown): string {need(typeof value === "string" && /^[a-f0-9]{64}$/.test(value)); return value;}
function list(value: unknown, maximum: number): unknown[] {
  need(!types.isProxy(value) && Array.isArray(value) && Object.getPrototypeOf(value) === Array.prototype && value.length <= maximum);
  need(Reflect.ownKeys(value).length === value.length + 1);
  return Array.from({length: value.length}, (_, index) => {
    const entry = Object.getOwnPropertyDescriptor(value, String(index));
    need(!!entry && "value" in entry && entry.enumerable); return entry.value;
  });
}
function policy(raw: StructuredTrainingStorageBudgetPolicy) {
  const row = data(raw, policyKeys);
  need(typeof row.poolId === "string" && /^[a-z][a-z0-9.-]{0,119}$/.test(row.poolId) && !hasKnownPassiveCredential(row.poolId));
  const captured = {poolId: row.poolId, profileFingerprint: digest(row.profileFingerprint),
    maximumBytes: integer(row.maximumBytes), maximumOrganizationBytes: integer(row.maximumOrganizationBytes),
    maximumPrincipalBytes: integer(row.maximumPrincipalBytes), maximumReservations: integer(row.maximumReservations, 1, 1024),
    maximumOrganizationReservations: integer(row.maximumOrganizationReservations, 1, 1024),
    maximumPrincipalReservations: integer(row.maximumPrincipalReservations, 1, 1024)};
  need(captured.maximumPrincipalBytes <= captured.maximumOrganizationBytes && captured.maximumOrganizationBytes <= captured.maximumBytes
    && captured.maximumPrincipalReservations <= captured.maximumOrganizationReservations
    && captured.maximumOrganizationReservations <= captured.maximumReservations);
  return Object.freeze(captured);
}
function capture(raw: TrainingStorageBudgetRequest) {
  const value = data(raw, ["scope", "definitionDigest", "storageScopeDigest", "profileFingerprint", "limits", "maximumReservedBytes"]);
  const scope = data(value.scope, ["organizationId", "workspaceId", "principalId", "clientId", "hostIncarnationId", "requestId"]);
  need(isOrganizationId(scope.organizationId) && isWorkspaceId(scope.workspaceId));
  need(typeof scope.principalId === "string" && scope.principalId.length > 0 && scope.principalId.length <= 160
    && scope.principalId.trim() === scope.principalId && !/[\x00-\x1f\x7f]/.test(scope.principalId) && !hasKnownPassiveCredential(scope.principalId));
  for (const name of ["clientId", "hostIncarnationId", "requestId"])
    need(typeof scope[name] === "string" && /^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/.test(scope[name] as string));
  const rawLimits = data(value.limits, roles);
  const limits = Object.freeze(Object.fromEntries(roles.map(role => [role, integer(rawLimits[role])]))) as TrainingStorageBudgetRequest["limits"];
  const total = Object.values(limits).reduce((sum, amount) => sum + amount, 0);
  const maximumReservedBytes = integer(value.maximumReservedBytes);
  need(Number.isSafeInteger(total) && total <= maximumReservedBytes && limits["parent-output"] >= limits["worker-output"]);
  return Object.freeze({scope: Object.freeze(scope) as unknown as TrainingStorageBudgetScope, limits, maximumReservedBytes,
    definitionDigest: digest(value.definitionDigest), storageScopeDigest: digest(value.storageScopeDigest), profileFingerprint: digest(value.profileFingerprint)});
}
function readPool(raw: unknown, configured: ReturnType<typeof policy>, policyDigest: string): Pool {
  const value = data(raw, ["schema", "policyDigest", "reservedBytes", "reservationCount", "organizations"]);
  need(value.schema === "training-storage-budget-pool-v1" && value.policyDigest === policyDigest);
  const reservedBytes = integer(value.reservedBytes, 0, configured.maximumBytes);
  const reservationCount = integer(value.reservationCount, 0, configured.maximumReservations);
  let principalNodes = 0, summedBytes = 0, summedCount = 0;
  const organizations = list(value.organizations, reservationCount).map(rawOrganization => {
    const org = data(rawOrganization, ["key", "reservedBytes", "reservationCount", "principals"]);
    const count = integer(org.reservationCount, 1, configured.maximumOrganizationReservations);
    const bytes = integer(org.reservedBytes, 1, configured.maximumOrganizationBytes);
    const rows = list(org.principals, count); principalNodes += rows.length; need(principalNodes <= reservationCount);
    const principals = rows.map(rawPrincipal => {
      const principal = data(rawPrincipal, ["key", "reservedBytes", "reservationCount"]);
      return {key: key(principal.key), reservedBytes: integer(principal.reservedBytes, 1, configured.maximumPrincipalBytes),
        reservationCount: integer(principal.reservationCount, 1, configured.maximumPrincipalReservations)};
    });
    need(new Set(principals.map(row => row.key)).size === principals.length
      && principals.reduce((sum, row) => sum + row.reservedBytes, 0) === bytes
      && principals.reduce((sum, row) => sum + row.reservationCount, 0) === count);
    summedBytes += bytes; summedCount += count;
    need(Number.isSafeInteger(summedBytes) && summedBytes <= reservedBytes && summedCount <= reservationCount);
    return {key: key(org.key), reservedBytes: bytes, reservationCount: count, principals};
  });
  need(new Set(organizations.map(row => row.key)).size === organizations.length
    && summedBytes === reservedBytes && summedCount === reservationCount);
  return {schema: "training-storage-budget-pool-v1", policyDigest, reservedBytes, reservationCount, organizations};
}

/** No provisioning/release API: a missing pool cannot be initialized over old
 * physical content. Even a valid ledger is only configured-store accounting;
 * trusted host provenance/anti-rollback and actual Native custody remain separate. */
export function createStructuredTrainingStorageBudget(options: {
  readonly documents: StructuredDocumentStore;
  readonly policy: StructuredTrainingStorageBudgetPolicy;
  readonly authorize: (transaction: StructuredDocumentStore, scope: TrainingStorageBudgetScope) => Promise<boolean>;
}): TrainingStorageBudgetPort {
  const {documents, authorize} = options;
  need(documents.organizationId === undefined && typeof documents.runInOwnedTransaction === "function" && typeof authorize === "function");
  const configured = policy(options.policy), policyDigest = "sha256:" + hash(configured), poolKey = hash([configured.poolId]);
  const transact = documents.runInOwnedTransaction.bind(documents) as NonNullable<StructuredDocumentStore["runInOwnedTransaction"]>;
  return Object.freeze({async reserve(raw: TrainingStorageBudgetRequest,
    rawControl: Parameters<TrainingStorageBudgetPort["reserve"]>[1]): Promise<TrainingStorageBudgetResult> {
    let request: ReturnType<typeof capture>, current: () => boolean;
    try {
      request = capture(raw);
      const captured = data(rawControl, ["isCurrent"]), check = captured.isCurrent;
      need(typeof check === "function" && !types.isProxy(check));
      const unchanged = () => data(rawControl, ["isCurrent"]).isCurrent === check;
      current = () => {
        try {
          if (!unchanged()) return false;
          const result: unknown = Reflect.apply(check, rawControl, []);
          if (types.isPromise(result)) void Promise.prototype.then.call(result, undefined, () => {});
          return result === true && unchanged();
        } catch {return false;}
      };
      if (!current() || request.profileFingerprint !== configured.profileFingerprint) return denied;
    } catch {return denied;}
    const organizationKey = hash([request.scope.organizationId]), principalKey = hash([request.scope.organizationId, request.scope.principalId]);
    const reservationKey = hash([configured.poolId, request.scope.organizationId, request.scope.workspaceId,
      request.scope.principalId, request.scope.clientId, request.scope.hostIncarnationId, request.scope.requestId]);
    try {
      const result = await transact<TrainingStorageBudgetResult>(async transaction => {
        // Every retry starts with detached request and fresh local counter data.
        if (!current() || await authorize(transaction, request.scope) !== true || !current()) return denied;
        const scoped = transaction.forOrganization(request.scope.organizationId);
        if (await scoped.readDocument(RESERVATIONS, reservationKey)) return unconfirmed;
        if (!current()) return denied;
        const stored = await transaction.readDocument(POOLS, poolKey);
        if (!stored) return denied; // Never seed/reset a missing pool.
        const pool = readPool(stored.value, configured, policyDigest);
        integer(stored.revision);
        // Provisioning inserts revision one; only acknowledged reservations
        // advance this immutable-policy record. A counter-only reset is invalid.
        need(stored.revision === pool.reservationCount + 1);
        const organization = pool.organizations.find(row => row.key === organizationKey)
          ?? {key: organizationKey, reservedBytes: 0, reservationCount: 0, principals: []};
        const principal = organization.principals.find(row => row.key === principalKey)
          ?? {key: principalKey, reservedBytes: 0, reservationCount: 0};
        const amount = request.maximumReservedBytes;
        if (amount > configured.maximumBytes - pool.reservedBytes || amount > configured.maximumOrganizationBytes - organization.reservedBytes
          || amount > configured.maximumPrincipalBytes - principal.reservedBytes || pool.reservationCount >= configured.maximumReservations
          || organization.reservationCount >= configured.maximumOrganizationReservations || principal.reservationCount >= configured.maximumPrincipalReservations)
          return {kind: "capacity"};
        pool.reservedBytes += amount; pool.reservationCount++;
        organization.reservedBytes += amount; organization.reservationCount++;
        principal.reservedBytes += amount; principal.reservationCount++;
        if (!pool.organizations.includes(organization)) pool.organizations.push(organization);
        if (!organization.principals.includes(principal)) organization.principals.push(principal);
        if (!current()) return denied;
        await transaction.writeDocument(POOLS, poolKey, pool, {expectedRevision: stored.revision});
        await scoped.writeDocument(RESERVATIONS, reservationKey, {schema: "training-storage-budget-reservation-v1", policyDigest,
          fingerprint: "sha256:" + hash(request), definitionDigest: request.definitionDigest, storageScopeDigest: request.storageScopeDigest,
          profileFingerprint: request.profileFingerprint, limits: request.limits, maximumReservedBytes: amount}, {expectedRevision: 0});
        return {kind: "reserved"};
      }, () => {need(current());});
      return current() ? result : unconfirmed;
    } catch {return unconfirmed;}
  }});
}
