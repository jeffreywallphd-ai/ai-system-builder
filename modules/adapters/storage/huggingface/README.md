# Hugging Face artifact-repo storage adapter

This module contains the first concrete artifact-repo storage provider adapter.

## Scope in this slice

- Implements `ArtifactRepoStoragePort` for `provider = "huggingface"`.
- Keeps provider-specific auth, path/repository validation, and provider status mapping inside the adapter boundary.
- Supports:
  - `hasArtifactInRepo` via official Hub client `fileExists`,
  - `storeArtifactInRepo` via official Hub client `uploadFile`,
  - `retrieveArtifactFromRepo` via official Hub client `downloadFile`.

## Configuration

- Token resolution order:
  1. `accessToken` option passed at composition boundary,
  2. `HF_TOKEN` environment variable,
  3. `HUGGING_FACE_TOKEN` environment variable.
- `storeArtifactInRepo` requires a token and fails with deterministic `unavailable` auth-required error when missing.
- `hasArtifactInRepo` and `retrieveArtifactFromRepo` attempt unauthenticated access first (public repos may work without a token).
- If Hugging Face returns `401`/`403`, adapter errors remain explicit and are not collapsed into `not-found`:
  - missing token: auth-required with guidance to configure host/server token,
  - token present but invalid/insufficient or private/gated repo denied: explicit auth/access-denied message.
- Repository prefix handling:
  - `datasets/<namespace>/<repo>` => dataset repo type,
  - `models/<namespace>/<repo>` => model repo type,
  - no prefix => adapter default repo type (`dataset`).

## Notes

- The adapter uses only the official `@huggingface/hub` client path.
- No handcrafted HTTP fallback path exists in this adapter.
- This is intentionally a small provider slice, not full provider lifecycle management.
- Tests are mock-driven and deterministic (no live network dependency).


## Runtime token source

- Adapter now supports `accessTokenProvider` for host-managed token config, allowing token updates without rebuilding adapter wiring.
- Fallback precedence remains: explicit `accessToken` option, then `HF_TOKEN`, then `HUGGING_FACE_TOKEN` when no provider is supplied.
