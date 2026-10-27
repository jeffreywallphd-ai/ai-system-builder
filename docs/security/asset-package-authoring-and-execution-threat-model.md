# Asset Package, Authoring, Build, and Execution Threat Model

- Status: current
- Scope: executable asset packages, Asset Studio, coding models, system builds, previews, capability brokerage, and system-release execution
- Related: ADR-0015, ADR-0029, ADR-0030 through ADR-0035
- Verification: automated negative tests plus Increment 11 manual security review

## Assets to protect

- user and organization data, artifacts, prompts, models, secrets, and identities;
- host filesystem, process, network, credential, and Electron privileges;
- tenant/workspace isolation and authorization policy;
- package, build, release, provenance, and audit integrity;
- source workspaces and the AI System Builder product repository;
- availability of desktop, server, builders, runners, and storage.

## Trust boundaries

Untrusted inputs cross boundaries at package receipt, archive parsing, manifest normalization, dependency resolution, source editing, coding-model context/output, build execution, preview rendering, capability messages, data/model calls, release activation, and cross-workspace/organization reads.

## Threats and required controls

| Threat                               | Example                                                         | Required prevention/detection                                                                                                                                                 |
| ------------------------------------ | --------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Package parser abuse                 | traversal, device path, symlink, duplicate path, zip bomb       | streaming bounded parser; canonical relative paths; link/device rejection; entry/size/ratio/time limits; quarantine; fuzz/negative tests                                      |
| Identity/integrity substitution      | same version with different bytes, digest confusion, downgrade  | digest-before-use; algorithm allowlist; immutable identity; exact locks; downgrade policy; transparency/signature evidence                                                    |
| Malicious or vulnerable dependencies | lifecycle script, typosquat, compromised transitive package     | no install during inspect; lockfile; registry/source allowlist; script denial by default; SBOM and audit; sandboxed build; review                                             |
| Forged trust/provenance              | metadata says system-trusted                                    | trust derived from configured authority and verified digest/signature; provenance linked by digest; admission decision audit                                                  |
| Coding-agent prompt injection        | repository file asks for secrets or publication                 | instruction hierarchy outside workspace content; minimal context; tool allowlist; no secrets; no publish/deploy authority; full diff review                                   |
| Conversational prompt injection      | user/context text asks the model to bypass policy or exfiltrate | treat messages/context as untrusted data; host-owned authorization and capability checks; protected context construction; no credentials in instructions; bounded safe output |
| Protected instruction disclosure     | UI, diagnostics, audit, or provider error reveals instructions  | protected configuration references; transcript-only visible content boundary; redacted operational records; no raw provider payloads; non-disclosure tests                    |
| Scope escape                         | agent edits product repo or sibling workspace                   | separate source root; canonical containment on every file operation; no product-repo mount; out-of-scope diff gate                                                            |
| Credential theft                     | environment/token read or broker abuse                          | no ambient secrets; opaque secret references; capability authorization; redaction; no host environment passthrough                                                            |
| Sandbox escape                       | native exploit, host socket, privileged child                   | patched runtime; non-root ephemeral isolation; no host/container socket; read-only base; minimal mounts; seccomp/platform policy where available; kill/cleanup                |
| Egress/exfiltration                  | arbitrary HTTP/DNS                                              | default-deny network; destination/method/size policy; proxy/broker; audit; no raw secret access                                                                               |
| Resource exhaustion                  | fork bomb, infinite loop, huge logs/output                      | CPU/memory/process/time/storage/output quotas; cancellation; admission concurrency; bounded persisted logs                                                                    |
| UI privilege escalation              | Node/Electron access, navigation, popup, XSS                    | separate origin/frame; no Node/preload; context isolation; Chromium sandbox; CSP; navigation/window/permission denial; schema-valid messages                                  |
| Message confusion                    | spoofed origin/run/capability, oversized payload                | origin/source/channel binding; nonce/correlation; schema/version/size validation; replay controls; deny unknown fields/capabilities                                           |
| Capability escalation                | asset requests undeclared data/network/model access             | declaration plus admission plus runtime authorization; least privilege; platform denial wins; audit                                                                           |
| Tenant/workspace escape              | guessed IDs or package activation leakage                       | explicit organization/workspace context at contracts, repositories, storage, broker, and audit; RLS/containment; negative tests                                               |
| Policy weakening                     | security asset grants admin or suppresses audit                 | platform-owned compiler; policies may only narrow; mandatory isolation/audit gates; build rejection                                                                           |
| Unsafe migrations                    | destructive cross-tenant schema/data change                     | analyzed migration plan; organization scope; compatibility/rollback checks; approval; host-owned migration runner                                                             |
| Build/release tampering              | swap artifact after tests                                       | content-addressed artifacts; test/evidence digests; immutable release; verify before activation/run; revoke on mismatch                                                       |
| Stale approval                       | code/capability/dependency changed after review                 | approvals bind exact source, lock, capability, and evidence digests; change invalidates approval                                                                              |
| Layer/base substitution              | overlay is applied to a newer release or different snapshot     | exact definition-version, release, source-snapshot, and artifact-digest pins; optimistic revision; verify-before-materialize; no floating rebase                              |
| Overlay metadata leakage             | source paths/text copied into list DTOs, logs, or diagnostics   | raw overlay files only in authorized proposal/artifact boundaries; structured records retain counts/descriptors; bounded sanitized diagnostics                                |
| Audit evasion/privacy leak           | secrets in logs or missing denial events                        | separate append-only security audit; required events; structured redaction; bounded diagnostics; access/retention policy                                                      |

