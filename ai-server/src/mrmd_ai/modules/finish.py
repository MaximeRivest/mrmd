"""Finish/completion modules - complete sentences, paragraphs, and code."""

import dspy
from typing import Optional

from mrmd_ai.signatures.finish import (
    FinishSentenceSignature,
    FinishParagraphSignature,
    FinishCodeLineSignature,
    FinishCodeSectionSignature,
)


class FinishSentencePredict(dspy.Module):
    """Complete the current sentence naturally."""

    def __init__(self):
        super().__init__()
        self.predictor = dspy.Predict(FinishSentenceSignature)

    def forward(
        self,
        text_before_cursor: str,
        local_context: str,
        document_context: Optional[str] = None,
    ) -> dspy.Prediction:
        return self.predictor(
            document_context=document_context,
            local_context=local_context,
            text_before_cursor=text_before_cursor,
        )


class FinishParagraphPredict(dspy.Module):
    """Complete the current paragraph naturally."""

    def __init__(self):
        super().__init__()
        self.predictor = dspy.Predict(FinishParagraphSignature)

    def forward(
        self,
        text_before_cursor: str,
        local_context: str,
        document_context: Optional[str] = None,
    ) -> dspy.Prediction:
        return self.predictor(
            document_context=document_context,
            local_context=local_context,
            text_before_cursor=text_before_cursor,
        )


class FinishCodeLinePredict(dspy.Module):
    """Complete the current line of code."""

    def __init__(self):
        super().__init__()
        self.predictor = dspy.Predict(FinishCodeLineSignature)

    def forward(
        self,
        code_before_cursor: str,
        language: str,
        local_context: str,
        document_context: Optional[str] = None,
    ) -> dspy.Prediction:
        return self.predictor(
            document_context=document_context,
            local_context=local_context,
            code_before_cursor=code_before_cursor,
            language=language,
        )


class FinishCodeSectionPredict(dspy.Module):
    """Complete the current code section (function, class, block)."""

    def __init__(self):
        super().__init__()
        self.predictor = dspy.Predict(FinishCodeSectionSignature)

    def forward(
        self,
        code_before_cursor: str,
        language: str,
        local_context: str,
        document_context: Optional[str] = None,
    ) -> dspy.Prediction:
        return self.predictor(
            document_context=document_context,
            local_context=local_context,
            code_before_cursor=code_before_cursor,
            language=language,
        )
