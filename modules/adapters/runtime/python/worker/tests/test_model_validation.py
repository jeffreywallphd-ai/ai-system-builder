from __future__ import annotations

import json
import hashlib
import struct
from pathlib import Path

import pytest

from modules.adapters.runtime.python.worker.tasks import model_validation as validation_module
from modules.adapters.runtime.python.worker.tasks.model_validation import validate_model_output


def _protected_result(method="full-finetune", records=False, tensor=None):
    adapter = method != "full-finetune"
    weight = "adapter_model.safetensors" if adapter else "model.safetensors"
    header = {"__metadata__":{"format":"pt"},"layer.weight":{"dtype":"F32","shape":[2],"data_offsets":[0,8]}}
    if tensor is not None:header["layer.weight"] = tensor
    raw = json.dumps(header,separators=(",",":")).encode(); raw += b" "*((-len(raw))%8)
    blobs = {"tokenizer.json":b'{"model":{"type":"WordLevel","vocab":{"test":0},"unk_token":"test"}}',
        "adapter_config.json" if adapter else "config.json":
            b'{"peft_type":"LORA"}' if adapter else b'{"model_type":"gpt2"}',
        weight:struct.pack("<Q",len(raw))+raw+struct.pack("<ff",0.5,1.0)}
    run_id="11111111-1111-4111-8111-111111111111"
    if records:
        blobs["training-run.json"]=json.dumps({"runId":run_id,"startedAt":"2026-01-01T00:00:00+00:00",
            "method":method,"trainingTask":"llm-instruction","status":"training-complete",
            "candidateValidation":"pending","serializationManifestPath":"serialization_manifest.json"}).encode()
        blobs["serialization_manifest.json"]=json.dumps({"runId":run_id,"method":method,
            "trainingTask":"llm-instruction",
            "serialization":{"serializationFormat":"adapter-safetensors" if adapter else "safetensors",
                "safetensorsFiles":[weight]}}).encode()
    else:
        blobs["training-run.json"]=json.dumps({"runId":run_id,"startedAt":"2026-01-01T00:00:00+00:00",
            "method":method,"status":"checkpoint-snapshot","trainingStatus":"running",
            "checkpointStep":1,"candidateValidation":"pending"}).encode()
    return blobs


def _protected_events(blobs, split=4096):
    files=tuple((name,len(raw),hashlib.sha256(raw).hexdigest()) for name,raw in blobs.items())
    def events():
        for name,raw in blobs.items():
            for offset in range(0,len(raw),split):yield (name,offset,raw[offset:offset+split])
            yield (name,len(raw),b"")
    return files,events()


def _validate_protected(blobs=None, method="full-finetune", events=None, files=None, **limits):
    blobs=_protected_result(method) if blobs is None else blobs
    captured,stream=_protected_events(blobs)
    return validation_module.validate_protected_training_output_chunks(stream if events is None else events,
        captured if files is None else files,method=method,
        **{"maximum_copy_bytes":4*1024**2,"maximum_metadata_bytes":1024**2,"chunk_bytes":4096,**limits})


@pytest.mark.parametrize("method",["full-finetune","lora","qlora"])
@pytest.mark.parametrize("records",[False,True])
@pytest.mark.parametrize("split",[1,7,4096])
def test_protected_result_structures_are_path_free_and_support_split_headers(method,records,split,monkeypatch):
    blobs=_protected_result(method,records);files,events=_protected_events(blobs,split)
    def deny(*args,**kwargs):raise AssertionError("No SDK or filesystem access is allowed")
    with monkeypatch.context() as patcher:
        patcher.setattr(validation_module,"_safe_open_module",deny)
        patcher.setattr(Path,"open",deny)
        result=_validate_protected(blobs,method,events,files)
    assert result["tensorShapeSummary"] == {"layer.weight":[2]}
    assert result["profile"] == ("candidate" if records else "checkpoint")
    assert result["files"] == files
    assert not {"status","nativeVerified","saved","taskComplete","modelQuality"}.intersection(result)


