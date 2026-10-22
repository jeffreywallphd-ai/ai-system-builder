"""Bounded offline installed-model comparison; synthetic held-out requests only."""
from __future__ import annotations
import argparse
from contextlib import redirect_stdout
import gc
import hashlib
import importlib.util
import importlib.metadata
import importlib
import json
import math
import os
from pathlib import Path
import queue
import re
import socket
import statistics
import subprocess
import sys
import threading
import time
import uuid

SCRIPT=Path(__file__).resolve()
ROOT=SCRIPT.parents[3]
sys.path.insert(0,str(SCRIPT.parent));sys.path.insert(0,str(ROOT))
from run_context_efficiency_qualification import rss
from run_trained_context_qualification import source_identity, sha256_file
from observe_windows_process_exit import observe

MODEL="Qwen/Qwen2.5-0.5B-Instruct"
REVISION="7ae557604adf67be50417f59c2c2f167def9a775"
BASELINE="442518c46fa9c2caf755ce1dd83b2f490b635330"
BASELINE_FILES={
    "constrained_json_decoder.py":"c96e814b515b5d0d101b583266889c0b7d016c846ee1f7740f31b8d588a6aaa5",
    "local_text_generation.py":"ce1419d7c1f25f62d4857167aba6aa2e0202bf0d222ef4c5a00e134694dfd5e5",
    "example_generation.py":"e99d3f4cc527fdd39693bbbcf247d406b472e8fd493beb24678a07b4d5bd9a29",
}
MODEL_FILES={
    "config.json":"18e18afcaccafade98daf13a54092927904649e1dd4eba8299ab717d5d94ff45",
    "generation_config.json":"e558847a8b4402616f1273797b015104dc266fe4b520056fca88823ba8f8ebe6",
    "tokenizer_config.json":"5b5d4f65d0acd3b2d56a35b56d374a36cbc1c8fa5cf3b3febbbfabf22f359583",
    "tokenizer.json":"c0382117ea329cdf097041132f6d735924b697924d6f6fc3945713e96ce87539",
    "vocab.json":"ca10d7e9fb3ed18575dd1e277a2579c16d108e32f27439684afa0e10b1440910",
    "merges.txt":"599bab54075088774b1733fde865d5bd747cbcc7a547c5bc12610e874e26f5e3",
    "LICENSE":"832dd9e00a68dd83b3c3fb9f5588dad7dcf337a0db50f7d9483f310cd292e92e",
    "model.safetensors":"fdf756fa7fcbe7404d5c60e26bff1a0c8b8aa1f72ced49e7dd0210fe288fb7fe",
}

MODEL_PROFILES={
    "qwen05-float32": {"model":MODEL,"revision":REVISION,"files":dict(MODEL_FILES),"cache_prefix":"qwen","precision":"float32","maximum_file_bytes":1024**3},
    "qwen15-bfloat16": {
        "model":"Qwen/Qwen2.5-1.5B-Instruct","revision":"989aa7980e4cf806f80c7fef2b1adb7bc71aa306",
        "files":{**MODEL_FILES,"config.json":"98d2ff8cc47488d08a2b0b3acf4eb99ef210779b42bd48605f6b8e36acdbf670","model.safetensors":"dd924a11b4c220f385b51ffa522daea7c9f3d850e31b162bb5661df483c6d3ee"},
        "cache_prefix":"qwen15","precision":"bfloat16","maximum_file_bytes":3200*1024**2,
    },
}
MODEL_PROFILE="qwen05-float32"
MODEL_CACHE_PREFIX="qwen"
MODEL_PRECISION="float32"
MODEL_MAXIMUM_FILE_BYTES=1024**3


def configure_model_profile(name):
    global MODEL_PROFILE,MODEL,REVISION,MODEL_FILES,MODEL_CACHE_PREFIX,MODEL_PRECISION,MODEL_MAXIMUM_FILE_BYTES
    if name not in MODEL_PROFILES:raise ValueError("Unknown fixed model profile.")
    profile=MODEL_PROFILES[name]
    MODEL_PROFILE=name;MODEL=profile["model"];REVISION=profile["revision"];MODEL_FILES=dict(profile["files"])
    MODEL_CACHE_PREFIX=profile["cache_prefix"];MODEL_PRECISION=profile["precision"];MODEL_MAXIMUM_FILE_BYTES=profile["maximum_file_bytes"]

