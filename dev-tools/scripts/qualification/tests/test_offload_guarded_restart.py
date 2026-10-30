import dataclasses
import importlib.util
import io
import json
from pathlib import Path
import sys
import unittest
from unittest.mock import patch

MODULE=Path(__file__).resolve().parents[1]/'offload_guarded_restart.py'
spec=importlib.util.spec_from_file_location('guarded_restart_test_subject',MODULE)
guard=importlib.util.module_from_spec(spec);sys.modules[spec.name]=guard;spec.loader.exec_module(guard)
A='a'*32;B='b'*32


class GuardedRestartTests(unittest.TestCase):
    def test_unknown_retained_content_charges_the_entire_existing_domain(self):
        budget=guard.RestartBudget()
        self.assertEqual(budget.charged_bytes,12*1024**3);self.assertEqual(budget.available_bytes,0)
        with self.assertRaises(guard.RestartBudgetError):budget.reserve(A,1,expected_generation=0)
        self.assertEqual(budget.reservations,())

    def test_exact_ceiling_succeeds_as_arithmetic_only_and_one_byte_over_denies(self):
        base=guard.RestartBudget(guard.STAGING_LIMIT-1,False)
        exact=base.reserve(A,1,expected_generation=0)
        self.assertEqual(exact.available_bytes,0);self.assertEqual(exact.generation,1)
        with self.assertRaises(guard.RestartBudgetError):base.reserve(A,2,expected_generation=0)
        self.assertEqual(base.available_bytes,1)

    def test_one_fresh_reservation_and_every_uncertain_reservation_remain_charged(self):
        budget=guard.RestartBudget(1,False).reserve(A,4,expected_generation=0)
        with self.assertRaises(guard.RestartBudgetError):budget.reserve(B,1,expected_generation=1)
        used=budget.mark(A,'in-use',expected_generation=1)
        uncertain=used.mark(A,'uncertain',expected_generation=2)
        self.assertEqual(uncertain.charged_bytes,5)
        next_budget=uncertain.reserve(B,guard.STAGING_LIMIT-5,expected_generation=3)
        self.assertEqual(next_budget.charged_bytes,guard.STAGING_LIMIT)
        with self.assertRaises(guard.RestartBudgetError):uncertain.mark(A,'in-use',expected_generation=3)
        with self.assertRaises(guard.RestartBudgetError):uncertain.mark(A,'released',expected_generation=3)

    def test_generation_mismatch_and_overflow_cannot_mutate_or_reuse_capacity(self):
        budget=guard.RestartBudget(0,False).reserve(A,1,expected_generation=0)
        for expected in (0,True,-1,1.0,guard.MAX_GENERATION+1):
            with self.subTest(expected=expected),self.assertRaises(guard.RestartBudgetError):budget.mark(A,'uncertain',expected_generation=expected)
        with self.assertRaises(guard.RestartBudgetError):guard.RestartBudget(0,False,guard.MAX_GENERATION).reserve(A,1,expected_generation=guard.MAX_GENERATION)
        with self.assertRaises(dataclasses.FrozenInstanceError):budget.generation=0

    def test_unknown_charge_cannot_be_discounted_and_counters_are_strict_finite_integers(self):
        for value in (True,-1,0.5,float('nan'),float('inf'),guard.STAGING_LIMIT+1,'1'):
            with self.subTest(value=value),self.assertRaises(guard.RestartBudgetError):guard.RestartBudget(value,False)
        with self.assertRaises(guard.RestartBudgetError):guard.RestartBudget(0,True)
        for value in (0,True,-1,guard.STAGING_LIMIT+1):
            with self.assertRaises(guard.RestartBudgetError):guard.RestartBudget(0,False).reserve(A,value,expected_generation=0)

    def test_identity_and_collection_bounds_deny_paths_duplicates_and_unbounded_entries(self):
        for identity in ('','../active','C:\\private','a'*31,'A'*32,A+'\n'):
            with self.assertRaises(guard.RestartBudgetError):guard.Reservation(identity,1)
        with self.assertRaises(guard.RestartBudgetError):guard.RestartBudget(0,False,reservations=[guard.Reservation(A,1)])
        with self.assertRaises(guard.RestartBudgetError):guard.RestartBudget(0,False,reservations=(guard.Reservation(A,1,'uncertain'),guard.Reservation(A,1)))
        entries=tuple(guard.Reservation(f'{i:032x}',1,'uncertain') for i in range(guard.MAX_RESERVATIONS+1))
        with self.assertRaises(guard.RestartBudgetError):guard.RestartBudget(0,False,reservations=entries)

    def test_bounded_snapshot_roundtrip_is_non_authoritative_and_requires_expected_generation(self):
        budget=guard.RestartBudget(5,False).reserve(A,7,expected_generation=0).mark(A,'uncertain',expected_generation=1)
        self.assertEqual(guard.RestartBudget.from_json(budget.to_json(),expected_generation=2),budget)
        with self.assertRaises(guard.RestartBudgetError):guard.RestartBudget.from_json(budget.to_json(),expected_generation=3)
        self.assertEqual(json.loads(budget.to_json())['authority'],'arithmetic-only')
        self.assertFalse(guard.guarded_restart_readiness()['admitted'])

    def test_torn_duplicate_deep_oversized_and_nonfinite_json_are_static_denials(self):
        valid=guard.RestartBudget().to_json()
        for text in (valid[:-1],'{"domain":1,"domain":2}','['*1000+']'*1000,'x'*(guard.MAX_SNAPSHOT_BYTES+1),'NaN','Infinity','null','[]'):
            with self.subTest(size=len(text)),self.assertRaisesRegex(guard.RestartBudgetError,'^Guarded restart budget is unavailable.$'):
                guard.RestartBudget.from_json(text,expected_generation=0)

    def test_snapshot_cannot_change_domain_quota_or_claim_a_native_ticket(self):
        original=json.loads(guard.RestartBudget().to_json())
        for key,value in (('domain','alternate-cache'),('maximum_staging_bytes',guard.STAGING_LIMIT+1),('authority','native-protection'),('native_proof',True),('retained_charge_bytes',0),('generation',True)):
            candidate={**original,key:value}
            with self.subTest(key=key),self.assertRaises(guard.RestartBudgetError):guard.RestartBudget.from_json(json.dumps(candidate),expected_generation=0)

    def test_current_readiness_has_no_slot_io_permission_mutation_or_worker_effect(self):
        with patch('pathlib.Path.open',side_effect=AssertionError('unexpected file access')),patch('os.scandir',side_effect=AssertionError('unexpected enumeration')),patch('subprocess.Popen',side_effect=AssertionError('unexpected worker')):
            result=guard.guarded_restart_readiness()
        self.assertFalse(result['admitted']);self.assertFalse(result['qualification_complete']);self.assertFalse(result['old_slot_accessed']);self.assertFalse(result['model_or_worker_started'])
        self.assertEqual(result['unproven_retained_budget_charge_bytes'],guard.STAGING_LIMIT);self.assertEqual(result['new_reservation_bytes'],0)
        self.assertEqual(result['reason'],'native-staging-protection-not-implemented')
        result['admitted']=True
        self.assertFalse(guard.guarded_restart_readiness()['admitted'])
        with self.assertRaises(TypeError):guard.guarded_restart_readiness({'native_proof':True})

    def test_cli_plan_is_read_only_and_actual_restart_is_pending(self):
        for arguments,code in ((['--plan'],0),([],3)):
            output=io.StringIO()
            with patch.object(sys,'argv',[str(MODULE),*arguments]),patch('sys.stdout',output):
                self.assertEqual(guard.main(),code)
            result=json.loads(output.getvalue());self.assertFalse(result['admitted']);self.assertEqual(result['status'],'pending-native-protection')


if __name__=='__main__':unittest.main()
