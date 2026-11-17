"""Task-local, host-issued scanned-PDF identities; no artifact authority here."""
from __future__ import annotations

from dataclasses import dataclass, field
from pathlib import PureWindowsPath
from typing import TYPE_CHECKING

from ..models import DatasetPreparationSourceInput, PrepareTrainingDatasetRequest
from .protocol import OcrContractError, validate_language

if TYPE_CHECKING:
    from .source_snapshot import OcrSourceBinding

PROTOCOL = "staged-pdf-ocr-v1"
CAPABILITY = "dataset-preparation.staged-pdf-ocr-v1"
_ERROR = "Scanned-PDF settings and source identities could not be verified."


def _need(value: object) -> None:
    if not value:
        raise OcrContractError(_ERROR)


@dataclass(frozen=True)
class OcrTaskSources:
    language: str
    stage_root: str = field(repr=False)
    bindings: tuple[OcrSourceBinding, ...] = field(repr=False)

    def __post_init__(self) -> None:
        from .source_snapshot import OcrSourceBinding
        validate_language(self.language)
        _need(type(self.stage_root) is str and type(self.bindings) is tuple and
              0 < len(self.bindings) <= 256)
        seen: set[str] = set()
        for index, binding in enumerate(self.bindings, 1):
            _need(type(binding) is OcrSourceBinding and binding.stage_root == self.stage_root and
                  binding.file_name == f"{index:04d}-source.pdf" and binding.artifact_id not in seen)
            seen.add(binding.artifact_id)

    def assert_inputs(self, sources: list[DatasetPreparationSourceInput]) -> None:
        OcrTaskSources.__post_init__(self)
        _need(type(sources) is list and len(sources) == len(self.bindings))
        for source, binding in zip(sources, self.bindings, strict=True):
            _need(isinstance(source, DatasetPreparationSourceInput) and
                  source.artifactId == binding.artifact_id and
                  source.localPath == str(PureWindowsPath(self.stage_root) / binding.file_name))
            _need(source.mediaType is None or type(source.mediaType) is str and
                  source.mediaType.split(";", 1)[0].strip().lower() == "application/pdf")


def task_ocr_sources(payload: PrepareTrainingDatasetRequest) -> OcrTaskSources | None:
    """Validate the entire map before any file read, model check or output.

    An authenticated host must have authorized each input before compiling this
    map. A matching hash is never an authorization decision. No source is
    discovered, resolved, adopted or read by this parser.
    """
    try:
        content = payload.advanced.content if payload.advanced is not None else None
        runtime = payload.runtime
        _need(content is None or content.ocrEnabled is None or type(content.ocrEnabled) is bool)
        active = content is not None and content.ocrEnabled is True
        if not active:
            _need(not isinstance(runtime, dict) or "ocrSources" not in runtime)
            _need(content is None or content.ocrLanguage is None)
            return None
        _need(payload.advanced.preset == "structure-aware" and
              content.strategy == "layout" and content.layoutEnabled is True)
        from .source_snapshot import OcrSourceBinding
        validate_language(content.ocrLanguage)
        plan = payload.preparation
        _need(plan is not None and plan.schemaVersion == "1" and
              plan.method == "structure-aware" and plan.inputIntent == "create-from-source-material" and
              plan.generationMode == "task-examples" and plan.sourceKinds == ["document"])
        _need(payload.recipe.normalization is not None and
              payload.recipe.normalization.targetFormat == "markdown")
        _need(type(runtime) is dict and type(runtime.get("runtimeWorkingDirectory")) is str)
        source_map = runtime.get("ocrSources")
        _need(type(source_map) is dict and set(source_map) == {"protocol", "sources"} and
              source_map["protocol"] == PROTOCOL)
        entries = source_map["sources"]
        _need(type(entries) is list and 0 < len(entries) <= 256 and
              len(entries) == len(payload.sourceInputs))
        root = runtime["runtimeWorkingDirectory"]
        bindings: list[OcrSourceBinding] = []
        seen: set[str] = set()
        for index, (source, entry) in enumerate(zip(payload.sourceInputs, entries, strict=True), 1):
            _need(type(entry) is dict and
                  set(entry) == {"artifactId", "fileName", "byteLength", "sha256"})
            binding = OcrSourceBinding(root, entry["fileName"], entry["artifactId"],
                                       entry["byteLength"], entry["sha256"])
            _need(binding.artifact_id == source.artifactId and binding.artifact_id not in seen and
                  binding.file_name == f"{index:04d}-source.pdf" and
                  source.localPath == str(PureWindowsPath(root) / binding.file_name))
            # The host's bound ordinal PDF name is authoritative for this path.
            # Display metadata can be absent; declared incompatible media denies.
            _need(source.mediaType is None or type(source.mediaType) is str and
                  source.mediaType.split(";", 1)[0].strip().lower() == "application/pdf")
            seen.add(binding.artifact_id)
            bindings.append(binding)
        return OcrTaskSources(content.ocrLanguage, root, tuple(bindings))
    except Exception:
        raise OcrContractError(_ERROR) from None
