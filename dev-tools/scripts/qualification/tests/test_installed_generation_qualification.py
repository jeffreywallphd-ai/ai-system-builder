import importlib.util
import hashlib
import io
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
from types import SimpleNamespace
from unittest.mock import patch

MODULE=Path(__file__).resolve().parents[1]/"run_installed_generation_qualification.py"
spec=importlib.util.spec_from_file_location("installed_generation_qualification",MODULE)
qualification=importlib.util.module_from_spec(spec);spec.loader.exec_module(qualification)


class InstalledGenerationQualificationTests(unittest.TestCase):
    def tearDown(self):qualification.configure_model_profile("qwen05-float32")

    def plan(self):return qualification.heldout_plan()

    def test_explicit_profiles_preserve_original_plan_and_pin_new_native_precision(self):
        original=self.plan()
        self.assertEqual(original,json.loads(MODULE.with_name("installed_generation_holdout.json").read_text()))
        with self.assertRaisesRegex(ValueError,"Unknown fixed"):qualification.configure_model_profile("unapproved")
        self.assertEqual(qualification.MODEL_PROFILE,"qwen05-float32")
        qualification.configure_model_profile("qwen15-bfloat16")
        native=self.plan()
        self.assertEqual(qualification.MODEL,"Qwen/Qwen2.5-1.5B-Instruct")
        self.assertEqual(qualification.REVISION,"989aa7980e4cf806f80c7fef2b1adb7bc71aa306")
        self.assertEqual(qualification.MODEL_FILES["model.safetensors"],"dd924a11b4c220f385b51ffa522daea7c9f3d850e31b162bb5661df483c6d3ee")
        self.assertEqual(native["precision"],"bfloat16")
        for key,value in original.items():
            if key!="precision":self.assertEqual(native[key],value,key)
        qualification.configure_model_profile("qwen05-float32")
        self.assertEqual(self.plan(),original)
        self.assertEqual(qualification.MODEL_MAXIMUM_FILE_BYTES,1024**3)

    def test_child_cannot_silently_revert_to_default_or_differ_from_parent_profile(self):
        qualification.configure_model_profile("qwen15-bfloat16")
        args=SimpleNamespace(model_manifest="isolated-acquisition",model_profile="qwen15-bfloat16")
        command=qualification.child_command(args,Path("a"*32),"candidate","cpu","unchecked",0)
        self.assertEqual(command[command.index("--model-profile")+1],"qwen15-bfloat16")
        args.model_profile="qwen05-float32"
        with self.assertRaisesRegex(ValueError,"differs from its parent"):qualification.child_command(args,Path("a"*32),"candidate","cpu","unchecked",0)

    def test_cross_profile_acquisition_cannot_be_substituted(self):
        qualification.configure_model_profile("qwen15-bfloat16")
        with self.assertRaisesRegex(ValueError,"Fixed isolated"):qualification.verified_model(".local-codex/model-qualification/qwen-"+"a"*36+"/acquisition.json")
        with tempfile.TemporaryDirectory() as directory,patch.object(qualification,"ROOT",Path(directory)):
            folder=Path(directory)/".local-codex/model-qualification"/("qwen15-"+"a"*36);folder.mkdir(parents=True)
            (folder/"acquisition.json").write_text(json.dumps({"model":"Qwen/Qwen2.5-0.5B-Instruct","revision":"7ae557604adf67be50417f59c2c2f167def9a775","status":"verified"}))
            with self.assertRaisesRegex(ValueError,"identity differs"):qualification.verified_model(str((folder/"acquisition.json").relative_to(directory)).replace("\\","/"))

    def pairs(self,before=24,after=24,before_rate=10,after_rate=12):
        rows=self.plan()["heldout"]
        def result(count,rate):
            cases=[{"id":row["id"],"correct":index<count} for index,row in enumerate(rows)]
            return {"phases":{"first":{"cases":cases},"warm":{"cases":cases}},"accepted_per_minute":rate,"cleanup_passed":True,"physical_exit_code":0}
        return [{"baseline":result(before,before_rate),"candidate":result(after,after_rate)} for _ in range(3)]

    def test_fixed_heldout_and_operational_settings_are_complete(self):
        plan=self.plan()
        self.assertEqual(plan["replicates"],3)
        self.assertEqual(plan["absolute_quality_floor"],.95)
        self.assertEqual(plan["effective_sampling"]["do_sample"],True)
        self.assertEqual(plan["generation_params"]["maxNewTokens"],192)
        self.assertEqual({r["label"] for r in plan["heldout"]},{"billing","support"})

    def test_positive_matched_gain_requires_meaningful_quality_and_all_cleanup(self):
        good=qualification.compare_cohort(self.pairs(),self.plan())
        self.assertTrue(good["quality_passed"]);self.assertTrue(good["throughput_target_met"])
        weak=qualification.compare_cohort(self.pairs(1,2),self.plan())
        self.assertFalse(weak["quality_passed"])
        regression=qualification.compare_cohort(self.pairs(24,23),self.plan())
        self.assertFalse(regression["quality_passed"])
        for key,value in [("cleanup_passed",False),("physical_exit_code",23),("diagnostic_overflow",True)]:
            pairs=self.pairs();pairs[1]["candidate"][key]=value
            self.assertFalse(qualification.compare_cohort(pairs,self.plan())["quality_passed"])

    def test_zero_baseline_and_unchanged_throughput_never_manufacture_relative_improvement(self):
        zero=qualification.compare_cohort(self.pairs(0,24,0,12),self.plan())
        self.assertTrue(zero["quality_passed"])
        self.assertIsNone(zero["median_delivery_ratio"])
        self.assertFalse(zero["throughput_target_met"])
        unchanged=qualification.compare_cohort(self.pairs(24,24,10,10),self.plan())
        self.assertFalse(unchanged["throughput_target_met"])

    def test_nominal_exact_intervals_and_paired_counts_are_descriptive_not_pooled(self):
        lower,upper=qualification.exact_binomial_interval(24,24)
        self.assertAlmostEqual(lower,.025**(1/24));self.assertEqual(upper,1)
        lower,upper=qualification.exact_binomial_interval(0,24)
        self.assertEqual(lower,0);self.assertAlmostEqual(upper,1-.025**(1/24))
        result=qualification.compare_cohort(self.pairs(),self.plan())
        self.assertEqual(len(result["paired_quality"]),6)
        self.assertTrue(all(row["distinct_fixed_cases"]==24 and row["both_correct"]==24 and row["regressed"]==0 for row in result["paired_quality"]))

    def test_private_diagnostic_sink_bounds_utf8_bytes_and_preserves_overflow(self):
        output=io.StringIO();evidence={};sink=qualification.BoundedDiagnosticSink(output,evidence,8)
        sink.write("éééé");sink.flush()
        self.assertEqual(sink.written_bytes,8)
        with self.assertRaisesRegex(RuntimeError,"byte bound"):sink.write("x")
        self.assertEqual(output.getvalue(),"éééé")
        self.assertTrue(evidence["diagnostic_overflow"])

    def test_operational_failure_is_not_reported_as_generated_invalid_output(self):
        for code in ["decoder-unavailable","decoder-schema-limit","decoder-schema-compile-failed","unknown"]:
            self.assertEqual(qualification.decoder_failure_kind(code),"operational")
        for code in ["decoder-output-empty","decoder-output-invalid","decoder-output-truncated"]:
            self.assertEqual(qualification.decoder_failure_kind(code),"invalid-output")
        counts=qualification.phase_counts([{"attempts":2,"operational_errors":1,"invalid_attempts":1,"repairs":1}])
        self.assertEqual(counts["generator_invocations"],2);self.assertEqual(counts["output_attempts"],1)
        self.assertEqual(counts["invalid_output_rate"],1);self.assertEqual(counts["operational_errors"],1)
        no_output=qualification.phase_counts([{"attempts":1,"operational_errors":1,"invalid_attempts":0,"repairs":0}])
        self.assertIsNone(no_output["invalid_output_rate"])

    def test_incomplete_or_substituted_cases_and_replicates_are_refused(self):
        pairs=self.pairs();pairs[0]["candidate"]["phases"]["first"]["cases"]=[]
        with self.assertRaisesRegex(ValueError,"Unmatched"):qualification.compare_cohort(pairs,self.plan())
        with self.assertRaisesRegex(ValueError,"Missing"):qualification.compare_cohort(self.pairs()[:2],self.plan())

    def test_model_path_and_revision_are_closed_before_loading(self):
        for value in ["../outside/acquisition.json","C:/outside/acquisition.json",".local-codex/model-qualification/qwen-../acquisition.json"]:
            with self.subTest(value=value),self.assertRaises(ValueError):qualification.verified_model(value)
        with tempfile.TemporaryDirectory() as directory,patch.object(qualification,"ROOT",Path(directory)):
            folder=Path(directory)/".local-codex/model-qualification"/("qwen-"+"a"*36);folder.mkdir(parents=True)
            (folder/"acquisition.json").write_text(json.dumps({"model":"foreign/model","revision":"moving","status":"verified"}))
            with self.assertRaisesRegex(ValueError,"identity"):qualification.verified_model(str((folder/"acquisition.json").relative_to(directory)).replace("\\","/"))

    def test_unverified_baseline_cannot_be_executed(self):
        with tempfile.TemporaryDirectory() as directory,patch.object(qualification.subprocess,"check_output",return_value=b"substituted executable content"):
            with self.assertRaisesRegex(ValueError,"baseline integrity"):qualification.prepare_baseline(Path(directory))

    def test_selected_baseline_modules_load_in_a_genuinely_fresh_process(self):
        with tempfile.TemporaryDirectory() as directory:
            # Test historical module substitution independently of the driver
            # guard, which must refuse today's changed common inference runtime.
            folder=Path(directory);base=folder/"baseline";base.mkdir()
            for name,digest in qualification.BASELINE_FILES.items():
                content=subprocess.check_output(["git","show",f"{qualification.BASELINE}:modules/adapters/runtime/python/worker/tasks/{name}"],cwd=qualification.ROOT,timeout=10)
                self.assertEqual(hashlib.sha256(content).hexdigest(),digest)
                (base/name).write_bytes(content)
            code='''import sys,json
from pathlib import Path
sys.path.insert(0,str(Path.cwd()/"dev-tools/scripts/qualification"))
import run_installed_generation_qualification as q
generation,runtime=q.modules_for("baseline",Path(sys.argv[1]))
print(json.dumps({"generation":Path(generation.__file__).parent==Path(sys.argv[1])/"baseline","runtime":Path(runtime.__file__).parent==Path(sys.argv[1])/"baseline","binding":generation.get_or_create_local_text_generator is runtime.get_or_create_local_text_generator}))
'''
            result=subprocess.run([sys.executable,"-s","-B","-c",code,str(folder)],cwd=qualification.ROOT,env={**os.environ,"PYTHONNOUSERSITE":"1"},capture_output=True,text=True,timeout=60)
            self.assertEqual(result.returncode,0,result.stderr[-2000:])
            self.assertEqual(json.loads(result.stdout),{"generation":True,"runtime":True,"binding":True})

    def test_historical_driver_refuses_changed_common_runtime(self):
        original=Path.read_bytes
        runtime=qualification.ROOT/"modules/adapters/runtime/python/worker/tasks/local_text_generation.py"
        def read(path):return b"changed common inference runtime" if path==runtime else original(path)
        with tempfile.TemporaryDirectory() as directory,patch.object(Path,"read_bytes",new=read):
            with self.assertRaisesRegex(ValueError,"runtime changed"):
                qualification.prepare_baseline(Path(directory))


if __name__=="__main__":unittest.main()
