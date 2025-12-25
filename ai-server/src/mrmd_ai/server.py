"""
MRMD AI Server - Custom server with Juice Level support.

Replaces dspy-cli with a FastAPI server that supports juice levels
for progressive quality/cost tradeoff.
"""

import os
import sys
import asyncio
from concurrent.futures import ThreadPoolExecutor
from typing import Any
from contextlib import asynccontextmanager

import dspy
from fastapi import FastAPI, Request, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
import uvicorn
import json

# Thread pool for running blocking DSPy calls
_executor = ThreadPoolExecutor(max_workers=10)

from .juice import JuiceLevel, JuicedProgram, get_lm, JUICE_MODELS
from .modules import (
    # Finish
    FinishSentencePredict,
    FinishParagraphPredict,
    FinishCodeLinePredict,
    FinishCodeSectionPredict,
    # Fix
    FixGrammarPredict,
    FixTranscriptionPredict,
    # Correct
    CorrectAndFinishLinePredict,
    CorrectAndFinishSectionPredict,
    # Code
    DocumentCodePredict,
    CompleteCodePredict,
    AddTypeHintsPredict,
    ImproveNamesPredict,
    ExplainCodePredict,
    RefactorCodePredict,
    FormatCodePredict,
    ProgramCodePredict,
    # Text
    GetSynonymsPredict,
    GetPhraseSynonymsPredict,
    ReformatMarkdownPredict,
    IdentifyReplacementPredict,
    # Document
    DocumentResponsePredict,
    DocumentSummaryPredict,
    DocumentAnalysisPredict,
    # Notebook
    NotebookNamePredict,
)


# Program registry - maps program names to their classes
PROGRAMS = {
    # Finish
    "FinishSentencePredict": FinishSentencePredict,
    "FinishParagraphPredict": FinishParagraphPredict,
    "FinishCodeLinePredict": FinishCodeLinePredict,
    "FinishCodeSectionPredict": FinishCodeSectionPredict,
    # Fix
    "FixGrammarPredict": FixGrammarPredict,
    "FixTranscriptionPredict": FixTranscriptionPredict,
    # Correct
    "CorrectAndFinishLinePredict": CorrectAndFinishLinePredict,
    "CorrectAndFinishSectionPredict": CorrectAndFinishSectionPredict,
    # Code
    "DocumentCodePredict": DocumentCodePredict,
    "CompleteCodePredict": CompleteCodePredict,
    "AddTypeHintsPredict": AddTypeHintsPredict,
    "ImproveNamesPredict": ImproveNamesPredict,
    "ExplainCodePredict": ExplainCodePredict,
    "RefactorCodePredict": RefactorCodePredict,
    "FormatCodePredict": FormatCodePredict,
    "ProgramCodePredict": ProgramCodePredict,
    # Text
    "GetSynonymsPredict": GetSynonymsPredict,
    "GetPhraseSynonymsPredict": GetPhraseSynonymsPredict,
    "ReformatMarkdownPredict": ReformatMarkdownPredict,
    "IdentifyReplacementPredict": IdentifyReplacementPredict,
    # Document
    "DocumentResponsePredict": DocumentResponsePredict,
    "DocumentSummaryPredict": DocumentSummaryPredict,
    "DocumentAnalysisPredict": DocumentAnalysisPredict,
    # Notebook
    "NotebookNamePredict": NotebookNamePredict,
}

# Cached program instances per juice level
_program_cache: dict[tuple[str, int], JuicedProgram] = {}


