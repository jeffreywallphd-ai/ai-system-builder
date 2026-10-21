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
Legacy semantic fingerprints and their exclusions remain unchanged; complete
content integrity/version migration remains a separate unresolved qualification
and compatibility boundary. No provider, model or runtime execution is added.

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
Seeder/installer marker-only already-current shortcuts, complete package integrity
migration and native qualification remain separate pending work. Rollback retains
the stronger denial of forged authority cues.
