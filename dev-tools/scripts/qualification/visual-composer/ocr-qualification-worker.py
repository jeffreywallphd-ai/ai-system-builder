"""Fixed OCR delivery fixture. Actual deployed task/reader; synthetic generation only.

Not a product launcher. The optional fixed fixture-writing role accepts no path,
code, model or provider selector. No downloads run.
"""
from __future__ import annotations
import importlib
import importlib.util
import hashlib
import json
import os
from pathlib import Path
import sys
import re
import time

MODEL_ID = "qualification/synthetic-ocr"
CANCEL_MODEL_ID = "qualification/synthetic-ocr-cancel"
LABELS = ("INVOICE 4826", "ORDER 7259", "TOTAL 3648", "RECEIPT 9152", "REPORT 8374")


def valid_model(generation):
    model = generation.model
    if (model.provider != "transformers" or model.modelId not in (MODEL_ID, CANCEL_MODEL_ID) or
            model.device != "cpu" or model.memoryMode != "standard" or
            model.memoryOverflowPolicy != "none" or model.adapterModelId is not None):
        raise ValueError("Synthetic OCR qualification requires its fixed model settings.")


def generate(chunks, generation):
    valid_model(generation)
    from _ai_system_builder_worker.tasks.example_generation import GeneratedQaExample
    if not 1 <= len(chunks) <= 16:
        raise ValueError("Synthetic OCR fixture bounds were exceeded.")
    rows = []
    for chunk in chunks:
        text = chunk.text.strip()
        if text not in LABELS:
            raise ValueError("Synthetic OCR fixture text did not match.")
        rows.append(GeneratedQaExample(artifact_id=chunk.artifact_id, chunk_index=chunk.chunk_index,
                    question=f"Explain {text}?", answer=text))
    return rows


def confined_directory(root, target):
    if root.resolve() != root or not target.is_relative_to(root):
        raise RuntimeError("A confined qualification directory is required.")
    for current in (root, *[root.joinpath(*target.relative_to(root).parts[:i])
                           for i in range(1, len(target.relative_to(root).parts) + 1)]):
        current.mkdir(exist_ok=True)
        info = current.lstat()
        if current.is_symlink() or not current.is_dir() or getattr(info, "st_file_attributes", 0) & 0x400:
            raise RuntimeError("The qualification directory is unavailable.")


def write_failure_fact(cache, boundary, error, sequence):
    """Closed diagnostic facts only; never format a task or supplier exception."""
    if boundary not in ("task", "preparation", "native") or type(sequence) is not int or not 1 <= sequence <= 16:
        raise ValueError("The qualification failure journal limit was exceeded.")
    failures = {
        "OcrUnavailable": ("ocr_unavailable", "normalization"),
        "OcrContractError": ("ocr_input_invalid", "normalization"),
        "OcrProcessError": ("ocr_process_failed", "normalization"),
        "DatasetPreparationCancellationRequested": ("cancelled", "unknown"),
        "ValueError": ("value_error", "unknown"),
        "RuntimeError": ("runtime_error", "unknown"),
    }
    name = type(error).__name__
    name = name if name in failures else "other"
    code, stage = failures.get(name, ("unknown", "unknown"))
    body = json.dumps({"schema_version": "qualified-ocr-failure-v1", "pid": os.getpid(),
                       "sequence": sequence, "boundary": boundary, "type": name,
                       "code": code, "stage": stage})
    if len(body.encode("utf-8")) > 4096:
        raise ValueError("The qualification failure journal limit was exceeded.")
    with (cache / f"qualification-ocr-failure-{os.getpid()}-{sequence}.json").open("x", encoding="utf-8") as stream:
        stream.write(body)


def observe_failure(operation, boundary, emit):
    def observed(*args, **kwargs):
        try:
            return operation(*args, **kwargs)
        except Exception as error:
            try:
                emit(boundary, error)
            except Exception:
                # A missing diagnostic cannot change the original failure or
                # supply successful qualification. Partial facts are retained.
                pass
            raise
    return observed