## Abuse cases that must fail closed

1. Browse or inspect a package containing install/build scripts without executing any script.
2. Import an archive with traversal, alternate separators, links, duplicate normalized names, or excessive expansion.
3. Resolve a revoked implementation or signer, an unsigned package under signed-only policy, or two equal eligible candidates.
4. Ask a coding model to read outside its assigned root, access credentials, use an unapproved tool/network origin, or publish its patch.
5. Render imported UI that requests Node, preload, popup, navigation, download, clipboard, camera, or arbitrary network access.
6. Execute logic that requests an undeclared capability, changes organization/workspace context, exceeds quota, or sends malformed broker messages.
7. Build a system with missing authorization/audit, incompatible ports, cycles, unsafe migration, unresolved implementation, or mutable dependency.
8. Activate or execute a release whose artifact digest, evidence, approval, compatibility, or revocation status no longer validates.
9. Submit conversational text that requests protected instructions, provider
   payloads, credentials, tools, retrieval, memory, or authority not granted by
   the execution plan and host policy.
10. Materialize a layered customization after its base release, source snapshot,
    source digest, semantic patch, source overlay, dependency consent, capability
    consent, or optimistic revision no longer matches the reviewed values.

## Residual risk and release gates

Sandboxing reduces but does not eliminate runtime vulnerabilities. Signed packages can be malicious. Provenance can identify a producer without proving correctness. Therefore imported/authored execution stays unavailable until automated escape/egress/quota/credential/tenant tests pass for the selected adapter and a manual security review records residual risks.

Security incidents can revoke package, implementation, signer, or system-release digests without rewriting history. Implementation revocation now propagates to resolution plus deployment install, activation, health, rollback selection, and new execution; a newly revoked active deployment is best-effort deactivated and persisted as revoked. Unavailable revocation truth denies the operation. Preview and already-running imported-task termination remain profile-specific controls and must not be claimed without controlled evidence.

Readiness and composition diagnostic/blocker boundaries admit only their declared
plain-record fields and reconstruct the public shape. Unknown fields and
accessors deny without evaluation. Metadata uses a pure shared contracts helper:
at most8 nesting levels,1024 visited values,64 keys per object,2048 characters
per string,80 characters per key and64KiB aggregate encoded key/string bytes.
Composition permits nested arrays of at most128 items; readiness retains its
no-array metadata schema. Cycles, sparse arrays, nonJSON/prototype objects,
non-finite numbers, dangerous structural keys and compound credential/raw-data
keys deny. Safe false/zero/null and nested summaries retain their meanings.
Actual filesystem/URL/credential/payload representations cannot enter these
passive diagnostic details. Composition keeps generic outward redaction for
unsafe message strings; readiness rejects them. Errors do not echo rejected
content. Existing family restrictions remain in force. These metadata controls
are not applied indiscriminately to typed DTO identities or declared graph
summary fields, and do not establish native/runtime/release qualification.

