"""Fixed provided-data/manual Context qualification: real packaged processors.

The outer reviewed operator owns finite native limits and exact source identity.
This entry cannot run arbitrary tasks, downloads, model generation or OCR.
"""
from __future__ import annotations
import importlib
import importlib.util
import hashlib
import io
import json
import os
from pathlib import Path, PurePosixPath
import re
import stat
import sys
import zipfile


def manual_fixture():
    source = Path(__file__).parent / "daily-context-fixture.json"
    info = source.lstat()
    if (not stat.S_ISREG(info.st_mode) or source.resolve() != source
            or getattr(info, "st_file_attributes", 0) & 0x400 or info.st_size > 4096):
        raise ValueError("The fixed manual fixture is unavailable.")
    with source.open("rb") as stream:
        raw = stream.read(4097)
    if len(raw) > 4096:
        raise ValueError("The fixed manual fixture exceeded its limit.")
    value = json.loads(raw)
    if (type(value) is not dict or set(value) != {"schema_version", "name", "markdown"}
            or value["schema_version"] != "fixed-daily-context-v1"
            or value["name"] != "ui-daily-manual-context"
            or type(value["markdown"]) is not str or not 0 < len(value["markdown"].encode("utf-8")) <= 1024):
        raise ValueError("The fixed manual fixture is invalid.")
    return value


def stable_fixture_bytes(candidate, maximum):
    before = candidate.lstat()
    witness = lambda info: (info.st_dev, info.st_ino, info.st_size, info.st_mtime_ns, info.st_nlink)
    if (not stat.S_ISREG(before.st_mode) or before.st_nlink != 1
            or getattr(before, "st_file_attributes", 0) & 0x400
            or not 0 < before.st_size <= maximum or candidate.resolve() != candidate):
        raise ValueError("A bounded current single-link fixture file is required.")
    with candidate.open("rb") as stream:
        opened = os.fstat(stream.fileno())
        raw = stream.read(maximum + 1)
        after = os.fstat(stream.fileno())
    if (witness(before) != witness(opened) or witness(opened) != witness(after)
            or witness(after) != witness(candidate.lstat()) or len(raw) != before.st_size):
        raise ValueError("The fixture file changed while being read.")
    return raw


def source_context_fixture():
    candidate = Path(__file__).parent / "daily-source-context-fixture.json"
    value = json.loads(stable_fixture_bytes(candidate, 8192))
    keys = {"schema_version", "source_name", "source_markdown", "source_sha256", "pack_name",
            "rag_name", "query", "query_answer", "embedding_model"}
    if (type(value) is not dict or set(value) != keys
            or value["schema_version"] != "fixed-source-context-v1"
            or value["source_name"] != "synthetic-context-transit.md"
            or value["pack_name"] != "ui-daily-source-context" or value["rag_name"] != "ui-daily-transit-rag"
            or value["embedding_model"] != "sentence-transformers/all-MiniLM-L6-v2"
            or value["query"] != "Which stops does Line A connect?"
            or value["query_answer"] != "Line A connects Harbor Station and the Museum."
            or type(value["source_markdown"]) is not str
            or not 0 < len(value["source_markdown"].encode("utf-8")) <= 2048
            or "\0" in value["source_markdown"] or value["query_answer"] not in value["source_markdown"]
            or value["source_sha256"] != hashlib.sha256(value["source_markdown"].encode("utf-8")).hexdigest()):
        raise ValueError("Only the declared fixed source Context fixture is permitted.")
    return value


def fixture_mapping(value):
    if type(value) is dict:
        return value.copy()
    if value is None:
        raise ValueError("The fixed Context settings are required.")
    return value.model_dump(mode="json", exclude_none=True) if hasattr(value, "model_dump") else vars(value).copy()


