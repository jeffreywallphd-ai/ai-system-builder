"""Private Native session machinery shared by exact runtime actors.

ABI declarations perform no Native calls. A structure or this module alone
grants no process, Job, source, callback or retirement authority.
"""
import ctypes as C
import hashlib
from pathlib import Path, PureWindowsPath
import subprocess

from .local_model_offload import OffloadAdmissionError

_PTR, _U32, _I32 = C.c_void_p, C.c_uint32, C.c_int32


def _need(value):
    if not value:
        raise OffloadAdmissionError()


class _BasicLimits(C.Structure):
    _fields_ = [('process_time', C.c_int64), ('job_time', C.c_int64), ('flags', _U32),
                ('minimum_working_set', C.c_size_t), ('maximum_working_set', C.c_size_t),
                ('active_process_limit', _U32), ('affinity', C.c_size_t), ('priority', _U32), ('scheduling', _U32)]
class _IoCounters(C.Structure):
    _fields_ = [(n, C.c_uint64) for n in ('read_ops','write_ops','other_ops','read_bytes','write_bytes','other_bytes')]
class _ExtendedLimits(C.Structure):
    _fields_ = [('basic', _BasicLimits), ('io', _IoCounters), ('process_memory_limit', C.c_size_t),
                ('job_memory_limit', C.c_size_t), ('peak_process_memory', C.c_size_t), ('peak_job_memory', C.c_size_t)]
class _Security(C.Structure):
    _fields_ = [('length', _U32), ('descriptor', _PTR), ('inherit', _I32)]
class _Startup(C.Structure):
    _fields_ = [('cb', _U32), ('reserved', C.c_wchar_p), ('desktop', C.c_wchar_p), ('title', C.c_wchar_p),
                *[(n, _U32) for n in ('x','y','width','height','chars_x','chars_y','fill','flags')],
                ('show', C.c_uint16), ('reserved_size', C.c_uint16), ('reserved_bytes', _PTR),
                ('stdin', _PTR), ('stdout', _PTR), ('stderr', _PTR)]
class _StartupEx(C.Structure):
    _fields_ = [('startup', _Startup), ('attributes', _PTR)]
class _Process(C.Structure):
    _fields_ = [('process', _PTR), ('thread', _PTR), ('pid', _U32), ('tid', _U32)]
class _Accounting(C.Structure):
    _fields_ = [(n, C.c_int64) for n in ('user','kernel','period_user','period_kernel')] + [
        (n, _U32) for n in ('faults','total','active','terminated')]


class _NativePrimitives:
    """Concrete handle operations; a closed actor must supply origin and calls.

    The default base denies before any operation. Consumers keep their exact
    Native/owner/type guards and their one original ledger and call path.
    """
    _handle_type = None

    def origin(self):
        raise OffloadAdmissionError()

    def acquire(self, name, function, *args, keep=()):
        self.origin()
        owner=self.owner;h=self._handle_type(owner,name);owner.handles.append(h)
        value=self.call(function,*args,valid=lambda v:type(v) is int and 0<v<C.c_void_p(-1).value,keep=(h,*keep))
        h.slot.value=value
        h.acknowledge()
        _need(all(old is h or old.closed or old.slot.value!=value for old in owner.handles))
        return h

    def close(self,h):
        self.origin()
        _need(type(h) is self._handle_type and h.owner is self.owner and not h.close_started and not h.closed)
        value=h.value;h.close_started=True
        row=self._call_row(self.k.CloseHandle,value,keep=(h,h.slot),terminal=True)
        self._perform(row)
        h.close_record=row;h.closed=True

    def wait(self, handles, deadline):
        self.origin()
        _need(type(handles) is tuple and 1<=len(handles)<=3 and len({id(h) for h in handles})==len(handles))
        for h in handles:_need(type(h) is self._handle_type and h.owner is self.owner and not h.closed and not h.close_started)
        values=(_PTR*len(handles))(*(h.value for h in handles));self.owner.buffers.append(values)
        value=self.call(self.k.WaitForMultipleObjects,len(handles),values,0,0,
                        valid=lambda v:type(v) is int and (0<=v<len(handles) or v==258),keep=(handles,values),
                        terminal=True,_wait_deadline=deadline)
        return value


