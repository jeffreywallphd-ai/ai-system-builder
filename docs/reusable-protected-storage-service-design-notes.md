# Reusable Protected Storage Service: design and transfer notes

Planning only. The user selected the shared-interface topology on 2026-11-26. Roadmap approval remains ungranted. No implementation or installation is authorized.

## Proposed option

Use existing family-specific ports and established local/managed adapters. Add a separately installed least-privilege Windows custodian only when a declared protection profile needs it. Keep app authorization, domain metadata and retention separate from byte custody.

## Reuse and component choices

Reuse typed artifact-object/repository/stream, Context and Training ports, verified publication, organization scoping, root-owned SQLite/PostgreSQL transactions, the existing reserve-only training ledger, native/result/worker lifecycle components and existing host composition. Evaluate wrapping these components before adding code. SQLite records metadata; OS files hold large bytes. No universal arbitrary-path or command service is proposed.

A new successor ADR must choose and prove the exact custodian account/token/service SID/process/root/broker/binary/SCM boundary. Account, SID and pipe authentication are different controls. Initial installation and later privileged maintenance require separately authorized actions. No technical acceptance depends on human security judgment.

## Increment sequence

### 1. Use one storage layer through the existing app ports

Deliver reusable local storage with artifact upload and reviewed Context output as its first consumers. Preserve their different limits, publication rules and catalog ownership.

Dependencies: None

Stories:

- Reuse typed storage capabilities: Existing family-specific ports share bounded byte and lifecycle primitives without a universal storage API.
- Connect artifacts and Context: Two real domains use replaceable adapters under their existing application owners.
- Keep metadata and bytes consistent: Explicit acknowledgements, idempotency and retention connect byte effects to domain-owned metadata.

Acceptance:

- `typed-family-reuse` (local): Application consumers use existing family-specific ports. A capability matrix states object, repository, generated-file and read-lease semantics. Public contracts accept opaque scoped identities, never caller paths, commands, runtime handles or provider credentials.
- `first-domain-workflows` (local): Artifact upload and reviewed Context result save use the shared implementation through their own ports. Their present media/size bounds, metadata transactions, review controls, no-overwrite and unknown-effect behavior remain intact.
- `bounded-byte-lifecycle` (local): All reads and writes enforce exact size/hash, finite chunk/count/time/concurrency and cancellation bounds. Captured original operations remain owned through close. Stop, timeout or missing acknowledgements cannot grant retry, adoption, deletion or accounting credit.
- `metadata-commit-boundary` (local): Durable byte acknowledgement precedes domain metadata activation. Existing root-owned transactions commit each catalog/binding/receipt atomically. Byte and database effects are not claimed to be one atomic transaction. Exact lost-reply reconciliation cannot duplicate registration or recreate unknown bytes.
- `scope-and-error-isolation` (local): Current principal, organization and workspace authority reaches each layer. Cross-owner and missing scope deny before I/O. Public results and audit summaries omit content, secrets, paths, commands and native errors.
- `security-impact-reviewed` (local): Agent tests and independent technical review cover the storage authority delta, malformed requests, resource denial, adapter failure, migration and secure rollback. Document the ordinary profile's cooperative local limits and stronger-custody exclusions.

Provisional tasks:

- Reuse byte storage in artifact uploads: Record the architecture delta and implement reusable primitives with the actual artifact upload owner and its failure tests.
- Reuse byte storage in reviewed Context saves: Connect the actual Context byte port and save owner while preserving exact review, byte ACK and metadata activation semantics.
- Retain writes until their actual outcome is known: Implement and fault-test shared bounded operations, reader leases, cancellation fencing and uncertain-outcome retention in both first consumers.
- Recover exact local storage records: Add versioned metadata and exact lost-reply recovery with real SQLite transactions, no duplicate activation and secure rollback; update operations guidance.

Verification:

- Run existing storage-family invariants, object/stream, ingestion, Context publisher/save-owner, SQLite transaction and organization-isolation regressions with focused selectors.
- Add contract-substitution, stream-failure, late-close, conflict, uncertain-acknowledgement and wrong-owner tests at the owning seam.
- Run docs:check and architecture:check after the complete increment, and affected host build checks where composition changes; reserve aggregate suites until all roadmap increments are implemented.

Rollback: Select the prior ordinary adapter only for content written under that same ordinary profile. Retain acknowledged or uncertain bytes and metadata. Refuse to downgrade protected content or replay unknown effects.

Excluded:

- Windows service or privileged effects
- Strong hostile-peer custody or physical global quota claims
- New provider suppliers, remote synchronization or cloud object store
- Changes to domain approval, sharing or retention policy

### 2. Protect new storage under a separate Windows custodian

Deliver a separately provisioned least-privilege Windows storage profile that can preserve fresh exclusively owned bytes against unrelated nonprivileged peers through service and app restarts. Qualify it with synthetic storage operations before any model integration.

Dependencies: reusable-local-storage

Stories:

- Establish the custodian boundary: An accepted successor ADR and exact native/service policy bind account, token, process, binary, root and broker authority.
- Store and read protected bytes: Only original purpose-scoped operations can create, read, publish and retire fresh protected storage.
- Preserve physical capacity and crash state: One protected authoritative pool accounts for all producers and retains uncertain ownership and charges.

Acceptance:

- `security-custodian-identity` (local): The accepted ADR and executable policy tests prove the chosen service account, service SID, restricted token/privileges, own-process policy, process/thread/token/handle rights, root ACLs, broker authentication and permitted original clients together. Neither a service SID, PID, executable name, user token nor connected pipe alone grants application approval.
- `broker-exact-authority` (local): Each finite broker operation binds authoritative current app approval, original principal/tenant/workspace/purpose, manifest/digests, issuance and incarnation. Reject same-account spoofing, foreign clients, replay, changed policy, channel replacement and unknown outcomes before effects. No arbitrary file path, command, general impersonation or unrestricted handle duplication API exists.
- `native-custody-profile` (controlled-environment): On the declared Windows/filesystem profile, actual original create/read/write/publish/retire operations succeed and unrelated peer opens/control/write/rename/delete/substitute/link/stream operations fail as specified, including retained-handle and parent DELETE_CHILD attacks from before construction. Private creator or reader handles and process identity remain continuous. No pathname or final-DACL observation is substituted for capability provenance.
- `physical-shared-capacity` (controlled-environment): One configured protected pool includes every producer and all five training roles, byte copies, metadata, filesystem rounding, temporary bytes and overhead. Actual concurrent allocation and exhaustion measurements prove explicit bounds. Unknown retained usage consumes its ceiling. Missing or stale ledgers and rollback-ambiguous snapshots cannot mint capacity; exact original cleanup proof is required for credit.
- `crash-and-retention` (controlled-environment): Actual client, worker, custodian and host interruption/restart tests at each durable transition preserve protected bytes, exact ownership and charges. Lost create/write/commit/delete replies cannot authorize retries, adoption, byte disclosure or credit. Recovery inspects only service-created fresh synthetic fixtures with proven lineage; unknown or historical data stays untouched.
- `security-service-maintenance` (local): Build, binary/DLL/configuration/updater integrity and SCM create/config/start/stop/control rights are verified. Initial privileged installation and later privileged maintenance use separately authorized bounded operations. Ordinary use never silently elevates. Uninstalled, changed or unqualified hosts deny this protected capability.
- `custodian-runtime-bounds` (controlled-environment): Broker messages, handles, streams, requests, queue, memory, disk, time and process lifetimes are bounded and measured for the declared profile. Protocol cancellation and service drain retain original unsettled work; resource or audit failure is sanitized and fail closed.

Provisional tasks:

