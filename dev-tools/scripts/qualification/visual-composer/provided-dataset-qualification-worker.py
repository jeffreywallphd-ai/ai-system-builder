"""Fixed provided-data/manual Context qualification: real packaged processors.

The outer reviewed operator owns finite native limits and exact source identity.
This entry cannot run arbitrary tasks, downloads, model generation or OCR.
"""
from __future__ import annotations
import importlib
import importlib.util
import hashlib
import json
import os
from pathlib import Path
import re
import stat
import sys


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
            or len(payload.sourceInputs) != 1 or payload.output.format != "jsonl"):
        raise ValueError("Only the declared provided-data preparation is permitted.")
    source = payload.sourceInputs[0]
    if source.mediaType != "text/csv" or source.originalName != "synthetic-provided.csv":
        raise ValueError("Only the declared synthetic source is permitted.")
    require_regular_source(root, source)


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
        validate_manual_context(payload, context_temp_root(root))
        return original_context(payload, **kwargs)

    def inspect_context(payload, **kwargs):
        validate_manual_inspection(payload, context_temp_root(root))
        return original_inspection(payload, **kwargs)

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