@pytest.mark.parametrize("mutation",["hash","offset","short","no-marker","duplicate-marker","trailing","reordered","virtual-bytes"])
def test_protected_result_refuses_incomplete_or_misbound_streams(mutation):
    blobs=_protected_result();files,stream=_protected_events(blobs);events=list(stream)
    if mutation=="hash":files=((files[0][0],files[0][1],"a"*64),*files[1:])
    elif mutation=="offset":events[0]=(events[0][0],1,events[0][2])
    elif mutation=="short":events[0]=(events[0][0],0,events[0][2][:-1])
    elif mutation=="no-marker":events.pop()
    elif mutation=="duplicate-marker":events.insert(2,events[1])
    elif mutation=="trailing":events.append(events[-1])
    elif mutation=="reordered":events[0],events[2]=events[2],events[0]
    else:events[0]=(events[0][0],0,bytearray(events[0][2]))
    with pytest.raises(ValueError,match="protected training result structure"):_validate_protected(blobs,events=events,files=files)


@pytest.mark.parametrize("body",[
    b'{"model":{},"model":{}}',b'{"model":NaN}',b'{"model":1e999}',b'{"model":{"type":"Unknown"}}',
    b'[]',b'{"model":{"type":"WordLevel"},"auto_map":{"x":"custom.Code"}}',b'\xff',
])
def test_protected_result_refuses_invalid_metadata_without_sdk_execution(body):
    blobs=_protected_result();blobs["tokenizer.json"]=body
    with pytest.raises(ValueError,match="protected training result structure"):_validate_protected(blobs)


@pytest.mark.parametrize("tensor",[
    {"dtype":"UNKNOWN","shape":[2],"data_offsets":[0,8]},
    {"dtype":"F32","shape":[True],"data_offsets":[0,8]},
    {"dtype":"F32","shape":[-2],"data_offsets":[0,8]},
    {"dtype":"F32","shape":[3],"data_offsets":[0,8]},
    {"dtype":"F32","shape":[2],"data_offsets":[1,9]},
    {"dtype":"F32","shape":[0,2**53-1,2**53-1],"data_offsets":[0,0]},
])
def test_protected_result_refuses_invalid_tensor_shapes_and_offsets(tensor):
    with pytest.raises(ValueError,match="protected training result structure"):_validate_protected(_protected_result(tensor=tensor))


@pytest.mark.parametrize("name",["../config.json","config.json:extra","model.bin","other.safetensors"])
def test_protected_result_refuses_unapproved_file_names(name):
    blobs=_protected_result();blobs[name]=b"x"
    with pytest.raises(ValueError):_validate_protected(blobs)


@pytest.mark.parametrize("limits",[
    {"maximum_copy_bytes":True},{"maximum_copy_bytes":1},{"maximum_metadata_bytes":1},
    {"maximum_metadata_bytes":64*1024**2+1},{"chunk_bytes":4095},
])
def test_protected_result_preserves_explicit_bounds(limits):
    with pytest.raises(ValueError):_validate_protected(**limits)


@pytest.mark.parametrize("mutation",["partial","run-id","method","weight-file","status","manifest-path","training-task","missing-task"])
def test_protected_result_refuses_mismatched_final_records(mutation):
    blobs=_protected_result(records=True)
    if mutation=="partial":del blobs["serialization_manifest.json"]
    else:
        manifest=json.loads(blobs["serialization_manifest.json"])
        if mutation=="run-id":manifest["runId"]="different"
        elif mutation=="method":manifest["method"]="lora"
        elif mutation=="weight-file":manifest["serialization"]["safetensorsFiles"]=["other.safetensors"]
        elif mutation=="training-task":manifest["trainingTask"]="llm-classification"
        elif mutation=="missing-task":manifest.pop("trainingTask")
        elif mutation=="manifest-path":
            run=json.loads(blobs["training-run.json"]);run["serializationManifestPath"]="other.json";blobs["training-run.json"]=json.dumps(run).encode()
        else:
            run=json.loads(blobs["training-run.json"]);run["status"]="succeeded";blobs["training-run.json"]=json.dumps(run).encode()
        blobs["serialization_manifest.json"]=json.dumps(manifest).encode()
    with pytest.raises(ValueError):_validate_protected(blobs)