DIAGNOSTIC_MAX_BYTES=1024*1024
INVALID_OUTPUT_CODES={"decoder-output-invalid","decoder-output-empty","decoder-output-truncated"}


def decoder_failure_kind(code):
    return "invalid-output" if code in INVALID_OUTPUT_CODES else "operational"


def phase_counts(cases):
    attempts=sum(row["attempts"] for row in cases)
    operational=sum(row["operational_errors"] for row in cases)
    outputs=attempts-operational
    invalid=sum(row["invalid_attempts"] for row in cases)
    return {"generator_invocations":attempts,"output_attempts":outputs,"invalid_output_attempts":invalid,"invalid_output_rate":invalid/outputs if outputs else None,"operational_errors":operational,"repairs":sum(row["repairs"] for row in cases)}


class BoundedDiagnosticSink:
    def __init__(self,output,evidence,maximum_bytes=DIAGNOSTIC_MAX_BYTES):
        if not 0<maximum_bytes<=DIAGNOSTIC_MAX_BYTES:raise ValueError("Invalid diagnostic bound.")
        self.output=output;self.evidence=evidence;self.maximum_bytes=maximum_bytes;self.written_bytes=0

    def write(self,text):
        count=len(text.encode("utf-8"))
        if self.written_bytes+count>self.maximum_bytes:
            self.evidence["diagnostic_overflow"]=True
            raise RuntimeError("Private qualification diagnostics exceeded their byte bound.")
        result=self.output.write(text);self.written_bytes+=count;return result

    def flush(self):self.output.flush()


def exact_binomial_interval(correct,total,alpha=.05):
    """Nominal Clopper-Pearson bounds; fixed fixtures imply no population claim."""
    if isinstance(correct,bool) or isinstance(total,bool) or not isinstance(correct,int) or not isinstance(total,int) or not 0<=correct<=total or not 1<=total<=24:raise ValueError("Invalid fixed fixture count.")
    def cdf(k,p):return sum(math.comb(total,i)*p**i*(1-p)**(total-i) for i in range(k+1))
    def root(predicate):
        lower,upper=0.,1.
        for _ in range(64):
            middle=(lower+upper)/2
            if predicate(middle):lower=middle
            else:upper=middle
        return (lower+upper)/2
    lower=0. if correct==0 else root(lambda p:1-cdf(correct-1,p)<alpha/2)
    upper=1. if correct==total else root(lambda p:cdf(correct,p)>alpha/2)
    return [lower,upper]

def checked_path(relative):
    target=ROOT/relative
    target.relative_to(ROOT)
    for part in [target,*target.parents]:
        if part==ROOT.parent:break
        stat=part.lstat()
        if part.is_symlink() or getattr(stat,"st_file_attributes",0)&0x400:raise ValueError("Redirected qualification input.")
    return target

def verified_model(relative):
    if not re.fullmatch(r"\.local-codex/model-qualification/"+re.escape(MODEL_CACHE_PREFIX)+r"-[a-f0-9-]{36}/acquisition\.json",relative):raise ValueError("Fixed isolated acquisition required.")
    manifest=checked_path(relative)
    if manifest.stat().st_size>65536:raise ValueError("Oversized acquisition.")
    data=json.loads(manifest.read_text(encoding="utf-8"))
    if (data.get("model"),data.get("revision"),data.get("status"))!=(MODEL,REVISION,"verified"):raise ValueError("Model identity differs.")
    if {entry["name"]:entry["sha256"] for entry in data["files"]}!=MODEL_FILES or len(data["files"])!=len(MODEL_FILES):raise ValueError("Model file evidence differs.")
    if {p.name for p in manifest.parent.iterdir()}!=set(MODEL_FILES)|{"acquisition.json"}:raise ValueError("Unexpected model input.")
    for name,digest in MODEL_FILES.items():
        item=checked_path(str((manifest.parent/name).relative_to(ROOT)).replace("\\","/"))
        if not item.is_file() or not 0<item.stat().st_size<=(MODEL_MAXIMUM_FILE_BYTES if name=="model.safetensors" else 16*1024**2) or sha256_file(item)!=digest:raise ValueError("Model integrity failed.")
    return manifest.parent

