"""Text transformation modules."""

import dspy
from ..signatures.text import (
    GetSynonymsSignature,
    GetPhraseSynonymsSignature,
    ReformatMarkdownSignature,
    IdentifyReplacementSignature,
)


class GetSynonymsPredict(dspy.Module):
    """Find synonyms for a single word."""

    def __init__(self):
        super().__init__()
        self.predict = dspy.Predict(GetSynonymsSignature)

    def forward(self, text: str, local_context: str, document_context: str = None):
        return self.predict(
            text=text,
            local_context=local_context,
            document_context=document_context,
        )


class GetPhraseSynonymsPredict(dspy.Module):
    """Find alternative phrases for multi-word expressions."""

    def __init__(self):
        super().__init__()
        self.predict = dspy.Predict(GetPhraseSynonymsSignature)

    def forward(self, phrase: str, local_context: str, document_context: str = None):
        return self.predict(
            phrase=phrase,
            local_context=local_context,
            document_context=document_context,
        )


class ReformatMarkdownPredict(dspy.Module):
    """Clean up and reformat markdown text."""

    def __init__(self):
        super().__init__()
        self.predict = dspy.Predict(ReformatMarkdownSignature)

    def forward(self, text: str, local_context: str, document_context: str = None):
        return self.predict(
            text=text,
            local_context=local_context,
            document_context=document_context,
        )


class IdentifyReplacementPredict(dspy.Module):
    """Identify exact phrase to replace for synonym application."""

    def __init__(self):
        super().__init__()
        self.predict = dspy.Predict(IdentifyReplacementSignature)

    def forward(self, original_word: str, chosen_synonym: str, context: str):
        return self.predict(
            original_word=original_word,
            chosen_synonym=chosen_synonym,
            context=context,
        )
