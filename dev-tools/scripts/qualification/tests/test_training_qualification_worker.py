"""Finite inert dispatch tests: no production import, model or process launch."""
import copy
import importlib.util
from pathlib import Path
from types import SimpleNamespace
import unittest
import tempfile
import os
import json
import stat
import ast
from types import ModuleType
from unittest.mock import patch

spec = importlib.util.spec_from_file_location("training_worker", Path(__file__).parents[1] / "visual-composer/training-qualification-worker.py")
worker = importlib.util.module_from_spec(spec)
spec.loader.exec_module(worker)


class TrainingQualificationWorkerTests(unittest.TestCase):
    def setUp(self):
        self.fixture = {"workspaceId": "workspace.training", "baseModelRecordId": "model.input", "datasetArtifactIds": ["data.train", "data.validation"]}
        self.model, self.temp = Path("/owned/model"), Path("/owned/temp")
        self.request = SimpleNamespace(taskType="train-model", metadata={"workspaceId": "workspace.training"}, payload={"workspaceId": "workspace.training", "trainingTask": "llm-instruction", "method": "lora",
            "baseModel": {"modelRecordId": "model.input", "modelId": worker.MODEL_ID, "provider": "huggingface", "inferenceMode": "causal", "localPath": str(self.model)},
            "commonParameters": {"numEpochs": 1, "maxSteps": 1, "batchSize": 1, "learningRate": .0002, "maxSequenceLength": 64, "seed": 7},
            "advancedParameters": {"gradientAccumulationSteps": 1, "checkpointIntervalSteps": 100, "evalIntervalSteps": 100, "gradientCheckpointing": False, "lora": {"rank": 1, "alpha": 2, "dropout": .05}},
            "output": {"outputModelName": worker.OUTPUT_NAME, "maxShardSize": "2GB", "destination": {"local": {"enabled": True}}, "registration": {"displayName": "Training host support adapter", "artifactForm": "adapter"}},
            "validation": {"enabled": False, "expectedLoRA": True, "expectedRecurrentAdditions": False},
            "datasets": [{"artifactId": artifact, "splitRole": role, "format": "jsonl", "path": str(self.temp / f"{role}.jsonl")}
                         for artifact, role in zip(self.fixture["datasetArtifactIds"], ("train", "validation"))]})
        self.inspected, self.calls = [], []

    def dispatch(self, operation=None):
        return worker.single_training_dispatch(operation or (lambda request: self.calls.append(request) or "original-result"), self.fixture, self.model, self.temp,
            lambda root, target, maximum: self.inspected.append((root, target, maximum)))

    def test_real_delegate_receives_same_request_once_and_result_is_unchanged(self):
        dispatch = self.dispatch()
        self.assertEqual(dispatch(self.request), "original-result")
        self.assertIs(self.calls[0], self.request)
        self.assertEqual(len(self.inspected), 2)
        with self.assertRaises(ValueError): dispatch(self.request)
        self.assertEqual(len(self.calls), 1)

    def test_delegate_failure_is_never_changed_to_success_and_cannot_repeat(self):
        error = RuntimeError("synthetic-private-error")
        def fail(_): raise error
        dispatch = self.dispatch(fail)
        with self.assertRaises(RuntimeError) as actual: dispatch(self.request)
        self.assertIs(actual.exception, error)
        with self.assertRaises(ValueError): dispatch(self.request)

    def test_wrong_task_model_output_parameters_and_dataset_fail_before_delegate(self):
        variants = []
        for key, value in (("workspaceId", "workspace.other"), ("trainingTask", "diffusion-lora"), ("method", "full-finetune"), ("validation", {"enabled": True}), ("datasets", []), ("output", {"outputModelName": "other"})):
            candidate = copy.deepcopy(self.request); candidate.payload[key] = value; variants.append(candidate)
        for section, key, value in (("baseModel", "localPath", "/foreign/model"), ("baseModel", "modelRecordId", "other"), ("commonParameters", "maxSteps", 2), ("commonParameters", "numEpochs", True), ("output", "outputDirectory", "/foreign/output"), ("output", "destination", {"huggingFace": {"enabled": True}}), ("advancedParameters", "lora", {"rank": 4096}), ("advancedParameters", "gradientAccumulationSteps", 4096)):
            candidate = copy.deepcopy(self.request); candidate.payload[section][key] = value; variants.append(candidate)
        candidate = copy.deepcopy(self.request);candidate.taskType = "ensure-model-download";variants.append(candidate)
        candidate = copy.deepcopy(self.request);candidate.metadata["workspaceId"] = "foreign";variants.append(candidate)
        candidate = copy.deepcopy(self.request);candidate.payload["datasets"][1]["artifactId"] = "foreign";variants.append(candidate)
        for candidate in variants:
            with self.subTest(payload=candidate.taskType):
                with self.assertRaises(ValueError): self.dispatch()(candidate)
        self.assertEqual(self.calls, [])

    def test_direct_download_entry_is_denied(self):
        with self.assertRaises(ValueError): worker.deny_download(object(), token="synthetic-private")

    def test_owned_tiny_dataset_bytes_are_checked_and_mismatches_denied(self):
        import tempfile
        with tempfile.TemporaryDirectory(prefix="training-dataset-") as folder:
            root = Path(folder).resolve(); target = root / "train.jsonl"
            target.write_bytes(worker.DATA_BYTES)
            worker.admit_dataset(root, target, 8192)
            target.write_bytes(b'{"instruction":"wrong bytes"}\n')
            with self.assertRaises(ValueError): worker.admit_dataset(root, target, 8192)

    def test_invalid_file_proof_prevents_real_delegate(self):
        def missing(*_): raise ValueError("File proof unavailable")
        dispatch = worker.single_training_dispatch(lambda _: self.calls.append(True), self.fixture, self.model, self.temp, missing)
        with self.assertRaises(ValueError): dispatch(self.request)
        self.assertEqual(self.calls, [])

    def test_generated_profile_preserves_real_delegate_and_cannot_impersonate_official_model(self):
        self.fixture.update(schemaVersion="training-host-fixture-v2", inputProfile="generated-tiny-qwen2-v1")
        self.request.payload["baseModel"].update(modelId=worker.TINY_MODEL_ID, provider="unknown")
        dispatch = self.dispatch()
        self.assertEqual(dispatch(self.request), "original-result")
        self.assertIs(self.calls[0], self.request)
        with self.assertRaises(ValueError): dispatch(self.request)
        for key, value in (("modelId", worker.MODEL_ID), ("provider", "huggingface"), ("localPath", "/foreign/model")):
            candidate = copy.deepcopy(self.request); candidate.payload["baseModel"][key] = value
            with self.subTest(key=key), self.assertRaises(ValueError): self.dispatch()(candidate)
        self.fixture["inputProfile"] = "other-model"
        with self.assertRaises(ValueError): self.dispatch()(self.request)

    def test_generated_identity_cannot_be_used_with_the_legacy_fixture(self):
        self.request.payload["baseModel"].update(modelId=worker.TINY_MODEL_ID, provider="unknown")
        with self.assertRaises(ValueError): self.dispatch()(self.request)
        self.assertEqual(self.calls, [])

    def test_fresh_worker_requires_declared_tiny_context_and_exact_original_main_bytes(self):
        with tempfile.TemporaryDirectory(prefix="training source with spaces ") as folder:
            root = Path(folder).resolve()
            package = root / ".local-codex/q/abc123ef/o/ai-system-builder-win32-x64"
            target = package / "resources/worker/main.py"
            source = root / "modules/adapters/runtime/python/worker/main.py"
            for path in (target, source):
                path.parent.mkdir(parents=True, exist_ok=True); path.write_bytes(b"inert source identity only\n")
            env = {"VISUAL_COMPOSER_TRAINING_PACKAGED_ROOT": str(package),
                   "VISUAL_COMPOSER_TRAINING_MODEL_ACQUISITION": ".local-codex/training-inputs/tiny-01234567-89ab-cdef-0123-456789abcdef/input.json",
                   "VISUAL_COMPOSER_TRAINING_INPUT_SHA256": "a" * 64}
            self.assertEqual(worker.training_worker_directory(root, env), target.parent)
            target.write_bytes(b"changed source must not import\n")
            with self.assertRaises(ValueError): worker.training_worker_directory(root, env)

    def test_fresh_worker_rejects_foreign_paths_profiles_and_missing_hash_before_file_access(self):
        root = Path(tempfile.gettempdir()).resolve() / "inert-nonexistent-training-source"
        package = root / ".local-codex/q/abc123ef/o/ai-system-builder-win32-x64"
        env = {"VISUAL_COMPOSER_TRAINING_PACKAGED_ROOT": str(package),
               "VISUAL_COMPOSER_TRAINING_MODEL_ACQUISITION": ".local-codex/training-inputs/tiny-01234567-89ab-cdef-0123-456789abcdef/input.json",
               "VISUAL_COMPOSER_TRAINING_INPUT_SHA256": "a" * 64}
        for key, value in (("VISUAL_COMPOSER_TRAINING_PACKAGED_ROOT", str(root / "out/ai-system-builder-win32-x64")),
                           ("VISUAL_COMPOSER_TRAINING_PACKAGED_ROOT", str(package) + "\n"),
                           ("VISUAL_COMPOSER_TRAINING_MODEL_ACQUISITION", ".local-codex/model-qualification/qwen-01234567-89ab-cdef-0123-456789abcdef/acquisition.json"),
                           ("VISUAL_COMPOSER_TRAINING_INPUT_SHA256", ""),
                           ("VISUAL_COMPOSER_TRAINING_INPUT_SHA256", None),
                           ("VISUAL_COMPOSER_TRAINING_MODEL_ACQUISITION", {}),
                           ("VISUAL_COMPOSER_TRAINING_PACKAGED_ROOT", [])):
            with self.subTest(key=key, value=value), self.assertRaises(ValueError):
                worker.training_worker_directory(root, {**env, key: value})

    def test_legacy_worker_location_needs_no_fresh_package_or_extra_identity(self):
        root = Path(tempfile.gettempdir()).resolve() / "inert legacy source with spaces"
        self.assertEqual(worker.training_worker_directory(root, {}), root / "out/ai-system-builder-win32-x64/resources/worker")

    def test_source_identity_keeps_stable_per_api_times_and_rejects_read_time_changes(self):
        with tempfile.TemporaryDirectory(prefix="training source identity ") as folder:
            root=Path(folder).resolve();file=root/"main.py";file.write_bytes(b"inert source identity\n")
            stamp=file.lstat().st_ctime_ns;original=os.fstat
            def observed(fd,offset):
                info=original(fd)
                values={key:getattr(info,key) for key in ("st_dev","st_ino","st_size","st_mtime_ns","st_nlink","st_mode")}
                return SimpleNamespace(**values,st_ctime_ns=stamp+offset,st_file_attributes=getattr(info,"st_file_attributes",0))
            with patch.object(worker.os,"fstat",side_effect=lambda fd:observed(fd,100)):
                self.assertEqual(worker._source_identity_bytes(root,file),b"inert source identity\n")
            offsets=iter((100,200))
            with patch.object(worker.os,"fstat",side_effect=lambda fd:observed(fd,next(offsets))),self.assertRaises(ValueError):
                worker._source_identity_bytes(root,file)


