"""Signature definitions for code transformation programs."""

import dspy
from typing import Optional


class DocumentCodeSignature(dspy.Signature):
    """
    Add documentation to the selected code ONLY.

    CRITICAL: You must ONLY transform the `code` field. Do NOT include any code from `local_context`.
    The `local_context` is provided ONLY to help you understand the code - never include it in output.

    Guidelines:
    - For functions: Add a docstring describing purpose, parameters, and return value
    - For classes: Add a class docstring describing purpose and key attributes
    - For code sections: Add a comment block explaining what the code does
    - Follow the language's documentation conventions (e.g., Google style for Python)
    - Keep documentation concise but informative
    - Output must be EXACTLY the `code` input with documentation added
    """

    code: str = dspy.InputField(
        desc="The EXACT code to document. Output must contain ONLY this code with docs added."
    )
    language: str = dspy.InputField(
        desc="Programming language (e.g., python, javascript, rust)"
    )
    local_context: str = dspy.InputField(
        desc="Surrounding code for context ONLY - do NOT include this in output"
    )
    document_context: Optional[str] = dspy.InputField(
        desc="Full file content for understanding - do NOT include in output",
        default=None,
    )
    documented_code: str = dspy.OutputField(
        desc="ONLY the `code` input with documentation added. Must contain same code structure."
    )


class CompleteCodeSignature(dspy.Signature):
    """
    Complete an incomplete function, class, or code block.

    Guidelines:
    - Analyze what the code is trying to accomplish
    - Complete the implementation logically
    - Follow existing code style and patterns
    - Only output the completion, not the original code
    """

    code: str = dspy.InputField(
        desc="Incomplete code to complete"
    )
    language: str = dspy.InputField(
        desc="Programming language (e.g., python, javascript, rust)"
    )
    local_context: str = dspy.InputField(
        desc="Surrounding code for context"
    )
    document_context: Optional[str] = dspy.InputField(
        desc="Full file content for understanding the codebase",
        default=None,
    )
    completion: str = dspy.OutputField(
        desc="The code completion (what comes after the input code)"
    )


class AddTypeHintsSignature(dspy.Signature):
    """
    Add type annotations to the selected code ONLY.

    CRITICAL: You must ONLY transform the `code` field. Do NOT include any code from `local_context`.
    The `local_context` is provided ONLY to help you understand types - never include it in output.

    Guidelines:
    - Add type hints to function parameters and return types
    - Add type hints to variables where beneficial
    - Use appropriate types from typing module (List, Dict, Optional, etc.)
    - Infer types from usage and context
    - Output must be EXACTLY the `code` input with type hints added - same lines, same structure
    """

    code: str = dspy.InputField(
        desc="The EXACT code to transform. Output must contain ONLY this code with type hints added."
    )
    language: str = dspy.InputField(
        desc="Programming language (e.g., python, typescript)"
    )
    local_context: str = dspy.InputField(
        desc="Surrounding code for context ONLY - do NOT include this in output"
    )
    document_context: Optional[str] = dspy.InputField(
        desc="Full file content for understanding types - do NOT include in output",
        default=None,
    )
    typed_code: str = dspy.OutputField(
        desc="ONLY the `code` input with type annotations added. Must have same structure as input."
    )


class ImproveNamesSignature(dspy.Signature):
    """
    Improve variable, function, and class names in the selected code ONLY.

    CRITICAL: You must ONLY transform the `code` field. Do NOT include any code from `local_context`.
    The `local_context` is provided ONLY to help you understand naming patterns - never include it in output.

    Guidelines:
    - Make names more descriptive and self-documenting
    - Follow language naming conventions (snake_case for Python, camelCase for JS, etc.)
    - Avoid single-letter names except for obvious cases (i, j for loops)
    - Make the code more readable through better naming
    - Preserve the code's functionality exactly
    - Output must be EXACTLY the `code` input with names improved
    """

    code: str = dspy.InputField(
        desc="The EXACT code to transform. Output must contain ONLY this code with better names."
    )
    language: str = dspy.InputField(
        desc="Programming language"
    )
    local_context: str = dspy.InputField(
        desc="Surrounding code for context ONLY - do NOT include this in output"
    )
    document_context: Optional[str] = dspy.InputField(
        desc="Full file content for understanding naming patterns - do NOT include in output",
        default=None,
    )
    improved_code: str = dspy.OutputField(
        desc="ONLY the `code` input with improved names. Must have same structure as input."
    )