@pytest.mark.parametrize("field,value",[("auto_mapping",{"base_model_class":"Custom"}),
    ("auto_map",False),("trust_remote_code",0),("custom_pipelines",{"custom":"code"})])
def test_protected_result_refuses_existing_unsupported_code_declarations(field,value):
    blobs=_protected_result("lora",records=True);config=json.loads(blobs["adapter_config.json"]);config[field]=value
    blobs["adapter_config.json"]=json.dumps(config).encode()
    with pytest.raises(ValueError):_validate_protected(blobs,"lora")


def test_protected_result_does_not_interpret_vocabulary_tokens_as_code_declarations():
    blobs=_protected_result(records=True);blobs["vocab.json"]=b'{"auto_map":7,"auto_mapping":9}'
    assert _validate_protected(blobs)["metadata"]["vocab.json"]["auto_map"]==7


@pytest.mark.parametrize("mutation",["missing-run","step-zero","step-bool","not-running","final-without-manifest","extra-link"])
def test_protected_result_keeps_checkpoint_and_final_records_distinct(mutation):
    blobs=_protected_result();run=json.loads(blobs["training-run.json"])
    if mutation=="missing-run":del blobs["training-run.json"]
    else:
        if mutation=="step-zero":run["checkpointStep"]=0
        elif mutation=="step-bool":run["checkpointStep"]=True
        elif mutation=="not-running":run["trainingStatus"]="succeeded"
        elif mutation=="final-without-manifest":run["status"]="training-complete"
        else:run["serializationManifestPath"]="serialization_manifest.json"
        blobs["training-run.json"]=json.dumps(run).encode()
    with pytest.raises(ValueError):_validate_protected(blobs)


def test_protected_result_checks_configuration_flags_without_rejecting_vocabulary_words():
    blobs=_protected_result("lora")
    config=json.loads(blobs["adapter_config.json"]);config["nested"]={"auto_mapping":{"class":"Custom"}}
    blobs["adapter_config.json"]=json.dumps(config).encode()
    with pytest.raises(ValueError):_validate_protected(blobs,"lora")
    config["nested"]={"auto_mapping":None,"auto_map":{},"_auto_class":None,"trust_remote_code":False}
    blobs["adapter_config.json"]=json.dumps(config).encode()
    tokenizer=json.loads(blobs["tokenizer.json"]);tokenizer["model"]["vocab"]["auto_mapping"]=9
    blobs["tokenizer.json"]=json.dumps(tokenizer).encode()
    assert _validate_protected(blobs,"lora")["metadata"]["tokenizer.json"]["model"]["vocab"]["auto_mapping"]==9


def test_protected_result_preserves_separate_history_and_model_metadata_budgets():
    blobs=_protected_result(records=True)
    metadata_bytes=sum(len(raw) for name,raw in blobs.items() if name not in
        ("model.safetensors","training-run.json","serialization_manifest.json"))
    assert _validate_protected(blobs,maximum_metadata_bytes=metadata_bytes)["profile"]=="candidate"
    run=json.loads(blobs["training-run.json"]);run["history"]="x"*(128*1024)
    blobs["training-run.json"]=json.dumps(run).encode()
    with pytest.raises(ValueError):_validate_protected(blobs,maximum_metadata_bytes=metadata_bytes)


def test_protected_result_requires_source_exhaustion_and_redacts_source_errors():
    blobs=_protected_result();files,events=_protected_events(blobs)
    def interrupted():
        yield from events
        raise RuntimeError("synthetic-private-location")
    with pytest.raises(ValueError) as error:_validate_protected(blobs,events=interrupted(),files=files)
    assert str(error.value)=="The protected training result structure is unavailable."


def test_protected_result_matches_installed_safetensors_serialization_without_a_model():
    import numpy as np
    from safetensors.numpy import save
    blobs=_protected_result()
    blobs["model.safetensors"]=save({"layer.weight":np.array([0.5,1.0],dtype=np.float32)},metadata={"format":"pt"})
    assert _validate_protected(blobs)["tensorShapeSummary"]=={"layer.weight":[2]}