class TrainingDatasetExceptionTests(unittest.TestCase):
    def test_success_forwards_identical_arguments_and_result_without_observation(self):
        argument=object();option=object();result=object();calls=[];observed=[]
        def load(*args,**kwargs):calls.append((args,kwargs));return result
        wrapped=worker.observe_training_dataset_loader(load,observed.append)
        self.assertIs(wrapped(argument,option=option),result)
        self.assertEqual(len(calls),1)
        self.assertIs(calls[0][0][0],argument);self.assertIs(calls[0][1]["option"],option)
        self.assertEqual(observed,[])

    def test_original_exception_and_cause_survive_observer_failure_without_retry(self):
        cause=ValueError("synthetic-private-cause");error=RuntimeError("synthetic-private-error");error.__cause__=cause
        calls=[];observed=[]
        def load(value):calls.append(value);raise error
        def observe(actual):observed.append(actual);raise PermissionError("synthetic observer failure")
        wrapped=worker.observe_training_dataset_loader(load,observe);value=object()
        with self.assertRaises(RuntimeError)as actual:wrapped(value)
        self.assertIs(actual.exception,error);self.assertIs(error.__cause__,cause)
        self.assertEqual(calls,[value]);self.assertEqual(observed,[error])

    def test_interrupt_and_exit_keep_original_behavior_without_observer(self):
        for error in (KeyboardInterrupt(),SystemExit(3)):
            observed=[]
            def load():raise error
            wrapped=worker.observe_training_dataset_loader(load,observed.append)
            with self.assertRaises(type(error))as actual:wrapped()
            self.assertIs(actual.exception,error);self.assertEqual(observed,[])

    def test_builtin_type_and_loaded_function_code_identity_produce_fixed_source_labels(self):
        class Builder:
            @staticmethod
            def _as_dataset():raise NotImplementedError("synthetic-private-message C:/private/data")
        module=ModuleType("datasets.builder");module.DatasetBuilder=Builder
        def load():return Builder._as_dataset()
        with patch.dict(worker.sys.modules,{"datasets.builder":module}):
            try:load()
            except Exception as error:facts=worker.dataset_exception_facts(error,load)
        self.assertEqual(facts["status"],"observed")
        self.assertEqual(facts["exceptions"][0]["error_type"],"NotImplementedError")
        self.assertEqual({v["source"]for v in facts["exceptions"][0]["frames"]},{"training-loader","datasets-builder"})
        self.assertTrue(all(type(v["line"])is int and v["line"]>0 for v in facts["exceptions"][0]["frames"]))
        data=json.dumps(facts)
        for private in ("synthetic-private", "C:/private", str(Path(__file__)), "_as_dataset"):
            self.assertNotIn(private,data)

    def test_loaded_provider_exception_identity_and_base_cause_slots_are_bounded(self):
        class GenerationError(Exception):pass
        module=ModuleType("datasets.exceptions");module.DatasetGenerationError=GenerationError
        cause=FileNotFoundError(2,"synthetic-private","C:/private/input")
        error=GenerationError("synthetic-private-outer");error.__cause__=cause
        with patch.dict(worker.sys.modules,{"datasets.exceptions":module}):facts=worker.dataset_exception_facts(error,lambda:None)
        self.assertEqual([v["error_type"]for v in facts["exceptions"]],["DatasetGenerationError","FileNotFoundError"])
        self.assertEqual(facts["exceptions"][1]["errno"],2)
        self.assertNotIn("synthetic-private",json.dumps(facts));self.assertNotIn("C:/private",json.dumps(facts))

    def test_private_custom_properties_and_text_are_never_evaluated(self):
        class PrivateError(Exception):
            def __str__(self):raise AssertionError("private str was read")
            @property
            def __cause__(self):raise AssertionError("private cause getter was read")
            @property
            def __context__(self):raise AssertionError("private context getter was read")
            @property
            def __traceback__(self):raise AssertionError("private traceback getter was read")
            @property
            def errno(self):raise AssertionError("private errno getter was read")
            @property
            def filename(self):raise AssertionError("private filename getter was read")
        error=PrivateError("synthetic-secret-token C:/private/input")
        def load():raise error
        try:load()
        except PrivateError as actual:facts=worker.dataset_exception_facts(actual,load)
        self.assertEqual(facts["exceptions"][0]["error_type"],"OtherError")
        self.assertIsNone(facts["exceptions"][0]["errno"])
        self.assertNotIn("PrivateError",json.dumps(facts));self.assertNotIn("synthetic-secret",json.dumps(facts))

    def test_chain_cycles_depth_and_traceback_scans_have_hard_limits(self):
        errors=[RuntimeError("synthetic-private")for _ in range(5)]
        for before,after in zip(errors,errors[1:]):before.__cause__=after
        facts=worker.dataset_exception_facts(errors[0],lambda:None)
        self.assertEqual(len(facts["exceptions"]),3);self.assertTrue(facts["chain_truncated"])
        errors[0].__cause__=errors[0]
        facts=worker.dataset_exception_facts(errors[0],lambda:None)
        self.assertEqual(len(facts["exceptions"]),1);self.assertTrue(facts["chain_truncated"])
        def deep(depth):
            if depth:return deep(depth-1)
            raise RuntimeError("synthetic-private")
        try:deep(24)
        except RuntimeError as error:facts=worker.dataset_exception_facts(error,deep)
        row=facts["exceptions"][0]
        self.assertEqual(row["frames_scanned"],16);self.assertLessEqual(len(row["frames"]),16)
        self.assertTrue(row["traceback_truncated"])

    def test_suppressed_context_stays_unread_and_explicit_cause_wins(self):
        error=RuntimeError("synthetic-private");context=ValueError("synthetic-private-context");error.__context__=context
        error.__suppress_context__=True
        self.assertEqual(len(worker.dataset_exception_facts(error,lambda:None)["exceptions"]),1)
        error.__suppress_context__=False
        self.assertEqual([v["error_type"]for v in worker.dataset_exception_facts(error,lambda:None)["exceptions"]],["RuntimeError","ValueError"])
        error.__cause__=TypeError("synthetic-private-cause")
        self.assertEqual([v["error_type"]for v in worker.dataset_exception_facts(error,lambda:None)["exceptions"]],["RuntimeError","TypeError"])

    def test_output_is_fixed_exclusive_bounded_and_never_contains_raw_data(self):
        with tempfile.TemporaryDirectory(prefix="training-dataset-exception-")as folder:
            cache=Path(folder).resolve()
            def load():raise OSError(13,"synthetic-secret-token","C:/private/dataset")
            try:load()
            except OSError as error:worker.write_dataset_exception_facts(error,cache,load)
            target=cache/"qualification-dataset-exception.json";before=target.read_bytes()
            self.assertLessEqual(len(before),8192)
            self.assertEqual(json.loads(before)["exceptions"][0]["errno"],13)
            for private in (b"synthetic-secret",b"C:/private",b"filename",b"args",b"locals"):
                self.assertNotIn(private,before)
            with self.assertRaises(FileExistsError):worker.write_dataset_exception_facts(RuntimeError("other"),cache,load)
            self.assertEqual(target.read_bytes(),before)
            self.assertEqual([v.name for v in cache.iterdir()],[target.name])

    def test_missing_cache_and_oversized_projection_deny_before_file_creation(self):
        with tempfile.TemporaryDirectory(prefix="training-dataset-exception-denial-")as folder:
            cache=Path(folder).resolve();missing=cache/"missing";error=RuntimeError("synthetic-private")
            with self.assertRaises(ValueError):worker.write_dataset_exception_facts(error,missing,lambda:None)
            with patch.object(worker,"dataset_exception_facts",return_value={"data":"x"*8193}),self.assertRaises(ValueError):
                worker.write_dataset_exception_facts(error,cache,lambda:None)
            self.assertFalse(missing.exists());self.assertEqual(list(cache.iterdir()),[])

    def test_unavailable_input_foreign_module_types_and_custom_provider_members_do_not_execute(self):
        class Private:
            def __str__(self):raise AssertionError("private str evaluated")
        self.assertEqual(worker.dataset_exception_facts(Private(),lambda:None)["status"],"unavailable")
        class Builder:
            @property
            def _as_dataset(self):raise AssertionError("provider property evaluated")
        module=ModuleType("datasets.builder");module.DatasetBuilder=Builder
        def forbidden(name):raise AssertionError("module fallback evaluated")
        module.__getattr__=forbidden
        with patch.dict(worker.sys.modules,{"datasets.builder":module,"datasets.load":Private()}),patch.object(worker.importlib,"import_module",side_effect=AssertionError("provider imported")):
            facts=worker.dataset_exception_facts(RuntimeError("synthetic-private"),lambda:None)
        self.assertEqual(facts["exceptions"][0]["frames"],[])

    def test_main_installs_only_the_app_owned_loader_hook_in_the_fresh_mode(self):
        tree=ast.parse(Path(worker.__file__).read_text());main=next(n for n in tree.body if isinstance(n,ast.FunctionDef)and n.name=="main")
        guarded=[n for n in ast.walk(main)if isinstance(n,ast.If)and ast.unparse(n.test)=="dataset_cache is not None"]
        self.assertEqual(len(guarded),1)
        calls=[n for n in ast.walk(guarded[0])if isinstance(n,ast.Call)]
        self.assertTrue(any(isinstance(n.func,ast.Attribute)and n.func.attr=="import_module"and n.args and isinstance(n.args[0],ast.Constant)and n.args[0].value=="_ai_system_builder_worker.tasks.train_model"for n in calls))
        self.assertTrue(any(isinstance(n.func,ast.Name)and n.func.id=="observe_training_dataset_loader"for n in calls))
        facts=next(n for n in tree.body if isinstance(n,ast.FunctionDef)and n.name=="dataset_exception_facts")
        self.assertFalse(any(isinstance(n,ast.Attribute)and n.attr in {"co_filename","co_name","f_locals","args","filename"}for n in ast.walk(facts)))