class ExplainCodeSignature(dspy.Signature):
    """
    Add inline comments to explain the selected code ONLY.

    CRITICAL: You must ONLY transform the `code` field. Do NOT include any code from `local_context`.
    The `local_context` is provided ONLY to help you understand purpose - never include it in output.

    Guidelines:
    - Add comments that explain the "why" not just the "what"
    - Focus on complex or non-obvious logic
    - Don't over-comment simple, self-explanatory code
    - Use clear, concise language
    - Place comments on the line before or on the same line as the code
    - Output must be EXACTLY the `code` input with comments added
    """

    code: str = dspy.InputField(
        desc="The EXACT code to explain. Output must contain ONLY this code with comments added."
    )
    language: str = dspy.InputField(
        desc="Programming language"
    )
    local_context: str = dspy.InputField(
        desc="Surrounding code for context ONLY - do NOT include this in output"
    )
    document_context: Optional[str] = dspy.InputField(
        desc="Full file content for understanding purpose - do NOT include in output",
        default=None,
    )
    explained_code: str = dspy.OutputField(
        desc="ONLY the `code` input with explanatory comments. Must have same structure as input."
    )


class RefactorCodeSignature(dspy.Signature):
    """
    Refactor and simplify the selected code ONLY while preserving its behavior.

    CRITICAL: You must ONLY transform the `code` field. Do NOT include any code from `local_context`.
    The `local_context` is provided ONLY to help you understand dependencies - never include it in output.

    Guidelines:
    - Simplify complex logic
    - Remove redundancy and dead code
    - Improve readability
    - Apply best practices and design patterns where appropriate
    - Preserve the exact functionality
    - Don't change the API/interface unless clearly beneficial
    - Output must be EXACTLY the `code` input refactored
    """

    code: str = dspy.InputField(
        desc="The EXACT code to refactor. Output must contain ONLY this code refactored."
    )
    language: str = dspy.InputField(
        desc="Programming language"
    )
    local_context: str = dspy.InputField(
        desc="Surrounding code for context ONLY - do NOT include this in output"
    )
    document_context: Optional[str] = dspy.InputField(
        desc="Full file content for understanding dependencies - do NOT include in output",
        default=None,
    )
    refactored_code: str = dspy.OutputField(
        desc="ONLY the `code` input refactored. Must transform only the input code."
    )


class FormatCodeSignature(dspy.Signature):
    """
    Format and prettify the selected code ONLY.

    CRITICAL: You must ONLY format the `code` field. Do NOT include any code from `local_context`.
    The `local_context` is provided ONLY to understand style conventions - never include it in output.

    Guidelines:
    - Apply consistent indentation (spaces or tabs based on context)
    - Add proper line breaks and spacing
    - Align similar constructs (assignments, parameters, etc.)
    - Follow language-specific formatting conventions (PEP8 for Python, etc.)
    - Preserve the exact functionality - only change whitespace and formatting
    - Output must be EXACTLY the `code` input formatted
    """

    code: str = dspy.InputField(
        desc="The EXACT code to format. Output must contain ONLY this code formatted."
    )
    language: str = dspy.InputField(
        desc="Programming language (e.g., python, javascript, rust)"
    )
    local_context: str = dspy.InputField(
        desc="Surrounding code for style context ONLY - do NOT include this in output"
    )
    document_context: Optional[str] = dspy.InputField(
        desc="Full file content for style conventions - do NOT include in output",
        default=None,
    )
    formatted_code: str = dspy.OutputField(
        desc="ONLY the `code` input formatted. Must have same logic, just better formatting."
    )


class ProgramCodeSignature(dspy.Signature):
    """
    Transform pseudo-code or natural language instructions into proper, executable code.

    The input is a mix of English descriptions and code fragments - a shorthand way of
    expressing programming intent. Your job is to interpret this and produce clean,
    working code in the target language.

    Guidelines:
    - Parse the pseudo-code to understand the programmer's intent
    - Convert English descriptions into actual code constructs
    - Fill in implied details (variable declarations, imports, error handling)
    - Follow the conventions and patterns visible in document_context
    - Match the coding style of surrounding code in local_context
    - Output must be syntactically correct, runnable code
    - Preserve any actual code fragments from the input, just clean them up

    Examples of pseudo-code patterns to handle:
    - "loop through items and print each" -> for item in items: print(item)
    - "if user exists then return user else throw error" -> proper if/else with exception
    - "fetch url, parse json, extract 'data' field" -> requests + json parsing code
    - "class User with name, email, save method" -> full class definition
    """

    pseudo_code: str = dspy.InputField(
        desc="The pseudo-code or natural language mixed with code fragments to transform"
    )
    language: str = dspy.InputField(
        desc="Target programming language (e.g., python, javascript, rust)"
    )
    local_context: str = dspy.InputField(
        desc="Surrounding code for style and context - understand patterns but don't include in output"
    )
    document_context: Optional[str] = dspy.InputField(
        desc="Full document/notebook content - use for imports, defined functions, conventions",
        default=None,
    )
    code: str = dspy.OutputField(
        desc="Clean, executable code that implements the pseudo-code intent"
    )
