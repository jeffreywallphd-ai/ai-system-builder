# Context Pack: Security Architecture

- Pack name: `security`

## Purpose

- Route prompts that touch authentication, authorization, TLS, route policy, credential handling, safe diagnostics, and public payload sanitization.
- Keep security work aligned to ADR-0015 without moving feature code into a monolithic security layer.

## Use When

- Authn/authz, route policy, secure fetch, bearer tokens, pairing, TLS/HTTPS, cert modes, token storage, audit, rate limiting, or security configuration are in scope.
- Public API/IPC/preload/UI payloads may expose errors, metadata, runtime diagnostics, asset/resource descriptors, or mutation results.
- Storage, runtime, provider, model, artifact, image, dataset, external repository, or Asset Kernel work needs sanitization or permission guardrails.

## Do Not Use When

- The task is entirely internal pure-domain logic with no user, host, storage, provider, runtime, transport, or diagnostic boundary.
- A narrower pack already covers a purely non-security concern and no public/sensitive data can cross boundaries.

## Core Posture

- Security is layered and adapter-based, not monolithic.
- Shared security primitives belong in contracts/ports/adapters; feature code consumes shared seams.
- Bearer tokens authenticate clients; HTTPS/TLS provides confidentiality and integrity.
- Route policy is centralized; unknown `/api/*` routes are denied with `security.route-policy-missing`.
- Unexpected internal errors at API/IPC/preload/UI boundaries must stay generic and sanitized.
- Security mode and listener transport posture are startup-owned; runtime toggles must not imply live HTTP/HTTPS conversion.

## Current Implementation Snapshot

- Security modes:
  - `disabled-dev`
  - `lan-https-token`
  - `oidc-bearer`
- Required env for `lan-https-token`:
  - `AI_SYSTEM_BUILDER_SECURITY_MODE=lan-https-token`
  - `AI_SYSTEM_BUILDER_TLS_CERT_MODE=manual|auto-self-signed|auto-local-ca`
  - `SERVER_TOKEN_HASH_SECRET`
- Useful dev HTTPS env:
  - `AI_SYSTEM_BUILDER_HTTPS_ENABLED=true`
  - `AI_SYSTEM_BUILDER_THIN_CLIENT_HTTPS_ENABLED=true`
  - `AI_SYSTEM_BUILDER_TLS_CERT_MODE=auto-self-signed`
- Managed production requires `oidc-bearer`, exact HTTPS issuer/audience/JWKS
  configuration, PostgreSQL, and active application-managed organization
  membership. Provider claims do not grant membership.
- Managed capabilities come from the current organization role, not token role
  claims. Ordinary members cannot mutate shared settings or credentials;
  administrator-only package-source settings use validated allowlisted values.
- Missing provider repositories require explicit creation approval, an explicit
  private/public choice, and managed `provider-repository:create` authorization
  before provider I/O. Private is the user-interface default.
- Desktop artifact IPC accepts only the exact main frame of a live host-owned
  window. Main-process handlers revalidate contracts; artifact publication is
  workspace/capability authorized before reads or provider I/O. Uploads use one
  shared 64 MiB limit before renderer byte allocation, again before preload IPC
  serialization, and again in main; preload permits only one in-flight upload.
- Pooled tenant placement is the default. Premium dedicated placement allows
  only one configured organization while retaining the same release and schema.
- Thin-client secure fetch adds `Authorization: Bearer` when a paired token exists.
- Release-bound system data derives a finite allowlist and narrowing roles from
  one verified approved manifest. Host-derived principals, trusted validation,
  protected-field masking, atomic record/audit writes, redacted field-name-only
  audit evidence, and fail-closed duplicate/misbound declarations are enforced
  below transports and UI.
- Token hashes are persisted; raw bearer tokens and hash secrets must never be committed or logged.
- The tracked npm lockfile is used by CI and server-image builds; the dependency
  security gate requires clean production and complete development trees and
  validates a production SPDX SBOM. Reviewed transitive overrides are exact and
  must retain packaging and feature compatibility evidence.

## Layered Enforcement Model

- Transport boundary: authenticate, apply route policy, reject malformed/oversized inputs, preserve safe HTTP/security error codes.
- Application boundary: enforce actor-aware use-case policy, approval/capability guards, resource authorization, and audit decisions.
- Adapter boundary: enforce path containment, credential storage rules, redaction, runtime/process hardening, and optional encryption.
- Host composition: select security mode, TLS mode, security store, and concrete adapters.
- UI/client boundary: preserve safe codes/statuses and present user-friendly messages without raw internals.

## Sanitization Rules

