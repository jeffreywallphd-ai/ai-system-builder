"""Private original source-call rows shared by closed runtime actors.

This module invokes no Native function and imports no developer tooling. A row,
reservation or this base alone is not execution authority. Concrete consumers
must retain and validate their original process, Job, timer, thread, source,
operation and retirement graph before dispatching any stored function.
"""
import ctypes as C
import re
from threading import RLock, get_ident


_STAGES = frozenset(('source-call-custody', 'source-call-shape', 'source-dll-return', 'source-dll-shape', 'source-escape-used', 'source-invocation-ack', 'source-ledger', 'source-reservation-exhausted', 'source-reservation-membership', 'source-reservation-origin', 'source-reservation-shape', 'source-reservation-transfer', 'source-return-origin', 'source-return-payload', 'source-scalar-return', 'source-shared-capacity', 'source-slot-fenced', 'source-slot-member', 'source-slot-owner', 'source-slot-reuse'))


class SourceLedgerError(RuntimeError):
    def __init__(self, stage):
        self.stage = stage if type(stage) is str and stage in _STAGES else 'source-ledger'
        super().__init__('The original source call ledger is unavailable.')


class _SourceSlot:
    __slots__ = ('origin', 'arena', 'index', 'terminal', 'generation', 'facts',
                 'reservation', 'binding', 'completion', 'payload')
    def __init__(self, arena, index):
        self.origin, self.arena, self.index = self, arena, index
        self.terminal = index >= 16320
        self.generation = object()
        self.facts = (self, arena, index, self.terminal, self.generation)
        self.reservation = self.binding = self.completion = self.payload = None



class _SourceSlotReservation:
    """Original physical rows, not independently sufficient execution authority."""
    __slots__ = ('origin', 'arena', 'purpose', 'rows', 'original')
    def __init__(self, arena, purpose):
        self.origin, self.arena, self.purpose = self, arena, purpose
        self.rows, self.original = None, None
    def __repr__(self): return '<original source row reservation>'
    def __copy__(self): raise SourceLedgerError('source-reservation-transfer')
    def __deepcopy__(self, memo): raise SourceLedgerError('source-reservation-transfer')
    def __reduce_ex__(self, protocol): raise SourceLedgerError('source-reservation-transfer')