def heldout_plan():
    data=json.loads(SCRIPT.with_name("installed_generation_holdout.json").read_text(encoding="utf-8"))
    rows=data["heldout"]
    if len(rows)!=24 or len({r["id"] for r in rows})!=24 or len({r["text"] for r in rows})!=24 or any(sum(r["label"]==label for r in rows)!=12 for label in ["billing","support"]):raise ValueError("Fixed held-out corpus invalid.")
    if MODEL_PROFILE!="qwen05-float32":
        data["model_profile"]=MODEL_PROFILE
        data["precision"]=MODEL_PRECISION
        data["precision_rationale"]="Separately predeclared native bfloat16 for both matched variants on CPU/CUDA; unchanged generation memory admission and original0.5B failed results remain authoritative."
    return data

def prepare_baseline(folder):
    base=folder/"baseline";base.mkdir()
    for name,digest in BASELINE_FILES.items():
        content=subprocess.check_output(["git","show",f"{BASELINE}:modules/adapters/runtime/python/worker/tasks/{name}"],cwd=ROOT,timeout=10)
        if hashlib.sha256(content).hexdigest()!=digest:raise ValueError("Unchanged baseline integrity failed.")
        with (base/name).open("xb") as output:output.write(content)
    common=(ROOT/"modules/adapters/runtime/python/worker/tasks/local_text_generation.py").read_bytes().replace(b"\r\n",b"\n")
    if hashlib.sha256(common).hexdigest()!=BASELINE_FILES["local_text_generation.py"]:raise ValueError("Shared inference runtime changed from baseline.")

def modules_for(variant,folder):
    # Initialize the unchanged common package completely before replacing the
    # three selected algorithms. Its eager __init__ imports task dispatchers;
    # partially inserting example_generation first creates an import cycle.
    # Both variants pay the same common-import precondition outside measurement.
    package=importlib.import_module("modules.adapters.runtime.python.worker.tasks")
    if variant=="baseline":
        for name,digest in BASELINE_FILES.items():
            file=folder/"baseline"/name
            if sha256_file(file)!=digest:raise ValueError("Baseline substitution refused.")
            module_name="modules.adapters.runtime.python.worker.tasks."+name.removesuffix(".py")
            spec=importlib.util.spec_from_file_location(module_name,file)
            module=importlib.util.module_from_spec(spec);sys.modules[module_name]=module
            setattr(package,name.removesuffix(".py"),module)
            spec.loader.exec_module(module)
    if variant=="baseline" and any(Path(sys.modules["modules.adapters.runtime.python.worker.tasks."+name.removesuffix(".py")].__file__).parent!=folder/"baseline" for name in BASELINE_FILES):raise ValueError("Mixed baseline modules refused.")
    if variant=="baseline":
        generation=sys.modules["modules.adapters.runtime.python.worker.tasks.example_generation"]
        runtime=sys.modules["modules.adapters.runtime.python.worker.tasks.local_text_generation"]
        decoder=sys.modules["modules.adapters.runtime.python.worker.tasks.constrained_json_decoder"]
        if generation.get_or_create_local_text_generator is not runtime.get_or_create_local_text_generator or runtime.ConstrainedJsonDecoder is not decoder.ConstrainedJsonDecoder or generation.ConstrainedJsonDecoderError is not decoder.ConstrainedJsonDecoderError or any(getattr(package,name.removesuffix(".py")) is not sys.modules["modules.adapters.runtime.python.worker.tasks."+name.removesuffix(".py")] for name in BASELINE_FILES):raise ValueError("Mixed baseline bindings refused.")
        return generation,runtime
    from modules.adapters.runtime.python.worker.tasks import example_generation,local_text_generation
    return example_generation,local_text_generation

