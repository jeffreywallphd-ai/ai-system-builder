# Scanned-PDF app qualification

- Status: implementation in progress; actual host qualification pending
- Verification: fixed OCR profile, separately reviewed native/package/UI run

This procedure checks the software with new synthetic scanned PDFs. It uses the
installed Windows reader and exact `en-US` language. It does not download a reader,
language, model, browser or dependency. Other systems and languages remain untested.

The fixed fixture loads the Python app and modules from the newly packaged worker.
Authentication, task ownership, production dependency preparation, source-file
authorization, hashing, native capture, recognition, curation, review and explicit
approval remain active. Only generation uses known synthetic examples. The normal
product worker has no fixture selector. The default controlled Node test setup is
unchanged.

## Checks

The two real UI journeys must pass with no skips:

- Import the five-page synthetic PDF through Add data.
- Select the declared synthetic CPU and Standard memory settings. In the desktop,
  set When memory is full to Keep everything in memory, including after reload.
  This meets the fixed test worker's admission rule. Product defaults stay intact.
- Turn recognition on with the keyboard. Check the label, help and language focus.
- Find the method and language controls by their exact short captions. Keep their
  changing instructions available as descriptions.
- Check the controls at a 640-pixel viewport with reduced motion. This is a reflow
  check, not a claim that physical browser zoom was tested.
- Refuse an unavailable language without fallback or an approvable dataset.
- Retry with the installed language. Show one PDF, five pages and five lines read.
- Distinguish character hygiene from OCR accuracy.
- Review all five recognized example rows before explicitly approving a dataset.
- Check all five saved JSON Lines rows through the existing authorized reader.
  The desktop uses its Download artifact button in a fresh test-owned directory.
  The browser uses the selected artifact key and current workspace. Both reads
  stop at 65536 bytes. Verify the original source and each original page number.
  Keep the preview's 100-line cap and its truncation notice.
  Desktop downloads pass the active workspace through the existing media reader;
  switching workspaces changes that context. Missing or foreign context stays denied.
- Reopen the saved dataset after a renderer reload.
- Reach a real running task, cancel through the UI and observe its terminal status.
  Match the fixed running message with its optional bounded numeric progress count;
  still observe the running task and use Stop.
  The cancellation fixture waits at most 15 seconds after actual recognition.
  It cannot emit a successful result. Retry normally and discard the ready result.
- Create another workspace and confirm that the original source is absent there.
- Confirm owned worker/host shutdown. The outer native operator also needs actual
  zero active members and acknowledged stream/handle retirement.

The fixture generator accepts only the two fixed `qualification/synthetic-ocr`
identifiers, CPU Standard settings and the known synthetic page text. The second
identifier ends in `-cancel`. It provides no evidence of model accuracy, model
memory use or inference performance. Previously accepted model tests stay closed.

## Evidence and execution

Run portable regressions with the prepared Python environment and installed Node:

```text
python -B dev-tools/helpers/run_focused_checks.py --profile ocr-provider-contract
```

Actual OCR app tests require a fresh selected source candidate, the fixed native
package/UI operator, independent source review and separate execution authority.
Do not use an arbitrary command interface or pretend the default simulated worker
qualifies OCR. See the [native owner guide](../../../helpers/native-qualification/README.md).

The reviewed setup uses `createOcrHostLaunchPlan` and
`startVisualComposerQualification`. It creates the new synthetic PDF through the
fixed fixture-writing role after a run identity exists. The role has no path or
content argument. Its output records the PDF hash, size, page count, installed font
hash and Pillow version. Tests bind that input before import.

Before UI execution, validate the copied OCR source, resource manifest and binary,
and bind all deployed worker files to the selected source. A package exit code
alone is insufficient: the optional build hook preserves Standard startup when
OCR cannot be built. Use the installed offline Electron archive and retain all
existing native limits. Do not install or repair dependencies to hide a failure.

The fixed package inventory comparison preserves every original directory and
every file path, size and SHA-256. The only permitted additions are the literal
directories `resources/worker/ocr/native/build/NVIDIA Corporation` and its
`umdlogs` child. The parent may contain only that child, and the child must be
empty. No file, including a zero-byte file, may occur anywhere in this subtree.
Other directory changes, aliases, malformed entries and cap violations fail with
a fixed error. The pure comparator validates inventory values and their framing;
the unchanged bounded reader remains responsible for physical regular-file,
identity, realpath and reparse checks. Record the before and after full framed
hashes separately and the exact added directories. Permitted empty additions do
not mean the full trees are identical, and do not establish who created them.

Retain bounded package, UI, worker-exchange and shutdown observations, source/tool
hashes and failed attempts. Disable screenshots, traces and video. Never log bearer
tokens, request bodies, recognized text, private paths or raw supplier failures.
The worker logs only selected native status and cleanup facts. On failure it may
write at most 16 exclusive diagnostic files, each at most 4096 bytes. They contain
only a fixed boundary, closed error type/code/stage, its own process ID and a
sequence. They include exceptions raised inside a native exchange. An unavailable
diagnostic never changes the original failure or cancellation into a success.
The real UI records
bounded synthetic counts and results. A failed check remains failed even if
cleanup succeeds. Unknown cleanup prevents a successor run.

These checks support the Data roadmap. They do not close a parent criterion until
the exact full criterion, current source, applicable checks and separate review
are qualified. No human acceptance test is required.

## OCR form accessibility definitions

The existing local OCR journeys audit the initial configured form and the first
ready output-review dialog. Closed context IDs admit the desktop and local thin
client only. A mismatched transport and test project is refused before file or
Page effects. The common audit checks normal and forced-color display at 1440px
and 320px with private-free counts and failure-aware evidence.

After each audit, the OCR journey returns to its original 1280px by 900px viewport
and reduced-motion setting. The original 640px check, unavailable-language retry,
five-row review, source/page lineage, explicit approval, reload, cancellation and
workspace assertions remain. No engine, provider, native/resource guard, timeout
or model-quality requirement changes. The existing end-to-end elapsed field now
also includes these UI observations; it is not an isolated OCR speed measurement.

Portable mock/contract/UI checks and case collection check definitions only.
Actual engine, native, host, zoom, performance and full qualification remain
pending. Accepted model accuracy is not rerun. These audit definitions do not
complete the parent roadmap criterion or original implementation chunk.