@pytest.mark.parametrize("mutation",["length","alignment","truncated","duplicate","trailing-body","overlap"])
def test_protected_result_refuses_malformed_or_inconsistent_safe_tensor_headers(mutation):
    blobs=_protected_result();raw=blobs["model.safetensors"]
    if mutation=="length":raw=struct.pack("<Q",1024**2+8)+raw[8:]
    elif mutation=="alignment":raw=struct.pack("<Q",3)+b"{} "+raw[-8:]
    elif mutation=="truncated":raw=struct.pack("<Q",len(raw)*2)+raw[8:]
    elif mutation=="trailing-body":raw+=b"x"
    else:
        header=b'{"__metadata__":{"format":"pt"},"x":{"dtype":"F32","shape":[2],"data_offsets":[0,8]},'
        header+=(b'"x"' if mutation=="duplicate" else b'"y"')+b':{"dtype":"F32","shape":[2],"data_offsets":[0,8]}}'
        header+=b" "*((-len(header))%8);raw=struct.pack("<Q",len(header))+header+raw[-8:]
    blobs["model.safetensors"]=raw
    with pytest.raises(ValueError):_validate_protected(blobs)


def test_protected_result_handles_weight_bodies_larger_than_its_metadata_budget():
    blobs=_protected_result()
    count=512*1024
    header=json.dumps({"__metadata__":{"format":"pt"},"layer.weight":{
        "dtype":"F32","shape":[count],"data_offsets":[0,count*4]}},separators=(",",":")).encode()
    header+=b" "*((-len(header))%8)
    blobs["model.safetensors"]=struct.pack("<Q",len(header))+header+b"\0"*(count*4)
    result=_validate_protected(blobs,maximum_metadata_bytes=4096)
    assert result["tensorShapeSummary"]=={"layer.weight":[count]}
    assert len(repr(result))<4096  # The internal report contains no tensor body.


@pytest.mark.parametrize("method",["full-finetune","lora","qlora"])
def test_protected_result_reads_actual_synthetic_pipeline_checkpoint_and_final_profiles(monkeypatch,method):
    from modules.adapters.runtime.python.worker.tests.test_train_model_task import (
        _protected_pipeline_fixture, train_model_module as training)
    with _protected_pipeline_fixture(monkeypatch,method=method) as (native,use,_,_,family,_,_,_,_,_):
        final=training._run_protected_training_pipeline(use)
        members=native._output_family_snapshot(family)["members"]
        profiles=[]
        for member in members:
            graph=member["graph"]
            original=native._training_output_readers[graph]
            files=tuple((name,size,sha) for _,_,_,name,size,sha in original["handles"])
            stream=native.read_original_training_output_chunks(graph,use.view,graph._request)
            result=validation_module.validate_protected_training_output_chunks(stream,files,
                method=use.payload.method,maximum_copy_bytes=graph.descriptor["maximumCopyBytes"],
                maximum_metadata_bytes=graph.descriptor["maximumCopyBytes"],chunk_bytes=graph.descriptor["bufferBytes"])
            profiles.append(result["profile"])
            assert native._training_output_readers[graph]["read_state"]=="complete"
        assert members[-1]["graph"] is final and profiles==["checkpoint","candidate"]


class _FakeSafeTensorReader:
    def __init__(self, tensor_shapes: dict[str, list[int]]):
        self._tensor_shapes = tensor_shapes

    def __enter__(self):
        return self

    def __exit__(self, exc_type, exc, tb):
        return False

    def keys(self):
        return list(self._tensor_shapes.keys())

    def get_tensor(self, key: str):
        class _FakeTensor:
            def __init__(self, shape: list[int]):
                self.shape = shape

        return _FakeTensor(self._tensor_shapes[key])


