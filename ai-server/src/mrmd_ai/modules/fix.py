"""Fix modules - grammar and transcription correction."""

import dspy
from typing import Optional

from mrmd_ai.signatures.fix import (
    FixGrammarSignature,
    FixTranscriptionSignature,
)


class FixGrammarPredict(dspy.Module):
    """Fix grammar, spelling, and punctuation errors."""

    def __init__(self):
        super().__init__()
        self.predictor = dspy.Predict(FixGrammarSignature)

    def forward(
        self,
        text_to_fix: str,
        local_context: str,
        document_context: Optional[str] = None,
    ) -> dspy.Prediction:
        return self.predictor(
            document_context=document_context,
            local_context=local_context,
            text_to_fix=text_to_fix,
        )


class FixTranscriptionPredict(dspy.Module):
    """Fix speech-to-text transcription errors."""

    def __init__(self):
        super().__init__()
        self.predictor = dspy.Predict(FixTranscriptionSignature)

    def forward(
        self,
        text_to_fix: str,
        local_context: str,
        document_context: Optional[str] = None,
    ) -> dspy.Prediction:
        return self.predictor(
            document_context=document_context,
            local_context=local_context,
            text_to_fix=text_to_fix,
        )
