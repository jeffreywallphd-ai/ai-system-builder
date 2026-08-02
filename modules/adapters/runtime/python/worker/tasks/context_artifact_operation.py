from __future__ import annotations

from contextlib import contextmanager
import gc
import hashlib
import json
import math
from pathlib import Path, PurePosixPath
import re
import shutil
import stat
import tempfile
from typing import Any, Callable, Iterator
from zipfile import BadZipFile, ZIP_DEFLATED, ZIP_STORED, ZipFile

from ..models import (
    ContextArtifactOperationTaskRequest,
    ContextEmbeddingSettings,
    ContextGenerationSourceInput,
    ContextGenerationTaskRequest,
    ContextPackSettings,
)
from .context_generation import (
    _collect_chunks,
    _embed_with_transformers,
    _validate_markdown_document,
)


RAG_MEDIA_TYPE = "application/vnd.ai-system-builder.rag-database+lancedb+zip"
PACK_MEDIA_TYPE = "application/vnd.ai-system-builder.markdown-context-pack+zip"
RAG_TABLE_NAME = "chunks"
RAG_DATABASE_PREFIX = "database/"
SOURCE_PACK_ENTRIES = {
    "manifest.json",
    "README.md",
    "topics.md",
    "sources.md",
}
MANUAL_PACK_ENTRIES = {"manifest.json", "README.md", "context.md"}
MAX_MANIFEST_BYTES = 512 * 1024
MAX_TOPICS_BYTES = 8 * 1024 * 1024
MAX_TOPIC_SUMMARY_CHARACTERS = 64_000
MAX_PACKAGE_ENTRY_BYTES = 1024 * 1024 * 1024
MAX_PACKAGE_TOTAL_BYTES = 64 * 1024 * 1024
MAX_RAG_PACKAGE_FILES = 4_096
MAX_RAG_PACKAGE_ENTRY_BYTES = 128 * 1024 * 1024
MAX_RAG_PACKAGE_EXPANDED_BYTES = 256 * 1024 * 1024
MAX_CHUNKS = 100_000
MAX_EXCERPT_CHARACTERS = 2_000
DIGEST_PATTERN = re.compile(r"^sha256:[a-f0-9]{64}$")
SAFE_FIELD_PATTERN = re.compile(r"^[A-Za-z_][A-Za-z0-9_.-]{0,127}$")
LANGUAGE_PATTERN = re.compile(r"^[a-z]{2,3}(?:-[A-Z]{2})?$")
SOURCE_URL_PATTERN = re.compile(r"^https?://[^\s]+$", re.IGNORECASE)


class ContextArtifactOperationCancellationRequested(RuntimeError):
    pass


def _sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for block in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(block)
    return "sha256:" + digest.hexdigest()


def _validated_input_path(
    payload: ContextArtifactOperationTaskRequest,
) -> Path:
    root_candidate = Path(payload.runtime.runtimeWorkingDirectory)
    path_candidate = Path(payload.localPath)
    if (
        not root_candidate.is_absolute()
        or not path_candidate.is_absolute()
        or root_candidate.is_symlink()
        or path_candidate.is_symlink()
    ):
        raise ValueError("Context artifact input is invalid.")
    root = root_candidate.resolve(strict=True)
    path = path_candidate.resolve(strict=True)
    if (
        not root.is_dir()
        or not path.is_file()
        or root not in path.parents
        or path.stat().st_size != payload.sizeBytes
        or _sha256_file(path) != payload.digest
    ):
        raise ValueError("Context artifact input does not match its descriptor.")
    return path


def _required_text(value: Any, label: str, maximum: int) -> str:
    if not isinstance(value, str) or not value.strip() or len(value) > maximum:
        raise ValueError(f"Context manifest {label} is invalid.")
    return value


def _required_count(value: Any, label: str, maximum: int) -> int:
    if (
        not isinstance(value, int)
        or isinstance(value, bool)
        or value < 0
        or value > maximum
    ):
        raise ValueError(f"Context manifest {label} is invalid.")
    return value


def _validated_source_information(value: Any) -> dict[str, str] | None:
    if value is None:
        return None
    if not isinstance(value, dict):
        raise ValueError("Context source information is invalid.")
    limits = {
        "author": 512,
        "license": 512,
        "consent": 512,
        "sourceUrl": 2_048,
        "language": 16,
    }
    safe: dict[str, str] = {}
    for key, maximum in limits.items():
        candidate = value.get(key)
        if candidate is None:
            continue
        if (
            not isinstance(candidate, str)
            or not candidate.strip()
            or len(candidate) > maximum
        ):
            raise ValueError("Context source information is invalid.")
        safe[key] = candidate.strip()
    if not safe:
        raise ValueError("Context source information is invalid.")
    if "sourceUrl" in safe and not SOURCE_URL_PATTERN.fullmatch(safe["sourceUrl"]):
        raise ValueError("Context source information URL is invalid.")
    if "language" in safe and not LANGUAGE_PATTERN.fullmatch(safe["language"]):
        raise ValueError("Context source information language is invalid.")
    return safe