- Specify and prove the custodian policy: Obtain the exact successor ADR choice before service implementation, then encode account/token/process/root/channel and installer/SCM integrity policy with executable denial tests.
- Package the separately installed custodian: Build the minimal reviewed broker/storage binary, dependency closure and bounded install/maintenance plan. Refuse unapproved install or start; qualify package integrity only in an authorized fresh environment.
- Protect original storage operations: Integrate fresh protected namespace construction and exact streamed publication/read/retirement through typed adapters, with original capability and hostile-peer tests.
- Bind durable reservations to physical storage: Connect the established metadata engine to one protected pool and all its producers; measure peak physical allocation, concurrency, anti-rollback and cleanup-only credit.
- Qualify service interruption and restart: Execute actual lost-reply/crash/restart cases with retained bytes and accounting, bounded drain and safe rollback on fresh fixtures; record candidate-bound independent review.

Verification:

- Use an isolated approved Windows qualification environment and fresh synthetic roots only. Agent-driven tests produce exact binary/source/token/SCM/root/broker witnesses and nonprivileged hostile-peer denial results.
- Inject crashes and lost acknowledgements at every publication/accounting/retirement transition; compare protected objects and exact retained ledger state after restart.
- Measure concurrent physical allocation and exhaustion under fixed configured limits, with sparse/compressed/alternate-stream, metadata and copy effects either prevented or explicitly charged.
- Run focused native ABI/service/broker/ledger denial and lifecycle tests plus changed-source architecture/docs/dependency/build checks. A separately authorized install is a prerequisite, not a human acceptance test.

Rollback: Disable new protected admission and drain or retain original work and debits. Preserve protected bytes and compatible readers. Do not uninstall, weaken ACLs, reset ledgers, adopt historical data or switch protected content to ordinary adapters. Privileged repair/removal needs separate authority.

Excluded:

- Administrator/kernel compromise resistance
- Historical protected-tree recovery, adoption, ACL repair or deletion
- Unqualified non-Windows/filesystem profiles
- LocalSystem by default, remote broker, generic file/command service or automatic elevation
- A new database, cryptographic protocol or storage engine where existing qualified components fit

### 3. Use the storage layer across app domains

Connect datasets, RAG, models, checkpoints, generated output and optional offload through the same reusable seams. Complete the transferred stronger training storage integration under its own qualification without reopening Headless increment 7 or accepted model quality.

Dependencies: protected-windows-custodian

Stories:

- Connect domain-specific storage: Domain adapters select declared capabilities and preserve their own ownership, size, publication and retention rules.
- Complete stronger training storage: The original producer, receiver, worker and Job integrate protected sources/results, reservations and independent Save.
- Migrate only authorized owned data: Versioned references and explicit bounded migration preserve old data and support secure rollback.

Acceptance:

- `all-domain-capabilities` (local): Inventory every byte-storage consumer and assign an owning domain, family port, size class, mutability, publication/save gate, lifetime, retention/deletion authority and supported adapter. Exercise artifacts, dataset versions, RAG files, model weights, checkpoints, generated outputs and offload with representative bounded streams. Unknown capability combinations deny instead of silently downgrading.
- `domain-policy-preserved` (local): Dataset immutability/splits, RAG activation/query lineage, exact model revisions and reference-only shared/imported caches, generated result review, checkpoint retention and cached-generator offload leases remain with their existing owners. Deleting a record does not grant byte deletion; storage cannot broaden application permissions.
- `training-original-composition` (controlled-environment): Actual original controller purpose allocations, approved trusted configuration, protected model/input/SDK/reader/output capabilities and the existing worker pipeline bind to one producer. Complete receiver delivery, independent original worker exit and empty-Job retirement are required. Unknown startup, transfer or close retains original resources and both result copies; no duplicate attempt or Save follows.
- `training-retained-capacity` (controlled-environment): The measured shared protected pool reserves original model/input copies, worker results, parent results and overhead before admission. Cancellation, IO closure, worker/Job exit or readiness never release retained results or charges. Only the exact original cleanup owner and proven physical cleanup can grant capacity credit.
- `review-and-save-lineage` (local): The existing cached completion/progress readers review only the exact finalized candidate with base Model, Dataset, recipe, hardware, task and output lineage. Save still needs separate current authorization and an exact metadata transaction. Decline, withdrawal, substitution, unknown commit or lost replies cannot duplicate registration or adopt unknown bytes.
- `migration-without-adoption` (local): An explicit scoped versioned migration accepts only proven exclusively owned eligible content and preserves rollback records. Unsupported, shared, imported, historical failed or unknown content remains reference-only or inaccessible. Startup neither scans/adopts unknown trees nor moves or changes existing ACLs.
- `security-impact-reviewed` (local): Agent tests and separate technical review cover each domain adapter, cross-domain/tenant/workspace denial, malicious metadata, private-field redaction, retained resources, rollback and failure recovery. No accepted model accuracy or real output-quality scoring is rerun or claimed as service evidence.

