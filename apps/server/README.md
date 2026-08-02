# Server App

> AI documentation reminder: when behavior in this area changes, update the related ADRs, architecture docs, context packs, and README files in the same change.

`apps/server` is the Node/Express server host entry point.

## Toolchain

- Runtime: Node.js + TypeScript
- Transport adapter: Express (`modules/adapters/transport/api-express`)
- Composition root: `modules/hosts/server`
- Build output: `dist/apps/server/src/index.js`

## Commands

From the repository root:

- `npm run dev:server` - start server in watch mode (`tsx watch`) for local development.
- `npm run build:server` - compile server host and shared modules with `tsc`.
- `npm run start:server` - build then run compiled output.

From this workspace directly:

- `npm run dev`
- `npm run build`
- `npm run start`

## Managed persistence and deployment

Production requires `DEPLOYMENT_SHAPE=campus-server`, `corporate-server`, or
`cloud`; each selects PostgreSQL and requires `DATABASE_URL`. Startup validates
configuration and schema, imports only allowlisted legacy JSON before API
registration, and never falls back to JSON after a managed shape is selected.
Production also requires `AI_SYSTEM_BUILDER_SECURITY_MODE=lan-https-token`.

Use `GET /health/live` for process liveness and `GET /health/ready` for sanitized
PostgreSQL plus artifact-storage readiness. SIGINT/SIGTERM stop the listener and
drain the database pool idempotently. Deployment templates live under
`deployments/server`; operations and compatibility policy live under
`docs/operations`.

## Hugging Face token configuration

- Managed OIDC deployments store one Hugging Face credential per organization
  under the server-owned provider-credential directory. Status is masked, raw
  values remain below the application boundary, and credential read/write
  routes require an owner, administrator, or operator.
- `HF_TOKEN` and `HUGGING_FACE_TOKEN` are deployment-local compatibility inputs.
  A managed deployment will not assign either value to every organization.
  Set `HF_TOKEN_ORGANIZATION_ID` to perform an explicit one-time assignment, or
  use dedicated tenant placement, whose sole organization is an explicit
  assignment target. The legacy token file is removed only after the
  organization credential write succeeds.
- Disabled-development and other deployment-local modes retain a single
  host-owned credential. Thin-client private/gated repository workflows still
  consume the credential only through the server application boundary.

## Privileged settings and repository creation

- Managed setting mutations require an authenticated organization role. Owners,
  administrators, and operators may change ordinary shared settings; changing
  the shared model folder or PyTorch/CUDA wheel index is administrator-only.
- PyTorch wheel indexes must be credential-free HTTPS URLs on
  `download.pytorch.org` under a supported `/whl/...` channel. Arbitrary package
  hosts, ports, query strings, and fragments are rejected before persistence.
- Publishing does not create a missing Hugging Face repository implicitly. The
  request must explicitly approve creation and choose `private` or `public`;
  the UI defaults that choice to private. Managed creation also requires the
  `provider-repository:create` capability and records the allow/deny decision.

## Local runtime state

- `SERVER_STORAGE_ROOT` overrides server artifact storage.
- `SERVER_RUNTIME_ROOT` overrides server-owned runtime state for ComfyUI, Python worker caches, and managed runtime dependencies.
- Without overrides, server runtime state lives under `apps/server/.local/server-runtime`, which keeps dev runtime installs out of the source tree and separate from artifact storage.
- The managed Python worker is loopback-only. `PYTHON_RUNTIME_BASE_URL`,
  `PYTHON_RUNTIME_HOST`, and `PYTHON_RUNTIME_PORT` may select only a consistent
  `http://127.0.0.1:<non-privileged-port>` endpoint; wildcard, LAN, public,
  credentialed, HTTPS, and path-bearing values fail startup.
- Server composition generates and rotates the worker bearer credential for
  every spawn. Operators must not set, persist, or expose
  `PYTHON_RUNTIME_AUTH_TOKEN`; it is child-only launch state.
- The packaged Python worker owns the exact Context dependency declaration in
  `requirements-context.txt`. Normal managed-runtime setup installs it, and an
  explicit RAG create or query request performs the same asynchronous,
  one-flight check before starting work.
- Context dependency installation runs outside the server event loop and
  reports fixed, sanitized task progress such as local vector-database
  installation. Passive task and runtime status reads never install packages.

## Security modes and HTTPS startup

### `disabled-dev` (insecure local development)

```bash
AI_SYSTEM_BUILDER_SECURITY_MODE=disabled-dev npm run dev:server
```

- HTTP is allowed.
- Authentication is not required for protected APIs.
- Startup logs include a loud insecure warning once at startup.
- Use this only on a trusted local machine; it is not safe for LAN/shared networks.

### `lan-https-token` (LAN pairing + bearer token)

Required environment variables:

```bash
AI_SYSTEM_BUILDER_SECURITY_MODE=lan-https-token
AI_SYSTEM_BUILDER_TLS_CERT_MODE=auto-self-signed
SERVER_TOKEN_HASH_SECRET=<strong-random-secret>
```

