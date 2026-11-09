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

- A configured `accessTokenProvider` is read first. If it is absent or returns
  `undefined` or `null`, fallback token resolution follows this order:
  1. `accessToken` option passed at composition boundary,
  2. `HF_TOKEN` environment variable,
  3. `HUGGING_FACE_TOKEN` environment variable.
- `storeArtifactInRepo` requires a token and fails with deterministic `unavailable` auth-required error when missing.
- `hasArtifactInRepo` and `retrieveArtifactFromRepo` use the configured token when one is available. Without a token, they attempt public access; they do not perform an anonymous-first retry.
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
  client through a bundler-visible lazy import. Desktop packages contain that
  client and must not resolve it from the checkout after installation.
  Retrieval deliberately uses the shared secure-egress broker so DNS,
  redirects, authorization forwarding, content type, streamed bytes, deadline,
  and concurrency are controlled before localization.
- The brokered retrieval path is the only download path; there is no unbounded
  `arrayBuffer` fallback.
- Dataset-file browsing keeps converted-first selection. Only an actual missing
  converted ref or a completely consumed valid listing with no Parquet files
  permits original Parquet on the same repository's `main` ref. Each selected
  ref resolves to a full 40- or 64-character commit before the installed official
  Hub client lists its files. Existing descriptor and localization contracts stay
  unchanged; browsing does not download data or require automatic conversion for
  a repository that already contains Parquet.
- A private metadata session supplies the client fetch function. It pins HTTPS
  origin, repository and immutable tree path, rejects redirects and response-URL
  substitution, and validates/rebuilds next links before credential use. Ambiguous
  or repeated pages, unsafe paths, auth errors, malformed data, incomplete
  listings and timeouts cannot authorize fallback or an accepted prefix.
- One token and one 15-second monotonic deadline cover token/SDK waits and both
  sources. Bounds are 4 KiB per revision, 64 KiB and 100 entries per tree page,
  4 MiB total metadata, 64 pages and 66 requests, with finite chunk, inspected-entry
  and result-file limits. Abort/late-response guards stop further requests and
  fixed errors exclude raw provider/token/SDK details. These cooperative metadata
  limits do not supply a hard process-memory or native I/O guarantee.
- Mutable branch names and malformed revision responses are not accepted as
  provider-ingestion evidence. The legacy converted-Parquet logical URL remains
  readable only for older callers; new browse results use exact repository paths
  and commit revisions.
- This is intentionally a small provider slice, not full provider lifecycle management.
- Tests are deterministic and have no live network dependency. The metadata
  suite also runs the installed official client's real pagination against a
  bounded synthetic fetch, with global network access disabled in the fixture.
- Fail-closed tests cover absent approval, managed denial, private creation, and
  the provider already-exists retry path, plus oversized and disallowed-type
  localization responses.


## Runtime token source

- Adapter supports synchronous or asynchronous `accessTokenProvider` functions
  for host-managed token config, resolving the value once per operation so a
  managed host can enforce organization context and authorization without
  rebuilding adapter wiring.
- Fallback precedence remains: explicit `accessToken` option, then `HF_TOKEN`, then
  `HUGGING_FACE_TOKEN` when no provider is supplied or it returns `undefined` or
  `null`. A provider error propagates; it does not trigger fallback.

## Dataset publication visibility

Dataset publication keeps the application-owned workspace, credential-use,
repository-creation and explicit visibility confirmations. Private is the
application default. A destination selection never changes repository visibility.

Before a commit, the adapter reads only the exact dataset repository's `private`
metadata field. It requires a Boolean that matches the confirmed destination.
The request refuses redirects. A redirected response or a supplied final URL
that differs from the exact requested URL cannot provide visibility evidence.
The read has a 4 KiB stream limit and a 15-second deadline, cancels failed bodies,
and returns fixed safe errors. An unknown or mismatched value cannot reach the
commit. Missing repositories still require explicit creation approval and the
host's creation authorizer. A creation conflict is not proof of privacy: the
adapter reads the actual repository again before committing.

The adapter verifies visibility again after the immutable commit is returned.
If that read fails or visibility has changed, publication remains unconfirmed;
the application retains the local version and must not record success. There is
no automatic visibility change, deletion or hidden second commit to repair an
uncertain result. Browsing, artifact storage and secure-broker downloads preserve
their existing independent contracts.

These checks do not make provider policy atomic with Git commits. A provider
owner can change visibility during or after a request. Production use still
requires appropriate provider-side access policy; an uncertain remote write is
not proof of rollback. Reverting this guard must disable publication rather than
restore publication without verified destination visibility.

The source-owned tests cover matching private/public destinations, no-approval
and denied creation, a public creation race, malformed/unavailable/non-Boolean
metadata, streaming bounds, actual timeout/abort, safe failures and post-commit
ambiguity. The contributor operator permits only the additional fixed
`?expand=private` metadata query. It cannot authorize a new repository, credential
or external operation. See the [Data Management threat model](../../../../docs/security/data-management-threat-model.md)
and [private provider operator](../../../../dev-tools/scripts/private-provider-qualification/README.md).