def fixed_context_chunking(value, rag):
    actual = fixture_mapping(value)
    if actual.get("textFields") in (None, []):
        actual.pop("textFields", None)
    expected = {"strategy": "fixed-length", "chunkCharacters": 128, "overlapCharacters": 0,
                "maximumChunks": 10000} if rag else {
                    "strategy": "topic-aware", "chunkCharacters": 1200, "overlapCharacters": 0,
                    "maximumTokensPerChunk": 320, "topicBoundarySensitivity": 0.22, "maximumChunks": 10000}
    if actual != expected:
        raise ValueError("Only declared source Context chunk settings are permitted.")


def fixed_context_checks(value):
    expected = {"preset": "recommended", "allowedLanguages": ["en"], "requireLicenseMetadata": False,
                "requireConsentMetadata": False, "includeSourceAttribution": True}
    if value is None or fixture_mapping(value) != expected:
        raise ValueError("Only the fixed source checks are permitted.")


def validate_fixed_context_source(source, root, fixed, operation=False):
    expected = root / ("input.bin" if operation else "source-0000.md")
    if (Path(source.localPath) != expected or source.mediaType != "text/markdown"
            or source.originalName != fixed["source_name"] or getattr(source, "sourceInformation", None) is not None):
        raise ValueError("Only the current fixed staged source is permitted.")
    raw = stable_fixture_bytes(expected, 2048)
    claimed = getattr(source, "sourceDigest", None) if not operation else source.digest
    if (raw != fixed["source_markdown"].encode("utf-8") or source.sizeBytes != len(raw)
            or claimed != "sha256:" + fixed["source_sha256"]):
        raise ValueError("Only exact fixed source Context bytes are permitted.")


def validate_source_context(payload, temp_root):
    fixed = source_context_fixture()
    root = regular_context_directory(payload, temp_root)
    rag = payload.kind == "rag-database"
    if (payload.kind not in ("rag-database", "markdown-context-pack")
            or payload.name != fixed["rag_name" if rag else "pack_name"]
            or payload.manualEntries or len(payload.sources) != 1):
        raise ValueError("Only the named fixed source Context preparation is permitted.")
    fixed_context_chunking(payload.chunking, rag)
    validate_fixed_context_source(payload.sources[0], root, fixed)
    if rag:
        fixed_context_checks(payload.sourceChecks)
        if (payload.contextPack is not None or payload.embedding is None
                or payload.embedding.provider != "transformers" or payload.embedding.modelId != fixed["embedding_model"]
                or payload.embedding.device != "cpu" or payload.embedding.batchSize != 16
                or payload.embedding.dimensions not in (None, 384)):
            raise ValueError("Only the fixed CPU embedding fixture is permitted.")
    elif (payload.embedding is not None or payload.sourceChecks is not None or payload.contextPack is None
          or fixture_mapping(payload.contextPack) != {"inputMode": "source-materials", "method": "none", "cleaningPreset": "standard"}):
        raise ValueError("Only the fixed model-free source pack is permitted.")


def fixed_context_embeddings(texts, settings):
    fixed = source_context_fixture()
    if (settings.provider != "transformers" or settings.modelId != fixed["embedding_model"]
            or settings.device != "cpu" or settings.dimensions not in (None, 384)
            or settings.batchSize not in (1, 16) or type(texts) is not list or not 1 <= len(texts) <= 8):
        raise ValueError("Only the bounded finite CPU embedding fixture is permitted.")
    normalize = lambda text: " ".join(re.findall(r"[a-z0-9]+", text.lower()))
    original = normalize(fixed["source_markdown"])
    vectors = []
    for text in texts:
        if type(text) is not str or not 0 < len(text) <= 2048:
            raise ValueError("Only bounded fixed embedding text is permitted.")
        normalized = normalize(text)
        if text != fixed["query"] and (not normalized or normalized not in original):
            raise ValueError("Embedding text must come from the fixed source or query.")
        axis = 0 if text == fixed["query"] or "line a connects" in normalized else 1 if "museum" in normalized else 2
        vector = [0.0] * 384
        vector[axis] = 1.0
        vectors.append(vector)
    return vectors


