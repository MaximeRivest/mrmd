"""
MRMD Runner - Execute markdown files with AI.

Sends the entire markdown file to an LLM based on the juice level,
and returns the AI's response.
"""
 
# a test comment   



import sys
from pathlib import Path

# Add ai-server to path for juice imports
AI_SERVER_PATH = Path(__file__).parent.parent.parent / "ai-server" / "src"
if str(AI_SERVER_PATH) not in sys.path:
    sys.path.insert(0, str(AI_SERVER_PATH))

import dspy
from mrmd_ai.juice import JuiceLevel, JuicedProgram, get_lm, JUICE_MODELS, ULTIMATE_MODELS, SYNTHESIZER_MODEL


class RunMarkdownSignature(dspy.Signature):
    """Process and respond to a markdown document.

    You are given a markdown document that may contain instructions, questions,
    code, or other content. Analyze the document and provide an appropriate response.
    """

    markdown_content: str = dspy.InputField(desc="The full markdown document content")
    file_path: str = dspy.InputField(desc="The path to the markdown file (for context)")
    response: str = dspy.OutputField(desc="Your response to the markdown document")


class MarkdownRunner(dspy.Module):
    """DSPy module for running markdown files."""

    def __init__(self):
        super().__init__()
        self.generate = dspy.ChainOfThought(RunMarkdownSignature)

    def forward(self, markdown_content: str, file_path: str = "") -> dspy.Prediction:
        return self.generate(markdown_content=markdown_content, file_path=file_path)


def _extract_response(result) -> str:
    """Extract the response string from a DSPy prediction result."""
    return (
        result.response if hasattr(result, 'response') else
        result.synthesized_response if hasattr(result, 'synthesized_response') else
        str(result)
    )


def run_markdown_file(file_path: str, juice: int = 0, verbose: bool = False) -> str:
    """Run a markdown file with the specified juice level.

    Args:
        file_path: Path to the markdown file.
        juice: Juice level 0-4.
        verbose: Whether to print verbose output.

    Returns:
        The AI's response as a string.
    """
    path = Path(file_path)
    if not path.exists():
        raise FileNotFoundError(f"File not found: {file_path}")

    content = path.read_text()

    if verbose:
        print(f"[Juice {juice}] Processing {len(content)} characters...")

    juiced_runner = JuicedProgram(MarkdownRunner(), juice=juice)
    result = juiced_runner(markdown_content=content, file_path=str(path.absolute()))

    return _extract_response(result)


def run_markdown_content(content: str, juice: int = 0, file_path: str = "<stdin>") -> str:
    """Run markdown content directly (without reading from file).

    Args:
        content: The markdown content to process.
        juice: Juice level 0-4.
        file_path: Optional file path for context.

    Returns:
        The AI's response as a string.
    """
    juiced_runner = JuicedProgram(MarkdownRunner(), juice=juice)
    result = juiced_runner(markdown_content=content, file_path=file_path)

    return _extract_response(result) 