Provisional tasks:

- Connect datasets and RAG storage: Use domain-owned immutable versions and reviewed Context activation over shared streams and explicit leases, with domain retention and cross-owner tests.
- Connect model, generated and offload storage: Preserve exact model revisions, generated-output review, shared-cache references and offload lease/capacity limits while selecting qualified adapters.
- Connect protected original training storage: Reuse existing purpose binder, reserve-only budget, native file bridge, receiver and original session; finish real source/input/results and SDK/worker/Job retirement composition under the new store.
- Review and save an exact protected candidate: Bind cached completion and finalized inventory to the existing separate review/Save transaction, with full lineage and unknown-result denial in both hosts.
- Migrate explicitly owned storage: Implement bounded versioned import and rollback for proven eligible synthetic content; deny automatic adoption, old failures, shared caches and unknown ownership.

Verification:

- Run focused actual domain adapters and application-owner regressions, including existing Dataset/Context/Model/Generated-output/Offload lifecycle tests and storage contract invariants.
- Run the actual installed supported original producer/controller/SDK/worker/Job storage journey using approved existing fixtures; verify IO, result copies, final delivery, exact exit and retained accounting, without real quality scoring.
- Exercise candidate review, separate Save, lost replies and substitution in both host compositions; a storage mock cannot qualify native or runtime evidence.
- Test explicit migration and rollback on synthetic known-owned data, plus historical/unknown/shared references that deny effects. Run affected docs/architecture/build/dependency gates only.

Rollback: Disable the new domain adapter profile and retain its exact protected objects, metadata, lineage and charges. Ordinary adapters may resume only for data already governed by their prior ordinary profile. Preserve migrated source/rollback records; do not recopy unknown results or downgrade stronger content.

Excluded:

- Headless increment 7 completion dependency or retroactive pass
- Real model quality/accuracy scoring or changed model acceptance policy
- New training engines/loaders, implicit offload or broader process cancellation
- Historical protected content access or automatic migration
- Domain sharing, licensing, retention or approval-policy changes

### 4. Qualify supported hosts and storage operations

Qualify real Desktop and Managed application composition, provisioning readiness, bounded maintenance, backup/recovery and storage resource limits. Publish support only for profiles with current evidence.

Dependencies: domain-storage-adoption

Stories:

- Compose Desktop and Managed storage: Hosts select approved adapters with exact current readiness and existing organization security.
- Operate and recover storage safely: Bounded diagnostics, maintenance, backup/restore and upgrades preserve ownership, accounting and protected data.
- Qualify declared support: Actual host, filesystem, resource, failure and restart evidence support truthful capabilities.

Acceptance:

