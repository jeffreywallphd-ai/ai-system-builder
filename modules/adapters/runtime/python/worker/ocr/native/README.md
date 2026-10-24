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