def fixed_package_manifest(raw, rag):
    """Bound archive reads before production package/table validation."""
    with zipfile.ZipFile(io.BytesIO(raw)) as archive:
        entries = archive.infolist()
        if not 1 <= len(entries) <= (32 if rag else 4) or sum(info.file_size for info in entries) > (2 * 1024 * 1024 if rag else 16384):
            raise ValueError("The fixed Context package exceeded its limits.")
        names = set()
        for info in entries:
            parts = PurePosixPath(info.filename).parts
            mode = info.external_attr >> 16
            allowed = (info.filename == "manifest.json" or (len(parts) > 1 and parts[0] == "database")) if rag else (
                info.filename in {"manifest.json", "README.md", "topics.md", "sources.md", "context.md"})
            if (info.filename in names or not parts or "\\" in info.filename
                    or info.filename.startswith("/") or any(part in (".", "..") or ":" in part for part in parts)
                    or str(PurePosixPath(info.filename)) != info.filename or info.is_dir() or info.flag_bits & 1
                    or (stat.S_IFMT(mode) not in (0, stat.S_IFREG))
                    or not allowed):
                raise ValueError("Only bounded regular fixed Context entries are permitted.")
            names.add(info.filename)
        if ("manifest.json" not in names or (rag and not any(name.startswith("database/") for name in names))
                or (not rag and names not in ({"manifest.json", "README.md", "context.md"}, {"manifest.json", "README.md", "topics.md", "sources.md"}))):
            raise ValueError("The fixed Context package is incomplete.")
        info = archive.getinfo("manifest.json")
        if not 0 < info.file_size <= 16384:
            raise ValueError("The fixed RAG manifest exceeded its limit.")
        manifest = json.loads(archive.read(info))
    return manifest, names


def validate_fixed_source_package(raw, fixed, rag):
    manifest, names = fixed_package_manifest(raw, rag)
    if not rag and names != {"manifest.json", "README.md", "topics.md", "sources.md"}:
        raise ValueError("Only the fixed source pack members are permitted.")
    keys = {"schemaVersion", "kind", "name", "mediaType", "createdAt", "sources", "manualEntries", "chunking"}
    keys.update({"sourceChecks", "embedding"} if rag else {"contextPack"})
    media_type = "application/vnd.ai-system-builder.rag-database+lancedb+zip" if rag else "application/vnd.ai-system-builder.markdown-context-pack+zip"
    if (type(manifest) is not dict or set(manifest) != keys
            or manifest["schemaVersion"] != "1" or manifest["kind"] != ("rag-database" if rag else "markdown-context-pack")
            or manifest["name"] != fixed["rag_name" if rag else "pack_name"] or manifest["mediaType"] != media_type
            or type(manifest["createdAt"]) is not str or not 1 <= len(manifest["createdAt"]) <= 80
            or manifest["manualEntries"] != [] or type(manifest["sources"]) is not list
            or len(manifest["sources"]) != 1):
        raise ValueError("Only the declared fixed Context manifest is permitted.")
    fixed_context_chunking(manifest["chunking"], rag)
    if rag:
        fixed_context_checks(manifest["sourceChecks"])
        if manifest["embedding"] != {"provider": "transformers", "modelId": fixed["embedding_model"], "dimensions": 384}:
            raise ValueError("Only the declared fixed RAG embedding manifest is permitted.")
    elif manifest["contextPack"] != {"inputMode": "source-materials", "method": "none", "cleaningPreset": "standard"}:
        raise ValueError("Only the declared fixed source pack is permitted.")
    source = manifest["sources"][0]
    if (type(source) is not dict or set(source) != {"artifactId", "digest", "mediaType", "originalName", "sizeBytes", "chunkCount", "chunkingMode"}
            or type(source["artifactId"]) is not str or not 1 <= len(source["artifactId"]) <= 512
            or source["digest"] != "sha256:" + fixed["source_sha256"]
            or source["mediaType"] != "text/markdown" or source["originalName"] != fixed["source_name"]
            or source["sizeBytes"] != len(fixed["source_markdown"].encode("utf-8"))
            or type(source["chunkCount"]) is not int or not 1 <= source["chunkCount"] <= 8
            or source["chunkingMode"] != "extracted"):
        raise ValueError("Only the declared fixed source lineage is permitted.")


