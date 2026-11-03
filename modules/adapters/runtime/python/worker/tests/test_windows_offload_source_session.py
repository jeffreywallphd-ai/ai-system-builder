"""Source-only wire regressions. No Native, model or filesystem authority."""
import json
import ctypes as C
import struct
from types import SimpleNamespace
from pathlib import Path
from threading import Event, Thread, get_ident
import tempfile
import time
import unittest
from unittest.mock import patch

from modules.adapters.runtime.python.worker.tasks import windows_offload_execution as io
from modules.adapters.runtime.python.worker.tasks import windows_offload_native_session as native
from modules.adapters.runtime.python.worker.tasks import windows_offload_source_session as source
from modules.adapters.runtime.python.worker.tasks.local_model_offload import OffloadAdmissionError


class ReadyPublicationTests(unittest.TestCase):
    def test_paused_writer_does_not_publish_empty_or_partial_ready_file(self):
        with tempfile.TemporaryDirectory(prefix='source-ready-')as area:
            root=Path(area);created,release=Event(),Event();failures=[];raw=b'{"ready":true}'
            original=Path.open
            class Paused:
                def __enter__(self):return self
                def __exit__(self,*args):self.stream.close()
                def write(self,value):
                    created.set()
                    if not release.wait(2):raise AssertionError('Synthetic writer not released')
                    return self.stream.write(value)
                def flush(self):return self.stream.flush()
            def open_file(path,*args,**kwargs):
                stream=original(path,*args,**kwargs)
                if path.name=='ready.pending':
                    paused=Paused();paused.stream=stream;return paused
                return stream
            def publish():
                try:source._publish_ready(root,raw)
                except BaseException as error:failures.append(type(error).__name__)
            with patch.object(Path,'open',open_file):
                thread=Thread(target=publish);thread.start()
                try:
                    self.assertTrue(created.wait(1));self.assertTrue((root/'ready.pending').exists())
                    self.assertFalse((root/'ready.json').exists())
                finally:release.set();thread.join(3)
            self.assertFalse(thread.is_alive());self.assertEqual(failures,[])
            self.assertEqual((root/'ready.json').read_bytes(),raw)
            self.assertFalse((root/'ready.pending').exists())

    def test_existing_ready_or_pending_record_is_never_overwritten(self):
        for name in ('ready.json','ready.pending'):
            with self.subTest(name=name),tempfile.TemporaryDirectory(prefix='source-ready-')as area:
                root=Path(area);(root/name).write_bytes(b'original')
                with self.assertRaises((OffloadAdmissionError,FileExistsError)):
                    source._publish_ready(root,b'{"ready":true}')
                self.assertEqual((root/name).read_bytes(),b'original')


