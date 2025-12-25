"""Signature definitions for notebook-related AI programs."""

import dspy


class NotebookNameSignature(dspy.Signature):
    """
    Generate a short, descriptive filename for a notebook based on its content.

    The name should:
    - Be a valid filename (no special characters except hyphens and underscores)
    - Be lowercase with hyphens between words (kebab-case)
    - Be concise (2-5 words, max 50 characters)
    - Capture the essence or main topic of the document
    - NOT include the .md extension (that will be added separately)

    Examples of good names:
    - "meeting-notes-q4-planning"
    - "react-hooks-tutorial"
    - "api-design-thoughts"
    - "weekly-standup-dec-15"
    - "debugging-memory-leak"

    If the content is too short or unclear, suggest a generic but contextual name
    like "untitled-notes" or "draft-thoughts".
    """

    document: str = dspy.InputField(
        desc="The notebook content to analyze for naming"
    )
    current_name: str = dspy.InputField(
        desc="The current filename (may be 'Untitled' or generic)",
        default="Untitled"
    )
    name: str = dspy.OutputField(
        desc="A short, descriptive kebab-case filename (without .md extension)"
    )
