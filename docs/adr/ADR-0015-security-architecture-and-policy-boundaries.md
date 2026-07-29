# ADR-0015: Security Architecture and Policy Boundaries

- Status: accepted
- Date: 2026-05-04
- Deciders: ai-system-builder maintainers
- Related: ADR-0003, ADR-0013, docs/architecture/system-overview.md, docs/architecture/host-model.md, docs/architecture/persistence-and-storage.md, docs/architecture/runtime-model.md, docs/architecture/module-dependency-rules.md, docs/standards/security-by-design-standards.md

## Context

`ai-system-builder` supports desktop, server, and thin-client surfaces. Server/thin-client operation and future desktop remote execution require secure communication boundaries that stay aligned with clean architecture.

The first practical secure LAN target is HTTPS + LAN pairing bearer tokens:

- HTTPS/TLS provides confidentiality, integrity, and server authentication.
- Bearer tokens authenticate clients but do **not** encrypt traffic.
- LAN pairing issues device bearer tokens after short-lived one-time pairing flow.

The architecture must remain open to swappable future modes through adapters: external TLS termination, mTLS, API keys, web CA certificates, reverse-proxy identity, and other secure transfer mechanisms.

Security scope also extends beyond transport: authentication, authorization, storage security, secret/credential handling, audit logging, input hardening, runtime/process security, model/plugin supply-chain security, and privacy/data governance.

Clean architecture constraints apply: security mechanisms should be adapter-driven and composed by hosts, not embedded in domain logic, React UI code, or feature route business logic.

## Decision

Security is a cross-cutting architecture concern implemented through shared contracts, application ports/services, adapters, and host composition.

Every repository change performs the security impact screen defined by `docs/standards/security-by-design-standards.md`. This is mandatory even when a task is not labeled security-sensitive and when the implementation is outside a security-named directory. A `security-relevant` result requires a proportional threat review that identifies protected assets, actors and authority, trust boundaries, abuse/failure cases, controls, rollback safety, evidence, and residual risk before completion. A `not-security-relevant` result requires a concrete rationale and must be revisited if scope reveals another boundary.

- Not all security-related code belongs in `security/` folders.
- Shared security primitives belong in security folders.
- Feature-specific security declarations and enforcement remain near feature/transport boundaries while consuming shared security contracts/ports.
- Transport authentication/encryption is adapter-based and swappable.
- Storage security is separate from transport security and enforced via storage adapters plus resource-aware application services.
- Authorization policy is centralized, but enforcement is layered.
- Secrets/credentials are handled through security/credential-store ports, not general settings bags.
- Audit logging is separate from normal diagnostics.
- Dev no-auth mode must be explicit and noisy.
- Initial LAN implementation target: `HTTPS + LAN pairing bearer token`.
- Managed production identity and organization authorization follow ADR-0029.
- Future modes are added by new adapters, not use-case rewrites.
- Security cannot be deferred or excluded as a whole. A specific hardening item may be deferred only with a named boundary, residual risk, and explicit decision or successor work.
- Migration, compatibility, recovery, and rollback paths must not weaken the forward security posture or restore a known-vulnerable mode.

## Current first implementation status (rebuild branch)

This ADR remains the canonical architecture decision. Current implementation is a first LAN-focused security slice:

- `disabled-dev` (implemented)
  - HTTP allowed.
  - Authentication not required.
  - Explicitly insecure/noisy mode for local development only.
- `lan-https-token` (implemented)
  - HTTPS required.
  - `AI_SYSTEM_BUILDER_TLS_CERT_MODE` selects `manual`, `auto-self-signed`, or `auto-local-ca`.
  - Manual TLS mode requires readable `AI_SYSTEM_BUILDER_TLS_CERT_PATH` and `AI_SYSTEM_BUILDER_TLS_KEY_PATH`.
  - Generated TLS modes create/reuse certificate material under the server security store or configured TLS certificate directory.
  - `auto-local-ca` supports local/dev/LAN testing with manual trust installation; no automatic trust-store installation is performed.
  - `SERVER_TOKEN_HASH_SECRET` is required.
  - Protected APIs require `Authorization: Bearer <opaque-token>`.
  - Server persists token hashes only in server-side security store data.
  - Thin-client token persistence flows through `pairedDeviceTokenStore`.
  - Current browser storage uses `localStorage` as an initial LAN convenience; it is not hostile-browser-hardened storage.
- `oidc-bearer` (implemented for managed production)
  - HTTPS is required.
  - Exact configured issuer, audience, asymmetric algorithm allowlist, signature,
    and subject are verified through the configured remote JWK set.
  - Issuer plus subject maps to an opaque internal principal id; provider scopes,
    email/domain, and organization claims do not grant membership.
  - Pooled requests require an explicit organization id; premium dedicated
    placement permits only its configured organization.
  - Active organization and membership are checked before protected feature
    routes, and organization-owned persistence/storage require the same request
    context.
