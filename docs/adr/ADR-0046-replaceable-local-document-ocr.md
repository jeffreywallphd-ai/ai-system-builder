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