- `host-selection-readiness` (local): Desktop and Managed hosts select concrete approved adapters at composition. Missing installation, changed binary/policy, unsupported filesystem, unqualified physical capacity or missing tenant authority deny the affected capability. Thin clients receive only opaque resources and safe readiness reasons; no root, credential or local path crosses the public boundary.
- `managed-tenant-storage` (controlled-environment): The existing Managed profile uses authoritative OIDC membership/current capabilities, PostgreSQL RLS and organization-derived byte containment. Actual two-tenant tests prove cross-owner denial, noisy-neighbor bounds and dedicated-placement refusal. Do not place SQLite WAL on a network share or invent desktop/server synchronization.
- `desktop-managed-journeys` (controlled-environment): Agent-run actual packaged Desktop and Managed browser/API/MCP journeys create, stream, review, separately save, read and retain/delete only exact authorized test resources. Test missing service, withdrawal, interrupted transfer, restart and cleanup with the selected profile. App approval/window consent remain independent. Real execution cannot be replaced by a mock or parsed reply.
- `operational-recovery-integrity` (controlled-environment): Authorized fresh-environment backup/restore, upgrade, failed maintenance and rollback tests preserve exact byte/metadata/ledger generations, owner isolation and retained charges. A valid older database/backup does not mint current ownership or capacity. Unknown or corrupt state stays inaccessible. Retention and deletion require the owning domain's exact policy and original proof.
- `resource-and-support-matrix` (controlled-environment): Actual profile measurements report stream throughput/latency, memory/handles, storage peak, queue/concurrency and cleanup/restart behavior against explicit predeclared acceptance bounds. Supported Windows/filesystem/host versions are named; unqualified platforms, managed-native protection or scale stay unavailable. Numeric declarations and sampled usage are not hard quota proof.
- `security-impact-reviewed` (local): All changed threat boundaries, installer/SCM and broker integrity, dependency provenance, tenant isolation, redaction, denial paths, secure rollback and residual risks receive current independent technical review. All transferred obligations have exact owner/evidence links. No historical component or Headless closure is promoted into a service pass.

Provisional tasks:

- Compose storage on Desktop and Managed hosts: Wire typed domain ports and protected readiness to the existing two hosts, preserving current authority and truthful unavailable states.
- Qualify real storage workflows on both hosts: Execute agent-driven app/API/MCP and browser journeys with original data/approval lineage, withdrawal, interrupted transfer and service-unavailable denial.
- Qualify storage maintenance and recovery: Run separately authorized fresh-environment install/upgrade/backup/restore/drain/crash tests; document secure maintenance and retained uncertainty without old-data effects.
- Publish qualified storage support: Reconcile transfers and the exact support matrix, run the once-at-completion aggregate and applicable gates, obtain current independent reviews and request final overall approval only after all technical qualification passes.

Verification:

- Use actual packaged Desktop and isolated Managed PostgreSQL/browser/API/MCP fixtures and installed supported Windows custodian, with separately authorized privileged prerequisites and fresh synthetic data.
- Execute failure, restore, upgrade, withdrawal, two-tenant, capacity, retained-result and drain/restart matrices; record exact source/binary/policy/environment identities and no real model quality scoring.
- After all implementation tasks in all increments are complete, run npm run test:all once plus applicable docs:check, architecture:check, agent-support:check, security:dependencies and host builds. The AI suite is included because this roadmap integrates Model/Context/offload storage; it supplies no new accuracy pass.
- Complete exact increment and overall Work receipts and separate-invocation reviews; pending controlled results prevent final roadmap closure and final approval.

Rollback: Withdraw only unqualified profiles and new admission. Keep original work, protected data, old compatible readers, metadata and accounting intact. Do not recover availability by disabling authorization, reverting ACLs, resetting pools or restoring stale generations as current authority.

Excluded:

- Production deployment or mutations without separate authority
- Automatic install, service start, privileged upgrade/repair/removal or new credentials
- Desktop/server synchronization, new remote broker, new cloud/object vendor or cross-organization sharing
- Administrator/kernel compromise guarantee, unqualified platforms/scale, retrospective old-data cleanup
- Manual user studies or human security sign-off as technical acceptance tests

## Transfer and qualification

The versioned [requirement mapping](../.implementation-roadmaps/reusable-protected-storage-service/transferred-headless-i7-requirements.json) names the original pending I7 tasks, destination criteria, retained I7 obligations and exact source hashes. It preserves the three retired definitions without copying closed quality checks. The transfer is pending work, never passing evidence. I7 closure and service closure remain independent.

## Recorded design direction and next step

