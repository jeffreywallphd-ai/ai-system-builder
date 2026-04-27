from __future__ import annotations

from dataclasses import dataclass
from difflib import SequenceMatcher
import json
from typing import Any

from ..models import ExampleGenerationConfig
from .local_text_generation import (
    _GENERATOR_CACHE,
    _RESOLVED_MODEL_REFERENCES,
    ensure_generation_model_downloaded,
    ensure_generation_model_is_available,
    get_or_create_local_text_generator,
)
from .markdown_chunking import MarkdownChunk


@dataclass
class GeneratedQaExample:
    artifact_id: str
    chunk_index: int
    question: str
    answer: str
    generation_mode: str = "qa"


def _build_question_prompt(chunk: MarkdownChunk) -> str:
    return (
        "You are creating supervised training data.\n"
        "Write exactly one clear user question answerable only from the context.\n"
        "The question should be specific, natural, and grounded in the context.\n"
        "The context is the source material, not a list of generation examples.\n"
        "Return only the question.\n\n"
        f"Context:\n{chunk.text}"
    )


def _build_answer_prompt(question: str, chunk: MarkdownChunk) -> str:
    return (
        "You are creating supervised training data.\n"
        "Answer the user question using only facts in the context.\n"
        "Write in a conversational tone while staying concise and faithful.\n"
        "Do not add details not present in the context.\n"
        "The context is the source material, not a list of generation examples.\n"
        "Return only the answer.\n\n"
        f"Question:\n{question}\n\n"
        f"Context:\n{chunk.text}"
    )


def _normalize_text(value: str) -> str:
    return " ".join(value.replace("\r", "\n").split()).strip().lower()


def _strip_reasoning_blocks(text: str) -> str:
    candidate = text.replace("\r", "\n").strip()
    lowered = candidate.lower()

    while lowered.startswith("<think>"):
        closing_index = lowered.find("</think>")
        if closing_index < 0:
            return ""
        candidate = candidate[closing_index + len("</think>") :].strip()
        lowered = candidate.lower()

    return candidate


def _strip_response_label(text: str, labels: tuple[str, ...]) -> str:
    candidate = text.strip()
    lowered = candidate.lower()
    for label in labels:
        prefix = f"{label.lower()}:"
        if lowered.startswith(prefix):
            return candidate[len(prefix) :].strip()
    return candidate


def _is_substantial_prompt_echo(generated: str, prompt: str) -> bool:
    normalized_generated = _normalize_text(generated)
    normalized_prompt = _normalize_text(prompt)
    if not normalized_generated:
        return True
    if normalized_generated in normalized_prompt:
        return True
    if len(normalized_generated) > 20 and SequenceMatcher(None, normalized_generated, normalized_prompt).ratio() > 0.8:
        return True
    return False


def _log_generation_diagnostic(
    event: str,
    raw_data: dict[str, Any],
    prepared_data: dict[str, Any],
    errors: list[str],
) -> None:
    print(
        json.dumps(
            {
                "event": event,
                "rawData": raw_data,
                "preparedData": prepared_data,
                "errors": errors,
            },
            ensure_ascii=False,
            default=str,
        ),
        flush=True,
    )


def _format_generation_error(error: Exception) -> str:
    message = str(error).strip()
    if message:
        return message
    return error.__class__.__name__


def _log_chunk_generation_failure(
    chunk: MarkdownChunk,
    config: ExampleGenerationConfig,
    question_prompt: str,
    answer_prompt: str,
    raw_question_output: str,
    raw_answer_output: str,
    error: Exception,
) -> None:
    _log_generation_diagnostic(
        "runtime.dataset_preparation.generation.chunk_failed",
        raw_data={
            "chunk": {
                "artifactId": chunk.artifact_id,
                "chunkIndex": chunk.chunk_index,
                "text": chunk.text,
            },
            "questionOutput": raw_question_output,
            "answerOutput": raw_answer_output,
        },
        prepared_data={
            "model": config.model.model_dump(mode="json"),
            "generationParams": (
                config.generationParams.model_dump(mode="json")
                if config.generationParams is not None
                else None
            ),
            "failurePolicy": config.failurePolicy,
            "questionPrompt": question_prompt,
            "answerPrompt": answer_prompt or None,
        },
        errors=[_format_generation_error(error)],
    )


def _extract_single_question(text: str, prompt: str) -> str:
    candidate = _strip_response_label(
        _strip_reasoning_blocks(text),
        ("question", "user question"),
    )
    lowered = candidate.lower()

    if "context:" in lowered or "return only the question" in lowered:
        raise ValueError("Question generation echoed prompt instructions or context.")
    if _is_substantial_prompt_echo(candidate, prompt):
        raise ValueError("Question generation substantially echoed the prompt.")

    question_line = next((line.strip() for line in candidate.splitlines() if "?" in line), "")
    if not question_line or "?" not in question_line:
        raise ValueError("Question generation did not produce a usable question.")

    return question_line.split("?", 1)[0].strip() + "?"


def _extract_single_answer(text: str, question: str) -> str:
    candidate = _strip_response_label(
        _strip_reasoning_blocks(text),
        ("answer", "assistant"),
    )
    lowered = candidate.lower()
    if "context:" in lowered:
        raise ValueError("Answer generation echoed context block instead of returning an answer.")
    if not candidate:
        raise ValueError("Answer generation returned an empty value.")
    if candidate.strip().lower() == question.strip().lower():
        raise ValueError("Answer generation repeated the question instead of answering it.")
    return candidate


def generate_qa_examples_for_chunks(
    chunks: list[MarkdownChunk],
    config: ExampleGenerationConfig,
) -> list[GeneratedQaExample]:
    if config.mode != "qa":
        raise ValueError(f"Unsupported generation mode: {config.mode}")

    generator = get_or_create_local_text_generator(config)

    examples: list[GeneratedQaExample] = []
    for chunk in chunks:
        question_prompt = _build_question_prompt(chunk)
        answer_prompt = ""
        raw_question_output = ""
        raw_answer_output = ""
        try:
            raw_question_output = generator.generate_text(question_prompt).strip()
            question = _extract_single_question(raw_question_output, question_prompt)
            answer_prompt = _build_answer_prompt(question, chunk)
            raw_answer_output = generator.generate_text(answer_prompt).strip()
            answer = _extract_single_answer(
                raw_answer_output,
                question,
            )
        except ValueError as error:
            _log_chunk_generation_failure(
                chunk,
                config,
                question_prompt,
                answer_prompt,
                raw_question_output,
                raw_answer_output,
                error,
            )
            if config.failurePolicy == "skip":
                continue
            raise
        except Exception as error:
            _log_chunk_generation_failure(
                chunk,
                config,
                question_prompt,
                answer_prompt,
                raw_question_output,
                raw_answer_output,
                error,
            )
            raise

        examples.append(
            GeneratedQaExample(
                artifact_id=chunk.artifact_id,
                chunk_index=chunk.chunk_index,
                question=question,
                answer=answer,
            )
        )

    return examples
