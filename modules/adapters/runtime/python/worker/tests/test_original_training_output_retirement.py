"""Real finite Native ABI paths with in-memory replies; no physical worker/model."""
from threading import Thread
import unittest
from unittest.mock import patch

from modules.adapters.runtime.python.worker.tests import test_native_training_model_graph as fixtures


class OriginalTrainingOutputRetirementTests(unittest.TestCase):
    def fixture(self, method="lora", large=False):
        case=fixtures.TrainingOutputReaderTests()
        facts=case.fixture(method,large=large)
        self.addCleanup(case.doCleanups)
        return case,facts

    def calls(self, kernel, start):
        return [(name,args) for name,args in kernel.calls[start:]]

    def test_all_profiles_retire_original_output_only_keep_bytes_and_charge_once(self):
        for method in ("lora","qlora","full-finetune"):
            with self.subTest(method=method):
                case,facts=self.fixture(method)
                actual,_,lease,inputs,request,_,kernel,config,contents,files,control=facts
                with lease.borrow(request) as view:
                    graph=case.graph(actual,view,request,config,files,control,contents)
                    self.assertEqual(len(list(actual.read_original_training_output_chunks(graph,view,request))),len(files)*2)
                    held=tuple(h for h in graph.owned_handles if not h.closed)
                    other=tuple(inputs.owner.handles)
                    other_closed=tuple(h.closed for h in other)
                    data={name:bytes(row["data"]) for name,row in kernel.nodes.items()}
                    before=len(kernel.calls)
                    self.assertTrue(graph.retire_copy_io());self.assertTrue(graph.retire_copy_io())
                    self.assertEqual(self.calls(kernel,before),[("CloseHandle",(h.slot.value,)) for h in reversed(held)])
                    self.assertTrue(all(h.closed for h in graph.owned_handles))
                    self.assertEqual(tuple(h.closed for h in other),other_closed)
                    self.assertEqual({name:bytes(row["data"]) for name,row in kernel.nodes.items()},data)
                    self.assertEqual(control.charges,[config["maximumCopyBytes"]])
                    self.assertEqual(control.retained,[config["maximumCopyBytes"]])
                    self.assertEqual(graph.phase,"retired");self.assertTrue(graph.retired)
                    before=len(kernel.calls)
                    with self.assertRaises(actual.LaunchUnavailable):graph.assert_sealed()
                    with self.assertRaises(actual.LaunchUnavailable):actual.read_original_training_output_chunks(graph,view,request)
                    self.assertEqual(len(kernel.calls),before)

    def test_retirement_outlives_borrow_business_and_preparation_lifetime(self):
        case,facts=self.fixture()
        actual,_,lease,_,request,input_control,kernel,config,contents,files,control=facts
        with lease.borrow(request) as view:
            graph=case.graph(actual,view,request,config,files,control,contents)
        input_control.current=False;control.current=False
        graph.current=lambda: self.fail("Cleanup called a business observer")
        graph.assert_reservation=lambda: self.fail("Cleanup called a current-resource observer")
        control.retain_source_copy=lambda _: self.fail("Cleanup adopted a new retain method")
        graph.started=-1000000
        self.assertTrue(graph.retire_copy_io())
        self.assertEqual(control.retained,[config["maximumCopyBytes"]])

    def test_unread_reserved_and_paused_streams_cannot_advance_after_retirement(self):
        for state in ("unread","reserved","paused"):
            with self.subTest(state=state):
                case,facts=self.fixture(large=True)
                actual,_,lease,_,request,_,kernel,config,contents,files,control=facts
                with lease.borrow(request) as view:
                    graph=case.graph(actual,view,request,config,files,control,contents)
                    stream=None
                    if state!="unread":stream=actual.read_original_training_output_chunks(graph,view,request)
                    if state=="paused":self.assertTrue(next(stream)[2])
                    self.assertTrue(graph.retire_copy_io());before=len(kernel.calls)
                    if stream is not None:
                        with self.assertRaises(actual.LaunchUnavailable):next(stream)
                    with self.assertRaises(actual.LaunchUnavailable):actual.read_original_training_output_chunks(graph,view,request)
                    self.assertEqual(len(kernel.calls),before)

    def test_wrong_thread_and_forged_copy_do_not_consume_original_attempt(self):
        case,facts=self.fixture()
        actual,_,lease,_,request,_,kernel,config,contents,files,control=facts
        with lease.borrow(request) as view:
            graph=case.graph(actual,view,request,config,files,control,contents);before=len(kernel.calls)
            forged=object.__new__(actual.OriginalTrainingOutputGraph)
            forged.__dict__.update(graph.__dict__)
            self.assertFalse(forged.retire_copy_io())
            results=[];thread=Thread(target=lambda:results.append(graph.retire_copy_io()))
            thread.start();thread.join(3)
            self.assertFalse(thread.is_alive());self.assertEqual(results,[False])
            self.assertEqual(len(kernel.calls),before);self.assertFalse(graph.retirement_attempted)
            self.assertTrue(graph.retire_copy_io())

    def test_busy_operation_and_reader_are_not_retired_underneath_active_io(self):
        for kind in ("operation","read"):
            with self.subTest(kind=kind):
                case,facts=self.fixture()
                actual,_,lease,_,request,_,kernel,config,contents,files,control=facts
                with lease.borrow(request) as view:
                    graph=case.graph(actual,view,request,config,files,control,contents)
                    actual.read_original_training_output_chunks(graph,view,request)
                    record=actual._training_output_readers[graph]
                    lock=graph._operation_lock if kind=="operation" else record["read_lock"]
                    lock.acquire();before=len(kernel.calls)
                    try:self.assertFalse(graph.retire_copy_io())
                    finally:lock.release()
                    self.assertEqual(len(kernel.calls),before);self.assertFalse(graph.retirement_attempted)
                    self.assertTrue(graph.retire_copy_io())

    def test_real_write_and_read_callbacks_defer_retirement_until_io_finishes(self):
        for operation in ("WriteFile","ReadFile"):
            with self.subTest(operation=operation):
                _,facts=self.fixture()
                actual,_,lease,_,request,_,kernel,config,contents,files,control=facts
                with lease.borrow(request) as view:
                    graph=actual.OriginalTrainingOutputGraph(view,request,config,files,control,control)
                    attempted=[]
                    def during(name):
                        if name==operation and not attempted:attempted.append(graph.retire_copy_io())
                    if operation=="WriteFile":kernel.after=during
                    graph.prepare({name:(raw,) for name,raw in contents.items()})
                    if operation=="ReadFile":
                        kernel.after=during
                        list(actual.read_original_training_output_chunks(graph,view,request))
                    kernel.after=None
                    self.assertEqual(attempted,[False]);self.assertFalse(graph.retirement_attempted)
                    self.assertTrue(graph.retire_copy_io())

    def test_changed_original_bindings_deny_without_close_or_accounting(self):
        for kind in ("owner","native-owner","invoke","kernel","clock","lock","buffers","pending","unknown",
                "handles","owned-handles","slot","number","role","known","closed","close-attempted",
                "retain","reservation","charge-attempted","charged","operation-lock","operation-active","dispatch"):
            with self.subTest(kind=kind):
                case,facts=self.fixture()
                actual,_,lease,_,request,_,kernel,config,contents,files,control=facts
                with lease.borrow(request) as view:
                    graph=case.graph(actual,view,request,config,files,control,contents)
                    owner=graph.owner;handle=next(h for h in graph.owned_handles if not h.closed)
                    if kind=="owner":graph.owner=object()
                    elif kind=="native-owner":graph._native_owner=object()
                    elif kind in ("invoke","kernel","clock","lock","buffers"):setattr(owner,kind,object())
                    elif kind=="pending":owner.pending.append({"unknown":True})
                    elif kind=="unknown":owner.unknown=True
                    elif kind=="handles":owner.handles=list(owner.handles)
                    elif kind=="owned-handles":graph.owned_handles=list(graph.owned_handles)
                    elif kind=="slot":handle.slot=actual.P(handle.slot.value)
                    elif kind=="number":handle.slot.value+=10000
                    elif kind=="role":handle.role="job"
                    elif kind=="known":handle.known=False
                    elif kind=="closed":handle.closed=True
                    elif kind=="close-attempted":handle.close_attempted=True
                    elif kind=="retain":graph.retain=lambda _:True
                    elif kind=="reservation":graph.reservation=object()
                    elif kind=="charge-attempted":graph.charge_attempted=False
                    elif kind=="charged":graph.charged=False
                    elif kind=="operation-lock":graph._operation_lock=object()
                    elif kind=="operation-active":graph._operation_active=True
                    else:owner.close=lambda _: self.fail("Replacement close ran")
                    before=len(kernel.calls)
                    self.assertFalse(graph.retire_copy_io());self.assertFalse(graph.retire_copy_io())
                    self.assertEqual(len(kernel.calls),before);self.assertEqual(control.retained,[])

    def test_changed_class_dispatch_is_rejected_without_running_replacement(self):
        case,facts=self.fixture()
        actual,_,lease,_,request,_,kernel,config,contents,files,control=facts
        with lease.borrow(request) as view:
            graph=case.graph(actual,view,request,config,files,control,contents);before=len(kernel.calls)
            with patch.object(actual.InheritedModelNativeCalls,"number",lambda *_:self.fail("Replacement number ran")):
                self.assertFalse(graph.retire_copy_io())
            self.assertFalse(graph.retire_copy_io());self.assertEqual(len(kernel.calls),before)

    def test_sealed_inventory_rejects_late_handle_and_inherited_observation(self):
        for kind in ("handle","observe"):
            with self.subTest(kind=kind):
                case,facts=self.fixture()
                actual,_,lease,_,request,_,kernel,config,contents,files,control=facts
                with lease.borrow(request) as view:
                    graph=case.graph(actual,view,request,config,files,control,contents);before=len(kernel.calls)
                    with self.assertRaises(actual.LaunchUnavailable):
                        if kind=="handle":graph.owner.handle("model-read")
                        else:graph.owner.observe(next(h.slot.value for h in graph.guards if not h.closed),"model-read")
                    self.assertEqual(len(kernel.calls),before);self.assertFalse(graph.retire_copy_io())
                    self.assertEqual(len(kernel.calls),before);self.assertEqual(control.retained,[])

    def test_acknowledgement_without_native_creation_cannot_grant_close_authority(self):
        _,facts=self.fixture()
        actual,_,lease,_,request,_,kernel,config,contents,files,control=facts
        foreign=kernel.handle(kernel.node("X:\\foreign-synthetic",False,b"unowned"));attempted=[]
        with lease.borrow(request) as view:
            graph=actual.OriginalTrainingOutputGraph(view,request,config,files,control,control)
            first=files[0]["name"]
            def stream():
                handle=graph.owner.handle("model-read");graph.owned_handles.append(handle)
                with self.assertRaises(actual.LaunchUnavailable):graph.owner.acknowledge(handle,foreign)
                attempted.append(True)
                yield contents[first]
            with self.assertRaises(actual.LaunchUnavailable):
                graph.prepare({name:stream() if name==first else (raw,) for name,raw in contents.items()})
            self.assertEqual(attempted,[True]);before=len(kernel.calls)
            self.assertFalse(graph.retire_copy_io());self.assertEqual(len(kernel.calls),before)
            self.assertFalse(kernel.handles[foreign]["closed"]);self.assertEqual(control.retained,[])

    def test_original_slot_return_is_retained_before_error_observer_changes_it(self):
        _,facts=self.fixture()
        actual,_,lease,_,request,_,kernel,config,contents,files,control=facts
        foreign=kernel.handle(kernel.node("X:\\other-synthetic",False,b"unowned"))
        changed=[]
        def observer(name):
            if name=="NtCreateFile" and not changed:
                slot=kernel.calls[-1][1][0]._obj
                changed.append(slot.value);slot.value=foreign
        with lease.borrow(request) as view:
            graph=actual.OriginalTrainingOutputGraph(view,request,config,files,control,control)
            kernel.after=observer
            with self.assertRaises(actual.LaunchUnavailable):graph.prepare({name:(raw,) for name,raw in contents.items()})
            self.assertEqual(len(changed),1);self.assertNotEqual(changed[0],foreign)
            self.assertTrue(graph.owner.unknown);self.assertTrue(graph.owner.pending)
            call=graph.owner.pending[-1];self.assertEqual(call["output_creation"]["number"],changed[0])
            self.assertIs(call["output_creation"]["returned"],True)
            before=len(kernel.calls);self.assertFalse(graph.retire_copy_io())
            self.assertEqual(len(kernel.calls),before);self.assertFalse(kernel.handles[foreign]["closed"])

    def test_real_native_invoke_captures_output_before_error_reader(self):
        actual=fixtures.n;slot=actual.P();created={"slot":slot,"returned":False,"number":None,"native_value":None}
        record={"output_creation":created};calls=[]
        native=actual.WindowsKernel.__new__(actual.WindowsKernel)
        def create():slot.value=4321;return 1
        def error():
            self.assertEqual(created["number"],4321);self.assertEqual(created["native_value"],1)
            self.assertTrue(created["returned"]);calls.append(True);slot.value=9876
            return 0
        native.functions={"OpenProcessToken":create};native.error=error
        self.assertEqual(native.invoke("OpenProcessToken",(),record),(1,0))
        self.assertEqual(calls,[True]);self.assertEqual(created["number"],4321)

    def test_original_native_dispatch_cannot_read_after_permanent_retirement(self):
        case,facts=self.fixture()
        actual,_,lease,_,request,_,kernel,config,contents,files,control=facts
        with lease.borrow(request) as view:
            graph=case.graph(actual,view,request,config,files,control,contents)
            self.assertTrue(graph.retire_copy_io());before=len(kernel.calls)
            with self.assertRaises(actual.LaunchUnavailable):actual.OriginalWorker.call(graph.owner,"ReadFile")
            self.assertEqual(len(kernel.calls),before)

    def test_family_accounting_methods_are_original_before_and_after_callbacks(self):
        for kind in ("positive","prior-retain","resource","retain","late-resource","late-retain"):
            with self.subTest(kind=kind):
                _,facts=self.fixture()
                actual,_,lease,_,request,_,kernel,config,contents,files,_=facts
                holder={};substituted=[]
                class Resource(fixtures.Control):
                    attack=False
                    def assert_current(inner):
                        if inner.attack and kind=="late-resource":holder["controls"].retain=lambda _:substituted.append(True) or True
                        return inner.current
                    def retain_source_copy(inner,amount):
                        inner.retained.append(amount)
                        if inner.attack and kind=="late-retain":holder["controls"].resource=lambda:substituted.append(True) or True
                        return True
                resource=Resource();business=fixtures.Control()
                with lease.borrow(request) as view:
                    family=actual.OriginalTrainingOutputFamily(view,request,
                        {"maximumCopyBytes":config["maximumCopyBytes"],"outputs":[config]},resource,business)
                    graph=actual.OriginalTrainingOutputGraph(view,request,config,files,resource,business,_family=family)
                    graph.prepare({name:(raw,) for name,raw in contents.items()})
                    holder["controls"]=graph.reservation
                    if kind=="prior-retain":self.assertTrue(graph.retain(config["maximumCopyBytes"]))
                business.current=False;resource.attack=True
                if kind in ("resource","retain"):setattr(graph.reservation,kind,lambda *_:substituted.append(True) or True)
                before=len(kernel.calls)
                success=kind in ("positive","prior-retain")
                self.assertEqual(graph.retire_copy_io(),success)
                after=len(kernel.calls);self.assertEqual(substituted,[])
                self.assertEqual(resource.retained,[config["maximumCopyBytes"]] if kind in ("positive","prior-retain","late-retain") else [])
                if kind in ("resource","retain"):self.assertEqual(after,before)
                self.assertEqual(graph.retire_copy_io(),success);self.assertEqual(len(kernel.calls),after)

    def test_family_metadata_denies_virtual_flags_and_changed_capacity_before_closing(self):
        for kind in ("charge_attempted","charged","retain_attempted","retained","maximum","capacity"):
            with self.subTest(kind=kind):
                _,facts=self.fixture()
                actual,_,lease,_,request,_,kernel,config,contents,files,resource=facts
                called=[]
                class Virtual:
                    def __bool__(self):called.append("bool");return False
                    def __eq__(self,other):called.append("equal");return True
                with lease.borrow(request) as view:
                    family=actual.OriginalTrainingOutputFamily(view,request,
                        {"maximumCopyBytes":config["maximumCopyBytes"],"outputs":[config]},resource,resource)
                    graph=actual.OriginalTrainingOutputGraph(view,request,config,files,resource,resource,_family=family)
                    graph.prepare({name:(raw,) for name,raw in contents.items()})
                    member=actual._training_output_families[family]["members"][0]
                    if kind in ("maximum","capacity"):member["configuration"]["maximumCopyBytes"]=Virtual() if kind=="maximum" else 1
                    else:member[kind]=Virtual()
                    before=len(kernel.calls)
                    self.assertFalse(graph.retire_copy_io());self.assertEqual(called,[])
                    self.assertEqual(len(kernel.calls),before);self.assertEqual(resource.retained,[])

    def test_family_metadata_changed_in_last_accounting_callback_never_invokes_hooks(self):
        for stage in ("resource","retain"):
            with self.subTest(stage=stage):
                _,facts=self.fixture()
                actual,_,lease,_,request,_,kernel,config,contents,files,_=facts
                called=[];holder={}
                class Virtual:
                    def __bool__(self):called.append(True);return True
                    def __eq__(self,other):called.append(True);return True
                class Resource(fixtures.Control):
                    attack=False
                    def assert_current(inner):
                        if inner.attack and stage=="resource":holder["member"]["retain_attempted"]=Virtual()
                        return True
                    def retain_source_copy(inner,amount):
                        inner.retained.append(amount)
                        if inner.attack and stage=="retain":holder["member"]["configuration"]["maximumCopyBytes"]=Virtual()
                        return True
                resource=Resource()
                with lease.borrow(request) as view:
                    family=actual.OriginalTrainingOutputFamily(view,request,
                        {"maximumCopyBytes":config["maximumCopyBytes"],"outputs":[config]},resource,resource)
                    graph=actual.OriginalTrainingOutputGraph(view,request,config,files,resource,resource,_family=family)
                    graph.prepare({name:(raw,) for name,raw in contents.items()})
                    holder["member"]=actual._training_output_families[family]["members"][0]
                    resource.attack=True
                    self.assertFalse(graph.retire_copy_io());self.assertEqual(called,[])
                    self.assertEqual(resource.retained,[] if stage=="resource" else [config["maximumCopyBytes"]])
                    before=len(kernel.calls);self.assertFalse(graph.retire_copy_io());self.assertEqual(len(kernel.calls),before)

    def test_virtual_owner_and_handle_access_is_not_invoked_by_passive_retirement(self):
        for kind in ("owner-field","owner-access","handle-field","handle-write"):
            with self.subTest(kind=kind):
                case,facts=self.fixture()
                actual,_,lease,_,request,_,kernel,config,contents,files,control=facts
                with lease.borrow(request) as view:
                    graph=case.graph(actual,view,request,config,files,control,contents);before=len(kernel.calls)
                    called=[]
                    def observer(*args):called.append(True);raise AssertionError("Virtual access ran")
                    cls=actual.InheritedModelNativeCalls if kind.startswith("owner") else actual.Handle
                    name={"owner-field":"invoke","owner-access":"__getattribute__",
                        "handle-field":"known","handle-write":"__setattr__"}[kind]
                    value=property(observer) if kind.endswith("field") else observer
                    with patch.object(cls,name,value,create=True):self.assertFalse(graph.retire_copy_io())
                    self.assertEqual(called,[]);self.assertEqual(len(kernel.calls),before)
                    self.assertEqual(control.retained,[]);self.assertFalse(graph.retire_copy_io())

    def test_known_partial_preparation_can_retire_but_uncertain_charge_cannot(self):
        for phase in ("unprepared","known-failure","lost-charge"):
            with self.subTest(phase=phase):
                _,facts=self.fixture()
                actual,_,lease,_,request,_,kernel,config,contents,files,control=facts
                if phase=="lost-charge":
                    def charge(amount):control.charges.append(amount);raise RuntimeError("Synthetic lost charge")
                    control.charge_source_copy=charge
                with lease.borrow(request) as view:
                    graph=actual.OriginalTrainingOutputGraph(view,request,config,files,control,control)
                    if phase!="unprepared":
                        if phase=="known-failure":contents[files[-1]["name"]]=b"short"
                        with self.assertRaises(actual.LaunchUnavailable):graph.prepare({name:(raw,) for name,raw in contents.items()})
                    before=len(kernel.calls)
                    if phase=="lost-charge":
                        self.assertFalse(graph.retire_copy_io());self.assertEqual(len(kernel.calls),before)
                        self.assertEqual(control.retained,[])
                    else:
                        self.assertTrue(graph.retire_copy_io())
                        self.assertTrue(all(h.closed for h in graph.owned_handles))
                        self.assertEqual(control.retained,[] if phase=="unprepared" else [config["maximumCopyBytes"]])

    def test_close_failure_and_lost_ack_preserve_original_custody_and_never_retry(self):
        for failure in ("known-failure","lost-ack","late-mutation"):
            with self.subTest(failure=failure):
                case,facts=self.fixture()
                actual,_,lease,_,request,_,kernel,config,contents,files,control=facts
                with lease.borrow(request) as view:
                    graph=case.graph(actual,view,request,config,files,control,contents)
                    held=tuple(h for h in graph.owned_handles if not h.closed)
                    if failure=="known-failure":kernel.fail="CloseHandle"
                    elif failure=="lost-ack":kernel.error_after_return="CloseHandle"
                    else:kernel.after=lambda name:setattr(graph,"reservation",object()) if name=="CloseHandle" else None
                    before=len(kernel.calls)
                    self.assertFalse(graph.retire_copy_io());after=len(kernel.calls)
                    self.assertEqual(after,before+1);self.assertFalse(graph.retire_copy_io())
                    self.assertEqual(len(kernel.calls),after);self.assertEqual(control.retained,[])
                    self.assertIs(actual._training_output_readers[graph]["owner"],graph.owner)
                    self.assertTrue(any(not h.closed for h in held));self.assertFalse(graph.retired)
                    if failure!="late-mutation":
                        self.assertTrue(graph.owner.unknown);self.assertTrue(graph.owner.pending)
                        self.assertEqual(graph.owner.pending[-1]["name"],"CloseHandle")
                        self.assertTrue(graph.owner.pending[-1]["keep"])

    def test_retained_charge_failure_late_mutation_and_reentry_never_retry(self):
        for failure in ("false","raise","mutate","reenter"):
            with self.subTest(failure=failure):
                _,facts=self.fixture()
                actual,_,lease,_,request,_,kernel,config,contents,files,control=facts
                graphs=[];reentered=[]
                def retain(amount):
                    control.retained.append(amount)
                    if failure=="false":return False
                    if failure=="raise":raise RuntimeError("Synthetic lost retain acknowledgement")
                    if failure=="mutate":graphs[0].owned_handles=[]
                    if failure=="reenter":reentered.append(graphs[0].retire_copy_io())
                    return True
                control.retain_source_copy=retain
                with lease.borrow(request) as view:
                    graph=actual.OriginalTrainingOutputGraph(view,request,config,files,control,control);graphs.append(graph)
                    graph.prepare({name:(raw,) for name,raw in contents.items()})
                    handles=tuple(graph.owned_handles)
                    self.assertFalse(graph.retire_copy_io());before=len(kernel.calls)
                    self.assertFalse(graph.retire_copy_io());self.assertEqual(len(kernel.calls),before)
                    self.assertEqual(control.retained,[config["maximumCopyBytes"]])
                    self.assertTrue(all(h.closed for h in handles));self.assertFalse(graph.retired)
                    self.assertEqual(reentered,[False] if failure=="reenter" else [])


if __name__ == "__main__":unittest.main()
