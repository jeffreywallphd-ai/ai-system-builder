import type {ApplicationRequestContext} from "../../../../application/ports";
import {types} from "node:util";
import type {TrainingResultFileByteStoragePort} from "../../../../application/ports/model";
import type {OrganizationRequestContextProviderPort} from "../../../../application/ports/organization";
import {isOrganizationId} from "../../../../contracts/organization";
import {createContractError, readStrictPassiveRecord} from "../../../../contracts/shared";
import {createStoreArtifactFailureResult, createStoreArtifactSuccessResult} from "../../../../contracts/storage";
import {createWorkspaceId} from "../../../../contracts/workspace";
import {writeContainedFileStream, createContainedFileStreamLifetime, inspectContainedFileStreamLifetime,
  type ContainedFileStreamLifetime} from "../../../filesystem-security";
import {resolveOrganizationStorageKey} from "../organizationStorageScope";
import {verifiedPublicationStream} from "./verifiedPublicationStream";

function need(value: unknown): asserts value {
  if (value !== true) throw new Error("Private training publication is unavailable.");
}
function positive(value: unknown): value is number {return typeof value === "number" && Number.isSafeInteger(value) && value > 0;}

function captureOrganization(value: unknown) {
  need(!!value && typeof value === "object" && !types.isProxy(value));
  const organization = Object.getOwnPropertyDescriptor(value, "organizationId");
  const principal = Object.getOwnPropertyDescriptor(value, "principalId");
  need(!!organization && "value" in organization && isOrganizationId(organization.value) &&
    !!principal && "value" in principal && typeof principal.value === "string" && principal.value.length > 0);
  return {organizationId: organization.value, principalId: principal.value};
}

function captureStream(source: unknown): AsyncIterable<Uint8Array> {
  need(!!source && (typeof source === "object" || typeof source === "function") && !types.isProxy(source));
  let current = source;
  for (let depth = 0; current && depth < 8; depth++, current = Object.getPrototypeOf(current)) {
    need(!types.isProxy(current));
    const descriptor = Object.getOwnPropertyDescriptor(current, Symbol.asyncIterator);
    if (descriptor) {
      need("value" in descriptor && typeof descriptor.value === "function");
      const iterate = descriptor.value;
      return {[Symbol.asyncIterator]: () => Reflect.apply(iterate, source, [])};
    }
  }
  throw new Error("Private training publication is unavailable.");
}

/** Cooperative byte publication only. Mandatory bounds are not a measured or
 * exclusive reservation. No production producer/Root or metadata is configured.
 * The existing contained writer retains its existing temporary-file semantics. */
