"""Notebook-related AI modules."""

import dspy
from ..signatures.notebook import NotebookNameSignature


class NotebookNamePredict(dspy.Module):
    """Generate a descriptive name for a notebook based on its content."""

    def __init__(self):
        super().__init__()
        self.predict = dspy.Predict(NotebookNameSignature)

    def forward(self, document: str, current_name: str = "Untitled"):
        return self.predict(document=document, current_name=current_name)