def compare_cohort(pairs,plan):
    if len(pairs)!=plan["replicates"]:raise ValueError("Missing repeated delivery measurements.")
    quality=True;ratios=[];paired_quality=[]
    for pair in pairs:
        baseline,candidate=pair["baseline"],pair["candidate"]
        for phase in ("first","warm"):
            before=baseline["phases"][phase]["cases"];after=candidate["phases"][phase]["cases"]
            expected=[row["id"] for row in plan["heldout"]]
            if [r["id"] for r in before]!=expected or [r["id"] for r in after]!=expected:raise ValueError("Unmatched semantic requests.")
            regressions=sum(a["correct"] and not b["correct"] for a,b in zip(before,after))
            correct=sum(r["correct"] for r in after)
            quality=quality and correct/24>=plan["absolute_quality_floor"] and regressions/24<=0.02
            before_correct=sum(r["correct"] for r in before)
            paired_quality.append({"replicate":len(ratios),"phase":phase,"distinct_fixed_cases":24,"baseline_correct":before_correct,"candidate_correct":correct,"both_correct":sum(a["correct"] and b["correct"] for a,b in zip(before,after)),"improved":sum(not a["correct"] and b["correct"] for a,b in zip(before,after)),"regressed":regressions,"both_incorrect":sum(not a["correct"] and not b["correct"] for a,b in zip(before,after)),"baseline_nominal_95_exact_binomial_interval":exact_binomial_interval(before_correct,24),"candidate_nominal_95_exact_binomial_interval":exact_binomial_interval(correct,24)})
        quality=quality and candidate["cleanup_passed"] and baseline["cleanup_passed"] and candidate["physical_exit_code"]==0 and baseline["physical_exit_code"]==0 and not candidate.get("diagnostic_overflow",False) and not baseline.get("diagnostic_overflow",False)
        rate=baseline["accepted_per_minute"]
        ratios.append(candidate["accepted_per_minute"]/rate if rate>0 else None)
    defined=[value for value in ratios if value is not None]
    ratio=statistics.median(defined) if len(defined)==len(pairs) else None
    return {"quality_passed":bool(quality),"paired_quality":paired_quality,"interval_limit":"Nominal exact binomial count bounds assume Bernoulli sampling. This fixed synthetic fixture is not a population sample; repeated phases/replicates do not increase its24distinct cases.","paired_delivery_ratios":ratios,"median_delivery_ratio":ratio,"throughput_target_met":ratio is not None and ratio>=1.2}