class _SourceRows:
    """Pure physical bookkeeping; actor validation is deliberately unavailable.

    The closed consumer supplies its original actor guards and fixed failure
    mapping. Stored native functions are data here and are never invoked.
    """
    _reservation_type = _SourceSlotReservation

    @staticmethod
    def _require(value, stage):
        if not value:
            raise SourceLedgerError(stage)

    def _fail(self, stage):
        raise SourceLedgerError(stage)

    def physical_origin_bound(self):
        raise SourceLedgerError('source-slot-owner')

    def origin_bound(self):
        raise SourceLedgerError('source-slot-owner')

    def __copy__(self): raise SourceLedgerError('source-reservation-transfer')
    def __deepcopy__(self, memo): raise SourceLedgerError('source-reservation-transfer')
    def __reduce_ex__(self, protocol): raise SourceLedgerError('source-reservation-transfer')

    def _initialize_rows(self, owner, role):
        self.origin, self.owner, self.role = self, owner, role
        self.deadline = owner.deadline_ns
        self.case = self.case_origin = getattr(owner,'source_case',None)
        self.cutoff_used = False
        self.lock = RLock()
        self.rows = tuple(_SourceSlot(self, i) for i in range(16384))
        self.bindings, self.completions, self.claims, self.payloads = ([None]*16384 for _ in range(4))
        self.reservations, self.issued = [], []
        self.order = self.order_origin = ()
        self.calls = owner.calls
        self.original = (owner, role, self.rows, self.bindings, self.completions,
                         self.claims, self.reservations, self.issued, self.calls, self.payloads)
        self.fenced = False
        self.api_bindings = self.api_origin = None
        self.ready = self.ready_origin = None


    def physical_member(self, row):
        self.physical_origin_bound()
        self._require(type(row) is _SourceSlot and row.origin is row and row.arena is self
                and type(row.index) is int and 0 <= row.index < 16384
                and self.rows[row.index] is row and type(row.facts) is tuple and len(row.facts) == 5
                and row.facts[0] is row and row.facts[1] is self and row.facts[2] == row.index
                and type(row.terminal) is bool and row.terminal is row.facts[3]
                and row.terminal is (row.index >= 16320) and row.generation is row.facts[4],
                'source-slot-member')


    def member(self, row):
        self.origin_bound()
        self.physical_member(row)


    def reserve(self, purpose, normal, terminal):
        self.origin_bound()
        self._require(type(purpose) is str and re.fullmatch('[a-z][a-z0-9-]{0,63}', purpose)
                and type(normal) is int and 0 <= normal <= 16320
                and type(terminal) is int and 0 <= terminal <= 64 and normal+terminal > 0,
                'source-reservation-shape')
        with self.lock:
            self._require(not self.fenced, 'source-slot-fenced')
            free_normal = tuple(row for row in self.rows[:16320] if self.claims[row.index] is None)
            free_terminal = tuple(row for row in self.rows[16320:] if self.claims[row.index] is None)
            self._require(normal <= len(free_normal) and terminal <= len(free_terminal), 'source-shared-capacity')
            ticket = type(self)._reservation_type(self, purpose)
            self.reservations.append(ticket)  # Original partial allocation before mutation.
            try:
                selected = free_normal[:normal]+free_terminal[:terminal]
                for row in selected:
                    self.member(row)
                    self._require(row.reservation is self.claims[row.index] is None
                            and row.binding is self.bindings[row.index] is None, 'source-slot-reuse')
                    self.claims[row.index] = ticket
                    row.reservation = ticket
                ticket.rows = selected
                ticket.original = (self,purpose,selected)
                self.assert_reserved(ticket)
                return ticket
            except BaseException:
                self.fenced = True  # No partial reservation rollback or refund.
                raise


    def assert_reserved(self, ticket):
        self.origin_bound()
        self._require(type(ticket) is type(self)._reservation_type and ticket.origin is ticket
                and ticket.arena is self and any(v is ticket for v in self.reservations)
                and type(ticket.original) is tuple and len(ticket.original) == 3
                and ticket.original[0] is self and ticket.original[1] is ticket.purpose
                and ticket.original[2] is ticket.rows and type(ticket.rows) is tuple,
                'source-reservation-origin')
        for row in ticket.rows:
            self.member(row)
            self._require(row.reservation is ticket and self.claims[row.index] is ticket,
                    'source-reservation-membership')


    def begin(self, ticket, stage, function, args, keep, *, terminal=False,
              variant='scalar', library=None, source_record=None):
        """Bind an original invocation before dispatch; this method calls no API."""
        self.assert_reserved(ticket)
        self._require(not self.fenced and type(terminal) is bool and type(args) is tuple
                and type(keep) is tuple and type(stage) is str and callable(function)
                and variant in ('scalar','system-library'), 'source-call-shape')
        if variant == 'system-library':
            self._require(function is C.WinDLL and library in ('kernel32.dll','ntdll.dll')
                    and args == (library,), 'source-dll-shape')
        else: self._require(library is None, 'source-call-shape')
        with self.lock:
            self._require(not self.fenced and self.owner.pending is None
                    and len(self.calls) == len(self.issued)
                    and all(a is b.payload for a,b in zip(self.calls,self.issued)), 'source-call-custody')
            selected = next((v for v in ticket.rows if v.terminal is terminal
                             and self.bindings[v.index] is None and v.binding is None), None)
            self._require(selected is not None, 'source-reservation-exhausted')
            binding = (ticket,stage,function,args,keep,get_ident(),variant,library,source_record)
            payload = {'stage':stage,'function':function,'args':args,'started':True,
                       'returned':False,'acknowledged':False,'result':None,'os_error':None}
            # Fixed row + independent tables retain the original payload/binding,
            # even if either variable-length observation list is cleared.
            self.bindings[selected.index] = binding
            self.payloads[selected.index] = payload
            selected.binding, selected.payload = binding, payload
            self.order = self.order_origin = self.order+(selected,)
            self.issued.append(selected)
            self.calls.append(payload)
            self.owner.pending = payload
            return selected


    def returned(self, row, value, error):
        """Known return only. Native invocation ACK is NOT IO/exit completion."""
        with self.lock:
            self.physical_member(row)
            binding = self.bindings[row.index]
            self._require(binding is row.binding and type(binding) is tuple and len(binding) == 9
                    and binding[5] == get_ident() and row.completion is self.completions[row.index] is None
                    and type(error) is int and 0 <= error <= 0xffffffff, 'source-return-origin')
            if binding[6] in ('scalar','escape'):
                self._require(type(value) in (int,type(None)), 'source-scalar-return')
            else:
                self._require(type(value) is C.WinDLL and type(value._name) is str and value._name == binding[7]
                        and type(value._handle) is int and value._handle > 0, 'source-dll-return')
            completion = (binding,value,error,get_ident())
            self.completions[row.index] = completion
            row.completion = completion
            payload=self.payloads[row.index]
            if not (type(payload) is dict and payload.get('function') is binding[2]
                    and payload.get('args') is binding[3] and payload.get('stage') == binding[1]
                    and payload.get('started') is True and payload.get('returned') is False
                    and payload.get('acknowledged') is False):
                self.fenced=self.owner.uncertain=True
                self._fail('source-return-payload')
            payload.update(result=value,os_error=error,returned=True)


    def acknowledge(self, row):
        with self.lock:
            self.member(row)
            self.owner.live()
            binding, completion = self.bindings[row.index], self.completions[row.index]
            self._require(not self.fenced and binding is row.binding and binding[6] != 'escape' and type(completion) is tuple
                    and len(completion) == 4 and completion is row.completion
                    and completion[0] is binding and completion[3] == binding[5] == get_ident()
                    and len(self.calls) == len(self.issued)
                    and all(a is b.payload for a,b in zip(self.calls,self.issued))
                    and self.owner.pending is row.payload and row.payload['result'] is completion[1]
                    and row.payload['os_error'] == completion[2] and row.payload['returned'] is True
                    and row.payload['acknowledged'] is False, 'source-invocation-ack')
            row.payload['acknowledged'] = True
            self.owner.pending = None


    def begin_escape(self, ticket, stage, function, args, keep):
        """Only an original escape owner may use this; normal pending stays held."""
        self.assert_reserved(ticket)
        with self.lock:
            selected=next((row for row in ticket.rows if row.terminal
                           and self.bindings[row.index] is row.binding is None),None)
            self._require(selected is not None,'source-escape-used')
            binding=(ticket,stage,function,args,keep,get_ident(),'escape',None,None)
            payload={'stage':stage,'function':function,'args':args,'started':True,
                     'returned':False,'acknowledged':False,'result':None,'os_error':None}
            self.bindings[selected.index]=binding
            self.payloads[selected.index]=payload
            selected.binding,selected.payload=binding,payload
            self.order=self.order_origin=self.order+(selected,)
            self.issued.append(selected);self.calls.append(payload)
            self.fenced=True
            return selected