class _SessionMechanics:
    """Concrete launch/Job/channel steps, consumed only by closed runtime actors.

The base denies. A concrete consumer retains its exact actor and Native guards.
The contract comes from that consumer, never from a wire message or caller input.
"""

    def origin(self):
        raise OffloadAdmissionError()

    def _session_contract(self):
        raise OffloadAdmissionError()

    def _channel(self, name):
        self.origin()
        self.api.origin()
        contract = self._session_contract()
        a = self.api
        security = _Security(C.sizeof(_Security), None, 1)
        read = a._handle_type(self, name + '-read')
        write = a._handle_type(self, name + '-write')
        self.handles.extend((read, write))
        self.buffers.append(security)
        a.call(a.k.CreatePipe, C.byref(read.slot), C.byref(write.slot), C.byref(security), 16384, keep=(read, write, security))
        read.acknowledge()
        write.acknowledge()
        _need(read.value != write.value)
        self.channels[name + '-read'] = read
        self.channels[name + '-write'] = write

    def _flags(self, h, inherit):
        self.origin()
        self.api.origin()
        contract = self._session_contract()
        a = self.api
        value = _U32()
        self.buffers.append(value)
        a.call(a.k.SetHandleInformation, h.value, 1, int(inherit), keep=(h,))
        a.call(a.k.GetHandleInformation, h.value, C.byref(value), keep=(h, value))
        _need(value.value & 1 == int(inherit))

    def _job_readback(self):
        self.origin()
        self.api.origin()
        contract = self._session_contract()
        a = self.api
        inside = _I32()
        limits = _ExtendedLimits()
        self.buffers.extend((inside, limits))
        a.call(a.k.IsProcessInJob, self.process.value, self.job.value, C.byref(inside), keep=(self.process, self.job, inside))
        _need(inside.value == 1)
        a.call(a.k.QueryInformationJobObject, self.job.value, 9, C.byref(limits), C.sizeof(limits), None, keep=(self.job, limits))
        _need(limits.basic.flags == 8968 and limits.basic.active_process_limit == 1 and (limits.process_memory_limit == limits.job_memory_limit == contract.memory_bytes))
        _need(a.call(a.k.GetProcessId, self.process.value, keep=(self.process,)) == self.process_info.pid)
        text = C.create_unicode_buffer(32768)
        length = _U32(len(text))
        self.buffers.extend((text, length))
        a.call(a.k.QueryFullProcessImageNameW, self.process.value, 0, text, C.byref(length), keep=(self.process, text, length))
        _need(0 < length.value < len(text) and length.value == len(text.value) and (contract.root(text.value).casefold() == str(self.runtime).casefold()) and (hashlib.sha256(contract.read_source(self.runtime, 64 * 1024 ** 2)).hexdigest() == self.runtime_hash))

    def _launch(self, request):
        self.origin()
        self.api.origin()
        contract = self._session_contract()
        self._live(request)
        a = self.api
        self.source_values, self.source_hashes, self.source_digest = contract.sources()
        self.runtime, self.runtime_hash = contract.runtime_image()
        self.buffers.extend((self.source_values, self.source_hashes, self.runtime))
        self._live(request)
        self._channel('request')
        self._channel('response')
        self.channels['ready'] = a.acquire('child-ready', a.k.CreateEventW, None, 1, 0, None)
        self.channels['dispatch'] = a.acquire('child-dispatch', a.k.CreateEventW, None, 1, 0, None)
        inherited = tuple((self.channels[n] for n in ('request-read', 'response-write', 'ready', 'dispatch')))
        for name, h in self.channels.items():
            self._live(request)
            self._flags(h, any((v is h for v in inherited)))
            if name not in ('ready', 'dispatch'):
                _need(a.call(a.k.GetFileType, h.value, keep=(h,)) == 3)
        self.job = a.acquire('io-job', a.k.CreateJobObjectW, None, None)
        limits = _ExtendedLimits()
        limits.basic.flags = 8968
        limits.basic.active_process_limit = 1
        limits.process_memory_limit = limits.job_memory_limit = contract.memory_bytes
        self.buffers.append(limits)
        a.call(a.k.SetInformationJobObject, self.job.value, 9, C.byref(limits), C.sizeof(limits), keep=(self.job, limits))
        size = C.c_size_t()
        self.buffers.append(size)
        a.call(a.k.InitializeProcThreadAttributeList, None, 2, 0, C.byref(size), valid=lambda n: n == 0 and C.get_last_error() == 122, keep=(size,))
        _need(0 < size.value <= 65536)
        self.attributes = C.create_string_buffer(size.value)
        self.buffers.append(self.attributes)
        a.call(a.k.InitializeProcThreadAttributeList, self.attributes, 2, 0, C.byref(size), keep=(self.attributes, size))
        self.attribute_started = True
        jobs = (_PTR * 1)(self.job.value)
        handles = (_PTR * 4)(*(h.value for h in inherited))
        self.buffers.extend((jobs, handles))
        a.call(a.k.UpdateProcThreadAttribute, self.attributes, 0, 131085, jobs, C.sizeof(jobs), None, None, keep=(self.attributes, jobs, self.job))
        a.call(a.k.UpdateProcThreadAttribute, self.attributes, 0, 131074, handles, C.sizeof(handles), None, None, keep=(self.attributes, handles, inherited))
        bootstrap = contract.bootstrap(Path(__file__).absolute().parent, self.source_hashes, self.nonce, tuple((h.value for h in inherited)), request.deadline, (str(self.runtime), self.runtime_hash))
        arguments = [str(self.runtime), '-I', '-S', '-B', '-c', bootstrap]
        command = C.create_unicode_buffer(subprocess.list2cmdline(arguments))
        windows = a.location(a.k.GetWindowsDirectoryW)
        env = {'SystemRoot': windows, 'WINDIR': windows, 'PATH': str(PureWindowsPath(windows) / 'System32') + ';' + windows}
        environment = C.create_unicode_buffer('\x00'.join((k + '=' + v for k, v in sorted(env.items()))) + '\x00\x00')
        startup = _StartupEx()
        startup.startup.cb = C.sizeof(startup)
        startup.attributes = C.cast(self.attributes, _PTR)
        self.buffers.extend((arguments, bootstrap, command, environment, startup, self.process_info))
        self.process = a._handle_type(self, 'io-process')
        self.primary_thread = a._handle_type(self, 'io-main-thread')
        self.handles.extend((self.process, self.primary_thread))
        self._native_intent(request, a.k.CreateProcessW, str(self.runtime), command, None, None, 1, 524288 | 4 | 1024 | 8, environment, str(Path(__file__).absolute().parent), C.byref(startup), C.byref(self.process_info), keep=(self.runtime, command, environment, startup, self.process_info, self.process, self.primary_thread))
        self.process.slot.value = self.process_info.process
        self.primary_thread.slot.value = self.process_info.thread
        self.process.acknowledge()
        self.primary_thread.acknowledge()
        _need(self.process.value != self.primary_thread.value)
        self._live(request)
        self._job_readback()
        a.call(a.k.DeleteProcThreadAttributeList, self.attributes, valid=lambda n: n is None, keep=(self.attributes, jobs, handles))
        self.attribute_retired = True
        for name in ('request-read', 'response-write'):
            a.close(self.channels[name])
        self._native_intent(request, a.k.ResumeThread, self.primary_thread.value, valid=lambda n: type(n) is int and n == 1, keep=(self.primary_thread,))
        _need(a.wait((self.channels['ready'],), request.deadline) == 0)
        self._live(request)
        self._job_readback()
        self._native_intent(request, a.k.SetEvent, self.channels['dispatch'].value, keep=(self.channels['dispatch'],))
        self._live(request)
        self.launch_complete = True