Optional root overrides often used in local setups:

```bash
SERVER_STORAGE_ROOT=/path/to/server-artifacts
SERVER_RUNTIME_ROOT=/path/to/server-runtime
```

Behavior:

- HTTPS is required and there is no silent fallback to HTTP.
- Certificate/key files must be readable before startup completes.
- Protected APIs require a valid bearer token from LAN pairing.

### Certificate options

- `manual` mode: user-supplied certificate/private key PEM files via `AI_SYSTEM_BUILDER_TLS_CERT_PATH` and `AI_SYSTEM_BUILDER_TLS_KEY_PATH`.
- `auto-self-signed` mode: server generates/reuses a dev certificate/key in the server security store (or `AI_SYSTEM_BUILDER_TLS_CERT_DIRECTORY`).

`auto-local-ca` mode generates/reuses a local development CA plus server certificate for local/dev/LAN testing. Trust installation is manual. Self-signed certs enable HTTPS transport but browsers/devices may still require a trust exception or manual trust step.

Not implemented in this phase: automatic ACME/web-CA certificate provisioning, external reverse-proxy TLS termination mode, mTLS, OAuth, or production public-internet hardening.

## Manual mkcert workflow (no runtime dependency)

Example:

```bash
mkcert -install
mkcert localhost 127.0.0.1 ::1 <your-lan-hostname> <your-lan-ip>
```

Then run server with generated files:

```bash
AI_SYSTEM_BUILDER_SECURITY_MODE=lan-https-token \
AI_SYSTEM_BUILDER_TLS_CERT_PATH=./certs/localhost+lan.pem \
AI_SYSTEM_BUILDER_TLS_KEY_PATH=./certs/localhost+lan-key.pem \
SERVER_TOKEN_HASH_SECRET=<strong-random-secret> \
npm run dev:server
```

If you generate certs inside this repo, keep them out of git (for example under an ignored `certs/` directory).

### Dev HTTPS in `disabled-dev` (restart required)

Default `npm run dev:server` starts in `disabled-dev` with HTTP and no auth.

To run HTTPS while staying in `disabled-dev`:

```bash
AI_SYSTEM_BUILDER_SECURITY_MODE=disabled-dev
AI_SYSTEM_BUILDER_HTTPS_ENABLED=true
AI_SYSTEM_BUILDER_TLS_CERT_MODE=auto-self-signed
AI_SYSTEM_BUILDER_DEV_SECURITY_TOGGLE_ENABLED=true
npm run dev:server
```

- Listener protocol (HTTP/HTTPS) is selected at startup and requires restart to change.
- Dev security enforcement dropdown only appears when `AI_SYSTEM_BUILDER_DEV_SECURITY_TOGGLE_ENABLED=true`.
- Dev enforcement toggles auth behavior only (`disabled-dev` vs `lan-token-enforced`), not transport mode.

## Token handling and storage

- Pairing tokens are bearer secrets; do not share them.
- Server persists token hashes only in the server security store.
- Thin-client stores the bearer token through `pairedDeviceTokenStore`.
- Current thin-client browser persistence uses localStorage for initial LAN workflow; treat this as a convenience model, not hostile-browser hardened storage.
- Clearing client token forgets local pairing for that device.

## Manual smoke checklist

Detailed checklist: `docs/security/manual-smoke-test.md`.

### `SERVER_TOKEN_HASH_SECRET`

- Used to derive stable token hashes for credential lookup; this value is sensitive.
- In `lan-https-token` mode it is required at startup.
- In `disabled-dev` mode, if unset, the server falls back to an explicitly insecure dev-only default and logs a warning.
- Never commit this value and never log it.

Generate examples:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

```powershell
$bytes = New-Object byte[] 32; [Security.Cryptography.RandomNumberGenerator]::Fill($bytes); [Convert]::ToHexString($bytes)
```

- Do not put it in docs, logs, screenshots, or shell history where avoidable.
- Prefer a secret manager or user-level environment variable for routine local use.

## Dev security enforcement toggle (development only)

- Startup security mode (`AI_SYSTEM_BUILDER_SECURITY_MODE`) still owns HTTP/HTTPS listener protocol and requires restart to change.
- Optional dev-only toggle: `AI_SYSTEM_BUILDER_DEV_SECURITY_TOGGLE_ENABLED=true` (only active when startup mode is `disabled-dev`).
- This toggle only changes request-time auth enforcement (`disabled-dev` vs `lan-token-enforced`) for local testing.
- It does **not** switch a running listener between HTTP and HTTPS.
- Do not use this toggle as production security.

- Never commit generated private keys or token hash secrets; do not print secret values in logs.

No automatic trust-store installation is performed. Trust installation is manual; browser/mobile trust limitations apply. Do not commit private keys or SERVER_TOKEN_HASH_SECRET.