Diagnostic code, severity and identity inputs must be primitive strings before
any schema string method runs; nested trim/toString getters cannot execute.
Windows root-relative and drive-relative forms are rejected in metadata and
redacted from composition messages alongside Unix, UNC and drive-absolute paths.

Semantic Asset Pack explanatory fields retain non-goal prose such as descriptions
of resource bytes, prompt text or runtime execution. This allowance never admits
actual private-key blocks or established credential-prefix representations.
Validation and JSON parse checks reject those strings with static diagnostics;
serialization/normalization rejects before returning a document containing them.
The shared content predicate is pure admission logic, separate from lossy display
sanitization. This is syntax hardening, not proof that arbitrary prose contains
no sensitive data. Existing schema, trust and metadata controls still apply.
Semantic fingerprint utilities capture complete passive input before existing
manifest/entry validation and domain-separated `sha256:semantic-v2` hashing.
Display projection cannot remove distinctions before hashing. Proxy/accessor/
toJSON objects, cycles, nonJSON values, malformed arrays and structural prototype
keys deny without evaluation. Capture bounds are32levels,250000values,8192items
per container and16MiB aggregate encoded key/string bytes. Original property order
is preserved for existing schema validation; hash keys sort by code unit afterward.
Only declared packaging/self-reference exclusions and set-like collection ordering
are normalized. Valid authorship and explanatory text remain integrity inputs.
Static errors expose no rejected values. Immutable shipped identities and package
byte digests are unchanged. Legacy hash verification requires explicit revalidation
and cannot rewrite trust, approval or bindings. This pure utility does not qualify
installer trust shortcuts, native file effects, or actual release authorization.

Actual credential checks apply to property names as well as string values.
Credential-bearing names are denied before descent/copy and never become public
diagnostic paths; issues refer to the safe parent. Direct serialization also
rejects those names before creating a document.

Resource-backed model read views do not publish internal run correlation or
arbitrary nested inventory metadata. Explicit summary projection prevents
metadata substitution of public workspace/model identities, and omitted
metadata is not traversed for diagnostic classification. Read authority still
comes from the existing scoped source port; no ID-mapping or trust is inferred.

Passive execution plan/run records and commands use explicit field schemas for every
nested record and provenance entry. The whole DTO is descriptor-inspected before
normalization: at most12 nesting levels,4096 values,1024 array items,128 fields
per object,80 characters per key,2048 characters per string and256KiB aggregate
UTF-8 key/string bytes. Unknown fields, accessors, sparse/extra-property arrays,
cycles, exotic prototypes, malformed supplied collections and nonfinite numbers
deny without echoing content or invoking coercion. Free text rejects protected
representations; typed identities and enums use their own primitive-string parsers.
Flags require booleans, percentages are finite0..100, attempts are positive safe
integers, timestamps must represent actual canonical instants and provenance kinds
are finite. Declared conversation/output/cancellation/retry references roundtrip.
Missing run collections retain existing empty defaults; malformed supplied values
never become empty success. Unsafe stored records fail reads without migration or
rewriting. This adds no execution authority or host/transport composition; controlled
qualification and previously uncomposed families remain pending/default-denied.
Recognizable credential representations (including short provider-token prefixes)
are rejected in public free text and nested metadata; a length-only encoded-data
check cannot establish non-disclosure. Typed identities retain their own schemas.

Effective projection records, snapshots, commands, references and provenance are
explicitly reconstructed with the shared bounded passive DTO schemas. Declared
labels/metadata, canonical timestamps, revision identities and finite graph-summary
counts/actual boolean flags are validated. Projected metadata retains safe nested
arrays, false/zero/null and existing field rules with bounded recursion; credential
representations, paths, accessors, cycles and unknown payload fields deny.
Diagnostic messages remain generic. Snapshot identity is required for snapshots.
The fixed local projection/snapshot collections validate on read, before writes,
and before/after mutation callbacks. Invalid stored records deny without rewriting
bytes or invoking a mutation callback. This does not grant source authority, add
transport admission, enable uncomposed runtime families or satisfy controlled
qualification. Rollback must preserve the stronger record denial.
Duplicated target workspace identities must agree across command/record source,
target and provenance. Root and target effective references agree exactly on
kind/id/version, and an optional target projection ID matches the record.
Source workspace provenance may legitimately differ for library/import sources;
intended policy may differ from the actual blocked policy. Contradictory records
deny before persistence or progression, rather than selecting a convenient identity.