- Never expose secrets, bearer tokens, auth headers, cookies, passwords, API keys, signed URLs, query credentials, raw env values, or token hashes.
- Never expose local/cache/temp/storage/runtime paths, storage roots, command lines, stack traces, raw exceptions, process internals, provider-native payloads, raw JSON lines, or raw logs in public responses.
- Never expose bytes, blobs, base64/data URLs, prompt/workflow payloads, model/dataset/image/document contents, or resource contents through diagnostics or Asset Kernel metadata.
- Never execute imported/authored code in Electron main/preload/product renderer, the API server process, or the database process. Node permissions alone are not a malicious-code sandbox.
- Treat package/source/model output as untrusted instructions. Use quarantine, non-executing inspection, isolated source roots, sandboxed builders/runners, default-deny egress, opaque secret references, a capability broker, exact approvals, and audit.
- Security assets may only narrow platform and organization policy; any upstream denial wins.
- Runtime/readiness failures may include safe capability ids, status, summaries, reason codes/categories, and recommended actions.
- Resource-backed view diagnostics must be sanitized by provider/facade/transport/UI layers, not merely hidden in CSS.
- Asset mutation guards must fail before source reads or side effects when approval, actor, capability, or request context is invalid.
- Outbound website acquisition and external-provider localization use the shared
  secure-egress broker. It validates and pins public DNS answers per hop, strips
  credentials across origins, and bounds redirects, streamed bytes, media type,
  time, and concurrency. Rendered browsers block service workers/WebSockets and
  route document and subresource traffic through the same broker.
- Upload classification verifies coherent metadata and content evidence before
  persistence. Artifact browsing and provider logical listings apply hard
  result/I/O bounds. Runtime reference images use catalog-owned bounded reads,
  signature checks, contained randomized staging, and deterministic cleanup.
- Declarative system/foundation previews bound graph breadth/depth,
  configuration complexity, text, option, region, and table sizes before
  rendering. Desktop artifact media uses revocable Blob object URLs rather than
  base64/data URLs.

## Route, Storage, Secret, And Audit Principles

- Keep route policy centralized rather than scattered across handlers.
- Treat lowercase canonical API paths as route identity. Express dispatch must
  stay case-sensitive, while API-namespace detection must recognize case and
  encoded variants so non-canonical and unknown paths fail closed.
- Authenticate and establish managed organization context before installing
  body parsers for protected APIs. Keep JSON and streaming multipart limits
  explicit, validate legacy byte arrays before typed-array allocation, and map
  parser failures to sanitized API envelopes without raw parser details.
- Treat storage keys as opaque and enforce filesystem path containment in adapters.
- Treat secrets/credentials as sensitive configuration, not normal settings.
- Treat repository creation and installer-source changes as privileged audited
  operations, not ordinary artifact writes or free-form settings.
- Keep audit logs distinct from normal diagnostics.
- Active workspace selection is routing context, not authorization.
- Active organization selection is also routing context. Managed requests must
  pass organization membership policy, request-scoped persistence, PostgreSQL
  row security, and organization-derived object containment.

## TLS And Dev Notes

- Default `dev:server` is `disabled-dev` over HTTP with no auth.
- Dev HTTPS can be enabled with `AI_SYSTEM_BUILDER_HTTPS_ENABLED=true` and `AI_SYSTEM_BUILDER_TLS_CERT_MODE=auto-self-signed`.
- Thin-client HTTPS is separate from server API HTTPS and can use explicit cert/key paths or dev-generated cert material.
- `auto-self-signed` may produce browser trust warnings.
- `auto-local-ca` supports local/dev/LAN testing with manual trust installation.
- No automatic trust-store installation is performed.

## Current Limitations

- OIDC bearer verification, membership authorization, redacted append-only audit,
  and organization-level storage authorization are implemented. Interactive
  login/session UX, mTLS, external TLS termination mode, encryption at rest,
  broad public-internet abuse hardening, full admin UI, fine-grained resource
  grants, and complete managed audit export remain open.
- Dev browser localStorage token persistence is LAN-convenience behavior, not hostile-browser hardening.

## Dependency Rules

- Security contracts may be used broadly.
- Security adapters are outer-layer implementations and must not be imported by domain/application code.
- UI must not import server security adapters.
- Feature routes and clients should use shared security seams instead of custom auth/error systems.

## Canonical Source Docs

- `docs/adr/ADR-0015-security-architecture-and-policy-boundaries.md` - canonical security architecture and policy boundary.
- `docs/adr/ADR-0029-organization-tenancy-identity-and-authorization.md` - organization, managed OIDC, authorization, audit, and placement decision.
- `docs/architecture/organization-tenancy-and-identity.md` - current end-to-end implementation model and operator flow.
- `docs/architecture/host-model.md` - host composition and mode selection.
- `docs/architecture/persistence-and-storage.md` - storage containment and credential/storage separation.
- `docs/standards/logging-standards.md` - structured logging and redaction expectations.
- `docs/standards/coding-standards.md` - safe implementation discipline.
- `docs/standards/dependency-supply-chain-standards.md` - lockfile, advisory,
  SBOM, and workflow-integrity policy.

## Companion Packs

- `server-host` for Express routes, middleware, route policy, and thin-client API behavior.
- `desktop-host` and `ipc-electron` for IPC/preload security boundaries.
- `desktop-implementation` for renderer/thin-client UX around auth, pairing, and safe error display.
- `persistence-storage` for token/security stores and artifact authorization boundaries.
- `runtime`, `runtime-installer`, or feature packs when runtime/provider/process diagnostics are in scope.

## Common Over-Inclusions To Avoid

- Claiming HTTPS + LAN token is public-internet production hardening.
- Claiming bearer tokens encrypt traffic.
- Moving all feature code into `security/` folders.
- Returning raw internal errors for easier debugging.

## Prompt Assembly Notes

- Include this pack for any public boundary where sensitive data, route policy, TLS/auth state, or sanitized diagnostics may change.
- Read ADR-0015 directly when changing route policy, token handling, security modes, pairing, route errors, TLS behavior, or security API semantics.