class TrainingDatasetCacheTests(unittest.TestCase):
    def setUp(self):
        self.folder = tempfile.TemporaryDirectory(prefix="training-relative-cache-")
        self.addCleanup(self.folder.cleanup)
        self.root = Path(self.folder.name).resolve()
        self.identity = "0123456789abcdef0123456789abcdef"
        self.run = f"training-ui-{self.identity}-01"
        self.short = self.root / ".local-codex/q/01234567"
        self.package = self.short / "o/ai-system-builder-win32-x64"
        self.worker = self.package / "resources/worker"
        self.worker.mkdir(parents=True)
        self.cache = self.root / "original-controlled-cache"
        self.cache.mkdir()
        self.environment = {"VISUAL_COMPOSER_TRAINING_PACKAGED_ROOT": str(self.package),
            "VISUAL_COMPOSER_TRAINING_MODEL_ACQUISITION": ".local-codex/training-inputs/tiny-01234567-89ab-cdef-0123-456789abcdef/input.json",
            "HF_DATASETS_CACHE": str(self.cache / "datasets"), "HF_HUB_CACHE": str(self.cache),
            "TEMP": "unchanged-temp", "HF_HUB_OFFLINE": "1"}

    def prepare(self, environment=None, run=None, worker_directory=None):
        return worker.prepare_training_dataset_cache(self.root, self.worker if worker_directory is None else worker_directory,
            self.cache, self.environment if environment is None else environment, self.run if run is None else run)

    def test_fresh_dataset_cache_is_same_run_and_relative_without_changing_cwd_or_other_environment(self):
        before=dict(self.environment);cwd=Path.cwd()
        target=self.prepare()
        self.assertEqual(target,self.short/"d")
        self.assertTrue(target.is_dir())
        self.assertEqual(list(target.iterdir()),[])
        relative=os.path.join("..","..","..","..","d")
        self.assertEqual(self.environment,{**before,"HF_DATASETS_CACHE":relative})
        self.assertEqual(Path(os.path.abspath(self.worker/relative)),target)
        self.assertEqual(Path.cwd(),cwd)
        self.assertEqual(list(self.cache.iterdir()),[])

    def test_legacy_profile_has_no_new_filesystem_or_environment_effect(self):
        environment={key:value for key,value in self.environment.items()if key!="VISUAL_COMPOSER_TRAINING_PACKAGED_ROOT"}
        before=dict(environment)
        with patch.object(Path,"lstat",side_effect=AssertionError("no legacy filesystem change")):
            self.assertIsNone(self.prepare(environment))
        self.assertEqual(environment,before)
        self.assertFalse((self.short/"d").exists())

    def test_foreign_package_input_case_and_original_cache_values_fail_before_creation(self):
        variants=[]
        for key,value in (("VISUAL_COMPOSER_TRAINING_PACKAGED_ROOT",str(self.root/"out/ai-system-builder-win32-x64")),
                          ("VISUAL_COMPOSER_TRAINING_PACKAGED_ROOT",str(self.root/".local-codex/q/ffffffff/o/ai-system-builder-win32-x64")),
                          ("VISUAL_COMPOSER_TRAINING_PACKAGED_ROOT",{}),
                          ("VISUAL_COMPOSER_TRAINING_MODEL_ACQUISITION",".local-codex/training-inputs/tiny-ffffffff-ffff-ffff-ffff-ffffffffffff/input.json"),
                          ("HF_DATASETS_CACHE",str(self.root/"foreign-cache")),("HF_DATASETS_CACHE",None)):
            environment=dict(self.environment);environment[key]=value;variants.append((environment,self.run,self.worker))
        for run in ("wrong-case", "training-ui-"+"f"*32+"-01", "training-ui-"+self.identity+"-02", {}):
            variants.append((dict(self.environment),run,self.worker))
        variants.append((dict(self.environment),self.run,self.root/"foreign-worker"))
        for environment,run,directory in variants:
            before=dict(environment)
            with self.subTest(run=run),self.assertRaises(ValueError):self.prepare(environment,run,directory)
            self.assertEqual(environment,before)
            self.assertFalse((self.short/"d").exists())

    def test_existing_directory_is_not_inspected_adopted_changed_or_removed(self):
        target=self.short/"d";target.mkdir();file=target/"existing.bin";file.write_bytes(b"synthetic retained bytes")
        before=dict(self.environment)
        with self.assertRaises(ValueError):self.prepare()
        self.assertEqual(file.read_bytes(),b"synthetic retained bytes")
        self.assertEqual(self.environment,before)
        self.assertEqual([p.name for p in target.iterdir()],["existing.bin"])

    def test_existing_file_is_not_replaced(self):
        target=self.short/"d";target.write_bytes(b"synthetic existing file")
        with self.assertRaises(ValueError):self.prepare()
        self.assertEqual(target.read_bytes(),b"synthetic existing file")

    def test_reparse_ancestor_is_denied_before_cache_creation(self):
        original=Path.lstat
        def observed(path,*args,**kwargs):
            if path==self.short:return SimpleNamespace(st_mode=stat.S_IFDIR|0o700,st_file_attributes=0x400)
            return original(path,*args,**kwargs)
        with patch.object(Path,"lstat",observed),self.assertRaises(ValueError):self.prepare()
        self.assertFalse((self.short/"d").exists())

    def test_directory_creation_failure_preserves_environment_and_does_not_retry(self):
        before=dict(self.environment)
        with patch.object(Path,"mkdir",side_effect=PermissionError("synthetic private failure"))as create:
            with self.assertRaises(ValueError):self.prepare()
            self.assertEqual(create.call_count,1)
        self.assertEqual(self.environment,before)
        self.assertFalse((self.short/"d").exists())

    def test_non_directory_worker_ancestor_is_denied_before_cache_creation(self):
        self.worker.rmdir();self.worker.write_bytes(b"synthetic file instead of directory")
        with self.assertRaises(ValueError):self.prepare()
        self.assertFalse((self.short/"d").exists())

    def test_second_admission_never_reuses_the_new_cache(self):
        original=dict(self.environment);target=self.prepare()
        with self.assertRaises(ValueError):self.prepare(dict(original))
        self.assertEqual(list(target.iterdir()),[])

    def test_closed_failure_facts_use_new_cache_identity_but_original_diagnostic_destination(self):
        target=self.prepare();private_path=str(target/"private.lock")
        result={"status":"failed","error":{"code":"training_failed","message":str(FileNotFoundError(2,"Missing",private_path)),"details":{"stage":"dataset-loading"}}}
        worker.write_training_failure_facts(result,self.cache,target)
        data=(self.cache/"qualification-training-failure.json").read_bytes();facts=json.loads(data)
        self.assertEqual(facts["path_kind"],"owned-cache-lock")
        self.assertEqual(facts["path_characters"],len(private_path))
        self.assertNotIn(b"private.lock",data)
        self.assertEqual(list(target.iterdir()),[])
        self.assertEqual(result["error"]["message"],str(FileNotFoundError(2,"Missing",private_path)))


