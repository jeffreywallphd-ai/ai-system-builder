import type {ApplicationRequestContext} from "../../../../application/ports";
import {types} from "node:util";
import type {TrainingResultFileByteStoragePort} from "../../../../application/ports/model";
import type {OrganizationRequestContextProviderPort} from "../../../../application/ports/organization";
import {isOrganizationId} from "../../../../contracts/organization";
import {createContractError, readStrictPassiveRecord} from "../../../../contracts/shared";
import {createStoreArtifactFailureResult, createStoreArtifactSuccessResult} from "../../../../contracts/storage";
import {createWorkspaceId} from "../../../../contracts/workspace";
import {writeContainedFileStream} from "../../../filesystem-security";
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
}): TrainingResultFileByteStoragePort {
  const {rootDirectory, publicationId, maximumFileBytes, maximumTotalBytes, maximumFiles, organizationContextProvider} = options;
  need(typeof rootDirectory === "string" && rootDirectory.length > 0 &&
    typeof publicationId === "string" && /^[a-f0-9]{32}$/.test(publicationId) &&
    positive(maximumFileBytes) && positive(maximumTotalBytes) && maximumFileBytes <= maximumTotalBytes &&
    positive(maximumFiles) && maximumFiles <= 256);
  const getOrganization = organizationContextProvider?.getCurrentOrganizationContext.bind(organizationContextProvider);
  let phase: "open" | "checking" | "writing" | "unconfirmed" = "open";
  let scope: {workspaceId: string; organizationId: string | undefined} | undefined;
  let declaredPayloadBytes = 0, acknowledgedFileCount = 0;
  const attempted = new Set<number>();
  return {
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
        need(phase === "open" && !attempted.has(fileIndex) && expectedSizeBytes <= maximumTotalBytes - declaredPayloadBytes);
        phase = "checking"; checking = true;
        const source = captureStream(content);
        context = {...supplied};
        const workspaceId = createWorkspaceId(context.workspaceId!);
        // Freeze caller/provider scope and request scalars before any stream or
        // writer await. Later mutations cannot redirect this private copy.
        const organization = getOrganization ? captureOrganization(getOrganization()) : undefined;
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
        const written = await writeContainedFileStream({rootDirectory, key: scopedKey, content: verified.content,
          maximumBytes: expectedSizeBytes, overwrite: false});
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