def write_fixture(root):
    run = os.getenv("VISUAL_COMPOSER_QUALIFICATION_RUN_ID", "")
    if not re.fullmatch(r"[a-z0-9-]{20,80}", run) or Path.cwd().resolve() != root:
        raise RuntimeError("A current qualification run is required.")
    folder = root / "artifacts/qualification/visual-composer/runs" / run / "ocr-dataset"
    confined_directory(root, folder)
    import ctypes
    from PIL import Image, ImageDraw, ImageFont, __version__ as pillow_version
    get_windows = ctypes.WinDLL("kernel32", use_last_error=True).GetWindowsDirectoryW
    get_windows.argtypes = [ctypes.c_wchar_p, ctypes.c_uint32]
    get_windows.restype = ctypes.c_uint32
    buffer = ctypes.create_unicode_buffer(32768)
    count = get_windows(buffer, len(buffer))
    if not 0 < count < len(buffer): raise RuntimeError("Installed fixture font is unavailable.")
    font_path = Path(buffer.value) / "Fonts/arial.ttf"
    font = ImageFont.truetype(str(font_path), 64)
    images = []
    for label in LABELS:
        image = Image.new("RGB", (1000, 400), "white")
        ImageDraw.Draw(image).text((60, 140), label, fill="black", font=font)
        images.append(image)
    pdf = folder / "synthetic-scan.pdf"
    with pdf.open("xb") as stream:
        images[0].save(stream, format="PDF", save_all=True, append_images=images[1:], resolution=144)
    if not 0 < pdf.stat().st_size <= 16 * 1024**2: raise RuntimeError("Fixture size exceeded its limit.")
    facts = {"schema_version": "synthetic-ocr-fixture-v1", "pages": len(LABELS),
             "sha256": hashlib.sha256(pdf.read_bytes()).hexdigest(), "bytes": pdf.stat().st_size,
             "font_sha256": hashlib.sha256(font_path.read_bytes()).hexdigest(), "pillow_version": pillow_version}
    with (folder / "fixture.json").open("x", encoding="utf-8") as stream: json.dump(facts, stream)
    print(json.dumps(facts))