Built-in definition read classification compares complete bounded, descriptor-safe
content against the code-owned legacy catalog and exact immutable Foundation
1/2/3 releases before display sanitization. Only raw content and precisely
reconstructed seeder/installer enrichment match; only declared operational
timestamps may vary. ID/version or editable marker/fingerprint claims alone
confer no badge. Unknown enrichment and changed schema, AI context, provenance or
metadata cannot earn built-in/system/trusted status. List/filter/single/batch
reads use the same classification, and projected metadata removes editable
positive cues before downstream UI fallbacks. Ordinary custom-source descriptors
and nonpositive trust states remain visible. Reads never seed, install or write.
The shared passive structural bounds now apply before definition projection;
malformed/accessor-bearing records fail with a static read error. This is read
classification, not package admission or general proof of trusted provenance.
Seeder and system-pack installer reuse also captures the complete bounded passive
stored body before reading markers, and compares it against exact expected source
content plus declared operational enrichment. An unchanged editable fingerprint
never makes edited content already current. Nonmatching seeds preserve user edits;
nonmatching installs deny unless the existing explicit same-pack refresh is
authorized. Refresh writes validated supplied source content and never treats an
editable marker as proof of its current body. Immutable legacy fingerprints are
retained as source identifiers, without migration or promotion to semantic-v2.
Complete package-integrity migration and native qualification remain pending.
Rollback retains content comparison and the stronger denial of forged authority cues.

Image/generated-output view identities are persisted random opaque aliases under
accepted ADR-0043. The narrow identity port stores private organization/workspace
source and public indexes; a hash appears only in the private source index key,
never in a public identifier. Active SQLite/PostgreSQL host composition supplies
the organization-context store. Organization scope is frozen before awaiting;
unassigned or missing stores deny this projection without a legacy JSON fallback.

Revision-CAS publication reserves one immutable alias per owner/source, inserts
its exact inverse, then commits the source revision. Only committed consistent
pairs are returned or resolved. A new reserved publication can resume after an
authorized descriptor read, using the same alias; committed missing or substituted
pairs deny without repair. Four conflict attempts bound admission. This avoids
adding overlapping connection transactions to the existing SQLite seam. Private
reserved records grant no source authority and are never public evidence.

Image/output/artifact aliases and source cursors use this mapping. Descriptor
capture rejects active/malformed input before projection. Detail reads use two
exact index lookups, followed by an exact workspace-scoped source reauthorization;
there is no source-ID decoding or list fallback. Revoked/mismatched sources deny.
Image cursor continuation uses the last returned source row, avoiding a skipped
next item. No image bytes, providers, runtimes, registration or finalization are
invoked by projection. Generated-output finalization remains uncomposed in hosts.

Existing source-derived view references are not migrated or silently reassigned.
Explicit owner-approved legacy-reference migration and native persistence/ACL
qualification remain pending. Preserve mapping records and stronger denials on
rollback; never restore source-derived public IDs. This component evidence does
not close parent security increments or establish protected physical-file effects.

Canvas startup optimization delta: bounded Foundation reads and atomic batch
registration retain full validation, stored-content matching and explicit refresh
authority. Expected-body comparisons execute inside each CAS retry; stale plans,
duplicate identities, active/malformed JSON and invalid later members cannot
overwrite user edits. Injected single-registration rejection is never bypassed.
Trusted definition snapshots are exact-version and invocation-private; owner-bound
single-flight expires on settlement and later attempts revalidate persisted trust.
Public failure messages remain generic. Internal Foundation attribution includes
only fixed stage, known release version, bounded counts and allowlisted codes,
never raw records, paths or repository errors. Immutable artifacts and partial
failed attempts remain intact. Native filesystem/platform and reference-model
qualification remain separate; these optimizations provide no new authority.

