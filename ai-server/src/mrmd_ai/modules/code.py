"""Code transformation modules."""

import dspy
from ..signatures.code import (
    DocumentCodeSignature,
    CompleteCodeSignature,
    AddTypeHintsSignature,
    ImproveNamesSignature,
    ExplainCodeSignature,
    RefactorCodeSignature,
    FormatCodeSignature,
    ProgramCodeSignature,
)


class DocumentCodePredict(dspy.Module):
    """Add documentation to code."""

    def __init__(self):
        super().__init__()
        self.predict = dspy.Predict(DocumentCodeSignature)

    def forward(self, code: str, language: str, local_context: str, document_context: str = None):
        return self.predict(
            code=code,
            language=language,
            local_context=local_context,
            document_context=document_context,
        )


class CompleteCodePredict(dspy.Module):
    """Complete incomplete code."""

    def __init__(self):
        super().__init__()
        self.predict = dspy.Predict(CompleteCodeSignature)

    def forward(self, code: str, language: str, local_context: str, document_context: str = None):
        return self.predict(
            code=code,
            language=language,
            local_context=local_context,
            document_context=document_context,
        )


class AddTypeHintsPredict(dspy.Module):
    """Add type hints to code."""

    def __init__(self):
        super().__init__()
        self.predict = dspy.Predict(AddTypeHintsSignature)

    def forward(self, code: str, language: str, local_context: str, document_context: str = None):
        return self.predict(
            code=code,
            language=language,
            local_context=local_context,
            document_context=document_context,
        )


class ImproveNamesPredict(dspy.Module):
    """Improve variable and function names."""

    def __init__(self):
        super().__init__()
        self.predict = dspy.Predict(ImproveNamesSignature)

    def forward(self, code: str, language: str, local_context: str, document_context: str = None):
        return self.predict(
            code=code,
            language=language,
            local_context=local_context,
            document_context=document_context,
        )


class ExplainCodePredict(dspy.Module):
    """Add explanatory comments to code."""

    def __init__(self):
        super().__init__()
        self.predict = dspy.Predict(ExplainCodeSignature)

    def forward(self, code: str, language: str, local_context: str, document_context: str = None):
        return self.predict(
            code=code,
            language=language,
            local_context=local_context,
            document_context=document_context,
        )


class RefactorCodePredict(dspy.Module):
    """Refactor and simplify code."""

    def __init__(self):
        super().__init__()
        self.predict = dspy.Predict(RefactorCodeSignature)

    def forward(self, code: str, language: str, local_context: str, document_context: str = None):
        return self.predict(
            code=code,
            language=language,
            local_context=local_context,
            document_context=document_context,
        )


class FormatCodePredict(dspy.Module):
    """Format and prettify code."""

    def __init__(self):
        super().__init__()
        self.predict = dspy.Predict(FormatCodeSignature)

    def forward(self, code: str, language: str, local_context: str, document_context: str = None):
        return self.predict(
            code=code,
            language=language,
            local_context=local_context,
            document_context=document_context,
        )


class ProgramCodePredict(dspy.Module):
    """Transform pseudo-code into real code."""

    def __init__(self):
        super().__init__()
        self.predict = dspy.Predict(ProgramCodeSignature)

    def forward(self, pseudo_code: str, language: str, local_context: str, document_context: str = None):
        return self.predict(
            pseudo_code=pseudo_code,
            language=language,
            local_context=local_context,
            document_context=document_context,
        )