def main():
    if sys.argv[1:] not in ([], ["--write-synthetic-fixture"]) or os.name != "nt" or any(os.getenv(name) != "1" for name in (
            "HF_HUB_OFFLINE", "TRANSFORMERS_OFFLINE", "PIP_NO_INDEX")):
        raise RuntimeError("Fixed offline Windows OCR qualification is required.")
    root = Path(__file__).resolve().parents[4]
    if sys.argv[1:]:
        write_fixture(root)
        return
    worker = root / "out/ai-system-builder-win32-x64/resources/worker"
    if (Path.cwd().resolve() != worker or worker.resolve() != worker or
            not (worker / "ocr/native/build/resource.json").is_file()):
        raise RuntimeError("The newly packaged OCR worker resource is required.")
    spec = importlib.util.spec_from_file_location("aisb_ocr_qualification_main", worker / "main.py")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    host, port = module._resolve_launch_configuration()  # Real launch token and loopback guard.
    application = importlib.import_module("_ai_system_builder_worker.app")
    task = importlib.import_module("_ai_system_builder_worker.tasks.prepare_training_dataset")
    native = importlib.import_module("_ai_system_builder_worker.ocr.windows_process")
    original_prepare = task.prepare_training_dataset
    original_dispatch = application._run_task
    original_exchange = native._execute
    exchange_count = 0
    failure_count = 0

    cache = Path(os.getenv("HF_HUB_CACHE", ""))
    if (not cache.is_absolute() or cache.resolve() != cache or
            not cache.is_relative_to(root / "artifacts/qualification/visual-composer")):
        raise RuntimeError("A current isolated qualification cache is required.")
    confined_directory(root, cache)
    with (cache / f"qualification-worker-identity-{os.getpid()}.json").open("x", encoding="utf-8") as stream:
        json.dump({"pid": os.getpid(), "parentPid": os.getppid(), "scenario": "ocr-documents"}, stream)

    def journal_failure(boundary, error):
        nonlocal failure_count
        if failure_count >= 16:
            return
        failure_count += 1
        write_failure_fact(cache, boundary, error, failure_count)

    def prepare(payload, **kwargs):
        if (payload.advanced is None or payload.advanced.content is None or
                payload.advanced.content.ocrEnabled is not True or
                payload.advanced.content.ocrLanguage not in ("en-US", "zz-ZZ") or
                payload.recipe.task is None or payload.recipe.task.get("taskType") != "llm-instruction" or
                len(payload.sourceInputs) != 1):
            raise ValueError("Only the declared synthetic OCR task is permitted.")
        valid_model(payload.recipe.generation)
        selected_generator = generate
        if payload.recipe.generation.model.modelId == CANCEL_MODEL_ID:
            def wait_for_cancellation(chunks, generation):
                # Recognition/source handling has actually completed before
                # the real task reaches this bounded synthetic generator.
                progress = kwargs.get("on_generation_progress")
                if progress:
                    progress({"message": "Synthetic cancellation check is running.",
                              "phase": "generation", "totalChunkCount": len(chunks), "processedChunkCount": 0})
                deadline = time.monotonic() + 15
                while time.monotonic() < deadline:
                    if kwargs["cancelled"](): raise task.DatasetPreparationCancellationRequested()
                    time.sleep(.02)
                raise ValueError("The synthetic cancellation check was not cancelled.")
            selected_generator = wait_for_cancellation
        return original_prepare(payload, example_generator=selected_generator, **kwargs)

    def dispatch(request):
        if request.taskType not in ("prepare-training-dataset", "review-dataset"):
            raise ValueError("This qualification worker cannot execute that task.")
        return original_dispatch(request)

    def deny_download(*args, **kwargs):
        raise ValueError("Model downloads are unavailable in this qualification fixture.")

    def exchange(frame, cancelled):
        nonlocal exchange_count
        if exchange_count >= 64: raise RuntimeError("Synthetic OCR exchange limit exceeded.")
        exchange_count += 1
        result, observed = original_exchange(frame, cancelled)
        # Exact native facts only. No frames, recognized text, paths, tokens,
        # supplier exceptions or task identifiers enter qualification logs.
        facts = {"event": "qualification.ocr.exchange", **{
            key: observed[key] for key in ("passed", "cleanup_confirmed", "all_handles_closed",
                "assigned_at_creation", "resumed_after_membership", "forced", "reason", "root_exit_code")},
            "active": observed["accounting"]["active"] if observed["accounting"] is not None else None}
        body = json.dumps({"schema_version": "qualified-ocr-native-exchange-v1", "sequence": exchange_count, **facts})
        if len(body.encode("utf-8")) > 4096: raise RuntimeError("Synthetic OCR journal limit exceeded.")
        with (cache / f"qualification-ocr-exchange-{os.getpid()}-{exchange_count}.json").open("x", encoding="utf-8") as stream:
            stream.write(body)
        print(json.dumps(facts), flush=True)
        return result, observed

    # Only model generation is replaced. Authentication, task registry, source
    # admission, native capture, OCR, curation, output and cancellation stay real.
    task._ensure_generation_model_ready = valid_model
    application.prepare_training_dataset = observe_failure(prepare, "preparation", journal_failure)
    application._run_task = observe_failure(dispatch, "task", journal_failure)
    application._ensure_model_download_data = deny_download
    native._execute = observe_failure(exchange, "native", journal_failure)
    import uvicorn
    uvicorn.run(module.app, host=host, port=port, reload=False, access_log=False)


if __name__ == "__main__":
    try:
        main()
    except Exception as error:
        print(json.dumps({"event": "qualification.ocr.entry-failed", "type": type(error).__name__}), flush=True)
        raise SystemExit(1) from None