def measure(args,folder):
    model_path=verified_model(args.model_manifest);plan=heldout_plan()
    os.environ.update(HF_HUB_OFFLINE="1",TRANSFORMERS_OFFLINE="1",HF_HUB_DISABLE_TELEMETRY="1",TOKENIZERS_PARALLELISM="false")
    def deny(*_args,**_kwargs):raise RuntimeError("External I/O and pickle loading forbidden in qualification.")
    import torch
    torch.set_num_threads(4);torch.manual_seed(17);torch.load=deny
    socket.socket.connect=deny;socket.socket.connect_ex=deny;socket.create_connection=deny
    generation,runtime=modules_for(args.variant,folder)
    from modules.adapters.runtime.python.worker.models import ExampleGenerationConfig
    from modules.adapters.runtime.python.worker.tasks.markdown_chunking import MarkdownChunk
    from modules.adapters.runtime.python.worker.tasks.structured_output_runtime import RuntimeStructuredOutput
    runtime._RESOLVED_MODEL_REFERENCES[MODEL]=str(model_path)
    config=ExampleGenerationConfig.model_validate({"mode":"qa","failurePolicy":"skip","promptTemplate":plan["prompt"],"model":{"provider":"transformers","modelId":MODEL,"inferenceMode":"chat","device":args.device,"torchDtype":plan["precision"]},"generationParams":plan["generation_params"]})
    recipe={"labelSet":plan["labels"]}
    schema=generation.build_task_structured_output_schema(plan["task_type"],recipe)
    structured=RuntimeStructuredOutput(schema=schema,example=generation.build_task_structured_output_example(plan["task_type"],recipe),schema_fingerprint=hashlib.sha256(json.dumps(schema,sort_keys=True).encode()).hexdigest(),payload_key="example",purpose_paths={"label":("label",)},constrained_decoding=args.mode=="constrained")
    allocated_floor=reserved_floor=0
    if args.device=="cuda":
        if not torch.cuda.is_available():raise RuntimeError("Required CUDA unavailable.")
        matrix=torch.zeros((16,16),device="cuda");result=matrix@matrix;torch.cuda.synchronize();del matrix,result;torch.cuda.empty_cache()
        allocated_floor=torch.cuda.memory_allocated();reserved_floor=torch.cuda.memory_reserved();torch.cuda.reset_peak_memory_stats()
    tag=f"{args.device}-{args.mode}-{args.replicate}-{args.variant}"
    progress={"schema_version":"installed-generation-cohort-v1","variant":args.variant,"model_profile":MODEL_PROFILE,"precision":plan["precision"],"device":args.device,"mode":args.mode,"replicate":args.replicate,"status":"running","schema_sha256":structured.schema_fingerprint,"phases":{},"cleanup_passed":False,"environment":{"platform":sys.platform,"python":sys.version.split()[0],"logical_processors":os.cpu_count(),"torch":torch.__version__,"transformers":importlib.metadata.version("transformers"),"cuda_runtime":torch.version.cuda,"accelerator":torch.cuda.get_device_name() if args.device=="cuda" else None,"accelerator_memory_bytes":torch.cuda.get_device_properties(0).total_memory if args.device=="cuda" else 0}}
    progress_path=folder/f"cohort-{tag}.json"
    def save():progress_path.write_text(json.dumps(progress,indent=2)+"\n",encoding="utf-8")
    save();print(json.dumps({"kind":"ready","pid":os.getpid(),"parent_pid":os.getppid(),"rss_bytes":rss(os.getpid())}),flush=True)
    if sys.stdin.readline().strip()!="run":raise ValueError("Invalid owned qualification handshake.")
    devices=set();mismatches=[]
    def placement(layer,inputs):
        if isinstance(layer,torch.nn.Embedding) and inputs and hasattr(inputs[0],"device"):
            devices.add(str(inputs[0].device))
            if layer.weight.device!=inputs[0].device:mismatches.append(True)
    hook=torch.nn.modules.module.register_module_forward_pre_hook(placement)
    started=time.perf_counter();generator=None;original_generate=None;original_parse=None
    diagnostic_file=(folder/f"private-diagnostic-{tag}.log").open("x",encoding="utf-8")
    diagnostic=BoundedDiagnosticSink(diagnostic_file,progress)
    try:
      with redirect_stdout(diagnostic):
        load_started=time.perf_counter();generator=runtime.get_or_create_local_text_generator(config)
        if args.device=="cuda":torch.cuda.synchronize()
        progress["load_seconds"]=time.perf_counter()-load_started
        effective=generator._model.generation_config.to_dict()|generator._generation_params
        for key,value in plan["effective_sampling"].items():
            if effective.get(key)!=value:raise ValueError("Effective generation settings differ.")
        if str(generator._model.dtype)!=f"torch.{plan['precision']}":raise ValueError("Actual precision differs.")
        progress["effective_sampling"]={key:effective[key] for key in plan["effective_sampling"]}
        original_generate=generator.generate_text;original_parse=generation._parse_task_structured_output
        current={}
        def observed_generate(*arguments,**keywords):
            current["attempts"]+=1
            try:return original_generate(*arguments,**keywords)
            except generation.ConstrainedJsonDecoderError as error:
                kind=decoder_failure_kind(error.code)
                if kind=="invalid-output":current["invalid_attempts"]+=1
                else:
                    current["operational_errors"]+=1
                    current["operational_error_codes"].append(error.code if re.fullmatch(r"[a-z0-9-]{1,64}",str(error.code)) else "decoder-operational-failure")
                raise
            except Exception:
                current["operational_errors"]+=1;current["operational_error_codes"].append("generation-inference-failed");raise
        def observed_parse(*arguments,**keywords):
            try:return original_parse(*arguments,**keywords)
            except ValueError:
                current["invalid_attempts"]+=1;raise
        generator.generate_text=observed_generate;generation._parse_task_structured_output=observed_parse
        for phase in ("first","warm"):
            phase_started=time.perf_counter();phase_result={"cases":[]};progress["phases"][phase]=phase_result
            for index,row in enumerate(plan["heldout"]):
                torch.manual_seed(17+index)
                if args.device=="cuda":torch.cuda.synchronize()
                current={"id":row["id"],"attempts":0,"invalid_attempts":0,"operational_errors":0,"operational_error_codes":[],"repairs":0,"correct":False,"accepted":False,"status":"running"}
                case_started=time.perf_counter()
                def repaired(_event):current["repairs"]+=1
                try:
                    examples=generation.generate_task_examples_for_chunks([MarkdownChunk("synthetic-heldout",index,row["text"])],config,plan["task_type"],recipe,structured_output=structured,on_output_repair=repaired)
                    if len(examples)>1:raise ValueError("Unbounded generation result.")
                    current["accepted"]=bool(examples)
                    current["correct"]=bool(examples and examples[0].structured_fields=={"label":row["label"]})
                    current["status"]="correct" if current["correct"] else "wrong-label" if examples else "skip-or-rejected"
                    del examples
                except (generation.GenerationOutputValidationError,generation.ConstrainedJsonDecoderError) as error:
                    current["status"]="rejected";current["error_type"]=type(error).__name__
                    if isinstance(error,generation.ConstrainedJsonDecoderError) and error.code in generation._NON_RETRYABLE_CONSTRAINED_DECODER_CODES:raise
                finally:
                    if args.device=="cuda":torch.cuda.synchronize()
                    current["seconds"]=time.perf_counter()-case_started;phase_result["cases"].append(current);save()
            phase_result["seconds"]=time.perf_counter()-phase_started
            phase_result["correct"]=sum(r["correct"] for r in phase_result["cases"])
            phase_result.update(phase_counts(phase_result["cases"]))
            phase_result["accepted_per_minute"]=60*phase_result["correct"]/phase_result["seconds"];save()
        progress["actual_tensor_devices"]=sorted(devices)
        if devices!={"cuda:0" if args.device=="cuda" else "cpu"} or mismatches:raise ValueError("Actual tensor placement differs.")
        progress["peak_allocated_vram_bytes"]=torch.cuda.max_memory_allocated() if args.device=="cuda" else 0
        progress["peak_reserved_vram_bytes"]=torch.cuda.max_memory_reserved() if args.device=="cuda" else 0
        progress["status"]="measured"
    finally:
      with redirect_stdout(diagnostic):
        cleanup_started=time.perf_counter()
        if generator is not None and original_generate is not None:generator.generate_text=original_generate
        if original_parse is not None:generation._parse_task_structured_output=original_parse
        generator=None;original_generate=None;original_parse=None
        runtime.unload_generation_models();gc.collect()
        if args.device=="cuda":torch.cuda.synchronize();torch.cuda.empty_cache()
        allocated=torch.cuda.memory_allocated() if args.device=="cuda" else 0
        reserved=torch.cuda.memory_reserved() if args.device=="cuda" else 0
        progress.update(cleanup_seconds=time.perf_counter()-cleanup_started,runtime_allocated_floor_bytes=allocated_floor,runtime_reserved_floor_bytes=reserved_floor,remaining_allocated_vram_bytes=allocated,remaining_reserved_vram_bytes=reserved,remaining_rss_bytes=rss(os.getpid()))
        progress["cleanup_passed"]=not runtime._GENERATOR_CACHE and allocated<=allocated_floor and reserved<=reserved_floor
        progress["whole_delivery_seconds"]=time.perf_counter()-started
        correct=sum(value.get("correct",0) for value in progress["phases"].values())
        progress["accepted_per_minute"]=60*correct/progress["whole_delivery_seconds"]
        if progress["status"]=="measured":progress["status"]="passed" if progress["cleanup_passed"] and not progress.get("diagnostic_overflow",False) else "failed-cleanup-or-diagnostics"
        else:progress["status"]="failed"
        save();hook.remove()
      diagnostic_file.close()
    if progress["status"]!="passed":raise ValueError("Installed generation did not clean up.")
    print(json.dumps({"kind":"result","report":progress_path.name}),flush=True)