Managed reference qualification is an isolated test composition with actual
PostgreSQL, forced RLS, OIDC/JOSE and verified TLS. It checks the exact owned
container image/labels and every published binding, uses fresh synthetic database
and least-privilege nonowner runtime roles, and confines CA trust to owned child
processes. Invalid identities, missing membership and existing foreign-workspace
reads retain their public denials. No verifier, persistence or authorization
substitution supplies managed evidence. Private credentials/keys and bounded
diagnostics remain ignored; traces carrying bearer injection are disabled.
Fixed synthetic workers accept only the existing controlled model and finite
scenarios. Observed work supports authenticated cancellation, duplicate active
identity denial and bounded timers; fixture failure exits only its own process.
Startup failure attempts every acquired cleanup; admitted-host teardown requires
acknowledgment, exit zero and physical owned-worker exit. Forced cleanup and stale
source fail qualification. Actual failed product journeys stay failed until fixed
and rerun; this harness grants neither inference nor parent roadmap completion.
# Qualification defect reconciliation

Actual managed-host qualification exposed missing scoped custom readers and
inconsistent list/detail membership. Both now resolve persisted workspace sources;
custom metadata and foreign workspace/organization records confer no authority.
Necessary Composer filters reduce reads while final compatibility and bounded,
query-bound paging remain enforced. Owned Python process-exit reconciliation
uses supervisor ownership rather than network failures; late replies and old
generations cannot resurrect accepted unfinished tasks. Retained failures and
actual host regression evidence remain distinct from inference qualification.


## Studio interface ownership and failure recovery

Late read/save/review/publish/abandon replies are confined to the mounted
workspace/client/selected-draft session. Synchronous operation admission denies
duplicate dispatch before the busy render. Acknowledgements must match exact
workspace, draft and definition identity, expected lifecycle state and sequential
revision. A malformed/foreign acknowledgement leaves the editor unsuccessful.
These interface checks supplement the existing authoritative application,
transport, immutable-source and publication transaction controls.

Thrown adapter errors use static notification text, release only current
controls and allow explicit retry. Public contract failures retain their safe
messages. Read retry grants no write, install, activation or execution. Text and
resource edits made during saving remain dirty; another explicit save/review is
required before publication. Retired interface state is not proof of server
cancellation or physical cleanup. Focused positive, duplicate, foreign, delayed,
rejection and retry cases use fixed client results with inert resource text;
actual transport/storage, app restart, provider/native and complete security
qualification remain separate. Unrelated Saved-list and accessible-label work
is preserved outside this scoped checkpoint.

Read admission checks ownership before client dispatch. The saved editor stays
disabled until a matching saved view is accepted, including explicit retry; no
new-draft write can originate from its unread placeholder. This interface fence
does not replace transport authorization or cancel an earlier server request.

## Package interface ownership and consistent acknowledgements

The package renderer confines list reads and inspect/admit/lifecycle results to
the mounted workspace/client session. A synchronous token denies duplicate
actions. Retired asynchronous file reads cannot dispatch inspection. Typed
rendering checks reject malformed review summaries before they reach JSX and
require identity for eligible admission while preserving ineligible diagnostics.
These checks supplement the existing inspector, immutable artifact, provenance,
capability, signature, authorization and admission transactions.

Installation retains per-capability consent and separate explicit activation.
Accepted records must match the inspected identity or requested lifecycle target;
rollback matches the previous active record, not the current input record.
Unavailable lifecycle states cannot activate through the renderer. The server
remains authoritative for idempotence, revisions, trust and execution policy.

Retiring an old initial list prevents it from erasing a newer install. The fresh
post-action list must preserve the acknowledged target identity and revision;
missing/stale/inconsistent targets keep the last accepted result visible with
a safe notification and explicit list retry. A later legitimate server revision
is accepted. A failed unknown initial catalogue is never called empty.
Thrown exceptions and obsolete replies cannot strand or alter the current view;
static error copy excludes raw adapter detail. This is interface recovery, not
server cancellation or physical cleanup. Fixed-client positive, failure,
malformed, duplicate, identity, stale-list and retired-session tests do not pass
real transport/storage, app/native/provider/runtime or final qualification.

### Saved-view response and legacy-open ownership

Protected data is workspace-owned Saved metadata and current navigation state.
A delayed list or accepted legacy conversion must not update a replaced workspace
or client view. Synchronous read/action ownership prevents duplicate opens and a
search from releasing another request. A retired owner is checked before a call,
before a reply and before releasing controls. This UI fence is not authorization;
the existing application must still authorize each operation and own persistence.

