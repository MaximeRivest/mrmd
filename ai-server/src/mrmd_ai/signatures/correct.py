"""Signature definitions for correct-and-finish programs."""

import dspy
from typing import Optional


class CorrectAndFinishLineSignature(dspy.Signature):
    """
    You are helping a user in a markdown notebook. Your task is to BOTH correct
    errors AND complete the current line.

    You will receive:
    - document_context: The full notebook for understanding context
    - local_context: The current section/code block
    - text_to_fix: The current line that may have errors and is incomplete
    - content_type: Whether this is 'text' or code (e.g., 'python', 'javascript')

    Output the COMPLETE corrected and finished line.
    First fix any errors, then complete the line naturally.
    This replaces the entire text_to_fix, so output the full corrected+completed version.
    """

    document_context: Optional[str] = dspy.InputField(
        desc="The full notebook/document for understanding context",
        default=None,
    )
    local_context: str = dspy.InputField(
        desc="The current paragraph or code block for immediate context"
    )
    text_to_fix: str = dspy.InputField(
        desc="The current line with possible errors, incomplete - will be replaced entirely"
    )
    content_type: str = dspy.InputField(
        desc="Type of content: 'text' for prose, or language name like 'python', 'javascript'"
    )
    corrected_completion: str = dspy.OutputField(
        desc="The FULL line - corrected and completed - this replaces text_to_fix entirely"
    )


class CorrectAndFinishSectionSignature(dspy.Signature):
    """
    You are helping a user in a markdown notebook. Your task is to BOTH correct
    errors AND complete the current section (paragraph or code block).

    You will receive:
    - document_context: The full notebook for understanding context
    - local_context: The surrounding content
    - text_to_fix: The current section that may have errors and is incomplete
    - content_type: Whether this is 'text' or code (e.g., 'python', 'javascript')

    Output the COMPLETE corrected and finished section.
    First fix any errors, then complete the section naturally.
    This replaces the entire text_to_fix, so output the full corrected+completed version.
    """

    document_context: Optional[str] = dspy.InputField(
        desc="The full notebook/document for understanding context",
        default=None,
    )
    local_context: str = dspy.InputField(
        desc="The surrounding content for context"
    )
    text_to_fix: str = dspy.InputField(
        desc="The current section with possible errors, incomplete - will be replaced entirely"
    )
    content_type: str = dspy.InputField(
        desc="Type of content: 'text' for prose, or language name like 'python', 'javascript'"
    )
    corrected_completion: str = dspy.OutputField(
        desc="The FULL section - corrected and completed - this replaces text_to_fix entirely"
    )