def child_command(args,folder,variant,device,mode,replicate):
    selected=getattr(args,"model_profile",MODEL_PROFILE)
    if selected!=MODEL_PROFILE:raise ValueError("Child model profile differs from its parent.")
    return [sys.executable,"-s","-B",str(SCRIPT),"--child","--run-id",folder.name,"--variant",variant,"--device",device,"--mode",mode,"--replicate",str(replicate),"--model-manifest",args.model_manifest,"--model-profile",selected]


def run_child(args,folder,variant,device,mode,replicate):
    command=child_command(args,folder,variant,device,mode,replicate)
    process=subprocess.Popen(command,cwd=ROOT,stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True,encoding="utf-8",creationflags=subprocess.CREATE_NO_WINDOW if os.name=="nt" else 0)
    messages=queue.Queue(maxsize=4);overflow=threading.Event();readers=[];native_thread=None;native_ready=threading.Event();native_result=[];stderr=[]
    def drain(stream,collect):
        total=0
        while line:=stream.readline(1024*1024+1):
            total+=len(line)
            if total>1024*1024:overflow.set();return
            if collect:
                try:messages.put_nowait(line)
                except queue.Full:overflow.set();return
            else:stderr.append(line)
    try:
        readers=[threading.Thread(target=drain,args=(process.stdout,True),daemon=True),threading.Thread(target=drain,args=(process.stderr,False),daemon=True)]
        for thread in readers:thread.start()
        ready=json.loads(messages.get(timeout=90))
        if ready.get("kind")!="ready" or (ready["pid"]!=process.pid and ready["parent_pid"]!=process.pid):raise ValueError("Foreign qualification child.")
        def native():
            try:native_result.append(observe(ready["pid"],native_ready.set,1_200_000))
            except Exception:native_result.append(None);native_ready.set()
        native_thread=threading.Thread(target=native,daemon=True);native_thread.start()
        if not native_ready.wait(5) or native_result:raise ValueError("Native child observation unavailable.")
        baseline=peak=ready["rss_bytes"];started=time.monotonic();process.stdin.write("run\n");process.stdin.flush()
        while process.poll() is None:
            if overflow.is_set() or time.monotonic()-started>1200:raise RuntimeError("Installed model qualification exceeded its bound.")
            try:peak=max(peak,rss(ready["pid"]))
            except OSError:process.wait(timeout=.25)
            if peak>6*1024**3:raise RuntimeError("Disposable test exceeded6GiB safety ceiling, not a product budget.")
            time.sleep(.005)
        for thread in readers:thread.join(timeout=2)
        native_thread.join(timeout=5)
        if process.returncode or overflow.is_set() or any(t.is_alive() for t in readers) or native_result!=[0]:raise RuntimeError("Owned installed-model child failed.")
        result=json.loads(messages.get(timeout=1))
        expected=f"cohort-{device}-{mode}-{replicate}-{variant}.json"
        if result!={"kind":"result","report":expected} or not messages.empty():raise ValueError("Invalid qualification protocol.")
        report=json.loads((folder/expected).read_text(encoding="utf-8"))
        if report.get("status")!="passed" or report.get("diagnostic_overflow",False) or not report.get("cleanup_passed"):raise ValueError("Incomplete child evidence refused.")
        report.update(initial_rss_bytes=baseline,peak_rss_bytes=peak,incremental_peak_rss_bytes=max(0,peak-baseline),physical_exit_code=0)
        (folder/expected).write_text(json.dumps(report,indent=2)+"\n",encoding="utf-8")
        return report
    finally:
        if process.poll() is None:
            subprocess.run(["taskkill","/PID",str(process.pid),"/T","/F"],capture_output=True,timeout=10);process.wait(timeout=10)
        for thread in readers:thread.join(timeout=2)
        if native_thread is not None:native_thread.join(timeout=5)
        for stream in (process.stdin,process.stdout,process.stderr):stream.close()
        if stderr:
            with (folder/f"private-stderr-{uuid.uuid4().hex}.log").open("x",encoding="utf-8") as output:output.write("".join(stderr))

