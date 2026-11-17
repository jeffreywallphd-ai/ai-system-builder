from __future__ import annotations

import json
import sys
from types import SimpleNamespace
import unittest
from unittest.mock import Mock, patch

from modules.adapters.runtime.python.worker.tasks.constrained_json_decoder import ConstrainedJsonDecoderError
from modules.adapters.runtime.python.worker.tasks import constrained_json_logits_processor as masks


class _Base:
    def __init__(self, tensor_library):
        self.tensor_library = tensor_library


class _Matcher:
    def __init__(self):
        self.error = False
        self.accepting = False
        self.consume_ok = True
        self.mask = b'\xff\xff\xff\xff'
        self.tokens = []

    def is_error(self): return self.error
    def is_accepting(self): return self.accepting
    def consume_token(self, token):
        self.tokens.append(token)
        return self.consume_ok
    def compute_bitmask(self): return self.mask
    def deep_copy(self): return _Matcher()


class _Input:
    def __init__(self, length=1, token=0, batch=1):
        self.shape = (batch, length)
        self.token = token
    def __getitem__(self, key): return SimpleNamespace(item=lambda: self.token)


class _Scores:
    shape = (1, 6)
    def __getitem__(self, key): return key


class LazyTokenMaskTests(unittest.TestCase):
    def setUp(self):
        self.native = SimpleNamespace(
            TokenizerWrapper=lambda value: value,
            LLTokenizer=Mock(side_effect=lambda value: SimpleNamespace(vocab_size=len(value.tokens))),
            LLParserLimits=Mock(side_effect=lambda **kw: kw),
            LLMatcher=Mock(side_effect=lambda *_args, **_kw: _Matcher()),
            grammar_from=Mock(return_value=json.dumps({'grammars': [
                {'name': 'regex', 'json_schema': None, 'lark_grammar': 'start: /abc/'}
            ], 'max_tokens': None})),
        )
        self.tokens = {'a': 0, 'EOS': 1, 'alias': 3, 'b': 5}
        self.tokenizer = SimpleNamespace(
            get_vocab=lambda: self.tokens, eos_token_id=1, eos_token='EOS',
            convert_token_to_string=lambda word: 'EOS' if word == 'alias' else word,
            tokenizer=SimpleNamespace(encode=lambda text, **kw: [0]),
        )
        self.model = SimpleNamespace(tensor_library_name='torch', tokenizer=self.tokenizer)
        self.patches = patch.dict(sys.modules, {
            'llguidance': self.native,
            'outlines.processors.base_logits_processor': SimpleNamespace(OutlinesLogitsProcessor=_Base),
        })
        self.patches.start()
        self.addCleanup(self.patches.stop)

    def compiler(self):
        return masks.BoundedLazyTokenMaskCompiler(self.model, ConstrainedJsonDecoderError)

    def test_preserves_core_projection_aliases_holes_and_shared_tokenizer(self):
        compiler = self.compiler()
        for _ in range(2): compiler.compile_regex('original regex')
        self.native.LLTokenizer.assert_called_once()
        projected = self.native.LLTokenizer.call_args.args[0]
        self.assertEqual(projected.tokens, [b'a', b'\x00', b'\x00', b'\x00', b'\x00', b'b'])
        self.assertEqual(list(compiler.admitted_ids), [1, 1, 0, 0, 0, 1])
        self.assertEqual(self.native.grammar_from.call_args.args, ('regex', 'original regex'))
        grammar = json.loads(self.native.LLMatcher.call_args.args[1])
        self.assertEqual(grammar['grammars'][0]['lark_grammar'], '%llguidance {"no_forcing":true}\nstart: /abc/')
        self.assertEqual(self.native.LLMatcher.call_args.kwargs['log_level'], 0)
        limits = self.native.LLParserLimits.call_args.kwargs
        self.assertEqual(limits['max_lexer_states'], 65_536)
        self.assertFalse(limits['verbose_errors'])
        self.assertFalse(limits['precompute_large_lexemes'])

    def test_denies_bad_or_sparse_extreme_ids_before_native_allocation(self):
        for value in (-1, True, 1.5, masks.MAX_VOCABULARY_SIZE):
            with self.subTest(value=value):
                self.tokens['bad'] = value
                with self.assertRaises(ConstrainedJsonDecoderError): self.compiler()
        self.native.LLTokenizer.assert_not_called()

    def test_denies_duplicate_ids_missing_eos_and_oversized_projection(self):
        for tokens in ({'a': 0, 'EOS': 0}, {'a': 0}, {'a': 0, 'EOS': 1}):
            self.tokens = tokens
            self.tokenizer.convert_token_to_string = lambda word: 'x' * (masks.MAX_TOKEN_BYTES + 1)
            with self.assertRaises(ConstrainedJsonDecoderError): self.compiler()
        self.native.LLTokenizer.assert_not_called()

    def test_denies_total_projected_bytes_before_native_allocation(self):
        with patch.object(masks, 'MAX_VOCABULARY_BYTES', 1):
            with self.assertRaises(ConstrainedJsonDecoderError): self.compiler()
        self.native.LLTokenizer.assert_not_called()

    def test_denies_oversized_regex_and_unexpected_grammar(self):
        compiler = self.compiler()
        with self.assertRaises(ConstrainedJsonDecoderError): compiler.compile_regex('x' * (masks.MAX_REGEX_BYTES + 1))
        self.native.grammar_from.assert_not_called()
        for grammar in ({}, {'grammars': [], 'max_tokens': None}, {'grammars': [{}], 'max_tokens': None}):
            self.native.grammar_from.return_value = json.dumps(grammar)
            with self.assertRaises(ConstrainedJsonDecoderError): compiler.compile_regex('abc')
        self.native.LLMatcher.assert_not_called()

    def test_denies_constructor_error_without_reading_private_native_details(self):
        matcher = _Matcher(); matcher.error = True
        matcher.get_error = Mock(side_effect=AssertionError('must not read native details'))
        self.native.LLMatcher.return_value = matcher
        self.native.LLMatcher.side_effect = None
        with self.assertRaises(ConstrainedJsonDecoderError) as raised: self.compiler().compile_regex('abc')
        self.assertNotIn('private', str(raised.exception))
        matcher.get_error.assert_not_called()

    def processor(self):
        processor = self.compiler().compile_regex('abc')
        processor._apply_mask = Mock()
        processor.process_logits(_Input(), _Scores())
        return processor

    def test_reset_discards_request_state_and_consumes_only_generated_tokens(self):
        processor = self.processor()
        matcher = processor._matchers[0]
        self.assertEqual(matcher.tokens, [])
        processor.process_logits(_Input(length=2, token=5), _Scores())
        self.assertEqual(matcher.tokens, [5])
        processor.reset()
        processor.process_logits(_Input(length=20), _Scores())
        self.assertIsNot(processor._matchers[0], matcher)
        self.assertEqual(processor._matchers[0].tokens, [])

    def test_denies_error_consume_failure_mask_failure_and_unexpected_sequence(self):
        for failure in ('error', 'consume', 'mask', 'length', 'alias'):
            with self.subTest(failure=failure):
                processor = self.processor(); matcher = processor._matchers[0]
                if failure == 'error': matcher.error = True
                if failure == 'consume': matcher.consume_ok = False
                if failure == 'mask': matcher.mask = b'bad'
                with self.assertRaises(ConstrainedJsonDecoderError):
                    processor.process_logits(_Input(length=4 if failure == 'length' else 2, token=3 if failure == 'alias' else 5), _Scores())

    def test_eos_requires_healthy_accepting_state(self):
        processor = self.processor()
        with self.assertRaises(ConstrainedJsonDecoderError): processor.process_logits(_Input(length=2, token=1), _Scores())
        processor = self.processor(); processor._matchers[0].accepting = True
        processor.process_logits(_Input(length=2, token=1), _Scores())
        self.assertTrue(processor._apply_mask.call_args.args[-1])

    def test_native_mask_error_before_sampling_never_applies_a_mask(self):
        processor = self.processor()
        matcher = processor._matchers[0]
        processor._apply_mask.reset_mock()
        def fail_during_mask():
            matcher.error = True
            return b'\xff\xff\xff\xff'
        matcher.compute_bitmask = fail_during_mask
        with self.assertRaises(ConstrainedJsonDecoderError):
            processor.process_logits(_Input(length=2, token=5), _Scores())
        processor._apply_mask.assert_not_called()

    def test_batch_bound_is_checked_before_matcher_copies(self):
        initial = _Matcher()
        initial.deep_copy = Mock(side_effect=AssertionError('Invalid batches must not allocate native copies.'))
        self.native.LLMatcher.side_effect = None
        self.native.LLMatcher.return_value = initial
        processor = self.compiler().compile_regex('abc')
        for batch in (0, masks.MAX_BATCH_SIZE + 1):
            with self.subTest(batch=batch), self.assertRaises(ConstrainedJsonDecoderError):
                processor.process_logits(_Input(batch=batch), SimpleNamespace(shape=(batch, 6)))
        self.assertIsNone(processor._matchers)
        initial.deep_copy.assert_not_called()

    def test_reset_clears_finished_rows(self):
        processor = self.processor()
        processor._matchers[0].accepting = True
        processor.process_logits(_Input(length=2, token=1), _Scores())
        self.assertEqual(processor._finished, {0})
        processor.reset()
        self.assertEqual(processor._finished, set())
        processor.process_logits(_Input(length=7), _Scores())
        self.assertFalse(processor._apply_mask.call_args.args[-1])


if __name__ == '__main__':
    unittest.main()