def _mock_safe_open(monkeypatch, by_file: dict[str, dict[str, list[int]]]) -> None:
    def _safe_open(path: str, framework: str = "pt", device: str = "cpu"):
        return _FakeSafeTensorReader(by_file.get(Path(path).name, {}))

    monkeypatch.setattr(validation_module, "_safe_open_module", lambda: _safe_open)


def test_validate_missing_model_path_is_invalid(tmp_path: Path) -> None:
    missing = tmp_path / "missing-model"
    result = validate_model_output(missing)

    assert result["status"] == "invalid"
    assert result["validationReportPath"] is None
    assert result["validationDiffPath"] is None
    assert any("does not exist" in error for error in result["errors"])


def test_validate_missing_model_path_writes_report_to_fallback_directory(tmp_path: Path) -> None:
    missing = tmp_path / "missing-model"
    reports = tmp_path / "reports"

    result = validate_model_output(missing, report_output_dir=reports)

    assert result["status"] == "invalid"
    assert result["validationReportPath"] is not None
    assert result["validationDiffPath"] is not None
    assert Path(result["validationReportPath"]).exists()
    assert Path(result["validationDiffPath"]).exists()
    assert any("does not exist" in error for error in result["errors"])


def test_validate_model_path_must_be_directory(tmp_path: Path) -> None:
    model_file = tmp_path / "model.safetensors"
    model_file.write_bytes(b"x")
    result = validate_model_output(model_file)

    assert result["status"] == "invalid"
    assert any("not a directory" in error for error in result["errors"])


def test_validate_sharded_safetensors_detects_missing_shard(tmp_path: Path) -> None:
    (tmp_path / "model.safetensors.index.json").write_text(
        json.dumps({"weight_map": {"layer.0": "model-00001-of-00002.safetensors", "layer.1": "model-00002-of-00002.safetensors"}}),
        encoding="utf-8",
    )
    (tmp_path / "model-00001-of-00002.safetensors").write_bytes(b"x")

    result = validate_model_output(tmp_path)

    assert result["status"] == "invalid"
    assert result["shardCount"] == 2
    assert result["tensorChecksCompleted"] is False


@pytest.mark.parametrize(
    "unsafe_shard",
    [
        "../outside.safetensors",
        "/private/outside.safetensors",
        "C:/private/outside.safetensors",
        "shards\\outside.safetensors",
    ],
)
def test_validate_sharded_safetensors_rejects_unsafe_members(
    tmp_path: Path,
    unsafe_shard: str,
) -> None:
    (tmp_path / "model.safetensors.index.json").write_text(
        json.dumps({"weight_map": {"layer.0": unsafe_shard}}),
        encoding="utf-8",
    )

    result = validate_model_output(tmp_path)

    assert result["status"] == "invalid"
    assert any(
        "unsafe shard reference" in error
        or "out-of-root shard reference" in error
        for error in result["errors"]
    )


def test_validate_sharded_safetensors_accepts_contained_nested_member(
    monkeypatch,
    tmp_path: Path,
) -> None:
    shard_directory = tmp_path / "shards"
    shard_directory.mkdir()
    shard = shard_directory / "model-00001-of-00001.safetensors"
    shard.write_bytes(b"x")
    (tmp_path / "model.safetensors.index.json").write_text(
        json.dumps({"weight_map": {"layer.0": "shards/model-00001-of-00001.safetensors"}}),
        encoding="utf-8",
    )
    (tmp_path / "config.json").write_text("{}", encoding="utf-8")
    _mock_safe_open(
        monkeypatch,
        {"model-00001-of-00001.safetensors": {"layer.0": [2, 2]}},
    )

    result = validate_model_output(tmp_path)

    assert result["status"] in {"valid", "warning"}
    assert result["shardCount"] == 1


def test_validate_sharded_safetensors_rejects_linked_member(tmp_path: Path) -> None:
    outside = tmp_path.parent / "outside-shard.safetensors"
    outside.write_bytes(b"x")
    linked = tmp_path / "linked.safetensors"
    try:
        linked.symlink_to(outside)
    except OSError:
        pytest.skip("This host does not permit creating test symlinks.")
    (tmp_path / "model.safetensors.index.json").write_text(
        json.dumps({"weight_map": {"layer.0": "linked.safetensors"}}),
        encoding="utf-8",
    )

    result = validate_model_output(tmp_path)

    assert result["status"] == "invalid"
    assert any("linked shards" in error for error in result["errors"])