class TrainingDatasetWorkingDirectoryTests(unittest.TestCase):
    def setUp(self):
        self.fixture = TrainingDatasetCacheTests()
        self.fixture.setUp()
        self.addCleanup(self.fixture.doCleanups)
        self.target = self.fixture.prepare()

    def activate(self, **overrides):
        f = self.fixture
        args = dict(root=f.root, worker=f.worker, dataset_cache=self.target,
                    environment=f.environment, run=f.run)
        args.update(overrides)
        return worker.activate_training_dataset_working_directory(**args)

    def test_changes_once_to_same_short_root_and_only_updates_dataset_environment(self):
        f = self.fixture;before = dict(f.environment)
        with patch.object(Path, "cwd", side_effect=[f.worker, f.short]), patch.object(worker.os, "chdir") as change:
            self.activate()
        change.assert_called_once_with(f.short)
        self.assertEqual(f.environment, {**before, "HF_DATASETS_CACHE": "d"})
        self.assertEqual((f.short / f.environment["HF_DATASETS_CACHE"]).resolve(), self.target)
        self.assertEqual(list(self.target.iterdir()), [])
        self.assertEqual(list(f.cache.iterdir()), [])

    def test_legacy_none_does_not_read_paths_cwd_or_environment_or_change_directory(self):
        with patch.object(Path, "lstat", side_effect=AssertionError("legacy filesystem access")), \
                patch.object(Path, "cwd", side_effect=AssertionError("legacy cwd access")), \
                patch.object(worker.os, "chdir", side_effect=AssertionError("legacy cwd change")):
            self.assertIsNone(worker.activate_training_dataset_working_directory(None, None, None, None, None))

    def test_foreign_bindings_deny_before_filesystem_or_cwd_effects(self):
        f = self.fixture
        variants = [{"run": value} for value in (None, {}, "wrong", "training-ui-" + "f" * 32 + "-01")]
        variants += [{"root": f.root / "foreign"}, {"worker": f.root / "foreign-worker"},
                     {"dataset_cache": f.root / "foreign-cache"}]
        for key, value in (("VISUAL_COMPOSER_TRAINING_PACKAGED_ROOT", str(f.root / "foreign")),
                           ("VISUAL_COMPOSER_TRAINING_MODEL_ACQUISITION", "foreign-input"),
                           ("HF_DATASETS_CACHE", str(self.target)), ("HF_DATASETS_CACHE", "d")):
            variants.append({"environment": {**f.environment, key: value}})
        for variant in variants:
            before = dict(variant.get("environment", f.environment))
            with self.subTest(variant=variant), patch.object(Path, "lstat", side_effect=AssertionError("foreign path read")), \
                    patch.object(Path, "cwd", side_effect=AssertionError("foreign cwd read")), \
                    patch.object(worker.os, "chdir", side_effect=AssertionError("foreign cwd effect")), self.assertRaises(ValueError):
                self.activate(**variant)
            self.assertEqual(variant.get("environment", f.environment), before)

    def test_wrong_initial_directory_denies_before_change_and_environment_mutation(self):
        f = self.fixture;before = dict(f.environment)
        with patch.object(Path, "cwd", return_value=f.root), patch.object(worker.os, "chdir") as change, self.assertRaises(ValueError):
            self.activate()
        change.assert_not_called()
        self.assertEqual(f.environment, before)

    def test_reparse_directory_denies_without_change_or_environment_success(self):
        f = self.fixture;before = dict(f.environment);original = Path.lstat
        def observed(path, *args, **kwargs):
            if path == self.target:
                return SimpleNamespace(st_mode=stat.S_IFDIR | 0o700, st_file_attributes=0x400)
            return original(path, *args, **kwargs)
        with patch.object(Path, "cwd", return_value=f.worker), patch.object(Path, "lstat", observed), \
                patch.object(worker.os, "chdir") as change, self.assertRaises(ValueError):
            self.activate()
        change.assert_not_called()
        self.assertEqual(f.environment, before)

    def test_missing_or_file_cache_denies_before_change(self):
        f = self.fixture;before = dict(f.environment);self.target.rmdir()
        for file_instead in (False, True):
            if file_instead: self.target.write_bytes(b"inert wrong-kind fixture")
            with patch.object(Path, "cwd", return_value=f.worker), patch.object(worker.os, "chdir") as change, \
                    self.assertRaises((ValueError, FileNotFoundError)):
                self.activate()
            change.assert_not_called()
            self.assertEqual(f.environment, before)

    def test_directory_change_failure_does_not_retry_or_change_environment(self):
        f = self.fixture;before = dict(f.environment)
        with patch.object(Path, "cwd", return_value=f.worker), \
                patch.object(worker.os, "chdir", side_effect=PermissionError("synthetic private error")) as change, self.assertRaises(ValueError):
            self.activate()
        change.assert_called_once_with(f.short)
        self.assertEqual(f.environment, before)

    def test_wrong_resulting_directory_denies_without_fallback_or_environment_success(self):
        f = self.fixture;before = dict(f.environment)
        with patch.object(Path, "cwd", side_effect=[f.worker, f.root]), patch.object(worker.os, "chdir") as change, self.assertRaises(ValueError):
            self.activate()
        change.assert_called_once_with(f.short)
        self.assertEqual(f.environment, before)

    def test_main_activates_after_fresh_cache_and_before_worker_import(self):
        tree = ast.parse(Path(worker.__file__).read_text())
        main = next(n for n in tree.body if isinstance(n, ast.FunctionDef) and n.name == "main")
        calls = [n for n in ast.walk(main) if isinstance(n, ast.Call)]
        prepare = [n for n in calls if isinstance(n.func, ast.Name) and n.func.id == "prepare_training_dataset_cache"]
        activate = [n for n in calls if isinstance(n.func, ast.Name) and n.func.id == "activate_training_dataset_working_directory"]
        imports = [n for n in calls if isinstance(n.func, ast.Attribute) and n.func.attr == "spec_from_file_location" and
                   n.args and isinstance(n.args[0], ast.Constant) and n.args[0].value == "aisb_training_qualification_main"]
        self.assertEqual((len(prepare), len(activate), len(imports)), (1, 1, 1))
        self.assertLess(prepare[0].lineno, activate[0].lineno)
        self.assertLess(activate[0].lineno, imports[0].lineno)


