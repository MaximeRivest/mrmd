"""Signature definitions for finish/completion programs."""

import dspy
from typing import Optional


class FinishSentenceSignature(dspy.Signature):
    """
    You are helping a user write in a markdown notebook. Your task is to complete
    the sentence they are currently typing.

    You will receive:
    - document_context: The full notebook content for understanding the topic and style
    - local_context: The current paragraph/section being written
    - text_before_cursor: The exact text up to where the cursor is (what needs completion)

    Output ONLY the text that should be appended after the cursor.
    Do NOT repeat any of the text_before_cursor.
    Complete the sentence naturally, matching the writing style.
    """

    document_context: Optional[str] = dspy.InputField(
        desc="The full notebook/document content for understanding context, style, and topic",
        default=None,
    )
    local_context: str = dspy.InputField(
        desc="The current paragraph or section being written"
    )
    text_before_cursor: str = dspy.InputField(
        desc="The exact text up to the cursor position - this is what you're completing"
    )
    completion: str = dspy.OutputField(
        desc="ONLY the new text to append after the cursor - do not repeat any existing text"
    )


class FinishParagraphSignature(dspy.Signature):
    """
    You are helping a user write in a markdown notebook. Your task is to complete
    the paragraph they are currently writing.

    You will receive:
    - document_context: The full notebook content for understanding the topic and style
    - local_context: The current section/cell being written
    - text_before_cursor: The paragraph text up to the cursor position

    Output ONLY the text that should be appended after the cursor.
    Do NOT repeat any of the text_before_cursor.
    Complete the paragraph naturally, bringing the thought to conclusion.
    """

    document_context: Optional[str] = dspy.InputField(
        desc="The full notebook/document content for understanding context and topic",
        default=None,
    )
    local_context: str = dspy.InputField(
        desc="The current section or cell being written"
    )
    text_before_cursor: str = dspy.InputField(
        desc="The paragraph text up to the cursor - this is what you're completing"
    )
    completion: str = dspy.OutputField(
        desc="ONLY the new text to append - complete the paragraph without repeating existing text"
    )


class FinishCodeLineSignature(dspy.Signature):
    """
    You are helping a user write code in a markdown notebook. Your task is to complete
    the current line of code they are typing.

    You will receive:
    - document_context: The full notebook content (may include other code blocks, explanations)
    - local_context: The current code block being edited
    - code_before_cursor: The code in this block up to the cursor position
    - language: The programming language

    Output ONLY the code to append after the cursor to complete the current line.
    Do NOT repeat any code from code_before_cursor.
    Follow the coding style visible in the context.
    Only complete the current line - stop at the end of the line.
    """

    document_context: Optional[str] = dspy.InputField(
        desc="The full notebook content for understanding the project context",
        default=None,
    )
    local_context: str = dspy.InputField(
        desc="The complete current code block being edited"
    )
    code_before_cursor: str = dspy.InputField(
        desc="The code up to the cursor position - this is what you're completing"
    )
    language: str = dspy.InputField(
        desc="The programming language (python, javascript, etc.)"
    )
    completion: str = dspy.OutputField(
        desc="ONLY the code to append to complete the current line - no repetition, no extra lines"
    )


class FinishCodeSectionSignature(dspy.Signature):
    """
    You are helping a user write code in a markdown notebook. Your task is to complete
    the current code section (function, class, or logical block).

    You will receive:
    - document_context: The full notebook content (other code blocks, documentation)
    - local_context: The current code block being edited
    - code_before_cursor: The code up to the cursor position
    - language: The programming language

    Output ONLY the code to append after the cursor.
    Do NOT repeat any code from code_before_cursor.
    Complete the logical unit (finish the function, close the class, etc.).
    Follow the coding style and conventions visible in the context.
    """

    document_context: Optional[str] = dspy.InputField(
        desc="The full notebook content for understanding the project context",
        default=None,
    )
    local_context: str = dspy.InputField(
        desc="The complete current code block being edited"
    )
    code_before_cursor: str = dspy.InputField(
        desc="The code up to the cursor - this is what you're completing"
    )
    language: str = dspy.InputField(
        desc="The programming language (python, javascript, etc.)"
    )
    completion: str = dspy.OutputField(
        desc="ONLY the code to append to complete the section - no repetition of existing code"
    )