class ParentJourneyTests(unittest.TestCase):
    """Actual parent sequencing and framing with a synthetic transport peer."""
    def setUp(self):
        entry=object.__new__(source._OriginalSourceEntry)
        entry.role=source._PARENT_ROLE;entry.nonce='a'*32;entry.digest='b'*64
        entry.deadline=time.monotonic_ns()+120*10**9;entry.run_root=Path('C:/synthetic/source-session')
        parent=object.__new__(source._OriginalSourceParent)
        for scope in (patch.object(source,'_ENTRY_CONTEXT',entry),patch.object(source,'_PARENT',parent),
                      patch.object(source._OriginalSourceEntry,'assert_original',lambda entry:None)):
            scope.start();self.addCleanup(scope.stop)
        source._OriginalSourceParent.__init__(parent,entry)
        self.parent=parent;self.events=[];self.pending=bytearray();self.corrupt_reply=False
        self.fail_finish=False
        outer=self
        timer=SimpleNamespace(phase='pending')
        def retire_timer():outer.events.append('timer-retired');timer.phase='retired'
        timer.retire=retire_timer;self.api=SimpleNamespace(timer=timer)
        def construct(owner):self.assertIs(owner,parent);owner.api=self.api;self.events.append('native-created')
        def launch(owner,request):
            self.events.append('child-launched');owner.source_digest=entry.digest
            owner.channels.update({'request-write':object(),'response-read':object()})
        def write(owner,handle,raw):
            self.assertIs(handle,owner.channels['request-write'])
            size=struct.unpack('<I',raw[:4])[0];self.assertEqual(size,len(raw)-4)
            value=source._message(source._decode(raw[4:]),entry.nonce,entry.digest,entry.deadline)
            self.events.append(value['op'])
            reply={**value,'body':{'state':source._STATES[value['seq']]}}
            if self.corrupt_reply:reply['deadline_ns']+=1
            self.pending.extend(source._frame(reply))
        def read(owner,handle,size):
            self.assertIs(handle,owner.channels['response-read']);self.assertGreaterEqual(len(self.pending),size)
            value=bytes(self.pending[:size]);del self.pending[:size];return value
        def retire_child(owner):
            self.events.append('actual-child-exit-and-job-zero')
            if self.fail_finish:raise OffloadAdmissionError()
        for scope in (patch.object(source,'_SourceNative',construct),
                      patch.object(source._OriginalSourceParent,'_launch',launch),
                      patch.object(source._OriginalSourceParent,'_close_outer_dispatch',lambda owner:None),
                      patch.object(source._OriginalSourceParent,'_write_bytes',write),
                      patch.object(source._OriginalSourceParent,'_read_bytes',read),
                      patch.object(source._OriginalSourceParent,'_retire_child',retire_child)):
            scope.start();self.addCleanup(scope.stop)

    def test_complete_sequence_uses_one_deadline_then_child_exit_before_timer_retirement(self):
        parent=self.parent;deadline=parent.deadline
        for action in (parent.prepare,parent.check,parent.retire_unused,parent.finish):
            self.assertIsNone(action());self.assertEqual(parent.deadline,deadline)
        self.assertTrue(parent.retired);self.assertEqual(parent.state,'source-finished')
        self.assertEqual(self.events,['native-created','child-launched',*source._OPERATIONS.values(),
                                     'actual-child-exit-and-job-zero','timer-retired'])
        self.assertEqual(len(parent.requests),4);self.assertEqual(self.pending,b'')
        with self.assertRaises(OffloadAdmissionError):parent.prepare()

    def test_out_of_order_or_replayed_operation_cannot_launch_again(self):
        with self.assertRaises(OffloadAdmissionError):self.parent.check()
        self.assertEqual(self.events,[])
        self.parent.prepare();events=list(self.events)
        with self.assertRaises(OffloadAdmissionError):self.parent.prepare()
        self.assertEqual(self.events,events)

    def test_wrong_reply_fences_the_session_without_retirement(self):
        self.corrupt_reply=True
        with self.assertRaises(OffloadAdmissionError):self.parent.prepare()
        self.assertTrue(self.parent.failed);self.assertFalse(self.parent.retired)
        with self.assertRaises(OffloadAdmissionError):self.parent.check()
        self.assertNotIn('timer-retired',self.events)

    def test_unconfirmed_child_exit_cannot_retire_parent_timer_or_grant_completion(self):
        self.parent.prepare();self.parent.check();self.parent.retire_unused();self.fail_finish=True
        with self.assertRaises(OffloadAdmissionError):self.parent.finish()
        self.assertTrue(self.parent.failed);self.assertFalse(self.parent.retired)
        self.assertEqual(self.api.timer.phase,'pending');self.assertNotIn('timer-retired',self.events)

    def test_expired_original_deadline_prevents_first_native_acquisition(self):
        clock=SimpleNamespace(monotonic_ns=lambda:self.parent.deadline+1)
        with patch.object(source,'time',clock),self.assertRaises(OffloadAdmissionError):self.parent.prepare()
        self.assertEqual(self.events,[]);self.assertIsNone(self.parent.api)