- Security status supports both public discovery and authenticated principal validation when a bearer token is sent.
- API route identity is lowercase and case-sensitive at Express dispatch. The
  centralized policy recognizes case, encoded, slash, and backslash variants of
  the API namespace and denies non-canonical or unknown variants with
  `security.route-policy-missing` before feature handlers run.
- Security and managed-organization admission execute before JSON or multipart
  request parsing. The current JSON transport ceiling is 5 MiB; parser failures
  use the sanitized `api.request-body` failure envelope. Artifact multipart
  uploads accept one bounded file plus the declared metadata fields, and the
  application upload policy currently caps file bytes at 64 MiB.
- Canonical security API failures in active use include:
  - `security.unauthenticated`
  - `security.invalid-token`
  - `security.expired-token`
  - `security.revoked-token`
  - `security.forbidden`
  - `security.https-required`
  - `security.route-policy-missing`

Current limitations / required follow-up:

- Pairing-code creation/admin UX is not full device administration.
- `POST /api/security/token/revoke` exists and is currently policy-gated as admin (`security:admin`); normal thin-client self-revoke/admin device-management UX is not a completed first-implementation flow.
- Pairing endpoints should be rate-limited as hardening follow-up (not complete in current implementation).
- Authorization allow/deny events now use a separate append-only JSONL audit
  adapter with strict redaction; broader privileged-operation coverage and
  managed audit-service export remain qualification work.
- Organization membership and storage containment are implemented. Fine-grained
  resource grants beyond the current role model remain a successor decision.
- mTLS, external TLS termination mode, API-key mode, interactive OIDC login
  session UX, encryption at rest, and broader public-internet abuse hardening
  remain future work.

## Security domains

1. **Identity and authentication**
   - Responsibility: principal identity, token/session validation, device pairing.
   - Likely ownership: `modules/contracts/security`, `modules/application/ports/security`, `modules/adapters/security/*`, transport security middleware.
2. **Authorization and policy**
   - Responsibility: scope/operation/resource policy decisions and denials.
   - Likely ownership: centralized policy contracts/ports plus layered transport/application enforcement.
3. **Transport security**
   - Responsibility: HTTPS/TLS, request authentication envelopes, secure headers, boundary rate limiting.
   - Likely ownership: transport adapters + host composition/security config.
4. **Storage security**
   - Responsibility: storage-key handling, path containment, artifact access enforcement, optional at-rest protection seam.
   - Likely ownership: storage adapters + application services for actor-aware access.
5. **Secrets and credential management**
   - Responsibility: secure secret storage, hashing, retrieval, rotation/revocation seams.
   - Likely ownership: security credential ports/adapters + host config seams.
6. **Audit logging and security diagnostics**
   - Responsibility: durable security event trails, action/actor/outcome tracing.
   - Likely ownership: audit-log ports/adapters + application/transport emission points.
7. **Data validation and input hardening**
   - Responsibility: malformed/oversized payload rejection, strict boundary validation.
   - Likely ownership: transport adapters + request-validation helpers.
8. **Runtime/process isolation**
   - Responsibility: safe process invocation, environment restrictions, temp/path containment.
   - Likely ownership: runtime adapters + host runtime composition.
9. **Supply-chain/model/plugin security**
   - Responsibility: provider/download provenance, integrity checks, plugin/model risk controls.
   - Likely ownership: runtime/storage/provider adapters and host policy composition.
10. **Privacy/data governance**
   - Responsibility: data minimization, redaction, retention/deletion policy seams.
   - Likely ownership: contracts/policies + storage/persistence/application enforcement points.

## Recommended file structure