def _validated_source_check_settings(value: Any) -> dict[str, Any] | None:
    if value is None:
        return None
    if not isinstance(value, dict):
        raise ValueError("Context source-check settings are invalid.")
    preset = value.get("preset")
    allowed_languages = value.get("allowedLanguages")
    if (
        preset not in {"recommended", "strict"}
        or not isinstance(allowed_languages, list)
        or not 1 <= len(allowed_languages) <= 16
        or len(set(allowed_languages)) != len(allowed_languages)
        or any(
            not isinstance(language, str)
            or not LANGUAGE_PATTERN.fullmatch(language)
            for language in allowed_languages
        )
        or not isinstance(value.get("requireLicenseMetadata"), bool)
        or not isinstance(value.get("requireConsentMetadata"), bool)
        or not isinstance(value.get("includeSourceAttribution"), bool)
    ):
        raise ValueError("Context source-check settings are invalid.")
    return {
        "preset": preset,
        "allowedLanguages": allowed_languages,
        "requireLicenseMetadata": value["requireLicenseMetadata"],
        "requireConsentMetadata": value["requireConsentMetadata"],
        "includeSourceAttribution": value["includeSourceAttribution"],
    }


def _validated_manifest(
    value: Any,
    expected_media_type: str,
) -> dict[str, Any]:
    if not isinstance(value, dict):
        raise ValueError("Context artifact manifest is invalid.")
    kind = value.get("kind")
    expected_kind = (
        "rag-database"
        if expected_media_type == RAG_MEDIA_TYPE
        else "markdown-context-pack"
    )
    if (
        value.get("schemaVersion") != "1"
        or kind != expected_kind
        or value.get("mediaType") != expected_media_type
    ):
        raise ValueError("Context artifact manifest identity is invalid.")
    name = _required_text(value.get("name"), "name", 120)
    created_at = _required_text(value.get("createdAt"), "createdAt", 80)
    sources = value.get("sources")
    manual_entries = value.get("manualEntries")
    chunking = value.get("chunking")
    if (
        not isinstance(sources, list)
        or len(sources) > 32
        or not isinstance(manual_entries, list)
        or len(manual_entries) > 32
        or not isinstance(chunking, dict)
    ):
        raise ValueError("Context artifact manifest structure is invalid.")
    safe_sources: list[dict[str, Any]] = []
    seen_sources: set[str] = set()
    for source in sources:
        if not isinstance(source, dict):
            raise ValueError("Context artifact source manifest is invalid.")
        artifact_id = _required_text(
            source.get("artifactId"), "source artifactId", 512
        )
        digest = source.get("digest")
        if artifact_id in seen_sources or not isinstance(digest, str) or not DIGEST_PATTERN.fullmatch(digest):
            raise ValueError("Context artifact source manifest is invalid.")
        seen_sources.add(artifact_id)
        media_type = _required_text(
            source.get("mediaType"), "source mediaType", 200
        )
        size_bytes = _required_count(
            source.get("sizeBytes"), "source sizeBytes", 64 * 1024 * 1024
        )
        chunk_count = _required_count(
            source.get("chunkCount"), "source chunkCount", MAX_CHUNKS
        )
        chunking_mode = source.get("chunkingMode")
        if chunk_count < 1 or chunking_mode not in {"persisted", "extracted"}:
            raise ValueError("Context artifact source manifest is invalid.")
        original_name = source.get("originalName")
        if original_name is not None:
            original_name = _required_text(
                original_name, "source originalName", 512
            )
        source_information = _validated_source_information(
            source.get("sourceInformation")
        )
        safe_sources.append({
            "artifactId": artifact_id,
            "digest": digest,
            "mediaType": media_type,
            **({"originalName": original_name} if original_name else {}),
            "sizeBytes": size_bytes,
            "chunkCount": chunk_count,
            "chunkingMode": chunking_mode,
            **(
                {"sourceInformation": source_information}
                if source_information is not None
                else {}
            ),
        })
    safe_manual: list[dict[str, Any]] = []
    seen_manual: set[str] = set()
    for entry in manual_entries:
        if not isinstance(entry, dict):
            raise ValueError("Context manual manifest is invalid.")
        entry_id = _required_text(entry.get("id"), "manual id", 128)
        title = _required_text(entry.get("title"), "manual title", 200)
        digest = entry.get("digest")
        if entry_id in seen_manual or not isinstance(digest, str) or not DIGEST_PATTERN.fullmatch(digest):
            raise ValueError("Context manual manifest is invalid.")
        seen_manual.add(entry_id)
        safe_manual.append({"id": entry_id, "title": title, "digest": digest})
    strategy = chunking.get("strategy")
    chunk_characters = _required_count(
        chunking.get("chunkCharacters"), "chunkCharacters", 32_000
    )
    overlap = _required_count(
        chunking.get("overlapCharacters"), "overlapCharacters", 8_000
    )
    if (
        strategy not in {
            "fixed-length",
            "topic-aware",
            "sentence",
            "section",
            "structure-aware",
        }
        or chunk_characters < 64
        or overlap >= chunk_characters
    ):
        raise ValueError("Context artifact chunking manifest is invalid.")
    safe_chunking: dict[str, Any] = {
        "strategy": strategy,
        "chunkCharacters": chunk_characters,
        "overlapCharacters": overlap,
    }
    maximum_tokens = chunking.get("maximumTokensPerChunk")
    if maximum_tokens is not None:
        maximum_tokens = _required_count(
            maximum_tokens, "maximumTokensPerChunk", 4_096
        )
        if maximum_tokens < 32 or strategy == "fixed-length":
            raise ValueError("Context artifact adaptive chunking is invalid.")
        safe_chunking["maximumTokensPerChunk"] = maximum_tokens
    topic_sensitivity = chunking.get("topicBoundarySensitivity")
    if topic_sensitivity is not None:
        if (
            strategy != "topic-aware"
            or isinstance(topic_sensitivity, bool)
            or not isinstance(topic_sensitivity, (int, float))
            or not math.isfinite(float(topic_sensitivity))
            or topic_sensitivity < 0
            or topic_sensitivity > 1
        ):
            raise ValueError("Context artifact topic sensitivity is invalid.")
        safe_chunking["topicBoundarySensitivity"] = float(topic_sensitivity)
    text_fields = chunking.get("textFields")
    if text_fields is not None:
        if (
            not isinstance(text_fields, list)
            or len(text_fields) > 32
            or any(
                not isinstance(field, str)
                or not SAFE_FIELD_PATTERN.fullmatch(field)
                for field in text_fields
            )
        ):
            raise ValueError("Context artifact text fields are invalid.")
        safe_chunking["textFields"] = text_fields
    maximum_chunks = chunking.get("maximumChunks")
    if maximum_chunks is not None:
        maximum_chunks = _required_count(
            maximum_chunks, "maximumChunks", MAX_CHUNKS
        )
        if maximum_chunks < 1:
            raise ValueError("Context artifact maximum chunks are invalid.")
        safe_chunking["maximumChunks"] = maximum_chunks
    safe: dict[str, Any] = {
        "schemaVersion": "1",
        "kind": expected_kind,
        "name": name,
        "mediaType": expected_media_type,
        "createdAt": created_at,
        "sources": safe_sources,
        "manualEntries": safe_manual,
        "chunking": safe_chunking,
    }
    if expected_kind == "rag-database":
        source_checks = _validated_source_check_settings(
            value.get("sourceChecks")
        )
        if source_checks is not None:
            safe["sourceChecks"] = source_checks
        embedding = value.get("embedding")
        if not isinstance(embedding, dict):
            raise ValueError("Context embedding manifest is invalid.")
        provider = embedding.get("provider")
        model_id = _required_text(
            embedding.get("modelId"), "embedding modelId", 193
        )
        if provider != "transformers":
            raise ValueError("Context embedding provider is invalid.")
        safe_embedding: dict[str, Any] = {
            "provider": provider,
            "modelId": model_id,
        }
        dimensions = embedding.get("dimensions")
        if dimensions is not None:
            dimensions = _required_count(
                dimensions, "embedding dimensions", 8_192
            )
            if dimensions < 1:
                raise ValueError("Context embedding dimensions are invalid.")
            safe_embedding["dimensions"] = dimensions
        safe["embedding"] = safe_embedding
    else:
        if value.get("sourceChecks") is not None:
            raise ValueError("Context pack source-check settings are invalid.")
        settings = value.get("contextPack")
        if not isinstance(settings, dict):
            raise ValueError("Context pack manifest is invalid.")
        method = settings.get("method")
        input_mode = settings.get("inputMode")
        if input_mode is None:
            topic_count = _required_count(
                settings.get("topicCount"), "topicCount", 32
            )
            summary_characters = _required_count(
                settings.get("maximumSummaryCharacters"),
                "maximumSummaryCharacters",
                8_000,
            )
            if topic_count < 1 or summary_characters < 64:
                raise ValueError("Legacy context pack manifest is invalid.")
            safe_settings = {
                "method": method,
                "topicCount": topic_count,
                "maximumSummaryCharacters": summary_characters,
            }
            if method not in {"deterministic", "local-model"}:
                raise ValueError("Legacy context pack method is invalid.")
        else:
            if (
                input_mode not in {"manual", "source-materials"}
                or method not in {"none", "local-model"}
                or (input_mode == "manual" and method != "none")
                or (
                    input_mode == "manual"
                    and settings.get("cleaningPreset") is not None
                )
                or (
                    input_mode == "source-materials"
                    and settings.get("cleaningPreset")
                    not in {"standard", "strict"}
                )
            ):
                raise ValueError("Context pack manifest is invalid.")
            safe_settings = {
                "inputMode": input_mode,
                "method": method,
                **(
                    {"cleaningPreset": settings["cleaningPreset"]}
                    if input_mode == "source-materials"
                    else {}
                ),
            }
            if method == "local-model":
                maximum_summary_lines = _required_count(
                    settings.get("maximumSummaryLines"),
                    "maximumSummaryLines",
                    1_000,
                )
                if maximum_summary_lines < 1:
                    raise ValueError("Context pack manifest is invalid.")
                safe_settings["maximumSummaryLines"] = maximum_summary_lines
            elif settings.get("maximumSummaryLines") is not None:
                raise ValueError("Context pack manifest is invalid.")
        model_id = settings.get("modelId")
        if (method == "local-model") != (model_id is not None):
            raise ValueError("Context pack manifest is invalid.")
        if model_id is not None:
            safe_settings["modelId"] = _required_text(
                model_id, "context pack modelId", 193
            )
        safe["contextPack"] = safe_settings
    return safe


