"""
mrmd CLI - Markdown that runs.

Usage:
    mrmd serve [--port PORT] [--host HOST] [--ai-port PORT] [--no-ai]
    mrmd run FILE [--juice LEVEL] [--output FILE]
    mrmd --version

Juice Levels:
    0 = ⚡ Quick (Kimi K2) - Fast & cheap
    1 = ⚖️ Balanced (Sonnet 4.5) - Good quality
    2 = 🧠 Deep (Gemini 3 thinking) - Thorough reasoning
    3 = 🚀 Maximum (Opus 4.5 thinking) - Best single model
    4 = 🔥 Ultimate (Multi-model merger) - All models synthesized
"""

import os
import click

from .. import __version__


# Juice level descriptions
JUICE_LEVELS = {
    0: ("⚡", "Quick", "Kimi K2 on Groq"),
    1: ("⚖️", "Balanced", "Claude Sonnet 4.5"),
    2: ("🧠", "Deep", "Gemini 3 with thinking"),
    3: ("🚀", "Maximum", "Opus 4.5 with high thinking"),
    4: ("🔥", "Ultimate", "Grok+Sonnet+Gemini+Opus merged"),
}


def get_default_juice() -> int:
    """Get default juice level from environment or config."""
    return int(os.environ.get("MRMD_JUICE_LEVEL", "0"))


@click.group()
@click.version_option(version=__version__, prog_name="mrmd")
def main():
    """mrmd - Markdown that runs.

    AI-native literate programming by Maxime Rivest.
    """
    pass


def ensure_editor_browser_bundle():
    """Build the browser bundle if it doesn't exist."""
    import subprocess
    from pathlib import Path

    # Find editor directory
    pkg_dir = Path(__file__).parent.parent.parent.parent
    editor_dir = pkg_dir / "editor"
    browser_bundle = editor_dir / "dist" / "index.browser.js"

    if browser_bundle.exists():
        return  # Already built

    if not (editor_dir / "package.json").exists():
        return  # Not in dev environment

    click.echo("  [Editor] Building browser bundle...")
    try:
        result = subprocess.run(
            ["pnpm", "run", "build:browser"],
            cwd=editor_dir,
            capture_output=True,
            text=True,
        )
        if result.returncode == 0:
            click.echo("  [Editor] Browser bundle built successfully")
        else:
            click.echo(f"  [Editor] Build failed: {result.stderr}", err=True)
    except FileNotFoundError:
        click.echo("  [Editor] pnpm not found, skipping browser bundle build", err=True)


@main.command()
@click.option("--port", "-p", default=51789, help="Port to listen on")
@click.option("--host", "-h", default="localhost", help="Host to bind to")
@click.option("--ai-port", default=51790, help="Port for AI server (dspy-cli)")
@click.option("--no-ai", is_flag=True, help="Don't start the AI server")
def serve(port: int, host: str, ai_port: int, no_ai: bool):
    """Start the mrmd server."""
    ensure_editor_browser_bundle()
    from ..server.app import run_server
    run_server(host=host, port=port, ai_port=ai_port, start_ai=not no_ai)


@main.command()
@click.argument("file", type=click.Path(exists=True))
@click.option(
    "--juice", "-j",
    type=click.IntRange(0, 4),
    default=None,
    help="Juice level 0-4 (quality/cost tradeoff). Default: $MRMD_JUICE_LEVEL or 0"
)
@click.option("--output", "-o", type=click.Path(), help="Output file for results")
@click.option("--verbose", "-v", is_flag=True, help="Show detailed output")
def run(file: str, juice: int | None, output: str | None, verbose: bool):
    """Execute a markdown file with AI.

    The entire markdown file is sent to the LLM based on the juice level.
    Higher juice = better quality but slower and more expensive.

    \b
    Juice Levels:
      0 = ⚡ Quick (Kimi K2) - Fast & cheap
      1 = ⚖️ Balanced (Sonnet 4.5) - Good quality
      2 = 🧠 Deep (Gemini 3 thinking) - Thorough reasoning
      3 = 🚀 Maximum (Opus 4.5 thinking) - Best single model
      4 = 🔥 Ultimate (Multi-model merger) - All models synthesized
    """
    from ..runner import run_markdown_file

    # Use provided juice or get default
    juice_level = juice if juice is not None else get_default_juice()
    emoji, name, model = JUICE_LEVELS[juice_level]

    click.echo(f"{emoji} Running {file} with juice level {juice_level} ({name} - {model})")

    try:
        result = run_markdown_file(file, juice=juice_level, verbose=verbose)

        if output:
            with open(output, "w") as f:
                f.write(result)
            click.echo(f"✓ Output written to {output}")
        else:
            click.echo("\n" + "=" * 60)
            click.echo(result)
            click.echo("=" * 60)

    except Exception as e:
        click.echo(f"✗ Error: {e}", err=True)
        raise SystemExit(1)


@main.command()
def juice():
    """Show available juice levels."""
    click.echo("Juice Levels - Quality/Cost Tradeoff\n")
    for level, (emoji, name, model) in JUICE_LEVELS.items():
        default = " (default)" if level == get_default_juice() else ""
        click.echo(f"  {level} = {emoji} {name}: {model}{default}")
    click.echo("\nSet default: export MRMD_JUICE_LEVEL=<level>")
    click.echo("Or use: mrmd run --juice <level> <file>")


if __name__ == "__main__":
    main()
