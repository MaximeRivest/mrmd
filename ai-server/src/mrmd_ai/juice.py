"""
Juice Level System for MRMD AI Programs.

Juice levels control the quality/cost tradeoff of AI responses:
- Level 0: Kimi K2 on Groq (fast, cheap, default)
- Level 1: Claude Sonnet 4.5 (better quality)
- Level 2: Gemini 3 Pro with thinking (deep reasoning)
- Level 3: Claude Opus 4.5 with high thinking (maximum single-model quality)
- Level 4: Multi-model merger (Grok 4 + Sonnet 4.5 + Gemini 3 + Opus 4.5, synthesized by Gemini 3)
"""

from enum import IntEnum
from typing import Any, Callable
from dataclasses import dataclass, field
import dspy


class JuiceLevel(IntEnum):
    """Progressive quality levels for AI responses."""

    # Fast & cheap - Kimi K2 on Groq
    QUICK = 0

    # Better quality - Sonnet 4.5
    BALANCED = 1

    # Deep reasoning - Gemini 3 with thinking
    DEEP = 2

    # Maximum single-model - Opus 4.5 with high thinking
    MAXIMUM = 3

    # Multi-model merger - all models synthesized
    ULTIMATE = 4


@dataclass
class ModelConfig:
    """Configuration for a model at a specific juice level."""
    model: str
    temperature: float = 0.7
    max_tokens: int = 4096
    reasoning_effort: str | None = None
    thinking: dict | None = None
    extra_kwargs: dict = field(default_factory=dict)

    def to_lm_kwargs(self) -> dict:
        """Convert to dspy.LM kwargs."""
        kwargs = {
            "model": self.model,
            "temperature": self.temperature,
            "max_tokens": self.max_tokens,
            **self.extra_kwargs,
        }
        if self.reasoning_effort:
            kwargs["reasoning_effort"] = self.reasoning_effort
        if self.thinking:
            kwargs["thinking"] = self.thinking
        return kwargs


# Model configurations for each juice level
JUICE_MODELS: dict[JuiceLevel, ModelConfig] = {
    JuiceLevel.QUICK: ModelConfig(
        model="groq/moonshotai/kimi-k2-instruct-0905",
        temperature=0.7,
        max_tokens=4096,
    ),
    JuiceLevel.BALANCED: ModelConfig(
        model="anthropic/claude-sonnet-4-5",
        temperature=0.7,
        max_tokens=4096,
    ),
    JuiceLevel.DEEP: ModelConfig(
        model="gemini/gemini-3-pro-preview",
        temperature=1.0,
        max_tokens=16000,
        reasoning_effort="high",
    ),
    JuiceLevel.MAXIMUM: ModelConfig(
        model="anthropic/claude-opus-4-5",
        temperature=1.0,
        max_tokens=16000,
        reasoning_effort="high",
    ),
}

# For ULTIMATE level, we use all 4 models with highest thinking
# Grok 4, GPT-5.1, Gemini 3, Opus 4.5
# NOTE: Anthropic requires temperature=1 when using extended thinking
ULTIMATE_MODELS: list[ModelConfig] = [
    ModelConfig(
        model="openrouter/x-ai/grok-4",
        temperature=0.7,
        max_tokens=8192,
    ),
    ModelConfig(
        model="openai/gpt-5.1",
        temperature=1.0,
        max_tokens=16000,
        reasoning_effort="high",
    ),
    ModelConfig(
        model="gemini/gemini-3-pro-preview",
        temperature=1.0,
        max_tokens=16000,
        reasoning_effort="high",
    ),
    ModelConfig(
        model="anthropic/claude-opus-4-5",
        temperature=1.0,  # Must be 1 for extended thinking
        max_tokens=16000,
        reasoning_effort="high",
    ),
]

# Synthesizer model for ULTIMATE level (Gemini 3 synthesizes all responses)
SYNTHESIZER_MODEL = ModelConfig(
    model="gemini/gemini-3-pro-preview",
    temperature=0.7,
    max_tokens=32000,
    reasoning_effort="high",
)