class SourceProtocolTests(unittest.TestCase):
    nonce = 'a' * 32
    digest = 'b' * 64
    deadline = 123456789

    def request(self, sequence=0):
        return {'v': 2, 'nonce': self.nonce, 'seq': sequence,
                'op': source._OPERATIONS[sequence],
                'body': {'model_root': 'C:\\models\\fixed'} if sequence == 0 else {},
                'source_digest': self.digest, 'deadline_ns': self.deadline}

    def admit(self, value, **kwargs):
        return source._message(value, self.nonce, self.digest, self.deadline, **kwargs)

    def test_fixed_sequence_frames_and_original_message_identity(self):
        state = 'new'
        for sequence in range(4):
            value = self.request(sequence)
            self.assertIs(self.admit(value), value)
            framed = source._frame(value)
            self.assertEqual(struct.unpack('<I', framed[:4])[0], len(framed) - 4)
            self.assertEqual(self.admit(source._decode(framed[4:])), value)
            state = source._edge(state, sequence)
            reply = {**value, 'body': {'state': state}}
            self.assertIs(self.admit(reply, response=True), reply)
        self.assertEqual(state, 'source-finished')

    def test_common_mechanisms_alone_deny_before_any_effect(self):
        effects=[];api=native._NativePrimitives();session=native._SessionMechanics()
        actions=(lambda:api.acquire('unused',lambda:effects.append('called')),
                 lambda:api.close(object()),lambda:api.wait((),1),
                 lambda:session._channel('unused'),lambda:session._flags(None,True),
                 lambda:session._job_readback(),lambda:session._launch(None))
        for index,action in enumerate(actions):
            with self.subTest(index=index),self.assertRaises(OffloadAdmissionError):action()
        self.assertEqual(effects,[])

    def test_io_and_source_protocols_cannot_select_each_others_operations(self):
        for sequence in range(4):
            with self.subTest(sequence=sequence):
                with self.assertRaises(OffloadAdmissionError):
                    io._message(self.request(sequence), self.nonce, self.digest)
                legacy = {'v': 1, 'nonce': self.nonce, 'seq': sequence,
                          'op': io._OPERATIONS[sequence],
                          'body': {'cache_root': 'C:\\models\\fixed'} if sequence == 0 else {},
                          'source_digest': self.digest, 'deadline_ns': self.deadline}
                self.assertIs(io._message(legacy, self.nonce, self.digest), legacy)
                with self.assertRaises(OffloadAdmissionError):self.admit(legacy)

    def test_frozen_facts_refuse_renewed_deadline_boolean_and_unknown_fields(self):
        bad = {'v': [1, True, '2'], 'nonce': ['c' * 32, None],
               'seq': [True, -1, 4, '0'], 'op': ['initialize', 'finish-source'],
               'source_digest': ['c' * 64, None],
               'deadline_ns': [True, 0, self.deadline - 1, self.deadline + 1],
               'body': [None, [], {}, {'model_root': 'C:\\models\\fixed', 'callback': 'x'}]}
        for name, values in bad.items():
            for replacement in values:
                with self.subTest(field=name, kind=type(replacement).__name__):
                    value = self.request();value[name] = replacement
                    with self.assertRaises(OffloadAdmissionError):self.admit(value)
        for name in self.request():
            value = self.request();value.pop(name)
            with self.subTest(missing=name), self.assertRaises(OffloadAdmissionError):self.admit(value)
        value = self.request();value['callback'] = 'untrusted'
        with self.assertRaises(OffloadAdmissionError):self.admit(value)

    def test_model_root_is_canonical_bounded_and_contains_no_device_components(self):
        for root in ('relative', 'C:/models/fixed', 'C:\\models\\..\\fixed',
                     '\\\\server\\share\\model', '\\\\?\\C:\\models',
                     'C:\\models\\CON', 'C:\\models\\nul.json', 'C:\\models\\aUx.bin',
                     'C:\\models\\COM9', 'C:\\models\\LPT1.log', 'C:\\models\\NUL .txt',
                     'C:\\models\\COM\u00b9', 'C:\\models\\bad.', 'C:\\models\\bad ',
                     'C:\\models\\a:b', 'C:\\models\\a\x00b', 'C:\\' + 'x' * 2050,
                     None, True):
            value = self.request();value['body']['model_root'] = root
            with self.subTest(kind=type(root).__name__), self.assertRaises(OffloadAdmissionError):
                self.admit(value)

    def test_later_operations_accept_no_root_replacement_or_serialized_authority(self):
        for sequence in (1, 2, 3):
            for body in ({'model_root': 'C:\\other'}, {'retirement_proof': True},
                         {'reservation': 'copied'}, {'native_handle': 23}):
                value = self.request(sequence);value['body'] = body
                with self.subTest(sequence=sequence, keys=tuple(body)), self.assertRaises(OffloadAdmissionError):
                    self.admit(value)

    def test_reply_fields_are_exact_and_failure_never_advances_the_state_machine(self):
        value = self.request()
        for retired in (False, True):
            failure = {**value, 'body': {'error': 'source-session-unavailable', 'source_retired': retired}}
            self.assertIs(self.admit(failure, response=True), failure)
            with self.assertRaises(OffloadAdmissionError):source._edge('new', 1)
        for body in ({'state': 'source-retired'}, {'state': 'source-prepared', 'proof': True},
                     {'error': 'private-path', 'source_retired': False},
                     {'error': 'source-session-unavailable', 'source_retired': 1}, {}):
            with self.subTest(keys=tuple(body)), self.assertRaises(OffloadAdmissionError):
                self.admit({**value, 'body': body}, response=True)

    def test_no_skipped_repeated_boolean_or_after_finish_transition(self):
        states = ('new', *source._STATES.values(), None)
        valid = {('new', 0), ('source-prepared', 1), ('source-checked', 2), ('source-retired', 3)}
        for state in states:
            for sequence in (True, -1, 0, 1, 2, 3, 4):
                if type(sequence) is int and (state, sequence) in valid:continue
                with self.subTest(state=state, sequence=sequence), self.assertRaises(OffloadAdmissionError):
                    source._edge(state, sequence)

    def test_duplicate_json_nonfinite_deep_and_oversized_inputs_are_refused(self):
        good = json.dumps(self.request())
        duplicate = good[:-1] + ', "deadline_ns": 123456789}'
        for raw in (duplicate.encode(), b'{"v":NaN}', b'{"v":Infinity}',
                    b'[' + b'{}' + b']', b'x' * 4097,
                    b'{"body":{"a":{"b":{"c":{"d":0}}}}}'):
            with self.subTest(size=len(raw)), self.assertRaises(OffloadAdmissionError):
                self.admit(source._decode(raw))


