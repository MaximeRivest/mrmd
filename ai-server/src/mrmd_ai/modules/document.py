"""Document-level AI modules."""

import dspy
from ..signatures.document import (
    DocumentResponseSignature,
    DocumentSummarySignature,
    DocumentAnalysisSignature,
)


class DocumentResponsePredict(dspy.Module):
    """Generate a response to the document (document as prompt)."""

    def __init__(self):
        super().__init__()
        self.predict = dspy.Predict(DocumentResponseSignature)

    def forward(self, document: str):
        return self.predict(document=document)


class DocumentSummaryPredict(dspy.Module):
    """Summarize a document."""

    def __init__(self):
        super().__init__()
        self.predict = dspy.Predict(DocumentSummarySignature)

    def forward(self, document: str):
        return self.predict(document=document)


class DocumentAnalysisPredict(dspy.Module):
    """Analyze a document."""

    def __init__(self):
        super().__init__()
        self.predict = dspy.Predict(DocumentAnalysisSignature)

    def forward(self, document: str, analysis_type: str = "general"):
        return self.predict(document=document, analysis_type=analysis_type)