The user approved shared interfaces with a protected service only where needed. This accepts the topology only. The full implementation roadmap is an unapproved proposal. The agent must obtain approval of that published roadmap before implementation.

## Open mechanism decisions before service implementation

The successor ADR must select and prove the account, restricted token, service SID, own-process and process-object policy, root/provisioning policy, authenticated broker approval channel, binary/update/SCM integrity and a protected durable-generation or anti-rollback authority. These are substantive decisions, not implied by choosing a service. Present options for any unresolved policy choice before its code. No mechanism is selected by a task title. Initial privileged installation and later privileged maintenance need separate bounded authority.

## Reuse inventory and source basis

Reuse ArtifactObjectStoragePort, ArtifactRepoStoragePort, ArtifactStreamStoragePort, ContextResultByteStoragePort, TrainingResultFileByteStoragePort and TrainingStorageBudgetPort. Reuse verifiedPublicationStream, scoped filesystem adapters, root-owned SQLite/PostgreSQL transactions, original task/IO/worker/Job ownership and current host composition. Native training result components are candidates for reuse after compatibility review; their earlier component evidence supplies no current service or parent pass.

Use the existing storage-family invariant tests and actual filesystem artifact/Context/training publisher, contained-stream-retirement, Model budget, original worker and host-composition tests. Add only checks needed for the new boundary.