def validate_fixed_rag_package(raw, fixed):
    validate_fixed_source_package(raw, fixed, True)


def validate_source_context_operation(payload, temp_root):
    fixed = source_context_fixture()
    if payload.operation not in ("inspect-source", "inspect-artifact", "query"):
        raise ValueError("Only fixed source Context operations are permitted.")
    root = regular_context_directory(payload, temp_root, operation=True)
    if Path(payload.localPath) != root / "input.bin":
        raise ValueError("Only the current staged Context input is permitted.")
    if payload.operation == "inspect-source":
        if any(getattr(payload, key) is not None for key in ("query", "maximumResults", "embeddingDevice", "sourceInformation")):
            raise ValueError("The fixed source inspection request is invalid.")
        validate_fixed_context_source(payload, root, fixed, operation=True)
        if payload.chunking is None:
            raise ValueError("Fixed source inspection requires chunk settings.")
        fixed_context_chunking(payload.chunking, payload.chunking.strategy == "fixed-length")
        if payload.sourceChecks is not None:
            fixed_context_checks(payload.sourceChecks)
        return
    if (payload.mediaType != "application/vnd.ai-system-builder.rag-database+lancedb+zip"
            or any(getattr(payload, key) is not None for key in ("chunking", "sourceChecks", "sourceInformation"))
            or type(payload.sizeBytes) is not int or not 0 < payload.sizeBytes <= 512 * 1024):
        raise ValueError("Only bounded fixed RAG package operations are permitted.")
    if payload.operation == "query":
        if (payload.query != fixed["query"] or payload.maximumResults != 5
                or payload.embeddingDevice not in (None, "cpu")):
            raise ValueError("Only the fixed CPU query is permitted.")
    elif any(getattr(payload, key) is not None for key in ("query", "maximumResults", "embeddingDevice")):
        raise ValueError("The fixed RAG inspection request is invalid.")
    raw = stable_fixture_bytes(root / "input.bin", 512 * 1024)
    if payload.sizeBytes != len(raw) or payload.digest != "sha256:" + hashlib.sha256(raw).hexdigest():
        raise ValueError("The staged fixed RAG bytes do not match their identity.")
    validate_fixed_rag_package(raw, fixed)


def run_context_fixture(payload, temp_root, processor, **kwargs):
    if payload.name == manual_fixture()["name"]:
        validate_manual_context(payload, temp_root)
    else:
        validate_source_context(payload, temp_root)
    return processor(payload, embedding_provider=fixed_context_embeddings, **kwargs)


def run_context_operation_fixture(payload, temp_root, processor, **kwargs):
    if payload.mediaType == "application/vnd.ai-system-builder.markdown-context-pack+zip":
        validate_manual_inspection(payload, temp_root)
        raw = stable_fixture_bytes(Path(payload.localPath), 16384)
        if payload.sizeBytes != len(raw) or payload.digest != "sha256:" + hashlib.sha256(raw).hexdigest():
            raise ValueError("The staged fixed pack bytes do not match their identity.")
        manifest, names = fixed_package_manifest(raw, False)
        fixed = manual_fixture()
        if type(manifest) is dict and manifest.get("name") == fixed["name"]:
            if (names != {"manifest.json", "README.md", "context.md"} or manifest.get("sources") != []
                    or manifest.get("manualEntries") != [{"id": "manual-entry-1", "title": fixed["name"],
                        "digest": "sha256:" + hashlib.sha256(fixed["markdown"].encode("utf-8")).hexdigest()}]):
                raise ValueError("Only the fixed manual pack identity is permitted.")
        else:
            validate_fixed_source_package(raw, source_context_fixture(), False)
    else:
        validate_source_context_operation(payload, temp_root)
    return processor(payload, embedding_provider=fixed_context_embeddings, **kwargs)


