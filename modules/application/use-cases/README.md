# Application Use Cases

> AI documentation reminder: when behavior in this area changes, update the related ADRs, architecture docs, context packs, and README files in the same change.

Use cases in this folder own application orchestration and remain adapter-agnostic.

- `StoreArtifactUploadUseCase`
  - validates upload input at a basic, honest level,
  - delegates artifact persistence to `ArtifactStoragePort`,
  - emits structured start/success/failure events through `LoggingPort`,
  - returns a narrow descriptor-based result aligned to upload contracts.

- `PrepareTrainingDatasetFromArtifactsUseCase`
  - validates bounded source selection, task, split, and output settings before
    staging;
  - resolves workspace-scoped local bindings and explicitly localizes supported
    remote repository sources;
  - owns asynchronous task start/read/cancel orchestration and enforces recorded
    workspace plus optional organization ownership;
  - validates and materializes role-tagged aggregate/train/validation/test
    outputs through storage/provider ports without exposing runtime paths.
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

- Dataset-version read use cases
  - authorize the exact workspace before listing, comparing, or reproducing;
  - compare two versions of the same dataset using bounded source, row,
    artifact-role, recipe, policy, and documentation changes;
  - retrieve the bounded immutable recipe artifact, verify its exact digest,
    and return the saved setup plus stable source artifact ids without exposing
    source rows.

- `PublishDatasetVersionUseCase`
  - authorizes the exact workspace operation and relevant provider scopes;
  - defaults to Private, requires destination confirmation, and requires a
    separate confirmation before Public publication;
  - verifies every immutable local artifact before one bounded provider commit;
  - records append-only success evidence only after an immutable provider
    revision is returned, leaving the local version intact on every failure.
