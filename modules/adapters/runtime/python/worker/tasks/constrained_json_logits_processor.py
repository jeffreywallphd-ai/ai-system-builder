"""Lazy, bounded token masks for the existing Outlines/Transformers adapter.

Keep Core's regex and singleton-token projection. LLGuidance's default tokenizer
and forced tokenization are intentionally not used: both change allowed tokens.
This module imports no optional inference dependencies until compilation.
"""
from __future__ import annotations

import json
from typing import Any, Callable

MAX_REGEX_BYTES = 256 * 1024
MAX_GRAMMAR_BYTES = 2 * MAX_REGEX_BYTES
MAX_VOCABULARY_SIZE = 1_048_576
MAX_VOCABULARY_BYTES = 64 * 1024 * 1024
MAX_TOKEN_BYTES = 64 * 1024
MAX_BATCH_SIZE = 8


class BoundedLazyTokenMaskCompiler:
    def __init__(self, model: Any, error_factory: Callable[[str, str], Exception]):
        self._error_factory = error_factory
        if model.tensor_library_name != "torch":
            raise self._error("decoder-tokenizer-unsupported")
        import llguidance as native

        self._native = native
        tokenizer = model.tokenizer
        vocabulary = tokenizer.get_vocab()
        eos = tokenizer.eos_token_id
        if not isinstance(vocabulary, dict) or not 1 <= len(vocabulary) <= MAX_VOCABULARY_SIZE:
            raise self._error("decoder-tokenizer-unsupported")
        ids = set()
        for word, token_id in vocabulary.items():
            if (not isinstance(word, str) or len(word) > MAX_TOKEN_BYTES
                or type(token_id) is not int or not 0 <= token_id < MAX_VOCABULARY_SIZE
                or token_id in ids):
                raise self._error("decoder-tokenizer-unsupported")
            ids.add(token_id)
        if type(eos) is not int or eos not in ids:
            raise self._error("decoder-tokenizer-unsupported")
        self.eos_token_id = eos
        self.vocab_size = max(ids) + 1
        # Bounds above precede sparse-list allocation and all native allocation.
        tokens = [b"\x00"] * self.vocab_size
        self.admitted_ids = bytearray(self.vocab_size)
        eos_text = tokenizer.convert_token_to_string(tokenizer.eos_token)
        byte_count = 0
        for word, token_id in vocabulary.items():
            text = tokenizer.convert_token_to_string(word)
            if not isinstance(text, str) or len(text) > MAX_TOKEN_BYTES:
                raise self._error("decoder-tokenizer-unsupported")
            if text == eos_text:
                continue  # Core removes every alias of the EOS token string.
            data = text.encode("utf-8")
            byte_count += len(data)
            if len(data) > MAX_TOKEN_BYTES or byte_count > MAX_VOCABULARY_BYTES:
                raise self._error("decoder-tokenizer-unsupported")
            tokens[token_id] = data
            self.admitted_ids[token_id] = 1
        self.admitted_ids[eos] = 1

        class Projection:
            eos_token_id = eos
            bos_token_id = None
            special_token_ids = [eos]

            def __call__(self, text):
                return tokenizer.tokenizer.encode(text, add_special_tokens=False)

        projection = Projection()
        projection.tokens = tokens
        self._tokenizer = native.LLTokenizer(native.TokenizerWrapper(projection))
        if self._tokenizer.vocab_size != self.vocab_size:
            raise self._error("decoder-tokenizer-unsupported")

    def _error(self, code="decoder-schema-compile-failed"):
        return self._error_factory(code, "Token constraints could not be prepared or continued safely.")

    def _matcher(self, grammar):
        # Explicit complexity limits, not a claim of a hard process RAM cap.
        limits = self._native.LLParserLimits(
            max_items_in_row=2_000, initial_lexer_fuel=1_000_000,
            step_lexer_fuel=200_000, step_max_items=50_000,
            max_lexer_states=65_536, max_grammar_size=500_000,
            precompute_large_lexemes=False, verbose_errors=False,
        )
        matcher = self._native.LLMatcher(self._tokenizer, grammar, log_level=0, limits=limits)
        if matcher.is_error():
            raise self._error()
        return matcher

    def compile_regex(self, regex: str):
        if not isinstance(regex, str) or len(regex) > MAX_REGEX_BYTES or len(regex.encode("utf-8")) > MAX_REGEX_BYTES:
            raise self._error()
        text = self._native.grammar_from("regex", regex)
        if not isinstance(text, str) or len(text.encode("utf-8")) > MAX_GRAMMAR_BYTES:
            raise self._error()
        grammar = json.loads(text)
        if (not isinstance(grammar, dict) or set(grammar) != {"grammars", "max_tokens"}
            or grammar["max_tokens"] is not None or not isinstance(grammar["grammars"], list)
            or len(grammar["grammars"]) != 1):
            raise self._error()
        entry = grammar["grammars"][0]
        if (not isinstance(entry, dict) or set(entry) != {"name", "json_schema", "lark_grammar"}
            or entry["name"] != "regex" or entry["json_schema"] is not None
            or not isinstance(entry["lark_grammar"], str)):
            raise self._error()
        entry["lark_grammar"] = '%llguidance {"no_forcing":true}\n' + entry["lark_grammar"]
        text = json.dumps(grammar, ensure_ascii=False, separators=(",", ":"))
        if len(text.encode("utf-8")) > MAX_GRAMMAR_BYTES:
            raise self._error()
        # Construct once now to deny malformed/exhausted compilation before use.
        initial_matcher = self._matcher(text)
        from outlines.processors.base_logits_processor import OutlinesLogitsProcessor
        compiler = self

        class Processor(OutlinesLogitsProcessor):
            def __init__(self):
                super().__init__("torch")
                self.reset()

            def reset(self):
                self._matchers = None
                self._length = None
                self._finished = set()

            def process_logits(self, input_ids, logits):
                try:
                    batch, length = input_ids.shape
                    if (not 1 <= batch <= MAX_BATCH_SIZE or length < 1
                        or logits.shape[0] != batch
                        or not compiler.vocab_size <= logits.shape[1] <= MAX_VOCABULARY_SIZE):
                        raise compiler._error("decoder-generation-failed")
                    if self._matchers is None:
                        self._matchers = [initial_matcher.deep_copy() for _ in range(batch)]
                    else:
                        if batch != len(self._matchers) or length != self._length + 1:
                            raise compiler._error("decoder-generation-failed")
                        for row, matcher in enumerate(self._matchers):
                            if matcher.is_error():
                                raise compiler._error("decoder-generation-failed")
                            # Transformers pads completed rows while other rows
                            # continue. Never parse that padding as generated data.
                            if row in self._finished:
                                continue
                            token = input_ids[row, -1].item()
                            if (type(token) is not int or not 0 <= token < compiler.vocab_size
                                or not compiler.admitted_ids[token] or matcher.is_error()
                                or (token == compiler.eos_token_id and not matcher.is_accepting())
                                or not matcher.consume_token(token) or matcher.is_error()):
                                raise compiler._error("decoder-generation-failed")
                            if token == compiler.eos_token_id:
                                self._finished.add(row)
                    self._length = length
                    for row, matcher in enumerate(self._matchers):
                        if matcher.is_error():
                            raise compiler._error("decoder-generation-failed")
                        mask = (bytes(4 * ((compiler.vocab_size + 31) // 32))
                                if row in self._finished else matcher.compute_bitmask())
                        if (matcher.is_error() or not isinstance(mask, bytes)
                            or len(mask) != 4 * ((compiler.vocab_size + 31) // 32)):
                            raise compiler._error("decoder-generation-failed")
                        self._apply_mask(logits[row], mask, row in self._finished or matcher.is_accepting())
                    return logits
                except Exception:
                    # Never forward native grammar, tokenizer or generated-text errors.
                    raise compiler._error("decoder-generation-failed") from None

            def _apply_mask(self, scores, mask, accepting):
                import torch
                # Safe owned bytes, eager operations only. No unsafe native pointers,
                # llguidance.torch or Core @torch.compile kernel import.
                packed = torch.frombuffer(bytearray(mask), dtype=torch.uint8).to(scores.device)
                shifts = torch.arange(8, dtype=torch.uint8, device=scores.device)
                bits = ((packed[:, None] >> shifts) & 1).reshape(-1)[:compiler.vocab_size].bool()
                admitted = torch.frombuffer(compiler.admitted_ids, dtype=torch.uint8).to(scores.device).bool()
                allowed = torch.zeros(scores.shape[-1], dtype=torch.bool, device=scores.device)
                allowed[:compiler.vocab_size] = bits & admitted
                allowed[compiler.eos_token_id] = accepting
                scores.masked_fill_(~allowed, float("-inf"))
                if not torch.isfinite(scores).any().item():
                    raise compiler._error("decoder-generation-failed")

        return Processor()
