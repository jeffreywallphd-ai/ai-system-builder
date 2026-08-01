# Shared Data Management UI

> AI documentation reminder: when behavior in this area changes, update the related ADRs, architecture docs, context packs, and README files in the same change.

`GuidedIngestionTaskPanel` presents the shared three-step Add data workflow for
desktop and thin client: choose Files, Website pages, or Hugging Face dataset;
select the bounded source; then add it. Safe limits are automatic and technical
scope controls remain under Advanced settings.

The source and scope choices use the shared primary choice controls, and local
file selection uses the shared styled multi-file input and confirms the
selected file names before import. Hugging Face Step 2 includes
a token-only settings card backed by the same persisted Hugging Face setting
used elsewhere; public datasets do not require a token, while private or gated
datasets may. Selection asks for a user or organization, lists bounded
datasets, and then lists importable files with checkboxes. The provider browser
returns the immutable revision for every file; the guided task imports only
checked files and records those exact revisions without asking users to type
repository paths or commit identifiers. Desktop and thin client mount only this
guided workflow; the retired Other import tools are not part of the page.

Desktop functional UI coverage follows all three sources through Data
Management into Artifact Browser detail: two selected local files, two website
pages, and one checked file from a representative public Hugging Face dataset.
The website and provider boundaries use deterministic host fixtures so the
suite remains CI-safe and does not scrape live sites or depend on provider
availability.

Artifact Browser presents uploaded and generated artifacts with the same card
layout. JSON and JSON Lines use a formatted preview capped at 100 lines;
Markdown is converted to inert React elements without raw HTML, scriptable URL
schemes, or remote image loading; Parquet shows at most its first 10 rows
through the workspace-scoped review reader; and PDF shows a bounded raster of
its first page rather than active embedded PDF content. Internal system-build
artifacts stay in storage for traceability and do not appear in registered or
unregistered browser lists. Artifact names and media types ending in `+json`
are likewise internal; only ordinary `.json` and `.jsonl` JSON-family files
and the equivalent `.ndjson` line format appear in the browser.

The renderer slices local files into 1 MiB chunks and never builds a whole-file
buffer. Inputs are locked while a task runs. Persisted host progress feeds the
inline status and notification-center activity; users can leave the page,
cancel, or retry a retryable task. Public errors are bounded and redact paths,
credentials, cookies, and tokens.

After an acquisition succeeds, the shared workflow clears all source-specific
form selections, returns to the default Files source, opens the completed task
in the global notification dropdown, and scrolls the page viewport to the top.
Failed and cancelled attempts keep their form state so the user can correct or
retry them. The reset does not clear the host-owned Hugging Face credential.

Dataset preparation uses the same four ordered steps in desktop and thin
client. Shared presenter copy translates the contract-owned adaptive plan into
plain-language input intents, methods, tasks, inspected surfaces, and honest
limitations. Hosts must not recreate method compatibility or descriptions.
They show a method selector only when more than one meaningful option exists,
and Advanced settings contain only controls used by the selected method.
Desktop keeps saved workflow settings in an unnumbered section before Step 1,
omits Task settings when the selected task has no additional choices, and
places the optional dataset save name beside the final approval and discard
actions in Review and create. One explicit approval saves the complete curated
ready set. After success, both hosts switch to Artifact Browser, select the
exact saved dataset, and open its detail view. Dataset Preparation does not
render a post-save Saved versions section.

Review and create turns each actionable quality-report line into a link to the
actual ready, set-aside, or reason-matched records behind that count. The
focused modal shows 10 records at a time, keeps its decision controls fixed
while row content scrolls, and records local Approve or Reject decisions. The
aggregate report sections are not the review items.

The same large, fixed-control modal powers Dataset Review. Workspace Parquet
datasets are shown once per logical dataset, their newest version is selected
by default, and older versions remain available from a version selector.
Repository-only files do not appear until they are localized. Review rows opens
the modal; View table opens the 10-row paginated table below the cards. On wide
screens, that table includes Approve, Reject, and Edit
actions in its rightmost column.

Existing dataset rows are already approved, so Approve is locked. Reject verifies
the exact row fingerprint, removes that row, preserves the selected version, and
creates the next immutable minor version. Edit changes the read-only row into a
bounded editor; Approve changes performs the same exact-row verification, writes
the revised Parquet artifact, and creates the next immutable minor version.
Reject remains available while editing so the reviewer can reject the row
instead of saving an edit. Cancel exits without persistence. An original
workspace Parquet artifact is displayed as 1.0; its first immutable rejection or
approved edit is 1.1.

Dataset Preparation presents one selectable artifact list. Its All, Uploaded,
and Generated filter controls that list; generated or runtime-produced results
are mutually exclusive from Uploaded even when legacy metadata or a path looks
upload-like.

Text tasks accept CSV, JSON, JSON Lines, Parquet, TXT, Markdown, HTML, PDF, and
DOCX sources when the original filename extension or media type identifies the
format. JSON may be one object, an array of objects, or an object whose
`rows`, `data`, `items`, `examples`, or `annotations` property contains the
records. JSON Lines accepts one object per nonempty line. Fields must still
match the selected training task. The UI directs users to convert legacy DOC to
DOCX and Excel XLS/XLSX to CSV. TSV, RTF, and ODT are not currently accepted.

The explicit model-download control appears in the main body of Step 3, outside
Advanced settings. Starting it opens the global notification dropdown so
authoritative progress is visible while the user stays on the page or navigates
elsewhere. The activity remains owned by the shared model-download task; the page
must not publish a duplicate queued or progress message. A transient transfer or
late snapshot-validation failure is retried and retains the bounded partial cache
for a later resume. Running preparation only validates the local snapshot and never
starts or resumes a download. An incomplete snapshot clears the stale ready
selection and directs the user to resume the explicit Step 3 download.

Accepted dataset-preparation work also opens the global notification dropdown.
An app-shell bridge continues reading the workspace-scoped task after the page
unmounts, showing bounded section progress and a truthful terminal or
review-required outcome. Inline validation and corrective guidance remain on
the preparation page. Before any section completes, the notification explicitly
shows that the selected model and first batch are loading; subsequent updates
show completed sections. Topic-aware preparation groups small low-overlap
sentences into bounded semantic sections instead of creating one model request
per sentence.

Built-in generation model selection is capacity-aware without exposing hardware
identity. Desktop considers both total and currently available system memory: an
untouched Quality (7B) selection steps down to Compact (3B), or to Lightweight
(1.5B) when current memory pressure makes 3B unsafe. A user-selected or saved model
is never replaced automatically; known oversized choices are stopped before task
start, and every choice receives the worker's live-memory preflight. Resource
guidance never recommends the preset that is already selected. Desktop generation
defaults to allowing at most 1 GB of system-managed disk/swap overflow. Advanced
settings can require memory-only loading or explicitly allow at most 4 GB. When
the worker actually needs an allowed overflow, authoritative task progress opens
a warning notification explaining that the model is using disk/swap and may run
more slowly.

The structured-JSON checkbox is enabled only after authoritative runtime
capability confirms that the decoder is ready for the selected generation
shape. Desktop startup prefers an installed decoder-compatible Python version
when no operator command is configured. Desktop and thin client keep the
control disabled when capability is unavailable, so a saved or stale checked
preference cannot send a known-unsupported constrained request.