def _validated_rag_archive_entry(info: Any) -> PurePosixPath:
    name = info.filename
    path = PurePosixPath(name)
    mode = (info.external_attr >> 16) & 0xFFFF
    if (
        not isinstance(name, str)
        or not name
        or "\\" in name
        or path.is_absolute()
        or path.as_posix() != name
        or any(part in {"", ".", ".."} or ":" in part for part in path.parts)
        or info.is_dir()
        or info.flag_bits & 0x1
        or info.compress_type not in {ZIP_STORED, ZIP_DEFLATED}
        or (mode != 0 and not stat.S_ISREG(mode))
        or info.file_size < 0
        or info.file_size > MAX_RAG_PACKAGE_ENTRY_BYTES
        or info.compress_size < 0
        or (
            name != "manifest.json"
            and (
                not name.startswith(RAG_DATABASE_PREFIX)
                or len(path.parts) < 2
            )
        )
    ):
        raise ValueError("Context database package structure is invalid.")
    return path


def _extract_rag_package(path: Path, staging: Path) -> dict[str, Any]:
    if path.stat().st_size > MAX_PACKAGE_TOTAL_BYTES:
        raise ValueError("Context database package exceeds the safe limit.")
    try:
        with ZipFile(path, "r") as archive:
            infos = archive.infolist()
            names = [info.filename for info in infos]
            if (
                not 2 <= len(infos) <= MAX_RAG_PACKAGE_FILES
                or len(names) != len(set(names))
                or "manifest.json" not in names
            ):
                raise ValueError("Context database package structure is invalid.")
            validated = [
                (info, _validated_rag_archive_entry(info))
                for info in infos
            ]
            if not any(
                info.filename.startswith(RAG_DATABASE_PREFIX)
                for info, _relative in validated
            ):
                raise ValueError("Context database package contains no database.")
            expanded_bytes = sum(info.file_size for info, _relative in validated)
            if expanded_bytes > MAX_RAG_PACKAGE_EXPANDED_BYTES:
                raise ValueError("Context database package exceeds the safe limit.")
            manifest_info = archive.getinfo("manifest.json")
            if manifest_info.file_size > MAX_MANIFEST_BYTES:
                raise ValueError("Context database manifest exceeds the safe limit.")
            manifest = _validated_manifest(
                json.loads(archive.read(manifest_info).decode("utf-8")),
                RAG_MEDIA_TYPE,
            )
            staging_root = staging.resolve(strict=True)
            for info, relative in validated:
                if info.filename == "manifest.json":
                    continue
                target = staging.joinpath(*relative.parts)
                target.parent.mkdir(parents=True, exist_ok=True)
                resolved_parent = target.parent.resolve(strict=True)
                if (
                    resolved_parent != staging_root
                    and staging_root not in resolved_parent.parents
                ):
                    raise ValueError("Context database package path is invalid.")
                written = 0
                with archive.open(info, "r") as source, target.open("xb") as output:
                    while True:
                        block = source.read(1024 * 1024)
                        if not block:
                            break
                        written += len(block)
                        if written > info.file_size:
                            raise ValueError(
                                "Context database package entry is invalid."
                            )
                        output.write(block)
                if written != info.file_size:
                    raise ValueError("Context database package entry is invalid.")
            return manifest
    except (BadZipFile, UnicodeDecodeError, json.JSONDecodeError) as error:
        raise ValueError("Context database package could not be inspected.") from error


