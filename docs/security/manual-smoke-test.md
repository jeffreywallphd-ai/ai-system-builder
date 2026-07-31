# Manual Security Smoke Test

## Managed OIDC and organization isolation smoke

1. Provision two test organizations and exact issuer/subject memberships with
   `npm run tenancy:postgres`; retain only sanitized command output.
2. Start a qualification deployment in `oidc-bearer` mode with pooled placement,
   a real test IdP, HTTPS, and a non-owner, non-superuser PostgreSQL runtime role
   without `BYPASSRLS`.
3. Confirm missing/malformed organization context and inactive or absent
   membership fail. Provider email, domain, scopes, and organization claims alone
   must not grant membership.
4. Write the same logical workspace/document/artifact key in both organizations;
   confirm each principal reads only its records and physical object prefix.
5. Confirm a missing database tenant setting sees no organization rows and a
   reused pooled connection does not retain the previous transaction-local value.
6. Repeat with premium dedicated placement. Omit the header and confirm the fixed
   organization works; send the other id and confirm rejection before data access.
7. Confirm denials emit redacted audit events with request/correlation identity
   but no token, claims, payload, prompt, content, or path.
8. Rotate a test IdP signing key and reject invalid issuer, audience, algorithm,
   and signature cases.

These checks supplement automation; they do not qualify public ingress, the IdP,
database roles, object service, or audit retention by themselves.

## Shared setup

1. Generate a strong `SERVER_TOKEN_HASH_SECRET` (do not commit or screenshot it):
   ```bash
   node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
   ```
   ```powershell
   $bytes = New-Object byte[] 32; [Security.Cryptography.RandomNumberGenerator]::Fill($bytes); [Convert]::ToHexString($bytes)
   ```
2. Keep secrets out of docs/logs/shell history where possible.

## disabled-dev smoke

1. Start server:
   ```bash
   AI_SYSTEM_BUILDER_SECURITY_MODE=disabled-dev npm run dev:server
   ```
2. Confirm startup log clearly shows disabled/insecure mode.
3. Confirm `/api/security/status` succeeds without auth and reports disabled-dev posture.
4. Confirm model management, image generation, and artifact browser requests work without pairing.

## lan-https-token smoke

1. Generate or provide cert/key (example with mkcert):
   ```bash
   mkcert -install
   mkcert localhost 127.0.0.1 ::1
   ```
2. Start server with HTTPS required:
   ```bash
   AI_SYSTEM_BUILDER_SECURITY_MODE=lan-https-token \
   AI_SYSTEM_BUILDER_TLS_CERT_MODE=auto-self-signed \
   SERVER_TOKEN_HASH_SECRET=<strong-random-secret> \
   npm run dev:server
   ```
3. Confirm server starts in HTTPS mode and does not fall back to HTTP.
4. Confirm public `GET /api/security/status` works without bearer token.
5. Try protected API before pairing; expect `401` with canonical unauthenticated/invalid-token guidance.
6. Pairing-code provisioning note (current implementation):
   - Pairing completion route exists: `POST /api/security/pairing/complete`.
   - Pairing-code creation/admin UX is not a complete first-implementation workflow.
   - If no provisioning UI/tooling is available in your environment, manual testing requires a pre-existing valid pairing-code entry in the server security store.
7. Complete pairing via valid pairing code and confirm bearer token is not rendered in UI/logs.
8. Confirm authenticated `GET /api/security/status` includes principal semantics when valid bearer token is sent.
9. Confirm protected model/image/artifact API calls succeed when scope permits.
10. Confirm insufficient-scope action returns `403` with canonical `security.forbidden` behavior.
11. Confirm stale/invalid token behavior:
    - invalid token -> `401` + `security.invalid-token`
    - expired token -> `401` + `security.expired-token` (when applicable)
    - revoked token -> `401` + `security.revoked-token` (when applicable)
12. Confirm unknown `/api/*` route is denied by route policy (`security.route-policy-missing`).
13. Confirm startup fails with actionable error if `SERVER_TOKEN_HASH_SECRET` is missing in `lan-https-token`.

## Scope/limitations reminder

- Rate limiting, dedicated audit logging subsystem, and public-internet hardening are not complete in this first implementation.
- mTLS, OAuth, external TLS termination mode, and encryption at rest are future phases.

