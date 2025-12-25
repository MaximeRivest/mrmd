"""Signature definitions for text transformation programs."""

import dspy
from typing import Optional, List


class GetSynonymsSignature(dspy.Signature):
    """
    Find synonyms for a SINGLE WORD that fit the context.

    Guidelines:
    - Provide 3-6 alternative words that could replace the input word
    - Consider the surrounding context to suggest appropriate synonyms
    - Preserve the part of speech (noun, verb, adjective, etc.)
    - Order synonyms by relevance to the context
    - Synonyms should be single words or very short (1-2 words max)
    """

    text: str = dspy.InputField(
        desc="The single word to find synonyms for"
    )
    local_context: str = dspy.InputField(
        desc="Surrounding text to understand usage context"
    )
    document_context: Optional[str] = dspy.InputField(
        desc="Full document for topic understanding",
        default=None,
    )
    original: str = dspy.OutputField(
        desc="The original word (echoed back)"
    )
    synonyms: List[str] = dspy.OutputField(
        desc="List of 3-6 synonym alternatives (prefer single words)"
    )


class GetPhraseSynonymsSignature(dspy.Signature):
    """
    Find alternative phrases for a multi-word expression that fit the context.

    Guidelines:
    - Provide 3-6 alternative phrases that could replace the input phrase
    - Preserve the meaning and grammatical structure
    - Consider the surrounding context for appropriate alternatives
    - Alternatives should be complete phrases that can directly replace the original
    - Order by relevance to the context
    """

    phrase: str = dspy.InputField(
        desc="The multi-word phrase to find alternatives for (e.g., 'executable notebooks')"
    )
    local_context: str = dspy.InputField(
        desc="Surrounding text to understand usage context"
    )
    document_context: Optional[str] = dspy.InputField(
        desc="Full document for topic understanding",
        default=None,
    )
    original: str = dspy.OutputField(
        desc="The original phrase (echoed back)"
    )
    alternatives: List[str] = dspy.OutputField(
        desc="List of 3-6 alternative phrases that preserve meaning"
    )


class ReformatMarkdownSignature(dspy.Signature):
    """
    Clean up and reformat markdown text while preserving meaning.

    CRITICAL: You must ONLY reformat the `text` field. Do NOT include text from `local_context`.

    Guidelines:
    - Fix inconsistent heading levels
    - Normalize list formatting (bullets, numbering)
    - Clean up whitespace and line breaks
    - Fix broken links and formatting
    - Improve paragraph structure
    - Preserve all content and meaning exactly
    - Output must be EXACTLY the `text` input reformatted
    """

    text: str = dspy.InputField(
        desc="The EXACT markdown text to reformat. Output must contain ONLY this text reformatted."
    )
    local_context: str = dspy.InputField(
        desc="Surrounding text for style context ONLY - do NOT include this in output"
    )
    document_context: Optional[str] = dspy.InputField(
        desc="Full document for understanding structure - do NOT include in output",
        default=None,
    )
    reformatted_text: str = dspy.OutputField(
        desc="ONLY the `text` input reformatted. Must have same content, cleaner formatting."
    )


class IdentifyReplacementSignature(dspy.Signature):
    """
    Identify the exact phrase to replace when applying a synonym.

    Given an original word and a chosen synonym, analyze the context to determine
    what COMPLETE phrase should be replaced.

    CRITICAL RULES:
    1. If the synonym is "adjective noun" (e.g., "interactive notebooks"), find if the original
       word in context also has an adjective (e.g., "executable notebooks") and replace the WHOLE phrase
    2. The text_to_replace MUST be copied EXACTLY from the context - character for character
    3. The replacement should result in grammatically correct text

    Examples:
    - original_word="notebooks", synonym="interactive notebooks", context has "executable notebooks"
      → text_to_replace="executable notebooks", replacement="interactive notebooks"
    - original_word="notebooks", synonym="notebooks", context has "executable notebooks"
      → text_to_replace="notebooks", replacement="notebooks"
    - original_word="big", synonym="large", context has "big house"
      → text_to_replace="big", replacement="large"
    """

    original_word: str = dspy.InputField(
        desc="The word that was identified for synonym replacement"
    )
    chosen_synonym: str = dspy.InputField(
        desc="The synonym the user chose (may be single or multi-word like 'interactive notebooks')"
    )
    context: str = dspy.InputField(
        desc="The text surrounding the original word - search here for the phrase to replace"
    )
    text_to_replace: str = dspy.OutputField(
        desc="The EXACT phrase copied from context that should be replaced. If synonym is 'adj noun', find 'adj noun' pattern in context containing original_word."
    )
    replacement: str = dspy.OutputField(
        desc="The text to insert - usually the chosen_synonym, possibly adjusted for grammar"
    )
