# Local Windows OCR Helper Source

> AI documentation reminder: when behavior in this area changes, update the related ADRs, architecture docs, context packs, and README files in the same change.

This is source for the Windows implementation of the replaceable worker OCR
contract. Compilation alone does not install, package, start or qualify it.
The product still reports OCR unavailable. The application continues to use its
existing runtime/task ports; it does not import Windows classes.

`WindowsOcrHelper.cs` accepts one private standard-input frame and returns at
most one standard-output frame. Each frame starts with a four-byte unsigned
little-endian UTF-8 JSON byte length. Requests have version `1`, operation
`readiness` or `recognize`, and an explicit language. Recognition also carries
immutable base64 source bytes, a fixed media type and ordered original page
numbers. No request selects a file, executable, credential, URL or fallback.
The helper checks installed Windows language support without downloading it.
The request must use the installed engine's exact canonical language tag.
The helper compares `RecognizerLanguage.LanguageTag` with the request using
ordinal equality. A related-language fallback, alias or different tag spelling
returns unavailable; it is never reported as the requested language. See
[Windows language resolution](https://learn.microsoft.com/en-us/uwp/api/windows.media.ocr.ocrengine.trycreatefromlanguage?view=winrt-26100)
and [the actual recognizer language](https://learn.microsoft.com/en-us/uwp/api/windows.media.ocr.ocrengine.recognizerlanguage?view=winrt-26100).
Input uses only `wire.py`'s canonical field order and compact ASCII lexical
forms. Duplicate or escaped keys, extra fields, numeric aliases and whitespace
variants are refused before source decoding. Fixed regular expressions have a
five-second match deadline; arbitrary JSON is not a second request interface.

The request frame is at most 23000000 bytes; source bytes are at most 16 MiB.
Only PNG, JPEG and PDF are accepted. PDF source page count is at most 5000;
at most 16 original pages can be selected. Before bitmap decoding/rendering,
dimensions are limited to 4096 and the pixel product to 4194304. PDF render
dimensions use a bounded scale up to two pixels per page unit; line coordinates
refer to the rendered pixel page, not PDF point coordinates. Aggregate output
has at most 4096 lines and 250000 Unicode scalar characters. Text and geometry
are preserved; unsupported or oversized work is refused, not truncated.
There is no OCR confidence score. A missing installed language has a fixed
unavailable response. Other failures have fixed nonzero exit codes. Helper code
writes no exception, source text or path as diagnostics; a future native owner
must also discard or bound system diagnostics.

WinRT reports PDF page size in device-independent pixels (96 per inch), not
the embedded raster's pixels or PDF points (72 per inch). Synthetic PDF geometry
expectations use that conversion, the declared render scale and integer flooring.
See [PDF page size](https://learn.microsoft.com/en-us/uwp/api/windows.data.pdf.pdfpage.size?view=winrt-26100)
and [Windows coordinate units](https://learn.microsoft.com/en-us/windows/win32/learnwin32/dpi-and-device-independent-pixels).

JPEG EXIF orientation is applied explicitly before recognition. Raw and oriented
dimensions are bounded before decoding. The result uses the actual oriented
bitmap dimensions and geometry, so a quarter-turn cannot mix stored raster width
with viewed-page coordinates. See Microsoft's
[raw and oriented dimensions](https://learn.microsoft.com/en-us/uwp/api/windows.graphics.imaging.bitmapdecoder?view=winrt-26100)
and [explicit orientation mode](https://learn.microsoft.com/en-us/uwp/api/windows.graphics.imaging.exiforientationmode?view=winrt-26100).

The helper's managed wait includes input reading and is limited to 110 seconds.
It is not native exit, memory or descendant containment proof. Before use,
the runtime must own a trusted compiled resource with private bounded pipes,
creation-time Job membership, finite memory/concurrency/deadline limits,
cancellation, and confirmed process-tree exit and handle retirement. Native
failure tests, actual Windows image/scanned-PDF checks, build/package identity,
normalization, capability and host UI wiring remain pending. Do not launch this
source or an unverified binary as a compatibility fallback.

`../wire.py` encodes only bounded requests and parses exact response fields,
strict UTF-8, finite numeric geometry and duplicate-free JSON. It enforces the
2 MiB response frame cap before JSON parsing. A caller must still apply
`check_result` to bind a parsed document to its authorized source, selected
pages, language and ready provider. Parsing does not establish authorization
or provider availability. See [ADR-0046](../../../../../../../docs/adr/ADR-0046-replaceable-local-document-ocr.md).

## Native ownership adapter

`../windows_process.py` implements one fixed private helper exchange. It uses
creation-time Windows Job membership, suspended creation, three explicitly
inherited pipe handles and a minimal Windows environment. Process and job commit
ceilings are each 512 MiB, with one active process and a 120-second parent
deadline. Output is capped at 2 MiB plus its frame header. Standard error is
counted and discarded, with a 64 KiB rejection threshold; any standard error
denies success. Observed bytes can exceed that threshold before termination.
The parent checks cancellation and native limit notifications. It accepts a
result only after the native root exits, the job reports zero active members,
pipe threads stop and all owned handle closes are acknowledged. Uncertain
ownership stays retained and denies successors. No old process is adopted.

`../resource.py` accepts only the fixed `build/WindowsOcrHelper.exe` resource
with `build/resource.json` beside it. The bounded versioned manifest binds the
raw helper source and x64 executable digests and byte count. Native read handles
pin those files and their ancestors through retirement, rejecting reparse points,
file write/delete sharing and ancestor deletion. Missing, changed or incomplete
resources fail closed. This is a trusted-installation integrity check, not a
signature, AppContainer or defense against a writer of the installation itself.
Runtime code never compiles, searches for, downloads or chooses another helper.
Build/package composition and normalization/UI remain pending;
the product still reports OCR unavailable.

Directory leases request both read attributes and list-directory access. They
do not enumerate contents. Actual Windows checks showed that an attribute-only
handle allowed a second delete-access open; the list-directory right makes the
no-delete sharing check effective. This pins ancestor identity, not every child
entry or a mutable retained offload tree.

The explicit model-free native qualification is:

```text
python -B -m modules.adapters.runtime.python.worker.tests.qualification_ocr_windows --native
```

It creates fresh ignored synthetic bundles, using the already installed x64 .NET
compiler and Windows SDK 26100. It downloads nothing and leaves earlier runs
intact. `OcrLifetimeFixture.cs` is a qualification-only fixture for pipe bounds,
failure, resource limits and crash behavior. It is never selected as a product
resource. Portable profile tests do not execute this operator. Native checks and
their exact source hashes supply only local process/resource evidence; actual
PNG/JPEG/scanned-PDF results, deployment, normalization and both host journeys
need their own qualification. No model-quality rerun is required.

## Provider and actual document checks

`../provider.py` implements the selected supplier behind `OcrProvider`. Creating
the provider performs no probe or launch. Each recognition checks fresh installed
language readiness, then binds the recognized result to the exact source digest,
selected original pages, provider/version and language. Unsupported platforms,
missing helpers and absent languages are explicit unavailable states. A malformed
or substituted response is an error, not a fallback. The provider never compiles
or selects a helper, installs a language, or supplies a confidence score.

The separate synthetic document operator is:

```text
python -B -m modules.adapters.runtime.python.worker.tests.qualification_ocr_documents --native
```

It uses installed Pillow and Arial solely to generate new PNG/JPEG/scanned-PDF
fixtures, and the installed SDK to compile a fresh private qualification bundle.
It checks text, finite geometry, blank pages, selected original PDF pages,
EXIF rotation, exact language, malformed/oversized inputs and cancellation with
strict retirement. Missing tools fail qualification; nothing is downloaded.
Ordinary portable tests never run this operator. A local bundle and source
tests do not qualify trusted product packaging, normalization or host delivery.
Product OCR remains unavailable until those separate checks pass.