- Dev enforcement toggle: set `AI_SYSTEM_BUILDER_DEV_SECURITY_TOGGLE_ENABLED=true` with `AI_SYSTEM_BUILDER_SECURITY_MODE=disabled-dev` to test auth-on/auth-off behavior without restarting for every auth test.
- Changing transport listener mode (HTTP/HTTPS) still requires restarting `dev:server`; the dev toggle does not enable TLS transport.


## disabled-dev with HTTPS smoke (restart required)

1. Start server in disabled-dev with HTTPS listener:
   ```bash
   AI_SYSTEM_BUILDER_SECURITY_MODE=disabled-dev \
   AI_SYSTEM_BUILDER_HTTPS_ENABLED=true \
   AI_SYSTEM_BUILDER_TLS_CERT_MODE=auto-self-signed \
   AI_SYSTEM_BUILDER_DEV_SECURITY_TOGGLE_ENABLED=true \
   npm run dev:server
   ```
2. Confirm `/api/security/status` reports `mode=disabled-dev` and `httpsEnabled=true`.
3. Confirm security page shows HTTPS enabled plus dev enforcement dropdown.
4. Toggle dev enforcement and verify only auth behavior changes; listener protocol does not change until restart.


## TLS mode reminders

- Default `dev:server` remains HTTP/no-auth (`disabled-dev`).
- Use `AI_SYSTEM_BUILDER_TLS_CERT_MODE=auto-self-signed` with either `disabled-dev` + `AI_SYSTEM_BUILDER_HTTPS_ENABLED=true` or `lan-https-token`.
- `auto-local-ca` is supported for local/dev/LAN testing. Download `/api/security/tls/local-ca.pem` and install trust manually.
- Self-signed certs may still show browser trust warnings until explicitly trusted.
- Dev auth enforcement toggle does not switch HTTP/HTTPS; listener mode changes require restart.
- Do not commit or log private keys or token hash secrets.


No automatic trust-store installation is performed. Trust installation is manual; browser/mobile trust limitations apply. Do not commit private keys or SERVER_TOKEN_HASH_SECRET.

## Thin-client Vite HTTP/HTTPS smoke (with HTTPS server API)

### HTTP thin-client + HTTPS API

Terminal 1:

```bash
AI_SYSTEM_BUILDER_SECURITY_MODE=disabled-dev \
AI_SYSTEM_BUILDER_HTTPS_ENABLED=true \
AI_SYSTEM_BUILDER_TLS_CERT_MODE=auto-self-signed \
npm run dev:server
```

Terminal 2:

```bash
AI_SYSTEM_BUILDER_HTTPS_ENABLED=true \
AI_SYSTEM_BUILDER_TLS_CERT_MODE=auto-self-signed \
npm run dev:thin-client
```

Open `http://localhost:5173`.

Expected:

- Vite reports `http://localhost:5173`.
- Server security page/status shows API HTTPS enabled.

### HTTPS thin-client + HTTPS API

Terminal 2 (thin-client HTTPS enabled):

```bash
AI_SYSTEM_BUILDER_THIN_CLIENT_HTTPS_ENABLED=true \
AI_SYSTEM_BUILDER_HTTPS_ENABLED=true \
AI_SYSTEM_BUILDER_TLS_CERT_MODE=auto-self-signed \
npm run dev:thin-client
```

Open `https://localhost:5173`.

Expected:

- Vite reports `https://localhost:5173`.
- Thin-client Vite generates or reuses dev certificate material when explicit thin-client cert/key paths are not set.
- Browser may still show a trust warning for self-signed/untrusted certs.
- Server security page/status still shows API HTTPS enabled.

Notes:

- You may reuse server-generated dev cert/key for thin-client HTTPS if cert SANs include `localhost`.
- To force a specific Vite listener certificate, set `AI_SYSTEM_BUILDER_THIN_CLIENT_TLS_CERT_PATH`
  and `AI_SYSTEM_BUILDER_THIN_CLIENT_TLS_KEY_PATH`.
- Thin-client does not auto-discover server cert file paths.
- `auto-local-ca` requires manual CA trust installation.
- Switching thin-client HTTP/HTTPS mode requires restarting `npm run dev:thin-client`.
- Do not commit or log private keys.
- This is development-only TLS support, not production/public-internet hardening.
