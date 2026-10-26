# ADR-0046: Replaceable Local Document OCR

- Status: accepted
- Date: 2026-10-24
- Deciders: repository owner, by explicit provider selection
- Related: ADR-0002, ADR-0003, ADR-0015, ADR-0040,
  `docs/architecture/data-management.md`,
  `docs/architecture/module-dependency-rules.md`

## Context

The Data roadmap needs optional text recognition for scanned documents. The
owner selected the installed Windows OCR engine and required a replaceable
adapter so a later Tesseract or service implementation can fit without coupling
application logic to Windows. Standard document extraction must remain usable.

## Decision

- Reuse the existing application runtime/task ports. Keep a small provider
  protocol inside the managed Python runtime adapter; application, domain and
  UI code do not import WinRT classes, native process types or supplier clients.
- The provider boundary accepts immutable authorized source bytes, an explicit
  language and an ordered bounded selection of original source pages. Results
  bind the exact source digest, provider/version, language, page numbers,
  decoded dimensions and line geometry. Reject mismatches rather than repair
  or silently substitute them. Preserve recognized text exactly as data.
- Use Windows OCR for the selected implementation. Future providers must satisfy
  the same contract, limits and qualification. The interface grants no download,
  executable-path selection, cloud transfer or credential authority. A new
  supplier, remote service or expanded boundary still needs its own review.
- OCR stays opt-in. Do not report availability until the selected provider,
  trusted helper and product wiring are present and qualified. Missing platform,
  helper or installed language must remain explicitly unavailable. Do not install
  language packs or invoke a different provider as an implicit fallback.
- Initial contract limits are 16 MiB of source bytes, 16 recognized pages,
  original PDF page numbers within 5000, dimensions at most 4096,
  4194304 decoded pixels per page, 4096 lines and 250000 text characters per
  result. Native framing, runtime and concurrency limits must also be enforced
  by the implementation before it becomes available. Reject overflow; do not
  truncate and call a partial result complete.
- Windows OCR supplies no recognition probability. Do not fabricate confidence
  scores or present text-hygiene metrics as measured OCR accuracy.

## Security impact

This is security-relevant. Sources and recognized text are untrusted data.
Protected assets are source integrity, page lineage, resource availability and
private content. Immutable bounded request/result types, finite geometry,
exact source/provider/language/page matches, fixed sanitized errors and
content-free representations address substitution, resource abuse and diagnostic
leaks at this boundary. Authorization remains upstream in owning application
use cases. The contract is not a native sandbox or proof of recognition quality.

The Windows helper still needs separate trusted build/resource identity,
private bounded I/O, lifetime/timeout/cancellation and cleanup evidence, followed
by normalization, readiness and actual host UI qualification. Preserve the
existing unavailable state until those requirements pass. No new model or
language-data download follows from this decision.

## Consequences and verification

A supplier can change behind the runtime boundary while application orchestration
continues to use its existing ports. Portable contract and denial tests run in
one fixed source-owned profile. They prove contract behavior only; actual Windows
image/scanned-page and product journeys remain required. Standard parser behavior
and accepted model-quality evidence are unchanged.

## Helper implementation support

The worker now owns strict private frame serialization and Windows helper source.
Frames bind versioned provider-neutral metadata; the private input carries
immutable bytes, media type, explicit language and selected original pages.
Response parsing checks exact fields/types and a 2 MiB byte cap before JSON
allocation. The Windows source requires the exact installed canonical language tag, refuses
resolved-language substitutions or aliases, and validates raster
size before decoding/rendering and returns text with rendered-pixel geometry.
No probability is invented. The helper has a finite managed wait including input.

This support is not provider availability. A trusted compiled resource, native
creation-time process ownership, bounded pipes/memory/concurrency, cancellation
and confirmed exit still need implementation and actual qualification before
launch. Build/package composition and application/normalization/readiness/host UI
integration remain pending. A compiler is a development tool, never an implicit
end-user dependency. No new binary, language-data or model download is authorized.

## Native ownership implementation support

The runtime owns one fixed helper resource and one request at a time. Its x64
Windows implementation composes creation-time Job membership, suspended creation,
three explicit inherited pipe handles and only the Windows directory environment.
Per-process and aggregate commit ceilings are 512 MiB; the active-process limit
is one. The parent deadline is 120 seconds. Bounded stdout is private recognized
data; stderr is counted and discarded, and any stderr rejects the exchange.
Native exit, zero active members, stopped pipe threads and acknowledged native
handle closes are all required before returning a result or admitting a successor.
Uncertain ownership is strongly retained with no reset/adoption interface.

