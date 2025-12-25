"""Signature definitions for fix/correction programs."""

import dspy
from typing import Optional


class FixGrammarSignature(dspy.Signature):
    """
    You are helping a user fix text in a markdown notebook. Your task is to correct
    grammar, spelling, and punctuation errors in the selected text.

    You will receive:
    - document_context: The full notebook content for understanding terminology and style
    - local_context: The current paragraph/section for understanding immediate context
    - text_to_fix: The exact text that needs fixing (user's selection or current line)

    Output the corrected version of text_to_fix.
    Make minimal changes - only fix actual errors.
    Preserve the original meaning, tone, and formatting.

    IMPORTANT: Preserve ALL whitespace including leading/trailing newlines and spaces.
    The fixed_text must have the exact same whitespace structure as text_to_fix.
    If text_to_fix starts with newlines, fixed_text must too.
    If text_to_fix ends with newlines, fixed_text must too.
    """

    document_context: Optional[str] = dspy.InputField(
        desc="The full notebook/document for understanding terminology and writing style",
        default=None,
    )
    local_context: str = dspy.InputField(
        desc="The current paragraph or section for immediate context"
    )
    text_to_fix: str = dspy.InputField(
        desc="The exact text to fix - preserve all whitespace including leading/trailing newlines"
    )
    fixed_text: str = dspy.OutputField(
        desc="The corrected text - MUST preserve exact whitespace structure (leading/trailing newlines and spaces)"
    )


class FixTranscriptionSignature(dspy.Signature):
    """
    You are helping a user fix speech-to-text transcription in a markdown notebook.
    Your task is to correct errors from voice transcription.

    You will receive:
    - document_context: The full notebook content for understanding the topic and terminology
    - local_context: The current section for understanding what's being discussed
    - text_to_fix: The transcribed text that likely contains speech-to-text errors

    Output the corrected transcription.
    Fix misheard words, add proper punctuation, and fix capitalization.
    Preserve the speaker's intended meaning.

    IMPORTANT: Preserve ALL whitespace including leading/trailing newlines and spaces.
    The fixed_text must have the exact same whitespace structure as text_to_fix.
    """

    document_context: Optional[str] = dspy.InputField(
        desc="The full notebook/document for understanding topic and terminology",
        default=None,
    )
    local_context: str = dspy.InputField(
        desc="The current section for understanding what's being discussed"
    )
    text_to_fix: str = dspy.InputField(
        desc="The transcribed text to fix - preserve all whitespace including leading/trailing newlines"
    )
    fixed_text: str = dspy.OutputField(
        desc="The corrected transcription - MUST preserve exact whitespace structure"
    )