@contextmanager
def _materialized_rag(
    path: Path,
) -> Iterator[tuple[Path, dict[str, Any]]]:
    staging = Path(
        tempfile.mkdtemp(prefix=".rag-lancedb-read-", dir=path.parent)
    )
    try:
        manifest = _extract_rag_package(path, staging)
        yield staging / "database", manifest
    finally:
        gc.collect()
        if staging.exists():
            shutil.rmtree(staging)


def _load_lancedb_modules() -> tuple[Any, Any]:
    try:
        import lancedb
        import pyarrow as pa
    except ImportError as error:
        raise RuntimeError(
            "The LanceDB runtime dependency is unavailable."
        ) from error
    return lancedb, pa


def _validated_rag_table(
    database_path: Path,
    manifest: dict[str, Any],
) -> tuple[Any, Any, list[dict[str, Any]], int]:
    lancedb, pa = _load_lancedb_modules()
    embedding = manifest.get("embedding")
    dimensions = (
        embedding.get("dimensions") if isinstance(embedding, dict) else None
    )
    if (
        not isinstance(dimensions, int)
        or isinstance(dimensions, bool)
        or not 1 <= dimensions <= 8_192
    ):
        raise ValueError("Context database embedding dimensions are invalid.")
    try:
        database = lancedb.connect(database_path)
        listing = database.list_tables()
        tables = getattr(listing, "tables", None)
        page_token = getattr(listing, "page_token", None)
        if tables != [RAG_TABLE_NAME] or page_token is not None:
            raise ValueError("Context database table set is invalid.")
        table = database.open_table(RAG_TABLE_NAME)
        schema = table.schema
        expected_types = [
            pa.string(),
            pa.int64(),
            pa.string(),
            pa.string(),
            pa.list_(pa.float32(), dimensions),
        ]
        if (
            schema.names
            != ["id", "ordinal", "text", "citation_json", "vector"]
            or len(schema) != len(expected_types)
            or any(field.nullable for field in schema)
            or any(
                field.type != expected
                for field, expected in zip(schema, expected_types, strict=True)
            )
        ):
            raise ValueError("Context database table schema is invalid.")
        count = _required_count(table.count_rows(), "chunk count", MAX_CHUNKS)
        if count < 1:
            raise ValueError("Context database chunk count is invalid.")
        arrow_table = table.to_arrow()
        rows = arrow_table.to_pylist()
    except ValueError:
        raise
    except Exception as error:
        raise ValueError("Context database could not be opened.") from error

    source_total = sum(source["chunkCount"] for source in manifest["sources"])
    if count != len(rows) or count < source_total:
        raise ValueError("Context database chunk count is invalid.")
    sources = {source["artifactId"]: source for source in manifest["sources"]}
    manual_entries = {
        entry["id"]: entry for entry in manifest["manualEntries"]
    }
    seen_ids: set[str] = set()
    seen_ordinals: set[int] = set()
    safe_rows: list[dict[str, Any]] = []
    for row in rows:
        chunk_id = row.get("id")
        ordinal = row.get("ordinal")
        text = row.get("text")
        citation_json = row.get("citation_json")
        vector = row.get("vector")
        if (
            set(row) != {"id", "ordinal", "text", "citation_json", "vector"}
            or not isinstance(chunk_id, str)
            or not chunk_id
            or len(chunk_id) > 640
            or chunk_id in seen_ids
            or not isinstance(ordinal, int)
            or isinstance(ordinal, bool)
            or not 0 <= ordinal < count
            or ordinal in seen_ordinals
            or not isinstance(text, str)
            or not text
            or len(text) > 32_000
            or not isinstance(citation_json, str)
            or len(citation_json) > 8_000
            or not isinstance(vector, list)
            or len(vector) != dimensions
            or any(
                isinstance(value, bool)
                or not isinstance(value, (int, float))
                or not math.isfinite(float(value))
                for value in vector
            )
        ):
            raise ValueError("Context database chunk is invalid.")
        try:
            citation = _citation(json.loads(citation_json))
        except json.JSONDecodeError as error:
            raise ValueError("Context database citation is invalid.") from error
        source_id = citation["sourceArtifactId"]
        source = sources.get(source_id)
        manual_id = (
            source_id[len("manual:"):]
            if source_id.startswith("manual:")
            else None
        )
        if source is not None:
            if citation["sourceDigest"] != source["digest"]:
                raise ValueError("Context database citation source is invalid.")
        elif (
            manual_id is None
            or manual_id not in manual_entries
            or citation["sourceDigest"] != manual_entries[manual_id]["digest"]
        ):
            raise ValueError("Context database citation source is invalid.")
        seen_ids.add(chunk_id)
        seen_ordinals.add(ordinal)
        safe_rows.append(
            {
                "id": chunk_id,
                "ordinal": ordinal,
                "text": text,
                "citation_json": citation_json,
                "citation": citation,
            }
        )
    if seen_ordinals != set(range(count)):
        raise ValueError("Context database chunk order is invalid.")
    return database, table, safe_rows, dimensions