export function createFilesystemTrainingResultFileByteStorageAdapter(options: {
  readonly rootDirectory: string;
  readonly publicationId: string;
  readonly maximumFileBytes: number;
  readonly maximumTotalBytes: number;
  readonly maximumFiles: number;
  readonly organizationContextProvider?: OrganizationRequestContextProviderPort;
  readonly trackIoRetirement?: boolean;
}): TrainingResultFileByteStoragePort {
  const {rootDirectory, publicationId, maximumFileBytes, maximumTotalBytes, maximumFiles, organizationContextProvider, trackIoRetirement} = options;
  need(typeof rootDirectory === "string" && rootDirectory.length > 0 &&
    typeof publicationId === "string" && /^[a-f0-9]{32}$/.test(publicationId) &&
    positive(maximumFileBytes) && positive(maximumTotalBytes) && maximumFileBytes <= maximumTotalBytes &&
    positive(maximumFiles) && maximumFiles <= 256 && (trackIoRetirement === undefined || typeof trackIoRetirement === "boolean"));
  const getOrganization = organizationContextProvider?.getCurrentOrganizationContext.bind(organizationContextProvider);
  let phase: "open" | "checking" | "writing" | "unconfirmed" = "open";
  let scope: {workspaceId: string; organizationId: string | undefined} | undefined;
  let declaredPayloadBytes = 0, acknowledgedFileCount = 0;
  const attempted = new Set<number>();
  const lifetimes: ContainedFileStreamLifetime[] = [];
  let publicationFenced = false, retirementCaptured = false;
  let retirementScope: Readonly<ApplicationRequestContext> | undefined;
  const captureContext = (supplied: ApplicationRequestContext) => {
    need(!!supplied && !types.isProxy(supplied));
    const context = readStrictPassiveRecord(supplied, ["requestId", "correlationId", "organizationId", "principalId", "workspaceId"]);
    need(Object.values(context).every(value => value === undefined || typeof value === "string" && value.length > 0 && value.length <= 256));
    createWorkspaceId(context.workspaceId as string);
    need(context.organizationId === undefined || isOrganizationId(context.organizationId));
    return Object.freeze(context) as Readonly<ApplicationRequestContext>;
  };
  return {
    ...(trackIoRetirement === true ? {captureIoRetirement(input: {readonly publicationId: string}, supplied: ApplicationRequestContext) {
      need(!types.isProxy(input)); const request = readStrictPassiveRecord(input, ["publicationId"]);
      need(Object.keys(request).length === 1 && request.publicationId === publicationId &&
        !retirementCaptured && !publicationFenced && phase === "open" && attempted.size === 0);
      const captured = captureContext(supplied); retirementCaptured = true; retirementScope = captured;
      return Object.freeze({fencePublication() {publicationFenced = true;}, inspect() {
        const observations = lifetimes.map(owner => inspectContainedFileStreamLifetime(owner));
        const pendingOperations = observations.reduce((sum, row) => sum + row.pendingOperations, 0);
        const pending = phase === "checking" || phase === "writing" || observations.some(row => row.phase === "active");
        const unknown = observations.some(row => row.phase === "unconfirmed" || row.phase === "unused");
        return Object.freeze({schema: "training-result-file-io-retirement-v1" as const, publicationId,
          publicationFenced, phase: !publicationFenced ? "open" as const : pending ? "pending" as const : unknown ? "unconfirmed" as const : "closed" as const,
          fileCount: lifetimes.length, pendingOperations, publicationUnconfirmed: phase === "unconfirmed", declaredPayloadBytes});
      }});
    }} : {}),
    inspectPublication() {return {phase, attemptedFileCount: attempted.size, acknowledgedFileCount, declaredPayloadBytes};},
    async publishResultFile(input, supplied) {
      let context: ApplicationRequestContext = {}, checking = false, issued = false;
      try {
        // Inspect only data descriptors: a request accessor cannot run before
        // the original local admission is reserved.
        need(!types.isProxy(input));
        const request = readStrictPassiveRecord(input, ["fileIndex", "mediaType", "content", "expectedSizeBytes", "expectedSha256"]);
        const {fileIndex, mediaType, content, expectedSizeBytes, expectedSha256} = request;
        need(typeof fileIndex === "number" && Number.isSafeInteger(fileIndex) && fileIndex >= 0 && fileIndex < maximumFiles &&
          (mediaType === "application/json" || mediaType === "application/octet-stream") &&
          positive(expectedSizeBytes) && expectedSizeBytes <= maximumFileBytes &&
          typeof expectedSha256 === "string" && /^sha256:[a-f0-9]{64}$/.test(expectedSha256));
        need(!publicationFenced && phase === "open" && !attempted.has(fileIndex) && expectedSizeBytes <= maximumTotalBytes - declaredPayloadBytes);
        phase = "checking"; checking = true;
        const source = captureStream(content);
        context = trackIoRetirement === true ? captureContext(supplied) : {...supplied};
        need(!retirementScope || ["workspaceId", "organizationId", "principalId", "requestId", "correlationId"].every(key =>
          context[key as keyof ApplicationRequestContext] === retirementScope![key as keyof ApplicationRequestContext]));
        const workspaceId = createWorkspaceId(context.workspaceId!);
        // Freeze caller/provider scope and request scalars before any stream or
        // writer await. Later mutations cannot redirect this private copy.
        const organization = getOrganization ? captureOrganization(getOrganization()) : undefined;
        need(!publicationFenced); // A captured provider callback can request cleanup.
        need(context.organizationId === undefined || isOrganizationId(context.organizationId));
        need(!getOrganization || organization!.organizationId === context.organizationId);
        const organizationId = organization?.organizationId ?? context.organizationId;
        need(!scope || scope.workspaceId === workspaceId && scope.organizationId === organizationId);
        const key = `workspaces/${workspaceId}/artifacts/training-results/${publicationId}/${fileIndex}`;
        const scopedKey = resolveOrganizationStorageKey(key, organization ? {getCurrentOrganizationContext: () => organization} : undefined);
        const verified = verifiedPublicationStream({content: source,
          expectedSizeBytes, expectedSha256, maximumBytes: expectedSizeBytes}, maximumFileBytes);
        scope ??= {workspaceId, organizationId};
        attempted.add(fileIndex); declaredPayloadBytes += expectedSizeBytes;
        phase = "writing"; issued = true;
        const lifetime = trackIoRetirement === true ? createContainedFileStreamLifetime() : undefined;
        if (lifetime) lifetimes.push(lifetime); // Retain before the first writer await.
        const written = await writeContainedFileStream({rootDirectory, key: scopedKey, content: verified.content,
          maximumBytes: expectedSizeBytes, overwrite: false}, lifetime);
        const verifiedResult = verified.result();
        need(written.key === scopedKey && written.sizeBytes === verifiedResult.sizeBytes);
        const result = createStoreArtifactSuccessResult({key, mediaType, sizeBytes: verifiedResult.sizeBytes,
          checksum: {algorithm: "sha256", value: verifiedResult.digest.slice(7)}}, context);
        acknowledgedFileCount++; phase = "open";
        return result;
      } catch {
        // An accepted write may have published before its acknowledgement was
        // lost. Retain all declarations and fence the whole publication. Never
        // overwrite/adopt, repeat a copy or compensate a published target.
        if (issued) phase = "unconfirmed";
        else if (checking) phase = "open";
        return createStoreArtifactFailureResult(createContractError("unavailable",
          "Training result file storage could not be confirmed. The owning task must retain its data and reservation."), context);
      }
    },
  };
}