def test_validate_sharded_safetensors_detects_missing_tensor_key(monkeypatch, tmp_path: Path) -> None:
    (tmp_path / "model.safetensors.index.json").write_text(
        json.dumps({"weight_map": {"layer.0": "model-00001-of-00001.safetensors", "layer.1": "model-00001-of-00001.safetensors"}}),
        encoding="utf-8",
    )
    (tmp_path / "model-00001-of-00001.safetensors").write_bytes(b"x")
    (tmp_path / "config.json").write_text("{}", encoding="utf-8")
    _mock_safe_open(monkeypatch, {"model-00001-of-00001.safetensors": {"layer.0": [2, 2]}})

    result = validate_model_output(tmp_path)
    diff = json.loads((tmp_path / "model_validation_diff.json").read_text(encoding="utf-8"))

    assert result["status"] == "invalid"
    assert diff["missingTensorKeys"] == ["model-00001-of-00001.safetensors:layer.1"]


def test_validate_single_safetensors_reads_keys(monkeypatch, tmp_path: Path) -> None:
    (tmp_path / "model.safetensors").write_bytes(b"x")
    (tmp_path / "config.json").write_text("{}", encoding="utf-8")
    _mock_safe_open(monkeypatch, {"model.safetensors": {"decoder.layer.0": [4, 8]}})

    result = validate_model_output(tmp_path)
    diff = json.loads((tmp_path / "model_validation_diff.json").read_text(encoding="utf-8"))

    assert result["status"] in {"valid", "warning"}
    assert diff["tensorCount"] == 1
    assert diff["tensorShapeSummary"]["decoder.layer.0"] == [4, 8]


def test_validate_adapter_partial_output_is_invalid(tmp_path: Path) -> None:
    (tmp_path / "adapter_model.safetensors").write_bytes(b"x")

    result = validate_model_output(tmp_path, expected_lora=True)

    assert result["status"] == "invalid"
    assert any("partial" in error.lower() for error in result["errors"])


def test_validate_detects_recurrent_keys(monkeypatch, tmp_path: Path) -> None:
    (tmp_path / "model.safetensors").write_bytes(b"x")
    (tmp_path / "config.json").write_text("{}", encoding="utf-8")
    _mock_safe_open(monkeypatch, {"model.safetensors": {"decoder.recurrent.weight": [8, 8]}})

    result = validate_model_output(tmp_path, expected_recurrent_additions=True)
    diff = json.loads((tmp_path / "model_validation_diff.json").read_text(encoding="utf-8"))

    assert result["detectedRecurrentAdditions"] is True
    assert diff["detectedRecurrentKeys"] == ["decoder.recurrent.weight"]


def test_validate_detects_lora_tensor_keys(monkeypatch, tmp_path: Path) -> None:
    (tmp_path / "model.safetensors").write_bytes(b"x")
    (tmp_path / "config.json").write_text("{}", encoding="utf-8")
    _mock_safe_open(monkeypatch, {"model.safetensors": {"layers.0.attn.q_proj.lora_A.weight": [8, 4]}})

    result = validate_model_output(tmp_path, expected_lora=True)
    diff = json.loads((tmp_path / "model_validation_diff.json").read_text(encoding="utf-8"))

    assert result["detectedLoRA"] is True
    assert diff["detectedLoRAKeys"] == ["layers.0.attn.q_proj.lora_A.weight"]


def test_validate_diffusers_lora_weights(monkeypatch, tmp_path: Path) -> None:
    (tmp_path / "adapter_config.json").write_text("{}", encoding="utf-8")
    (tmp_path / "pytorch_lora_weights.safetensors").write_bytes(b"x")
    _mock_safe_open(monkeypatch, {"pytorch_lora_weights.safetensors": {"unet.down_blocks.0.attn.to_q.lora_A.weight": [8, 4]}})

    result = validate_model_output(tmp_path, expected_lora=True)
    diff = json.loads((tmp_path / "model_validation_diff.json").read_text(encoding="utf-8"))

    assert result["status"] in {"valid", "warning"}
    assert result["serializationFormat"] == "diffusers-lora-safetensors"
    assert result["detectedLoRA"] is True
    assert diff["hfCompatibility"]["adapterFiles"] is True


