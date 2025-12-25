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
        print(f"[FixGrammar] Input: {repr(text_to_fix[:100])}", flush=True)
        result = self.predictor(
            document_context=document_context,
            local_context=local_context,
            text_to_fix=text_to_fix,
        )
        print(f"[FixGrammar] Output: {repr(result.fixed_text[:100] if hasattr(result, 'fixed_text') else 'NO fixed_text')}", flush=True)
        return result


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
