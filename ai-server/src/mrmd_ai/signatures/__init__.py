"""DSPy signature definitions for MRMD AI programs."""

from .finish import (
    FinishSentenceSignature,
    FinishParagraphSignature,
    FinishCodeLineSignature,
    FinishCodeSectionSignature,
)
from .fix import (
    FixGrammarSignature,
    FixTranscriptionSignature,
)
from .correct import (
    CorrectAndFinishLineSignature,
    CorrectAndFinishSectionSignature,
)

__all__ = [
    "FinishSentenceSignature",
    "FinishParagraphSignature",
    "FinishCodeLineSignature",
    "FinishCodeSectionSignature",
    "FixGrammarSignature",
    "FixTranscriptionSignature",
    "CorrectAndFinishLineSignature",
    "CorrectAndFinishSectionSignature",
]