def _inspect_rag(path: Path) -> tuple[dict[str, Any], int]:
    with _materialized_rag(path) as (database_path, manifest):
        database, table, rows, _dimensions = _validated_rag_table(
            database_path, manifest
        )
        count = len(rows)
        del rows
        del table
        del database
        gc.collect()
        return manifest, count


def _parse_topics(
    markdown: str,
    maximum_topics: int,
    maximum_summary_lines: int | None = None,
) -> list[dict[str, Any]]:
    topics: list[dict[str, Any]] = []
    for section in re.split(r"(?m)^##\s+", markdown)[1:]:
        lines = section.splitlines()
        if not lines:
            continue
        title = lines[0].strip()
        body = "\n".join(lines[1:]).strip()
        source_match = re.search(r"(?m)^Sources:\s*(.+)$", body)
        if not title or len(title) > 200 or source_match is None:
            raise ValueError("Context pack topic structure is invalid.")
        summary = body[:source_match.start()].strip()
        citations = [
            citation.strip()
            for citation in source_match.group(1).split(",")
            if citation.strip()
        ]
        if (
            not summary
            or len(summary) > MAX_TOPIC_SUMMARY_CHARACTERS
            or (
                maximum_summary_lines is not None
                and len(summary.splitlines()) > maximum_summary_lines
            )
            or not citations
            or len(citations) > 10
            or any(len(citation) > 640 for citation in citations)
        ):
            raise ValueError("Context pack topic content is invalid.")
        topics.append({
            "title": title,
            "summary": summary,
            "citations": citations,
        })
        if len(topics) > maximum_topics:
            raise ValueError("Context pack topic count is invalid.")
    if not topics:
        raise ValueError("Context pack contains no topics.")
    return topics