- [Persistence and storage separation](../docs/adr/ADR-0004-persistence-and-storage-separation.md): Specialized families; structured records remain separate from bytes.
- [Current storage and accounting architecture](../docs/architecture/persistence-and-storage.md): Reuse existing streams, publication, organization scoping, root transactions and reserve-only Model budgets.
- [Owned effects and private identities](../docs/adr/ADR-0043-owned-resource-effects-and-private-identities.md): Native effects, exclusive provenance, aggregate admission and uncertain retention remain unqualified where not actually proved.
- [Headless source scope](../.implementation-roadmaps/headless-skills-ui-takeover/state.json): Preserve 66 completed task records; transfer only named stronger unfinished storage obligations.
- [Headless threat model](../docs/security/headless-system-builder-threat-model.md): Preserve original-task, exact approval, private streams, uncertain effects and separate Save.
- [Optional offload boundary](../docs/adr/ADR-0045-optional-bounded-model-offloading.md): Reuse 12 GiB profile and original lease semantics; accepted accuracy stays closed and historical slots stay untouched.
- [Tenancy authority](../docs/adr/ADR-0029-organization-tenancy-identity-and-authorization.md): Managed principal and organization authorization, RLS, tenant byte isolation, local zero-service baseline.
- [Service token SID](https://learn.microsoft.com/en-us/windows/win32/api/winsvc/ns-winsvc-service_sid_info): A service SID changes token SID lists; it is distinct from an account choice and is not complete isolation proof.
- [Service account](https://learn.microsoft.com/en-us/windows/win32/services/service-user-accounts): SCM creates the service process token in an account security context.
- [Service control permissions](https://learn.microsoft.com/en-us/windows/win32/services/service-security-and-access-rights): Installation, configuration, start and stop require distinct protected authority.
- [Named pipe permissions](https://learn.microsoft.com/en-us/windows/win32/ipc/named-pipe-security-and-access-rights): A pipe DACL authenticates access to the pipe, not current application approval; avoid accidental pipe-instance creation rights.
- [SQLite WAL](https://sqlite.org/wal.html): WAL readers and writer share one host; checkpoint and durability choices are explicit. It does not supply a hostile rollback fence.

## Increment cohesion

- Increment 1 is independently useful ordinary byte-storage reuse with two actual consumers. Increment 2 crosses a new OS identity, privilege, packaging and physical crash-qualification boundary and must have independent secure withdrawal.
- Increment 2 offers a qualified protected store through synthetic storage operations. Increment 3 changes multiple domains and model/offload lifecycle and migrates owned references, with separate domain rollback and worker/Job qualification.
- Increment 3 proves domain adapters and stronger original training storage. Increment 4 crosses actual packaged Desktop/Managed, two-tenant, provisioning, maintenance and deployment qualification boundaries. Local component passes cannot replace those reports.

## Transfer source and preserved evidence

The versioned [requirement mapping](../.implementation-roadmaps/reusable-protected-storage-service/transferred-headless-i7-requirements.json) preserves the exact three retired pending task definitions, hashes and pending criterion owners. The original sixty-six completed task definitions and evidence remain in Headless history. Source approval, plan and increment digests identify the inspected boundary; they do not qualify new storage. All stronger physical capacity, protected accounting, anti-rollback, hostile-peer custody and protected crash/restart work remains pending here. The separately selected ordinary local Headless profile cannot satisfy an exclusive-custody request by fallback.

No real model quality or accuracy scoring is part of this roadmap. Existing accepted accuracy evidence remains closed. Evaluation software may use deterministic controlled metrics; actual storage, process, Job, resource, native and host checks still need genuine execution.

## Security impact and residual risk

The proposed storage design changes custody, OS identity, broker authority, durable accounting, crash recovery, migration and public failure boundaries. This draft grants no physical or privileged effect.

assets:

- Owned artifact, dataset, RAG, model, checkpoint, generated and offload bytes
- Private metadata, exact application approvals, retention and accounting integrity
- Custodian executable, configuration, process token and protected namespace

trustBoundaries:

- Untrusted UI/API/IPC requests to domain authorization and typed storage ports
- Application-approved operation to independently authenticated local custodian
- Original producer and reader capabilities to protected files and durable ledger
- Managed tenant context to PostgreSQL metadata and organization-isolated bytes
- Separately authorized installer or maintainer to SCM, binaries, tokens and roots

abuseCases:

- Same-account client impersonates the app or replays a stale approved request
- Another process retains WRITE_DAC, duplicate handles, parent DELETE_CHILD or path substitution authority
- Service binary, DLL, configuration, broker or SCM settings are replaced
- Crash, missing ledger or restored valid snapshot grants duplicate effects or capacity credit
- Concurrent producers exhaust disk through uncharged metadata, copies, temporary files, hardlinks, streams or sparse allocation
- Cross-domain, organization or workspace identifiers read or delete foreign bytes
- Migration or rollback adopts unknown historical data or downgrades protected content

controls:

- Family-specific ports and purpose-scoped opaque capabilities; no arbitrary path, shell, generic command or client-supplied authorization API
- Existing application authorization and separate review/Save remain authoritative; broker requests bind exact operation, actor, tenant, workspace, purpose, digest, incarnation and one-use issuance
- ADR selects and proves account, service SID, restricted token, own-process policy, process-object rights, root ACLs and authenticated channel together
- Protected binary/dependency/configuration/update chain and explicit SCM permissions; separately approved initial installation and privileged maintenance
- Reserve full physical peak across one authoritative all-producer pool, protect ledger provenance, retain uncertainty, release only after original cleanup proof
- Fail closed on missing, stale, unavailable, rollback-ambiguous or unsupported authority; keep stronger content inaccessible on rollback
- Bounded streams and concurrency, sanitized audit and failures, current policy at effect boundaries

verification:

- Agent-run contract, domain isolation, malformed and resource-bound tests
- Actual Windows original-access and hostile peer/retained-handle denial matrix on fresh synthetic roots
- Actual process, service and host crash/restart fault injection with bytes and ledger retained
- Exact installed binary/token/SCM/root/channel witness and source-bound independent review
- Desktop and Managed application journeys with exact receipts and no real model quality scoring

residualRisks:

- Administrator/kernel compromise is outside the nonprivileged local peer boundary; document this explicitly in the accepted ADR
- A distinct service SID or SQLite transaction alone proves neither original-only broker authority nor anti-rollback
- Initial installation and later privileged maintenance require separately authorized host actions; no install or service start is authorized by roadmap publication
- Untested platforms, filesystems, hosts, native profiles and physical capacity remain unavailable, never simulated passes
- Historical protected data, failed trees, ACLs and unknown ownership are excluded from all discovery and automated recovery