class TrainingFailureFactsTests(unittest.TestCase):
    cache = Path("C:/owned-test/controlled-model-cache")

    @staticmethod
    def failed(message, **details):
        return {"status": "failed", "error": {"code": "training_failed", "message": message,
                "details": {"stage": "dataset-loading", "errorType": "OtherError", **details}}}

    def test_long_owned_lock_is_classified_without_serializing_text_or_path(self):
        path = str(self.cache / "datasets" / ("x" * 255 + ".lock"))
        facts = worker.training_failure_facts(self.failed(str(FileNotFoundError(2, "No such file or directory", path))), self.cache)
        self.assertEqual(facts, {"schema_version": "training-failure-facts-v1", "status": "classified",
            "stage": "dataset-loading", "error_number_kind": "errno", "error_number": 2,
            "path_kind": "owned-cache-lock", "path_characters": len(path),
            "windows_path_utf16_units": len(path),
            "windows_legacy_path_limit_exceeded": True, "parent_qualification_granted": False})
        self.assertNotIn(str(self.cache), json.dumps(facts))
        self.assertNotIn("No such file", json.dumps(facts))

    def test_windows_error_and_owned_nonlock_keep_only_closed_labels(self):
        path = str(self.cache / "datasets" / "private-data.arrow")
        facts = worker.training_failure_facts(self.failed(f"[WinError 5] Access is denied: {path!r}"), self.cache)
        self.assertEqual((facts["error_number_kind"], facts["error_number"], facts["path_kind"]),
                         ("winerror", 5, "owned-cache-file"))
        self.assertFalse(facts["windows_legacy_path_limit_exceeded"])
        self.assertNotIn("private-data", json.dumps(facts))

    def test_foreign_path_is_not_read_or_mislabeled_owned(self):
        for path in ("C:/owned-test/controlled-model-cache-other/secret.lock", "D:/foreign/private.lock"):
            with self.subTest(path=path), patch.object(Path, "open", side_effect=AssertionError("no reads")):
                facts = worker.training_failure_facts(self.failed(f"[Errno 13] Private marker: '{path}'"), self.cache)
                self.assertEqual(facts["path_kind"], "other")
                self.assertNotIn("Private marker", json.dumps(facts))
                self.assertNotIn("secret", json.dumps(facts))

    def test_real_builtin_escaped_windows_path_has_exact_decoded_length(self):
        path = "C:\\owned-test\\controlled-model-cache\\datasets\\private's-é.lock"
        message = str(FileNotFoundError(2, "No such file or directory", path))
        facts = worker.training_failure_facts(self.failed(message), self.cache)
        self.assertEqual((facts["status"], facts["path_kind"], facts["path_characters"]),
                         ("classified", "owned-cache-lock", len(path)))
        self.assertNotIn("private", json.dumps(facts))

    def test_path_threshold_uses_decoded_length_and_invalid_literals_are_unavailable(self):
        prefix = "C:\\owned-test\\controlled-model-cache\\datasets\\"
        for length in (259, 260):
            path = prefix + "x" * (length - len(prefix) - 5) + ".lock"
            facts = worker.training_failure_facts(self.failed(str(FileNotFoundError(2, "Missing", path))), self.cache)
            self.assertEqual(facts["path_characters"], length)
            self.assertEqual(facts["windows_legacy_path_limit_exceeded"], length >= 260)
        for literal in ("'C:/private\\nsecret'", "'C:/private\\x00secret'", "'C:/private' + malicious() + 'secret'", "'C:/private\\xZZ'"):
            facts = worker.training_failure_facts(self.failed("[Errno 2] Missing: " + literal), self.cache)
            self.assertEqual(facts["status"], "unavailable")

    def test_windows_threshold_counts_utf16_units_for_astral_characters(self):
        prefix = "C:\\owned-test\\controlled-model-cache\\datasets\\"
        for units in (259, 260):
            path = prefix + "x" * (units - len(prefix) - 7) + "\U0001f9ea.lock"
            self.assertEqual(len(path.encode("utf-16-le")) // 2, units)
            facts = worker.training_failure_facts(self.failed(str(FileNotFoundError(2, "Missing", path))), self.cache)
            self.assertEqual(facts["path_characters"], units - 1)
            self.assertEqual(facts["windows_path_utf16_units"], units)
            self.assertEqual(facts["windows_legacy_path_limit_exceeded"], units >= 260)

    def test_unknown_nested_oversized_and_noncanonical_messages_stay_unavailable(self):
        for message in (None, {}, "", "x" * 16385, "synthetic-secret-token", "Nested: [Errno 2] Missing: 'C:/secret'",
                        "[Errno 999] Missing: 'C:/secret'", "[WinError 999] Missing: 'C:/secret'",
                        "[Errno 2] Missing: 'relative/secret'", "[Errno 2] Missing: 'C:/owned-test/../secret'",
                        "[Errno 2] Missing: 'C:/secret'\nprivate"):
            facts = worker.training_failure_facts(self.failed(message), self.cache)
            self.assertEqual(facts["status"], "unavailable")
            self.assertIsNone(facts["error_number"])
            self.assertIsNone(facts["path_characters"])
            self.assertNotIn("secret", json.dumps(facts))

    def test_custom_mappings_strings_and_fields_are_not_evaluated(self):
        class DangerousDict(dict):
            def get(self, *_): raise AssertionError("custom get evaluated")
        class DangerousString(str):
            def __eq__(self, _): raise AssertionError("custom equality evaluated")
        class Dangerous:
            def __eq__(self, _): raise AssertionError("custom equality evaluated")
            def __str__(self): raise AssertionError("custom stringify evaluated")
        variants = [DangerousDict(), None, Dangerous(), {"error": DangerousDict()},
                    {"error": {"code": Dangerous()}}, {"error": {"code": DangerousString("training_failed")}},
                    self.failed(DangerousString("private")), self.failed(Dangerous(), stage=Dangerous()),
                    {"error": {"code": "training_failed", "details": DangerousDict()}}]
        for value in variants:
            self.assertEqual(worker.training_failure_facts(value, self.cache)["status"], "unavailable")

    def test_exclusive_fixed_leaf_is_bounded_and_never_overwritten(self):
        with tempfile.TemporaryDirectory(prefix="training-failure-facts-") as folder:
            cache = Path(folder).resolve()
            result = self.failed("synthetic-secret-token C:/private/path")
            worker.write_training_failure_facts(result, cache)
            target = cache / "qualification-training-failure.json"
            before = target.read_bytes()
            self.assertLessEqual(len(before), 1024)
            self.assertNotIn(b"synthetic-secret-token", before)
            self.assertNotIn(b"C:/private", before)
            with self.assertRaises(FileExistsError): worker.write_training_failure_facts(result, cache)
            self.assertEqual(target.read_bytes(), before)
            self.assertEqual([file.name for file in cache.iterdir()], [target.name])

    def test_missing_or_relative_cache_is_denied_without_creation(self):
        with tempfile.TemporaryDirectory(prefix="training-failure-missing-") as folder:
            missing = Path(folder).resolve() / "missing"
            for cache in (missing, Path("relative-cache")):
                with self.assertRaises(ValueError): worker.write_training_failure_facts(self.failed("private"), cache)
            self.assertFalse(missing.exists())

    def test_one_failed_dispatch_preserves_result_identity_even_when_observer_fails(self):
        fixture = TrainingQualificationWorkerTests();fixture.setUp()
        result = self.failed("synthetic-private")
        observed = []
        def observer(actual):
            observed.append(actual)
            raise OSError("synthetic-private-observer-error")
        dispatch = worker.single_training_dispatch(lambda _: result, fixture.fixture, fixture.model, fixture.temp,
                                                   lambda *_: None, observer)
        self.assertIs(dispatch(fixture.request), result)
        self.assertIs(observed[0], result)
        with self.assertRaises(ValueError): dispatch(fixture.request)
        self.assertEqual(len(observed), 1)
        self.assertEqual(result, self.failed("synthetic-private"))

    def test_success_cancellation_nonresults_and_malformed_status_do_not_observe(self):
        fixture = TrainingQualificationWorkerTests();fixture.setUp()
        class Dangerous:
            def __eq__(self, _): raise AssertionError("status equality evaluated")
        for result in ({"status": "completed"}, {"status": "cancelled"}, {"status": Dangerous()}, "original", None):
            observed=[]
            dispatch = worker.single_training_dispatch(lambda _: result, fixture.fixture, fixture.model, fixture.temp,
                                                       lambda *_: None, observed.append)
            self.assertIs(dispatch(fixture.request), result)
            self.assertEqual(observed, [])

    def test_rejected_request_and_raised_original_never_invoke_observer(self):
        fixture = TrainingQualificationWorkerTests();fixture.setUp();observed=[];calls=[]
        dispatch = worker.single_training_dispatch(lambda _: calls.append(True), fixture.fixture, fixture.model, fixture.temp,
                                                   lambda *_: None, observed.append)
        fixture.request.taskType = "foreign"
        with self.assertRaises(ValueError): dispatch(fixture.request)
        self.assertEqual((calls,observed),([],[]))
        fixture.request.taskType = "train-model"
        error=RuntimeError("synthetic-private")
        def fail(_): raise error
        dispatch = worker.single_training_dispatch(fail, fixture.fixture, fixture.model, fixture.temp,
                                                   lambda *_: None, observed.append)
        with self.assertRaises(RuntimeError) as actual: dispatch(fixture.request)
        self.assertIs(actual.exception,error)
        self.assertEqual(observed,[])


if __name__ == "__main__": unittest.main()
