# Hugging Face artifact-repo storage adapter

> AI documentation reminder: when behavior in this area changes, update the related ADRs, architecture docs, context packs, and README files in the same change.

This module contains the first concrete artifact-repo storage provider adapter.

## Scope in this slice

- Implements `ArtifactRepoStoragePort` for `provider = "huggingface"`.
- Keeps provider-specific auth, path/repository validation, and provider status mapping inside the adapter boundary.
- Supports:
  - `hasArtifactInRepo` via official Hub client `fileExists`,
  - `storeArtifactInRepo` via official Hub client `uploadFile`,
  - `retrieveArtifactFromRepo` through the shared secure-egress broker and the
    provider's canonical resolve URL.
  - `publishDatasetVersion` through the official Hub client's one-commit,
    multi-file operation, returning the immutable commit identifier.

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
- A `404` from upload never triggers implicit repository creation. Callers must
  supply `repositoryCreation: { approved: true, visibility }`; when a managed
  authorization callback is configured it must also allow the exact provider
  repository before the create API is called.
- New repositories preserve the explicit visibility choice. Product UI defaults
  to `private`; public creation is a separate explicit selection.
- Dataset-version publication accepts only Private or Public, requires the
  application command's explicit confirmation, limits file count and aggregate
  bytes, rejects unsafe or duplicate repository paths, and never creates a
  missing repository without separate approval and managed authorization.
- A failed or ambiguous commit returns failure and does not create local success
  evidence. Credentials, provider response payloads, and commit URLs are not
  copied into dataset-version records or public diagnostics.
- Model publication also defaults missing repository creation to private when a
  caller omits visibility. Creating a public model repository requires an
  explicit `private: false` request.

## Notes

- Provider existence checks and writes use the official `@huggingface/hub`
  client. Retrieval deliberately uses the shared secure-egress broker so DNS,
  redirects, authorization forwarding, content type, streamed bytes, deadline,
  and concurrency are controlled before localization.
- The brokered retrieval path is the only download path; there is no unbounded
  `arrayBuffer` fallback.
- Dataset browsing reads the Hub's logical Parquet inventory rather than a raw
  recursive repository tree. Returned URLs must remain on the configured Hub
  origin, match the requested dataset, use the converted Parquet revision, and
  stay within the configured file-count limit before any entry is exposed.
- This is intentionally a small provider slice, not full provider lifecycle management.
- Tests are mock-driven and deterministic (no live network dependency).
- Fail-closed tests cover absent approval, managed denial, private creation, and
  the provider already-exists retry path, plus oversized and disallowed-type
  localization responses.


## Runtime token source

- Adapter supports synchronous or asynchronous `accessTokenProvider` functions
  for host-managed token config, resolving the value once per operation so a
  managed host can enforce organization context and authorization without
  rebuilding adapter wiring.
- Fallback precedence remains: explicit `accessToken` option, then `HF_TOKEN`, then `HUGGING_FACE_TOKEN` when no provider is supplied.
