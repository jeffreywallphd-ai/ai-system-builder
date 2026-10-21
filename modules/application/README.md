> AI documentation reminder: when behavior in this area changes, update the related ADRs, architecture docs, context packs, and README files in the same change.


Asset definition reads support a bounded ordered batch (at most 250 references).
The local repository reads one collection and preserves exact version/current
selection; workspace reads apply the same active-pack membership restrictions
to each detail. Malformed instance/composition reference shapes are rejected
before context lookups. Read-only repository use cases still return stored
records without revalidating their content.

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
The shared passive structural bounds now apply before definition projection;
malformed/accessor-bearing records fail with a static read error. This is read
classification, not package admission or general proof of trusted provenance.
Seeder/installer marker-only already-current shortcuts, complete package integrity
migration and native qualification remain separate pending work. Rollback retains
the stronger denial of forged authority cues.
