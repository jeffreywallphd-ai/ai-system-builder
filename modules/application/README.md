> AI documentation reminder: when behavior in this area changes, update the related ADRs, architecture docs, context packs, and README files in the same change.


Asset definition reads support a bounded ordered batch (at most 250 references).
The local repository reads one collection and preserves exact version/current
selection; workspace reads apply the same active-pack membership restrictions
to each detail. Malformed instance/composition reference shapes are rejected
before context lookups. Read-only repository use cases still return stored
records without revalidating their content.

Resumable local-file ingestion uses a private reservation and exclusive verified
byte writer, one acknowledged origin-issued metadata attempt and atomic
task/snapshot/receipt commit. Recovery verifies existing exact origin without
recreating missing or deleted metadata.
Dataset staging resolves omitted metadata with the exact workspace/catalog key;
foreign metadata and missing origin remain blocking. Uncertain writing never
becomes an overwrite, adoption or deletion permission.

Runtime task ownership and cleanup remain in application services/use cases.
Host reconciliation calls only accepted task callbacks; public reads still
authorize resources. Image completion keeps per-output session receipts through
partial retry, validates unchanged completion evidence and uses scoped asset IDs.
Training copies authorized artifact bindings into private bounded staging rather
than passing caller paths or storage keys to a worker. Standalone publishing is
explicitly unavailable before task dispatch.

Runtime readiness validation rechecks scoped composition authority and the exact
plan version before progression. Fresh blockers remain authoritative; derived
provider failures are recomputed and deduplicated. Invalid or unselected bindings
are never silently promoted by an available provider. Missing authority or
substituted binding identity fails before save; no runtime execution is implied.

Semantic Asset Pack explanatory fields retain non-goal prose such as descriptions
of resource bytes, prompt text or runtime execution. This allowance never admits
actual private-key blocks or established credential-prefix representations.
Validation and JSON parse checks reject those strings with static diagnostics;
serialization/normalization rejects before returning a document containing them.
The shared content predicate is pure admission logic, separate from lossy display
sanitization. This is syntax hardening, not proof that arbitrary prose contains
no sensitive data. Existing schema, trust and metadata controls still apply.
Legacy semantic fingerprints and their exclusions remain unchanged; complete
content integrity/version migration remains a separate unresolved qualification
and compatibility boundary. No provider, model or runtime execution is added.

Actual credential checks apply to property names as well as string values.
Credential-bearing names are denied before descent/copy and never become public
diagnostic paths; issues refer to the safe parent. Direct serialization also
rejects those names before creating a document.

Resource-backed model views project declared model summaries only. Internal run
correlation and arbitrary source metadata are omitted from view/backing data;
see `docs/architecture/asset-kernel.md`.

Built-in definition read classification compares complete bounded, descriptor-safe
content against the code-owned legacy catalog and exact immutable Foundation
1/2/3 releases before display sanitization. Only raw content and precisely
reconstructed seeder/installer enrichment match; only declared operational
timestamps may vary. ID/version or editable marker/fingerprint claims alone
confer no badge. Unknown enrichment and changed schema, AI context, provenance or
metadata cannot earn built-in/system/trusted status. List/filter/single/batch
reads use the same classification, and projected metadata removes editable
positive cues before downstream UI fallbacks. Ordinary custom-source descriptors
and nonpositive trust states remain visible. Reads never seed, install or write.
Each list/single/batch path makes one complete bounded passive copy and classifies
that owned body through a private full-content matcher before projection. The
standalone classification API uses the same safe admission; there is no unchecked
classification entry point or editable-record cache. Invalid authority timestamps
on otherwise passive custom content withhold badges without denying the read.
Malformed/accessor-bearing records fail with a static read error. This is read
classification, not package admission or general proof of trusted provenance.
Seeder/installer reuse independently captures the complete stored body and checks
it against exact source content plus permitted operational enrichment before an
already-current result. Complete package integrity migration and native
qualification remain separate pending work. Rollback retains the stronger denial
of forged authority cues.

File/provider ingestion task finalization preserves artifacts across uncertain
metadata acknowledgements. Only exact scoped task/file/output and immutable
snapshot readback can reconcile a committed result; missing, conflicting or
unavailable facts retain failure without destructive compensation. Completed
upload retries verify digest/snapshot consistency and return succeeded state
without rewriting it or repeating checkpoint effects. See the canonical
data-management architecture and threat model for tests and remaining provider,
native publication and controlled-workflow qualification. No retry creates a missing storage
binding or adopts legacy data.

Legacy authoring mutations require `WorkspaceAssetAccessPort` before repository,
target, clock or ID effects. Public legacy list/detail methods use the eight-method
`createWorkspaceAssetAuthoringReaders` facade, which exposes no write or unscoped
by-ID method. Both paths retain existing safe-field and provenance semantics.


Read-policy and repository failures settle as fixed unavailable API/IPC responses.
Missing required fields retain validation failures. Focused tests cover every
public read, query capture and current persisted membership. No request may
fall back to raw repositories after access is denied.

Package lifecycle entry points require current workspace asset access: read for lists and write for inspection, admission and activation changes. Fixed commands and consent are owned before authorization waits; bounded upload copies use the existing production32MiB default. Direct inspector configured limits remain independent. Inspection remains inert and does not authorize admission, activation or execution.

Studio application entry points require the existing current-workspace read/write policy. Ten object requests own their consumed fields before asynchronous admission and protected effects. Canonical request, proposal, semantic and resource limits remain in force; metadata and semantic JSON serialization do not gain a new preallocation guarantee. Exact approval, revision and sequential publication semantics remain unchanged.

Derived customization workflow and target-catalog entry points use current workspace authority and own their requests before awaits. Semantic patch validation alone retains some nested values; request capture deep-copies the validated result. Shared readiness wrappers and the direct workflow/catalog retain independent admission. Exact base, source, review, revision and sequential publication semantics remain.