def get_lm(juice: JuiceLevel | int = JuiceLevel.QUICK) -> dspy.LM:
    """Get a dspy.LM configured for the specified juice level.

    Args:
        juice: Juice level (0-3). Level 4 (ULTIMATE) requires special handling.

    Returns:
        Configured dspy.LM instance.
    """
    if isinstance(juice, int):
        juice = JuiceLevel(juice)

    if juice == JuiceLevel.ULTIMATE:
        raise ValueError("ULTIMATE juice level requires multi-model merger. Use JuicedProgram instead.")

    config = JUICE_MODELS[juice]
    return dspy.LM(**config.to_lm_kwargs())


class SynthesizeResponses(dspy.Signature):
    """Synthesize multiple AI model responses into an optimal final answer.

    You are given the original input and responses from multiple AI models.
    Analyze all responses, identify the best insights from each, resolve
    any contradictions, and produce the ultimate synthesized response.
    """

    original_input: str = dspy.InputField(desc="The original input/question")
    model_responses: str = dspy.InputField(desc="Responses from multiple AI models, labeled by model name")
    synthesized_response: str = dspy.OutputField(desc="The optimal synthesized response combining the best from all models")


class JuicedProgram:
    """Wrapper that runs any DSPy program with configurable juice levels.

    For levels 0-3, uses a single model with increasing capability.
    For level 4 (ULTIMATE), runs all models in parallel and synthesizes.
    """

    def __init__(
        self,
        program: dspy.Module,
        juice: JuiceLevel | int = JuiceLevel.QUICK,
        progress_callback: Callable[[str, dict], None] | None = None
    ):
        """Initialize a juiced program.

        Args:
            program: The DSPy program/module to wrap.
            juice: Juice level (0-4).
            progress_callback: Optional callback for progress events.
                              Called with (event_type, data) where event_type is:
                              - "status": General status update
                              - "model_start": A model is starting (ultimate mode)
                              - "model_complete": A model finished (ultimate mode)
        """
        self.program = program
        self.juice = JuiceLevel(juice) if isinstance(juice, int) else juice
        self.progress_callback = progress_callback

    def _emit(self, event_type: str, data: dict):
        """Emit a progress event if callback is set."""
        if self.progress_callback:
            self.progress_callback(event_type, data)

    def __call__(self, **kwargs) -> Any:
        """Run the program with the configured juice level."""
        if self.juice == JuiceLevel.ULTIMATE:
            return self._run_ultimate(**kwargs)
        else:
            return self._run_single(**kwargs)

    def _run_single(self, **kwargs) -> Any:
        """Run with a single model at the specified juice level."""
        config = JUICE_MODELS[self.juice]
        model_name = config.model.split("/")[-1]

        self._emit("status", {
            "step": "calling_model",
            "model": model_name,
            "model_full": config.model
        })

        lm = get_lm(self.juice)
        with dspy.context(lm=lm):
            result = self.program(**kwargs)

        self._emit("status", {
            "step": "model_complete",
            "model": model_name
        })

        return result

    def _run_ultimate(self, **kwargs) -> Any:
        """Run with all models in PARALLEL and merge results."""
        from concurrent.futures import ThreadPoolExecutor, as_completed
        import threading

        # Track which models are running
        model_names = [cfg.model.split("/")[-1] for cfg in ULTIMATE_MODELS]
        models_status = {name: "pending" for name in model_names}
        status_lock = threading.Lock()

        self._emit("status", {
            "step": "starting_multi_model",
            "models": model_names,
            "total": len(model_names)
        })

        def run_model(config):
            """Run a single model - called in parallel."""
            lm = dspy.LM(**config.to_lm_kwargs())
            model_name = config.model.split("/")[-1]

            # Emit model start
            with status_lock:
                models_status[model_name] = "running"
            self._emit("model_start", {
                "model": model_name,
                "models_status": dict(models_status)
            })

            try:
                with dspy.context(lm=lm):
                    result = self.program(**kwargs)

                # Emit model complete
                with status_lock:
                    models_status[model_name] = "complete"
                self._emit("model_complete", {
                    "model": model_name,
                    "success": True,
                    "models_status": dict(models_status)
                })

                return {"model": model_name, "result": result, "error": None}
            except Exception as e:
                # Emit model error
                with status_lock:
                    models_status[model_name] = "error"
                self._emit("model_complete", {
                    "model": model_name,
                    "success": False,
                    "error": str(e),
                    "models_status": dict(models_status)
                })
                return {"model": model_name, "result": None, "error": str(e)}

        # Run all 4 models in parallel
        model_results = []
        with ThreadPoolExecutor(max_workers=4) as executor:
            futures = [executor.submit(run_model, config) for config in ULTIMATE_MODELS]
            for future in as_completed(futures):
                model_results.append(future.result())

        # Emit synthesizing status
        self._emit("status", {
            "step": "synthesizing",
            "models_completed": len([r for r in model_results if r["result"] is not None])
        })

        # Merge results - combine outputs from all successful models
        return self._merge_results(model_results)

    def _merge_results(self, model_results: list) -> Any:
        """Merge results from multiple models into a single response.

        For list fields (like synonyms), combines unique values from all models.
        For string fields, uses the first successful result.
        Also includes individual model responses for transparency.
        """
        # Get successful results
        successful = [r for r in model_results if r["result"] is not None]
        if not successful:
            # All failed - return error
            errors = [r["error"] for r in model_results if r["error"]]
            raise RuntimeError(f"All models failed: {errors}")

        # Use first successful result as base
        base_result = successful[0]["result"]

        # Get the _store dict from the result (DSPy stores outputs there)
        if hasattr(base_result, "_store"):
            merged = dict(base_result._store)
        else:
            merged = {}

        # Collect individual responses for display
        individual_responses = []
        for r in model_results:
            model_name = r["model"]
            if r["result"] is not None and hasattr(r["result"], "_store"):
                # Extract the main output field (usually 'response', 'completion', etc.)
                store = r["result"]._store
                # Get the first string output field
                output_text = None
                for key, value in store.items():
                    if isinstance(value, str) and len(value) > 10:
                        output_text = value
                        break
                individual_responses.append({
                    "model": model_name,
                    "response": output_text or str(store),
                    "error": None
                })
            elif r["error"]:
                individual_responses.append({
                    "model": model_name,
                    "response": None,
                    "error": r["error"]
                })

        # Merge fields from other models
        for r in successful[1:]:
            result = r["result"]
            if hasattr(result, "_store"):
                store = result._store
                for key, value in store.items():
                    if key in merged:
                        # Merge lists by combining unique values
                        if isinstance(value, list) and isinstance(merged[key], list):
                            # Combine and dedupe while preserving order
                            seen = set(merged[key])
                            for item in value:
                                if item not in seen:
                                    merged[key].append(item)
                                    seen.add(item)
                        # For strings, keep the first (base) value
                    else:
                        merged[key] = value

        # Return a simple object with the merged data + individual responses
        class MergedResult:
            pass

        result = MergedResult()
        for key, value in merged.items():
            setattr(result, key, value)
        result._store = merged  # For extract_result in server.py
        result._individual_responses = individual_responses  # For UI display

        return result

    def _format_input(self, kwargs: dict) -> str:
        """Format input kwargs as a readable string."""
        parts = []
        for key, value in kwargs.items():
            parts.append(f"{key}: {value}")
        return "\n".join(parts)