def validate_row_review_fixture(value):
    if (type(value) is not dict or set(value) != {"schema_version", "source_name", "dataset_name", "edit_suffix", "rows"}
            or value["schema_version"] != "fixed-saved-row-review-v1"
            or value["source_name"] != "synthetic-provided-row-review.csv"
            or value["dataset_name"] != "saved-row-review-qualification"
            or value["edit_suffix"] != " Please confirm."
            or type(value["rows"]) is not list or len(value["rows"]) != 8):
        raise ValueError("The fixed row-review fixture is invalid.")
    for row in value["rows"]:
        if (type(row) is not dict or set(row) != {"text", "label"}
                or type(row["text"]) is not str or not 1 <= len(row["text"]) <= 256
                or any(character in row["text"] for character in ("\r", "\n", ",", '"', "\0"))
                or row["label"] not in ("invoice", "receipt", "order", "report")):
            raise ValueError("The fixed row-review rows are invalid.")
    if len({row["text"] for row in value["rows"]}) != 8:
        raise ValueError("The fixed row-review rows are invalid.")
    return value


def row_review_fixture():
    source = Path(__file__).parent / "daily-row-review-fixture.json"
    info = source.lstat()
    if (not stat.S_ISREG(info.st_mode) or source.resolve() != source
            or getattr(info, "st_file_attributes", 0) & 0x400 or not 0 < info.st_size <= 4096):
        raise ValueError("The fixed row-review fixture is unavailable.")
    with source.open("rb") as stream:
        raw = stream.read(4097)
    if len(raw) > 4096:
        raise ValueError("The fixed row-review fixture exceeded its limit.")
    return validate_row_review_fixture(json.loads(raw))


def row_review_csv(fixed):
    value = validate_row_review_fixture(fixed)
    return ("text,label\n" + "".join(row["text"] + "," + row["label"] + "\n" for row in value["rows"])).encode("utf-8")


def validate_fixed_row_review_source(source):
    fixed = row_review_fixture()
    if source.originalName != fixed["source_name"]:
        raise ValueError("Only the fixed row-review source is permitted.")
    candidate = Path(source.localPath)
    before = candidate.lstat()
    if before.st_nlink != 1:
        raise ValueError("A single current row-review source is required.")
    with candidate.open("rb") as stream:
        opened = os.fstat(stream.fileno())
        raw = stream.read(16_385)
        after = os.fstat(stream.fileno())
    current = candidate.lstat()
    witness = lambda info: (info.st_dev, info.st_ino, info.st_size, info.st_mtime_ns, info.st_nlink)
    if (not stat.S_ISREG(opened.st_mode) or witness(before) != witness(opened)
            or witness(opened) != witness(after) or witness(after) != witness(current)
            or len(raw) > 16_384 or raw != row_review_csv(fixed)):
        raise ValueError("Only the exact fixed row-review bytes are permitted.")


def context_temp_root(repo_root):
    root = Path(repo_root)
    run = Path(os.getenv("AISB_LOCAL_DESKTOP_UI_RUN", ""))
    expected = root.parent / "t"
    if (not re.fullmatch(r".*/\.local-codex/q/[a-f0-9]{8}/c", root.as_posix()) or root.resolve() != root
            or run.parent != root / ".local-codex/native-fixed-host-operator/runs"
            or not re.fullmatch(r"[a-f0-9]{32}", run.name)
            or os.getenv("TEMP") != str(expected) or os.getenv("TMP") != str(expected)):
        raise ValueError("The reviewed current Context temp root is required.")
    return expected


def regular_context_directory(payload, temp_root, operation=False):
    root = Path(payload.runtime.runtimeWorkingDirectory)
    prefix = "ai-system-builder-context-operation-" if operation else "ai-system-builder-context-"
    if (not root.is_absolute() or root.parent != temp_root
            or not re.fullmatch(re.escape(prefix) + r"[A-Za-z0-9]{6,32}", root.name) or root.resolve() != root):
        raise ValueError("A current staged Context directory is required.")
    for directory in (temp_root, root):
        info = directory.lstat()
        if not stat.S_ISDIR(info.st_mode) or getattr(info, "st_file_attributes", 0) & 0x400:
            raise ValueError("A regular staged Context directory is required.")
    return root


