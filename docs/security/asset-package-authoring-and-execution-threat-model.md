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