Validate list rendering fields and row identities before display. Legacy list
records must match the requested workspace. An accepted conversion must have a
canonical Studio identity and the expected workspace and legacy provenance.
Existing canonical idempotent replies remain valid; no assumed initial revision
or newly seeded definition substitutes for the authoritative returned record.
Thrown errors use fixed notification text; only established public typed errors
are displayed. Partial legal lists remain usable and unknown lists are not
reported as empty. Explicit retry does not imply cancellation or rollback.

Focused synthetic UI tests cover duplicate, throw/reject, malformed/foreign
identity, partial-source failure, retry and workspace/client/unmount races.
They do not qualify actual transports, persistence, applications, native workers,
source execution or the parent roadmap. Those qualification obligations remain.

### Customization editor intent and acknowledgement checks

Protected data is workspace-owned editing content and the user's intent to save,
review, publish or abandon an exact customization revision. A future render is
not the current owner until it commits. Workspace/client views retire in layout
cleanup; sequence and current-owner checks guard response acceptance and control
release. A later acknowledgement cannot redirect a following operation to another
workspace, customization, definition or base. Use the existing canonical record
validator and the captured command identity, state and revision. Nested resource
content must be renderable, with canonical paths, roles and media types, explicit
editable flags and numeric sizes. Reuse existing file/count/aggregate bounds;
keep read-only HTML as text. Copy the accepted detail to retain its original base.
Valid fresh
creation IDs are allowed; closed/idempotent server behavior is not redefined.

Unsaved semantic or source changes prevent review/publication dispatch, including
in the same event turn. Saving only clears the edit generation it captured. The
immutable derived identity cannot change through update. Publication and abandon
lock input before dispatch so newer content is not stranded under terminal
success. Failed requests release only their own controls and permit explicit
retry. Unexpected transport and preparation exceptions use fixed notification
copy. These UI checks grant no workspace, source or publication authority.

Local synthetic UI tests cover held writes, stale/uncommitted owners, malformed
and foreign acknowledgements, exact command/revision identity, denied dispatch
and corrective retry. Actual application, provider, storage, native, source
execution and final combined qualification remain separate.

### Desktop legacy Saved query mapping

The legacy list contract names its workspace `targetWorkspaceId`; the repository
query names it `workspaceId`. Capture the public target once, normalize it with
the existing workspace contract, and map only supported filters. Do not spread
the renderer payload into the query or accept its extra `workspaceId` as an
alternate target. A missing target prevents repository access. A failed read
produces fixed unavailable text, without adapter exception details, and permits
an explicit notification-guided Search retry. Returned request context is kept.

The connected Saved tests use the real renderer/client/preload/registered handler
and finite repository/sender fixtures. They check exact records, workspace
replacement, original record preservation, filter/context mapping, invalid input,
unavailable reads and safe retry. A single-capture counterexample exercises the
in-process handler seam; it does not represent an Electron wire getter. Routing
context and fixture sender admission are not resource authorization. Actual host
identity, application authorization, persistence, native and final qualification
remain separate. This repair neither weakens nor qualifies the other guards.

### Assets IPC sender admission delta

Protected assets are workspace records, package and Studio operations, and
deferred feature effects. A foreign window, subframe or destroyed owner must
not reach them. The desktop host supplies its existing live owned-window
main-frame policy to all three Assets registrations. Each fixed-channel wrapper
requires the literal synchronous result `true` before it reads request context
or payload or resolves a deferred service. Missing policy, exceptions and
nonboolean results deny with the common fixed forbidden response; no request
IDs or private exception details are read into that response. Descriptor setup
rejects duplicate request channels, mismatched operations and unknown channels.

Finite tests exercise every registered channel, trusted argument/result identity,
malformed trusted requests, parity and real host composition without opening an
app. Denied calls leave deferred features unloaded. Existing actor injection,
validation and workspace/use-case controls remain authoritative after admission.
This local proof does not qualify real Electron events, resource authorization,
publication transactions, persistence, native or parent roadmap outcomes. Repair
forward; rollback must retain sender admission rather than restore open handlers.
