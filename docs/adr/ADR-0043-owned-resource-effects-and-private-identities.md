# ADR-0043: Owned Resource Effects and Private Identities

- Status: accepted
- Date: 2026-10-21
- Deciders: ai-system-builder maintainers
- Related: ADR-0015, ADR-0017, ADR-0029, ADR-0031, ADR-0042

## Context

The security successor and functionality optimization roadmaps retain native,
ownership, identity and controlled-qualification gaps. The user approved the
recommended resolutions below. Approval establishes design authority, not
implementation evidence or permission to weaken a failed qualification gate.

## Decision

1. Physical model effects use a narrow host-owned native adapter that preserves
   filesystem identity throughout each operation. Qualify Windows first; other
   supported platforms remain pending and unavailable until qualified. Reveal is
   qualified separately from deletion because file-manager APIs accept paths.
   Lexical containment, a prior realpath check or a marker file alone never grants
   deletion authority.
2. Only exclusively application-owned model content is eligible for deletion.
   Shared provider caches and imported external locations are reference-only;
   removing a registry record must not delete their bytes. Protected ownership
   provenance and crash-consistent publication/recovery bind exact content,
   organization/workspace identity and model identity. Existing paths never
   silently acquire ownership. Ambiguous or incomplete recovery denies effects.
3. Model-download admission reserves capacity per authenticated principal and
   organization. Aggregate storage and concurrency budgets complement individual
   request limits. Streaming enforces reserved bytes; cancellation, failure and
   restart reconcile reservations without permitting oversubscription. Limits
   are explicit host configuration tied to measured deployment capacity; missing
   authority or unusable configuration fails closed.
4. Dependency setup diagnostics are session-only by default. Explicit persistence
   requires private host-owned storage, bounded bytes and retention, qualified
   permissions and publication, and content-minimized outcome records. A raw
   output pathname is not a qualified persistence capability. Diagnostic sink
   failure cannot replace the underlying setup result. Security audit retention
   and append-only integrity remain governed separately.
5. Public image/generated-output view identities use persisted random opaque
   identifiers and indexed owner-scoped lookup. Source identifiers are not
   encoded or hashed into public identities. Reads reauthorize their source.
   Existing references require explicit migration; lookup must not scan an
   unbounded collection or create a cross-owner mapping.
6. Semantic asset-pack fingerprints use a versioned canonical representation of
   validated semantic input. Display sanitization cannot discard distinctions
   before hashing. Packaging timestamps, self-referential checksum/fingerprint
   fields and explicitly nonsemantic ordering remain separate. Immutable package
   byte digests retain their existing meaning. Ambiguous legacy identities require
   revalidation; no approval, trust record or binding is silently rewritten.
7. Personal User Libraries belong to the authenticated principal within the
   organization boundary. Organization partitioning alone does not establish
   personal ownership. Legacy unassigned records remain inaccessible until an
   explicit separately scoped assignment/import; no startup auto-migration.
   Organization-shared libraries and broader collaboration remain out of scope.

The retained original dependency supplier and zero-advisory policy are unchanged.
Route admission still requires exact supported operations, owning application
authorization and negative evidence; this decision grants no blanket admission.

## Verification and Consequences

The user-approved2026-11-26 training-result replacement uses one private protected
container in the existing Node parent, as specified in
[Private Training Result Container](../architecture/training-result-container.md).
Original capabilities, owner/control restrictions and explicit data/metadata
limits stay. Fresh private result files additionally deny FILE_READ_DATA to
enforce the approved original-reader boundary. The least-right read probe must
deny before metadata, and actual original-reader compatibility must qualify.
This replaces only fresh result-directory construction, which real Windows tests
refused before payload. It does not authorize historical-data access, parent ACL
changes, new privileges/identities, recovery, quota credit or default activation.
Actual parent/crash/global-reservation and host evidence remains mandatory; a
live component pass is not a weaker supported mode.

The user's later approval on2026-11-26 extends that direction to protection and
qualification of newly created, exclusively app-owned result folders. This
supersedes only the preceding exclusion of parent provisioning/ACL changes for
those fresh folders. The custodian uses the same existing app process and account,
with no administrator privileges, new service, additional process or identity.
Existing folders, failed data and their permissions remain outside this authority.
Creation, original file access, denied foreign control/write/rename/deletion,
bounded disk accounting and crash/retention behavior require actual qualification
before activation. Unknown prior writers or retained control handles cannot be
assumed absent; a path check or read-only ACL is not a stable protection fence.
No physical mechanism, weaker live-only mode, historical recovery, quota credit or
default host activation is inferred from this approval or a source test pass.

The historical small Windows file-component run
`8c3de43d01e54b0f854593a32c4611c9` passed its eight declared file checks at its
recorded source, including original reads and cleanup. Its completed measurement
Work is `headless-native-training-result-container-file-qualification-r4`.
This component evidence does not qualify the new parent design, current full
candidate, shared physical capacity, producer, crash/retirement or either host.

Resumable local-file publication implements this boundary through private
task/file-scoped intents, pre-reservation bounded content verification, a single
acknowledged exclusive writing transition, durable byte acknowledgement and one
acknowledged origin-issued transition before conditional origin effects. Only
that acknowledged invocation may attempt metadata creation. Retries verify exact
complete existing origin; missing/partial/deleted origin stays pending without
recreation, and lost issuance acknowledgements grant no effect authority. The
structured task/snapshot transaction also commits
the private publication receipt. Uncertain writing cannot be adopted, retried or
deleted; no legacy receipt is inferred. This publication component preserves host
byte mapping but does not itself admit a route or establish native protection or
filesystem/metadata atomicity. The separately tested exact POST ingestion-task
endpoint uses existing `artifact:write` coarse scope, including read/list actions,
and repeats owning application organization/workspace/task/file authorization.
Unknown paths/methods and unsupported families remain denied; there is no blanket
task admission or read-only task API. Real HTTP denial/positive tests and real
host import journeys are separate from native, provider and scale qualification.

Implement through existing contracts, application ports, adapters and host wiring.
Use bounded source-writing claims and actual separate-invocation review. Test
substitution, links/reparse points, races, partial publication/restart, owner
isolation, malformed records, resource exhaustion and public non-disclosure at
the layers that own each boundary. Migration and rollback retain stronger denials.

Native filesystem/process evidence, named reference environments, installed-model
hardware/quality measurements and private-provider/scale qualification require
actual reports for their declared technical profiles. Local component tests do
not supply those results. User-directed participant/manual acceptance is handled
offline and is not an agent roadmap closure gate; automated UI, keyboard and
accessibility qualification remains required by the technical roadmaps.

The original-supplier and zero-advisory policy is unchanged. Read actual executed
dependency receipts for the recorded candidate rather than treating a historical
failed audit as permanent: the completed runtime repair successor and
tooling reconciliation retain their scoped evidence and all earlier failures.
Roadmap completion and main promotion follow current governed JSON state, exact
candidate-bound checks and independent review. Component completion never
silently supplies native, model, parent or scanner closure.
