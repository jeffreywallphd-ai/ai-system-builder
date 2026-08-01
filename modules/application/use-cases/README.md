# Application Use Cases

> AI documentation reminder: when behavior in this area changes, update the related ADRs, architecture docs, context packs, and README files in the same change.

Use cases in this folder own application orchestration and remain adapter-agnostic.

- Governed ingestion task use cases
  - persist workspace-scoped progress before reporting it to clients;
  - accept idempotent bounded file chunks and finalize through an async stream;
  - retain retryable checkpoints for 24 hours, then expose bounded stale-task cleanup;
  - register Hugging Face files only at immutable commit revisions and retain
    completed items when a later provider item must be retried;
  - carry the authoritative task workspace into both the imported artifact
    catalog record and its source backing before reporting provider success,
    and infer the Parquet media type from a selected `.parquet` path when the
    provider listing omits it.
  - resolve bounded page or sitemap scope through secure egress, preserve raw
    website captures separately from derived readable text, and append honest
    source refresh outcomes from validators and content digests;
  - commit task/source lineage atomically and compensate uncommitted artifacts
    when cancellation or another optimistic update wins.

- `StoreArtifactUploadUseCase`
  - validates upload input at a basic, honest level,
  - delegates artifact persistence to `ArtifactStoragePort`,
  - emits structured start/success/failure events through `LoggingPort`,
  - returns a narrow descriptor-based result aligned to upload contracts.

- `LocalizeArtifactFromRepoUseCase`
  - requires authoritative workspace context and carries it through binding
    reads, provider retrieval, local object/catalog storage, and binding
    updates;
  - retains the provider path as original-file metadata so localized Parquet
    and other typed files keep their correct name and artifact family;
  - fails closed before provider or storage work when workspace scope is
    missing.

- `PrepareTrainingDatasetFromArtifactsUseCase`
  - validates bounded source selection, task, split, and output settings before
    staging;
  - validates optional advanced content, semantic, and synthetic settings,
    denies unavailable capabilities, and requires quality review for generated
    candidates;
  - resolves workspace-scoped local bindings and explicitly localizes supported
    remote repository sources;
  - owns asynchronous task start/read/cancel orchestration and enforces recorded
    workspace plus optional organization ownership;
  - validates and materializes role-tagged aggregate/train/validation/test
    outputs through storage/provider ports without exposing runtime paths.
  - returns bounded advanced readiness and aggregate review evidence without
    exposing source text, embeddings, prompts, or generated candidate text;
  - reads separately contained accepted or quarantined records only through
    fixed 10-row, scope- and report-fingerprint-bound pages, with byte, line,
    field, depth, and display-value limits and no runtime-path disclosure;
  - resolves requested quality presets through a host-owned policy provider and
    fails closed when policy authority is unavailable;
  - validates bounded quality reports and reversible quarantine evidence,
    withholds final dataset outputs while review is pending, and materializes
    them only after a one-time scope- and exact-fingerprint-bound approval;
  - compensates partial materialization and cleans report, quarantine, and
    contained runtime outputs on discard or cancellation.
  - when dataset-version composition is available, retains exact source
    digests, writes and verifies complete local outputs plus an immutable recipe
    snapshot, inserts the version record last, returns its stable identity, and
    compensates dataset/split artifacts if finalization fails.
  - stores the exact optional advanced recipe in that immutable snapshot so
    reproduction can restore the selected preparation style without silently
    substituting a currently unavailable capability.

- Dataset-version read use cases
  - authorize the exact workspace before listing, comparing, or reproducing;
  - compare two versions of the same dataset using bounded source, row,
    artifact-role, recipe, policy, and documentation changes;
  - retrieve the bounded immutable recipe artifact, verify its exact digest,
    and return the saved setup plus stable source artifact ids without exposing
    source rows.

- Dataset-review use cases
  - list only locally readable workspace Parquet artifacts and locally readable
    immutable version outputs; repository-only or stale catalog records remain
    unavailable until localization restores workspace-owned bytes;
  - read bounded row pages without placing row values in structured persistence
    and bind rejection or editing to the exact version, artifact key, row index,
    and returned row fingerprint;
  - preserve the parent artifact, create an imported 1.0 baseline when needed,
    and make each approved edit a new immutable minor version; replacement row
    content stays out of version records.

- `PublishDatasetVersionUseCase`
  - authorizes the exact workspace operation and relevant provider scopes;
  - defaults to Private, requires destination confirmation, and requires a
    separate confirmation before Public publication;
  - verifies every immutable local artifact before one bounded provider commit;
  - records append-only success evidence only after an immutable provider
    revision is returned, leaving the local version intact on every failure.
