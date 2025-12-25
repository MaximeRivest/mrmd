# MRMD AI Server

AI programs for the MRMD editor using DSPy.

## Programs

### Finish (Completion)
- `FinishSentencePredict` - Complete the current sentence
- `FinishParagraphPredict` - Complete the current paragraph
- `FinishCodeLinePredict` - Complete the current code line
- `FinishCodeSectionPredict` - Complete the current code section

### Fix (Correction)
- `FixGrammarPredict` - Fix grammar/spelling errors
- `FixTranscriptionPredict` - Fix speech-to-text errors

### Correct & Finish
- `CorrectAndFinishLinePredict` - Correct and complete current line
- `CorrectAndFinishSectionPredict` - Correct and complete current section

## Running

```bash
cd ai-server
uv run dspy-cli serve --port 8766
```

## Configuration

API keys are read from environment variables:
- `ANTHROPIC_API_KEY`
- `OPENAI_API_KEY`

See `dspy.config.yaml` for model configuration.
