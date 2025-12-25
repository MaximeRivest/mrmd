"""Correct-and-finish modules - fix errors then complete."""

import dspy
from typing import Optional

from mrmd_ai.signatures.correct import (
    CorrectAndFinishLineSignature,
    CorrectAndFinishSectionSignature,
)


class CorrectAndFinishLinePredict(dspy.Module):
    """Correct errors in the current line and complete it."""

    def __init__(self):
        super().__init__()
        self.predictor = dspy.Predict(CorrectAndFinishLineSignature)

    def forward(
        self,
        text_to_fix: str,
        content_type: str,
        local_context: str,
        document_context: Optional[str] = None,
    ) -> dspy.Prediction:
        return self.predictor(
            document_context=document_context,
            local_context=local_context,
            text_to_fix=text_to_fix,
            content_type=content_type,
        )


class CorrectAndFinishSectionPredict(dspy.Module):
    """Correct errors in the current section and complete it."""

    def __init__(self):
        super().__init__()
        self.predictor = dspy.Predict(CorrectAndFinishSectionSignature)

    def forward(
        self,
        text_to_fix: str,
        content_type: str,
        local_context: str,
        document_context: Optional[str] = None,
    ) -> dspy.Prediction:
        return self.predictor(
            document_context=document_context,
            local_context=local_context,
            text_to_fix=text_to_fix,
            content_type=content_type,
        )