```txt
modules/
  contracts/
    security/
      index.ts
      auth-context.ts
      auth-principal.ts
      auth-scope.ts
      auth-session.ts
      security-error.ts
      security-mode.ts
      security-status.ts
      authorization-policy.ts
      security-event.ts
      credential-metadata.ts
      encryption-metadata.ts
      data-classification.ts
      resource-identifier.ts
      lan-pairing.ts

  application/
    ports/
      security/
        index.ts
        authentication-provider.port.ts
        authorization-policy.port.ts
        credential-store.port.ts
        token-issuer.port.ts
        token-verifier.port.ts
        encryption-key-provider.port.ts
        data-protection.port.ts
        audit-log.port.ts
        security-event-sink.port.ts
        secret-redactor.port.ts

    services/
      security/
        authenticate-request.service.ts
        authorize-operation.service.ts
        authorize-resource-access.service.ts
        classify-data.service.ts
        redact-sensitive-data.service.ts
        create-security-context.service.ts

  adapters/
    security/
      noop/
        createDevelopmentNoAuthSecurityAdapter.ts
        createAllowAllAuthorizationPolicy.ts

      lan/
        createLanPairingTokenIssuerAdapter.ts
        createLanBearerTokenVerifierAdapter.ts
        createLanDeviceCredentialStoreAdapter.ts
        createLanAllowlistPolicyAdapter.ts

      api-key/
        createApiKeyVerifierAdapter.ts
        createApiKeyCredentialStoreAdapter.ts

      tls/
        createTlsCertificateIdentityAdapter.ts
        createMtlsPrincipalExtractorAdapter.ts

      crypto/
        createNodeCryptoRandomAdapter.ts
        createNodeCryptoTokenHasher.ts
        createAesGcmDataProtectionAdapter.ts
        createCredentialHasher.ts

      audit/
        createJsonlSecurityAuditLogAdapter.ts
        createStructuredSecurityEventSinkAdapter.ts

      redaction/
        createDefaultSecretRedactor.ts

  adapters/
    transport/
      api-express/
        security/
          index.ts
          createExpressSecurityMiddleware.ts
          apiRouteSecurityPolicy.ts
          extractExpressSecurityInput.ts
          registerSecurityRoutes.ts
          applySecurityHeaders.ts
          createHttpsServerOptions.ts

      api-client/
        security/
          createBearerTokenRequestSigner.ts
          createSecureFetch.ts

      ipc-electron/
        security/
          createIpcSecurityContextAdapter.ts

    storage/
      filesystem/
        security/
          createSecureFilesystemStorageAdapter.ts
          filesystemPathPolicy.ts
          storageEncryptionEnvelope.ts

      huggingface/
        security/
          huggingFaceCredentialPolicy.ts

  hosts/
    server/
      security/
        composeServerSecurity.ts
        resolveServerSecurityConfig.ts
        serverSecurityDefaults.ts

    desktop/
      security/
        composeDesktopSecurity.ts
        resolveDesktopSecurityConfig.ts
        desktopCredentialStore.ts
```

Possible app-level files:

```txt
apps/
  server/
    src/
      security/
        createHttpsServer.ts
        serverSecurityEnv.ts

  thin-client/
    src/
      security/
        pairedDeviceTokenStore.ts
        secureFetch.ts

  desktop/
    src/
      security/
        desktopServerSecuritySettings.ts
```

## What belongs in security folders

Reusable cross-cutting security pieces, including:

- auth context/principal/scope contracts
- token verification/issuance and LAN pairing primitives
- credential stores and authorization policy contracts
- audit log adapters and security-event sinks
- encryption/data-protection and redaction utilities
- TLS/mTLS identity adapters
- Express security middleware and centralized route security policy registry
- host security composition helpers

## What should not all move into security folders

Feature implementation stays in feature areas:

- image-generation route handlers stay in image-generation transport folders
- model-management route handlers stay in model transport folders
- artifact storage remains in storage adapters
- ComfyUI/Python runtime adapters remain in runtime adapters
- feature UI remains in feature UI folders

Those areas should consume shared security contracts/ports/route policies as needed.

## Layered enforcement model

```txt
Transport boundary:
  authenticate request
  enforce coarse operation/route scopes
  reject malformed/oversized input
  apply security headers/rate limits

Application boundary:
  authorize resource-level access
  apply actor-aware use-case rules
  emit audit events for important operations

Adapter boundary:
  enforce filesystem containment
  broker outbound network access
  handle credential storage
  encrypt/decrypt if configured
  harden runtime process invocation
  redact sensitive diagnostics

Host composition:
  choose security mode
  wire concrete security adapters
  resolve credential/security config
  define public routes and route policy
```

## Initial HTTPS + LAN bearer token design

Security modes:

```txt
disabled-dev
lan-https-token
oidc-bearer
external-tls future
mtls future
api-key future
```

Initial capabilities:

- `disabled-dev`
  - no auth
  - HTTP allowed
  - loud startup warning
- `lan-https-token`
  - HTTPS required
  - TLS certificate mode may be manual, generated self-signed, or generated local-CA-backed
  - LAN pairing issues bearer device token
  - non-public APIs require `Authorization: Bearer <token>`
  - token is random opaque token
  - server stores only token hash
  - pairing code is short-lived and one-time use
  - pairing endpoints should be rate-limited (required hardening follow-up)

Recommended initial endpoints:

```txt
GET  /api/security/status
POST /api/security/pairing/complete
POST /api/security/token/revoke
```

Optional later:

```txt
POST /api/security/pairing/start
POST /api/security/token/refresh
```

## Recommended libraries

Initial library posture:

