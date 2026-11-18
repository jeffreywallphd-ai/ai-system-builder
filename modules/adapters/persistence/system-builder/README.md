# Saved System Builder and Headless plan persistence

Private Context rebuild lineage uses the committed saved-resource index, accepted
task point/plan indexes and exact historical proposal input digest. Historical
definitions and model witnesses are data only; no original approval or task
authority is revived. Current resource authorization remains the host's duty.
No history enumeration, row rewrite or unindexed adoption is provided.

> AI documentation reminder: when behavior in this area changes, update the related ADRs, architecture docs, context packs, and README files in the same change.

Headless plans use the platform transaction owner and exact organization
partitions. Application policy, current approval and saved-source witnesses
must be checked within the same transaction as a reserved or issued effect.
Runtime and source-byte work stays outside retriable transactions.

Context-pack task records use a separate namespace from Data tasks and ordinary
Context work. Reserved, issued and accepted phases have fixed revisions and
exact host, workspace, actor, client, plan, step and input/source digests. Point
indexes are checked together. Unconfirmed attempts cannot be adopted or reset
to obtain another start. Outcome recording can retain an already admitted
acceptance after caller access ends; receipt publication still requires current
authority. The bounded history grants no host-exit recovery or parent pass.

New RAG plans keep one private selected-model witness per RAG step in version-2
review records. Submission requires the trusted metadata-only binding callback.
Approval, revocation and later decisions retain those exact bindings. Public
snapshots include only the preview and decision state. Older version-1 pack,
Data and system records keep their schema and fingerprint; an unbound RAG record
is refused. New starts validate the approved witness before lazy runtime work,
then compare again at reservation and issue. Accepted receipt replay remains
independent of later model metadata changes and never starts processing again.

`createStructuredHeadlessContextResultStore` is a separate private result-save
ledger. It binds an accepted task/source digest and exact review/output, issues
at most one save per task/client and records catalog, primary binding and causal
receipt in the supplied root-owned transaction. Insert-only metadata refuses
ordinary records and tombstones. Unknown reservation/issue/commit cannot become
fresh byte authority. Exact committed receipt reads also verify the matching
catalog and primary binding; they perform no output, source or model IO.

The caller must enforce current exact save approval/policy in that same owning
transaction. The shared composition provides this required callback and a
before-commit guard, with one read-only reconciliation after lost commit reply.
The private helper alone does not advertise a public save action, borrow a
generation approval or qualify native restart/physical RAG behavior.

New result-save records use version 2 and atomically add an opaque saved-Context
point index alongside catalog, primary binding and causal receipt. Reading that
index verifies the exact committed owner, receipt, catalog and binding before
projecting finite metadata. It neither enumerates files nor adopts old records.
Version-1 private receipts remain internally replayable without gaining a public
index. Current workspace read permission remains the caller's obligation;
original task/client ownership grants no authority to a new reader.

The Context task ledger also accepts one closed version-2 terminal `not-started`
variant from a freshly reserved trusted owning call. It binds the same task,
source digest and exact owner; its recorded previous phase fixes revision2 or3.
Version-1 reserved/issued/accepted history stays unchanged. Replay preserves the
terminal non-start without another dispatch. It never becomes an accepted task
or a source witness for saving. Do not infer the outcome from interrupted history.