A bounded trusted-build manifest binds the current raw source and x64 executable
digests and executable byte count. Native read leases pin files and all ancestors,
rejecting reparse points and write/delete access to the files. This detects stale
or incomplete installations. It is not a signature or isolation from a malicious
installation writer. The app does not compile or search for a replacement.
Local model-free native tests are distinct from portable checks. Provider and
build/package composition, actual document recognition and product/UI remain
pending; none of these support components changes advertised availability.

## Provider orchestration and document qualification

The Windows provider now implements the neutral protocol over the fixed private
transport. Construction has no side effects. Recognition checks fresh exact
installed-language readiness and binds every result to the source digest, original
page selection and ready provider/version. Platform/helper/language absence is
explicit; malformed or substituted responses fail rather than selecting another
engine. No supplier process types cross the application runtime/task ports.

The separate model-free document operator creates only new synthetic image and
scanned-PDF fixtures with installed tools. It checks text, page/geometry lineage,
EXIF orientation and denial/cancellation retirement. These local results do not
qualify product packaging, document normalization or either host UI; advertised
OCR stays unavailable until those requirements pass. Standard extraction and
accepted model-quality qualification are unchanged.

## Trusted build and resource composition

Use Forge's existing `generateAssets` lifecycle for development/package builds
of the fixed helper. An isolated standard-library Python builder uses the fixed
installed .NET compiler and SDK 26100 references. No supplier, binary, language
data or model dependency is added. The existing worker resource copy includes
the generated helper and manifest. Missing optional tools preserve Standard
startup; runtime code does not compile or probe OCR during ordinary Canvas load.

Build inputs are natively pinned and bounded. Only literal installed system
toolchain files may have Windows servicing hard links; repository sources and
runtime resources keep their single-link guard. The trusted compiler has finite
time/output, exact root retirement and acknowledged handle close. It is not a
compiler descendant sandbox. Separate runtime creation-time Job controls remain.
Each attempt uses a new UUID source copy, preserves earlier evidence and replaces
only the two generated resource names, manifest last. An OS-owned lock survives
as a file after interruption but releases its lock when the process ends.

Source and binary hashes establish current trusted-installation identity, not
signature authenticity. Actual fixed-path readiness, document smoke and copied
resource checks qualify this build component only. Application normalization,
source authorization, capability and both-host delivery remain required before
advertised OCR or parent completion.

## Complete scanned-PDF normalization

Keep all-page orchestration provider-neutral in the runtime adapter. Establish
the complete PDF page count from the first source-bound result, refuse totals
above 16 and recognize exactly the remaining original pages. Both parts must
match the same ready source/provider/version/language and page count. Apply
aggregate line/text limits and a 2 MiB compact ASCII JSON dataclass-validation
bound to every constructed document, including merged results. This is a neutral
validation representation, not a second Windows transport contract.

Private normalization uses an explicit language and cancellation callback.
Only existing PDF sources opt in. Bound a single immutable read and preserve
recognized lines, exact normalized offsets, blank-page identities and rendered
geometry. Confidence is absent. OCR failures remain failures even when ordinary
unsupported documents can be skipped. Standard extraction imports no supplier.
Current private normalization support does not advertise readiness or replace
upstream source authorization, native path-race proof, public task contracts or
actual desktop/browser qualification.

## Private staged-source capture

Reuse the private native read-lease mechanics for one explicitly bound staged
PDF without broadening the fixed helper-resource factory. Require canonical
local-drive task staging, one generated direct child, artifact/context coherence,
positive bytes at most 16 MiB and an exact expected SHA256. Pin non-reparse
ancestors before the single-link regular leaf. This protects named identities
and file sharing; it does not prevent directory child creation. An unconfirmed
close retains its exact owner and permanently fences later capture in that
process, with no stale-handle close retry or reset.

Capture returns immutable bytes only after integrity and native retirement.
Cancellation occurs between bounded synchronous reads; no hard disk-I/O deadline
is asserted. Application authorization and host-compiled source bindings remain
required integration, separate from this private adapter. Product OCR stays
unavailable until those controls and actual task/UI qualification pass.

