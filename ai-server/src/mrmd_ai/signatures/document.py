"""Signature definitions for document-level AI programs."""

import dspy
from typing import Optional


class DocumentResponseSignature(dspy.Signature):
    """
    You are responding to a document prompt in a markdown notebook.
    The entire document serves as the prompt/context, and you generate a thoughtful response.

    Use cases:
    - Answer questions posed in the document
    - Continue a train of thought
    - Provide analysis or feedback on the content
    - Generate content based on instructions in the document

    Your response will be appended to a "# AI Response" section at the end of the document.
    Format your response in markdown. Be thorough but concise.
    """

    document: str = dspy.InputField(
        desc="The full document/notebook content serving as the prompt"
    )
    response: str = dspy.OutputField(
        desc="Your response in markdown format - thoughtful, well-structured, and relevant to the document"
    )


class DocumentSummarySignature(dspy.Signature):
    """
    Summarize a document concisely while preserving key information.
    """

    document: str = dspy.InputField(
        desc="The document to summarize"
    )
    summary: str = dspy.OutputField(
        desc="A concise summary capturing the main points and key information"
    )


class DocumentAnalysisSignature(dspy.Signature):
    """
    Analyze a document and provide insights, suggestions, or critique.
    """

    document: str = dspy.InputField(
        desc="The document to analyze"
    )
    analysis_type: str = dspy.InputField(
        desc="Type of analysis: 'structure', 'clarity', 'completeness', 'technical', or 'general'",
        default="general"
    )
    analysis: str = dspy.OutputField(
        desc="Detailed analysis with specific observations and actionable suggestions"
    )