def get_program(name: str, juice: int = 0) -> JuicedProgram:
    """Get a JuicedProgram instance for the given program and juice level."""
    cache_key = (name, juice)
    if cache_key not in _program_cache:
        if name not in PROGRAMS:
            raise ValueError(f"Unknown program: {name}")
        program_class = PROGRAMS[name]
        program = program_class()
        _program_cache[cache_key] = JuicedProgram(program, juice=juice)
    return _program_cache[cache_key]


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Application lifespan - configure default LM on startup."""
    # Configure default LM (juice level 0)
    default_lm = get_lm(JuiceLevel.QUICK)
    dspy.configure(lm=default_lm)
    print(f"[AI Server] Configured default LM: {JUICE_MODELS[JuiceLevel.QUICK].model}")
    yield
    print("[AI Server] Shutting down...")


# Create FastAPI app
app = FastAPI(
    title="MRMD AI Server",
    description="AI server with Juice Level support for progressive quality/cost tradeoff",
    version="1.0.0",
    lifespan=lifespan,
)

# Add CORS middleware
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/programs")
async def list_programs():
    """List available programs."""
    programs = []
    for name, cls in PROGRAMS.items():
        programs.append({
            "name": name,
            "endpoint": f"/{name}",
        })
    return {"programs": programs}


@app.get("/juice")
async def get_juice_levels():
    """Get available juice levels."""
    from .juice import JUICE_DESCRIPTIONS
    return {
        "levels": [
            {"level": level.value, "description": desc}
            for level, desc in JUICE_DESCRIPTIONS.items()
        ]
    }


def extract_result(prediction: Any) -> dict:
    """Extract result from a DSPy prediction object."""
    result = {}

    if hasattr(prediction, "synthesized_response"):
        # Ultimate level returns synthesized response
        result["synthesized_response"] = prediction.synthesized_response

    # DSPy Prediction objects store outputs in _store
    if hasattr(prediction, "_store") and prediction._store:
        result.update(dict(prediction._store))
    else:
        # Fallback: try direct attribute access
        output_fields = [
            "synonyms", "original", "alternatives",
            "completion", "fixed_text", "corrected_completion",
            "documented_code", "typed_code", "improved_code",
            "explained_code", "refactored_code", "formatted_code",
            "reformatted_text", "text_to_replace", "replacement",
            "response", "summary", "analysis",  # Document-level fields
            "code",  # ProgramCodePredict output
        ]

        for field in output_fields:
            if hasattr(prediction, field):
                val = getattr(prediction, field)
                if val is not None:
                    result[field] = val

    # Include individual model responses for Ultimate level (juice=4)
    if hasattr(prediction, "_individual_responses"):
        result["_individual_responses"] = prediction._individual_responses

    return result


@app.post("/{program_name}")
async def run_program(program_name: str, request: Request):
    """Run a program with the given parameters."""
    # Get juice level from header
    juice_header = request.headers.get("X-Juice-Level", "0")
    try:
        juice_level = int(juice_header)
        juice_level = max(0, min(4, juice_level))  # Clamp to 0-4
    except ValueError:
        juice_level = 0

    # Get request body
    try:
        params = await request.json()
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid JSON body")

    # Get program
    try:
        juiced_program = get_program(program_name, juice_level)
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))

    # Log the call and get model info
    from .juice import JUICE_DESCRIPTIONS, JUICE_MODELS, ULTIMATE_MODELS, JuiceLevel
    juice_desc = JUICE_DESCRIPTIONS.get(JuiceLevel(juice_level), f"Level {juice_level}")
    print(f"[AI] {program_name} @ {juice_desc}", flush=True)

    # Get the model name for this juice level
    if juice_level == JuiceLevel.ULTIMATE:
        model_name = "multi-model"  # Ultimate uses multiple models
    else:
        model_config = JUICE_MODELS.get(JuiceLevel(juice_level))
        model_name = model_config.model if model_config else "unknown"

    # Run program in thread pool (DSPy calls are blocking)
    def run_sync():
        return juiced_program(**params)

    try:
        loop = asyncio.get_event_loop()
        result = await loop.run_in_executor(_executor, run_sync)
        response = extract_result(result)
        # Add model metadata to response
        response["_model"] = model_name
        response["_juice_level"] = juice_level
        return response
    except Exception as e:
        import traceback
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=str(e))


def sse_event(event: str, data: dict) -> str:
    """Format a Server-Sent Event."""
    return f"event: {event}\ndata: {json.dumps(data)}\n\n"


@app.post("/{program_name}/stream")
async def run_program_stream(program_name: str, request: Request):
    """Run a program with SSE streaming for status updates.

    Emits events:
    - status: Progress updates (step, model, etc.)
    - model_complete: When a model finishes (for ultimate mode)
    - result: Final result
    - error: If an error occurs
    """
    # Get juice level from header
    juice_header = request.headers.get("X-Juice-Level", "0")
    try:
        juice_level = int(juice_header)
        juice_level = max(0, min(4, juice_level))  # Clamp to 0-4
    except ValueError:
        juice_level = 0

    # Get request body
    try:
        params = await request.json()
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid JSON body")

    # Check program exists
    if program_name not in PROGRAMS:
        raise HTTPException(status_code=404, detail=f"Unknown program: {program_name}")

    # Get model info
    from .juice import JUICE_DESCRIPTIONS, JUICE_MODELS, ULTIMATE_MODELS, JuiceLevel, JuicedProgram
    juice_desc = JUICE_DESCRIPTIONS.get(JuiceLevel(juice_level), f"Level {juice_level}")
    print(f"[AI Stream] {program_name} @ {juice_desc}", flush=True)

    # Get model name(s) for display
    if juice_level == JuiceLevel.ULTIMATE:
        model_name = "multi-model"
        model_names = [cfg.model.split("/")[-1] for cfg in ULTIMATE_MODELS]
    else:
        model_config = JUICE_MODELS.get(JuiceLevel(juice_level))
        model_name = model_config.model if model_config else "unknown"
        model_names = [model_name.split("/")[-1] if "/" in model_name else model_name]

    async def event_generator():
        """Generate SSE events for the AI call."""
        import queue
        import threading

        # Queue for progress events from the sync execution
        progress_queue = queue.Queue()
        result_holder = {"result": None, "error": None}

        def progress_callback(event_type: str, data: dict):
            """Called by JuicedProgram to report progress."""
            progress_queue.put((event_type, data))

        def run_with_progress():
            """Run the program in a thread, emitting progress events."""
            try:
                # Create program with progress callback
                program_class = PROGRAMS[program_name]
                program = program_class()
                juiced = JuicedProgram(program, juice=juice_level, progress_callback=progress_callback)

                # Emit starting event
                progress_callback("status", {
                    "step": "starting",
                    "model": model_name,
                    "juice_level": juice_level,
                    "juice_name": juice_desc
                })

                # Run the program
                result = juiced(**params)
                result_holder["result"] = result

                # Signal completion
                progress_queue.put(("done", None))

            except Exception as e:
                import traceback
                traceback.print_exc()
                result_holder["error"] = str(e)
                progress_queue.put(("error", {"message": str(e)}))

        # Start execution in thread
        thread = threading.Thread(target=run_with_progress)
        thread.start()

        # Stream progress events
        while True:
            try:
                # Wait for events with timeout to allow checking if thread is done
                event_type, data = progress_queue.get(timeout=0.1)

                if event_type == "done":
                    # Send final result
                    if result_holder["result"] is not None:
                        response = extract_result(result_holder["result"])
                        response["_model"] = model_name
                        response["_juice_level"] = juice_level
                        yield sse_event("result", response)
                    break

                elif event_type == "error":
                    yield sse_event("error", data)
                    break

                else:
                    # Status or model_complete event
                    yield sse_event(event_type, data)

            except queue.Empty:
                # Check if thread is still running
                if not thread.is_alive():
                    # Thread finished but didn't put done event - check for error
                    if result_holder["error"]:
                        yield sse_event("error", {"message": result_holder["error"]})
                    break
                continue

        thread.join(timeout=1.0)

    return StreamingResponse(
        event_generator(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",  # Disable nginx buffering
        }
    )


def main():
    """Run the AI server."""
    import argparse
    parser = argparse.ArgumentParser(description="MRMD AI Server")
    parser.add_argument("--host", default="127.0.0.1", help="Host to bind to")
    parser.add_argument("--port", type=int, default=51790, help="Port to listen on")
    parser.add_argument("--reload", action="store_true", help="Enable auto-reload")
    args = parser.parse_args()

    print(f"""
╔══════════════════════════════════════════╗
║          MRMD AI Server                  ║
║     with Juice Level Support             ║
╚══════════════════════════════════════════╝

  URL:  http://{args.host}:{args.port}/

  Juice Levels:
    0 = ⚡ Quick (Grok 4.1)
    1 = ⚖️ Balanced (Sonnet 4.5)
    2 = 🧠 Deep (Gemini 3 thinking)
    3 = 🚀 Maximum (Opus 4.5 thinking)
    4 = 🔥 Ultimate (Multi-model merger)

  Press Ctrl+C to stop
""")

    uvicorn.run(
        "mrmd_ai.server:app",
        host=args.host,
        port=args.port,
        reload=args.reload,
    )


if __name__ == "__main__":
    main()