Require `GetDriveTypeW` on the explicit drive anchor to return `DRIVE_FIXED`
before acquiring file handles. Drive-letter syntax and `FILE_TYPE_DISK` alone
do not establish local media. Unknown, remote, removable and failed queries deny.
See the [Windows drive-type API](https://learn.microsoft.com/en-us/windows/win32/api/fileapi/nf-fileapi-getdrivetypew)
and [file-type API](https://learn.microsoft.com/en-us/windows/win32/api/fileapi/nf-fileapi-getfiletype).

## Application source-map composition

Use a separate application-owned integrity-hashing port, always composed in both
hosts, rather than making OCR depend on optional version finalization. Derive one
internal `staged-pdf-ocr-v1` entry per selected, authorized PDF from an immediate
private copy of retrieved bytes. Hash, write and retain optional version lineage
from the same copy. Validate the port's canonical prefixed SHA256 before mapping
it to the native raw digest. Generated short ordinal filenames omit display data.

Reject public runtime/source-map fields. Require explicit language, compatible
structure-aware/layout/PDF settings and exact worker-protocol support before
source access. Preserve Standard behavior. Protocol support is not provider or
installed-language readiness. Keep worker advertisement and product OCR
unavailable until actual task consumption, cancellation and host delivery pass.

Keep a private owner before OCR staging allocation and its one cleanup attempt.
Unconfirmed effects retain that owner process-wide and deny new OCR across
use-case instances. Repeat cleanup calls reuse the recorded result. Confirmed
cleanup can release task/stage maps; unknown effects have no reset or retry.
Use a fresh host-issued task identity and require its exact request-id echo.
Ambiguous start effects retain the stage, exact request/promise and real task
reservation instead of deleting files as a substitute for worker proof. These controls do not
qualify native/task retirement or durable crash recovery. Standard is unchanged.

## Managed preparation task

Validate the complete host-issued map before output-root resolution in the worker
API and before planning or source/model access in direct task execution. Use strict
raw booleans and an explicit language. Revalidate immutable ordered bindings at
normalization and pass them to native capture. Remove the metadata-only OCR reader.
An original display name cannot select structured loading or Standard extraction.
Missing MIME metadata is allowed for a bound ordinal PDF; declared non-PDF media
denies. The fixed native helper always decodes this path as PDF.

Windows workers advertise protocol support without probing an engine or language.
Each actual recognition checks the installed supplier and exact language anew.
Only completed recognition supplies ready status and aggregate provider, language,
page and line facts. Text hygiene scores are not OCR confidence or accuracy.

Split long recognized lines within the existing word-based token estimate and
character bound. Keep exact Unicode code-point spans, original page numbers and
line identity; do not invent finer geometry. The generation adapter retains its
separate actual tokenizer/input limits. Cancellation checks run between completed
source, native recognition, generation and output operations. Running cancellation
remains a request until execution unwinds; uncertain native retirement is a failure,
not a successful cancellation. Keep app controls, both-host journeys, full delivery,
unknown-start reconciliation and durable recovery separate from local task proof.

## Public preparation controls

Use one shared scanned-PDF control in desktop and thin client. It starts off and
requires Document-structure sections, a complete all-PDF selection and an explicit
installed language tag. These are typed public choices; no source map, staging
path, digest or provider command comes from the renderer. The owning application
and worker still perform authoritative authorization, protocol and reader checks.
The renderer cannot establish installed-engine readiness or authorize a read.

Preserve an explicit choice when sources become incompatible and stop submission
until it is corrected or turned off. An explicit method or training-goal change
clears the opt-in. Keep controls locked until the task actually settles. Desktop
named settings preserve the choice without source identities; older settings start
off. Invalid saved flags fail before dispatch. Version reuse checks the available
source catalog before restoring an OCR setup; the host rechecks actual sources.

Show actual completed reader counts separately from the text-character hygiene
score. The latter checks replacement and control characters, not OCR accuracy.
Do not show arbitrary provider identity/version strings as public diagnostics.
Local form and request tests are component evidence. Actual complete host journeys
and packaged delivery remain distinct qualification before parent closure.

Scanned-PDF recognition accepts at most 16 pages per PDF. Split a longer PDF
into smaller source files before using recognition. A version replay must retain
the exact structure-aware/layout/Markdown settings and a compatible training goal;
an explicit saved plan cannot bypass those checks.

## Controlled OCR app qualification

Use the actual packaged Python app and OCR resources for the desktop and browser
journeys. A fixed offline test entry replaces only generation with known synthetic
examples. It retains launch authentication, production dependency preparation,
source authorization/capture, recognition, curation, review and explicit approval.
The two fixed synthetic model identifiers select ordinary generation or a bounded
cancellation wait. Neither identifier loads a model.

A package exit code alone is insufficient: the optional build hook can preserve
Standard startup without OCR. Verify the copied helper source, manifest, binary
and all deployed worker inputs before launching the OCR journeys. Require actual
page/line/text results, unavailable-language refusal, cancellation observation,
retry, persistence and owned-process retirement. A synthetic generator provides
no model-quality or inference-performance evidence. Full host qualification is
pending until that exact controlled run and its independent review pass. See
[the OCR qualification procedure](../../dev-tools/scripts/qualification/visual-composer/ocr-qualification.md).
