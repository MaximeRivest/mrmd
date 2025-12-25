"""
Frontmatter parser for mrmd documents.

Handles YAML frontmatter at the start of markdown files.
"""

from typing import Dict, Any, Optional
import re

FRONTMATTER_DELIMITER = re.compile(r'^---\s*$')


def parse_frontmatter(content: str) -> tuple[Optional[Dict[str, Any]], str]:
    """
    Parse YAML frontmatter from the start of a document.

    Returns:
        Tuple of (frontmatter_dict, remaining_content)
        frontmatter_dict is None if no frontmatter found
    """
    lines = content.split('\n')

    if not lines or not FRONTMATTER_DELIMITER.match(lines[0]):
        return None, content

    # Find closing delimiter
    for i in range(1, len(lines)):
        if FRONTMATTER_DELIMITER.match(lines[i]):
            frontmatter_text = '\n'.join(lines[1:i])
            remaining = '\n'.join(lines[i + 1:])

            try:
                import yaml
                frontmatter = yaml.safe_load(frontmatter_text)
                return frontmatter, remaining
            except ImportError:
                # YAML not available, return raw
                return {'_raw': frontmatter_text}, remaining
            except Exception:
                return {'_raw': frontmatter_text, '_error': True}, remaining

    # No closing delimiter found
    return None, content


def serialize_frontmatter(frontmatter: Dict[str, Any]) -> str:
    """
    Serialize frontmatter dict to YAML string with delimiters.

    Returns:
        String like "---\ntitle: foo\n---\n"
    """
    if not frontmatter:
        return ""

    try:
        import yaml
        yaml_str = yaml.dump(frontmatter, default_flow_style=False, sort_keys=False)
        return f"---\n{yaml_str}---\n"
    except ImportError:
        # Manual serialization for simple cases
        lines = []
        for key, value in frontmatter.items():
            if isinstance(value, str):
                lines.append(f"{key}: {value}")
            elif isinstance(value, bool):
                lines.append(f"{key}: {'true' if value else 'false'}")
            elif isinstance(value, (int, float)):
                lines.append(f"{key}: {value}")
            else:
                lines.append(f"{key}: {repr(value)}")
        return f"---\n" + '\n'.join(lines) + "\n---\n"