def main():
    parser=argparse.ArgumentParser(description=__doc__);parser.add_argument("--model-manifest",required=True)
    parser.add_argument("--model-profile",choices=tuple(MODEL_PROFILES),default="qwen05-float32")
    parser.add_argument("--child",action="store_true");parser.add_argument("--run-id");parser.add_argument("--variant",choices=["baseline","candidate"],default="candidate");parser.add_argument("--device",choices=["cpu","cuda"],default="cpu");parser.add_argument("--mode",choices=["unchecked","constrained"],default="constrained");parser.add_argument("--replicate",type=int,choices=[0,1,2],default=0)
    args=parser.parse_args();configure_model_profile(args.model_profile);run_id=args.run_id if args.child else uuid.uuid4().hex
    if not re.fullmatch(r"[a-f0-9]{32}",str(run_id)):raise ValueError("Invalid qualification identity.")
    folder=ROOT/".local-codex/installed-generation"/run_id;folder.mkdir(parents=True,exist_ok=args.child)
    if args.child:measure(args,folder);return
    if os.name!="nt":raise ValueError("Named Windows qualification required.")
    plan=heldout_plan();verified_model(args.model_manifest);prepare_baseline(folder);source=source_identity()
    report={"schema_version":"installed-generation-qualification-v1","source_revision":source,"model":MODEL,"revision":REVISION,"model_profile":MODEL_PROFILE,"baseline_commit":BASELINE,"baseline_files":BASELINE_FILES,"plan":plan,"plan_sha256":hashlib.sha256(json.dumps(plan,sort_keys=True).encode()).hexdigest(),"status":"running","cohorts":[],"measurement_boundary":"Configured RuntimeStructuredOutput classification worker function path, not whole-host/default dataset preparation. Common Python/Torch imports, CUDA runtime initialization and precondition input hash checks excluded. Whole-child delivery includes fresh production model load, first24 one-source requests, warm24 one-source requests, every repair/failure and one unload. Phase timings do not both claim final cleanup. OS file cache uncontrolled. Repeated24-case phases/replicates are timing repetitions, not larger semantic population coverage."}
    def save():(folder/"report.json").write_text(json.dumps(report,indent=2)+"\n",encoding="utf-8")
    save()
    for device in plan["devices"]:
      for mode in plan["modes"]:
        cohort={"device":device,"mode":mode,"pairs":[],"status":"running"};report["cohorts"].append(cohort);save()
        try:
          for replicate in range(plan["replicates"]):
            pair={};cohort["pairs"].append(pair)
            for variant in (["baseline","candidate"] if replicate%2==0 else ["candidate","baseline"]):
                pair[variant]=run_child(args,folder,variant,device,mode,replicate);save()
            print(json.dumps({"device":device,"mode":mode,"replicate":replicate,"phase":"measured-pair"}),flush=True)
          cohort.update(compare_cohort(cohort["pairs"],plan));cohort["status"]="passed" if cohort["quality_passed"] else "failed-quality"
        except Exception as error:cohort.update(status="failed",error_type=type(error).__name__)
        save();print(json.dumps({"device":device,"mode":mode,"status":cohort["status"]}),flush=True)
    report["source_stable"]=source_identity()==source
    try:verified_model(args.model_manifest);report["inputs_stable"]=heldout_plan()==plan
    except (ValueError,OSError):report["inputs_stable"]=False
    report["qualification_complete"]=report["source_stable"] and report["inputs_stable"] and len(report["cohorts"])==4 and all(c["status"]=="passed" for c in report["cohorts"]) and any(c.get("throughput_target_met") for c in report["cohorts"])
    report["status"]="passed" if report["qualification_complete"] else "failed";save();print(json.dumps({"status":report["status"],"report":str((folder/"report.json").relative_to(ROOT)).replace("\\","/")}),flush=True)
    if not report["qualification_complete"]:raise SystemExit(1)

if __name__=="__main__":main()