def _inspect_pack(path: Path) -> tuple[dict[str, Any], list[str], list[dict[str, Any]]]:
    try:
        with ZipFile(path, "r") as archive:
            infos = archive.infolist()
            names = {info.filename for info in infos}
            if (
                frozenset(names)
                not in {
                    frozenset(SOURCE_PACK_ENTRIES),
                    frozenset(MANUAL_PACK_ENTRIES),
                }
                or len(infos) != len(names)
                or any(info.flag_bits & 0x1 for info in infos)
                or any(info.file_size > MAX_PACKAGE_ENTRY_BYTES for info in infos)
                or sum(info.file_size for info in infos) > MAX_PACKAGE_TOTAL_BYTES
            ):
                raise ValueError("Context pack structure is invalid.")
            manifest_info = archive.getinfo("manifest.json")
            if manifest_info.file_size > MAX_MANIFEST_BYTES:
                raise ValueError("Context pack detail exceeds the safe limit.")
            manifest = _validated_manifest(
                json.loads(archive.read(manifest_info).decode("utf-8")),
                PACK_MEDIA_TYPE,
            )
            input_mode = manifest["contextPack"].get(
                "inputMode", "source-materials"
            )
            expected_entries = (
                MANUAL_PACK_ENTRIES
                if input_mode == "manual"
                else SOURCE_PACK_ENTRIES
            )
            if names != expected_entries:
                raise ValueError("Context pack entries do not match its manifest.")
            if input_mode == "manual":
                context_info = archive.getinfo("context.md")
                if context_info.file_size > MAX_TOPICS_BYTES:
                    raise ValueError("Manual context pack exceeds the safe limit.")
                context_text = archive.read(context_info).decode("utf-8")
                _validate_markdown_document(context_text)
                return manifest, sorted(names), []
            topics_info = archive.getinfo("topics.md")
            if topics_info.file_size > MAX_TOPICS_BYTES:
                raise ValueError("Context pack detail exceeds the safe limit.")
            topics_text = archive.read(topics_info).decode("utf-8")
            _validate_markdown_document(topics_text)
            _validate_markdown_document(
                archive.read("sources.md").decode("utf-8")
            )
            topics = _parse_topics(
                topics_text,
                manifest["contextPack"].get("topicCount", 32),
                manifest["contextPack"].get("maximumSummaryLines"),
            )
            return manifest, sorted(names), topics
    except (BadZipFile, UnicodeDecodeError, json.JSONDecodeError) as error:
        raise ValueError("Context pack could not be inspected.") from error


