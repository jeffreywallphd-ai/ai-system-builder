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
places save and publication guidance directly in Review and create.

Text tasks accept CSV, JSON, JSON Lines, Parquet, TXT, Markdown, HTML, PDF, and
DOCX sources when the original filename extension or media type identifies the
format. JSON may be one object, an array of objects, or an object whose
`rows`, `data`, `items`, `examples`, or `annotations` property contains the
records. JSON Lines accepts one object per nonempty line. Fields must still
match the selected training task. The UI directs users to convert legacy DOC to
DOCX and Excel XLS/XLSX to CSV. TSV, RTF, and ODT are not currently accepted.

Starting a model download from Dataset Preparation opens the global
notification dropdown so authoritative download progress is visible while the
user stays on the page or navigates elsewhere. The activity remains owned by
the shared model-download task; the page must not publish a duplicate queued or
progress message.