def juiced(juice: JuiceLevel | int = JuiceLevel.QUICK):
    """Decorator to run a DSPy program with a specific juice level.

    Usage:
        @juiced(JuiceLevel.DEEP)
        def my_program():
            return dspy.ChainOfThought(MySignature)
    """
    def decorator(func: Callable) -> Callable:
        def wrapper(*args, **kwargs):
            program = func(*args, **kwargs)
            return JuicedProgram(program, juice)
        return wrapper
    return decorator


def run_with_juice(program: dspy.Module, juice: JuiceLevel | int, **kwargs) -> Any:
    """Convenience function to run a program with a specific juice level.

    Args:
        program: The DSPy program to run.
        juice: Juice level (0-4).
        **kwargs: Arguments to pass to the program.

    Returns:
        The program result.
    """
    juiced_program = JuicedProgram(program, juice)
    return juiced_program(**kwargs)


# Juice level descriptions for CLI/UI
JUICE_DESCRIPTIONS = {
    JuiceLevel.QUICK: "Quick (Kimi K2) - Fast & cheap",
    JuiceLevel.BALANCED: "Balanced (Sonnet 4.5) - Good quality",
    JuiceLevel.DEEP: "Deep (Gemini 3 thinking) - Thorough reasoning",
    JuiceLevel.MAXIMUM: "Maximum (Opus 4.5 thinking) - Best single model",
    JuiceLevel.ULTIMATE: "Ultimate (Multi-model merger) - All models synthesized",
}