def test_publish_strict_validation_fails_when_tensor_checks_are_skipped(monkeypatch, tmp_path: Path) -> None:
    (tmp_path / "model.safetensors").write_bytes(b"x")
    (tmp_path / "config.json").write_text("{}", encoding="utf-8")
    monkeypatch.setattr(validation_module, "_safe_open_module", lambda: None)

    result = validate_model_output(tmp_path, validation_strictness="publish")
    diff = json.loads((tmp_path / "model_validation_diff.json").read_text(encoding="utf-8"))

    assert result["status"] == "invalid"
    assert result["tensorChecksCompleted"] is False
    assert diff["tensorChecksCompleted"] is False
    assert diff["validationStrictness"] == "publish"
    assert diff["validatedModelRef"] == "registered-model"
    assert "validatedModelPath" not in diff
    assert "validatedModelPath" not in result
    assert str(tmp_path) not in (tmp_path / "model_validation_diff.json").read_text(encoding="utf-8")


@pytest.mark.parametrize("strictness", ["normal", "publish"])
@pytest.mark.parametrize("kind", ["full", "adapter", "diffusers", "sharded"])
def test_corrupt_tensor_files_return_sanitized_invalid_result(tmp_path, strictness, kind):
    filename = {
        "full": "model.safetensors", "adapter": "adapter_model.safetensors",
        "diffusers": "pytorch_lora_weights.safetensors", "sharded": "part.safetensors",
    }[kind]
    (tmp_path / filename).write_bytes(b"invalid tensor header")
    (tmp_path / "config.json").write_text("{}")
    if kind in {"adapter", "diffusers"}:
        (tmp_path / "adapter_config.json").write_text("{}")
    if kind == "sharded":
        (tmp_path / "model.safetensors.index.json").write_text(json.dumps({"weight_map": {"weight": filename}}))
    result = validate_model_output(tmp_path, validation_strictness=strictness)
    diff_text = (tmp_path / "model_validation_diff.json").read_text()
    report_text = (tmp_path / "model_validation_report.md").read_text()
    assert result["status"] == "invalid"
    assert result["tensorChecksCompleted"] is False
    assert "Safetensors weights could not be read or validated." in result["errors"]
    assert json.loads(diff_text)["tensorCount"] == 0
    for text in (diff_text, report_text, json.dumps(result["errors"])):
        assert str(tmp_path) not in text
        assert "SafetensorError" not in text
        assert "invalid tensor header" not in text


@pytest.mark.parametrize("failure", ["open", "keys", "tensor", "shape"])
@pytest.mark.parametrize("strictness", ["normal", "publish"])
def test_tensor_reader_failures_discard_partial_observations(monkeypatch, tmp_path, failure, strictness):
    secret = "PRIVATE_READER_ERROR_DO_NOT_DISCLOSE"
    class Reader(_FakeSafeTensorReader):
        def keys(self):
            if failure == "keys":
                raise RuntimeError(secret)
            return ["first", "broken"]
        def get_tensor(self, key):
            if key == "broken":
                if failure == "tensor":
                    raise RuntimeError(secret)
                if failure == "shape":
                    return type("BadShape", (), {"shape": [secret]})()
            return super().get_tensor(key)
    def open_reader(*args, **kwargs):
        if failure == "open":
            raise RuntimeError(secret)
        return Reader({"first": [1], "broken": [2]})
    monkeypatch.setattr(validation_module, "_safe_open_module", lambda: open_reader)
    (tmp_path / "model.safetensors").write_bytes(b"fixture")
    (tmp_path / "config.json").write_text("{}")
    result = validate_model_output(tmp_path, validation_strictness=strictness)
    diff = json.loads((tmp_path / "model_validation_diff.json").read_text())
    assert result["status"] == "invalid"
    assert result["tensorChecksCompleted"] is False
    assert diff["tensorCount"] == 0
    assert diff["tensorShapeSummary"] == {}
    assert secret not in json.dumps(result)
    assert secret not in (tmp_path / "model_validation_report.md").read_text()