class SourceFrameTests(unittest.TestCase):
    def actor(self, chunk=3, payload=b'functional-builder', count=None):
        effects=[];written=bytearray();position=0
        class Actor(source._SourceFrameIo):
            def __init__(self):self.buffers=[];self.live=True
            def _live(self):
                if not self.live:raise OffloadAdmissionError()
        actor=Actor()
        def write(handle,data,size,actual,_overlapped):
            self.assertEqual(handle,11)
            amount=min(chunk,size) if count is None else count
            actual._obj.value=amount;effects.append(('write',size))
            if 0<amount<=size:written.extend(C.string_at(data,amount))
            return 1
        def read(handle,data,size,actual,_overlapped):
            nonlocal position
            self.assertEqual(handle,11)
            amount=min(chunk,size,len(payload)-position) if count is None else count
            actual._obj.value=amount;effects.append(('read',size))
            if 0<amount<=size:
                C.memmove(data,payload[position:position+amount],amount);position+=amount
            return 1
        class Api:
            k=SimpleNamespace(WriteFile=write,ReadFile=read)
            def call(self,function,*args,keep):
                # Synthetic only: actual Native admission is not exercised.
                self_test.assertEqual(len(keep),3)
                return function(*args)
        self_test=self;actor.api=Api()
        return actor,SimpleNamespace(value=11),effects,written

    def test_base_has_no_transfer_authority(self):
        base=source._SourceFrameIo()
        for action in (lambda:base._write_bytes(None,b'a'),lambda:base._read_bytes(None,1)):
            with self.assertRaises(OffloadAdmissionError):action()

    def test_partial_transfers_preserve_exact_order_and_bytes(self):
        payload=b'functional-builder'
        actor,handle,effects,written=self.actor(payload=payload)
        self.assertIsNone(actor._write_bytes(handle,payload));self.assertEqual(bytes(written),payload)
        self.assertEqual(actor._read_bytes(handle,len(payload)),payload)
        self.assertEqual([row[1]for row in effects[:6]],[18,15,12,9,6,3])

    def test_fragmentation_cannot_make_a_thirty_third_call(self):
        for direction in ('read','write'):
            actor,handle,effects,_written=self.actor(chunk=1,payload=b'x'*33)
            with self.subTest(direction=direction),self.assertRaises(OffloadAdmissionError):
                actor._write_bytes(handle,b'x'*33) if direction=='write'else actor._read_bytes(handle,33)
            self.assertEqual(len(effects),32)
            # The original actor retains every output buffer after refusal.
            self.assertEqual(len(actor.buffers),33)

    def test_zero_overrun_and_oversized_frames_refuse_without_retry(self):
        for count in (0,5):
            for direction in ('read','write'):
                actor,handle,effects,_written=self.actor(count=count)
                with self.subTest(count=count,direction=direction),self.assertRaises(OffloadAdmissionError):
                    actor._write_bytes(handle,b'abcd') if direction=='write'else actor._read_bytes(handle,4)
                self.assertEqual(len(effects),1)
        actor,handle,effects,_written=self.actor()
        for action in (lambda:actor._write_bytes(handle,b'x'*4101),
                       lambda:actor._read_bytes(handle,4097),lambda:actor._read_bytes(handle,True)):
            with self.assertRaises(OffloadAdmissionError):action()
        self.assertEqual(effects,[])


if __name__ == '__main__':unittest.main()