def validate_manual_context(payload, temp_root):
    fixed = manual_fixture()
    if (payload.kind != "markdown-context-pack" or payload.name != fixed["name"] or payload.sources
            or len(payload.manualEntries) != 1 or payload.embedding is not None
            or payload.contextPack is None or payload.contextPack.inputMode != "manual"
            or payload.contextPack.method != "none" or payload.contextPack.model is not None):
        raise ValueError("Only the fixed manual Context pack is permitted.")
    entry = payload.manualEntries[0]
    if (entry.id != "manual-entry-1" or entry.title != fixed["name"] or entry.content != fixed["markdown"]
            or entry.digest != "sha256:" + hashlib.sha256(fixed["markdown"].encode("utf-8")).hexdigest()):
        raise ValueError("Only the fixed manual Context bytes are permitted.")
    regular_context_directory(payload, temp_root)


def validate_manual_inspection(payload, temp_root):
    if (payload.operation != "inspect-artifact"
            or payload.mediaType != "application/vnd.ai-system-builder.markdown-context-pack+zip"
            or any(getattr(payload, key) is not None for key in (
                "query", "maximumResults", "embeddingDevice", "chunking", "sourceChecks", "sourceInformation"))):
        raise ValueError("Only bounded manual Context inspection is permitted.")
    root = regular_context_directory(payload, temp_root, operation=True)
    if Path(payload.localPath) != root / "input.bin" or not 0 < payload.sizeBytes <= 16_384:
        raise ValueError("Only the staged Context package is permitted.")
    require_regular_source(root, payload)


def require_regular_source(root, source):
    candidate = Path(source.localPath)
    if not candidate.is_absolute() or candidate.resolve() != candidate or not candidate.is_relative_to(root):
        raise ValueError("A current qualification source is required.")
    for item in (root, *[root.joinpath(*candidate.relative_to(root).parts[:i])
                         for i in range(1, len(candidate.relative_to(root).parts) + 1)]):
        info = item.lstat()
        if stat.S_ISLNK(info.st_mode) or getattr(info, "st_file_attributes", 0) & 0x400:
            raise ValueError("A regular qualification source is required.")
    info = candidate.lstat()
    if not stat.S_ISREG(info.st_mode) or not 0 < info.st_size <= 16_384:
        raise ValueError("The provided qualification source exceeded its limit.")


def validate_provided(payload, root):
    plan, recipe = payload.preparation, payload.recipe
    if (plan is None or plan.method != "validate-and-split" or plan.generationMode != "none"
            or plan.inputIntent != "use-existing-dataset" or plan.sourceKinds != ["structured"]
            or recipe.task is None or recipe.task.get("taskType") != "llm-classification"
            or recipe.task.get("textInputMode") != "provided"
            or any(value is not None for value in (recipe.generation, recipe.normalization, recipe.chunking, payload.advanced))
            or len(payload.sourceInputs) != 1 or payload.output.format not in ("jsonl", "parquet")):
        raise ValueError("Only the declared provided-data preparation is permitted.")
    source = payload.sourceInputs[0]
    if source.mediaType != "text/csv":
        raise ValueError("Only the declared synthetic source is permitted.")
    require_regular_source(root, source)
    if payload.output.format == "parquet":
        validate_fixed_row_review_source(source)
    elif source.originalName != "synthetic-provided.csv":
        raise ValueError("Only the declared synthetic source is permitted.")


def dispatch_allowed(request):
    if request.taskType not in ("prepare-training-dataset", "review-dataset", "generate-context-artifact", "context-artifact-operation"):
        raise ValueError("This qualification worker cannot execute that task.")