@pytest.mark.parametrize("index", [[], None, {"weight_map": {}}, {"weight_map": []}])
def test_invalid_or_empty_shard_index_is_a_structured_invalid_result(tmp_path, index):
    (tmp_path / "model.safetensors.index.json").write_text(json.dumps(index))
    (tmp_path / "config.json").write_text("{}")
    result = validate_model_output(tmp_path)
    assert result["status"] == "invalid"
    assert result["tensorChecksCompleted"] is False
    assert json.loads((tmp_path / "model_validation_diff.json").read_text())["tensorChecksCompleted"] is False
    assert "model.safetensors.index.json weight_map is invalid." in result["errors"]


@pytest.mark.parametrize("strictness", ["normal", "publish"])
@pytest.mark.parametrize("bad_first", [False, True])
def test_unreadable_shard_invalidates_all_tensor_facts_in_either_order(monkeypatch, tmp_path, strictness, bad_first):
    members = [("safe.lora_A.weight", "good.safetensors"), ("other.recurrent.weight", "bad.safetensors")]
    if bad_first:
        members.reverse()
    (tmp_path / "model.safetensors.index.json").write_text(json.dumps({"weight_map": dict(members)}))
    (tmp_path / "config.json").write_text("{}")
    for filename in ("good.safetensors", "bad.safetensors"):
        (tmp_path / filename).write_bytes(b"fixture")
    calls = []
    def read_shard(path, **kwargs):
        calls.append(Path(path).name)
        if Path(path).name == "bad.safetensors":
            raise RuntimeError("PRIVATE_SHARD_ERROR")
        return _FakeSafeTensorReader({"safe.lora_A.weight": [2, 2]})
    monkeypatch.setattr(validation_module, "_safe_open_module", lambda: read_shard)
    result = validate_model_output(tmp_path, validation_strictness=strictness)
    diff_text = (tmp_path / "model_validation_diff.json").read_text()
    diff = json.loads(diff_text)
    assert result["status"] == "invalid"
    assert result["tensorChecksCompleted"] is False
    assert diff["tensorCount"] == 0
    assert diff["tensorShapeSummary"] == {}
    assert diff["detectedLoRAKeys"] == []
    assert diff["detectedRecurrentKeys"] == []
    assert diff["missingTensorKeys"] == []
    assert result["detectedLoRA"] is False
    assert result["detectedRecurrentAdditions"] is False
    assert calls == (["bad.safetensors"] if bad_first else ["good.safetensors", "bad.safetensors"])
    assert "PRIVATE_SHARD_ERROR" not in json.dumps(result)
    assert "PRIVATE_SHARD_ERROR" not in diff_text


def test_empty_readable_shard_still_reports_missing_indexed_key(monkeypatch, tmp_path):
    (tmp_path / "model.safetensors.index.json").write_text(json.dumps({"weight_map": {"required": "part.safetensors"}}))
    (tmp_path / "part.safetensors").write_bytes(b"fixture")
    (tmp_path / "config.json").write_text("{}")
    _mock_safe_open(monkeypatch, {"part.safetensors": {}})
    result = validate_model_output(tmp_path)
    assert result["status"] == "invalid"
    assert any("part.safetensors:required" in error for error in result["errors"])


def test_missing_reader_dependency_remains_warning_for_normal_validation(monkeypatch, tmp_path):
    (tmp_path / "model.safetensors").write_bytes(b"fixture")
    (tmp_path / "config.json").write_text("{}")
    monkeypatch.setattr(validation_module, "_safe_open_module", lambda: None)
    result = validate_model_output(tmp_path)
    assert result["status"] == "warning"
    assert result["tensorChecksCompleted"] is False
    assert not result["errors"]