def _inspect_source(
    payload: ContextArtifactOperationTaskRequest,
    cancellation_check: Callable[[], None],
) -> dict[str, Any]:
    if (
        payload.chunking is None
        or payload.query is not None
        or payload.maximumResults is not None
        or payload.sizeBytes > 64 * 1024 * 1024
    ):
        raise ValueError("Context source inspection request is invalid.")
    request = ContextGenerationTaskRequest(
        workspaceId=payload.workspaceId,
        kind="markdown-context-pack",
        name="Context source inspection",
        sources=[
            ContextGenerationSourceInput(
                artifactId=payload.artifactId,
                localPath=payload.localPath,
                mediaType=payload.mediaType,
                originalName=payload.originalName,
                sourceDigest=payload.digest,
                sizeBytes=payload.sizeBytes,
                sourceInformation=payload.sourceInformation,
            )
        ],
        manualEntries=[],
        chunking=payload.chunking,
        sourceChecks=payload.sourceChecks,
        contextPack=ContextPackSettings(
            inputMode="source-materials",
            method="none",
            cleaningPreset="standard",
        ),
        runtime=payload.runtime,
    )
    chunks, inspections, _sources = _collect_chunks(
        request, cancellation_check
    )
    if len(inspections) != 1:
        raise ValueError("Context source inspection is incomplete.")
    inspection = inspections[0]
    if inspection.get("chunkCount") != len(chunks):
        raise ValueError("Context source inspection count is invalid.")
    return inspection


def _citation(value: Any) -> dict[str, Any]:
    if not isinstance(value, dict):
        raise ValueError("Context database citation is invalid.")
    source_id = value.get("sourceArtifactId")
    digest = value.get("sourceDigest")
    chunk_index = value.get("chunkIndex")
    if (
        not isinstance(source_id, str)
        or not source_id
        or len(source_id) > 512
        or not isinstance(digest, str)
        or not DIGEST_PATTERN.fullmatch(digest)
        or not isinstance(chunk_index, int)
        or isinstance(chunk_index, bool)
        or chunk_index < 0
    ):
        raise ValueError("Context database citation is invalid.")
    safe: dict[str, Any] = {
        "sourceArtifactId": source_id,
        "sourceDigest": digest,
        "chunkIndex": chunk_index,
    }
    for key in ("rowIndex", "normalizedStart", "normalizedEnd", "pageNumber"):
        candidate = value.get(key)
        if candidate is not None:
            if not isinstance(candidate, int) or isinstance(candidate, bool) or candidate < 0:
                raise ValueError("Context database citation is invalid.")
            safe[key] = candidate
    field = value.get("field")
    if field is not None:
        if not isinstance(field, str) or not SAFE_FIELD_PATTERN.fullmatch(field):
            raise ValueError("Context database citation field is invalid.")
        safe["field"] = field
    region_kind = value.get("regionKind")
    if region_kind is not None:
        safe["regionKind"] = _required_text(
            region_kind, "citation regionKind", 64
        )
    return safe


