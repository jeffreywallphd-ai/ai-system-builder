# Saved System Builder and Headless plan persistence

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