- Use Node built-ins first: `node:https`, `node:tls`, `node:crypto`, `node:fs`.
- Recommended packages: `helmet`, `express-rate-limit`, `ipaddr.js`, optional `zod`.
- Defer unless needed: `jose` (JWT/JWK/JWS/JWE), `keytar` (desktop credential store), `passport`/OAuth/full auth frameworks.

Initial bearer tokens should be opaque random tokens via Node crypto (not JWTs) to simplify revocation and preserve server-side control.

## Route policy

Representative centralized policy mapping:

```txt
GET /api/security/status -> public
POST /api/security/pairing/complete -> public

POST /api/model/browse -> model:read
POST /api/model/list -> model:read
POST /api/model/download -> model:write

POST /api/image-generation/start -> image-generation:write
POST /api/image-generation/read -> image-generation:read
POST /api/image-generation/finalize -> image-generation:write
POST /api/image-generation/cancel -> image-generation:write

POST /api/artifact/browse -> artifact:read
GET /api/artifact/media/view -> artifact:read
POST /api/artifact/upload -> artifact:write
```

Route policy should be centralized, not scattered ad hoc across handlers.

## Storage security

- Storage keys are opaque keys, not raw filesystem paths.
- Filesystem adapters must canonicalize paths and verify containment under storage root.
- Artifact reads and writes require authorization.
- Generated outputs should finalize into artifact storage without exposing runtime temp paths.
- Optional encryption at rest should be added via `DataProtectionPort`.
- API responses should not expose local filesystem paths.

## Outbound network security

- Host-composed ingestion and provider-localization adapters must use the shared
  secure-egress broker rather than calling ambient `fetch` or allowing a browser
  engine to make unrestricted requests.
- The broker permits only configured HTTP(S) schemes, rejects URL credentials,
  validates every DNS answer, pins the validated address set for the connection,
  and repeats validation for every redirect.
- Loopback, private, link-local, carrier-grade NAT, documentation, multicast,
  metadata-service, and other reserved IPv4/IPv6 destinations fail closed.
- Cross-origin redirects lose authorization and cookie headers. Rendered-browser
  acquisition blocks service workers and WebSockets and fulfills every routed
  document/subresource request through the broker.
- Response, session, deadline, redirect, media-type, and concurrency limits are
  enforced while streaming. External localization must finish within those
  bounds before bytes may enter canonical storage.

## Managed sidecar identity

- A managed local sidecar is not trusted merely because it listens on
  localhost. Host composition owns a canonical loopback-only bind/client
  endpoint and rejects remote, wildcard, credentialed, or path-bearing values.
- Each spawned Python runtime receives a new cryptographically random bearer
  token through its child-only environment. The host client reads the current
  value for every call, and the worker authenticates every endpoint using a
  constant-time comparison.
- Health and capability probes are authenticated. A fresh host foundation must
  not attach to an ambient loopback process without the current launch identity.
- Launch credentials must not be persisted, logged, included in readiness or
  diagnostics, exposed to renderer/client transports, or written to the parent
  process environment.

## Secrets and credentials

Hugging Face tokens, device tokens, API keys, TLS private keys, signing keys, and encryption keys are secrets.

- Do not store secrets in general settings payloads.
- Store server device tokens as hashes only.
- Desktop credential handling should later use OS credential storage where practical.
- Logs must redact secrets.
- Authorization headers must never be logged.

## Audit logging

Audit logging is distinct from normal diagnostics.

Representative audit events:

- auth success/failure
- token issued/revoked
- authorization denied
- artifact read/write/delete
- model download/publish
- image generation start/cancel/finalize
- settings/security changes

## Consequences

### Positive

- Security architecture remains swappable and adapter-driven.
- First secure LAN implementation is practical.
- mTLS/external TLS/API key modes can be added as adapters.
- Storage security and authorization are explicit, not accidental.
- Clean architecture boundaries are preserved.

### Negative

- Host composition becomes more explicit.
- Central route policy requires ongoing maintenance.
- Token lifecycle and credential storage need careful testing.
- HTTPS certificate trust/setup may require user/admin configuration, especially for manual and generated local-development certificates.
- Redaction/audit diagnostics work increases.

## Non-goals

- Do not implement OAuth now.
- Do not implement mTLS now.
- Do not implement public web-CA/ACME automation or trust-store automation now.
- Do not implement full encryption-at-rest now.
- Do not implement multi-user RBAC UI now.
- Do not move every feature into security folders.
- Do not claim safe public-internet production exposure without additional hardening.

## Follow-up

1. Security contracts/ports, server config seam, Express middleware skeleton, disabled-dev mode.
2. HTTPS server startup and LAN pairing bearer tokens.
3. Thin-client secure fetch and pairing UI.
4. Route policy protection for model/image/artifact routes.
5. Storage security hardening and audit logging.
6. Desktop remote-ready secure API client and credential-store seam.
7. Future mTLS/external TLS/API-key adapters.