def _query_rag(
    payload: ContextArtifactOperationTaskRequest,
    path: Path,
    cancellation_check: Callable[[], None],
    embedding_provider: (
        Callable[[list[str], ContextEmbeddingSettings], list[list[float]]]
        | None
    ),
) -> list[dict[str, Any]]:
    query = payload.query.strip() if isinstance(payload.query, str) else ""
    maximum_results = payload.maximumResults
    if (
        payload.mediaType != RAG_MEDIA_TYPE
        or not query
        or len(query) > 4_000
        or maximum_results is None
        or not 1 <= maximum_results <= 20
        or payload.chunking is not None
        or payload.sourceInformation is not None
        or payload.sourceChecks is not None
    ):
        raise ValueError("Context retrieval request is invalid.")
    with _materialized_rag(path) as (database_path, manifest):
        database = None
        table = None
        try:
            database, table, rows, dimensions = _validated_rag_table(
                database_path, manifest
            )
            settings = ContextEmbeddingSettings.model_validate({
                **manifest["embedding"],
                "batchSize": 1,
            })
            cancellation_check()
            query_vectors = (embedding_provider or _embed_with_transformers)(
                [query], settings
            )
            if (
                len(query_vectors) != 1
                or len(query_vectors[0]) != dimensions
                or any(
                    isinstance(value, bool)
                    or not isinstance(value, (int, float))
                    or not math.isfinite(float(value))
                    for value in query_vectors[0]
                )
            ):
                raise ValueError("Context query embedding is invalid.")
            cancellation_check()
            try:
                result_rows = (
                    table.search(
                        [float(value) for value in query_vectors[0]],
                        vector_column_name="vector",
                        query_type="vector",
                    )
                    .distance_type("cosine")
                    .bypass_vector_index()
                    .select(
                        [
                            "id",
                            "ordinal",
                            "text",
                            "citation_json",
                            "_distance",
                        ]
                    )
                    .limit(maximum_results)
                    .to_arrow()
                    .to_pylist()
                )
            except Exception as error:
                raise ValueError("Context database query failed.") from error
            by_id = {row["id"]: row for row in rows}
            scored: list[tuple[float, int, dict[str, Any]]] = []
            seen_result_ids: set[str] = set()
            for row in result_rows:
                cancellation_check()
                chunk_id = row.get("id")
                ordinal = row.get("ordinal")
                text = row.get("text")
                citation_json = row.get("citation_json")
                distance = row.get("_distance")
                stored = by_id.get(chunk_id)
                if (
                    not isinstance(chunk_id, str)
                    or chunk_id in seen_result_ids
                    or stored is None
                    or ordinal != stored["ordinal"]
                    or text != stored["text"]
                    or citation_json != stored["citation_json"]
                    or isinstance(distance, bool)
                    or not isinstance(distance, (int, float))
                    or not math.isfinite(float(distance))
                ):
                    raise ValueError("Context retrieval result is invalid.")
                score = max(-1.0, min(1.0, 1.0 - float(distance)))
                scored.append(
                    (
                        score,
                        ordinal,
                        {
                            "id": chunk_id,
                            "excerpt": text[:MAX_EXCERPT_CHARACTERS],
                            "score": score,
                            "citation": stored["citation"],
                        },
                    )
                )
                seen_result_ids.add(chunk_id)
            scored.sort(key=lambda item: (-item[0], item[1]))
            return [item for _score, _ordinal, item in scored]
        finally:
            if table is not None:
                del table
            if database is not None:
                del database
            gc.collect()


def operate_on_context_artifact(
    payload: ContextArtifactOperationTaskRequest,
    *,
    cancellation_check: Callable[[], None] | None = None,
    embedding_provider: (
        Callable[[list[str], ContextEmbeddingSettings], list[list[float]]]
        | None
    ) = None,
) -> dict[str, Any]:
    check_cancelled = cancellation_check or (lambda: None)
    path = _validated_input_path(payload)
    check_cancelled()
    if payload.operation == "inspect-source":
        return {
            "operation": "inspect-source",
            "inspection": _inspect_source(payload, check_cancelled),
        }
    if payload.operation == "inspect-artifact":
        if (
            payload.query is not None
            or payload.maximumResults is not None
            or payload.chunking is not None
            or payload.sourceInformation is not None
            or payload.sourceChecks is not None
        ):
            raise ValueError("Context artifact inspection request is invalid.")
        if payload.mediaType == RAG_MEDIA_TYPE:
            manifest, count = _inspect_rag(path)
            return {
                "operation": "inspect-artifact",
                "inspection": {
                    "manifest": manifest,
                    "chunkCount": count,
                    "packageEntries": [],
                    "topics": [],
                },
            }
        if payload.mediaType == PACK_MEDIA_TYPE:
            manifest, entries, topics = _inspect_pack(path)
            count = sum(
                source["chunkCount"] for source in manifest["sources"]
            )
            if manifest["contextPack"].get("inputMode") == "manual":
                count = len(manifest["manualEntries"])
            return {
                "operation": "inspect-artifact",
                "inspection": {
                    "manifest": manifest,
                    "chunkCount": count,
                    "packageEntries": entries,
                    "topics": topics,
                },
            }
        raise ValueError("Artifact is not a supported context artifact.")
    if payload.operation == "query":
        return {
            "operation": "query",
            "matches": _query_rag(
                payload,
                path,
                check_cancelled,
                embedding_provider,
            ),
        }
    raise ValueError("Context artifact operation is unavailable.")