def write_failure_fact(cache, boundary, error, sequence):
    if boundary not in ("task", "preparation") or type(sequence) is not int or not 1 <= sequence <= 16:
        raise ValueError("The qualification failure journal limit was exceeded.")
    name = type(error).__name__
    if name not in ("ValueError", "RuntimeError", "DatasetPreparationCancellationRequested"):
        name = "other"
    body = json.dumps({"schema_version": "provided-dataset-failure-v1", "pid": os.getpid(),
                       "sequence": sequence, "boundary": boundary, "type": name})
    with (cache / f"qualification-provided-failure-{os.getpid()}-{sequence}.json").open("x", encoding="utf-8") as stream:
        stream.write(body)


def main():
    if sys.argv[1:] or os.name != "nt" or any(os.getenv(key) != "1" for key in (
            "HF_HUB_OFFLINE", "TRANSFORMERS_OFFLINE", "PIP_NO_INDEX")):
        raise RuntimeError("Fixed offline Windows provided-data qualification is required.")
    root = Path(__file__).resolve().parents[4]
    owned = root / "artifacts/qualification/visual-composer"
    worker = root / "out/ai-system-builder-win32-x64/resources/worker"
    if Path.cwd().resolve() != worker or worker.resolve() != worker:
        raise RuntimeError("The newly packaged worker resource is required.")
    cache = Path(os.getenv("HF_HUB_CACHE", ""))
    if (not cache.is_absolute() or cache.resolve() != cache or not cache.is_relative_to(owned)
            or not cache.is_dir()):
        raise RuntimeError("A current isolated qualification cache is required.")
    # Inspect every directory, including Windows junctions, before writing facts.
    for directory in (owned, *[owned.joinpath(*cache.relative_to(owned).parts[:i])
                              for i in range(1, len(cache.relative_to(owned).parts) + 1)]):
        info = directory.lstat()
        if not stat.S_ISDIR(info.st_mode) or getattr(info, "st_file_attributes", 0) & 0x400:
            raise RuntimeError("A regular qualification cache is required.")
    spec = importlib.util.spec_from_file_location("aisb_provided_qualification_main", worker / "main.py")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    host, port = module._resolve_launch_configuration()  # Production loopback/token checks.
    application = importlib.import_module("_ai_system_builder_worker.app")
    task = importlib.import_module("_ai_system_builder_worker.tasks.prepare_training_dataset")
    original_prepare, original_dispatch = task.prepare_training_dataset, application._run_task
    original_context = application.generate_context_artifact
    original_inspection = application.operate_on_context_artifact
    with (cache / f"qualification-worker-identity-{os.getpid()}.json").open("x", encoding="utf-8") as stream:
        json.dump({"pid": os.getpid(), "parentPid": os.getppid(), "scenario": "dataset-profile"}, stream)
    failures = 0

    def observe(operation, boundary):
        def run(*args, **kwargs):
            nonlocal failures
            try:
                return operation(*args, **kwargs)
            except Exception as error:
                if failures < 16:
                    failures += 1
                    try:
                        write_failure_fact(cache, boundary, error, failures)
                    except Exception:
                        pass  # Never change the real task outcome to obtain diagnostics.
                raise
        return run

    def prepare(payload, **kwargs):
        validate_provided(payload, owned)
        return original_prepare(payload, **kwargs)

    def dispatch(request):
        dispatch_allowed(request)
        return original_dispatch(request)

    def deny_download(*args, **kwargs):
        raise ValueError("Model downloads are unavailable in this qualification fixture.")

    application.prepare_training_dataset = observe(prepare, "preparation")
    def context(payload, **kwargs):
        return run_context_fixture(payload, context_temp_root(root), original_context, **kwargs)

    def inspect_context(payload, **kwargs):
        return run_context_operation_fixture(payload, context_temp_root(root), original_inspection, **kwargs)

    application.generate_context_artifact = observe(context, "task")
    application.operate_on_context_artifact = observe(inspect_context, "task")
    application._run_task = observe(dispatch, "task")
    application._ensure_model_download_data = deny_download
    import uvicorn
    uvicorn.run(module.app, host=host, port=port, reload=False, access_log=False)


if __name__ == "__main__":
    try:
        main()
    except Exception:
        print(json.dumps({"event": "qualification.provided.entry-failed"}), flush=True)
        raise SystemExit(1) from None
